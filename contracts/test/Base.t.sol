// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyDirectory} from "../src/BilbyDirectory.sol";
import {BilbyEscrow} from "../src/BilbyEscrow.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {MockStata} from "./mocks/MockStata.sol";

abstract contract Base is Test {
    MockAUSD ausd;
    MockStata stata;
    BilbyDirectory directory;
    BilbyEscrow escrow;
    BilbyRouter router;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address keeper = makeAddr("keeper");
    address relayer = makeAddr("relayer");
    uint256 verifierKey = 0x7E41F1E4;
    address verifier;
    uint256 aliceKey = 0xA11CE;
    address alice;
    uint256 bobKey = 0xB0B;
    address bob;

    bytes32 constant PHONE_BOB = keccak256("hmac(+61400000000)");
    bytes32 constant PHONE_CAROL = keccak256("hmac(+919800000000)");

    function setUp() public virtual {
        vm.chainId(143);
        vm.warp(1_790_000_000);
        verifier = vm.addr(verifierKey);
        alice = vm.addr(aliceKey);
        bob = vm.addr(bobKey);
        ausd = new MockAUSD();
        stata = new MockStata(ausd);
        directory = new BilbyDirectory(owner, verifier);
        escrow = new BilbyEscrow(IERC20(address(ausd)), owner, verifier, treasury);
        router = new BilbyRouter(IERC20(address(ausd)), IERC4626(address(stata)), address(escrow), owner);
        vm.prank(owner);
        router.setKeeper(keeper, true);
        ausd.mint(alice, 1_000e6);
    }

    // ------------------------------------------------------------ signing

    function _digest(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sigBytes(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    struct Auth {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    function _auth(uint256 key, bytes32 typehash, address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (Auth memory a)
    {
        a.from = vm.addr(key);
        a.to = to;
        a.value = value;
        a.validAfter = block.timestamp - 60;
        a.validBefore = block.timestamp + 600;
        a.nonce = nonce;
        bytes32 structHash =
            keccak256(abi.encode(typehash, a.from, to, value, a.validAfter, a.validBefore, nonce));
        (a.v, a.r, a.s) = vm.sign(key, _digest(ausd.DOMAIN_SEPARATOR(), structHash));
    }

    function _transferAuth(uint256 key, address to, uint256 value, bytes32 nonce) internal view returns (Auth memory) {
        return _auth(key, ausd.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), to, value, nonce);
    }

    function _receiveAuth(uint256 key, address to, uint256 value, bytes32 nonce) internal view returns (Auth memory) {
        return _auth(key, ausd.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), to, value, nonce);
    }

    function _terms(bytes32 phoneKey, BilbyEscrow.Kind kind, bytes32 giftId, bytes32 salt)
        internal
        view
        returns (BilbyEscrow.Terms memory)
    {
        return BilbyEscrow.Terms({
            phoneKey: phoneKey, expiry: uint40(block.timestamp + 7 days), kind: kind, giftId: giftId, salt: salt
        });
    }

    function _deposit(uint256 key, uint256 amount, BilbyEscrow.Terms memory t) internal returns (bytes32) {
        Auth memory a = _receiveAuth(key, address(escrow), amount, escrow.termsNonce(t));
        vm.prank(relayer);
        return escrow.depositWithAuthorization(a.from, amount, a.validAfter, a.validBefore, t, a.v, a.r, a.s);
    }

    function _claimAttestation(bytes32 depositId, bytes32 phoneKey, address recipient, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(escrow.CLAIM_TYPEHASH(), depositId, phoneKey, recipient, deadline));
        return _sigBytes(verifierKey, _digest(escrow.domainSeparator(), structHash));
    }

    function _bindAttestation(bytes32 phoneKey, address account, uint256 issuedAt, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(directory.BIND_TYPEHASH(), phoneKey, account, issuedAt, deadline));
        return _sigBytes(verifierKey, _digest(directory.domainSeparator(), structHash));
    }

    function _permit(uint256 key, address token, bytes32 domainSeparator, address spender, uint256 value, uint256 nonce)
        internal
        view
        returns (BilbyRouter.Permit memory p)
    {
        p.value = value;
        p.deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                vm.addr(key),
                spender,
                value,
                nonce,
                p.deadline
            )
        );
        (p.v, p.r, p.s) = vm.sign(key, _digest(domainSeparator, structHash));
        token; // silence unused warning
    }

    function _sharePermit(uint256 key, uint256 shares) internal view returns (BilbyRouter.Permit memory) {
        return _permit(key, address(stata), stata.DOMAIN_SEPARATOR(), address(router), shares, stata.nonces(vm.addr(key)));
    }

    function _ausdPermit(uint256 key, uint256 value) internal view returns (BilbyRouter.Permit memory) {
        return _permit(key, address(ausd), ausd.DOMAIN_SEPARATOR(), address(router), value, ausd.nonces(vm.addr(key)));
    }

    function _autoSaveSig(uint256 key, bool enabled, uint256 threshold, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        address user = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(router.SET_AUTOSAVE_TYPEHASH(), user, enabled, threshold, router.nonces(user), deadline)
        );
        return _sigBytes(key, _digest(router.domainSeparator(), structHash));
    }
}
