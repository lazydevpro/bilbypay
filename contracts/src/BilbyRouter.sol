// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {BilbyEscrow} from "./BilbyEscrow.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title BilbyRouter — Burrow
/// @notice Moves a user's dollars between their balance (AUSD) and their Burrow (Aave stataAUSD
/// shares held by the user). Every path pays out to the user themself: the router never holds
/// funds at rest and can only call two allow-listed payment functions.
///
/// - `topUpAndCall`: take the shortfall out of Burrow and make a pre-signed payment, in one tx.
/// - `sweep`: keeper moves money above the user's signed threshold into their Burrow.
/// - `breakToBalance` / `addWithAuthorization`: manual "Move to balance" / "Add to Burrow".
contract BilbyRouter is EIP712, Ownable2Step {
    using SafeERC20 for IERC20;

    struct Permit {
        uint256 value; // 0 = skip (use an existing allowance)
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct AutoSave {
        bool enabled;
        uint128 threshold; // AUSD units kept in the balance
    }

    bytes32 public constant SET_AUTOSAVE_TYPEHASH =
        keccak256("SetAutoSave(address user,bool enabled,uint256 threshold,uint256 nonce,uint256 deadline)");

    IERC20 public immutable ausd;
    IERC4626 public immutable stata;
    address public immutable escrow;

    mapping(address user => AutoSave) public autoSave;
    mapping(address user => uint256) public nonces;
    mapping(address keeper => bool) public isKeeper;

    event AutoSaveSet(address indexed user, bool enabled, uint256 threshold);
    event Swept(address indexed user, uint256 assets, uint256 shares);
    event Broken(address indexed user, uint256 assets, uint256 shares);
    event Added(address indexed user, uint256 assets, uint256 shares);
    event KeeperSet(address indexed keeper, bool allowed);

    error NotKeeper();
    error AutoSaveOff();
    error NothingToSweep();
    error TargetNotAllowed();
    error PayerMismatch();
    error InvalidSignature();
    error SignatureExpired();
    error CallFailed(bytes reason);

    constructor(IERC20 ausd_, IERC4626 stata_, address escrow_, address owner_)
        EIP712("BilbyRouter", "1")
        Ownable(owner_)
    {
        require(stata_.asset() == address(ausd_), "stata asset != ausd");
        ausd = ausd_;
        stata = stata_;
        escrow = escrow_;
        ausd_.forceApprove(address(stata_), type(uint256).max);
    }

    // --------------------------------------------------------- break + pay

    /// @notice Withdraws `shortfall` AUSD from the user's Burrow to the user, then executes the
    /// user's pre-signed payment. The payment must be AUSD.transferWithAuthorization or
    /// BilbyEscrow.depositWithAuthorization with the user as payer.
    function topUpAndCall(address user, uint256 shortfall, Permit calldata sharePermit, address target, bytes calldata data)
        external
    {
        _checkPayment(user, target, data);
        if (shortfall > 0) {
            _permit(address(stata), user, sharePermit);
            uint256 shares = stata.withdraw(shortfall, user, user);
            emit Broken(user, shortfall, shares);
        }
        (bool ok, bytes memory reason) = target.call(data);
        if (!ok) revert CallFailed(reason);
    }

    /// @notice "Move to balance": withdraw `assets` AUSD from Burrow to the user.
    function breakToBalance(address user, uint256 assets, Permit calldata sharePermit) external {
        _permit(address(stata), user, sharePermit);
        uint256 shares = stata.withdraw(assets, user, user);
        emit Broken(user, assets, shares);
    }

    /// @notice "Add to Burrow": the user signs a ReceiveWithAuthorization of `assets` to this router.
    function addWithAuthorization(
        address user,
        uint256 assets,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC3009(address(ausd)).receiveWithAuthorization(user, address(this), assets, validAfter, validBefore, nonce, v, r, s);
        uint256 shares = stata.deposit(assets, user);
        emit Added(user, assets, shares);
    }

    // ----------------------------------------------------------- auto-save

    /// @notice Turns auto-save on/off with the user's signature. `ausdPermit` is the AUSD allowance
    /// for sweeping: max when enabling, 0 when disabling (revokes it).
    function setAutoSave(
        address user,
        bool enabled,
        uint256 threshold,
        uint256 deadline,
        bytes calldata signature,
        Permit calldata ausdPermit
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (threshold > type(uint128).max) revert InvalidSignature();
        uint256 nonce = nonces[user]++;
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(SET_AUTOSAVE_TYPEHASH, user, enabled, threshold, nonce, deadline))
        );
        if (ECDSA.recover(digest, signature) != user) revert InvalidSignature();

        autoSave[user] = AutoSave(enabled, uint128(threshold));
        if (!enabled || ausdPermit.value > 0) _permitAllowZero(address(ausd), user, ausdPermit);
        emit AutoSaveSet(user, enabled, threshold);
    }

    /// @notice Keeper: moves the user's balance above their threshold into their own Burrow.
    function sweep(address user) external returns (uint256 assets) {
        if (!isKeeper[msg.sender]) revert NotKeeper();
        AutoSave memory cfg = autoSave[user];
        if (!cfg.enabled) revert AutoSaveOff();
        uint256 balance = ausd.balanceOf(user);
        if (balance <= cfg.threshold) revert NothingToSweep();
        assets = balance - cfg.threshold;
        ausd.safeTransferFrom(user, address(this), assets);
        uint256 shares = stata.deposit(assets, user);
        emit Swept(user, assets, shares);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------ internal

    function _checkPayment(address user, address target, bytes calldata data) private view {
        if (data.length < 36) revert TargetNotAllowed();
        bytes4 selector = bytes4(data[:4]);
        bool allowed = (target == address(ausd) && selector == IERC3009.transferWithAuthorization.selector)
            || (target == escrow && selector == BilbyEscrow.depositWithAuthorization.selector);
        if (!allowed) revert TargetNotAllowed();
        // Both functions take the payer as their first argument.
        if (abi.decode(data[4:36], (address)) != user) revert PayerMismatch();
    }

    function _permit(address token, address owner, Permit calldata p) private {
        if (p.value == 0) return;
        _permitAllowZero(token, owner, p);
    }

    /// @dev Tolerates a front-run permit (already applied) by checking the resulting allowance.
    function _permitAllowZero(address token, address owner, Permit calldata p) private {
        try IERC20Permit(token).permit(owner, address(this), p.value, p.deadline, p.v, p.r, p.s) {}
        catch {
            uint256 allowance = IERC20(token).allowance(owner, address(this));
            if (p.value == 0 ? allowance != 0 : allowance < p.value) revert InvalidSignature();
        }
    }
}
