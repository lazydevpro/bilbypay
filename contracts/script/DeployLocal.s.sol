// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyDirectory} from "../src/BilbyDirectory.sol";
import {BilbyEscrow} from "../src/BilbyEscrow.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {MockAUSD} from "../test/mocks/MockAUSD.sol";
import {MockStata} from "../test/mocks/MockStata.sol";

/// Demo deployment with mocks: MockAUSD (anyone can mint — test dollars), MockStata (Burrow without
/// Aave), a second MockAUSD standing in for USDC (top-up deliveries), and the three contracts.
/// Used for local anvil and Monad testnet (which has no Aave). Never deploy this to mainnet.
/// Env: VERIFIER, TREASURY, KEEPER; OUT (default deployments/local.json).
contract DeployLocal is Script {
    function run() external {
        address verifier = vm.envAddress("VERIFIER");
        address treasury = vm.envAddress("TREASURY");
        address keeper = vm.envAddress("KEEPER");
        // Real Monad mainnet has AUSD here; a local anvil posing as chain 143 does not.
        require(address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a).code.length == 0, "mocks: not for mainnet");
        vm.startBroadcast();
        address owner = msg.sender;
        MockAUSD ausd = new MockAUSD();
        MockStata stata = new MockStata(ausd);
        MockAUSD usdc = new MockAUSD();
        BilbyDirectory directory = new BilbyDirectory(owner, verifier);
        BilbyEscrow escrow = new BilbyEscrow(IERC20(address(ausd)), owner, verifier, treasury);
        BilbyRouter router = new BilbyRouter(IERC20(address(ausd)), IERC4626(address(stata)), address(escrow), owner);
        router.setKeeper(keeper, true);
        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "ausd", address(ausd));
        vm.serializeAddress(json, "stata", address(stata));
        vm.serializeAddress(json, "usdc", address(usdc));
        vm.serializeAddress(json, "directory", address(directory));
        vm.serializeAddress(json, "escrow", address(escrow));
        string memory out = vm.serializeAddress(json, "router", address(router));
        vm.writeJson(out, vm.envOr("OUT", string("deployments/local.json")));
        console.log(out);
    }
}
