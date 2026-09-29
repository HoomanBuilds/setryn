// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingAdmissionGate} from "../interfaces/IClearingAdmissionGate.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ClearingLib} from "../libraries/ClearingLib.sol";
import {ClearingFeeLib} from "../libraries/ClearingFeeLib.sol";
import {ClearingChannelLib} from "../libraries/ClearingChannelLib.sol";
import {FeeScheduleDefinitionLib} from "../libraries/FeeScheduleDefinitionLib.sol";
import {NotionalLib} from "../libraries/NotionalLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    CapacityDispositionKind,
    CapacityReservationDisposition,
    ClearingHandoffClaim,
    ClearingHandoffKind,
    UnusedCapacityPolicy,
    VerifiedClearingHandoff
} from "../types/ClearingHandoffTypes.sol";
import {
    BilateralMatch,
    ClearingAdmission,
    ClearingChannelKind,
    ClearingEntryKind,
    ClearingFeeFunding,
    FillRecord,
    PackageClearingRequest,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {LockStatus, Side} from "../types/Enums.sol";
import {FeeActionRequest, FeeActionResult, FeeComputation} from "../types/FeeEngineTypes.sol";
import {FeeScheduleVersion} from "../types/FeeScheduleDefinition.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeActionId,
    FeeScheduleId,
    FillId,
    PackageId,
    PositionId,
    RiskDomainId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {OrderRecord, OrderStatus, OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {PositionCreation, PositionEconomics, PositionFunding, PositionLiabilitySide} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RiskAdmission, RiskAdmissionConsumption, RiskAdmissionId, RiskAdmissionStatus} from "../types/RiskTypes.sol";

contract AtomicClearingEngine is IAtomicClearingEngine, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant MATCH_EXECUTOR_ROLE = keccak256("SETRYN_MATCH_EXECUTOR_ROLE");

    bytes32 public constant TERMINAL_LIABILITY_PURPOSE = keccak256("SETRYN_FILL_TERMINAL_LIABILITY");
    bytes32 public constant CONSIDERATION_PURPOSE = keccak256("SETRYN_FILL_CONSIDERATION");
    bytes32 private constant DIRECT_CHANNEL_TYPEHASH =
        keccak256("SetrynDirectClearingChannelV1(bytes32 fillId,address submitter,bytes32 witnessHash)");
    bytes32 private constant ROUTE_COMMITMENT_TYPEHASH = keccak256(
        "SetrynClearingRouteV1(bytes32 fillId,bytes32 takerOrderHash,bytes32 makerOrderHash,bytes32 executionModeId,bytes32 witnessHash)"
    );
    IOrderState private immutable _orderState;
    ISeriesRegistry private immutable _seriesRegistry;
    IPackageRegistry private immutable _packageRegistry;
    IPositionEngine private immutable _positionEngine;
    ICollateralVault private immutable _collateralVault;
    IMarketRegistry private immutable _marketRegistry;
    IClearingAdmissionGate private immutable _admissionGate;
    IFundedFeeEngine private immutable _fundedFeeEngine;
    IPortfolioRiskEngine private immutable _riskEngine;

    mapping(FillId fillId => FillRecord record) private _fills;
    mapping(FillId fillId => PositionId[] positionIds) private _fillPositions;
    mapping(ClearingChannelKind channelKind => IClearingChannelHandoffAdapter adapter) private _channelAdapters;
    mapping(ClearingChannelKind channelKind => bytes32 capabilityHash) private _channelCapabilities;

    struct MatchContext {
        OrderRecord taker;
        OrderRecord maker;
        bytes32 takerOrderHash;
        bytes32 makerOrderHash;
        FillId fillId;
        Lots takerCumulativeLots;
        Lots makerCumulativeLots;
        Lots fillLots;
        PriceTicks executionPriceTicks;
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

    struct FeeContext {
        FeeActionResult maker;
        FeeActionResult taker;
    }

    struct PackagePositionResult {
        PositionId[] exposurePositions;
        uint256 buyerLiabilityCreated;
        uint256 sellerLiabilityCreated;
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
        IFundedFeeEngine fundedFeeEngine_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(orderState_));
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(packageRegistry_));
        _requireDependency(address(positionEngine_));
        _requireDependency(address(collateralVault_));
        _requireDependency(address(admissionGate_));
        _requireDependency(address(fundedFeeEngine_));
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
        if (address(fundedFeeEngine_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(fundedFeeEngine_.collateralVault()));
        }
        IPortfolioRiskEngine riskEngine_ = admissionGate_.riskEngine();
        _requireDependency(address(riskEngine_));

        _orderState = orderState_;
        _seriesRegistry = seriesRegistry_;
        _packageRegistry = packageRegistry_;
        _positionEngine = positionEngine_;
        _collateralVault = collateralVault_;
        _marketRegistry = marketRegistry_;
        _admissionGate = admissionGate_;
        _fundedFeeEngine = fundedFeeEngine_;
        _riskEngine = riskEngine_;
        _grantRole(MATCH_EXECUTOR_ROLE, initialAdmin);
    }

    function clearSeries(SeriesClearingRequest calldata request)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        ClearingChannelLib.requireDirect(request.channelKind);
        ClearingHandoffClaim memory emptyClaim;
        return _clearSeries(request, emptyClaim, address(0));
    }

    function clearSeriesWithHandoff(SeriesClearingRequest calldata request, ClearingHandoffClaim calldata claim)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        (ClearingHandoffClaim memory verifiedClaim, address source) = _consumeChannelHandoff(request.channelKind, claim);
        return _clearSeries(request, verifiedClaim, source);
    }

    function previewSeriesFillId(
        bytes32 takerOrderHash,
        bytes32 makerOrderHash,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes calldata payoffTerms
    ) external view returns (FillId fillId) {
        OrderRecord memory taker = _orderState.getOrder(takerOrderHash);
        OrderRecord memory maker = _orderState.getOrder(makerOrderHash);
        return ClearingLib.deriveFillId(
            block.chainid,
            address(this),
            takerOrderHash,
            makerOrderHash,
            Lots.wrap(Lots.unwrap(taker.filledLots) + Lots.unwrap(fillLots)),
            Lots.wrap(Lots.unwrap(maker.filledLots) + Lots.unwrap(fillLots)),
            fillLots,
            executionPriceTicks,
            keccak256(payoffTerms)
        );
    }

    function _clearSeries(
        SeriesClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        address channelSource
    ) private returns (FillId fillId) {
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

        _consumeOrders(context, matchData.fillLots);
        _consumeRiskAdmissions(context, matchData, settlement, 1);
        _validateChannelMatch(context, matchData, request.channelKind, channelClaim, bytes32(0));
        _applyFunding(context, matchData, settlement, request.channelKind, channelClaim);
        FeeContext memory fees = _consumeFees(context, matchData, settlement, request.channelKind);

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
                longFunding: _positionFunding(
                    channelClaim, 0, true, context.buyerAccountId, settlement.longLiabilityMinor
                ),
                shortFunding: _positionFunding(
                    channelClaim, 0, false, context.sellerAccountId, settlement.shortLiabilityMinor
                ),
                payoffTerms: request.payoffTerms
            })
        );
        PositionEconomics memory created = _verifyPosition(positionId, context.fillId, 0);
        PositionId[] memory exposurePositions = new PositionId[](1);
        exposurePositions[0] = positionId;
        _bindRiskExposures(matchData, FillId.unwrap(context.fillId), exposurePositions);
        _verifyAdoptedReservation(channelClaim, 0, true, created.longReservationId);
        _verifyAdoptedReservation(channelClaim, 0, false, created.shortReservationId);
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
            created.longReservationId,
            created.shortReservationId
        );
        _recordFill(
            context,
            matchData,
            witnessHash,
            settlement,
            fees,
            1,
            false,
            request.channelKind,
            channelClaim,
            channelSource
        );
        return context.fillId;
    }

    function clearPackage(PackageClearingRequest calldata request)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        ClearingChannelLib.requireDirect(request.channelKind);
        ClearingHandoffClaim memory emptyClaim;
        return _clearPackage(request, emptyClaim, address(0));
    }

    function clearPackageWithHandoff(PackageClearingRequest calldata request, ClearingHandoffClaim calldata claim)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        (ClearingHandoffClaim memory verifiedClaim, address source) = _consumeChannelHandoff(request.channelKind, claim);
        return _clearPackage(request, verifiedClaim, source);
    }

    function _clearPackage(
        PackageClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        address channelSource
    ) private returns (FillId fillId) {
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
        _consumeOrders(context, matchData.fillLots);
        _consumeRiskAdmissions(context, matchData, settlement, uint16(request.legs.length));
        _validateChannelMatch(context, matchData, request.channelKind, channelClaim, legsHash);
        _applyFunding(context, matchData, settlement, request.channelKind, channelClaim);
        FeeContext memory fees = _consumeFees(context, matchData, settlement, request.channelKind);

        PackagePositionResult memory positions = _createPackagePositions(request, channelClaim, context);
        if (
            positions.buyerLiabilityCreated != settlement.longLiabilityMinor
                || positions.sellerLiabilityCreated != settlement.shortLiabilityMinor
        ) revert PositionCreationMismatch(settlement.longLiabilityMinor, positions.buyerLiabilityCreated);
        _bindRiskExposures(matchData, FillId.unwrap(context.fillId), positions.exposurePositions);
        _recordFill(
            context,
            matchData,
            witnessHash,
            settlement,
            fees,
            uint16(request.legs.length),
            true,
            request.channelKind,
            channelClaim,
            channelSource
        );
        return context.fillId;
    }

    function _createPackagePositions(
        PackageClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        MatchContext memory context
    ) private returns (PackagePositionResult memory result) {
        uint256 legCount = request.legs.length;
        result.exposurePositions = new PositionId[](legCount);
        for (uint256 i; i < legCount; ++i) {
            (PositionId positionId, uint128 buyerLiability, uint128 sellerLiability) =
                _createPackagePosition(request, channelClaim, context, i);
            result.exposurePositions[i] = positionId;
            result.buyerLiabilityCreated += buyerLiability;
            result.sellerLiabilityCreated += sellerLiability;
        }
    }

    function _createPackagePosition(
        PackageClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        MatchContext memory context,
        uint256 index
    ) private returns (PositionId positionId, uint128 buyerLiability, uint128 sellerLiability) {
        PackageLeg calldata leg = request.legs[index];
        Lots legLots = PackageDefinitionLib.legLots(request.matchData.fillLots, leg.ratio);
        bool packageBuyerIsLong = leg.ratio > 0;
        AccountId longAccountId = packageBuyerIsLong ? context.buyerAccountId : context.sellerAccountId;
        AccountId shortAccountId = packageBuyerIsLong ? context.sellerAccountId : context.buyerAccountId;
        SeriesVersion memory legSeries = _seriesRegistry.getSeries(leg.seriesId, leg.seriesVersion);
        uint128 createdLongAmount = PositionMathLib.checkedAmount(legSeries.definition.maxLongDebitMinorPerLot, legLots);
        uint128 createdShortAmount =
            PositionMathLib.checkedAmount(legSeries.definition.maxShortDebitMinorPerLot, legLots);
        positionId = _positionEngine.createPosition(
            PositionCreation({
                fillIdentity: FillId.unwrap(context.fillId),
                seriesId: leg.seriesId,
                seriesVersion: leg.seriesVersion,
                longAccountId: longAccountId,
                shortAccountId: shortAccountId,
                ordinal: uint32(index),
                lots: legLots,
                entryPriceTicks: request.legEntryPriceTicks[index],
                longFunding: _positionFunding(channelClaim, uint32(index), true, longAccountId, createdLongAmount),
                shortFunding: _positionFunding(channelClaim, uint32(index), false, shortAccountId, createdShortAmount),
                payoffTerms: request.legPayoffTerms[index]
            })
        );
        PositionEconomics memory created = _verifyPosition(positionId, context.fillId, uint32(index));
        _verifyAdoptedReservation(channelClaim, uint32(index), true, created.longReservationId);
        _verifyAdoptedReservation(channelClaim, uint32(index), false, created.shortReservationId);
        _recordPosition(
            context.fillId,
            positionId,
            leg.seriesId,
            leg.seriesVersion,
            uint16(index),
            leg.ratio,
            legLots,
            request.legEntryPriceTicks[index],
            created.longReservationId,
            created.shortReservationId
        );
        buyerLiability = packageBuyerIsLong ? created.maxLongDebitMinor : created.maxShortDebitMinor;
        sellerLiability = packageBuyerIsLong ? created.maxShortDebitMinor : created.maxLongDebitMinor;
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

    function reserveOrderFeeFunding(
        bytes32 orderHash,
        bytes32 parentActionId,
        FeeActionId actionId,
        uint32 actionOrdinal,
        uint128 notionalMinor
    ) external nonReentrant returns (bytes32 consumptionId, CollateralLockId lockId, uint128 chargeMinor) {
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) revert UnauthorizedFundingCaller(orderHash, msg.sender);
        if (record.status != OrderStatus.Open && record.status != OrderStatus.PartiallyFilled) {
            revert OrderTargetMismatch();
        }
        if (
            FeeActionId.unwrap(actionId) != FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL)
                && FeeActionId.unwrap(actionId) != FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL)
        ) revert InvalidFeeFundingAction(actionId);

        FeeComputation memory computation = _fundedFeeEngine.previewFeeAction(
            record.order.feeScheduleId, record.order.feeScheduleVersion, actionId, notionalMinor, 0
        );
        if (computation.chargeMinor > record.order.maxFeeMinor) {
            revert FeeFundingAboveOrderMaximum(record.order.maxFeeMinor, computation.chargeMinor);
        }
        if (computation.rebateMinor != 0) revert FeeRebateFundingUnsupported(computation.rebateMinor);

        consumptionId = _fundedFeeEngine.deriveConsumptionId(
            parentActionId,
            record.order.feeScheduleId,
            record.order.feeScheduleVersion,
            actionId,
            record.order.accountId,
            record.order.accountId,
            actionOrdinal
        );
        chargeMinor = computation.chargeMinor;
        if (chargeMinor == 0) return (consumptionId, CollateralLockId.wrap(bytes32(0)), 0);

        (AssetId assetId, uint32 bindingVersion) = _settlementBinding(record);
        bytes32 fundingReference =
            _fundedFeeEngine.deriveFundingReference(consumptionId, _fundedFeeEngine.CHARGE_FUNDING_PURPOSE());
        lockId = _collateralVault.createLock(
            fundingReference,
            record.order.accountId,
            assetId,
            bindingVersion,
            chargeMinor,
            record.order.deadline,
            address(_fundedFeeEngine)
        );
        emit OrderFeeFundingReserved(
            orderHash, consumptionId, actionId, lockId, chargeMinor, record.order.deadline, msg.sender
        );
    }

    function releaseOrderFeeFunding(bytes32 orderHash, bytes32 consumptionId) external nonReentrant {
        OrderRecord memory record = _orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) revert UnauthorizedFundingCaller(orderHash, msg.sender);
        bytes32 fundingReference =
            _fundedFeeEngine.deriveFundingReference(consumptionId, _fundedFeeEngine.CHARGE_FUNDING_PURPOSE());
        CollateralLockId lockId = _collateralVault.deriveLockId(address(this), fundingReference);
        _collateralVault.releaseLock(lockId);
        emit OrderFeeFundingReleased(orderHash, consumptionId, lockId, msg.sender);
    }

    function getFill(FillId fillId) external view returns (FillRecord memory record) {
        record = _fills[fillId];
        if (FillId.unwrap(record.fillId) == bytes32(0)) revert UnknownFill(fillId);
    }

    function fillPositions(FillId fillId) external view returns (PositionId[] memory positionIds) {
        if (FillId.unwrap(_fills[fillId].fillId) == bytes32(0)) revert UnknownFill(fillId);
        positionIds = _fillPositions[fillId];
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

    function fundedFeeEngine() external view returns (IFundedFeeEngine) {
        return _fundedFeeEngine;
    }

    function riskEngine() external view returns (IPortfolioRiskEngine) {
        return _riskEngine;
    }

    function activateClearingChannel(
        ClearingChannelKind channelKind,
        IClearingChannelHandoffAdapter adapter,
        bytes32 capabilityHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (channelKind != ClearingChannelKind.PrivateRfq && channelKind != ClearingChannelKind.SealedAuction) {
            revert UnsupportedClearingChannel(channelKind);
        }
        if (address(_channelAdapters[channelKind]) != address(0)) revert ClearingChannelAlreadyActivated(channelKind);
        _requireDependency(address(adapter));
        if (adapter.source() != address(adapter)) {
            revert ClearingChannelSourceMismatch(address(adapter), adapter.source());
        }
        if (capabilityHash == bytes32(0)) revert ClearingHandoffMismatch();
        _channelAdapters[channelKind] = adapter;
        _channelCapabilities[channelKind] = capabilityHash;
        emit ClearingChannelActivated(channelKind, address(adapter), capabilityHash);
    }

    function clearingChannelAdapter(ClearingChannelKind channelKind)
        external
        view
        returns (IClearingChannelHandoffAdapter)
    {
        return _channelAdapters[channelKind];
    }

    function _consumeChannelHandoff(ClearingChannelKind channelKind, ClearingHandoffClaim calldata claim)
        private
        returns (ClearingHandoffClaim memory verifiedClaim, address source)
    {
        ClearingHandoffKind expectedKind;
        if (channelKind == ClearingChannelKind.PrivateRfq) expectedKind = ClearingHandoffKind.PrivateRfq;
        else if (channelKind == ClearingChannelKind.SealedAuction) expectedKind = ClearingHandoffKind.SealedAuction;
        else revert UnsupportedClearingChannel(channelKind);
        if (claim.kind != expectedKind || claim.consumptionId == bytes32(0) || claim.sourceCommitment == bytes32(0)) {
            revert ClearingHandoffMismatch();
        }
        if (claim.deadline < block.timestamp) revert ClearingHandoffMismatch();
        IClearingChannelHandoffAdapter adapter = _channelAdapters[channelKind];
        if (address(adapter) == address(0) || _channelCapabilities[channelKind] == bytes32(0)) {
            revert UnsupportedClearingChannel(channelKind);
        }
        source = adapter.source();
        if (source != address(adapter)) revert ClearingChannelSourceMismatch(address(adapter), source);
        VerifiedClearingHandoff memory handoff = adapter.consumeTypedHandoff(claim);
        if (
            handoff.provenanceHash == bytes32(0) || keccak256(abi.encode(handoff.claim)) != keccak256(abi.encode(claim))
        ) {
            revert ClearingHandoffMismatch();
        }
        verifiedClaim = handoff.claim;
    }

    function _validateChannelMatch(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory claim,
        bytes32 packageLegsHash
    ) private view {
        if (channelKind == ClearingChannelKind.Direct) {
            if (claim.consumptionId != bytes32(0)) revert ClearingHandoffMismatch();
            return;
        }
        bool packageTarget = context.taker.order.targetKind == OrderTargetKind.Package;
        if (
            claim.takerOrderHash != context.takerOrderHash || claim.makerOrderHash != context.makerOrderHash
                || AccountId.unwrap(claim.takerAccountId) != AccountId.unwrap(context.taker.order.accountId)
                || AccountId.unwrap(claim.makerAccountId) != AccountId.unwrap(context.maker.order.accountId)
                || claim.takerSide != context.taker.order.side || claim.targetKind != context.taker.order.targetKind
                || claim.targetVersion != context.taker.order.targetVersion || Lots.unwrap(claim.fillLots) == 0
                || FeeScheduleId.unwrap(claim.feeScheduleId) != FeeScheduleId.unwrap(context.taker.order.feeScheduleId)
                || claim.feeScheduleVersion != context.taker.order.feeScheduleVersion
                || claim.takerMaximumFeeMinor != context.taker.order.maxFeeMinor
                || claim.makerMaximumFeeMinor != context.maker.order.maxFeeMinor
                || claim.executionModeId != context.taker.order.executionModeId
                || RiskAdmissionId.unwrap(claim.longAdmissionId) != RiskAdmissionId.unwrap(matchData.longAdmissionId)
                || claim.longAdmissionResultHash != matchData.longAdmissionResultHash
                || RiskAdmissionId.unwrap(claim.shortAdmissionId) != RiskAdmissionId.unwrap(matchData.shortAdmissionId)
                || claim.shortAdmissionResultHash != matchData.shortAdmissionResultHash
                || claim.deadline > context.taker.order.deadline || claim.deadline > context.maker.order.deadline
        ) revert ClearingHandoffMismatch();
        if (
            Lots.unwrap(claim.fillLots) != Lots.unwrap(context.fillLots)
                || PriceTicks.unwrap(claim.executionPriceTicks) != PriceTicks.unwrap(context.executionPriceTicks)
        ) revert ClearingHandoffMismatch();
        if (packageTarget) {
            if (
                PackageId.unwrap(claim.packageId) != PackageId.unwrap(context.taker.order.packageId)
                    || SeriesId.unwrap(claim.seriesId) != bytes32(0) || claim.packageWitnessHash != packageLegsHash
                    || _packageRegistry.hashLegs(claim.packageLegs) != packageLegsHash
            ) revert ClearingHandoffMismatch();
        } else if (
            SeriesId.unwrap(claim.seriesId) != SeriesId.unwrap(context.taker.order.seriesId)
                || PackageId.unwrap(claim.packageId) != bytes32(0) || claim.packageWitnessHash != bytes32(0)
                || claim.packageLegs.length != 0
        ) {
            revert ClearingHandoffMismatch();
        }

        uint256 previousKey;
        uint256 positionCount = packageTarget ? claim.packageLegs.length : 1;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            uint256 key = uint256(disposition.positionOrdinal) * 3 + uint8(disposition.side);
            if (
                disposition.capacityDisposition != CapacityDispositionKind.ConvertedToTerminalLiability
                    || disposition.side == PositionLiabilitySide.Unspecified
                    || disposition.positionOrdinal >= positionCount
                    || AccountId.unwrap(disposition.accountId) == bytes32(0) || disposition.reservationAmount == 0
                    || TerminalLiabilityReservationId.unwrap(disposition.reservationId) == bytes32(0)
                    || disposition.unusedCapacityPolicy == UnusedCapacityPolicy.Unspecified
                    || CollateralLockId.unwrap(disposition.funding.lockId) == bytes32(0)
                    || disposition.funding.lockReference == bytes32(0)
                    || disposition.funding.expectedRemainingAmount < disposition.reservationAmount
                    || disposition.funding.expectedExpiry <= block.timestamp || (i != 0 && key <= previousKey)
            ) revert ClearingHandoffMismatch();
            previousKey = key;
        }
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
                longAdmissionId: matchData.longAdmissionId,
                longAdmissionResultHash: matchData.longAdmissionResultHash,
                shortAdmissionId: matchData.shortAdmissionId,
                shortAdmissionResultHash: matchData.shortAdmissionResultHash,
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
            fillLots: matchData.fillLots,
            executionPriceTicks: matchData.executionPriceTicks,
            buyerAccountId: takerIsBuyer ? taker.order.accountId : maker.order.accountId,
            sellerAccountId: takerIsBuyer ? maker.order.accountId : taker.order.accountId,
            takerIsBuyer: takerIsBuyer
        });
    }

    function _consumeOrders(MatchContext memory context, Lots fillLots) private {
        bytes32 executionReference = FillId.unwrap(context.fillId);
        _orderState.consumeOrderFill(context.takerOrderHash, fillLots, executionReference);
        _orderState.consumeOrderFill(context.makerOrderHash, fillLots, executionReference);
    }

    function _consumeRiskAdmissions(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        uint16 expectedPositionCount
    ) private {
        if (
            RiskAdmissionId.unwrap(matchData.longAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(matchData.shortAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(matchData.longAdmissionId)
                    == RiskAdmissionId.unwrap(matchData.shortAdmissionId)
                || matchData.longAdmissionResultHash == bytes32(0) || matchData.shortAdmissionResultHash == bytes32(0)
        ) revert ClearingHandoffMismatch();
        RiskAdmission memory longAdmission = _riskEngine.getAdmission(matchData.longAdmissionId);
        RiskAdmission memory shortAdmission = _riskEngine.getAdmission(matchData.shortAdmissionId);
        if (
            longAdmission.status != RiskAdmissionStatus.Reserved
                || shortAdmission.status != RiskAdmissionStatus.Reserved
                || RiskDomainId.unwrap(longAdmission.riskDomainId) != RiskDomainId.unwrap(shortAdmission.riskDomainId)
                || longAdmission.riskDomainVersion != shortAdmission.riskDomainVersion
        ) revert ClearingHandoffMismatch();
        uint128 openInterest = Lots.unwrap(matchData.fillLots);
        bytes32 executionReference = FillId.unwrap(context.fillId);
        _riskEngine.consumeAdmission(
            RiskAdmissionConsumption({
                admissionId: matchData.longAdmissionId,
                expectedResultHash: matchData.longAdmissionResultHash,
                expectedAccountId: context.buyerAccountId,
                expectedRiskDomainId: longAdmission.riskDomainId,
                expectedRiskDomainVersion: longAdmission.riskDomainVersion,
                expectedOpenInterestBaseUnits: openInterest,
                expectedTerminalLiabilityBaseUnits: settlement.longLiabilityMinor,
                expectedPositionCount: expectedPositionCount,
                executionReference: executionReference
            })
        );
        _riskEngine.consumeAdmission(
            RiskAdmissionConsumption({
                admissionId: matchData.shortAdmissionId,
                expectedResultHash: matchData.shortAdmissionResultHash,
                expectedAccountId: context.sellerAccountId,
                expectedRiskDomainId: shortAdmission.riskDomainId,
                expectedRiskDomainVersion: shortAdmission.riskDomainVersion,
                expectedOpenInterestBaseUnits: openInterest,
                expectedTerminalLiabilityBaseUnits: settlement.shortLiabilityMinor,
                expectedPositionCount: expectedPositionCount,
                executionReference: executionReference
            })
        );
    }

    function _bindRiskExposures(
        BilateralMatch calldata matchData,
        bytes32 executionReference,
        PositionId[] memory exposurePositions
    ) private {
        _riskEngine.bindConsumedExposure(matchData.longAdmissionId, executionReference, exposurePositions);
        _riskEngine.bindConsumedExposure(matchData.shortAdmissionId, executionReference, exposurePositions);
    }

    function _applyFunding(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim
    ) private {
        _applyLiabilityFunding(
            context,
            matchData,
            settlement.assetId,
            settlement.bindingVersion,
            settlement.longLiabilityMinor,
            settlement.shortLiabilityMinor,
            channelKind,
            channelClaim
        );
        _applyConsiderationFunding(context, matchData, settlement, context.fillId, channelKind);
    }

    function _consumeFees(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        ClearingChannelKind channelKind
    ) private returns (FeeContext memory fees) {
        FeeScheduleVersion memory schedule = _fundedFeeEngine.feeScheduleRegistry()
            .getFeeSchedule(context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion);
        if (
            !_fundedFeeEngine.feeScheduleRegistry()
                    .isOpenForNewRisk(context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion)
                || schedule.version != context.taker.order.feeScheduleVersion
                || AssetId.unwrap(schedule.definition.settlementAssetId) != AssetId.unwrap(settlement.assetId)
                || schedule.definition.settlementAssetVersion != settlement.bindingVersion
        ) revert FeeScheduleMismatch();
        uint128 notionalMinor = _absoluteMinor(settlement.considerationMinor);
        fees.maker = _consumeFeeAction(
            context,
            context.maker.order.accountId,
            context.maker.order.maxFeeMinor,
            matchData.makerFeeFunding,
            FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            notionalMinor,
            0,
            channelKind
        );
        fees.taker = _consumeFeeAction(
            context,
            context.taker.order.accountId,
            context.taker.order.maxFeeMinor,
            matchData.takerFeeFunding,
            FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL,
            notionalMinor,
            1,
            channelKind
        );
    }

    function _consumeFeeAction(
        MatchContext memory context,
        AccountId payerAccountId,
        uint128 signedMaximum,
        ClearingFeeFunding calldata suppliedFunding,
        FeeActionId actionId,
        uint128 notionalMinor,
        uint32 ordinal,
        ClearingChannelKind channelKind
    ) private returns (FeeActionResult memory result) {
        ClearingFeeFunding memory funding = suppliedFunding;
        if (
            funding.consumptionId == bytes32(0) && CollateralLockId.unwrap(funding.chargeLockId) == bytes32(0)
                && CollateralLockId.unwrap(funding.budgetLockId) == bytes32(0)
        ) {
            funding = _reserveDirectFeeFunding(context, payerAccountId, actionId, notionalMinor, ordinal);
        }
        FeeActionRequest memory request = ClearingFeeLib.buildRequest(
            FillId.unwrap(context.fillId),
            context.taker.order.feeScheduleId,
            context.taker.order.feeScheduleVersion,
            actionId,
            payerAccountId,
            notionalMinor,
            signedMaximum,
            funding,
            ordinal
        );
        result = _fundedFeeEngine.consumeFeeAction(request);
        ClearingFeeLib.validateResult(
            result, funding, context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion, signedMaximum
        );
    }

    function _reserveDirectFeeFunding(
        MatchContext memory context,
        AccountId payerAccountId,
        FeeActionId actionId,
        uint128 notionalMinor,
        uint32 ordinal
    ) private returns (ClearingFeeFunding memory funding) {
        FeeComputation memory computation = _fundedFeeEngine.previewFeeAction(
            context.taker.order.feeScheduleId,
            context.taker.order.feeScheduleVersion,
            actionId,
            notionalMinor,
            0
        );
        if (computation.rebateMinor != 0) revert FeeRebateFundingUnsupported(computation.rebateMinor);
        funding.consumptionId = _fundedFeeEngine.deriveConsumptionId(
            FillId.unwrap(context.fillId),
            context.taker.order.feeScheduleId,
            context.taker.order.feeScheduleVersion,
            actionId,
            payerAccountId,
            payerAccountId,
            ordinal
        );
        if (computation.chargeMinor == 0) return funding;

        (AssetId assetId, uint32 bindingVersion) = _settlementBinding(context.taker);
        bytes32 fundingReference = _fundedFeeEngine.deriveFundingReference(
            funding.consumptionId, _fundedFeeEngine.CHARGE_FUNDING_PURPOSE()
        );
        funding.chargeLockId = _collateralVault.createLock(
            fundingReference,
            payerAccountId,
            assetId,
            bindingVersion,
            computation.chargeMinor,
            context.taker.order.deadline,
            address(_fundedFeeEngine)
        );
    }

    function _applyLiabilityFunding(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 longAmount,
        uint128 shortAmount,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim
    ) private {
        bool takerLong = context.takerIsBuyer;
        _applyPartyLiabilityFunding(
            matchData.takerOrderHash,
            context.takerCumulativeLots,
            context.taker.order.accountId,
            assetId,
            bindingVersion,
            takerLong ? longAmount : shortAmount,
            matchData.takerFunding.terminalLiabilityLockId,
            channelKind,
            channelClaim
        );
        _applyPartyLiabilityFunding(
            matchData.makerOrderHash,
            context.makerCumulativeLots,
            context.maker.order.accountId,
            assetId,
            bindingVersion,
            takerLong ? shortAmount : longAmount,
            matchData.makerFunding.terminalLiabilityLockId,
            channelKind,
            channelClaim
        );
    }

    function _applyPartyLiabilityFunding(
        bytes32 orderHash,
        Lots cumulativeLots,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        CollateralLockId directLockId,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim
    ) private {
        uint128 adopted = channelKind == ClearingChannelKind.Direct
            ? 0
            : _adoptedAmountForAccount(channelClaim, accountId);
        if (adopted != 0) {
            if (adopted != amount) revert ClearingHandoffMismatch();
            _requireNoFundingLock(orderHash, TERMINAL_LIABILITY_PURPOSE, directLockId);
            return;
        }
        if (CollateralLockId.unwrap(directLockId) == bytes32(0) && amount != 0) {
            directLockId = _createDirectFundingLock(
                orderHash,
                Lots.unwrap(cumulativeLots),
                accountId,
                assetId,
                bindingVersion,
                amount,
                TERMINAL_LIABILITY_PURPOSE,
                address(_positionEngine),
                _orderState.getOrder(orderHash).order.deadline
            );
        }
        _releaseLiabilityLock(orderHash, cumulativeLots, accountId, assetId, bindingVersion, amount, directLockId);
    }

    function _applyConsiderationFunding(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        FillId fillId,
        ClearingChannelKind channelKind
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
        if (CollateralLockId.unwrap(payerLock) == bytes32(0) && magnitude != 0) {
            payerLock = _createDirectFundingLock(
                payerHash,
                Lots.unwrap(payerCumulative),
                payer,
                settlement.assetId,
                settlement.bindingVersion,
                uint128(magnitude),
                CONSIDERATION_PURPOSE,
                address(this),
                takerPays ? context.taker.order.deadline : context.maker.order.deadline
            );
        }
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

    function _createDirectFundingLock(
        bytes32 orderHash,
        uint128 cumulativeLots,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        bytes32 purpose,
        address settlementOperator,
        uint64 expiry
    ) private returns (CollateralLockId lockId) {
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
        return _collateralVault.createLock(
            fundingReference, accountId, assetId, bindingVersion, amount, expiry, settlementOperator
        );
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
        TerminalLiabilityReservationId longReservationId,
        TerminalLiabilityReservationId shortReservationId
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
            TerminalLiabilityReservationId.unwrap(longReservationId),
            TerminalLiabilityReservationId.unwrap(shortReservationId)
        );
    }

    function _recordFill(
        MatchContext memory context,
        BilateralMatch calldata matchData,
        bytes32 witnessHash,
        SettlementContext memory settlement,
        FeeContext memory fees,
        uint16 positionCount,
        bool isPackage,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim,
        address channelSource
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
            channelConsumptionId: channelKind == ClearingChannelKind.Direct
                ? keccak256(abi.encode(DIRECT_CHANNEL_TYPEHASH, FillId.unwrap(context.fillId), msg.sender, witnessHash))
                : channelClaim.consumptionId,
            routeCommitment: channelKind == ClearingChannelKind.Direct
                ? keccak256(
                    abi.encode(
                        ROUTE_COMMITMENT_TYPEHASH,
                        FillId.unwrap(context.fillId),
                        matchData.takerOrderHash,
                        matchData.makerOrderHash,
                        context.taker.order.executionModeId,
                        witnessHash
                    )
                )
                : channelClaim.sourceCommitment,
            channelSource: channelKind == ClearingChannelKind.Direct ? msg.sender : channelSource,
            channelKind: channelKind,
            settlementAssetId: settlement.assetId,
            buyerAccountId: context.buyerAccountId,
            sellerAccountId: context.sellerAccountId,
            makerFeeResultHash: fees.maker.resultHash,
            takerFeeResultHash: fees.taker.resultHash,
            targetVersion: context.taker.order.targetVersion,
            settlementAssetVersion: settlement.bindingVersion,
            clearedAt: uint64(block.timestamp),
            fillLots: matchData.fillLots,
            takerCumulativeLots: context.takerCumulativeLots,
            makerCumulativeLots: context.makerCumulativeLots,
            executionPriceTicks: matchData.executionPriceTicks,
            considerationMinor: settlement.considerationMinor,
            makerFeeChargeMinor: fees.maker.chargeMinor,
            makerFeeRebateMinor: fees.maker.rebateMinor,
            takerFeeChargeMinor: fees.taker.chargeMinor,
            takerFeeRebateMinor: fees.taker.rebateMinor,
            positionCount: positionCount,
            isPackage: isPackage
        });
        _fills[context.fillId] = record;
        emit FillCleared(context.fillId, record, msg.sender);
        if (channelKind != ClearingChannelKind.Direct) {
            PositionId[] memory positions = _fillPositions[context.fillId];
            _channelAdapters[channelKind].finalizeTypedHandoff(
                channelClaim.consumptionId, FillId.unwrap(context.fillId), keccak256(abi.encode(positions))
            );
        }
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _requireFundingPurpose(bytes32 purpose) private pure {
        if (purpose != TERMINAL_LIABILITY_PURPOSE && purpose != CONSIDERATION_PURPOSE) {
            revert InvalidFundingPurpose(purpose);
        }
    }

    function _absoluteMinor(int256 signedAmount) private pure returns (uint128 amount) {
        uint256 magnitude = signedAmount < 0 ? uint256(-(signedAmount + 1)) + 1 : uint256(signedAmount);
        if (magnitude > type(uint128).max) revert ConsiderationOverflow(magnitude);
        return uint128(magnitude);
    }

    function _adoptedAmountForAccount(ClearingHandoffClaim memory claim, AccountId accountId)
        private
        pure
        returns (uint128 total)
    {
        uint256 sum;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            if (AccountId.unwrap(disposition.accountId) == AccountId.unwrap(accountId)) {
                sum += disposition.reservationAmount;
            }
        }
        if (sum > type(uint128).max) revert ClearingHandoffMismatch();
        return uint128(sum);
    }

    function _positionFunding(
        ClearingHandoffClaim memory claim,
        uint32 ordinal,
        bool longSide,
        AccountId accountId,
        uint128 reservationAmount
    ) private pure returns (PositionFunding memory funding) {
        PositionLiabilitySide side = longSide ? PositionLiabilitySide.Long : PositionLiabilitySide.Short;
        bool found;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            if (disposition.positionOrdinal != ordinal || disposition.side != side) continue;
            if (
                found || AccountId.unwrap(disposition.accountId) != AccountId.unwrap(accountId)
                    || disposition.reservationAmount != reservationAmount
            ) revert ClearingHandoffMismatch();
            found = true;
            funding = disposition.funding;
        }
    }

    function _verifyAdoptedReservation(
        ClearingHandoffClaim memory claim,
        uint32 ordinal,
        bool longSide,
        TerminalLiabilityReservationId actualReservationId
    ) private pure {
        PositionLiabilitySide side = longSide ? PositionLiabilitySide.Long : PositionLiabilitySide.Short;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            if (disposition.positionOrdinal != ordinal || disposition.side != side) continue;
            if (
                TerminalLiabilityReservationId.unwrap(disposition.reservationId)
                    != TerminalLiabilityReservationId.unwrap(actualReservationId)
            ) revert ClearingHandoffMismatch();
            return;
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
