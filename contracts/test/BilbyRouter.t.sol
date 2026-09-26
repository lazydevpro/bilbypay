// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {MockBurrowVault} from "../src/mocks/MockBurrowVault.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";
import {SigUtils} from "./utils/SigUtils.sol";

contract BilbyRouterTest is Test {
    MockAUSD ausd;
    MockBurrowVault vault;
    BilbyRouter router;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");
    address attacker = makeAddr("attacker");
    address owner = makeAddr("owner");

    uint256 constant USD = 1e6;
    uint256 deadline;

    function setUp() public {
        vm.warp(1_760_000_000);
        deadline = block.timestamp + 1 hours;
        alice = vm.addr(alicePk);
        ausd = new MockAUSD();
        vault = new MockBurrowVault(IERC20(address(ausd)), owner);
        router = new BilbyRouter(IERC20(address(ausd)), IERC4626(address(vault)), 1 * USD, owner);
        vm.startPrank(owner);
        router.setAllowedCall(address(ausd), bytes4(0xe3ee160e), true);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _enableAutoSave(uint256 threshold) internal {
        bytes memory sig = SigUtils.autoSave(alicePk, router, true, threshold, router.nonces(alice), deadline);
        BilbyRouter.PermitSig memory p =
            SigUtils.permit(alicePk, address(ausd), address(router), type(uint256).max, deadline);
        vm.prank(keeper);
        router.setAutoSave(alice, true, threshold, deadline, sig, p);
    }

    function _burrowOf(address u) internal view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(u));
    }

    // ---------------------------------------------------------------- auto-save

    function test_setAutoSave_storesThresholdAndAllowance() public {
        _enableAutoSave(200 * USD);
        (bool enabled, uint128 threshold) = router.autoSave(alice);
        assertTrue(enabled);
        assertEq(threshold, 200 * USD);
        assertEq(ausd.allowance(alice, address(router)), type(uint256).max);
    }

    function test_setAutoSave_rejectsBadSignature() public {
        bytes memory sig = SigUtils.autoSave(0xBAD, router, true, 1, router.nonces(alice), deadline);
        vm.expectRevert(BilbyRouter.BadSignature.selector);
        router.setAutoSave(alice, true, 1, deadline, sig, SigUtils.noPermit());
    }

    function test_setAutoSave_rejectsReplay() public {
        bytes memory sig = SigUtils.autoSave(alicePk, router, true, 5 * USD, 0, deadline);
        router.setAutoSave(alice, true, 5 * USD, deadline, sig, SigUtils.noPermit());
        vm.expectRevert(BilbyRouter.BadSignature.selector);
        router.setAutoSave(alice, true, 5 * USD, deadline, sig, SigUtils.noPermit());
    }

    function test_setAutoSave_rejectsExpired() public {
        bytes memory sig = SigUtils.autoSave(alicePk, router, true, 1, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(BilbyRouter.Expired.selector);
        router.setAutoSave(alice, true, 1, deadline, sig, SigUtils.noPermit());
    }

    function test_sweep_movesOnlyAboveThreshold() public {
        _enableAutoSave(200 * USD);
        ausd.mint(alice, 350 * USD);
        vm.prank(keeper);
        (uint256 assets,) = router.sweep(alice);
        assertEq(assets, 150 * USD);
        assertEq(ausd.balanceOf(alice), 200 * USD, "balance stays at threshold");
        assertEq(_burrowOf(alice), 150 * USD, "shares minted to alice");
        assertEq(ausd.balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_sweep_revertsWhenOffOrBelowMin() public {
        vm.expectRevert(BilbyRouter.AutoSaveOff.selector);
        router.sweep(alice);

        _enableAutoSave(200 * USD);
        ausd.mint(alice, 200 * USD + USD / 2); // 0.50 above threshold < minSweep
        vm.expectRevert(BilbyRouter.NothingToSweep.selector);
        router.sweep(alice);
        assertEq(router.sweepable(alice), 0);
    }

    function test_disableAutoSave_revokesAllowance() public {
        _enableAutoSave(10 * USD);
        bytes memory sig = SigUtils.autoSave(alicePk, router, false, 0, router.nonces(alice), deadline);
        BilbyRouter.PermitSig memory p = SigUtils.permit(alicePk, address(ausd), address(router), 0, deadline);
        router.setAutoSave(alice, false, 0, deadline, sig, p);
        assertEq(ausd.allowance(alice, address(router)), 0);
        ausd.mint(alice, 100 * USD);
        vm.expectRevert(BilbyRouter.AutoSaveOff.selector);
        router.sweep(alice);
    }

    function testFuzz_sweep_neverBelowThreshold(uint96 threshold, uint96 balance) public {
        threshold = uint96(bound(threshold, 0, 1e15));
        balance = uint96(bound(balance, uint256(threshold) + USD, 2e15));
        _enableAutoSave(threshold);
        ausd.mint(alice, balance);
        router.sweep(alice);
        assertEq(ausd.balanceOf(alice), threshold);
        assertApproxEqAbs(_burrowOf(alice), uint256(balance) - threshold, 1);
    }

    // ---------------------------------------------------------------- break-and-pay

    function _seedBurrow(uint256 liquid, uint256 saved) internal {
        _enableAutoSave(liquid);
        ausd.mint(alice, liquid + saved);
        router.sweep(alice);
    }

    function test_topUpAndCall_breaksShortfallAndPaysInOneTx() public {
        _seedBurrow(40 * USD, 100 * USD); // balance $40, Burrow $100
        uint256 amount = 100 * USD;
        uint256 shortfall = amount - ausd.balanceOf(alice); // $60
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(ausd), bob, amount, deadline, "n1");
        BilbyRouter.PermitSig memory p = SigUtils.permit(
            alicePk, address(vault), address(router), vault.previewWithdraw(shortfall), deadline
        );

        vm.prank(keeper);
        router.topUpAndCall(alice, shortfall, p, address(ausd), pay);

        assertEq(ausd.balanceOf(bob), amount, "bob paid");
        assertEq(ausd.balanceOf(alice), 0, "balance used up");
        assertApproxEqAbs(_burrowOf(alice), 40 * USD, 1, "only shortfall broken");
    }

    function test_topUpAndCall_isAtomic_whenPaymentFails() public {
        _seedBurrow(40 * USD, 100 * USD);
        // signature for a different amount → payment reverts → break must revert too
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(ausd), bob, 100 * USD, deadline, "n1");
        assembly { mstore(add(pay, 100), 99000000) } // tamper value field
        BilbyRouter.PermitSig memory p =
            SigUtils.permit(alicePk, address(vault), address(router), vault.previewWithdraw(60 * USD), deadline);
        vm.expectRevert(bytes("bad sig"));
        router.topUpAndCall(alice, 60 * USD, p, address(ausd), pay);
        assertEq(ausd.balanceOf(alice), 40 * USD);
        assertApproxEqAbs(_burrowOf(alice), 100 * USD, 1);
    }

    function test_topUpAndCall_revertsWhenLiquidityShort() public {
        _seedBurrow(40 * USD, 100 * USD);
        vm.prank(owner);
        vault.setLiquidityCap(30 * USD);
        assertEq(vault.maxWithdraw(alice), 30 * USD, "app would offer only $30");
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(ausd), bob, 100 * USD, deadline, "n1");
        BilbyRouter.PermitSig memory p =
            SigUtils.permit(alicePk, address(vault), address(router), vault.previewWithdraw(60 * USD), deadline);
        vm.expectRevert();
        router.topUpAndCall(alice, 60 * USD, p, address(ausd), pay);
        assertEq(ausd.balanceOf(bob), 0);
    }

    function test_topUpAndCall_survivesFrontRunPermit() public {
        _seedBurrow(0, 50 * USD);
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(ausd), bob, 20 * USD, deadline, "n1");
        BilbyRouter.PermitSig memory p =
            SigUtils.permit(alicePk, address(vault), address(router), vault.previewWithdraw(20 * USD), deadline);
        vm.prank(attacker);
        vault.permit(alice, address(router), p.value, p.deadline, p.v, p.r, p.s);
        router.topUpAndCall(alice, 20 * USD, p, address(ausd), pay);
        assertEq(ausd.balanceOf(bob), 20 * USD);
    }

    function test_topUpAndCall_noShortfall_justPays() public {
        ausd.mint(alice, 10 * USD);
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(ausd), bob, 10 * USD, deadline, "n1");
        router.topUpAndCall(alice, 0, SigUtils.noPermit(), address(ausd), pay);
        assertEq(ausd.balanceOf(bob), 10 * USD);
    }

    // ---------------------------------------------------------------- security: allowance can't be abused

    function test_topUpAndCall_rejectsTransferFromUsingSweepAllowance() public {
        _enableAutoSave(0);
        ausd.mint(alice, 100 * USD);
        bytes memory steal = abi.encodeWithSelector(IERC20.transferFrom.selector, alice, attacker, 100 * USD);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(BilbyRouter.CallNotAllowed.selector, address(ausd), IERC20.transferFrom.selector)
        );
        router.topUpAndCall(alice, 0, SigUtils.noPermit(), address(ausd), steal);
    }

    function test_setAllowedCall_cannotAllowDangerousCalls() public {
        vm.startPrank(owner);
        vm.expectRevert();
        router.setAllowedCall(address(ausd), IERC20.transferFrom.selector, true);
        vm.expectRevert();
        router.setAllowedCall(address(ausd), IERC20.approve.selector, true);
        vm.expectRevert();
        router.setAllowedCall(address(vault), IERC4626.withdraw.selector, true);
        vm.stopPrank();
    }

    function test_topUpAndCall_rejectsPayerMismatch() public {
        ausd.mint(bob, 10 * USD);
        bytes memory pay = SigUtils.transferWithAuthorization(alicePk, address(ausd), bob, 10 * USD, deadline, "n1");
        vm.expectRevert(BilbyRouter.PayerMismatch.selector);
        router.topUpAndCall(bob, 0, SigUtils.noPermit(), address(ausd), pay);
    }

    function test_lockCalls_freezesAllowlist() public {
        vm.startPrank(owner);
        router.lockCalls();
        vm.expectRevert(BilbyRouter.AllowlistLocked.selector);
        router.setAllowedCall(address(ausd), bytes4(0xcf092995), true);
        vm.stopPrank();
    }

    function test_onlyOwnerCanSetAllowlist() public {
        vm.prank(attacker);
        vm.expectRevert();
        router.setAllowedCall(address(0xBEEF), bytes4(0x12345678), true);
    }

    // ---------------------------------------------------------------- manual add / break + earnings

    function test_addToBurrow_andBreakToBalance() public {
        ausd.mint(alice, 50 * USD);
        (uint8 v, bytes32 r, bytes32 s) =
            SigUtils.receiveWithAuthorization(alicePk, address(ausd), address(router), 30 * USD, deadline, "a1");
        router.addToBurrow(alice, 30 * USD, 0, deadline, "a1", v, r, s);
        assertEq(ausd.balanceOf(alice), 20 * USD);
        assertApproxEqAbs(_burrowOf(alice), 30 * USD, 1);

        BilbyRouter.PermitSig memory p =
            SigUtils.permit(alicePk, address(vault), address(router), vault.previewWithdraw(10 * USD), deadline);
        router.breakToBalance(alice, 10 * USD, p);
        assertEq(ausd.balanceOf(alice), 30 * USD);
        assertApproxEqAbs(_burrowOf(alice), 20 * USD, 1);
    }

    function test_earnings_showUpInBurrow() public {
        _seedBurrow(0, 100 * USD);
        ausd.mint(address(this), 5 * USD);
        ausd.approve(address(vault), 5 * USD);
        vault.accrue(5 * USD);
        assertApproxEqAbs(_burrowOf(alice), 105 * USD, 1, "earned $5");
    }
}
