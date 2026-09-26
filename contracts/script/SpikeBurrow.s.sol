// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";
import {SigUtils} from "../test/utils/SigUtils.sol";

/// @notice End-to-end Burrow spike on testnet. The USER never holds MON and never sends a transaction: they only
///         sign (what the app does with one Face ID). The RELAYER submits and pays for everything.
///   1. mint $140 test dollars to the user
///   2. user signs "keep $40, auto-save the rest" → relayer sets it
///   3. keeper sweeps $100 into Burrow
///   4. user pays $100 with only $40 in balance → relayer runs break-and-pay in ONE transaction
/// forge script script/SpikeBurrow.s.sol --rpc-url monad_testnet --broadcast
contract SpikeBurrow is Script {
    uint256 constant USD = 1e6;

    uint256 relayerPk;
    uint256 userPk;
    address user;
    address payee;
    MockAUSD dollar;
    IERC4626 vault;
    BilbyRouter router;

    function run() external {
        relayerPk = vm.envUint("RELAYER_PK");
        userPk = vm.envUint("SPIKE_USER_PK");
        user = vm.addr(userPk);
        payee = vm.envOr("SPIKE_PAYEE", address(0xB0B));

        string memory json = vm.readFile("./deployments/monad-testnet.json");
        dollar = MockAUSD(vm.parseJsonAddress(json, ".dollar"));
        vault = IERC4626(vm.parseJsonAddress(json, ".burrowVault"));
        router = BilbyRouter(vm.parseJsonAddress(json, ".router"));

        _enableAutoSaveAndSweep();
        _log("after sweep");
        _payMoreThanBalance(100 * USD);
        _log("after pay  ");
        console.log("payee received $", dollar.balanceOf(payee) / USD);
        console.log("user MON balance (wei):", user.balance);
    }

    function _enableAutoSaveAndSweep() internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory autoSig = SigUtils.autoSave(userPk, router, true, 40 * USD, router.nonces(user), deadline);
        BilbyRouter.PermitSig memory dollarPermit =
            SigUtils.permit(userPk, address(dollar), address(router), type(uint256).max, deadline);

        vm.startBroadcast(relayerPk);
        dollar.mint(user, 140 * USD);
        router.setAutoSave(user, true, 40 * USD, deadline, autoSig, dollarPermit);
        router.sweep(user);
        vm.stopBroadcast();
    }

    function _payMoreThanBalance(uint256 amount) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 shortfall = amount - dollar.balanceOf(user);
        bytes memory pay = SigUtils.transferWithAuthorization(
            userPk, address(dollar), payee, amount, deadline, keccak256(abi.encode("spike", block.timestamp))
        );
        BilbyRouter.PermitSig memory sharePermit =
            SigUtils.permit(userPk, address(vault), address(router), vault.previewWithdraw(shortfall), deadline);

        vm.startBroadcast(relayerPk);
        router.topUpAndCall(user, shortfall, sharePermit, address(dollar), pay);
        vm.stopBroadcast();
    }

    function _log(string memory label) internal view {
        console.log(label, "balance $", dollar.balanceOf(user) / USD);
        console.log(label, "burrow  $", vault.convertToAssets(vault.balanceOf(user)) / USD);
    }
}
