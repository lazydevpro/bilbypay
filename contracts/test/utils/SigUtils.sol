// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {BilbyRouter} from "../../src/BilbyRouter.sol";

/// @notice Signing helpers mirroring what the app signs in one mera session.
library SigUtils {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 internal constant TWA_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant RWA_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function _digest(bytes32 domain, bytes32 structHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function permit(uint256 pk, address token, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (BilbyRouter.PermitSig memory p)
    {
        address owner = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, spender, value, IERC20Permit(token).nonces(owner), deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(IERC20Permit(token).DOMAIN_SEPARATOR(), structHash));
        p = BilbyRouter.PermitSig({value: value, deadline: deadline, v: v, r: r, s: s});
    }

    function noPermit() internal pure returns (BilbyRouter.PermitSig memory p) {}

    /// @return data calldata for token.transferWithAuthorization(from, to, value, 0, validBefore, nonce, v, r, s)
    function transferWithAuthorization(
        uint256 pk,
        address token,
        address to,
        uint256 value,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes memory data) {
        address from = vm.addr(pk);
        bytes32 structHash = keccak256(abi.encode(TWA_TYPEHASH, from, to, value, 0, validBefore, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(IERC20Permit(token).DOMAIN_SEPARATOR(), structHash));
        data = abi.encodeWithSelector(
            bytes4(0xe3ee160e), from, to, value, uint256(0), validBefore, nonce, v, r, s
        );
    }

    function receiveWithAuthorization(
        uint256 pk,
        address token,
        address to,
        uint256 value,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        address from = vm.addr(pk);
        bytes32 structHash = keccak256(abi.encode(RWA_TYPEHASH, from, to, value, 0, validBefore, nonce));
        (v, r, s) = vm.sign(pk, _digest(IERC20Permit(token).DOMAIN_SEPARATOR(), structHash));
    }

    function autoSave(
        uint256 pk,
        BilbyRouter router,
        bool enabled,
        uint256 threshold,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 structHash =
            keccak256(abi.encode(router.AUTOSAVE_TYPEHASH(), vm.addr(pk), enabled, threshold, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(router.DOMAIN_SEPARATOR(), structHash));
        sig = abi.encodePacked(r, s, v);
    }
}
