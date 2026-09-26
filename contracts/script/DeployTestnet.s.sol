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

/// Monad testnet (10143): testnet AUSD's faucet is owner-restricted, so this deploys the same mocks as
/// DeployLocal (open-mint test dollar + stataAUSD stand-in) with the three contracts, and funds the treasury
/// float. Real AUSD/stataAUSD behaviour is covered by the mainnet fork test.
/// forge script script/DeployTestnet.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY
/// Env: VERIFIER, TREASURY, KEEPER. Writes deployments/10143.json.
contract DeployTestnet is Script {
    function run() external {
        require(block.chainid == 10143, "not Monad testnet");
        address verifier = vm.envAddress("VERIFIER");
        address treasury = vm.envAddress("TREASURY");
        address keeper = vm.envAddress("KEEPER");
        uint256 treasuryFloat = vm.envOr("TREASURY_FLOAT", uint256(100_000e6));

        vm.startBroadcast();
        address owner = msg.sender;
        MockAUSD ausd = new MockAUSD();
        MockStata stata = new MockStata(ausd);
        BilbyDirectory directory = new BilbyDirectory(owner, verifier);
        BilbyEscrow escrow = new BilbyEscrow(IERC20(address(ausd)), owner, verifier, treasury);
        BilbyRouter router = new BilbyRouter(IERC20(address(ausd)), IERC4626(address(stata)), address(escrow), owner);
        router.setKeeper(keeper, true);
        ausd.mint(treasury, treasuryFloat);
        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "startBlock", block.number);
        vm.serializeAddress(json, "ausd", address(ausd));
        vm.serializeAddress(json, "stata", address(stata));
        vm.serializeAddress(json, "directory", address(directory));
        vm.serializeAddress(json, "escrow", address(escrow));
        string memory out = vm.serializeAddress(json, "router", address(router));
        vm.writeJson(out, "deployments/10143.json");
        console.log(out);
    }
}
