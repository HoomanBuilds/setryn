// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {PositionTerminalState} from "../../src/interfaces/IPositionEngineTerminalState.sol";
import {RegistryStatus, TerminalOutcomeKind} from "../../src/types/Enums.sol";
import {AccountId, AssetId, RiskDomainId} from "../../src/types/Identifiers.sol";
import {RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";

contract VaultRiskDomainRegistryMock {
    ISettlementAssetRegistry public immutable settlementAssetRegistry;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => RiskDomainVersion record)) private _records;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => bool open)) public isOpenForNewRisk;

    constructor(ISettlementAssetRegistry settlementAssetRegistry_) {
        settlementAssetRegistry = settlementAssetRegistry_;
    }

    function setRiskDomain(
        RiskDomainId riskDomainId,
        uint32 version,
        AssetId assetId,
        uint32 assetVersion,
        uint128 aggregateLiabilityCap,
        uint128 accountLiabilityCap,
        uint128 aggregateReservationCap,
        uint128 accountReservationCap,
        bool open
    ) external {
        RiskDomainVersion storage record = _records[riskDomainId][version];
        record.definition.collateralAssetId = assetId;
        record.definition.collateralAssetVersion = assetVersion;
        record.definition.maxAggregateLiabilityBaseUnits = aggregateLiabilityCap;
        record.definition.maxAccountLiabilityBaseUnits = accountLiabilityCap;
        record.definition.maxAggregateReservationBaseUnits = aggregateReservationCap;
        record.definition.maxAccountReservationBaseUnits = accountReservationCap;
        record.version = version;
        record.status = open ? RegistryStatus.Active : RegistryStatus.Paused;
        isOpenForNewRisk[riskDomainId][version] = open;
    }

    function getRiskDomain(RiskDomainId riskDomainId, uint32 version) external view returns (RiskDomainVersion memory) {
        return _records[riskDomainId][version];
    }
}

contract PositionEngineTerminalStateMock {
    bytes32 public immutable positionEngineId;
    mapping(bytes32 positionId => PositionTerminalState state) private _states;

    constructor(bytes32 positionEngineId_) {
        positionEngineId = positionEngineId_;
    }

    function terminalStateInterfaceVersion() external pure returns (uint32) {
        return 1;
    }

    function setPending(bytes32 positionId, uint64 finalResolutionAt, uint64 settlementDeadline) external {
        _states[positionId] = PositionTerminalState({
            positionId: positionId,
            terminalOutcomeReference: bytes32(0),
            receiverAccountId: AccountId.wrap(bytes32(0)),
            amount: 0,
            outcome: TerminalOutcomeKind.Unspecified,
            settlementDeadline: settlementDeadline,
            finalResolutionAt: finalResolutionAt
        });
    }

    function setTerminal(PositionTerminalState calldata state) external {
        _states[state.positionId] = state;
    }

    function terminalState(bytes32 positionId) external view returns (PositionTerminalState memory state) {
        return _states[positionId];
    }
}
