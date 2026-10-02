// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOffsetUnwindCoordinator} from "../interfaces/IOffsetUnwindCoordinator.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IQuoteSettlementRouter} from "../interfaces/IQuoteSettlementRouter.sol";
import {IRiskAdmissionBindingRegistry} from "../interfaces/IRiskAdmissionBindingRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {IStreamCapacityManager} from "../interfaces/IStreamCapacityManager.sol";
import {ClearingLib} from "../libraries/ClearingLib.sol";
import {Eip712Lib} from "../libraries/Eip712Lib.sol";
import {
    BilateralMatch,
    ClearingChannelKind,
    ClearingFeeFunding,
    OrderFunding,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {StreamCapacityState} from "../types/CapacityManagerTypes.sol";
import {Side} from "../types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralLockId,
    FeeScheduleId,
    FillId,
    PackageId,
    PositionId,
    RiskDomainId,
    SeriesId
} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {OrderStatus, OrderTargetKind, PublicOrder} from "../types/OrderTypes.sol";
import {
    MakerQuoteTerms,
    QuoteCapacityRecord,
    QuoteCapacityTerms,
    QuoteSettlement,
    QuoteSettlementReceipt,
    TakerSettlementTerms
} from "../types/QuoteSettlementTypes.sol";
import {PortfolioPositionWitness, RiskAdmissionId, RiskAdmissionRequest, RiskObservation} from "../types/RiskTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {StreamCapacityConsumption, StreamId, StreamPolicy} from "../types/StreamTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

interface IRiskBindingsSource {
    function riskBindings() external view returns (IRiskAdmissionBindingRegistry);
}

interface ICapacityVaultSource {
    function collateralVault() external view returns (ICollateralVault);
}

interface IOffsetPositionSource {
    function positionSource() external view returns (address);
}

/// @notice Settles offchain firm quotes in one permissionless, atomic transaction.
///
/// @dev A maker locks collateral once per series through `openQuoteCapacity` (the stream capacity manager holds the
/// lock) and then streams quotes without transactions: each quote is the maker's EIP-712 signed public order plus its
/// signed risk authorization, whose `binderTerms` pin this router and the capacity. A taker signs the opposite order and
/// its own risk authorization. Anyone may then call `settle`, which in one transaction draws the maker's capacity,
/// reserves both risk admissions as the risk consumer, binds them through the registry on the strength of the two
/// authorization signatures, registers both orders (OrderState verifies both order signatures and consumes their
/// nonces), clears through the atomic clearing engine, and pays any relayer fee the taker signed for. Any failure
/// reverts the whole transaction, so no reservation, binding, registration, capacity draw or position survives a failed
/// settlement. The contract holds the risk, execution and capacity roles; no caller needs one.
///
/// @dev A quote settles at most once: its order is registered by the first settlement, and the maker admission is
/// sized to that fill and fully consumed by it. The same holds for the taker order. Re-quoting is free offchain.
///
/// @dev Entry and exit take the same path. A taker exits a position held against the quote's maker by naming it in its
/// signed settlement terms; when the maker's signed quote terms allow it, the fill's mirror position and the named
/// position are closed together through the offset unwind coordinator in the same transaction, so an exit either
/// leaves the taker flat or does not happen at all.
contract QuoteSettlementRouter is IQuoteSettlementRouter, ReentrancyGuard {
    bytes32 private constant CAPACITY_TERMS_TYPEHASH = keccak256(
        "SetrynQuoteCapacityV1(address maker,bytes32 makerAccountId,bytes32 seriesId,uint32 seriesVersion,uint128 maximumLiability,uint128 liabilityPerLot,uint128 maximumAbsoluteInventoryLots,uint64 expiry,uint256 nonce)"
    );
    bytes32 private constant MAKER_QUOTE_TERMS_TYPEHASH =
        keccak256("SetrynMakerQuoteTermsV1(bytes32 capacityId,bool allowsOffsetUnwind)");
    bytes32 private constant TAKER_SETTLEMENT_TERMS_TYPEHASH = keccak256(
        "SetrynTakerSettlementTermsV1(bytes32 quoteOrderHash,address relayer,bytes32 relayerAccountId,uint128 maxRelayerFeeMinor,bytes32 closePositionId)"
    );
    bytes32 private constant CAPACITY_ID_TAG = keccak256("SETRYN_QUOTE_CAPACITY_ID_V1");
    bytes32 private constant RISK_NONCE_TAG = keccak256("SETRYN_QUOTE_RISK_NONCE_V1");
    bytes32 private constant RISK_SALT_TAG = keccak256("SETRYN_QUOTE_RISK_SALT_V1");
    bytes32 private constant POSITION_TAG = keccak256("SETRYN_QUOTE_PROSPECTIVE_POSITION_V1");
    bytes32 private constant ECONOMICS_TAG = keccak256("SETRYN_QUOTE_ORDER_ECONOMICS_V1");
    bytes32 private constant OBSERVATION_TAG = keccak256("SETRYN_QUOTE_EXECUTION_PRICE_V1");
    bytes32 private constant RELAYER_FEE_TAG = keccak256("SETRYN_QUOTE_RELAYER_FEE_V1");

    IAtomicClearingEngine public immutable clearingEngine;
    IOrderState public immutable orderState;
    IRiskAdmissionBindingRegistry public immutable riskBindings;
    IPortfolioRiskEngine public immutable riskEngine;
    IStreamCapacityManager public immutable capacityManager;
    ISeriesRegistry public immutable seriesRegistry;
    IMarketRegistry public immutable marketRegistry;
    ICollateralVault public immutable collateralVault;
    IOffsetUnwindCoordinator public immutable offsetUnwinder;

    mapping(StreamId capacityId => QuoteCapacityRecord record) private _capacities;
    mapping(address maker => mapping(uint256 nonce => bool used)) private _usedCapacityNonces;

    /// @dev Per-settlement working state, kept in memory so the settlement path stays within the stack.
    struct Context {
        bytes32 makerHash;
        bytes32 takerHash;
        RiskDomainId riskDomainId;
        uint32 riskDomainVersion;
        AssetId settlementAssetId;
        uint32 settlementAssetVersion;
        uint128 makerLiability;
        uint128 takerLiability;
        uint64 sequence;
        uint128 capacityConsumed;
        FillId fillId;
        RiskAdmissionId makerAdmissionId;
        bytes32 makerResultHash;
        RiskAdmissionId takerAdmissionId;
        bytes32 takerResultHash;
        PositionId fillPositionId;
    }

    constructor(
        IAtomicClearingEngine clearingEngine_,
        IStreamCapacityManager capacityManager_,
        IOffsetUnwindCoordinator offsetUnwinder_
    ) {
        _requireDependency(address(clearingEngine_));
        _requireDependency(address(capacityManager_));
        _requireDependency(address(offsetUnwinder_));
        // Exits close positions of the same engine the clearing engine opens them in.
        _requireSame(
            address(clearingEngine_.positionEngine()), IOffsetPositionSource(address(offsetUnwinder_)).positionSource()
        );
        IOrderState orderState_ = clearingEngine_.orderState();
        IRiskAdmissionBindingRegistry riskBindings_ =
            IRiskBindingsSource(address(clearingEngine_.admissionGate())).riskBindings();
        // Orders are only registrable, and matches only clearable, with bindings from this one registry.
        _requireSame(
            address(riskBindings_), address(IRiskBindingsSource(address(orderState_.validationGate())).riskBindings())
        );
        _requireSame(address(orderState_), riskBindings_.orderVerifyingContract());
        IPortfolioRiskEngine riskEngine_ = clearingEngine_.riskEngine();
        _requireSame(address(riskEngine_), address(riskBindings_.riskEngine()));
        ICollateralVault collateralVault_ = clearingEngine_.collateralVault();
        _requireSame(
            address(collateralVault_), address(ICapacityVaultSource(address(capacityManager_)).collateralVault())
        );
        ISeriesRegistry seriesRegistry_ = clearingEngine_.seriesRegistry();

        clearingEngine = clearingEngine_;
        orderState = orderState_;
        riskBindings = riskBindings_;
        riskEngine = riskEngine_;
        capacityManager = capacityManager_;
        seriesRegistry = seriesRegistry_;
        marketRegistry = seriesRegistry_.marketRegistry();
        collateralVault = collateralVault_;
        offsetUnwinder = offsetUnwinder_;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Capacity

    /// @notice Opens a maker's capacity on one series from the maker's signed terms; callable by anyone, so a maker
    /// may also have it opened gaslessly. The capacity manager locks `maximumLiability` of the maker's collateral until
    /// `expiry`, and every settled quote draws `liabilityPerLot` per lot from it.
    function openQuoteCapacity(QuoteCapacityTerms calldata terms, bytes calldata signature)
        external
        nonReentrant
        returns (StreamId capacityId)
    {
        if (
            terms.maker == address(0) || terms.maximumLiability == 0 || terms.liabilityPerLot == 0
                || terms.maximumAbsoluteInventoryLots == 0 || terms.expiry <= block.timestamp
        ) revert InvalidCapacityTerms();
        if (_usedCapacityNonces[terms.maker][terms.nonce]) revert CapacityNonceUsed(terms.maker, terms.nonce);
        bytes32 digest = _capacityDigest(terms);
        if (!SignatureChecker.isValidSignatureNowCalldata(terms.maker, digest, signature)) {
            revert InvalidCapacitySignature();
        }
        (address controller,) = collateralVault.getAccount(terms.makerAccountId);
        if (controller != terms.maker) revert InvalidCapacityTerms();
        SeriesVersion memory series = seriesRegistry.getSeries(terms.seriesId, terms.seriesVersion);
        // Each lot drawn must free at least the liability its position will lock, on either side.
        if (
            terms.liabilityPerLot < series.definition.maxLongDebitMinorPerLot
                || terms.liabilityPerLot < series.definition.maxShortDebitMinorPerLot
        ) revert InvalidCapacityTerms();
        MarketVersion memory market =
            marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);

        capacityId = StreamId.wrap(keccak256(abi.encode(CAPACITY_ID_TAG, digest)));
        _usedCapacityNonces[terms.maker][terms.nonce] = true;
        _capacities[capacityId] = QuoteCapacityRecord({
            maker: terms.maker,
            makerAccountId: terms.makerAccountId,
            seriesId: terms.seriesId,
            seriesVersion: terms.seriesVersion,
            liabilityPerLot: terms.liabilityPerLot,
            expiry: terms.expiry
        });
        capacityManager.reserveStreamCapacity(capacityId, _capacityPolicy(terms, market, capacityId, digest));
        emit QuoteCapacityOpened(
            capacityId,
            terms.maker,
            terms.makerAccountId,
            terms.seriesId,
            terms.seriesVersion,
            terms.maximumLiability,
            terms.liabilityPerLot,
            terms.maximumAbsoluteInventoryLots,
            terms.expiry,
            terms.nonce,
            msg.sender
        );
    }

    /// @notice Releases the rest of a capacity's lock; only its maker. Every quote drawing on it stops settling.
    function closeQuoteCapacity(StreamId capacityId) external nonReentrant {
        QuoteCapacityRecord memory record = _requireCapacity(capacityId);
        if (msg.sender != record.maker) revert UnauthorizedCapacityClose(record.maker, msg.sender);
        capacityManager.releaseStreamCapacity(capacityId);
        emit QuoteCapacityClosed(capacityId, record.maker);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Settlement

    /// @notice Settles one firm quote against one taker order, atomically; callable by any address.
    function settle(QuoteSettlement calldata settlement) external nonReentrant returns (FillId fillId) {
        Context memory context = _validate(settlement);
        PublicOrder calldata maker = settlement.quote.order;
        PublicOrder calldata taker = settlement.taker.order;

        // Capacity first: drawing and finalizing it shrinks the maker's capacity lock by this fill before the
        // admission is evaluated against the maker's available collateral and the clearing engine locks the
        // position's liability from it. The fill id is fixed by the two fresh orders, so it is known in advance.
        _drawCapacity(settlement, context);

        (context.makerAdmissionId, context.makerResultHash) = _reserveRisk(
            maker, context.makerHash, settlement.fillLots, maker.priceTicks, context.makerLiability, context
        );
        (context.takerAdmissionId, context.takerResultHash) = _reserveRisk(
            taker, context.takerHash, settlement.fillLots, maker.priceTicks, context.takerLiability, context
        );
        riskBindings.bindOrderRiskWithAuthorization(
            maker, context.makerAdmissionId, settlement.quote.risk, settlement.quote.riskSignature
        );
        riskBindings.bindOrderRiskWithAuthorization(
            taker, context.takerAdmissionId, settlement.taker.risk, settlement.taker.riskSignature
        );
        orderState.registerSignedOrder(maker, settlement.quote.orderSignature);
        orderState.registerSignedOrder(taker, settlement.taker.orderSignature);

        fillId = clearingEngine.clearSeries(_clearingRequest(settlement, context));
        if (FillId.unwrap(fillId) != FillId.unwrap(context.fillId)) {
            revert SettlementFillMismatch(context.fillId, fillId);
        }
        PositionId[] memory created = clearingEngine.fillPositions(fillId);
        if (created.length != 1) revert UnexpectedFillPositions(fillId, created.length);
        context.fillPositionId = created[0];
        // An exit closes the named position and the fill's mirror of it together; the coordinator accepts only an
        // exact mirror, so the taker ends flat against this maker or the whole settlement reverts.
        PositionId closePositionId = settlement.taker.terms.closePositionId;
        if (PositionId.unwrap(closePositionId) != bytes32(0)) {
            offsetUnwinder.unwindOffset(closePositionId, context.fillPositionId, taker.accountId, FillId.unwrap(fillId));
        }
        _payRelayer(settlement, context, fillId);
        _emitSettled(settlement, context, fillId);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Views

    function quoteCapacity(StreamId capacityId) external view returns (QuoteCapacityRecord memory record) {
        return _requireCapacity(capacityId);
    }

    function capacityNonceUsed(address maker, uint256 nonce) external view returns (bool) {
        return _usedCapacityNonces[maker][nonce];
    }

    function hashCapacityTerms(QuoteCapacityTerms calldata terms) external view returns (bytes32 digest) {
        return _capacityDigest(terms);
    }

    function deriveCapacityId(QuoteCapacityTerms calldata terms) external view returns (StreamId capacityId) {
        return StreamId.wrap(keccak256(abi.encode(CAPACITY_ID_TAG, _capacityDigest(terms))));
    }

    function hashMakerQuoteTerms(MakerQuoteTerms calldata terms) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(MAKER_QUOTE_TERMS_TYPEHASH, StreamId.unwrap(terms.capacityId), terms.allowsOffsetUnwind)
            );
    }

    function hashTakerSettlementTerms(TakerSettlementTerms calldata terms) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TAKER_SETTLEMENT_TERMS_TYPEHASH,
                terms.quoteOrderHash,
                terms.relayer,
                AccountId.unwrap(terms.relayerAccountId),
                terms.maxRelayerFeeMinor,
                PositionId.unwrap(terms.closePositionId)
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return Eip712Lib.domainSeparator(block.chainid, address(this));
    }

    // ------------------------------------------------------------------------------------------------------------
    // Internals

    function _validate(QuoteSettlement calldata settlement) private view returns (Context memory context) {
        PublicOrder calldata maker = settlement.quote.order;
        PublicOrder calldata taker = settlement.taker.order;
        if (
            Lots.unwrap(settlement.fillLots) == 0 || maker.targetKind != OrderTargetKind.Series
                || taker.targetKind != OrderTargetKind.Series
                || SeriesId.unwrap(maker.seriesId) != SeriesId.unwrap(taker.seriesId)
                || maker.targetVersion != taker.targetVersion || maker.side == Side.Unspecified
                || taker.side == Side.Unspecified || maker.side == taker.side
        ) revert InvalidQuoteSettlement();
        if (AccountId.unwrap(maker.accountId) == AccountId.unwrap(taker.accountId)) revert SelfTrade(maker.accountId);
        int128 quotePrice = PriceTicks.unwrap(maker.priceTicks);
        int128 takerLimit = PriceTicks.unwrap(taker.priceTicks);
        if (taker.side == Side.Buy ? takerLimit < quotePrice : takerLimit > quotePrice) {
            revert PriceNotCrossed(takerLimit, quotePrice);
        }

        QuoteCapacityRecord memory capacity = _requireCapacity(settlement.quote.terms.capacityId);
        if (
            capacity.maker != maker.signer
                || AccountId.unwrap(capacity.makerAccountId) != AccountId.unwrap(maker.accountId)
                || SeriesId.unwrap(capacity.seriesId) != SeriesId.unwrap(maker.seriesId)
                || capacity.seriesVersion != maker.targetVersion
        ) revert QuoteCapacityMismatch(settlement.quote.terms.capacityId);

        context.makerHash = orderState.hashOrder(maker);
        context.takerHash = orderState.hashOrder(taker);
        if (orderState.statusOf(context.makerHash) != OrderStatus.Unspecified) {
            revert QuoteAlreadyConsumed(context.makerHash);
        }
        if (
            settlement.quote.risk.binder != address(this)
                || settlement.quote.risk.binderTerms != hashMakerQuoteTerms(settlement.quote.terms)
                || settlement.taker.risk.binder != address(this)
                || settlement.taker.risk.binderTerms != hashTakerSettlementTerms(settlement.taker.terms)
        ) revert InvalidQuoteSettlement();

        TakerSettlementTerms calldata terms = settlement.taker.terms;
        if (terms.quoteOrderHash != bytes32(0) && terms.quoteOrderHash != context.makerHash) {
            revert QuoteNotAccepted(terms.quoteOrderHash, context.makerHash);
        }
        if (terms.relayer != address(0) && terms.relayer != msg.sender) {
            revert RelayerNotAuthorized(terms.relayer, msg.sender);
        }
        if (settlement.relayerFeeMinor > terms.maxRelayerFeeMinor) {
            revert RelayerFeeAboveMaximum(terms.maxRelayerFeeMinor, settlement.relayerFeeMinor);
        }
        if (PositionId.unwrap(terms.closePositionId) != bytes32(0) && !settlement.quote.terms.allowsOffsetUnwind) {
            revert OffsetUnwindNotConsented();
        }

        SeriesVersion memory series = seriesRegistry.getSeries(maker.seriesId, maker.targetVersion);
        MarketVersion memory market =
            marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
        context.riskDomainId = market.definition.riskDomainId;
        context.riskDomainVersion = market.definition.riskDomainVersion;
        context.settlementAssetId = market.definition.settlementAssetId;
        context.settlementAssetVersion = market.definition.settlementAssetVersion;
        uint128 lots = Lots.unwrap(settlement.fillLots);
        uint128 longPerLot = series.definition.maxLongDebitMinorPerLot;
        uint128 shortPerLot = series.definition.maxShortDebitMinorPerLot;
        context.makerLiability = lots * (maker.side == Side.Buy ? longPerLot : shortPerLot);
        context.takerLiability = lots * (taker.side == Side.Buy ? longPerLot : shortPerLot);
        context.fillId = ClearingLib.deriveFillId(
            block.chainid,
            address(clearingEngine),
            context.takerHash,
            context.makerHash,
            settlement.fillLots,
            settlement.fillLots,
            settlement.fillLots,
            maker.priceTicks,
            keccak256(settlement.payoffTerms)
        );
    }

    function _drawCapacity(QuoteSettlement calldata settlement, Context memory context) private {
        StreamId capacityId = settlement.quote.terms.capacityId;
        StreamCapacityState memory state = capacityManager.getStreamCapacity(capacityId);
        context.sequence = state.consumedSequence + 1;
        StreamCapacityConsumption memory consumption = capacityManager.consumeStreamCapacity(
            capacityId, context.sequence, settlement.quote.order.side, settlement.fillLots
        );
        context.capacityConsumed = consumption.liabilityConsumed;
        capacityManager.finalizeStreamCapacity(
            capacityId, context.sequence, FillId.unwrap(context.fillId), consumption.consumptionHash
        );
    }

    /// @dev The admission is sized to exactly this fill and lives one second, so the clearing engine consumes it whole
    /// in the same transaction. Its witness and observation are derived from the order and the execution price, the
    /// same evidence the operator-side reservation used.
    function _reserveRisk(
        PublicOrder calldata order,
        bytes32 orderHash,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        uint128 liability,
        Context memory context
    ) private returns (RiskAdmissionId admissionId, bytes32 resultHash) {
        uint128 lots = Lots.unwrap(fillLots);
        PortfolioPositionWitness[] memory positions = new PortfolioPositionWitness[](1);
        positions[0] = PortfolioPositionWitness({
            positionId: PositionId.wrap(keccak256(abi.encode(POSITION_TAG, orderHash))),
            seriesId: order.seriesId,
            seriesVersion: order.targetVersion,
            signedLots: order.side == Side.Buy ? int128(lots) : -int128(lots),
            entryPriceTicks: executionPriceTicks,
            maximumTerminalLiabilityBaseUnits: liability,
            economicsHash: keccak256(
                abi.encode(
                    ECONOMICS_TAG,
                    SeriesId.unwrap(order.seriesId),
                    order.side,
                    lots,
                    PriceTicks.unwrap(executionPriceTicks),
                    liability
                )
            )
        });
        RiskObservation[] memory observations = new RiskObservation[](1);
        observations[0] = RiskObservation({
            observationKey: keccak256(abi.encode(OBSERVATION_TAG, SeriesId.unwrap(order.seriesId))),
            valueHash: keccak256(
                abi.encode(SeriesId.unwrap(order.seriesId), PriceTicks.unwrap(executionPriceTicks), block.timestamp)
            ),
            observedAt: uint64(block.timestamp)
        });
        (admissionId,) = riskEngine.reserveNewRisk(
            RiskAdmissionRequest({
                accountId: order.accountId,
                riskDomainId: context.riskDomainId,
                riskDomainVersion: context.riskDomainVersion,
                openInterestIncreaseBaseUnits: lots,
                terminalLiabilityIncreaseBaseUnits: liability,
                deadline: uint64(block.timestamp + 1),
                nonce: uint256(keccak256(abi.encode(RISK_NONCE_TAG, orderHash))),
                salt: keccak256(abi.encode(RISK_SALT_TAG, orderHash, lots))
            }),
            positions,
            observations
        );
        resultHash = riskEngine.getAdmission(admissionId).resultHash;
    }

    function _clearingRequest(QuoteSettlement calldata settlement, Context memory context)
        private
        pure
        returns (SeriesClearingRequest memory request)
    {
        bool takerLong = settlement.taker.order.side == Side.Buy;
        OrderFunding memory direct;
        ClearingFeeFunding memory directFee;
        request = SeriesClearingRequest({
            matchData: BilateralMatch({
                takerOrderHash: context.takerHash,
                makerOrderHash: context.makerHash,
                fillLots: settlement.fillLots,
                executionPriceTicks: settlement.quote.order.priceTicks,
                longAdmissionId: takerLong ? context.takerAdmissionId : context.makerAdmissionId,
                longAdmissionResultHash: takerLong ? context.takerResultHash : context.makerResultHash,
                shortAdmissionId: takerLong ? context.makerAdmissionId : context.takerAdmissionId,
                shortAdmissionResultHash: takerLong ? context.makerResultHash : context.takerResultHash,
                takerFunding: direct,
                makerFunding: direct,
                takerFeeFunding: directFee,
                makerFeeFunding: directFee
            }),
            payoffTerms: settlement.payoffTerms,
            channelKind: ClearingChannelKind.Direct
        });
    }

    /// @dev The fee is charged from the taker's account to the account the taker signed for, through a lock the router
    /// opens and consumes in the same transaction. It needs the taker's lock-operator approval of this router, given
    /// once like the clearing engine's; a zero fee needs nothing.
    function _payRelayer(QuoteSettlement calldata settlement, Context memory context, FillId fillId) private {
        uint128 fee = settlement.relayerFeeMinor;
        if (fee == 0) return;
        AccountId recipient = settlement.taker.terms.relayerAccountId;
        (address controller,) = collateralVault.getAccount(recipient);
        if (
            controller == address(0)
                || AccountId.unwrap(recipient) == AccountId.unwrap(settlement.taker.order.accountId)
        ) {
            revert RelayerAccountMismatch(recipient);
        }
        CollateralLockId lockId = collateralVault.createLock(
            keccak256(abi.encode(RELAYER_FEE_TAG, FillId.unwrap(fillId))),
            settlement.taker.order.accountId,
            context.settlementAssetId,
            context.settlementAssetVersion,
            fee,
            uint64(block.timestamp + 1),
            address(this)
        );
        collateralVault.consumeLock(lockId, recipient, fee);
    }

    function _emitSettled(QuoteSettlement calldata settlement, Context memory context, FillId fillId) private {
        PublicOrder calldata maker = settlement.quote.order;
        PublicOrder calldata taker = settlement.taker.order;
        emit QuoteSettled(
            fillId,
            context.makerHash,
            context.takerHash,
            QuoteSettlementReceipt({
                fillId: fillId,
                quoteOrderHash: context.makerHash,
                takerOrderHash: context.takerHash,
                maker: maker.signer,
                taker: taker.signer,
                makerAccountId: maker.accountId,
                takerAccountId: taker.accountId,
                seriesId: maker.seriesId,
                seriesVersion: maker.targetVersion,
                makerSide: maker.side,
                fillLots: settlement.fillLots,
                executionPriceTicks: maker.priceTicks,
                capacityId: settlement.quote.terms.capacityId,
                capacitySequence: context.sequence,
                capacityLiabilityConsumed: context.capacityConsumed,
                makerAdmissionId: context.makerAdmissionId,
                takerAdmissionId: context.takerAdmissionId,
                submitter: msg.sender,
                relayerAccountId: settlement.relayerFeeMinor == 0
                    ? AccountId.wrap(bytes32(0))
                    : settlement.taker.terms.relayerAccountId,
                relayerFeeMinor: settlement.relayerFeeMinor,
                fillPositionId: context.fillPositionId,
                closedPositionId: settlement.taker.terms.closePositionId
            })
        );
    }

    function _capacityPolicy(
        QuoteCapacityTerms calldata terms,
        MarketVersion memory market,
        StreamId capacityId,
        bytes32 digest
    ) private view returns (StreamPolicy memory policy) {
        policy.maker = terms.maker;
        policy.makerAccountId = terms.makerAccountId;
        policy.targetKind = OrderTargetKind.Series;
        policy.seriesId = terms.seriesId;
        policy.packageId = PackageId.wrap(bytes32(0));
        policy.targetVersion = terms.seriesVersion;
        policy.feeScheduleId = market.definition.feeScheduleId;
        policy.feeScheduleVersion = market.definition.feeScheduleVersion;
        policy.riskDomainId = market.definition.riskDomainId;
        policy.riskDomainVersion = market.definition.riskDomainVersion;
        policy.collateralAssetId = market.definition.settlementAssetId;
        policy.collateralBindingVersion = market.definition.settlementAssetVersion;
        policy.maximumLiability = terms.maximumLiability;
        policy.liabilityPerLot = terms.liabilityPerLot;
        policy.maximumAbsoluteInventoryLots = terms.maximumAbsoluteInventoryLots;
        policy.validAfter = uint64(block.timestamp);
        policy.expiry = terms.expiry;
        policy.capacityExpiry = terms.expiry;
        policy.permittedExecutor = address(this);
        policy.capacityReservationId = StreamId.unwrap(capacityId);
        policy.nonce = terms.nonce;
        policy.salt = digest;
    }

    function _capacityDigest(QuoteCapacityTerms calldata terms) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                CAPACITY_TERMS_TYPEHASH,
                terms.maker,
                AccountId.unwrap(terms.makerAccountId),
                SeriesId.unwrap(terms.seriesId),
                terms.seriesVersion,
                terms.maximumLiability,
                terms.liabilityPerLot,
                terms.maximumAbsoluteInventoryLots,
                terms.expiry,
                terms.nonce
            )
        );
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(block.chainid, address(this)), structHash);
    }

    function _requireCapacity(StreamId capacityId) private view returns (QuoteCapacityRecord memory record) {
        record = _capacities[capacityId];
        if (record.maker == address(0)) revert UnknownQuoteCapacity(capacityId);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    function _requireSame(address expected, address actual) private pure {
        if (expected != actual) revert DependencyGraphMismatch(expected, actual);
    }
}
