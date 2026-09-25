// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "./IAtomicClearingEngine.sol";
import {IOrderState} from "./IOrderState.sol";
import {IPublicBookEligibilityGate} from "./IPublicBookEligibilityGate.sol";
import {
    BookIdentity,
    BookLiquidityKind,
    BookOrder,
    BookRemovalReason,
    LevelHint,
    PriceLevel
} from "../types/BookTypes.sol";
import {SeriesClearingRequest, PackageClearingRequest} from "../types/ClearingTypes.sol";
import {Side} from "../types/Enums.sol";
import {BookId, FillId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

interface IPublicOrderBook {
    event BookOpened(BookId indexed bookId, BookIdentity identity);
    event PriceLevelOpened(
        BookId indexed bookId,
        bytes32 indexed levelId,
        Side indexed side,
        PriceTicks priceTicks,
        bytes32 previousLevelId,
        bytes32 nextLevelId
    );
    event PriceLevelRemoved(BookId indexed bookId, bytes32 indexed levelId, Side indexed side, PriceTicks priceTicks);
    event DirectOrderRested(
        BookId indexed bookId,
        bytes32 indexed orderHash,
        bytes32 indexed levelId,
        Side side,
        PriceTicks priceTicks,
        Lots remainingLots,
        uint64 sequence,
        bytes32 previousOrderHash,
        BookLiquidityKind liquidityKind
    );
    event DirectOrderQuantityChanged(
        BookId indexed bookId,
        bytes32 indexed orderHash,
        bytes32 indexed levelId,
        Lots previousRemainingLots,
        Lots newRemainingLots
    );
    event DirectOrderRemoved(
        BookId indexed bookId,
        bytes32 indexed orderHash,
        bytes32 indexed levelId,
        BookRemovalReason reason,
        Lots removedLots
    );
    event DirectMatchExecuted(
        BookId indexed bookId,
        FillId indexed fillId,
        bytes32 indexed makerOrderHash,
        bytes32 takerOrderHash,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        uint64 makerSequence,
        BookLiquidityKind liquidityKind
    );

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error DependencyGraphMismatch(address expected, address actual);
    error InvalidMatchBound(uint256 requested, uint256 maximum);
    error UnknownBook(BookId bookId);
    error UnknownBookOrder(bytes32 orderHash);
    error BookIdentityMismatch(BookId expected, BookId actual);
    error OrderAlreadyResting(bytes32 orderHash);
    error OrderNotResting(bytes32 orderHash);
    error OrderNotExecutable(bytes32 orderHash);
    error RestingTimeInForceUnsupported(bytes32 orderHash);
    error RestingRemainderPolicyUnsupported(bytes32 orderHash);
    error ClearingExecutorMismatch(bytes32 orderHash, address expected, address actual);
    error AggressivePostOnlyOrder(bytes32 orderHash);
    error RestingOrderWouldCross(bytes32 orderHash, bytes32 oppositeOrderHash);
    error PostOnlyWouldCross(bytes32 orderHash, bytes32 oppositeOrderHash);
    error InvalidLevelHint(bytes32 previousLevelId, bytes32 nextLevelId);
    error SequenceExhausted();
    error BestCandidateMismatch(bytes32 expected, bytes32 actual);
    error MakerPriceMismatch(int128 expected, int128 actual);
    error TakerPriceDoesNotCross(int128 takerLimit, int128 makerPrice);
    error MatchTargetMismatch();
    error TakerAlreadyResting(bytes32 orderHash);
    error SingleFillTimeInForce(bytes32 orderHash);
    error InvalidPackageWitness();
    error CachedQuantityIncrease(bytes32 orderHash, uint128 cached, uint128 authoritative);
    error EligibleOrderCannotBePruned(bytes32 orderHash);

    function placeSeriesOrder(bytes32 orderHash, LevelHint calldata hint) external returns (BookId bookId);
    function placePackageOrder(bytes32 orderHash, PackageLeg[] calldata legs, LevelHint calldata hint)
        external
        returns (BookId bookId);
    function matchSeries(BookId bookId, SeriesClearingRequest[] calldata proposals)
        external
        returns (FillId[] memory fillIds);
    function matchPackage(BookId bookId, PackageClearingRequest[] calldata proposals)
        external
        returns (FillId[] memory fillIds);
    function syncOrder(bytes32 orderHash) external;
    function pruneBest(BookId bookId, Side side, bytes32[] calldata candidates) external;
    function getBook(BookId bookId) external view returns (BookIdentity memory);
    function getBookOrder(bytes32 orderHash) external view returns (BookOrder memory);
    function getPriceLevel(bytes32 levelId) external view returns (PriceLevel memory);
    function bestLevel(BookId bookId, Side side) external view returns (bytes32 levelId);
    function deriveLevelId(BookId bookId, Side side, PriceTicks priceTicks) external pure returns (bytes32);
    function orderState() external view returns (IOrderState);
    function clearingEngine() external view returns (IAtomicClearingEngine);
    function eligibilityGate() external view returns (IPublicBookEligibilityGate);
}
