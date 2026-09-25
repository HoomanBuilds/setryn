// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingAdmissionGate} from "../interfaces/IClearingAdmissionGate.sol";
import {IClearingFeePolicy} from "../interfaces/IClearingFeePolicy.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ClearingLib} from "../libraries/ClearingLib.sol";
import {NotionalLib} from "../libraries/NotionalLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    BilateralMatch,
    ClearingAdmission,
    ClearingEntryKind,
    ClearingFeeQuote,
    FillRecord,
    PackageClearingRequest,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeScheduleId,
    FillId,
    PackageId,
    PositionId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {OrderRecord, OrderStatus, OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {PositionCreation, PositionEconomics} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract AtomicClearingEngine is IAtomicClearingEngine, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant MATCH_EXECUTOR_ROLE = keccak256("SETRYN_MATCH_EXECUTOR_ROLE");

    bytes32 public constant TERMINAL_LIABILITY_PURPOSE = keccak256("SETRYN_FILL_TERMINAL_LIABILITY");
    bytes32 public constant CONSIDERATION_PURPOSE = keccak256("SETRYN_FILL_CONSIDERATION");
    bytes32 public constant FEE_PURPOSE = keccak256("SETRYN_FILL_FEE");

    IOrderState private immutable _orderState;
    ISeriesRegistry private immutable _seriesRegistry;
    IPackageRegistry private immutable _packageRegistry;
    IPositionEngine private immutable _positionEngine;
    ICollateralVault private immutable _collateralVault;
    IMarketRegistry private immutable _marketRegistry;
    IClearingAdmissionGate private immutable _admissionGate;
    IClearingFeePolicy private immutable _feePolicy;

    mapping(FillId fillId => FillRecord record) private _fills;
    mapping(FillId fillId => PositionId[] positionIds) private _fillPositions;

    struct MatchContext {
        OrderRecord taker;
        OrderRecord maker;
        bytes32 takerOrderHash;
        bytes32 makerOrderHash;
        FillId fillId;
        Lots takerCumulativeLots;
        Lots makerCumulativeLots;
        AccountId buyerAccountId;
        AccountId sellerAccountId;
        bool takerIsBuyer;
    }

    struct SettlementContext {
        AssetId assetId;
        uint32 bindingVersion;
        int256 considerationMinor;
        uint128 longLiabilityMinor;
        uint128 shortLiabilityMinor;
    }

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IOrderState orderState_,
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IPositionEngine positionEngine_,
        ICollateralVault collateralVault_,
        IClearingAdmissionGate admissionGate_,
        IClearingFeePolicy feePolicy_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(orderState_));
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(packageRegistry_));
        _requireDependency(address(positionEngine_));
        _requireDependency(address(collateralVault_));
        _requireDependency(address(admissionGate_));
        _requireDependency(address(feePolicy_));
        IMarketRegistry marketRegistry_ = seriesRegistry_.marketRegistry();
        _requireDependency(address(marketRegistry_));
        if (address(packageRegistry_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(packageRegistry_.seriesRegistry()));
        }
        if (address(positionEngine_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(positionEngine_.seriesRegistry()));
        }
        if (address(positionEngine_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(positionEngine_.collateralVault()));
        }
        if (address(marketRegistry_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(marketRegistry_.collateralVault()));
        }

        _orderState = orderState_;
        _seriesRegistry = seriesRegistry_;
        _packageRegistry = packageRegistry_;
        _positionEngine = positionEngine_;
        _collateralVault = collateralVault_;
        _marketRegistry = marketRegistry_;
        _admissionGate = admissionGate_;
        _feePolicy = feePolicy_;
        _grantRole(MATCH_EXECUTOR_ROLE, initialAdmin);
    }

    function clearSeries(SeriesClearingRequest calldata request)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        BilateralMatch calldata matchData = request.matchData;
        OrderRecord memory taker = _orderState.getOrder(matchData.takerOrderHash);
        OrderRecord memory maker = _orderState.getOrder(matchData.makerOrderHash);
        if (taker.order.targetKind != OrderTargetKind.Series || maker.order.targetKind != OrderTargetKind.Series) {
            revert OrderTargetMismatch();
        }
        bytes32 witnessHash = keccak256(request.payoffTerms);
        MatchContext memory context = _prepareMatch(matchData, taker, maker, witnessHash, false);

        SeriesId seriesId = taker.order.seriesId;
        uint32 seriesVersion = taker.order.targetVersion;
        if (!_seriesRegistry.isOpenForNewRisk(seriesId, seriesVersion, _currentDay())) revert OrderTargetMismatch();
        SeriesVersion memory series = _seriesRegistry.getSeries(seriesId, seriesVersion);
        MarketVersion memory market =
            _marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
        if (
            FeeScheduleId.unwrap(market.definition.feeScheduleId) != FeeScheduleId.unwrap(taker.order.feeScheduleId)
                || market.definition.feeScheduleVersion != taker.order.feeScheduleVersion
        ) revert FeeScheduleMismatch();
        _validateMarketOrder(market, matchData.fillLots, matchData.executionPriceTicks);

        SettlementContext memory settlement = SettlementContext({
            assetId: market.definition.settlementAssetId,
            bindingVersion: market.definition.settlementAssetVersion,
            considerationMinor: NotionalLib.fillNotional(
                matchData.fillLots, matchData.executionPriceTicks, market.definition.tickSizeMinor
            ),
            longLiabilityMinor: PositionMathLib.checkedAmount(
                series.definition.maxLongDebitMinorPerLot, matchData.fillLots
            ),
            shortLiabilityMinor: PositionMathLib.checkedAmount(
                series.definition.maxShortDebitMinorPerLot, matchData.fillLots
            )
        });

        ClearingFeeQuote memory fees = _quoteAndValidateFees(context, matchData, witnessHash);
        _consumeOrders(context, matchData.fillLots);
        _applyFunding(context, matchData, settlement, fees);

        PositionId positionId = _positionEngine.createPosition(
            PositionCreation({
                fillIdentity: FillId.unwrap(context.fillId),
                seriesId: seriesId,
                seriesVersion: seriesVersion,
                longAccountId: context.buyerAccountId,
                shortAccountId: context.sellerAccountId,
                ordinal: 0,
                lots: matchData.fillLots,
                entryPriceTicks: matchData.executionPriceTicks,
                payoffTerms: request.payoffTerms
            })
        );
        PositionEconomics memory created = _verifyPosition(positionId, context.fillId, 0);
        if (
            created.maxLongDebitMinor != settlement.longLiabilityMinor
                || created.maxShortDebitMinor != settlement.shortLiabilityMinor
        ) revert PositionCreationMismatch(settlement.longLiabilityMinor, created.maxLongDebitMinor);
        _recordPosition(
            context.fillId,
            positionId,
            seriesId,
            seriesVersion,
            0,
            1,
            matchData.fillLots,
            matchData.executionPriceTicks,
            created
        );
        _recordFill(context, matchData, witnessHash, settlement, fees, 1, false);
        return context.fillId;
    }

    function clearPackage(PackageClearingRequest calldata request)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        BilateralMatch calldata matchData = request.matchData;
        OrderRecord memory taker = _orderState.getOrder(matchData.takerOrderHash);
        OrderRecord memory maker = _orderState.getOrder(matchData.makerOrderHash);
        if (taker.order.targetKind != OrderTargetKind.Package || maker.order.targetKind != OrderTargetKind.Package) {
            revert OrderTargetMismatch();
        }
        bytes32 legsHash = _packageRegistry.hashLegs(request.legs);
        bytes32 witnessHash = keccak256(abi.encode(legsHash, request.legEntryPriceTicks, request.legPayoffTerms));
        MatchContext memory context = _prepareMatch(matchData, taker, maker, witnessHash, true);
        PackageId packageId = taker.order.packageId;
        uint32 packageVersion = taker.order.targetVersion;
        if (!_packageRegistry.isOpenForNewRisk(packageId, packageVersion, request.legs, _currentDay())) {
            revert InvalidPackageWitness();
        }
        PackageVersion memory packageRecord = _packageRegistry.getPackage(packageId, packageVersion);
        PackageDefinition memory definition = packageRecord.definition;
        if (
            legsHash != definition.legsHash || request.legs.length != request.legEntryPriceTicks.length
                || request.legs.length != request.legPayoffTerms.length
        ) revert InvalidPackageWitness();
        PackageDefinitionLib.validateOrder(definition, matchData.fillLots, matchData.executionPriceTicks);
        _validatePackageLegPrices(
            definition, request.legs, request.legEntryPriceTicks, matchData.fillLots, matchData.executionPriceTicks
        );

        SettlementContext memory settlement = SettlementContext({
            assetId: definition.settlementAssetId,
            bindingVersion: definition.settlementAssetVersion,
            considerationMinor: PackageDefinitionLib.compileFillNotional(
                definition, matchData.fillLots, matchData.executionPriceTicks
            ),
            longLiabilityMinor: PositionMathLib.checkedAmount(
                definition.maxLongDebitMinorPerPackageLot, matchData.fillLots
            ),
            shortLiabilityMinor: PositionMathLib.checkedAmount(
                definition.maxShortDebitMinorPerPackageLot, matchData.fillLots
            )
        });
        ClearingFeeQuote memory fees = _quoteAndValidateFees(context, matchData, witnessHash);
        _consumeOrders(context, matchData.fillLots);
        _applyFunding(context, matchData, settlement, fees);

        uint256 legCount = request.legs.length;
        uint256 buyerLiabilityCreated;
        uint256 sellerLiabilityCreated;
        for (uint256 i; i < legCount; ++i) {
            PackageLeg calldata leg = request.legs[i];
            Lots legLots = PackageDefinitionLib.legLots(matchData.fillLots, leg.ratio);
            bool packageBuyerIsLong = leg.ratio > 0;
            AccountId longAccountId = packageBuyerIsLong ? context.buyerAccountId : context.sellerAccountId;
            AccountId shortAccountId = packageBuyerIsLong ? context.sellerAccountId : context.buyerAccountId;
            PositionId positionId = _positionEngine.createPosition(
                PositionCreation({
                    fillIdentity: FillId.unwrap(context.fillId),
                    seriesId: leg.seriesId,
                    seriesVersion: leg.seriesVersion,
                    longAccountId: longAccountId,
                    shortAccountId: shortAccountId,
                    ordinal: uint32(i),
                    lots: legLots,
                    entryPriceTicks: request.legEntryPriceTicks[i],
                    payoffTerms: request.legPayoffTerms[i]
                })
            );
            PositionEconomics memory created = _verifyPosition(positionId, context.fillId, uint32(i));
            _recordPosition(
                context.fillId,
                positionId,
                leg.seriesId,
                leg.seriesVersion,
                uint16(i),
                leg.ratio,
                legLots,
                request.legEntryPriceTicks[i],
                created
            );
            if (packageBuyerIsLong) {
                buyerLiabilityCreated += created.maxLongDebitMinor;
                sellerLiabilityCreated += created.maxShortDebitMinor;
            } else {
                buyerLiabilityCreated += created.maxShortDebitMinor;
                sellerLiabilityCreated += created.maxLongDebitMinor;
            }
        }
        if (
            buyerLiabilityCreated != settlement.longLiabilityMinor
                || sellerLiabilityCreated != settlement.shortLiabilityMinor
        ) revert PositionCreationMismatch(settlement.longLiabilityMinor, buyerLiabilityCreated);
        _recordFill(context, matchData, witnessHash, settlement, fees, uint16(legCount), true);
        return context.fillId;
    }

    function reserveOrderFunding(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose, uint128 amount)
        external
        nonReentrant
        returns (CollateralLockId lockId)
    {
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) revert UnauthorizedFundingCaller(orderHash, msg.sender);
        if (record.status != OrderStatus.Open && record.status != OrderStatus.PartiallyFilled) {
            revert OrderTargetMismatch();
        }
        uint128 filled = Lots.unwrap(record.filledLots);
        uint128 total = Lots.unwrap(record.order.lots);
        if (cumulativeLots <= filled || cumulativeLots > total) {
            revert InvalidFundingCumulativeLots(filled, cumulativeLots, total);
        }
        _requireFundingPurpose(purpose);

        (AssetId assetId, uint32 bindingVersion) = _settlementBinding(record);
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
        address settlementOperator = purpose == TERMINAL_LIABILITY_PURPOSE ? address(_positionEngine) : address(this);
        lockId = _collateralVault.createLock(
            fundingReference,
            record.order.accountId,
            assetId,
            bindingVersion,
            amount,
            record.order.deadline,
            settlementOperator
        );
        emit OrderFundingReserved(orderHash, purpose, lockId, cumulativeLots, amount, record.order.deadline, msg.sender);
    }

    function releaseOrderFunding(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose) external nonReentrant {
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) revert UnauthorizedFundingCaller(orderHash, msg.sender);
        _requireFundingPurpose(purpose);
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
        CollateralLockId lockId = _collateralVault.deriveLockId(address(this), fundingReference);
        _collateralVault.releaseLock(lockId);
        emit OrderFundingReleased(orderHash, purpose, lockId, cumulativeLots, msg.sender);
    }

    function getFill(FillId fillId) external view returns (FillRecord memory) {
        FillRecord memory record = _fills[fillId];
        if (FillId.unwrap(record.fillId) == bytes32(0)) revert UnknownFill(fillId);
        return record;
    }

    function fillPositions(FillId fillId) external view returns (PositionId[] memory) {
        if (FillId.unwrap(_fills[fillId].fillId) == bytes32(0)) revert UnknownFill(fillId);
        return _fillPositions[fillId];
    }

    function deriveFundingReference(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose)
        external
        pure
        returns (bytes32)
    {
        return ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
    }

    function orderState() external view returns (IOrderState) {
        return _orderState;
    }

    function seriesRegistry() external view returns (ISeriesRegistry) {
        return _seriesRegistry;
    }

    function packageRegistry() external view returns (IPackageRegistry) {
        return _packageRegistry;
    }

    function positionEngine() external view returns (IPositionEngine) {
        return _positionEngine;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function admissionGate() external view returns (IClearingAdmissionGate) {
        return _admissionGate;
    }

    function feePolicy() external view returns (IClearingFeePolicy) {
        return _feePolicy;
    }

    function _prepareMatch(
        BilateralMatch calldata matchData,
        OrderRecord memory taker,
        OrderRecord memory maker,
        bytes32 witnessHash,
        bool isPackage
    ) private view returns (MatchContext memory context) {
        bool takerIsBuyer = ClearingLib.validateMatch(
            matchData.takerOrderHash,
            taker,
            matchData.makerOrderHash,
            maker,
            matchData.fillLots,
            matchData.executionPriceTicks
        );
        Lots takerCumulative = Lots.wrap(Lots.unwrap(taker.filledLots) + Lots.unwrap(matchData.fillLots));
        Lots makerCumulative = Lots.wrap(Lots.unwrap(maker.filledLots) + Lots.unwrap(matchData.fillLots));
        FillId fillId = ClearingLib.deriveFillId(
            block.chainid,
            address(this),
            matchData.takerOrderHash,
            matchData.makerOrderHash,
            takerCumulative,
            makerCumulative,
            matchData.fillLots,
            matchData.executionPriceTicks,
            witnessHash
        );
        if (FillId.unwrap(_fills[fillId].fillId) != bytes32(0)) revert FillAlreadyExists(fillId);

        bytes32 targetId = isPackage ? PackageId.unwrap(taker.order.packageId) : SeriesId.unwrap(taker.order.seriesId);
        _admissionGate.validateMatch(
            taker.order,
            maker.order,
            ClearingAdmission({
                takerOrderHash: matchData.takerOrderHash,
                makerOrderHash: matchData.makerOrderHash,
                targetId: targetId,
                witnessHash: witnessHash,
                executionModeId: taker.order.executionModeId,
                submitter: msg.sender,
                targetVersion: taker.order.targetVersion,
                fillLots: matchData.fillLots,
                executionPriceTicks: matchData.executionPriceTicks,
                isPackage: isPackage
            })
        );
        context = MatchContext({
            taker: taker,
            maker: maker,
            takerOrderHash: matchData.takerOrderHash,
            makerOrderHash: matchData.makerOrderHash,
            fillId: fillId,
            takerCumulativeLots: takerCumulative,
            makerCumulativeLots: makerCumulative,
            buyerAccountId: takerIsBuyer ? taker.order.accountId : maker.order.accountId,
            sellerAccountId: takerIsBuyer ? maker.order.accountId : taker.order.accountId,
            takerIsBuyer: takerIsBuyer
        });
    }

    function _quoteAndValidateFees(MatchContext memory context, BilateralMatch calldata matchData, bytes32 witnessHash)
        private
        view
        returns (ClearingFeeQuote memory fees)
    {
        fees = _feePolicy.quoteFees(
            context.taker.order, context.maker.order, matchData.fillLots, matchData.executionPriceTicks, witnessHash
        );
        if (
            fees.quoteReference == bytes32(0)
                || FeeScheduleId.unwrap(fees.feeScheduleId) != FeeScheduleId.unwrap(context.taker.order.feeScheduleId)
                || fees.feeScheduleVersion != context.taker.order.feeScheduleVersion
                || AccountId.unwrap(fees.recipientAccountId) == bytes32(0)
        ) revert FeeQuoteMismatch();
        if (fees.takerFeeMinor > context.taker.order.maxFeeMinor) {
            revert FeeAboveOrderMaximum(matchData.takerOrderHash, context.taker.order.maxFeeMinor, fees.takerFeeMinor);
        }
        if (fees.makerFeeMinor > context.maker.order.maxFeeMinor) {
            revert FeeAboveOrderMaximum(matchData.makerOrderHash, context.maker.order.maxFeeMinor, fees.makerFeeMinor);
        }
    }

    function _consumeOrders(MatchContext memory context, Lots fillLots) private {
        bytes32 executionReference = FillId.unwrap(context.fillId);
        _orderState.consumeOrderFill(context.takerOrderHash, fillLots, executionReference);
        _orderState.consumeOrderFill(context.makerOrderHash, fillLots, executionReference);
    }

    function _applyFunding(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        ClearingFeeQuote memory fees
    ) private {
        _applyLiabilityFunding(
            context,
            matchData,
            settlement.assetId,
            settlement.bindingVersion,
            settlement.longLiabilityMinor,
            settlement.shortLiabilityMinor
        );
        _applyConsiderationFunding(context, matchData, settlement, context.fillId);
        _consumeFundingLock(
            matchData.makerOrderHash,
            context.makerCumulativeLots,
            context.maker.order.accountId,
            settlement.assetId,
            settlement.bindingVersion,
            fees.makerFeeMinor,
            matchData.makerFunding.feeLockId,
            fees.recipientAccountId,
            FEE_PURPOSE,
            ClearingEntryKind.MakerFee,
            context.fillId
        );
        _consumeFundingLock(
            matchData.takerOrderHash,
            context.takerCumulativeLots,
            context.taker.order.accountId,
            settlement.assetId,
            settlement.bindingVersion,
            fees.takerFeeMinor,
            matchData.takerFunding.feeLockId,
            fees.recipientAccountId,
            FEE_PURPOSE,
            ClearingEntryKind.TakerFee,
            context.fillId
        );
    }

    function _applyLiabilityFunding(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 longAmount,
        uint128 shortAmount
    ) private {
        bool takerLong = context.takerIsBuyer;
        _releaseLiabilityLock(
            matchData.takerOrderHash,
            context.takerCumulativeLots,
            context.taker.order.accountId,
            assetId,
            bindingVersion,
            takerLong ? longAmount : shortAmount,
            matchData.takerFunding.terminalLiabilityLockId
        );
        _releaseLiabilityLock(
            matchData.makerOrderHash,
            context.makerCumulativeLots,
            context.maker.order.accountId,
            assetId,
            bindingVersion,
            takerLong ? shortAmount : longAmount,
            matchData.makerFunding.terminalLiabilityLockId
        );
    }

    function _applyConsiderationFunding(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        FillId fillId
    ) private {
        int256 signedAmount = settlement.considerationMinor;
        uint256 magnitude = signedAmount < 0 ? uint256(-(signedAmount + 1)) + 1 : uint256(signedAmount);
        if (magnitude > type(uint128).max) revert ConsiderationOverflow(magnitude);
        bool buyerPays = signedAmount >= 0;
        bool takerPays = buyerPays == context.takerIsBuyer;
        CollateralLockId payerLock =
            takerPays ? matchData.takerFunding.considerationLockId : matchData.makerFunding.considerationLockId;
        CollateralLockId otherLock =
            takerPays ? matchData.makerFunding.considerationLockId : matchData.takerFunding.considerationLockId;
        bytes32 payerHash = takerPays ? matchData.takerOrderHash : matchData.makerOrderHash;
        bytes32 otherHash = takerPays ? matchData.makerOrderHash : matchData.takerOrderHash;
        Lots payerCumulative = takerPays ? context.takerCumulativeLots : context.makerCumulativeLots;
        AccountId payer = buyerPays ? context.buyerAccountId : context.sellerAccountId;
        AccountId receiver = buyerPays ? context.sellerAccountId : context.buyerAccountId;
        _requireNoFundingLock(otherHash, CONSIDERATION_PURPOSE, otherLock);
        _consumeFundingLock(
            payerHash,
            payerCumulative,
            payer,
            settlement.assetId,
            settlement.bindingVersion,
            uint128(magnitude),
            payerLock,
            receiver,
            CONSIDERATION_PURPOSE,
            ClearingEntryKind.Consideration,
            fillId
        );
    }

    function _releaseLiabilityLock(
        bytes32 orderHash,
        Lots cumulativeLots,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        CollateralLockId lockId
    ) private {
        if (amount == 0) {
            _requireNoFundingLock(orderHash, TERMINAL_LIABILITY_PURPOSE, lockId);
            return;
        }
        bytes32 fundingReference =
            ClearingLib.deriveFundingReference(orderHash, Lots.unwrap(cumulativeLots), TERMINAL_LIABILITY_PURPOSE);
        _requireFundingLock(
            orderHash,
            TERMINAL_LIABILITY_PURPOSE,
            fundingReference,
            lockId,
            accountId,
            assetId,
            bindingVersion,
            amount,
            address(_positionEngine)
        );
        _collateralVault.releaseLock(lockId);
    }

    function _consumeFundingLock(
        bytes32 orderHash,
        Lots cumulativeLots,
        AccountId payer,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        CollateralLockId lockId,
        AccountId receiver,
        bytes32 purpose,
        ClearingEntryKind kind,
        FillId fillId
    ) private {
        if (amount == 0) {
            _requireNoFundingLock(orderHash, purpose, lockId);
            return;
        }
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, Lots.unwrap(cumulativeLots), purpose);
        _requireFundingLock(
            orderHash, purpose, fundingReference, lockId, payer, assetId, bindingVersion, amount, address(this)
        );
        _collateralVault.consumeLock(lockId, receiver, amount);
        emit FillLedgerEntry(fillId, kind, payer, receiver, amount, fundingReference);
    }

    function _requireFundingLock(
        bytes32 orderHash,
        bytes32 purpose,
        bytes32 fundingReference,
        CollateralLockId lockId,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        address settlementOperator
    ) private view {
        if (CollateralLockId.unwrap(lockId) == bytes32(0)) {
            revert FundingLockRequired(orderHash, purpose);
        }
        CollateralLockId expected = _collateralVault.deriveLockId(address(this), fundingReference);
        if (CollateralLockId.unwrap(expected) != CollateralLockId.unwrap(lockId)) {
            revert FundingLockMismatch(orderHash, purpose);
        }
        CollateralLock memory lock = _collateralVault.getLock(lockId);
        CollateralId expectedCollateral = _collateralVault.deriveCollateralId(assetId, bindingVersion);
        if (
            lock.status != LockStatus.Active || lock.operator != address(this)
                || lock.settlementOperator != settlementOperator || lock.lockReference != fundingReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(accountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(assetId) || lock.bindingVersion != bindingVersion
                || lock.remainingAmount != amount || block.timestamp >= lock.expiry
        ) revert FundingLockMismatch(orderHash, purpose);
    }

    function _requireNoFundingLock(bytes32 orderHash, bytes32 purpose, CollateralLockId lockId) private pure {
        if (CollateralLockId.unwrap(lockId) != bytes32(0)) revert FundingLockUnexpected(orderHash, purpose);
    }

    function _validatePackageLegPrices(
        PackageDefinition memory definition,
        PackageLeg[] calldata legs,
        PriceTicks[] calldata legPrices,
        Lots packageLots,
        PriceTicks packagePrice
    ) private view {
        int256 actual;
        for (uint256 i; i < legs.length; ++i) {
            SeriesVersion memory series = _seriesRegistry.getSeries(legs[i].seriesId, legs[i].seriesVersion);
            MarketVersion memory market =
                _marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
            Lots ratioLots = Lots.wrap(uint128(PackageDefinitionLib.ratioMagnitude(legs[i].ratio)));
            int256 legValue = NotionalLib.fillNotional(ratioLots, legPrices[i], market.definition.tickSizeMinor);
            actual += legs[i].ratio > 0 ? legValue : -legValue;
            _validateMarketOrder(market, PackageDefinitionLib.legLots(packageLots, legs[i].ratio), legPrices[i]);
        }
        int256 expected = NotionalLib.fillNotional(Lots.wrap(1), packagePrice, definition.tickSizeMinor);
        if (actual != expected) revert PackageLegPriceMismatch(expected, actual);
    }

    function _validateMarketOrder(MarketVersion memory market, Lots lots, PriceTicks priceTicks) private pure {
        uint128 rawLots = Lots.unwrap(lots);
        uint128 step = Lots.unwrap(market.definition.lotStep);
        int128 rawPrice = PriceTicks.unwrap(priceTicks);
        if (
            step == 0 || rawLots < Lots.unwrap(market.definition.minOrderLots)
                || rawLots > Lots.unwrap(market.definition.maxOrderLots) || rawLots % step != 0
                || rawPrice < PriceTicks.unwrap(market.definition.minPriceTicks)
                || rawPrice > PriceTicks.unwrap(market.definition.maxPriceTicks)
        ) revert OrderTargetMismatch();
    }

    function _settlementBinding(OrderRecord memory record)
        private
        view
        returns (AssetId assetId, uint32 bindingVersion)
    {
        if (record.order.targetKind == OrderTargetKind.Series) {
            SeriesVersion memory series = _seriesRegistry.getSeries(record.order.seriesId, record.order.targetVersion);
            MarketVersion memory market =
                _marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
            return (market.definition.settlementAssetId, market.definition.settlementAssetVersion);
        }
        if (record.order.targetKind == OrderTargetKind.Package) {
            PackageVersion memory packageRecord =
                _packageRegistry.getPackage(record.order.packageId, record.order.targetVersion);
            return (packageRecord.definition.settlementAssetId, packageRecord.definition.settlementAssetVersion);
        }
        revert OrderTargetMismatch();
    }

    function _verifyPosition(PositionId positionId, FillId fillId, uint32 ordinal)
        private
        view
        returns (PositionEconomics memory economics)
    {
        (economics,) = _positionEngine.getPosition(positionId);
        if (economics.fillIdentity != FillId.unwrap(fillId) || economics.ordinal != ordinal) {
            revert PositionCreationMismatch(ordinal, economics.ordinal);
        }
    }

    function _recordPosition(
        FillId fillId,
        PositionId positionId,
        SeriesId seriesId,
        uint32 seriesVersion,
        uint16 ordinal,
        int32 ratio,
        Lots lots,
        PriceTicks entryPriceTicks,
        PositionEconomics memory economics
    ) private {
        _fillPositions[fillId].push(positionId);
        emit FillPositionCreated(
            fillId,
            positionId,
            SeriesId.unwrap(seriesId),
            seriesVersion,
            ordinal,
            ratio,
            Lots.unwrap(lots),
            PriceTicks.unwrap(entryPriceTicks),
            TerminalLiabilityReservationId.unwrap(economics.longReservationId),
            TerminalLiabilityReservationId.unwrap(economics.shortReservationId)
        );
    }

    function _recordFill(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        bytes32 witnessHash,
        SettlementContext memory settlement,
        ClearingFeeQuote memory fees,
        uint16 positionCount,
        bool isPackage
    ) private {
        bytes32 targetId = isPackage
            ? PackageId.unwrap(context.taker.order.packageId)
            : SeriesId.unwrap(context.taker.order.seriesId);
        FillRecord memory record = FillRecord({
            fillId: context.fillId,
            takerOrderHash: matchData.takerOrderHash,
            makerOrderHash: matchData.makerOrderHash,
            targetId: targetId,
            witnessHash: witnessHash,
            executionModeId: context.taker.order.executionModeId,
            settlementAssetId: settlement.assetId,
            buyerAccountId: context.buyerAccountId,
            sellerAccountId: context.sellerAccountId,
            feeRecipientAccountId: fees.recipientAccountId,
            feeQuoteReference: fees.quoteReference,
            targetVersion: context.taker.order.targetVersion,
            settlementAssetVersion: settlement.bindingVersion,
            clearedAt: uint64(block.timestamp),
            fillLots: matchData.fillLots,
            takerCumulativeLots: context.takerCumulativeLots,
            makerCumulativeLots: context.makerCumulativeLots,
            executionPriceTicks: matchData.executionPriceTicks,
            considerationMinor: settlement.considerationMinor,
            makerFeeMinor: fees.makerFeeMinor,
            takerFeeMinor: fees.takerFeeMinor,
            positionCount: positionCount,
            isPackage: isPackage
        });
        _fills[context.fillId] = record;
        emit FillCleared(context.fillId, record, msg.sender);
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _requireFundingPurpose(bytes32 purpose) private pure {
        if (purpose != TERMINAL_LIABILITY_PURPOSE && purpose != CONSIDERATION_PURPOSE && purpose != FEE_PURPOSE) {
            revert InvalidFundingPurpose(purpose);
        }
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
