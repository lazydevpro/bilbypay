// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyEscrow} from "../src/BilbyEscrow.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {IERC3009} from "../src/interfaces/IERC3009.sol";

/// Break-and-pay against the real AUSD and Aave stataAUSD on Monad mainnet.
/// Runs only with MONAD_RPC_URL set:  MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc ForkTest
contract ForkTest is Test {
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    IERC4626 constant STATA = IERC4626(0x9e1AcC5BFbf34e2E579763cE14042d957719fE76);
    bytes32 constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 aliceKey = 0xA11CE;
    address alice;
    BilbyRouter router;

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        alice = vm.addr(aliceKey);
        BilbyEscrow escrow = new BilbyEscrow(AUSD, address(this), address(this), address(this));
        router = new BilbyRouter(AUSD, STATA, address(escrow), address(this));
        deal(address(AUSD), alice, 100e6);
        vm.startPrank(alice);
        AUSD.approve(address(STATA), 60e6);
        STATA.deposit(60e6, alice);
        vm.stopPrank();
    }

    function _digest(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function test_fork_breakAndPay() public {
        address bob = makeAddr("bob");
        uint256 shortfall = 30e6; // balance 40, pay 70
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = keccak256("fork-pay");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            aliceKey,
            _digest(
                IERC20Permit(address(AUSD)).DOMAIN_SEPARATOR(),
                keccak256(abi.encode(TRANSFER_TYPEHASH, alice, bob, 70e6, 0, validBefore, nonce))
            )
        );
        bytes memory pay =
            abi.encodeCall(IERC3009.transferWithAuthorization, (alice, bob, 70e6, 0, validBefore, nonce, v, r, s));

        BilbyRouter.Permit memory p;
        p.value = STATA.previewWithdraw(shortfall) + 1;
        p.deadline = validBefore;
        (p.v, p.r, p.s) = vm.sign(
            aliceKey,
            _digest(
                IERC20Permit(address(STATA)).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        PERMIT_TYPEHASH, alice, address(router), p.value, IERC20Permit(address(STATA)).nonces(alice), p.deadline
                    )
                )
            )
        );
        router.topUpAndCall(alice, shortfall, p, address(AUSD), pay);
        assertEq(AUSD.balanceOf(bob), 70e6);
        assertEq(AUSD.balanceOf(alice), 0);
        assertEq(alice.balance, 0);
    }
}
