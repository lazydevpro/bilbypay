// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, IERC20Metadata, ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockBurrowVault — testnet stand-in for Aave's stataAUSD.
/// @notice Same surface the router relies on (ERC-4626 + EIP-2612 permit). Adds two knobs for demos/tests:
///         `accrue` (simulate earnings by adding dollars to the vault) and `liquidityCap` (simulate Aave having
///         limited free liquidity, which caps instant withdrawals).
contract MockBurrowVault is ERC4626, ERC20Permit, Ownable {
    using SafeERC20 for IERC20;

    uint256 public liquidityCap = type(uint256).max;

    event Accrued(uint256 assets);
    event LiquidityCapSet(uint256 cap);

    constructor(IERC20 asset_, address owner_)
        ERC20("Mock Burrow AUSD", "mbAUSD")
        ERC20Permit("Mock Burrow AUSD")
        ERC4626(asset_)
        Ownable(owner_)
    {}

    /// @notice Simulate earnings: moves `assets` dollars from the caller into the vault, raising the share price.
    function accrue(uint256 assets) external {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);
        emit Accrued(assets);
    }

    function setLiquidityCap(uint256 cap) external onlyOwner {
        liquidityCap = cap;
        emit LiquidityCapSet(cap);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 m = super.maxWithdraw(owner_);
        return m < liquidityCap ? m : liquidityCap;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 m = super.maxRedeem(owner_);
        uint256 capShares = liquidityCap == type(uint256).max ? type(uint256).max : previewWithdraw(liquidityCap);
        return m < capShares ? m : capShares;
    }

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return super.decimals();
    }
}
