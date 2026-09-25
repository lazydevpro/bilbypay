// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// Phase 0 check: a relayer can move AUSD for an account that holds zero native gas,
/// using only an EIP-3009 signature from that account.
contract MockAUSDTest is Test {
    MockAUSD token;
    uint256 senderKey = 0xA11CE;
    address sender;
    address recipient = makeAddr("recipient");
    address relayer = makeAddr("relayer");

    function setUp() public {
        vm.chainId(143);
        token = new MockAUSD();
        sender = vm.addr(senderKey);
        token.mint(sender, 100e6);
        vm.deal(relayer, 20 ether);
    }

    function _sign(bytes32 typehash, address to, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(typehash, sender, to, value, 0, validBefore, nonce));
        return vm.sign(senderKey, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_domainMatchesMainnetAUSD() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            token.eip712Domain();
        assertEq(name, "Agora Dollar");
        assertEq(version, "1");
        assertEq(chainId, 143);
        assertEq(verifyingContract, address(token));
    }

    function test_relayedTransferFromZeroGasAccount() public {
        assertEq(sender.balance, 0);
        bytes32 nonce = keccak256("n1");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), recipient, 20e6, validBefore, nonce);

        vm.prank(relayer);
        token.transferWithAuthorization(sender, recipient, 20e6, 0, validBefore, nonce, v, r, s);

        assertEq(token.balanceOf(recipient), 20e6);
        assertEq(token.balanceOf(sender), 80e6);
        assertEq(sender.balance, 0);
        assertTrue(token.authorizationState(sender, nonce));
    }

    function test_replayReverts() public {
        bytes32 nonce = keccak256("n1");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), recipient, 1e6, validBefore, nonce);
        token.transferWithAuthorization(sender, recipient, 1e6, 0, validBefore, nonce, v, r, s);
        vm.expectRevert("authorization is used");
        token.transferWithAuthorization(sender, recipient, 1e6, 0, validBefore, nonce, v, r, s);
    }

    function test_tamperedAmountReverts() public {
        bytes32 nonce = keccak256("n1");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), recipient, 1e6, validBefore, nonce);
        vm.expectRevert("invalid signature");
        token.transferWithAuthorization(sender, recipient, 2e6, 0, validBefore, nonce, v, r, s);
    }

    function test_expiredReverts() public {
        bytes32 nonce = keccak256("n1");
        uint256 validBefore = block.timestamp + 10;
        (uint8 v, bytes32 r, bytes32 s) =
            _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), recipient, 1e6, validBefore, nonce);
        vm.warp(validBefore);
        vm.expectRevert("authorization is expired");
        token.transferWithAuthorization(sender, recipient, 1e6, 0, validBefore, nonce, v, r, s);
    }

    function test_receiveWithAuthorizationOnlyByPayee() public {
        bytes32 nonce = keccak256("n1");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _sign(token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), recipient, 5e6, validBefore, nonce);
        vm.prank(relayer);
        vm.expectRevert("caller must be the payee");
        token.receiveWithAuthorization(sender, recipient, 5e6, 0, validBefore, nonce, v, r, s);
        vm.prank(recipient);
        token.receiveWithAuthorization(sender, recipient, 5e6, 0, validBefore, nonce, v, r, s);
        assertEq(token.balanceOf(recipient), 5e6);
    }
}
