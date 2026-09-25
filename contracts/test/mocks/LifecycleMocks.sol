// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ILifecycleAccountAuthority} from "../../src/interfaces/ILifecycleAccountAuthority.sol";
import {ILifecycleAtomicExecutor} from "../../src/interfaces/ILifecycleAtomicExecutor.sol";
import {ILifecyclePolicyValidator} from "../../src/interfaces/ILifecyclePolicyValidator.sol";
import {ILifecyclePositionSource} from "../../src/interfaces/ILifecyclePositionSource.sol";
import {AccountId, PositionId, RiskDomainId} from "../../src/types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../../src/types/LifecycleTypes.sol";

contract LifecyclePositionSourceMock is ILifecyclePositionSource {
    mapping(PositionId positionId => LifecyclePositionSnapshot snapshot) private _positions;
    mapping(PositionId positionId => mapping(LifecycleActionKind kind => bool eligible)) private _eligibility;

    function setPosition(LifecyclePositionSnapshot calldata snapshot, LifecycleActionKind kind, bool eligible)
        external
    {
        _positions[snapshot.positionId] = snapshot;
        _eligibility[snapshot.positionId][kind] = eligible;
    }

    function getLifecyclePosition(PositionId positionId)
        external
        view
        returns (LifecyclePositionSnapshot memory snapshot)
    {
        return _positions[positionId];
    }

    function isLifecycleActionEligible(PositionId positionId, LifecycleActionKind kind) external view returns (bool) {
        return _eligibility[positionId][kind];
    }
}

contract LifecycleAccountAuthorityMock is ILifecycleAccountAuthority {
    mapping(AccountId accountId => mapping(address signer => bool authorized)) public signers;

    function setSigner(AccountId accountId, address signer, bool authorized) external {
        signers[accountId][signer] = authorized;
    }

    function isAuthorizedSigner(AccountId accountId, address signer) external view returns (bool) {
        return signers[accountId][signer];
    }

    function isAuthorizedSignerForPolicy(AccountId accountId, address signer, bytes32) external view returns (bool) {
        return signers[accountId][signer];
    }
}

contract LifecyclePolicyValidatorMock is ILifecyclePolicyValidator {
    function validateLifecycleAction(
        LifecycleAction calldata,
        LifecyclePositionSnapshot[] calldata,
        LifecycleSuccessor[] calldata,
        LifecycleCollateralReplacement[] calldata,
        LifecycleConsent[] calldata
    ) external pure {}
}

contract LifecycleAtomicExecutorMock is ILifecycleAtomicExecutor {
    uint256 public calls;
    bytes32 public outcomeHash = keccak256("lifecycle outcome");

    function executeLifecycleAction(
        LifecycleActionId,
        LifecycleAction calldata,
        LifecycleInput[] calldata,
        LifecycleSuccessor[] calldata,
        LifecycleCollateralReplacement[] calldata
    ) external returns (bytes32) {
        calls += 1;
        return outcomeHash;
    }
}

contract LifecycleRiskDomainRegistryMock {
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => bool value)) public lifecycleEnabled;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => bool value)) public openForNewRisk;

    function setDomain(RiskDomainId riskDomainId, uint32 version, bool lifecycle, bool open) external {
        lifecycleEnabled[riskDomainId][version] = lifecycle;
        openForNewRisk[riskDomainId][version] = open;
    }

    function isLifecycleEnabled(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        return lifecycleEnabled[riskDomainId][version];
    }

    function isOpenForNewRisk(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        return openForNewRisk[riskDomainId][version];
    }
}
