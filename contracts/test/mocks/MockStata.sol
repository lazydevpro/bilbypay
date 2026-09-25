// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC4626, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {MockAUSD} from "./MockAUSD.sol";

/// @notice Test-only stand-in for Aave's stataAUSD: ERC-4626 + permit, with a knob for the pool's
/// free liquidity (Aave can't pay out more than the pool's idle cash) and for accruing yield.
contract MockStata is ERC4626, ERC20Permit {
    uint256 public liquidity = type(uint256).max;

    constructor(MockAUSD asset_)
        ERC20("Wrapped Aave Monad AUSD", "stataAUSD")
        ERC4626(IERC20(address(asset_)))
        ERC20Permit("Wrapped Aave Monad AUSD")
    {}

    function setLiquidity(uint256 liquidity_) external {
        liquidity = liquidity_;
    }

    /// Simulates interest: more assets per share.
    function accrue(uint256 assets) external {
        MockAUSD(asset()).mint(address(this), assets);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 max = super.maxWithdraw(owner);
        return max < liquidity ? max : liquidity;
    }

    function decimals() public view override(ERC4626, ERC20) returns (uint8) {
        return super.decimals();
    }
}
