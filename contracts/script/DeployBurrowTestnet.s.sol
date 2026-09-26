// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {BilbyRouter} from "../src/BilbyRouter.sol";
import {MockAUSD} from "../src/mocks/MockAUSD.sol";
import {MockBurrowVault} from "../src/mocks/MockBurrowVault.sol";

/// @notice Deploys the Burrow testnet stack: test dollar + mock Aave vault + BilbyRouter.
/// forge script script/DeployBurrowTestnet.s.sol --rpc-url monad_testnet --broadcast
contract DeployBurrowTestnet is Script {
    function run() external {
        uint256 pk = vm.envUint("RELAYER_PK");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        MockAUSD dollar = new MockAUSD();
        MockBurrowVault vault = new MockBurrowVault(IERC20(address(dollar)), deployer);
        BilbyRouter router = new BilbyRouter(IERC20(address(dollar)), IERC4626(address(vault)), 1e6, deployer);
        router.setAllowedCall(address(dollar), bytes4(0xe3ee160e), true);
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "dollar", address(dollar));
        vm.serializeAddress(o, "burrowVault", address(vault));
        string memory json = vm.serializeAddress(o, "router", address(router));
        vm.writeJson(json, "./deployments/monad-testnet.json");

        console.log("dollar", address(dollar));
        console.log("burrowVault", address(vault));
        console.log("router", address(router));
    }
}
