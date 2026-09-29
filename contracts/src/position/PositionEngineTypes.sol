// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {TerminalOutcomeKind} from "../types/Enums.sol";
import {AccountId, PositionId, TerminalLiabilityReservationId} from "../types/Identifiers.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {PositionLiabilitySide, PositionProvenance} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";

// Shared definitions for PositionEngine and its linked logic libraries.

// The immutable dependency graph of PositionEngine, passed to linked libraries that execute in its context.
struct PositionEngineDependencies {
    bytes32 positionEngineId;
    ISeriesRegistry seriesRegistry;
    IMarketRegistry marketRegistry;
    IInstrumentRegistry instrumentRegistry;
    IAdapterRegistry adapterRegistry;
    ICollateralVault collateralVault;
}

struct LiabilityState {
    PositionId positionId;
    PositionLiabilitySide side;
    AccountId payerAccountId;
    AccountId receiverAccountId;
    bytes32 terminalOutcomeReference;
    uint64 settlementDeadline;
    uint64 finalResolutionAt;
    TerminalOutcomeKind outcome;
    uint128 amount;
    bool exists;
}

struct PositionInitializationContext {
    PositionId positionId;
    SeriesVersion series;
    MarketVersion market;
    InstrumentVersion instrument;
    PositionProvenance provenance;
    bytes32 termsHash;
    address payoffModule;
    bytes32 payoffModuleCodeHash;
    uint128 longMaximum;
    uint128 shortMaximum;
    bytes32 longLiabilityKey;
    bytes32 shortLiabilityKey;
    TerminalLiabilityReservationId longReservationId;
    TerminalLiabilityReservationId shortReservationId;
}
