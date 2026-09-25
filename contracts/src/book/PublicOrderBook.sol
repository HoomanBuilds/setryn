// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPublicBookEligibilityGate} from "../interfaces/IPublicBookEligibilityGate.sol";
import {IPublicOrderBook} from "../interfaces/IPublicOrderBook.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {PublicBookLib} from "../libraries/PublicBookLib.sol";
import {
    BookEligibility,
    BookIdentity,
    BookLiquidityKind,
    BookOrder,
    BookOrderStatus,
    BookRemovalReason,
    LevelHint,
    PriceLevel
} from "../types/BookTypes.sol";
import {PackageClearingRequest, SeriesClearingRequest} from "../types/ClearingTypes.sol";
import {Side} from "../types/Enums.sol";
import {AssetId, BookId, FeeScheduleId, FillId, PackageId, SeriesId} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {
    OrderRecord,
    OrderStatus,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../types/OrderTypes.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract PublicOrderBook is IPublicOrderBook, ReentrancyGuard {
    uint256 public constant MAX_MATCH_CANDIDATES = 16;
    uint256 public constant MAX_PACKAGE_MATCH_CANDIDATES = 4;
    uint256 public constant MAX_AUTO_PRUNE = 4;

    IOrderState private immutable _orderState;
    IAtomicClearingEngine private immutable _clearingEngine;
    ISeriesRegistry private immutable _seriesRegistry;
    IPackageRegistry private immutable _packageRegistry;
    IMarketRegistry private immutable _marketRegistry;
    IPublicBookEligibilityGate private immutable _eligibilityGate;

    mapping(BookId bookId => BookIdentity identity) private _books;
    mapping(bytes32 orderHash => BookOrder order) private _orders;
    mapping(bytes32 levelId => PriceLevel level) private _levels;
    mapping(BookId bookId => mapping(Side side => bytes32 levelId)) private _bestLevels;
    mapping(BookId bookId => mapping(Side side => bytes32 levelId)) private _worstLevels;
    uint64 private _nextSequence;

    constructor(
        IOrderState orderState_,
        IAtomicClearingEngine clearingEngine_,
        IPublicBookEligibilityGate eligibilityGate_
    ) {
        _requireDependency(address(orderState_));
        _requireDependency(address(clearingEngine_));
        _requireDependency(address(eligibilityGate_));
        if (address(clearingEngine_.orderState()) != address(orderState_)) {
            revert DependencyGraphMismatch(address(orderState_), address(clearingEngine_.orderState()));
        }

        ISeriesRegistry seriesRegistry_ = clearingEngine_.seriesRegistry();
        IPackageRegistry packageRegistry_ = clearingEngine_.packageRegistry();
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(packageRegistry_));
        IMarketRegistry marketRegistry_ = seriesRegistry_.marketRegistry();
        _requireDependency(address(marketRegistry_));
        if (address(packageRegistry_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(packageRegistry_.seriesRegistry()));
        }

        _orderState = orderState_;
        _clearingEngine = clearingEngine_;
        _seriesRegistry = seriesRegistry_;
        _packageRegistry = packageRegistry_;
        _marketRegistry = marketRegistry_;
        _eligibilityGate = eligibilityGate_;
    }

    function placeSeriesOrder(bytes32 orderHash, LevelHint calldata hint)
        external
        nonReentrant
        returns (BookId bookId)
    {
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (record.order.targetKind != OrderTargetKind.Series) revert MatchTargetMismatch();
        BookIdentity memory identity = _seriesIdentity(record.order);
        _ensureBook(identity);
        _requireOrderCanRest(orderHash, record, identity.bookId);
        _restOrder(orderHash, record, identity, hint);
        return identity.bookId;
    }

    function placePackageOrder(bytes32 orderHash, PackageLeg[] calldata legs, LevelHint calldata hint)
        external
        nonReentrant
        returns (BookId bookId)
    {
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (record.order.targetKind != OrderTargetKind.Package) revert MatchTargetMismatch();
        bytes32 legsHash = _packageRegistry.hashLegs(legs);
        BookIdentity memory identity = _packageIdentity(record.order, legs, legsHash);
        _ensureBook(identity);
        _requireOrderCanRest(orderHash, record, identity.bookId);
        _restOrder(orderHash, record, identity, hint);
        return identity.bookId;
    }

    function matchSeries(BookId bookId, SeriesClearingRequest[] calldata proposals)
        external
        nonReentrant
        returns (FillId[] memory fillIds)
    {
        _requireMatchBound(proposals.length, MAX_MATCH_CANDIDATES);
        bytes32 takerHash = proposals[0].matchData.takerOrderHash;
        OrderRecord memory taker = _orderState.getOrder(takerHash);
        if (taker.order.targetKind != OrderTargetKind.Series) revert MatchTargetMismatch();
        _prepareTaker(takerHash, taker, _seriesIdentity(taker.order), bookId, proposals.length);

        fillIds = new FillId[](proposals.length);
        uint256 accepted;
        for (uint256 i; i < proposals.length; ++i) {
            SeriesClearingRequest calldata proposal = proposals[i];
            bytes32 makerHash = proposal.matchData.makerOrderHash;
            if (proposal.matchData.takerOrderHash != takerHash) revert MatchTargetMismatch();
            if (!_prepareMakerCandidate(bookId, taker.order.side, makerHash)) continue;
            BookOrder memory maker = _orders[makerHash];
            _validateExecution(proposal.matchData.executionPriceTicks, proposal.matchData.fillLots, maker, taker.order);
            FillId fillId = _clearingEngine.clearSeries(proposal);
            _afterMatch(bookId, takerHash, makerHash, proposal.matchData.fillLots, maker, fillId);
            fillIds[accepted++] = fillId;
            if (i + 1 < proposals.length) _requireTakerContinues(takerHash);
        }
        assembly ("memory-safe") {
            mstore(fillIds, accepted)
        }
    }

    function matchPackage(BookId bookId, PackageClearingRequest[] calldata proposals)
        external
        nonReentrant
        returns (FillId[] memory fillIds)
    {
        _requireMatchBound(proposals.length, MAX_PACKAGE_MATCH_CANDIDATES);
        PackageClearingRequest calldata first = proposals[0];
        bytes32 takerHash = first.matchData.takerOrderHash;
        OrderRecord memory taker = _orderState.getOrder(takerHash);
        if (taker.order.targetKind != OrderTargetKind.Package) revert MatchTargetMismatch();
        bytes32 legsHash = _packageRegistry.hashLegs(first.legs);
        _prepareTaker(takerHash, taker, _packageIdentity(taker.order, first.legs, legsHash), bookId, proposals.length);

        fillIds = new FillId[](proposals.length);
        uint256 accepted;
        for (uint256 i; i < proposals.length; ++i) {
            PackageClearingRequest calldata proposal = proposals[i];
            bytes32 makerHash = proposal.matchData.makerOrderHash;
            if (proposal.matchData.takerOrderHash != takerHash || _packageRegistry.hashLegs(proposal.legs) != legsHash) revert InvalidPackageWitness();
            if (!_prepareMakerCandidate(bookId, taker.order.side, makerHash)) continue;
            BookOrder memory maker = _orders[makerHash];
            _validateExecution(proposal.matchData.executionPriceTicks, proposal.matchData.fillLots, maker, taker.order);
            FillId fillId = _clearingEngine.clearPackage(proposal);
            _afterMatch(bookId, takerHash, makerHash, proposal.matchData.fillLots, maker, fillId);
            fillIds[accepted++] = fillId;
            if (i + 1 < proposals.length) _requireTakerContinues(takerHash);
        }
        assembly ("memory-safe") {
            mstore(fillIds, accepted)
        }
    }

    function syncOrder(bytes32 orderHash) external nonReentrant {
        BookOrder storage cached = _orders[orderHash];
        if (cached.status != BookOrderStatus.Resting) revert OrderNotResting(orderHash);
        _refreshOrder(orderHash);
    }

    function pruneBest(BookId bookId, Side side, bytes32[] calldata candidates) external nonReentrant {
        if (candidates.length == 0 || candidates.length > MAX_MATCH_CANDIDATES) {
            revert InvalidMatchBound(candidates.length, MAX_MATCH_CANDIDATES);
        }
        _requireBook(bookId);
        PublicBookLib.opposite(side);
        for (uint256 i; i < candidates.length; ++i) {
            bytes32 expected = _bestOrder(bookId, side);
            if (expected != candidates[i]) revert BestCandidateMismatch(expected, candidates[i]);
            if (_refreshOrder(expected)) revert EligibleOrderCannotBePruned(expected);
        }
    }

    function getBook(BookId bookId) external view returns (BookIdentity memory) {
        return _requireBook(bookId);
    }

    function getBookOrder(bytes32 orderHash) external view returns (BookOrder memory) {
        BookOrder memory order = _orders[orderHash];
        if (order.status == BookOrderStatus.Unspecified) revert UnknownBookOrder(orderHash);
        return order;
    }

    function getPriceLevel(bytes32 levelId) external view returns (PriceLevel memory) {
        return _levels[levelId];
    }

    function bestLevel(BookId bookId, Side side) external view returns (bytes32 levelId) {
        _requireBook(bookId);
        PublicBookLib.opposite(side);
        return _bestLevels[bookId][side];
    }

    function deriveLevelId(BookId bookId, Side side, PriceTicks priceTicks) external pure returns (bytes32) {
        return PublicBookLib.deriveLevelId(bookId, side, priceTicks);
    }

    function orderState() external view returns (IOrderState) {
        return _orderState;
    }

    function clearingEngine() external view returns (IAtomicClearingEngine) {
        return _clearingEngine;
    }

    function eligibilityGate() external view returns (IPublicBookEligibilityGate) {
        return _eligibilityGate;
    }

    function _restOrder(
        bytes32 orderHash,
        OrderRecord memory record,
        BookIdentity memory identity,
        LevelHint calldata hint
    ) private {
        Side oppositeSide = PublicBookLib.opposite(record.order.side);
        _pruneDeadHeads(identity.bookId, oppositeSide, MAX_AUTO_PRUNE);
        bytes32 oppositeOrderHash = _bestOrder(identity.bookId, oppositeSide);
        if (oppositeOrderHash != bytes32(0)) {
            BookOrder storage oppositeOrder = _orders[oppositeOrderHash];
            if (PublicBookLib.crosses(record.order.side, record.order.priceTicks, oppositeOrder.priceTicks)) {
                if (record.order.postOnly) revert PostOnlyWouldCross(orderHash, oppositeOrderHash);
                revert RestingOrderWouldCross(orderHash, oppositeOrderHash);
            }
        }

        bytes32 levelId = PublicBookLib.deriveLevelId(identity.bookId, record.order.side, record.order.priceTicks);
        PriceLevel storage level = _levels[levelId];
        if (!level.active) _openLevel(identity.bookId, record.order.side, record.order.priceTicks, levelId, hint);

        if (_nextSequence == type(uint64).max) revert SequenceExhausted();
        uint64 sequence = _nextSequence + 1;
        _nextSequence = sequence;
        uint128 remaining = Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots);
        bytes32 previousOrderHash = level.tailOrderHash;
        if (previousOrderHash == bytes32(0)) {
            level.headOrderHash = orderHash;
        } else {
            _orders[previousOrderHash].nextOrderHash = orderHash;
        }
        level.tailOrderHash = orderHash;
        level.totalLots += remaining;
        level.orderCount += 1;
        _orders[orderHash] = BookOrder({
            bookId: identity.bookId,
            orderHash: orderHash,
            levelId: levelId,
            previousOrderHash: previousOrderHash,
            nextOrderHash: bytes32(0),
            sequence: sequence,
            remainingLots: Lots.wrap(remaining),
            priceTicks: record.order.priceTicks,
            side: record.order.side,
            status: BookOrderStatus.Resting
        });
        emit DirectOrderRested(
            identity.bookId,
            orderHash,
            levelId,
            record.order.side,
            record.order.priceTicks,
            Lots.wrap(remaining),
            sequence,
            previousOrderHash,
            BookLiquidityKind.Direct
        );
    }

    function _openLevel(BookId bookId, Side side, PriceTicks priceTicks, bytes32 levelId, LevelHint calldata hint)
        private
    {
        bytes32 previous = hint.previousLevelId;
        bytes32 next = hint.nextLevelId;
        bytes32 best = _bestLevels[bookId][side];
        bytes32 worst = _worstLevels[bookId][side];
        if (
            (previous == bytes32(0) && best != next) || (next == bytes32(0) && worst != previous)
                || (previous != bytes32(0) && (!_levels[previous].active || _levels[previous].nextLevelId != next))
                || (next != bytes32(0) && (!_levels[next].active || _levels[next].previousLevelId != previous))
                || (previous != bytes32(0)
                    && (BookId.unwrap(_levels[previous].bookId) != BookId.unwrap(bookId)
                        || _levels[previous].side != side
                        || !PublicBookLib.isBefore(side, _levels[previous].priceTicks, priceTicks)))
                || (next != bytes32(0)
                    && (BookId.unwrap(_levels[next].bookId) != BookId.unwrap(bookId)
                        || _levels[next].side != side
                        || !PublicBookLib.isBefore(side, priceTicks, _levels[next].priceTicks)))
        ) revert InvalidLevelHint(previous, next);

        _levels[levelId] = PriceLevel({
            bookId: bookId,
            levelId: levelId,
            previousLevelId: previous,
            nextLevelId: next,
            headOrderHash: bytes32(0),
            tailOrderHash: bytes32(0),
            priceTicks: priceTicks,
            totalLots: 0,
            orderCount: 0,
            side: side,
            active: true
        });
        if (previous == bytes32(0)) _bestLevels[bookId][side] = levelId;
        else _levels[previous].nextLevelId = levelId;
        if (next == bytes32(0)) _worstLevels[bookId][side] = levelId;
        else _levels[next].previousLevelId = levelId;
        emit PriceLevelOpened(bookId, levelId, side, priceTicks, previous, next);
    }

    function _prepareTaker(
        bytes32 takerHash,
        OrderRecord memory taker,
        BookIdentity memory identity,
        BookId expectedBookId,
        uint256 proposalCount
    ) private view {
        if (BookId.unwrap(identity.bookId) != BookId.unwrap(expectedBookId)) {
            revert BookIdentityMismatch(expectedBookId, identity.bookId);
        }
        _requireBook(expectedBookId);
        if (_orders[takerHash].status == BookOrderStatus.Resting) revert TakerAlreadyResting(takerHash);
        _requireExecutableRecord(takerHash, taker);
        if (taker.order.permittedExecutor != address(0) && taker.order.permittedExecutor != address(_clearingEngine)) {
            revert ClearingExecutorMismatch(takerHash, address(_clearingEngine), taker.order.permittedExecutor);
        }
        if (taker.order.postOnly) revert AggressivePostOnlyOrder(takerHash);
        if (
            (taker.order.timeInForce == TimeInForce.IOC || taker.order.timeInForce == TimeInForce.FOK)
                && proposalCount != 1
        ) {
            revert SingleFillTimeInForce(takerHash);
        }
        BookEligibility memory eligibility = _eligibilityGate.checkOrder(taker.order, takerHash, expectedBookId);
        if (!eligibility.eligible) revert OrderNotExecutable(takerHash);
    }

    function _prepareMakerCandidate(BookId bookId, Side takerSide, bytes32 makerHash) private returns (bool) {
        bytes32 expected = _bestOrder(bookId, PublicBookLib.opposite(takerSide));
        if (expected != makerHash) revert BestCandidateMismatch(expected, makerHash);
        return _refreshOrder(makerHash);
    }

    function _validateExecution(
        PriceTicks executionPrice,
        Lots fillLots,
        BookOrder memory maker,
        PublicOrder memory taker
    ) private pure {
        if (PriceTicks.unwrap(executionPrice) != PriceTicks.unwrap(maker.priceTicks)) {
            revert MakerPriceMismatch(PriceTicks.unwrap(maker.priceTicks), PriceTicks.unwrap(executionPrice));
        }
        if (!PublicBookLib.crosses(taker.side, taker.priceTicks, maker.priceTicks)) {
            revert TakerPriceDoesNotCross(PriceTicks.unwrap(taker.priceTicks), PriceTicks.unwrap(maker.priceTicks));
        }
        if (Lots.unwrap(fillLots) == 0 || Lots.unwrap(fillLots) > Lots.unwrap(maker.remainingLots)) {
            revert MatchTargetMismatch();
        }
    }

    function _afterMatch(
        BookId bookId,
        bytes32 takerHash,
        bytes32 makerHash,
        Lots fillLots,
        BookOrder memory maker,
        FillId fillId
    ) private {
        _refreshOrder(makerHash);
        emit DirectMatchExecuted(
            bookId, fillId, makerHash, takerHash, fillLots, maker.priceTicks, maker.sequence, BookLiquidityKind.Direct
        );
    }

    function _requireTakerContinues(bytes32 takerHash) private view {
        OrderRecord memory taker = _orderState.getOrder(takerHash);
        _requireExecutableRecord(takerHash, taker);
    }

    function _requireOrderCanRest(bytes32 orderHash, OrderRecord memory record, BookId bookId) private view {
        if (_orders[orderHash].status == BookOrderStatus.Resting) revert OrderAlreadyResting(orderHash);
        _requireExecutableRecord(orderHash, record);
        if (record.order.timeInForce != TimeInForce.GTC && record.order.timeInForce != TimeInForce.GTD) {
            revert RestingTimeInForceUnsupported(orderHash);
        }
        if (record.order.remainderPolicy != RemainderPolicy.KeepOpen) {
            revert RestingRemainderPolicyUnsupported(orderHash);
        }
        if (record.order.permittedExecutor != address(0) && record.order.permittedExecutor != address(_clearingEngine))
        {
            revert ClearingExecutorMismatch(orderHash, address(_clearingEngine), record.order.permittedExecutor);
        }
        BookEligibility memory eligibility = _eligibilityGate.checkOrder(record.order, orderHash, bookId);
        if (!eligibility.eligible) revert OrderNotExecutable(orderHash);
    }

    function _refreshOrder(bytes32 orderHash) private returns (bool live) {
        BookOrder storage cached = _orders[orderHash];
        if (cached.status != BookOrderStatus.Resting) revert OrderNotResting(orderHash);
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (
            (record.status == OrderStatus.Open || record.status == OrderStatus.PartiallyFilled)
                && block.timestamp > record.order.deadline
        ) {
            _orderState.expireOrder(orderHash);
            record = _orderState.getOrder(orderHash);
        }
        BookRemovalReason reason = _terminalReason(record.status);
        if (reason != BookRemovalReason.Unspecified) {
            _removeOrder(orderHash, reason);
            return false;
        }

        uint128 authoritative = Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots);
        uint128 previous = Lots.unwrap(cached.remainingLots);
        if (authoritative > previous) revert CachedQuantityIncrease(orderHash, previous, authoritative);
        if (authoritative != previous) {
            PriceLevel storage level = _levels[cached.levelId];
            level.totalLots -= previous - authoritative;
            cached.remainingLots = Lots.wrap(authoritative);
            emit DirectOrderQuantityChanged(
                cached.bookId, orderHash, cached.levelId, Lots.wrap(previous), Lots.wrap(authoritative)
            );
        }
        BookEligibility memory eligibility = _eligibilityGate.checkOrder(record.order, orderHash, cached.bookId);
        if (!eligibility.eligible) {
            _removeOrder(orderHash, BookRemovalReason.Ineligible);
            return false;
        }
        return eligibility.eligible;
    }

    function _removeOrder(bytes32 orderHash, BookRemovalReason reason) private {
        BookOrder storage order = _orders[orderHash];
        PriceLevel storage level = _levels[order.levelId];
        bytes32 previous = order.previousOrderHash;
        bytes32 next = order.nextOrderHash;
        if (previous == bytes32(0)) level.headOrderHash = next;
        else _orders[previous].nextOrderHash = next;
        if (next == bytes32(0)) level.tailOrderHash = previous;
        else _orders[next].previousOrderHash = previous;

        uint128 removed = Lots.unwrap(order.remainingLots);
        level.totalLots -= removed;
        level.orderCount -= 1;
        order.remainingLots = Lots.wrap(0);
        order.previousOrderHash = bytes32(0);
        order.nextOrderHash = bytes32(0);
        order.status = BookOrderStatus.Removed;
        emit DirectOrderRemoved(order.bookId, orderHash, order.levelId, reason, Lots.wrap(removed));
        if (level.orderCount == 0) _removeLevel(level);
    }

    function _removeLevel(PriceLevel storage level) private {
        BookId bookId = level.bookId;
        Side side = level.side;
        bytes32 levelId = level.levelId;
        bytes32 previous = level.previousLevelId;
        bytes32 next = level.nextLevelId;
        if (previous == bytes32(0)) _bestLevels[bookId][side] = next;
        else _levels[previous].nextLevelId = next;
        if (next == bytes32(0)) _worstLevels[bookId][side] = previous;
        else _levels[next].previousLevelId = previous;
        PriceTicks price = level.priceTicks;
        delete _levels[levelId];
        emit PriceLevelRemoved(bookId, levelId, side, price);
    }

    function _pruneDeadHeads(BookId bookId, Side side, uint256 maximum) private {
        for (uint256 i; i < maximum; ++i) {
            bytes32 orderHash = _bestOrder(bookId, side);
            if (orderHash == bytes32(0) || _refreshOrder(orderHash)) return;
        }
    }

    function _bestOrder(BookId bookId, Side side) private view returns (bytes32) {
        bytes32 levelId = _bestLevels[bookId][side];
        return levelId == bytes32(0) ? bytes32(0) : _levels[levelId].headOrderHash;
    }

    function _seriesIdentity(PublicOrder memory order) private view returns (BookIdentity memory identity) {
        if (!_seriesRegistry.isOpenForNewRisk(order.seriesId, order.targetVersion, _currentDay())) {
            revert OrderNotExecutable(bytes32(0));
        }
        SeriesVersion memory series = _seriesRegistry.getSeries(order.seriesId, order.targetVersion);
        MarketVersion memory market =
            _marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
        if (
            FeeScheduleId.unwrap(order.feeScheduleId) != FeeScheduleId.unwrap(market.definition.feeScheduleId)
                || order.feeScheduleVersion != market.definition.feeScheduleVersion
        ) revert MatchTargetMismatch();
        identity = _identity(
            order,
            SeriesId.unwrap(order.seriesId),
            market.definition.settlementAssetId,
            market.definition.settlementAssetVersion,
            bytes32(0)
        );
    }

    function _packageIdentity(PublicOrder memory order, PackageLeg[] calldata legs, bytes32 legsHash)
        private
        view
        returns (BookIdentity memory identity)
    {
        if (!_packageRegistry.isOpenForNewRisk(order.packageId, order.targetVersion, legs, _currentDay())) {
            revert OrderNotExecutable(bytes32(0));
        }
        PackageVersion memory packageRecord = _packageRegistry.getPackage(order.packageId, order.targetVersion);
        PackageDefinition memory definition = packageRecord.definition;
        if (definition.legsHash != legsHash) revert InvalidPackageWitness();
        identity = _identity(
            order,
            PackageId.unwrap(order.packageId),
            definition.settlementAssetId,
            definition.settlementAssetVersion,
            legsHash
        );
    }

    function _identity(
        PublicOrder memory order,
        bytes32 targetId,
        AssetId settlementAssetId,
        uint32 settlementAssetVersion,
        bytes32 packageLegsHash
    ) private view returns (BookIdentity memory identity) {
        BookId bookId = PublicBookLib.deriveBookId(
            block.chainid,
            address(this),
            address(_orderState),
            order.targetKind,
            targetId,
            order.targetVersion,
            order.executionModeId,
            settlementAssetId,
            settlementAssetVersion,
            order.feeScheduleId,
            order.feeScheduleVersion,
            packageLegsHash
        );
        identity = BookIdentity({
            bookId: bookId,
            targetKind: order.targetKind,
            targetId: targetId,
            targetVersion: order.targetVersion,
            executionModeId: order.executionModeId,
            settlementAssetId: settlementAssetId,
            settlementAssetVersion: settlementAssetVersion,
            feeScheduleId: order.feeScheduleId,
            feeScheduleVersion: order.feeScheduleVersion,
            packageLegsHash: packageLegsHash,
            liquidityKind: BookLiquidityKind.Direct
        });
    }

    function _ensureBook(BookIdentity memory identity) private {
        BookIdentity storage existing = _books[identity.bookId];
        if (BookId.unwrap(existing.bookId) == bytes32(0)) {
            _books[identity.bookId] = identity;
            emit BookOpened(identity.bookId, identity);
            return;
        }
        if (
            existing.targetKind != identity.targetKind || existing.targetId != identity.targetId
                || existing.targetVersion != identity.targetVersion
                || existing.executionModeId != identity.executionModeId
                || AssetId.unwrap(existing.settlementAssetId) != AssetId.unwrap(identity.settlementAssetId)
                || existing.settlementAssetVersion != identity.settlementAssetVersion
                || FeeScheduleId.unwrap(existing.feeScheduleId) != FeeScheduleId.unwrap(identity.feeScheduleId)
                || existing.feeScheduleVersion != identity.feeScheduleVersion
                || existing.packageLegsHash != identity.packageLegsHash
                || existing.liquidityKind != BookLiquidityKind.Direct
        ) revert BookIdentityMismatch(existing.bookId, identity.bookId);
    }

    function _requireExecutableRecord(bytes32 orderHash, OrderRecord memory record) private view {
        if (
            (record.status != OrderStatus.Open && record.status != OrderStatus.PartiallyFilled)
                || block.timestamp > record.order.deadline
        ) revert OrderNotExecutable(orderHash);
    }

    function _terminalReason(OrderStatus status) private pure returns (BookRemovalReason) {
        if (status == OrderStatus.Filled) return BookRemovalReason.Filled;
        if (status == OrderStatus.Cancelled) return BookRemovalReason.Cancelled;
        if (status == OrderStatus.Expired) return BookRemovalReason.Expired;
        if (status == OrderStatus.Rejected) return BookRemovalReason.Rejected;
        return BookRemovalReason.Unspecified;
    }

    function _requireBook(BookId bookId) private view returns (BookIdentity storage identity) {
        identity = _books[bookId];
        if (BookId.unwrap(identity.bookId) == bytes32(0)) revert UnknownBook(bookId);
    }

    function _requireMatchBound(uint256 count, uint256 maximum) private pure {
        if (count == 0 || count > maximum) revert InvalidMatchBound(count, maximum);
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
