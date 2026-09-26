// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {SigUtils} from "./utils/SigUtils.sol";

/// @notice Same Burrow flows against the REAL mainnet AUSD (EIP-3009/2612) and Aave stataAUSD (ERC-4626 + permit).
///         Run: forge test --match-contract Fork --fork-url monad
contract BilbyRouterForkTest is Test {
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    IERC4626 constant STATA_AUSD = IERC4626(0x9e1AcC5BFbf34e2E579763cE14042d957719fE76);
    uint256 constant USD = 1e6;

    BilbyRouter router;
    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");
    uint256 deadline;

    function setUp() public {
        if (block.chainid != 143) vm.skip(true);
        alice = vm.addr(alicePk);
        deadline = block.timestamp + 1 hours;
        router = new BilbyRouter(AUSD, STATA_AUSD, 1 * USD, address(this));
        router.setAllowedCall(address(AUSD), bytes4(0xe3ee160e), true);
        // AUSD uses custom storage, so `deal` can't write it — fund from Aave's aAUSD, a large holder.
        vm.prank(0xdeBFeDF35faEd5d1664E553545e144C02227A2Ec);
        AUSD.transfer(alice, 140 * USD);
    }

    function test_fork_sweepThenBreakAndPay() public {
        // turn on auto-save: keep $40
        bytes memory sig = SigUtils.autoSave(alicePk, router, true, 40 * USD, 0, deadline);
        BilbyRouter.PermitSig memory ap =
            SigUtils.permit(alicePk, address(AUSD), address(router), type(uint256).max, deadline);
        router.setAutoSave(alice, true, 40 * USD, deadline, sig, ap);

        router.sweep(alice);
        assertEq(AUSD.balanceOf(alice), 40 * USD, "kept $40");
        assertApproxEqAbs(STATA_AUSD.convertToAssets(STATA_AUSD.balanceOf(alice)), 100 * USD, 2, "$100 in Burrow");

        // pay bob $100: $40 balance + $60 from Burrow, one tx
        uint256 shortfall = 60 * USD;
        assertGe(STATA_AUSD.maxWithdraw(alice), shortfall, "Aave has liquidity");
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(AUSD), bob, 100 * USD, deadline, "p1");
        BilbyRouter.PermitSig memory sp = SigUtils.permit(
            alicePk, address(STATA_AUSD), address(router), STATA_AUSD.previewWithdraw(shortfall), deadline
        );
        router.topUpAndCall(alice, shortfall, sp, address(AUSD), pay);

        assertEq(AUSD.balanceOf(bob), 100 * USD, "bob paid");
        assertEq(AUSD.balanceOf(alice), 0);
        assertApproxEqAbs(STATA_AUSD.convertToAssets(STATA_AUSD.balanceOf(alice)), 40 * USD, 2, "$40 left in Burrow");
        assertEq(AUSD.balanceOf(address(router)), 0, "router holds nothing");
    }
}
