// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {BilbyEscrow} from "../src/BilbyEscrow.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

contract BilbyRouterTest is Base {
    BilbyRouter.Permit none;

    function setUp() public override {
        super.setUp();
        // Alice has $100 in her balance and $900 in Burrow.
        vm.startPrank(alice);
        ausd.approve(address(stata), 900e6);
        stata.deposit(900e6, alice);
        vm.stopPrank();
    }

    function _payCalldata(Auth memory a) internal pure returns (bytes memory) {
        return abi.encodeCall(
            MockAUSD.transferWithAuthorization, (a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s)
        );
    }

    function test_breakAndPayInOneTx() public {
        // Pay Bob $160 with $100 in balance: take $60 from Burrow.
        Auth memory a = _transferAuth(aliceKey, bob, 160e6, keccak256("p1"));
        uint256 shares = stata.previewWithdraw(60e6);
        vm.prank(relayer);
        router.topUpAndCall(alice, 60e6, _sharePermit(aliceKey, shares), address(ausd), _payCalldata(a));
        assertEq(ausd.balanceOf(bob), 160e6);
        assertEq(ausd.balanceOf(alice), 0);
        assertEq(stata.maxWithdraw(alice), 840e6);
        assertEq(alice.balance, 0);
        assertEq(ausd.balanceOf(address(router)), 0);
    }

    function test_breakAndDepositToEscrow() public {
        BilbyEscrow.Terms memory t = _terms(PHONE_BOB, BilbyEscrow.Kind.GIFT, keccak256("g"), keccak256("s"));
        Auth memory a = _receiveAuth(aliceKey, address(escrow), 150e6, escrow.termsNonce(t));
        bytes memory data = abi.encodeCall(
            BilbyEscrow.depositWithAuthorization, (alice, 150e6, a.validAfter, a.validBefore, t, a.v, a.r, a.s)
        );
        router.topUpAndCall(alice, 50e6, _sharePermit(aliceKey, stata.previewWithdraw(50e6)), address(escrow), data);
        assertEq(ausd.balanceOf(address(escrow)), 150e6);
        assertEq(ausd.balanceOf(alice), 0);
    }

    function test_paymentFailureRollsBackBreak() public {
        Auth memory a = _transferAuth(aliceKey, bob, 160e6, keccak256("p1"));
        a.value = 170e6; // tampered: signature no longer matches
        BilbyRouter.Permit memory p = _sharePermit(aliceKey, stata.previewWithdraw(60e6));
        vm.expectPartialRevert(BilbyRouter.CallFailed.selector);
        router.topUpAndCall(alice, 60e6, p, address(ausd), _payCalldata(a));
        assertEq(ausd.balanceOf(alice), 100e6);
        assertEq(stata.maxWithdraw(alice), 900e6);
    }

    function test_insufficientLiquidityRevertsWholeThing() public {
        stata.setLiquidity(10e6);
        Auth memory a = _transferAuth(aliceKey, bob, 160e6, keccak256("p1"));
        BilbyRouter.Permit memory p = _sharePermit(aliceKey, stata.previewWithdraw(60e6));
        vm.expectRevert();
        router.topUpAndCall(alice, 60e6, p, address(ausd), _payCalldata(a));
        assertEq(ausd.balanceOf(bob), 0);
    }

    /// With a standing AUSD allowance (auto-save on), the router must never be usable to pull funds.
    function test_disallowedTargetsAndSelectors() public {
        _enableAutoSave(50e6);
        bytes memory steal = abi.encodeCall(MockAUSD.transferFrom, (alice, bob, 10e6));
        vm.expectRevert(BilbyRouter.TargetNotAllowed.selector);
        router.topUpAndCall(alice, 0, none, address(ausd), steal);
        vm.expectRevert(BilbyRouter.TargetNotAllowed.selector);
        router.topUpAndCall(alice, 0, none, address(stata), steal);
    }

    function test_payerMustBeUser() public {
        ausd.mint(bob, 10e6);
        Auth memory a = _transferAuth(bobKey, alice, 10e6, keccak256("p1"));
        vm.expectRevert(BilbyRouter.PayerMismatch.selector);
        router.topUpAndCall(alice, 0, none, address(ausd), _payCalldata(a));
    }

    function _enableAutoSave(uint256 threshold) internal {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _autoSaveSig(aliceKey, true, threshold, deadline);
        router.setAutoSave(alice, true, threshold, deadline, sig, _ausdPermit(aliceKey, type(uint256).max));
    }

    function test_sweepKeepsThreshold() public {
        _enableAutoSave(40e6);
        vm.prank(keeper);
        uint256 swept = router.sweep(alice);
        assertEq(swept, 60e6);
        assertEq(ausd.balanceOf(alice), 40e6);
        assertEq(stata.maxWithdraw(alice), 960e6);
        vm.prank(keeper);
        vm.expectRevert(BilbyRouter.NothingToSweep.selector);
        router.sweep(alice);
    }

    function test_onlyKeeperSweeps() public {
        _enableAutoSave(40e6);
        vm.expectRevert(BilbyRouter.NotKeeper.selector);
        router.sweep(alice);
    }

    function test_disableRevokesAllowanceAndStopsSweeps() public {
        _enableAutoSave(40e6);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _autoSaveSig(aliceKey, false, 0, deadline);
        router.setAutoSave(alice, false, 0, deadline, sig, _ausdPermit(aliceKey, 0));
        assertEq(ausd.allowance(alice, address(router)), 0);
        vm.prank(keeper);
        vm.expectRevert(BilbyRouter.AutoSaveOff.selector);
        router.sweep(alice);
    }

    function test_autoSaveSignatureCannotBeReplayed() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _autoSaveSig(aliceKey, true, 40e6, deadline);
        router.setAutoSave(alice, true, 40e6, deadline, sig, _ausdPermit(aliceKey, type(uint256).max));
        vm.expectRevert(BilbyRouter.InvalidSignature.selector);
        router.setAutoSave(alice, true, 40e6, deadline, sig, none);
    }

    function test_autoSaveRejectsOthersSignature() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _autoSaveSig(bobKey, true, 0, deadline);
        vm.expectRevert(BilbyRouter.InvalidSignature.selector);
        router.setAutoSave(alice, true, 0, deadline, sig, none);
    }

    function test_breakToBalance() public {
        router.breakToBalance(alice, 300e6, _sharePermit(aliceKey, stata.previewWithdraw(300e6)));
        assertEq(ausd.balanceOf(alice), 400e6);
        assertEq(stata.maxWithdraw(alice), 600e6);
    }

    function test_addWithAuthorization() public {
        Auth memory a = _receiveAuth(aliceKey, address(router), 70e6, keccak256("add"));
        router.addWithAuthorization(alice, 70e6, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
        assertEq(ausd.balanceOf(alice), 30e6);
        assertEq(stata.maxWithdraw(alice), 970e6);
    }

    function test_burrowEarns() public {
        stata.accrue(90e6); // +10%
        assertApproxEqAbs(stata.maxWithdraw(alice), 990e6, 1);
    }

    function testFuzz_sweepNeverBelowThreshold(uint128 threshold, uint96 incoming) public {
        threshold = uint128(bound(threshold, 0, 2_000e6));
        incoming = uint96(bound(incoming, 0, 10_000e6));
        ausd.mint(alice, incoming);
        _enableAutoSave(threshold);
        uint256 balance = ausd.balanceOf(alice);
        uint256 burrowBefore = stata.maxWithdraw(alice);
        vm.prank(keeper);
        if (balance <= threshold) {
            vm.expectRevert(BilbyRouter.NothingToSweep.selector);
            router.sweep(alice);
            return;
        }
        router.sweep(alice);
        assertEq(ausd.balanceOf(alice), threshold);
        assertApproxEqAbs(stata.maxWithdraw(alice), burrowBefore + balance - threshold, 1);
        assertEq(ausd.balanceOf(address(router)), 0);
    }
}
