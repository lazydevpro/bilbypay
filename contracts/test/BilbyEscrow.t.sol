// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {BilbyEscrow} from "../src/BilbyEscrow.sol";

contract BilbyEscrowTest is Base {
    bytes32 constant SALT = keccak256("salt-1");
    bytes32 constant GIFT_ID = keccak256("gift-1");

    function _transferTerms() internal view returns (BilbyEscrow.Terms memory) {
        return _terms(PHONE_BOB, BilbyEscrow.Kind.TRANSFER, bytes32(0), SALT);
    }

    function test_depositPullsFundsAndRecordsTerms() public {
        BilbyEscrow.Terms memory t = _transferTerms();
        bytes32 id = _deposit(aliceKey, 20e6, t);
        assertEq(id, escrow.depositIdOf(alice, escrow.termsNonce(t)));
        assertEq(ausd.balanceOf(address(escrow)), 20e6);
        assertEq(ausd.balanceOf(alice), 980e6);
        BilbyEscrow.Deposit memory d = escrow.getDeposit(id);
        assertEq(d.sender, alice);
        assertEq(d.amount, 20e6);
        assertEq(d.phoneKey, PHONE_BOB);
        assertEq(uint8(d.status), uint8(BilbyEscrow.Status.Pending));
        assertEq(alice.balance, 0);
    }

    /// Someone who sees Alice's signature can't redirect the deposit to their own number.
    function test_frontRunWithOtherTermsFails() public {
        BilbyEscrow.Terms memory t = _transferTerms();
        Auth memory a = _receiveAuth(aliceKey, address(escrow), 20e6, escrow.termsNonce(t));
        BilbyEscrow.Terms memory evil = _terms(PHONE_CAROL, BilbyEscrow.Kind.TRANSFER, bytes32(0), SALT);
        vm.expectRevert("invalid signature");
        escrow.depositWithAuthorization(alice, 20e6, a.validAfter, a.validBefore, evil, a.v, a.r, a.s);
    }

    function test_rejectsBadExpiryAndGiftMismatch() public {
        BilbyEscrow.Terms memory t = _transferTerms();
        t.expiry = uint40(block.timestamp + 10 minutes);
        Auth memory a = _receiveAuth(aliceKey, address(escrow), 1e6, escrow.termsNonce(t));
        vm.expectRevert(BilbyEscrow.InvalidTerms.selector);
        escrow.depositWithAuthorization(alice, 1e6, a.validAfter, a.validBefore, t, a.v, a.r, a.s);

        t = _terms(PHONE_BOB, BilbyEscrow.Kind.GIFT, bytes32(0), SALT);
        a = _receiveAuth(aliceKey, address(escrow), 1e6, escrow.termsNonce(t));
        vm.expectRevert(BilbyEscrow.InvalidTerms.selector);
        escrow.depositWithAuthorization(alice, 1e6, a.validAfter, a.validBefore, t, a.v, a.r, a.s);
    }

    function test_claimTransferPaysRecipient() public {
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        bytes memory att = _claimAttestation(id, PHONE_BOB, bob, deadline);
        vm.prank(relayer);
        escrow.claim(id, bob, deadline, att);
        assertEq(ausd.balanceOf(bob), 20e6);
        assertEq(uint8(escrow.getDeposit(id).status), uint8(BilbyEscrow.Status.Claimed));
    }

    function test_claimGiftPaysTreasury() public {
        bytes32 id = _deposit(aliceKey, 25e6, _terms(PHONE_BOB, BilbyEscrow.Kind.GIFT, GIFT_ID, SALT));
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        escrow.claim(id, bob, deadline, _claimAttestation(id, PHONE_BOB, bob, deadline));
        assertEq(ausd.balanceOf(treasury), 25e6);
        assertEq(ausd.balanceOf(bob), 0);
    }

    function test_claimRejectsWrongRecipientOrPhone() public {
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        bytes memory forBob = _claimAttestation(id, PHONE_BOB, bob, deadline);
        vm.expectRevert(BilbyEscrow.InvalidSignature.selector);
        escrow.claim(id, alice, deadline, forBob);
        bytes memory wrongPhone = _claimAttestation(id, PHONE_CAROL, bob, deadline);
        vm.expectRevert(BilbyEscrow.InvalidSignature.selector);
        escrow.claim(id, bob, deadline, wrongPhone);
    }

    function test_cannotClaimTwice() public {
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        bytes memory att = _claimAttestation(id, PHONE_BOB, bob, deadline);
        escrow.claim(id, bob, deadline, att);
        vm.expectRevert(BilbyEscrow.NotPending.selector);
        escrow.claim(id, bob, deadline, att);
    }

    function test_refundOnlyAfterExpiry() public {
        BilbyEscrow.Terms memory t = _transferTerms();
        bytes32 id = _deposit(aliceKey, 20e6, t);
        vm.expectRevert(BilbyEscrow.NotExpired.selector);
        escrow.refund(id);
        vm.warp(t.expiry);
        escrow.refund(id);
        assertEq(ausd.balanceOf(alice), 1_000e6);
        uint256 deadline = block.timestamp + 300;
        bytes memory att = _claimAttestation(id, PHONE_BOB, bob, deadline);
        vm.expectRevert(BilbyEscrow.NotPending.selector);
        escrow.claim(id, bob, deadline, att);
    }

    function test_senderCanCancel() public {
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        uint256 deadline = block.timestamp + 300;
        bytes32 structHash = keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), id, deadline));
        bytes memory bobSig = _sigBytes(bobKey, _digest(escrow.domainSeparator(), structHash));
        vm.expectRevert(BilbyEscrow.InvalidSignature.selector);
        escrow.cancel(id, deadline, bobSig);
        escrow.cancel(id, deadline, _sigBytes(aliceKey, _digest(escrow.domainSeparator(), structHash)));
        assertEq(ausd.balanceOf(alice), 1_000e6);
        assertEq(uint8(escrow.getDeposit(id).status), uint8(BilbyEscrow.Status.Cancelled));
    }

    function test_sameTermsTwiceReverts() public {
        _deposit(aliceKey, 1e6, _transferTerms());
        BilbyEscrow.Terms memory t = _transferTerms();
        Auth memory a = _receiveAuth(aliceKey, address(escrow), 1e6, escrow.termsNonce(t));
        vm.expectRevert(BilbyEscrow.DepositExists.selector);
        escrow.depositWithAuthorization(alice, 1e6, a.validAfter, a.validBefore, t, a.v, a.r, a.s);
    }

    function testFuzz_depositClaimConservesFunds(uint96 amount, bytes32 salt) public {
        amount = uint96(bound(amount, 1, 1_000e6));
        bytes32 id =
            _deposit(aliceKey, amount, _terms(PHONE_BOB, BilbyEscrow.Kind.TRANSFER, bytes32(0), salt));
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        escrow.claim(id, bob, deadline, _claimAttestation(id, PHONE_BOB, bob, deadline));
        assertEq(ausd.balanceOf(bob) + ausd.balanceOf(alice), 1_000e6);
        assertEq(ausd.balanceOf(address(escrow)), 0);
    }

    function _expectClaimFails(bytes4 reason, bytes32 id, address recipient) internal {
        uint256 deadline = block.timestamp + 300;
        bytes memory attestation = _claimAttestation(id, PHONE_BOB, recipient, deadline);
        vm.expectRevert(reason);
        escrow.claim(id, recipient, deadline, attestation);
    }

    function _expectDepositFails(bytes4 reason, BilbyEscrow.Terms memory terms) internal {
        Auth memory a = _receiveAuth(aliceKey, address(escrow), 20e6, escrow.termsNonce(terms));
        vm.expectRevert(reason);
        escrow.depositWithAuthorization(alice, 20e6, a.validAfter, a.validBefore, terms, a.v, a.r, a.s);
    }

    function test_verifierCannotRedirectClaimAwayFromEnrolledRecipient() public {
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _expectClaimFails(BilbyEscrow.RecipientUnavailable.selector, id, bob);
        _bindPhone(PHONE_BOB, bobKey, 0);
        _expectClaimFails(BilbyEscrow.RecipientUnavailable.selector, id, alice);
        assertEq(escrow.getDeposit(id).phoneEpoch, 0);
    }

    function test_reassignmentRejectsBothOldAndNewClaimantAndRefundsBeforeExpiry() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _bindPhone(PHONE_BOB, aliceKey, bobKey);
        _expectClaimFails(BilbyEscrow.PhoneEpochMismatch.selector, id, bob);
        _expectClaimFails(BilbyEscrow.PhoneEpochMismatch.selector, id, alice);
        vm.prank(bob);
        escrow.refund(id);
        assertEq(ausd.balanceOf(alice), 1_000e6);
        assertEq(ausd.balanceOf(bob), 0);
        assertEq(uint8(escrow.getDeposit(id).status), uint8(BilbyEscrow.Status.Refunded));
    }

    function test_recoveryPendingFreezesClaimsUntilCancelled() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _requestRecovery(PHONE_BOB, aliceKey);
        _expectClaimFails(BilbyEscrow.RecipientUnavailable.selector, id, bob);
        _expectClaimFails(BilbyEscrow.RecipientUnavailable.selector, id, alice);
        _expectDepositFails(BilbyEscrow.RecipientUnavailable.selector, _transferTerms());
        _cancelRecovery(PHONE_BOB, bobKey);
        uint256 deadline = block.timestamp + 300;
        escrow.claim(id, bob, deadline, _claimAttestation(id, PHONE_BOB, bob, deadline));
        assertEq(ausd.balanceOf(bob), 20e6);
    }

    function test_recoveryCannotUnlockPriorPaymentsOrAccountBalance() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        ausd.mint(bob, 75e6);
        BilbyEscrow.Terms memory terms = _transferTerms();
        terms.expiry = uint40(block.timestamp + 30 days);
        bytes32 id = _deposit(aliceKey, 20e6, terms);
        _requestRecovery(PHONE_BOB, aliceKey);
        vm.warp(directory.getPendingChange(PHONE_BOB).executableAt);
        _finalizeRecovery(PHONE_BOB, aliceKey);
        _expectClaimFails(BilbyEscrow.PhoneEpochMismatch.selector, id, alice);
        assertEq(ausd.balanceOf(bob), 75e6);
        assertEq(ausd.balanceOf(alice), 980e6);
        escrow.refund(id);
        assertEq(ausd.balanceOf(alice), 1_000e6);
        assertEq(ausd.balanceOf(bob), 75e6);
    }

    function test_revocationPermanentlyInvalidatesOlderClaimsEvenAfterReenrollment() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        bytes32 id = _deposit(aliceKey, 20e6, _transferTerms());
        _revokePhone(PHONE_BOB, bobKey);
        _expectClaimFails(BilbyEscrow.PhoneEpochMismatch.selector, id, bob);
        _expectDepositFails(BilbyEscrow.RecipientUnavailable.selector, _transferTerms());
        _bindPhone(PHONE_BOB, bobKey, 0);
        _expectClaimFails(BilbyEscrow.PhoneEpochMismatch.selector, id, bob);
        escrow.refund(id);
        assertEq(ausd.balanceOf(alice), 1_000e6);
    }

    function test_newEpochCanReceiveNewPaymentsButCannotReuseOldAuthorization() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyEscrow.Terms memory oldTerms = _transferTerms();
        Auth memory oldAuth = _receiveAuth(aliceKey, address(escrow), 20e6, escrow.termsNonce(oldTerms));
        _bindPhone(PHONE_BOB, aliceKey, bobKey);
        vm.expectRevert(BilbyEscrow.PhoneEpochMismatch.selector);
        escrow.depositWithAuthorization(
            alice, 20e6, oldAuth.validAfter, oldAuth.validBefore, oldTerms, oldAuth.v, oldAuth.r, oldAuth.s
        );
        BilbyEscrow.Terms memory newTerms = _transferTerms();
        assertEq(newTerms.phoneEpoch, 1);
        assertNotEq(escrow.termsNonce(oldTerms), escrow.termsNonce(newTerms));
        vm.expectRevert("invalid signature");
        escrow.depositWithAuthorization(
            alice, 20e6, oldAuth.validAfter, oldAuth.validBefore, newTerms, oldAuth.v, oldAuth.r, oldAuth.s
        );
        bytes32 id = _deposit(aliceKey, 20e6, newTerms);
        uint256 deadline = block.timestamp + 300;
        escrow.claim(id, alice, deadline, _claimAttestation(id, PHONE_BOB, alice, deadline));
        assertEq(ausd.balanceOf(alice), 1_000e6);
    }

    function test_expiredDepositCannotBeClaimedEvenBeforeRefund() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyEscrow.Terms memory terms = _transferTerms();
        bytes32 id = _deposit(aliceKey, 20e6, terms);
        vm.warp(terms.expiry);
        _expectClaimFails(BilbyEscrow.ClaimExpired.selector, id, bob);
        escrow.refund(id);
        assertEq(ausd.balanceOf(alice), 1_000e6);
    }

    function test_expiredPhoneLeaseFreezesClaimsAndDepositsButRenewalKeepsOwnership() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyEscrow.Terms memory terms = _transferTerms();
        terms.expiry = uint40(block.timestamp + 60 days);
        bytes32 id = _deposit(aliceKey, 20e6, terms);
        vm.warp(directory.getBinding(PHONE_BOB).validUntil);
        _expectClaimFails(BilbyEscrow.RecipientUnavailable.selector, id, bob);
        _expectDepositFails(BilbyEscrow.RecipientUnavailable.selector, _transferTerms());
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        escrow.claim(id, bob, deadline, _claimAttestation(id, PHONE_BOB, bob, deadline));
        assertEq(ausd.balanceOf(bob), 20e6);
    }
}
