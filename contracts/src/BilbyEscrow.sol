// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title BilbyEscrow
/// @notice Holds dollars sent to a phone number that hasn't joined yet (or a gift card to be bought
/// at claim time). The recipient claims with a verifier attestation after proving the number;
/// otherwise the sender gets it back after expiry, or can cancel before it is claimed.
///
/// Deposits are pulled with EIP-3009 `receiveWithAuthorization`. The deposit terms (phone, expiry,
/// kind, gift id) are hashed into the authorization nonce the sender signs, so nobody who sees the
/// signature can redirect the deposit to other terms.
contract BilbyEscrow is EIP712, Ownable2Step {
    using SafeERC20 for IERC20;

    enum Kind {
        TRANSFER, // claim → recipient's account
        GIFT // claim → treasury, which then buys the gift card for the recipient
    }

    enum Status {
        None,
        Pending,
        Claimed,
        Refunded,
        Cancelled
    }

    struct Deposit {
        address sender;
        uint96 amount;
        bytes32 phoneKey;
        uint40 expiry;
        Kind kind;
        Status status;
    }

    /// Terms a sender commits to when signing the deposit authorization.
    struct Terms {
        bytes32 phoneKey;
        uint40 expiry;
        Kind kind;
        bytes32 giftId; // zero for TRANSFER
        bytes32 salt; // random, makes each authorization nonce unique
    }

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 depositId,bytes32 phoneKey,address recipient,uint256 deadline)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 depositId,uint256 deadline)");
    bytes32 public constant TERMS_TAG = keccak256("BilbyEscrow.Terms.v1");

    uint256 public constant MIN_EXPIRY = 1 hours;
    uint256 public constant MAX_EXPIRY = 180 days;

    IERC20 public immutable token;
    address public verifier;
    address public treasury;
    mapping(bytes32 depositId => Deposit) private _deposits;

    event Deposited(
        bytes32 indexed depositId,
        address indexed sender,
        bytes32 indexed phoneKey,
        uint256 amount,
        uint256 expiry,
        Kind kind,
        bytes32 giftId
    );
    event Claimed(bytes32 indexed depositId, address indexed recipient, address indexed paidTo, uint256 amount);
    event Refunded(bytes32 indexed depositId, address indexed sender, uint256 amount);
    event Cancelled(bytes32 indexed depositId, address indexed sender, uint256 amount);
    event VerifierChanged(address indexed verifier);
    event TreasuryChanged(address indexed treasury);

    error InvalidTerms();
    error AmountTooLarge();
    error DepositExists();
    error NotPending();
    error NotExpired();
    error InvalidSignature();
    error SignatureExpired();
    error ZeroAddress();

    constructor(IERC20 token_, address owner_, address verifier_, address treasury_)
        EIP712("BilbyEscrow", "1")
        Ownable(owner_)
    {
        token = token_;
        _setVerifier(verifier_);
        _setTreasury(treasury_);
    }

    // ---------------------------------------------------------------- views

    /// @notice The EIP-3009 nonce a sender must sign for these terms.
    function termsNonce(Terms calldata terms) public pure returns (bytes32) {
        return keccak256(abi.encode(TERMS_TAG, terms.phoneKey, terms.expiry, terms.kind, terms.giftId, terms.salt));
    }

    function depositIdOf(address sender, bytes32 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(sender, nonce));
    }

    function getDeposit(bytes32 depositId) external view returns (Deposit memory) {
        return _deposits[depositId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------ deposits

    /// @notice Pulls `amount` from `from` (who signed a ReceiveWithAuthorization to this contract
    /// with nonce = termsNonce(terms)) and holds it for whoever proves `terms.phoneKey`.
    function depositWithAuthorization(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        Terms calldata terms,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (bytes32 depositId) {
        if (terms.phoneKey == bytes32(0) || amount == 0) revert InvalidTerms();
        if (terms.expiry < block.timestamp + MIN_EXPIRY || terms.expiry > block.timestamp + MAX_EXPIRY) {
            revert InvalidTerms();
        }
        if ((terms.kind == Kind.GIFT) != (terms.giftId != bytes32(0))) revert InvalidTerms();
        if (amount > type(uint96).max) revert AmountTooLarge();

        bytes32 nonce = termsNonce(terms);
        depositId = depositIdOf(from, nonce);
        if (_deposits[depositId].status != Status.None) revert DepositExists();

        _deposits[depositId] = Deposit({
            sender: from,
            amount: uint96(amount),
            phoneKey: terms.phoneKey,
            expiry: terms.expiry,
            kind: terms.kind,
            status: Status.Pending
        });

        uint256 before = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        if (token.balanceOf(address(this)) - before != amount) revert InvalidTerms();

        emit Deposited(depositId, from, terms.phoneKey, amount, terms.expiry, terms.kind, terms.giftId);
    }

    // -------------------------------------------------------------- claims

    /// @notice Releases a pending deposit after the verifier attests that `recipient` proved the
    /// deposit's phone number. Transfers pay the recipient; gifts pay the treasury, which buys the card.
    function claim(bytes32 depositId, address recipient, uint256 deadline, bytes calldata attestation) external {
        if (recipient == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();
        Deposit storage d = _deposits[depositId];
        if (d.status != Status.Pending) revert NotPending();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, depositId, d.phoneKey, recipient, deadline)));
        if (ECDSA.recover(digest, attestation) != verifier) revert InvalidSignature();

        d.status = Status.Claimed;
        address paidTo = d.kind == Kind.GIFT ? treasury : recipient;
        token.safeTransfer(paidTo, d.amount);
        emit Claimed(depositId, recipient, paidTo, d.amount);
    }

    /// @notice After expiry, anyone may return an unclaimed deposit to its sender.
    function refund(bytes32 depositId) external {
        Deposit storage d = _deposits[depositId];
        if (d.status != Status.Pending) revert NotPending();
        if (block.timestamp < d.expiry) revert NotExpired();
        d.status = Status.Refunded;
        token.safeTransfer(d.sender, d.amount);
        emit Refunded(depositId, d.sender, d.amount);
    }

    /// @notice The sender takes an unclaimed deposit back early ("sent to the wrong number").
    function cancel(bytes32 depositId, uint256 deadline, bytes calldata senderSignature) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        Deposit storage d = _deposits[depositId];
        if (d.status != Status.Pending) revert NotPending();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, depositId, deadline)));
        if (ECDSA.recover(digest, senderSignature) != d.sender) revert InvalidSignature();
        d.status = Status.Cancelled;
        token.safeTransfer(d.sender, d.amount);
        emit Cancelled(depositId, d.sender, d.amount);
    }

    // --------------------------------------------------------------- admin

    function setVerifier(address verifier_) external onlyOwner {
        _setVerifier(verifier_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        _setTreasury(treasury_);
    }

    function _setVerifier(address verifier_) private {
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
        emit VerifierChanged(verifier_);
    }

    function _setTreasury(address treasury_) private {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }
}
