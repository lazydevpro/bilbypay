// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./Base.t.sol";
import {BilbyDirectory} from "../src/BilbyDirectory.sol";

contract BilbyDirectoryTest is Base {
    function _bind(bytes32 phoneKey, address account, uint256 issuedAt) internal {
        uint256 deadline = block.timestamp + 300;
        directory.bind(phoneKey, account, issuedAt, deadline, _bindAttestation(phoneKey, account, issuedAt, deadline));
    }

    function test_bindAndResolve() public {
        vm.expectEmit(address(directory));
        emit BilbyDirectory.Bound(PHONE_BOB, bob, address(0));
        _bind(PHONE_BOB, bob, 1);
        (address account, uint64 boundAt) = directory.resolve(PHONE_BOB);
        assertEq(account, bob);
        assertEq(boundAt, block.timestamp);
        assertEq(directory.phoneKeyOf(bob), PHONE_BOB);
    }

    function test_unknownNumberResolvesToZero() public view {
        (address account, uint64 boundAt) = directory.resolve(PHONE_CAROL);
        assertEq(account, address(0));
        assertEq(boundAt, 0);
    }

    function test_rejectsNonVerifierSignature() public {
        uint256 deadline = block.timestamp + 300;
        bytes32 structHash = keccak256(abi.encode(directory.BIND_TYPEHASH(), PHONE_BOB, alice, 1, deadline));
        bytes memory sig = _sigBytes(aliceKey, _digest(directory.domainSeparator(), structHash));
        vm.expectRevert(BilbyDirectory.InvalidAttestation.selector);
        directory.bind(PHONE_BOB, alice, 1, deadline, sig);
    }

    function test_rejectsTamperedAccount() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _bindAttestation(PHONE_BOB, bob, 1, deadline);
        vm.expectRevert(BilbyDirectory.InvalidAttestation.selector);
        directory.bind(PHONE_BOB, alice, 1, deadline, sig);
    }

    function test_rejectsExpired() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _bindAttestation(PHONE_BOB, bob, 1, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(BilbyDirectory.AttestationExpired.selector);
        directory.bind(PHONE_BOB, bob, 1, deadline, sig);
    }

    function test_oldAttestationCannotUndoRebind() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory oldSig = _bindAttestation(PHONE_BOB, bob, 1, deadline);
        directory.bind(PHONE_BOB, bob, 1, deadline, oldSig);
        _bind(PHONE_BOB, alice, 2); // number recycled to alice
        vm.expectRevert(BilbyDirectory.StaleAttestation.selector);
        directory.bind(PHONE_BOB, bob, 1, deadline, oldSig);
    }

    function test_rebindMovesNumberAndClearsOldAccount() public {
        _bind(PHONE_BOB, bob, 1);
        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(address(directory));
        emit BilbyDirectory.Bound(PHONE_BOB, alice, bob);
        _bind(PHONE_BOB, alice, 2);
        (address account, uint64 boundAt) = directory.resolve(PHONE_BOB);
        assertEq(account, alice);
        assertEq(boundAt, block.timestamp);
        assertEq(directory.phoneKeyOf(bob), bytes32(0));
    }

    function test_accountChangingNumberUnbindsOldNumber() public {
        _bind(PHONE_BOB, bob, 1);
        _bind(PHONE_CAROL, bob, 1);
        (address oldAccount,) = directory.resolve(PHONE_BOB);
        (address newAccount,) = directory.resolve(PHONE_CAROL);
        assertEq(oldAccount, address(0));
        assertEq(newAccount, bob);
        assertEq(directory.phoneKeyOf(bob), PHONE_CAROL);
    }

    function test_rejectsNoopRebind() public {
        _bind(PHONE_BOB, bob, 1);
        uint256 deadline = block.timestamp + 300;
        bytes memory sig = _bindAttestation(PHONE_BOB, bob, 2, deadline);
        vm.expectRevert(BilbyDirectory.AlreadyBound.selector);
        directory.bind(PHONE_BOB, bob, 2, deadline, sig);
    }

    function test_onlyOwnerSetsVerifier() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        directory.setVerifier(alice);
        vm.prank(owner);
        directory.setVerifier(alice);
        assertEq(directory.verifier(), alice);
    }
}
