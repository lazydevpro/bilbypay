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

/// Local dev chain (anvil --chain-id 143): mocks for AUSD and stataAUSD + the three contracts.
/// Env: VERIFIER, TREASURY, KEEPER. Writes deployments/local-v2.json.
contract DeployLocal is Script {
    function run() external {
        address verifier = vm.envAddress("VERIFIER");
        address treasury = vm.envAddress("TREASURY");
        address keeper = vm.envAddress("KEEPER");
        vm.startBroadcast();
        address owner = msg.sender;
        MockAUSD ausd = new MockAUSD();
        MockStata stata = new MockStata(ausd);
        BilbyDirectory directory = new BilbyDirectory(owner, verifier);
        BilbyEscrow escrow = new BilbyEscrow(IERC20(address(ausd)), directory, owner, verifier, treasury);
        BilbyRouter router =
            new BilbyRouter(IERC20(address(ausd)), IERC4626(address(stata)), address(escrow), owner);
        router.setKeeper(keeper, true);
        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "ausd", address(ausd));
        vm.serializeAddress(json, "stata", address(stata));
        vm.serializeAddress(json, "directory", address(directory));
        vm.serializeAddress(json, "escrow", address(escrow));
        string memory out = vm.serializeAddress(json, "router", address(router));
        vm.writeJson(out, "deployments/local-v2.json");
        console.log(out);
    }
}
