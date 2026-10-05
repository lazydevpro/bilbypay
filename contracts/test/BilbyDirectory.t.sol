// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {BilbyDirectory} from "../src/BilbyDirectory.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ConsentAccount {
    address immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recover(digest, signature) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract BilbyDirectoryTest is Base {
    function _expectBindFails(
        bytes4 reason,
        BilbyDirectory.BindRequest memory request,
        uint256 proofKey,
        uint256 destinationKey,
        uint256 controllerKey
    ) internal {
        bytes32 typehash = directory.BIND_TYPEHASH();
        bytes memory proof = _directorySignature(proofKey, typehash, request);
        bytes memory consent = _directorySignature(destinationKey, typehash, request);
        bytes memory controller =
            controllerKey == 0 ? bytes("") : _directorySignature(controllerKey, typehash, request);
        vm.expectRevert(reason);
        directory.bind(request, proof, consent, controller);
    }

    function _expectRecoveryFails(bytes4 reason, bytes32 phoneKey, uint256 key, bool finalize) internal {
        BilbyDirectory.BindRequest memory request = _bindRequest(phoneKey, vm.addr(key));
        bytes32 typehash =
            finalize ? directory.FINALIZE_RECOVERY_TYPEHASH() : directory.REQUEST_RECOVERY_TYPEHASH();
        bytes memory proof = _directorySignature(verifierKey, typehash, request);
        bytes memory consent = _directorySignature(key, typehash, request);
        vm.expectRevert(reason);
        if (finalize) directory.finalizeRecovery(request, proof, consent);
        else directory.requestRecovery(request, proof, consent);
    }

    function test_enrollmentRequiresDestinationConsentAndPhoneProof() public {
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, bob);
        _expectBindFails(BilbyDirectory.InvalidAttestation.selector, request, aliceKey, bobKey, 0);
        _expectBindFails(BilbyDirectory.InvalidAccountConsent.selector, request, verifierKey, aliceKey, 0);
        _bindPhone(PHONE_BOB, bobKey, 0);
        (address account, uint64 boundAt) = directory.resolve(PHONE_BOB);
        assertEq(account, bob);
        assertEq(boundAt, block.timestamp);
        BilbyDirectory.Binding memory b = directory.getBinding(PHONE_BOB);
        assertEq(b.revision, 1);
        assertEq(b.phoneEpoch, 0);
        assertEq(b.validUntil, block.timestamp + 30 days);
        assertEq(directory.phoneKeyOf(bob), PHONE_BOB);
    }

    function test_unknownPhoneHasNoHistory() public view {
        (address account, uint64 boundAt) = directory.resolve(PHONE_BOB);
        assertEq(account, address(0));
        assertEq(boundAt, 0);
        assertEq(directory.getBinding(PHONE_BOB).revision, 0);
    }

    function test_contractAccountConsentWorksWithERC1271() public {
        ConsentAccount account = new ConsentAccount(bob);
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, address(account));
        bytes32 typehash = directory.BIND_TYPEHASH();
        directory.bind(
            request,
            _directorySignature(verifierKey, typehash, request),
            _directorySignature(bobKey, typehash, request),
            ""
        );
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, address(account));
    }

    function test_rejectsExpiredFutureOrOverlongProofAndLease() public {
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, bob);
        request.deadline = block.timestamp - 1;
        _expectBindFails(BilbyDirectory.AttestationExpired.selector, request, verifierKey, bobKey, 0);
        request = _bindRequest(PHONE_BOB, bob);
        request.issuedAt = block.timestamp + 1;
        _expectBindFails(BilbyDirectory.StaleAttestation.selector, request, verifierKey, bobKey, 0);
        request = _bindRequest(PHONE_BOB, bob);
        request.deadline = block.timestamp + 16 minutes;
        _expectBindFails(BilbyDirectory.AttestationExpired.selector, request, verifierKey, bobKey, 0);
        request = _bindRequest(PHONE_BOB, bob);
        request.validUntil = block.timestamp + 366 days;
        _expectBindFails(BilbyDirectory.InvalidLease.selector, request, verifierKey, bobKey, 0);
        request.validUntil = block.timestamp;
        _expectBindFails(BilbyDirectory.InvalidLease.selector, request, verifierKey, bobKey, 0);
    }

    function test_replayAndTamperedPayloadFail() public {
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, bob);
        bytes32 typehash = directory.BIND_TYPEHASH();
        bytes memory proof = _directorySignature(verifierKey, typehash, request);
        bytes memory consent = _directorySignature(bobKey, typehash, request);
        request.account = alice;
        vm.expectRevert(BilbyDirectory.InvalidAttestation.selector);
        directory.bind(request, proof, consent, "");
        request.account = bob;
        directory.bind(request, proof, consent, "");
        vm.expectRevert(BilbyDirectory.RevisionMismatch.selector);
        directory.bind(request, proof, consent, "");
    }

    function test_oldControllerConsentRequiredForImmediateMove() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, alice);
        _expectBindFails(BilbyDirectory.InvalidControllerConsent.selector, request, verifierKey, aliceKey, 0);
        _expectBindFails(
            BilbyDirectory.InvalidControllerConsent.selector, request, verifierKey, aliceKey, aliceKey
        );
        _bindPhone(PHONE_BOB, aliceKey, bobKey);
        assertEq(directory.getBinding(PHONE_BOB).account, alice);
        assertEq(directory.getBinding(PHONE_BOB).phoneEpoch, 1);
        assertEq(directory.getBinding(PHONE_BOB).revision, 2);
        assertEq(directory.phoneKeyOf(bob), bytes32(0));
    }

    function test_expiryStopsResolutionButRetainsControllerAndRenewalKeepsEpoch() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyDirectory.Binding memory before_ = directory.getBinding(PHONE_BOB);
        vm.warp(before_.validUntil);
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, address(0));
        assertEq(directory.getBinding(PHONE_BOB).account, bob);
        _expectBindFails(
            BilbyDirectory.InvalidControllerConsent.selector,
            _bindRequest(PHONE_BOB, alice),
            verifierKey,
            aliceKey,
            0
        );
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyDirectory.Binding memory renewed = directory.getBinding(PHONE_BOB);
        assertEq(renewed.phoneEpoch, before_.phoneEpoch);
        assertEq(renewed.boundAt, before_.boundAt);
        assertEq(renewed.revision, before_.revision + 1);
    }

    function test_revokeInvalidatesEpochAndCannotBypassController() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        _revokePhone(PHONE_BOB, bobKey);
        BilbyDirectory.Binding memory b = directory.getBinding(PHONE_BOB);
        assertTrue(b.revoked);
        assertEq(b.account, bob);
        assertEq(b.phoneEpoch, 1);
        assertEq(b.revision, 2);
        assertEq(directory.phoneKeyOf(bob), bytes32(0));
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, address(0));
        _expectBindFails(
            BilbyDirectory.InvalidControllerConsent.selector,
            _bindRequest(PHONE_BOB, alice),
            verifierKey,
            aliceKey,
            0
        );
        _bindPhone(PHONE_BOB, bobKey, 0);
        assertFalse(directory.getBinding(PHONE_BOB).revoked);
        assertEq(directory.getBinding(PHONE_BOB).phoneEpoch, 1);
    }

    function test_changingNumberRevokesPreviousNumberAndPreservesHistory() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        _expectBindFails(
            BilbyDirectory.AccountAlreadyBound.selector,
            _bindRequest(PHONE_CAROL, bob),
            verifierKey,
            bobKey,
            0
        );
        _revokePhone(PHONE_BOB, bobKey);
        _bindPhone(PHONE_CAROL, bobKey, 0);
        BilbyDirectory.Binding memory old = directory.getBinding(PHONE_BOB);
        assertTrue(old.revoked);
        assertEq(old.account, bob);
        assertEq(old.phoneEpoch, 1);
        assertEq(old.revision, 2);
        assertEq(directory.phoneKeyOf(bob), PHONE_CAROL);
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, address(0));
    }

    function test_recoveryFreezesLookupAndCannotResetDelay() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        _requestRecovery(PHONE_BOB, aliceKey);
        BilbyDirectory.PendingChange memory pending = directory.getPendingChange(PHONE_BOB);
        assertEq(pending.account, alice);
        assertEq(pending.executableAt, block.timestamp + 7 days);
        assertEq(pending.expiresAt, block.timestamp + 14 days);
        assertEq(pending.expectedRevision, 2);
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, address(0));
        assertFalse(directory.isClaimable(PHONE_BOB, 0, bob));
        _expectRecoveryFails(BilbyDirectory.RecoveryPending.selector, PHONE_BOB, aliceKey, false);
        _expectRecoveryFails(BilbyDirectory.RecoveryPending.selector, PHONE_BOB, 0xC0FFEE, false);
        assertEq(directory.getPendingChange(PHONE_BOB).executableAt, pending.executableAt);
        _expectRecoveryFails(BilbyDirectory.RecoveryNotReady.selector, PHONE_BOB, aliceKey, true);
    }

    function test_recoveryNeedsFreshProofAndConsentAfterDelay() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        _requestRecovery(PHONE_BOB, aliceKey);
        uint256 readyAt = directory.getPendingChange(PHONE_BOB).executableAt;
        vm.warp(readyAt);
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, alice);
        request.issuedAt = readyAt - 1;
        bytes32 typehash = directory.FINALIZE_RECOVERY_TYPEHASH();
        bytes memory proof = _directorySignature(verifierKey, typehash, request);
        bytes memory consent = _directorySignature(aliceKey, typehash, request);
        vm.expectRevert(BilbyDirectory.StaleAttestation.selector);
        directory.finalizeRecovery(request, proof, consent);
        request = _bindRequest(PHONE_BOB, alice);
        proof = _directorySignature(verifierKey, typehash, request);
        consent = _directorySignature(bobKey, typehash, request);
        vm.expectRevert(BilbyDirectory.InvalidAccountConsent.selector);
        directory.finalizeRecovery(request, proof, consent);
        _finalizeRecovery(PHONE_BOB, aliceKey);
        assertEq(directory.getBinding(PHONE_BOB).account, alice);
        assertEq(directory.getBinding(PHONE_BOB).revision, 3);
        assertEq(directory.getBinding(PHONE_BOB).phoneEpoch, 1);
        assertEq(directory.getPendingChange(PHONE_BOB).account, address(0));
        assertEq(ausd.balanceOf(alice), 1_000e6);
        assertEq(ausd.balanceOf(bob), 0);
    }

    function test_expiredRecoveryRestoresLookupAndCanBeReplaced() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        _requestRecovery(PHONE_BOB, aliceKey);
        vm.warp(directory.getPendingChange(PHONE_BOB).expiresAt + 1);
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, bob);
        _expectRecoveryFails(BilbyDirectory.RecoveryExpired.selector, PHONE_BOB, aliceKey, true);
        _requestRecovery(PHONE_BOB, 0xC0FFEE);
        assertEq(directory.getPendingChange(PHONE_BOB).account, vm.addr(0xC0FFEE));
        assertEq(directory.getBinding(PHONE_BOB).revision, 3);
    }

    function test_bothControllerAndCandidateCanCancel() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        _requestRecovery(PHONE_BOB, aliceKey);
        _cancelRecovery(PHONE_BOB, bobKey);
        (address resolved,) = directory.resolve(PHONE_BOB);
        assertEq(resolved, bob);
        assertEq(directory.getBinding(PHONE_BOB).phoneEpoch, 0);
        _requestRecovery(PHONE_BOB, aliceKey);
        _cancelRecovery(PHONE_BOB, aliceKey);
        assertEq(directory.getPendingChange(PHONE_BOB).account, address(0));
        assertEq(directory.getBinding(PHONE_BOB).revision, 5);
    }

    function test_recoveryCannotTakeOtherAccountAndCannotReplayDifferentOperation() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        BilbyDirectory.BindRequest memory request = _bindRequest(PHONE_BOB, alice);
        bytes memory proof = _directorySignature(verifierKey, directory.BIND_TYPEHASH(), request);
        bytes memory consent = _directorySignature(aliceKey, directory.BIND_TYPEHASH(), request);
        vm.expectRevert(BilbyDirectory.InvalidAttestation.selector);
        directory.requestRecovery(request, proof, consent);
        _requestRecovery(PHONE_BOB, aliceKey);
        vm.warp(directory.getPendingChange(PHONE_BOB).executableAt);
        _expectRecoveryFails(BilbyDirectory.RecoveryAccountMismatch.selector, PHONE_BOB, 0xC0FFEE, true);
        _cancelRecovery(PHONE_BOB, bobKey);
        _expectRecoveryFails(BilbyDirectory.NoPendingRecovery.selector, PHONE_BOB, aliceKey, true);
    }

    function test_controlSignatureRequiresControllerRevisionAndUnexpiredDeadline() public {
        _bindPhone(PHONE_BOB, bobKey, 0);
        uint256 deadline = block.timestamp + 300;
        bytes32 typehash = directory.REVOKE_TYPEHASH();
        bytes memory invalid = _controlSignature(aliceKey, typehash, PHONE_BOB, 1, deadline);
        vm.expectRevert(BilbyDirectory.InvalidControllerConsent.selector);
        directory.revoke(PHONE_BOB, 1, deadline, invalid);
        bytes memory valid = _controlSignature(bobKey, typehash, PHONE_BOB, 1, deadline);
        directory.revoke(PHONE_BOB, 1, deadline, valid);
        vm.expectRevert(BilbyDirectory.RevisionMismatch.selector);
        directory.revoke(PHONE_BOB, 1, deadline, valid);
        vm.warp(deadline + 1);
        vm.expectRevert(BilbyDirectory.AttestationExpired.selector);
        directory.revoke(PHONE_BOB, 2, deadline, valid);
    }

    function test_onlyOwnerChangesVerifier() public {
        vm.expectRevert();
        directory.setVerifier(alice);
        vm.prank(owner);
        directory.setVerifier(alice);
        assertEq(directory.verifier(), alice);
    }
}
