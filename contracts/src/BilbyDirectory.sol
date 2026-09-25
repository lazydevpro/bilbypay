// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title BilbyDirectory
/// @notice Phone number → account lookup, like UPI's mapper. Numbers are never stored: the key is
/// `phoneKey = HMAC(pepper, E.164)` computed off-chain. A binding only changes with an attestation
/// from the verifier, which signs after an OTP check and a passkey signature from the account.
/// The number only *finds* an account; it can never move money.
contract BilbyDirectory is EIP712, Ownable2Step {
    struct Binding {
        address account;
        uint64 boundAt;
    }

    bytes32 public constant BIND_TYPEHASH =
        keccak256("Bind(bytes32 phoneKey,address account,uint256 issuedAt,uint256 deadline)");

    address public verifier;
    mapping(bytes32 phoneKey => Binding) private _bindings;
    mapping(address account => bytes32 phoneKey) public phoneKeyOf;
    /// @dev Attestations must be newer than the last one used for the same number, so an old
    /// attestation can't be replayed to undo a later rebind.
    mapping(bytes32 phoneKey => uint256 issuedAt) public lastIssuedAt;

    event Bound(bytes32 indexed phoneKey, address indexed account, address indexed previous);
    event Unbound(bytes32 indexed phoneKey, address indexed account);
    event VerifierChanged(address indexed verifier);

    error InvalidAccount();
    error InvalidAttestation();
    error AttestationExpired();
    error StaleAttestation();
    error AlreadyBound();

    constructor(address owner_, address verifier_) EIP712("BilbyDirectory", "1") Ownable(owner_) {
        _setVerifier(verifier_);
    }

    function setVerifier(address verifier_) external onlyOwner {
        _setVerifier(verifier_);
    }

    /// @notice Binds `phoneKey` to `account`, replacing any previous binding of either.
    function bind(bytes32 phoneKey, address account, uint256 issuedAt, uint256 deadline, bytes calldata signature)
        external
    {
        if (account == address(0) || phoneKey == bytes32(0)) revert InvalidAccount();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (issuedAt <= lastIssuedAt[phoneKey]) revert StaleAttestation();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(BIND_TYPEHASH, phoneKey, account, issuedAt, deadline)));
        if (ECDSA.recover(digest, signature) != verifier) revert InvalidAttestation();

        Binding memory current = _bindings[phoneKey];
        if (current.account == account) revert AlreadyBound();
        lastIssuedAt[phoneKey] = issuedAt;

        // The number moves to a new account: the old account loses it.
        if (current.account != address(0)) delete phoneKeyOf[current.account];
        // The account changes number: its old number no longer points at it.
        bytes32 oldKey = phoneKeyOf[account];
        if (oldKey != bytes32(0)) {
            delete _bindings[oldKey];
            emit Unbound(oldKey, account);
        }

        _bindings[phoneKey] = Binding(account, uint64(block.timestamp));
        phoneKeyOf[account] = phoneKey;
        emit Bound(phoneKey, account, current.account);
    }

    /// @return account The bound account, or zero if the number hasn't joined.
    /// @return boundAt When the current binding was made. Recent rebinds warrant a sender warning.
    function resolve(bytes32 phoneKey) external view returns (address account, uint64 boundAt) {
        Binding memory b = _bindings[phoneKey];
        return (b.account, b.boundAt);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _setVerifier(address verifier_) private {
        if (verifier_ == address(0)) revert InvalidAccount();
        verifier = verifier_;
        emit VerifierChanged(verifier_);
    }
}
