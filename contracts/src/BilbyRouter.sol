// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title BilbyRouter — "Burrow": auto-save above a threshold, break any time, break-and-pay in one tx.
/// @notice Burrow money sits in an ERC-4626 vault over the dollar token (Aave stataAUSD on mainnet, a mock on
///         testnet). The router never holds funds at rest and can only ever move a user's Burrow money back to
///         that same user, or move a user's dollars above their threshold into that same user's Burrow.
///         Payments themselves are authorized separately by the user's EIP-3009 signature.
contract BilbyRouter is EIP712, Nonces, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PermitSig {
        uint256 value;
        uint256 deadline; // 0 = no permit supplied (allowance already in place)
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct AutoSave {
        bool enabled;
        uint128 threshold; // dollars (token units) to keep liquid
    }

    bytes32 public constant AUTOSAVE_TYPEHASH =
        keccak256("AutoSave(address user,bool enabled,uint256 threshold,uint256 nonce,uint256 deadline)");

    /// EIP-3009 transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
    bytes4 internal constant TWA_VRS = 0xe3ee160e;
    /// EIP-3009 transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
    bytes4 internal constant TWA_BYTES = 0xcf092995;

    IERC20 public immutable dollar;
    IERC4626 public immutable burrow;
    /// Smallest amount worth sweeping (avoids dust deposits).
    uint256 public immutable minSweep;

    mapping(address user => AutoSave) public autoSave;
    /// Payment calls topUpAndCall may execute. Every allowed function must take `from` as its first argument.
    mapping(address target => mapping(bytes4 selector => bool)) public allowedCall;
    bool public callsLocked;

    event AutoSaveSet(address indexed user, bool enabled, uint256 threshold);
    event Swept(address indexed user, uint256 assets, uint256 shares);
    event AddedToBurrow(address indexed user, uint256 assets, uint256 shares);
    event BrokeToBalance(address indexed user, uint256 assets);
    event ToppedUpAndPaid(address indexed user, uint256 fromBurrow, address indexed target, bytes4 selector);
    event AllowedCallSet(address indexed target, bytes4 indexed selector, bool allowed);
    event CallsLocked();

    error AssetMismatch();
    error Expired();
    error BadSignature();
    error AutoSaveOff();
    error NothingToSweep();
    error CallNotAllowed(address target, bytes4 selector);
    error PayerMismatch();
    error AllowlistLocked();

    constructor(IERC20 dollar_, IERC4626 burrow_, uint256 minSweep_, address owner_)
        EIP712("BilbyRouter", "1")
        Ownable(owner_)
    {
        if (burrow_.asset() != address(dollar_)) revert AssetMismatch();
        dollar = dollar_;
        burrow = burrow_;
        minSweep = minSweep_;
        dollar_.forceApprove(address(burrow_), type(uint256).max);
    }

    // ------------------------------------------------------------------ auto-save

    /// @notice Turn auto-save on/off and set the threshold. Signed once by the user (one Face ID).
    /// @param dollarPermit Allowance for sweeps: max when enabling, 0 when disabling (revokes it).
    function setAutoSave(
        address user,
        bool enabled,
        uint256 threshold,
        uint256 deadline,
        bytes calldata signature,
        PermitSig calldata dollarPermit
    ) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(AUTOSAVE_TYPEHASH, user, enabled, threshold, _useNonce(user), deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(user, digest, signature)) revert BadSignature();

        _tryPermit(address(dollar), user, dollarPermit);
        autoSave[user] = AutoSave({enabled: enabled, threshold: SafeCast.toUint128(threshold)});
        emit AutoSaveSet(user, enabled, threshold);
    }

    /// @notice Move everything above the user's threshold into their Burrow. Keeper-callable; the money can
    ///         only go into `user`'s own Burrow.
    function sweep(address user) external nonReentrant returns (uint256 assets, uint256 shares) {
        AutoSave memory s = autoSave[user];
        if (!s.enabled) revert AutoSaveOff();
        uint256 bal = dollar.balanceOf(user);
        if (bal < uint256(s.threshold) + minSweep) revert NothingToSweep();
        assets = bal - s.threshold;
        dollar.safeTransferFrom(user, address(this), assets);
        shares = burrow.deposit(assets, user);
        emit Swept(user, assets, shares);
    }

    /// @notice How much a sweep would move right now (0 if nothing). For the keeper.
    function sweepable(address user) external view returns (uint256) {
        AutoSave memory s = autoSave[user];
        if (!s.enabled) return 0;
        uint256 bal = dollar.balanceOf(user);
        if (bal < uint256(s.threshold) + minSweep) return 0;
        uint256 amt = bal - s.threshold;
        uint256 allowance = dollar.allowance(user, address(this));
        return amt > allowance ? 0 : amt;
    }

    // ------------------------------------------------------------------ manual add / break

    /// @notice "Add to Burrow": pulls `assets` from the user via their EIP-3009 authorization (payee = router).
    function addToBurrow(
        address user,
        uint256 assets,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 shares) {
        IERC3009(address(dollar)).receiveWithAuthorization(
            user, address(this), assets, validAfter, validBefore, nonce, v, r, s
        );
        shares = burrow.deposit(assets, user);
        emit AddedToBurrow(user, assets, shares);
    }

    /// @notice "Move to balance": break any amount of Burrow back into the user's balance.
    function breakToBalance(address user, uint256 assets, PermitSig calldata sharePermit)
        external
        nonReentrant
    {
        _tryPermit(address(burrow), user, sharePermit);
        burrow.withdraw(assets, user, user);
        emit BrokeToBalance(user, assets);
    }

    // ------------------------------------------------------------------ break-and-pay

    /// @notice Pay more than the balance: break exactly `shortfall` from Burrow into the user's balance, then run
    ///         the user's pre-signed payment — all in one transaction. If the payment fails, the break reverts too.
    /// @param data Calldata for an allow-listed payment function whose first argument is the payer (`user`),
    ///        e.g. AUSD.transferWithAuthorization(user, to, amount, ...) or an escrow deposit.
    function topUpAndCall(
        address user,
        uint256 shortfall,
        PermitSig calldata sharePermit,
        address target,
        bytes calldata data
    ) external nonReentrant returns (bytes memory result) {
        bytes4 selector = bytes4(data[:4]);
        if (!allowedCall[target][selector]) revert CallNotAllowed(target, selector);
        if (abi.decode(data[4:36], (address)) != user) revert PayerMismatch();

        if (shortfall > 0) {
            _tryPermit(address(burrow), user, sharePermit);
            burrow.withdraw(shortfall, user, user);
        }

        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        emit ToppedUpAndPaid(user, shortfall, target, selector);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Allow a payment call. The dollar token may only ever expose its EIP-3009 transfer functions and the
    ///         Burrow vault can never be a target, so a user's sweep allowance can't be used to move their money.
    function setAllowedCall(address target, bytes4 selector, bool allowed) external onlyOwner {
        if (callsLocked) revert AllowlistLocked();
        if (target == address(burrow)) revert CallNotAllowed(target, selector);
        if (target == address(dollar) && selector != TWA_VRS && selector != TWA_BYTES) {
            revert CallNotAllowed(target, selector);
        }
        allowedCall[target][selector] = allowed;
        emit AllowedCallSet(target, selector, allowed);
    }

    /// @notice Freeze the allow-list forever (do this before mainnet launch).
    function lockCalls() external onlyOwner {
        callsLocked = true;
        emit CallsLocked();
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ internal

    /// @dev Permit may already have been used (front-run) — ignore failure; the following transfer checks allowance.
    function _tryPermit(address token, address owner_, PermitSig calldata p) internal {
        if (p.deadline == 0) return;
        try IERC20Permit(token).permit(owner_, address(this), p.value, p.deadline, p.v, p.r, p.s) {} catch {}
    }
}
