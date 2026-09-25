// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    IPositionEngineTerminalState,
    PositionTerminalState
} from "../../src/interfaces/IPositionEngineTerminalState.sol";
import {InstrumentDefinitionLib} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {TerminalClaim, TerminalLiabilityReservation} from "../../src/types/CollateralTypes.sol";
import {
    RegistryStatus,
    TerminalClaimStatus,
    TerminalLiabilityReservationStatus,
    TerminalOutcomeKind
} from "../../src/types/Enums.sol";
import {FeeActionRequest, FeeActionResult, FeeComputation} from "../../src/types/FeeEngineTypes.sol";
import {FixingResolutionKind, FixingResult, FixingStatus} from "../../src/types/FixingTypes.sol";
import {
    AccountId,
    AssetId,
    InstrumentId,
    MarketId,
    PositionId,
    SeriesId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition, InstrumentVersion} from "../../src/types/InstrumentDefinition.sol";
import {MarketDefinition, MarketVersion} from "../../src/types/MarketDefinition.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../../src/types/PositionTypes.sol";
import {SeriesDefinition, SeriesVersion} from "../../src/types/SeriesDefinition.sol";
import {FixingSlot} from "../../src/types/SeriesQualification.sol";
import {Lots} from "../../src/types/Units.sol";

contract SettlementInstrumentRegistryMock {
    mapping(InstrumentId instrumentId => mapping(uint32 version => InstrumentVersion record)) private _records;

    function setInstrument(InstrumentDefinition calldata definition, uint32 version)
        external
        returns (InstrumentId instrumentId)
    {
        instrumentId = InstrumentDefinitionLib.deriveInstrumentId(definition);
        bytes32 definitionHash = InstrumentDefinitionLib.hashDefinition(definition, block.chainid);
        _records[instrumentId][version] = InstrumentVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: InstrumentDefinitionLib.hashVersion(instrumentId, version, definitionHash, block.chainid),
            version: version,
            status: RegistryStatus.Paused
        });
    }

    function isLifecycleEnabled(InstrumentId instrumentId, uint32 version) external view returns (bool) {
        return _records[instrumentId][version].version != 0;
    }

    function getInstrument(InstrumentId instrumentId, uint32 version) external view returns (InstrumentVersion memory) {
        return _records[instrumentId][version];
    }
}

contract SettlementMarketRegistryMock {
    mapping(bytes32 marketId => mapping(uint32 version => MarketVersion record)) private _records;

    function setMarket(MarketDefinition calldata definition, uint32 version) external returns (bytes32 rawMarketId) {
        rawMarketId = MarketId.unwrap(MarketDefinitionLib.deriveMarketId(definition));
        bytes32 definitionHash = MarketDefinitionLib.hashDefinition(definition, block.chainid);
        MarketId marketId = MarketId.wrap(rawMarketId);
        _records[rawMarketId][version] = MarketVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: MarketDefinitionLib.hashVersion(marketId, version, definitionHash, block.chainid),
            version: version,
            status: RegistryStatus.Paused
        });
    }

    function isLifecycleEnabled(bytes32 marketId, uint32 version) external view returns (bool) {
        return _records[marketId][version].version != 0;
    }

    function getMarket(bytes32 marketId, uint32 version) external view returns (MarketVersion memory) {
        return _records[marketId][version];
    }
}

contract SettlementSeriesRegistryMock {
    address public immutable instrumentRegistry;
    address public immutable marketRegistry;
    mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) private _records;

    constructor(address instrumentRegistry_, address marketRegistry_) {
        instrumentRegistry = instrumentRegistry_;
        marketRegistry = marketRegistry_;
    }

    function setSeries(SeriesDefinition calldata definition, uint32 version) external returns (SeriesId seriesId) {
        seriesId = SeriesDefinitionLib.deriveSeriesId(definition);
        bytes32 definitionHash = SeriesDefinitionLib.hashDefinition(definition, block.chainid);
        _records[seriesId][version] = SeriesVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: SeriesDefinitionLib.hashVersion(seriesId, version, definitionHash, block.chainid),
            version: version,
            status: RegistryStatus.Paused
        });
    }

    function isLifecycleEnabled(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _records[seriesId][version].version != 0;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _records[seriesId][version];
    }

    function hashPayoffTerms(bytes32 termsSchemaHash, bytes calldata terms) external pure returns (bytes32) {
        return SeriesDefinitionLib.hashPayoffTerms(termsSchemaHash, terms);
    }

    function hashFixingSlots(SeriesDefinition calldata definition, FixingSlot[] calldata slots, uint16 maximumSlots)
        external
        pure
        returns (bytes32)
    {
        return SeriesDefinitionLib.hashFixingSlots(definition, slots, maximumSlots);
    }
}

contract SettlementPositionEngineMock is IPositionEngineTerminalState {
    address public immutable seriesRegistry;
    address public immutable collateralVault;
    bytes32 public immutable positionEngineId = keccak256("settlement.position.engine");
    mapping(PositionId positionId => PositionEconomics economics) private _economics;
    mapping(PositionId positionId => PositionLifecycle lifecycle) private _lifecycle;
    mapping(PositionId positionId => bytes terms) private _terms;
    mapping(bytes32 liabilityKey => PositionTerminalState state) private _terminalStates;
    int256 public normalTransfer;

    constructor(address seriesRegistry_, address collateralVault_) {
        seriesRegistry = seriesRegistry_;
        collateralVault = collateralVault_;
    }

    function seed(PositionEconomics calldata economics, bytes calldata terms, int256 normalTransfer_) external {
        _economics[economics.positionId] = economics;
        _lifecycle[economics.positionId].status = PositionStatus.Live;
        _terms[economics.positionId] = terms;
        normalTransfer = normalTransfer_;
        _stage(economics.longLiabilityKey, economics.finalResolutionAt, economics.settlementDeadline);
        _stage(economics.shortLiabilityKey, economics.finalResolutionAt, economics.settlementDeadline);
    }

    function beginFixing(PositionId positionId) external {
        _lifecycle[positionId].status = PositionStatus.Fixing;
    }

    function acceptFinalFixing(PositionId positionId, bytes32 fixingReference, bytes calldata finalFixings) external {
        PositionLifecycle storage lifecycle = _lifecycle[positionId];
        lifecycle.status = PositionStatus.SettlementReady;
        lifecycle.finalFixingReference = fixingReference;
        lifecycle.finalFixingsHash = keccak256(finalFixings);
        lifecycle.terminalTransferMinor = normalTransfer;
    }

    function settle(PositionId positionId) external {
        PositionLifecycle storage lifecycle = _lifecycle[positionId];
        lifecycle.status = PositionStatus.Settled;
        lifecycle.terminalOutcomeReference =
            keccak256(abi.encode("normal", positionId, lifecycle.terminalTransferMinor));
        _writeTerminal(_economics[positionId], lifecycle.terminalTransferMinor, TerminalOutcomeKind.Payout);
    }

    function applyTerminalFallback(PositionId positionId) external {
        PositionEconomics storage economics = _economics[positionId];
        int256 total = economics.terminalDisruptionTransferMinorPerLot * int256(uint256(Lots.unwrap(economics.lots)));
        PositionLifecycle storage lifecycle = _lifecycle[positionId];
        lifecycle.status = total == 0 ? PositionStatus.Settled : PositionStatus.TerminalClaim;
        lifecycle.terminalTransferMinor = total;
        lifecycle.terminalOutcomeReference = keccak256(abi.encode("fallback", positionId, total));
        _writeTerminal(economics, total, TerminalOutcomeKind.Claim);
    }

    function setLapsed(PositionId positionId, bytes32 outcomeReference) external {
        PositionEconomics storage economics = _economics[positionId];
        PositionLifecycle storage lifecycle = _lifecycle[positionId];
        lifecycle.status = PositionStatus.Lapsed;
        lifecycle.terminalTransferMinor = 0;
        lifecycle.terminalOutcomeReference = outcomeReference;
        _writeTerminal(economics, 0, TerminalOutcomeKind.Flat);
    }

    function getPosition(PositionId positionId)
        external
        view
        returns (PositionEconomics memory, PositionLifecycle memory)
    {
        return (_economics[positionId], _lifecycle[positionId]);
    }

    function payoffTerms(PositionId positionId) external view returns (bytes memory) {
        return _terms[positionId];
    }

    function positionStatus(PositionId positionId) external view returns (PositionStatus) {
        return _lifecycle[positionId].status;
    }

    function terminalStateInterfaceVersion() external pure returns (uint32) {
        return 1;
    }

    function terminalState(bytes32 liabilityKey) external view returns (PositionTerminalState memory) {
        return _terminalStates[liabilityKey];
    }

    function _stage(bytes32 key, uint64 finalResolutionAt, uint64 settlementDeadline) private {
        _terminalStates[key].positionId = key;
        _terminalStates[key].finalResolutionAt = finalResolutionAt;
        _terminalStates[key].settlementDeadline = settlementDeadline;
    }

    function _writeTerminal(PositionEconomics storage economics, int256 transfer, TerminalOutcomeKind payingOutcome)
        private
    {
        PositionTerminalState storage longState = _terminalStates[economics.longLiabilityKey];
        PositionTerminalState storage shortState = _terminalStates[economics.shortLiabilityKey];
        longState.terminalOutcomeReference = _lifecycle[economics.positionId].terminalOutcomeReference;
        shortState.terminalOutcomeReference = _lifecycle[economics.positionId].terminalOutcomeReference;
        if (transfer == 0) {
            longState.outcome = TerminalOutcomeKind.Flat;
            shortState.outcome = TerminalOutcomeKind.Flat;
        } else if (transfer < 0) {
            longState.outcome = payingOutcome;
            longState.receiverAccountId = economics.shortAccountId;
            longState.amount = uint128(uint256(-transfer));
            shortState.outcome = TerminalOutcomeKind.Flat;
        } else {
            shortState.outcome = payingOutcome;
            shortState.receiverAccountId = economics.longAccountId;
            shortState.amount = uint128(uint256(transfer));
            longState.outcome = TerminalOutcomeKind.Flat;
        }
    }
}

contract SettlementFixingEngineMock {
    address public immutable seriesRegistry;
    mapping(bytes32 key => FixingResult result) private _results;

    constructor(address seriesRegistry_) {
        seriesRegistry = seriesRegistry_;
    }

    function setResult(SeriesId seriesId, uint32 version, uint8 slot, FixingResult calldata result) external {
        _results[_key(seriesId, version, slot)] = result;
    }

    function fixingStatus(SeriesId seriesId, uint32 version, uint8 slot) external view returns (FixingStatus) {
        return _results[_key(seriesId, version, slot)].resultHash == bytes32(0)
            ? FixingStatus.Unspecified
            : FixingStatus.Finalized;
    }

    function getFinalizedFixing(SeriesId seriesId, uint32 version, uint8 slot)
        external
        view
        returns (FixingResult memory)
    {
        return _results[_key(seriesId, version, slot)];
    }

    function applyTerminalFallback(SeriesId seriesId, uint32 version, uint8 slot)
        external
        returns (FixingResult memory)
    {
        return _results[_key(seriesId, version, slot)];
    }

    function finalizeFixing(SeriesId seriesId, uint32 version, uint8 slot) external returns (FixingResult memory) {
        return _results[_key(seriesId, version, slot)];
    }

    function deriveFixingKey(SeriesId seriesId, uint32 version, uint8 slot) external view returns (bytes32) {
        return _key(seriesId, version, slot);
    }

    function _key(SeriesId seriesId, uint32 version, uint8 slot) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), seriesId, version, slot));
    }
}

contract SettlementFeeEngineMock {
    address public immutable collateralVault;

    constructor(address collateralVault_) {
        collateralVault = collateralVault_;
    }

    function previewFeeAction(bytes32, uint32, bytes32, uint128, uint128)
        external
        pure
        returns (FeeComputation memory)
    {}

    function consumeFeeAction(FeeActionRequest calldata request) external pure returns (FeeActionResult memory result) {
        result.consumptionId = request.consumptionId;
        result.resultHash = keccak256(abi.encode(request.consumptionId));
        result.feeScheduleId = request.feeScheduleId;
        result.feeScheduleVersion = request.feeScheduleVersion;
    }
}

contract SettlementCollateralVaultMock {
    mapping(TerminalLiabilityReservationId id => TerminalLiabilityReservation record) private _reservations;
    mapping(TerminalClaimId id => TerminalClaim record) private _claims;

    function seedReservation(TerminalLiabilityReservationId id, TerminalLiabilityReservation calldata reservation)
        external
    {
        _reservations[id] = reservation;
    }

    function finalizeTerminalLiabilityReservation(TerminalLiabilityReservationId id)
        external
        returns (TerminalClaimId)
    {
        return _terminalize(id);
    }

    function materializeTerminalClaimAfterFinalResolution(TerminalLiabilityReservationId id)
        external
        returns (TerminalClaimId)
    {
        return _terminalize(id);
    }

    function fulfillTerminalClaim(TerminalClaimId claimId) external {
        _claims[claimId].status = TerminalClaimStatus.Fulfilled;
    }

    function terminalLiabilityReservationOf(TerminalLiabilityReservationId id)
        external
        view
        returns (TerminalLiabilityReservation memory)
    {
        return _reservations[id];
    }

    function terminalClaimOf(TerminalClaimId id) external view returns (TerminalClaim memory) {
        return _claims[id];
    }

    function terminalClaimStatusOf(TerminalClaimId id) external view returns (TerminalClaimStatus) {
        return _claims[id].status;
    }

    function deriveTerminalClaimId(TerminalLiabilityReservationId id, bytes32 outcomeReference)
        public
        view
        returns (TerminalClaimId)
    {
        return TerminalClaimId.wrap(keccak256(abi.encode(block.chainid, address(this), id, outcomeReference)));
    }

    function _terminalize(TerminalLiabilityReservationId id) private returns (TerminalClaimId claimId) {
        TerminalLiabilityReservation storage reservation = _reservations[id];
        PositionTerminalState memory state =
            IPositionEngineTerminalState(reservation.positionEngine).terminalState(reservation.positionId);
        reservation.remainingAmount = 0;
        reservation.terminalOutcomeReference = state.terminalOutcomeReference;
        reservation.terminalAccountId = state.receiverAccountId;
        reservation.terminalAmount = state.amount;
        reservation.terminalOutcome = state.outcome;
        if (state.amount == 0) {
            reservation.status = TerminalLiabilityReservationStatus.ReleasedAtTerminal;
            return TerminalClaimId.wrap(bytes32(0));
        }
        reservation.status = TerminalLiabilityReservationStatus.ConvertedToClaim;
        claimId = deriveTerminalClaimId(id, state.terminalOutcomeReference);
        _claims[claimId] = TerminalClaim({
            reservationId: id,
            positionId: reservation.positionId,
            payerAccountId: reservation.payerAccountId,
            receiverAccountId: state.receiverAccountId,
            collateralId: reservation.collateralId,
            riskDomainId: reservation.riskDomainId,
            terminalOutcomeReference: state.terminalOutcomeReference,
            status: TerminalClaimStatus.Active,
            riskDomainVersion: reservation.riskDomainVersion,
            amount: state.amount
        });
    }
}
