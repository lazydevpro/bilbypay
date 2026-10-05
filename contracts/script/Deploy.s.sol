// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyDirectory} from "../src/BilbyDirectory.sol";
import {BilbyEscrow} from "../src/BilbyEscrow.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";

/// forge script script/Deploy.s.sol --rpc-url monad --broadcast --private-key $DEPLOYER_PRIVATE_KEY
/// Env: AUSD, STATA, VERIFIER, TREASURY, KEEPER (defaults: mainnet AUSD/stataAUSD).
contract Deploy is Script {
    function run() external {
        address ausd = vm.envOr("AUSD", address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a));
        address stata = vm.envOr("STATA", address(0x9e1AcC5BFbf34e2E579763cE14042d957719fE76));
        address verifier = vm.envAddress("VERIFIER");
        address treasury = vm.envAddress("TREASURY");
        address keeper = vm.envAddress("KEEPER");

        vm.startBroadcast();
        address owner = msg.sender;
        BilbyDirectory directory = new BilbyDirectory(owner, verifier);
        BilbyEscrow escrow = new BilbyEscrow(IERC20(ausd), directory, owner, verifier, treasury);
        BilbyRouter router = new BilbyRouter(IERC20(ausd), IERC4626(stata), address(escrow), owner);
        router.setKeeper(keeper, true);
        vm.stopBroadcast();

        console.log("BilbyDirectory", address(directory));
        console.log("BilbyEscrow   ", address(escrow));
        console.log("BilbyRouter   ", address(router));
        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "ausd", ausd);
        vm.serializeAddress(json, "stata", stata);
        vm.serializeAddress(json, "directory", address(directory));
        vm.serializeAddress(json, "escrow", address(escrow));
        string memory out = vm.serializeAddress(json, "router", address(router));
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), "-v2.json"));
    }
}
