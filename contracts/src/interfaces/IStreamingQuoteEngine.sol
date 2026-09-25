// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "./IAtomicClearingEngine.sol";
import {IStreamCapacityManager} from "./IStreamCapacityManager.sol";
import {PackageClearingRequest, SeriesClearingRequest} from "../types/ClearingTypes.sol";
import {CollateralLockId, FillId} from "../types/Identifiers.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {StreamFill, StreamId, StreamLadderLevel, StreamPolicy, StreamSizeBand} from "../types/StreamTypes.sol";

interface IStreamingQuoteEngine {
    event StreamRegistered(
        StreamId indexed streamId,
        address indexed maker,
        bytes32 indexed makerOrderHash,
        bytes32 policyHash,
        uint64 expiry
    );
    event StreamCancelled(StreamId indexed streamId, address indexed maker);
    event StreamQuoteFilled(
        StreamId indexed streamId,
        uint64 indexed sequence,
        bytes32 indexed ephemeralQuoteHash,
        FillId fillId,
        int128 inventoryBeforeLots,
        int128 inventoryAfterLots
    );

    error ZeroDependency(address dependency);
    error InvalidSignature(address signer, bytes32 digest);
    error NonceAlreadyUsed(address signer, uint256 nonce);
    error UnknownStream(StreamId streamId);
    error DuplicateStream(StreamId streamId);
    error StreamNotLive(StreamId streamId);
    error UnauthorizedExecutor(address expected, address actual);
    error InvalidSequence(uint64 expected, uint64 actual);
    error InvalidQuoteWindow();
    error QuotePriceMismatch(int128 expected, int128 actual);
    error ClearingRequestMismatch();
    error FundingHashMismatch(bytes32 expected, bytes32 actual);
    error EphemeralQuoteAlreadyUsed(bytes32 quoteHash);

    function registerStream(
        StreamPolicy calldata policy,
        StreamSizeBand[] calldata sizeBands,
        StreamLadderLevel[] calldata ladder,
        bytes calldata signature
    ) external returns (StreamId streamId);
    function cancelStream(StreamId streamId) external;
    function expireStream(StreamId streamId) external;
    function fillSeries(StreamFill calldata fill, SeriesClearingRequest calldata request)
        external
        returns (FillId fillId);
    function fillPackage(
        StreamFill calldata fill,
        PackageLeg[] calldata packageLegs,
        PackageClearingRequest calldata request
    ) external returns (FillId fillId);
    function atomicClearingEngine() external view returns (IAtomicClearingEngine);
    function capacityManager() external view returns (IStreamCapacityManager);
    function nextSequence(StreamId streamId) external view returns (uint64);
    function getPolicy(StreamId streamId) external view returns (StreamPolicy memory);
    function streamExecutable(StreamId streamId) external view returns (bool);
    function previewFirmQuote(StreamId streamId, Lots fillLots)
        external
        view
        returns (
            PriceTicks priceTicks,
            uint64 sequence,
            CollateralLockId capacityLockId,
            uint128 remainingLiability,
            bytes32 snapshotHash
        );
}
