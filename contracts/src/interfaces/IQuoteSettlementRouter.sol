// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    MakerQuoteTerms,
    QuoteCapacityRecord,
    QuoteCapacityTerms,
    QuoteSettlement,
    QuoteSettlementReceipt,
    TakerSettlementTerms
} from "../types/QuoteSettlementTypes.sol";
import {AccountId, FillId, SeriesId} from "../types/Identifiers.sol";
import {StreamId} from "../types/StreamTypes.sol";

/// @notice Permissionless settlement of offchain firm quotes. Makers lock capacity occasionally and stream signed
/// quotes without transactions; any address settles an accepted quote in one atomic transaction that verifies both
/// signatures, reserves and binds both risk admissions, registers both orders, draws the maker's capacity and clears.
interface IQuoteSettlementRouter {
    error ZeroDependency(address dependency);
    error DependencyGraphMismatch(address expected, address actual);
    error InvalidCapacityTerms();
    error InvalidCapacitySignature();
    error CapacityNonceUsed(address maker, uint256 nonce);
    error UnknownQuoteCapacity(StreamId capacityId);
    error UnauthorizedCapacityClose(address maker, address caller);
    error QuoteCapacityMismatch(StreamId capacityId);
    error InvalidQuoteSettlement();
    error QuoteAlreadyConsumed(bytes32 quoteOrderHash);
    error QuoteNotAccepted(bytes32 expected, bytes32 actual);
    error SelfTrade(AccountId accountId);
    error PriceNotCrossed(int128 takerLimit, int128 quotePrice);
    error RelayerNotAuthorized(address expected, address actual);
    error RelayerFeeAboveMaximum(uint128 maximum, uint128 charged);
    error RelayerAccountMismatch(AccountId relayerAccountId);
    error SettlementFillMismatch(FillId expected, FillId actual);

    event QuoteCapacityOpened(
        StreamId indexed capacityId,
        address indexed maker,
        AccountId indexed makerAccountId,
        SeriesId seriesId,
        uint32 seriesVersion,
        uint128 maximumLiability,
        uint128 liabilityPerLot,
        uint128 maximumAbsoluteInventoryLots,
        uint64 expiry,
        uint256 nonce,
        address submitter
    );
    event QuoteCapacityClosed(StreamId indexed capacityId, address indexed maker);
    event QuoteSettled(
        FillId indexed fillId,
        bytes32 indexed quoteOrderHash,
        bytes32 indexed takerOrderHash,
        QuoteSettlementReceipt receipt
    );

    function openQuoteCapacity(QuoteCapacityTerms calldata terms, bytes calldata signature)
        external
        returns (StreamId capacityId);
    function closeQuoteCapacity(StreamId capacityId) external;
    function settle(QuoteSettlement calldata settlement) external returns (FillId fillId);

    function quoteCapacity(StreamId capacityId) external view returns (QuoteCapacityRecord memory record);
    function capacityNonceUsed(address maker, uint256 nonce) external view returns (bool);
    function hashCapacityTerms(QuoteCapacityTerms calldata terms) external view returns (bytes32 digest);
    function deriveCapacityId(QuoteCapacityTerms calldata terms) external view returns (StreamId capacityId);
    function hashMakerQuoteTerms(MakerQuoteTerms calldata terms) external pure returns (bytes32);
    function hashTakerSettlementTerms(TakerSettlementTerms calldata terms) external pure returns (bytes32);
    function domainSeparator() external view returns (bytes32);
}
