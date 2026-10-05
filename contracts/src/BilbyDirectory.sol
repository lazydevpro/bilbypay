// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title BilbyDirectory
/// @notice A private phone identifier finds an account; it never grants spending authority.
/// Fresh verifier attestations and destination consent are checked on-chain. Moving an existing
/// identifier also needs its controller's consent, or a cancellable delayed recovery.
contract BilbyDirectory is EIP712, Ownable2Step {
    struct Binding {
        // Retained after expiry/revocation so phone verification cannot bypass an existing controller.
        address account;
        uint64 boundAt;
        uint64 validUntil;
        uint64 revision;
        // First enrollment keeps epoch zero; reassignment/revocation invalidates old escrow claims.
        uint64 phoneEpoch;
        bool revoked;
    }

    struct BindRequest {
        bytes32 phoneKey;
        address account;
        uint256 issuedAt;
        uint256 deadline;
        uint256 expectedRevision;
        uint256 validUntil;
    }

    struct PendingChange {
        address account;
        uint64 requestedAt;
        uint64 executableAt;
        uint64 expiresAt;
        uint64 expectedRevision;
    }

    uint256 public constant VERSION = 2;
    uint256 public constant MAX_LEASE = 365 days;
    uint256 public constant MAX_PROOF_AGE = 15 minutes;
    uint256 public constant RECOVERY_DELAY = 7 days;
    uint256 public constant RECOVERY_WINDOW = 7 days;
    bytes32 public constant BIND_TYPEHASH = keccak256(
        "Bind(bytes32 phoneKey,address account,uint256 issuedAt,uint256 deadline,uint256 expectedRevision,uint256 validUntil)"
    );
    bytes32 public constant REQUEST_RECOVERY_TYPEHASH = keccak256(
        "RequestRecovery(bytes32 phoneKey,address account,uint256 issuedAt,uint256 deadline,uint256 expectedRevision,uint256 validUntil)"
    );
    bytes32 public constant FINALIZE_RECOVERY_TYPEHASH = keccak256(
        "FinalizeRecovery(bytes32 phoneKey,address account,uint256 issuedAt,uint256 deadline,uint256 expectedRevision,uint256 validUntil)"
    );
    bytes32 public constant REVOKE_TYPEHASH =
        keccak256("Revoke(bytes32 phoneKey,uint256 expectedRevision,uint256 deadline)");
    bytes32 public constant CANCEL_RECOVERY_TYPEHASH =
        keccak256("CancelRecovery(bytes32 phoneKey,uint256 expectedRevision,uint256 deadline)");

    address public verifier;
    mapping(bytes32 phoneKey => Binding) private _bindings;
    mapping(bytes32 phoneKey => PendingChange) private _pendingChanges;
    mapping(address account => bytes32 phoneKey) public phoneKeyOf;
    mapping(bytes32 phoneKey => uint256 issuedAt) public lastIssuedAt;

    event Bound(bytes32 indexed phoneKey, address indexed account, address indexed previous);
    event Unbound(bytes32 indexed phoneKey, address indexed account);
    event BindingUpdated(
        bytes32 indexed phoneKey,
        address indexed account,
        uint64 revision,
        uint64 phoneEpoch,
        uint64 boundAt,
        uint64 validUntil,
        bool revoked
    );
    event RecoveryRequested(
        bytes32 indexed phoneKey,
        address indexed currentAccount,
        address indexed proposedAccount,
        uint64 expectedRevision,
        uint64 executableAt,
        uint64 expiresAt
    );
    event RecoveryCancelled(bytes32 indexed phoneKey, uint64 revision);
    event RecoveryFinalized(
        bytes32 indexed phoneKey, address indexed previous, address indexed account, uint64 revision
    );
    event VerifierChanged(address indexed verifier);

    error InvalidAccount();
    error AccountAlreadyBound();
    error InvalidAttestation();
    error InvalidAccountConsent();
    error InvalidControllerConsent();
    error AttestationExpired();
    error StaleAttestation();
    error RevisionMismatch();
    error InvalidLease();
    error RecoveryNotRequired();
    error RecoveryPending();
    error NoPendingRecovery();
    error RecoveryNotReady();
    error RecoveryExpired();
    error RecoveryAccountMismatch();
    error AlreadyRevoked();

    constructor(address owner_, address verifier_) EIP712("BilbyDirectory", "2") Ownable(owner_) {
        _setVerifier(verifier_);
    }

    function setVerifier(address verifier_) external onlyOwner {
        _setVerifier(verifier_);
    }

    /// @notice Enroll/renew with both phone proof and destination consent. Moving an identifier
    /// immediately additionally requires its historical controller, even after expiry or revocation.
    function bind(
        BindRequest calldata request,
        bytes calldata verifierSignature,
        bytes calldata accountSignature,
        bytes calldata controllerSignature
    ) external {
        bytes32 digest = _verifyRequest(request, BIND_TYPEHASH, verifierSignature, accountSignature);
        address previous = _bindings[request.phoneKey].account;
        if (previous != address(0) && previous != request.account) {
            if (!SignatureChecker.isValidSignatureNow(previous, digest, controllerSignature)) {
                revert InvalidControllerConsent();
            }
        }
        _applyBinding(request);
    }

    /// @notice A lost controller or recycled number starts a seven-day, publicly visible delay.
    /// Another request cannot replace/reset a live request. Both sides can cancel it.
    function requestRecovery(
        BindRequest calldata request,
        bytes calldata verifierSignature,
        bytes calldata accountSignature
    ) external {
        _verifyRequest(request, REQUEST_RECOVERY_TYPEHASH, verifierSignature, accountSignature);
        Binding storage b = _bindings[request.phoneKey];
        if (b.account == address(0) || b.account == request.account) revert RecoveryNotRequired();
        if (_hasLivePending(request.phoneKey)) revert RecoveryPending();
        b.revision++;
        lastIssuedAt[request.phoneKey] = request.issuedAt;
        uint64 executableAt = uint64(block.timestamp + RECOVERY_DELAY);
        uint64 expiresAt = uint64(uint256(executableAt) + RECOVERY_WINDOW);
        _pendingChanges[request.phoneKey] = PendingChange({
            account: request.account,
            requestedAt: uint64(block.timestamp),
            executableAt: executableAt,
            expiresAt: expiresAt,
            expectedRevision: b.revision
        });
        _emitBinding(request.phoneKey);
        emit RecoveryRequested(
            request.phoneKey, b.account, request.account, b.revision, executableAt, expiresAt
        );
    }

    /// @notice Complete only with new phone proof AND destination consent issued after the delay.
    /// This reassigns future routing; the old account and its assets keep their original keys.
    function finalizeRecovery(
        BindRequest calldata request,
        bytes calldata verifierSignature,
        bytes calldata accountSignature
    ) external {
        PendingChange memory pending = _pendingChanges[request.phoneKey];
        if (pending.account == address(0)) revert NoPendingRecovery();
        if (block.timestamp < pending.executableAt) revert RecoveryNotReady();
        if (block.timestamp > pending.expiresAt) revert RecoveryExpired();
        if (request.account != pending.account) revert RecoveryAccountMismatch();
        if (request.issuedAt < pending.executableAt) revert StaleAttestation();
        if (request.expectedRevision != pending.expectedRevision) revert RevisionMismatch();
        _verifyRequest(request, FINALIZE_RECOVERY_TYPEHASH, verifierSignature, accountSignature);
        address previous = _bindings[request.phoneKey].account;
        _applyBinding(request);
        emit RecoveryFinalized(
            request.phoneKey, previous, request.account, _bindings[request.phoneKey].revision
        );
    }

    /// @notice Either the controller or the proposed destination may cancel, including after expiry.
    function cancelRecovery(
        bytes32 phoneKey,
        uint256 expectedRevision,
        uint256 deadline,
        bytes calldata signature
    ) external {
        _verifyControlRequest(phoneKey, expectedRevision, deadline);
        PendingChange memory pending = _pendingChanges[phoneKey];
        if (pending.account == address(0)) revert NoPendingRecovery();
        Binding storage b = _bindings[phoneKey];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CANCEL_RECOVERY_TYPEHASH, phoneKey, expectedRevision, deadline))
        );
        if (
            !SignatureChecker.isValidSignatureNow(b.account, digest, signature)
                && !SignatureChecker.isValidSignatureNow(pending.account, digest, signature)
        ) revert InvalidControllerConsent();
        delete _pendingChanges[phoneKey];
        b.revision++;
        emit RecoveryCancelled(phoneKey, b.revision);
        _emitBinding(phoneKey);
    }

    /// @notice Stop discovery and invalidate outstanding phone-bound claims without touching funds.
    function revoke(
        bytes32 phoneKey,
        uint256 expectedRevision,
        uint256 deadline,
        bytes calldata controllerSignature
    ) external {
        _verifyControlRequest(phoneKey, expectedRevision, deadline);
        Binding storage b = _bindings[phoneKey];
        if (b.revoked) revert AlreadyRevoked();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(REVOKE_TYPEHASH, phoneKey, expectedRevision, deadline)));
        if (!SignatureChecker.isValidSignatureNow(b.account, digest, controllerSignature)) {
            revert InvalidControllerConsent();
        }
        _revoke(phoneKey);
    }

    /// @return account Zero for never-enrolled, expired, revoked, or disputed/pending identifiers.
    /// Use getBinding/getPendingChange to distinguish these cases before offering an invitation.
    /// @return boundAt Time this controller most recently acquired the identifier.
    function resolve(bytes32 phoneKey) external view returns (address account, uint64 boundAt) {
        Binding memory b = _bindings[phoneKey];
        return (_isActive(phoneKey, b) ? b.account : address(0), b.boundAt);
    }

    function getBinding(bytes32 phoneKey) external view returns (Binding memory) {
        return _bindings[phoneKey];
    }

    function getPendingChange(bytes32 phoneKey) external view returns (PendingChange memory) {
        return _pendingChanges[phoneKey];
    }

    function isClaimable(bytes32 phoneKey, uint64 phoneEpoch, address recipient)
        external
        view
        returns (bool)
    {
        Binding memory b = _bindings[phoneKey];
        return b.phoneEpoch == phoneEpoch && b.account == recipient && _isActive(phoneKey, b);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _verifyRequest(
        BindRequest calldata request,
        bytes32 typehash,
        bytes calldata verifierSignature,
        bytes calldata accountSignature
    ) private view returns (bytes32 digest) {
        if (request.account == address(0) || request.phoneKey == bytes32(0)) {
            revert InvalidAccount();
        }
        bytes32 otherPhoneKey = phoneKeyOf[request.account];
        if (otherPhoneKey != bytes32(0) && otherPhoneKey != request.phoneKey) revert AccountAlreadyBound();
        if (
            block.timestamp > request.deadline || request.deadline < request.issuedAt
                || request.deadline - request.issuedAt > MAX_PROOF_AGE
        ) revert AttestationExpired();
        if (
            request.issuedAt > block.timestamp || block.timestamp - request.issuedAt > MAX_PROOF_AGE
                || request.issuedAt < lastIssuedAt[request.phoneKey]
        ) revert StaleAttestation();
        if (request.expectedRevision != _bindings[request.phoneKey].revision) revert RevisionMismatch();
        if (request.validUntil <= block.timestamp || request.validUntil > block.timestamp + MAX_LEASE) {
            revert InvalidLease();
        }
        digest = _hashTypedDataV4(keccak256(abi.encode(typehash, request)));
        if (!SignatureChecker.isValidSignatureNow(verifier, digest, verifierSignature)) {
            revert InvalidAttestation();
        }
        if (!SignatureChecker.isValidSignatureNow(request.account, digest, accountSignature)) {
            revert InvalidAccountConsent();
        }
    }

    function _verifyControlRequest(bytes32 phoneKey, uint256 expectedRevision, uint256 deadline)
        private
        view
    {
        if (phoneKey == bytes32(0) || _bindings[phoneKey].account == address(0)) revert InvalidAccount();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (expectedRevision != _bindings[phoneKey].revision) revert RevisionMismatch();
    }

    function _applyBinding(BindRequest calldata request) private {
        Binding storage b = _bindings[request.phoneKey];
        address previous = b.account;
        if (previous != address(0) && previous != request.account) {
            b.phoneEpoch++;
            if (phoneKeyOf[previous] == request.phoneKey) delete phoneKeyOf[previous];
        }
        // Changing a destination's other number requires a separate explicit Revoke signature.
        if (previous != request.account || b.revoked) b.boundAt = uint64(block.timestamp);
        b.account = request.account;
        b.validUntil = uint64(request.validUntil);
        b.revoked = false;
        b.revision++;
        phoneKeyOf[request.account] = request.phoneKey;
        lastIssuedAt[request.phoneKey] = request.issuedAt;
        delete _pendingChanges[request.phoneKey];
        emit Bound(request.phoneKey, request.account, previous);
        _emitBinding(request.phoneKey);
    }

    function _revoke(bytes32 phoneKey) private {
        Binding storage b = _bindings[phoneKey];
        b.revoked = true;
        b.revision++;
        b.phoneEpoch++;
        if (phoneKeyOf[b.account] == phoneKey) delete phoneKeyOf[b.account];
        delete _pendingChanges[phoneKey];
        emit Unbound(phoneKey, b.account);
        _emitBinding(phoneKey);
    }

    function _isActive(bytes32 phoneKey, Binding memory b) private view returns (bool) {
        return
            b.account != address(0) && !b.revoked && block.timestamp < b.validUntil
                && !_hasLivePending(phoneKey);
    }

    function _hasLivePending(bytes32 phoneKey) private view returns (bool) {
        PendingChange memory p = _pendingChanges[phoneKey];
        return p.account != address(0) && block.timestamp <= p.expiresAt;
    }

    function _emitBinding(bytes32 phoneKey) private {
        Binding memory b = _bindings[phoneKey];
        emit BindingUpdated(phoneKey, b.account, b.revision, b.phoneEpoch, b.boundAt, b.validUntil, b.revoked);
    }

    function _setVerifier(address verifier_) private {
        if (verifier_ == address(0)) revert InvalidAccount();
        verifier = verifier_;
        emit VerifierChanged(verifier_);
    }
}
