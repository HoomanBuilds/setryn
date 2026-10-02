// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "./Enums.sol";
import {AccountId, FillId, SeriesId} from "./Identifiers.sol";
import {PublicOrder} from "./OrderTypes.sol";
import {OrderRiskAuthorization, RiskAdmissionId} from "./RiskTypes.sol";
import {StreamId} from "./StreamTypes.sol";
import {Lots, PriceTicks} from "./Units.sol";

/// @notice A maker's standing capacity behind its streamed quotes on one series: collateral locked once through the
/// stream capacity manager, then drawn down fill by fill. Signed by the maker under the settlement router's EIP-712
/// domain, so anyone may open it on the maker's behalf.
struct QuoteCapacityTerms {
    address maker;
    AccountId makerAccountId;
    SeriesId seriesId;
    uint32 seriesVersion;
    uint128 maximumLiability;
    uint128 liabilityPerLot;
    uint128 maximumAbsoluteInventoryLots;
    uint64 expiry;
    uint256 nonce;
}

/// @notice The router-side terms of a maker quote. Their hash is the `binderTerms` of the maker's risk authorization,
/// so the maker's one authorization signature commits the quote to this capacity and to this router.
struct MakerQuoteTerms {
    StreamId capacityId;
}

/// @notice The router-side terms of a taker order. Their hash is the `binderTerms` of the taker's risk authorization.
/// `quoteOrderHash` pins the one maker quote accepted (zero accepts any compatible quote at or inside the taker's limit);
/// `relayer` restricts the submitter (zero lets anyone submit); the relayer fee is charged to the taker's account and
/// paid to `relayerAccountId`, never above `maxRelayerFeeMinor`.
struct TakerSettlementTerms {
    bytes32 quoteOrderHash;
    address relayer;
    AccountId relayerAccountId;
    uint128 maxRelayerFeeMinor;
}

/// @notice A firm maker quote as streamed offchain: the maker's signed public order (its price, size, expiry, nonce and
/// fee cap) plus its signed risk authorization naming the router and the quote terms.
struct SignedMakerQuote {
    PublicOrder order;
    bytes orderSignature;
    OrderRiskAuthorization risk;
    bytes riskSignature;
    MakerQuoteTerms terms;
}

/// @notice A taker's signed opposite-side order with its signed risk authorization and settlement terms.
struct SignedTakerOrder {
    PublicOrder order;
    bytes orderSignature;
    OrderRiskAuthorization risk;
    bytes riskSignature;
    TakerSettlementTerms terms;
}

/// @notice One settlement: a quote, the taker order that accepts it, the size, the relayer fee actually charged, and the
/// series payoff terms the clearing engine verifies.
struct QuoteSettlement {
    SignedMakerQuote quote;
    SignedTakerOrder taker;
    Lots fillLots;
    uint128 relayerFeeMinor;
    bytes payoffTerms;
}

/// @notice The router's record of a capacity it opened.
struct QuoteCapacityRecord {
    address maker;
    AccountId makerAccountId;
    SeriesId seriesId;
    uint32 seriesVersion;
    uint128 liabilityPerLot;
    uint64 expiry;
}

/// @notice Everything one settlement did, emitted once so an indexer reconstructs it without further reads.
struct QuoteSettlementReceipt {
    FillId fillId;
    bytes32 quoteOrderHash;
    bytes32 takerOrderHash;
    address maker;
    address taker;
    AccountId makerAccountId;
    AccountId takerAccountId;
    SeriesId seriesId;
    uint32 seriesVersion;
    Side makerSide;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    StreamId capacityId;
    uint64 capacitySequence;
    uint128 capacityLiabilityConsumed;
    RiskAdmissionId makerAdmissionId;
    RiskAdmissionId takerAdmissionId;
    address submitter;
    AccountId relayerAccountId;
    uint128 relayerFeeMinor;
}
