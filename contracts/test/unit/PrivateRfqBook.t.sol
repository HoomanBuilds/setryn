// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IPrivateRfqBook} from "../../src/interfaces/IPrivateRfqBook.sol";
import {IClearingChannelHandoffAdapter} from "../../src/interfaces/IClearingChannelHandoffAdapter.sol";
import {RfqHashLib} from "../../src/libraries/RfqHashLib.sol";
import {PrivateRfqBook} from "../../src/rfq/PrivateRfqBook.sol";
import {LockStatus} from "../../src/types/Enums.sol";
import {AccountId, AssetId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../../src/types/Identifiers.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {RemainderPolicy} from "../../src/types/OrderTypes.sol";
import {
    CapacityCancelAuthorization,
    ClearingHandoff,
    FirmCapacityRecord,
    FirmCapacityStatus,
    MakerQuote,
    MakerQuoteId,
    MakerQuoteStatus,
    PrivateRfqRequest,
    RfqId,
    RfqSelectionAuthorization,
    RfqSidePolicy,
    RfqStatus,
    RfqTargetKind
} from "../../src/types/RfqTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {OrderSigner1271Mock} from "../mocks/OrderMocks.sol";
import {
    IPositionFundingLockVault,
    PositionFundingClearingEngineMock,
    PositionFundingEngineMock
} from "../mocks/PositionFundingMocks.sol";
import {FirmCapacityRiskRegistryMock, FirmCapacityVaultMock, PrivateRfqValidationGateMock} from "../mocks/RfqMocks.sol";

contract PrivateRfqBookTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    bytes32 internal constant PRIVACY_MODE = keccak256("sealed rfq");
    bytes32 internal constant EXECUTION_MODE = keccak256("atomic package");
    AssetId internal constant COLLATERAL_ASSET = AssetId.wrap(keccak256("usdc"));
    RiskDomainId internal constant RISK_DOMAIN = RiskDomainId.wrap(keccak256("risk"));

    address internal admin = makeAddr("admin");
    address internal executor = makeAddr("executor");
    address internal clearing;
    address internal taker;
    uint256 internal takerKey;
    address internal maker;
    uint256 internal makerKey;

    FirmCapacityRiskRegistryMock internal risks;
    FirmCapacityVaultMock internal vault;
    PositionFundingEngineMock internal positionEngine;
    PrivateRfqValidationGateMock internal gate;
    PrivateRfqBook internal book;

    function setUp() public {
        vm.warp(NOW);
        (taker, takerKey) = makeAddrAndKey("taker");
        (maker, makerKey) = makeAddrAndKey("maker");
        risks = new FirmCapacityRiskRegistryMock();
        risks.configure(COLLATERAL_ASSET, 1, 10_000, 100_000);
        vault = new FirmCapacityVaultMock(risks);
        positionEngine = new PositionFundingEngineMock(IPositionFundingLockVault(address(vault)));
        clearing = address(new PositionFundingClearingEngineMock(address(positionEngine)));
        gate = new PrivateRfqValidationGateMock();
        gate.setPrivacyMode(PRIVACY_MODE, true);
        gate.setExecutionMode(EXECUTION_MODE, true);
        book = new PrivateRfqBook(3 days, admin, vault, gate, clearing, 1 days);
    }

    function test_CompleteFirmRfqLifecycleProducesOneShotHandoff() public {
        (RfqId rfqId, MakerQuoteId quoteId) = _prepareSubmittedRfq();
        bytes32 executionReference = keccak256("fill 1");

        vm.prank(clearing);
        ClearingHandoff memory handoff = book.consumeClearingHandoff(rfqId, Lots.wrap(100), 1_000, executionReference);
        assertEq(MakerQuoteId.unwrap(handoff.quoteId), MakerQuoteId.unwrap(quoteId));
        assertEq(uint8(book.getRfq(rfqId).status), uint8(RfqStatus.Clearing));
        assertEq(uint8(book.getQuote(quoteId).status), uint8(MakerQuoteStatus.Consumed));
        assertEq(uint8(book.getCapacity(quoteId).status), uint8(FirmCapacityStatus.Consumed));

        vm.expectRevert(
            abi.encodeWithSelector(IClearingChannelHandoffAdapter.HandoffAlreadyConsumed.selector, executionReference)
        );
        vm.prank(clearing);
        book.consumeClearingHandoff(rfqId, Lots.wrap(1), 1, executionReference);

        vm.prank(address(positionEngine));
        vault.consumeLock(handoff.makerLockId, 1_000);
        vm.prank(clearing);
        book.settleRfq(rfqId, keccak256("settlement"));
        assertEq(uint8(book.getRfq(rfqId).status), uint8(RfqStatus.Settled));
    }

    function test_SignedCapacityCancellationReleasesExactLock() public {
        (RfqId rfqId, MakerQuoteId quoteId) = _createReservedQuote();
        FirmCapacityRecord memory capacity = book.getCapacity(quoteId);
        CapacityCancelAuthorization memory cancellation = CapacityCancelAuthorization({
            quoteId: quoteId, maker: maker, nonce: 88, deadline: uint64(NOW + 1 hours), salt: keccak256("cancel")
        });
        bytes32 digest = RfqHashLib.capacityCancelDigest(cancellation, block.chainid, address(book));
        book.cancelQuoteCapacity(cancellation, _sign(makerKey, digest));

        assertEq(uint8(book.getQuote(quoteId).status), uint8(MakerQuoteStatus.Cancelled));
        assertEq(uint8(book.getCapacity(quoteId).status), uint8(FirmCapacityStatus.Released));
        assertEq(uint8(vault.getLock(capacity.lockId).status), uint8(LockStatus.Released));
        assertEq(uint8(book.getRfq(rfqId).status), uint8(RfqStatus.Collecting));
    }

    function test_CapacityExpiryIsPermissionlessAndExpiresSelectedRfq() public {
        (RfqId rfqId, MakerQuoteId quoteId) = _createSelectedRfq();
        FirmCapacityRecord memory capacity = book.getCapacity(quoteId);
        vm.warp(capacity.expiry);
        book.expireQuoteCapacity(quoteId);
        assertEq(uint8(book.getCapacity(quoteId).status), uint8(FirmCapacityStatus.Expired));
        assertEq(uint8(book.getQuote(quoteId).status), uint8(MakerQuoteStatus.Expired));
        assertEq(uint8(book.getRfq(rfqId).status), uint8(RfqStatus.Expired));
    }

    function test_UnknownPrivacyTagAndMakerNonceReplayFailClosed() public {
        PrivateRfqRequest memory unsupported = _request(1);
        unsupported.privacyModeId = keccak256("unknown privacy");
        PackageLeg[] memory noLegs = new PackageLeg[](0);
        bytes memory unsupportedSignature = _sign(takerKey, RfqId.unwrap(book.hashRequest(unsupported)));
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivateRfqValidationGateMock.UnsupportedPrivacyMode.selector, unsupported.privacyModeId
            )
        );
        book.registerRequest(unsupported, noLegs, unsupportedSignature);

        RfqId rfqId = _createCollectingRfq(2);
        MakerQuote memory quote = _quote(rfqId, 5);
        bytes32[] memory proof = new bytes32[](0);
        book.submitQuote(quote, proof, _sign(makerKey, MakerQuoteId.unwrap(book.hashQuote(quote))));
        quote.salt = keccak256("different quote");
        bytes memory replaySignature = _sign(makerKey, MakerQuoteId.unwrap(book.hashQuote(quote)));
        vm.expectRevert(abi.encodeWithSelector(IPrivateRfqBook.NonceAlreadyUsed.selector, maker, quote.nonce));
        book.submitQuote(quote, proof, replaySignature);
    }

    function test_Erc1271TakerCanAuthorizeRequestAndSelection() public {
        (address owner, uint256 ownerKey) = makeAddrAndKey("safe owner");
        OrderSigner1271Mock wallet = new OrderSigner1271Mock(owner);
        PrivateRfqRequest memory request = _request(20);
        request.taker = address(wallet);
        PackageLeg[] memory noLegs = new PackageLeg[](0);
        RfqId rfqId = book.hashRequest(request);
        book.registerRequest(request, noLegs, _sign(ownerKey, RfqId.unwrap(rfqId)));
        vm.prank(address(wallet));
        book.openCollection(rfqId);

        MakerQuote memory quote = _quote(rfqId, 21);
        bytes32[] memory proof = new bytes32[](0);
        MakerQuoteId quoteId = book.hashQuote(quote);
        book.submitQuote(quote, proof, _sign(makerKey, MakerQuoteId.unwrap(quoteId)));
        book.reserveQuoteCapacity(quoteId);
        RfqSelectionAuthorization memory selection = _selection(rfqId, quoteId, address(wallet), 22);
        bytes32 digest = RfqHashLib.selectionDigest(selection, block.chainid, address(book));
        book.lockSelection(selection, _sign(ownerKey, digest));
        assertEq(uint8(book.getRfq(rfqId).status), uint8(RfqStatus.SelectionLocked));
    }

    function test_OptionalPackageLegCommitmentUsesCanonicalLegHash() public {
        PrivateRfqRequest memory request = _request(30);
        request.targetKind = RfqTargetKind.Package;
        request.seriesId = SeriesId.wrap(bytes32(0));
        request.packageId = PackageId.wrap(keccak256("package"));
        request.hasPackageLegCommitment = true;
        PackageLeg[] memory legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: 1});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: -1});
        request.packageLegsHash = RfqHashLib.hashRequest(request);
        bytes memory signature = _sign(takerKey, RfqId.unwrap(book.hashRequest(request)));
        vm.expectRevert(RfqHashLib.InvalidPackageLegCommitment.selector);
        book.registerRequest(request, legs, signature);
    }

    function testFuzz_PartialHandoffNeverOverdrawsFirmCapacity(uint8 rawFill) public {
        uint128 fill = uint128(bound(rawFill, 10, 90));
        (RfqId rfqId, MakerQuoteId quoteId) = _prepareSubmittedRfq();
        uint128 liability = fill * 10;
        vm.prank(clearing);
        ClearingHandoff memory handoff =
            book.consumeClearingHandoff(rfqId, Lots.wrap(fill), liability, keccak256(abi.encode("fill", fill)));
        vm.prank(address(positionEngine));
        vault.consumeLock(handoff.makerLockId, liability);

        FirmCapacityRecord memory capacity = book.getCapacity(quoteId);
        assertEq(capacity.remainingLiability, 1_000 - liability);
        assertEq(uint8(capacity.status), uint8(FirmCapacityStatus.Active));
        assertEq(uint8(book.getQuote(quoteId).status), uint8(MakerQuoteStatus.Selected));
    }

    function _prepareSubmittedRfq() internal returns (RfqId rfqId, MakerQuoteId quoteId) {
        (rfqId, quoteId) = _createSelectedRfq();
        book.confirmSelectedCapacity(rfqId);
        vm.prank(executor);
        book.authorizeSubmission(rfqId);
        vm.prank(executor);
        book.submitSelectedRfq(rfqId, keccak256("submission"));
    }

    function _createSelectedRfq() internal returns (RfqId rfqId, MakerQuoteId quoteId) {
        (rfqId, quoteId) = _createReservedQuote();
        RfqSelectionAuthorization memory selection = _selection(rfqId, quoteId, taker, 77);
        bytes32 digest = RfqHashLib.selectionDigest(selection, block.chainid, address(book));
        book.lockSelection(selection, _sign(takerKey, digest));
    }

    function _createReservedQuote() internal returns (RfqId rfqId, MakerQuoteId quoteId) {
        rfqId = _createCollectingRfq(1);
        MakerQuote memory quote = _quote(rfqId, 2);
        bytes32[] memory proof = new bytes32[](0);
        quoteId = book.hashQuote(quote);
        book.submitQuote(quote, proof, _sign(makerKey, MakerQuoteId.unwrap(quoteId)));
        book.reserveQuoteCapacity(quoteId);
    }

    function _createCollectingRfq(uint256 nonce) internal returns (RfqId rfqId) {
        PrivateRfqRequest memory request = _request(nonce);
        PackageLeg[] memory noLegs = new PackageLeg[](0);
        rfqId = book.hashRequest(request);
        book.registerRequest(request, noLegs, _sign(takerKey, RfqId.unwrap(rfqId)));
        vm.prank(taker);
        book.openCollection(rfqId);
    }

    function _selection(RfqId rfqId, MakerQuoteId quoteId, address selectionTaker, uint256 nonce)
        internal
        view
        returns (RfqSelectionAuthorization memory)
    {
        return RfqSelectionAuthorization({
            rfqId: rfqId,
            quoteId: quoteId,
            taker: selectionTaker,
            executor: executor,
            nonce: nonce,
            deadline: uint64(NOW + 1 hours),
            salt: keccak256(abi.encode("selection", nonce))
        });
    }

    function _request(uint256 nonce) internal view returns (PrivateRfqRequest memory) {
        return PrivateRfqRequest({
            taker: taker,
            takerAccountId: AccountId.wrap(keccak256("taker account")),
            takerOrderHash: keccak256(abi.encode("taker order", nonce)),
            targetKind: RfqTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            hasPackageLegCommitment: false,
            packageLegsHash: bytes32(0),
            sidePolicy: RfqSidePolicy.TwoWay,
            lots: Lots.wrap(100),
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(10),
            remainderPolicy: RemainderPolicy.KeepOpen,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee schedule")),
            feeScheduleVersion: 1,
            maxFeeMinor: 100,
            riskDomainId: RISK_DOMAIN,
            riskDomainVersion: 1,
            privacyModeId: PRIVACY_MODE,
            executionModeId: EXECUTION_MODE,
            disclosurePolicyHash: keccak256("disclosure"),
            eligibleMakerSetHash: keccak256(abi.encode(maker)),
            deadline: uint64(NOW + 2 hours),
            permittedExecutor: executor,
            nonce: nonce,
            salt: keccak256(abi.encode("request", nonce))
        });
    }

    function _quote(RfqId rfqId, uint256 nonce) internal view returns (MakerQuote memory) {
        PrivateRfqRequest memory request = book.getRfq(rfqId).request;
        return MakerQuote({
            rfqId: rfqId,
            maker: maker,
            makerAccountId: AccountId.wrap(keccak256("maker account")),
            takerAccountId: request.takerAccountId,
            makerOrderHash: keccak256(abi.encode("maker order", nonce)),
            targetKind: request.targetKind,
            seriesId: request.seriesId,
            packageId: request.packageId,
            targetVersion: request.targetVersion,
            hasPackageLegCommitment: request.hasPackageLegCommitment,
            packageLegsHash: request.packageLegsHash,
            sidePolicy: request.sidePolicy,
            lots: request.lots,
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(10),
            remainderPolicy: RemainderPolicy.KeepOpen,
            bidPriceTicks: PriceTicks.wrap(490),
            askPriceTicks: PriceTicks.wrap(510),
            feeScheduleId: request.feeScheduleId,
            feeScheduleVersion: request.feeScheduleVersion,
            maxFeeMinor: request.maxFeeMinor,
            riskDomainId: request.riskDomainId,
            riskDomainVersion: request.riskDomainVersion,
            collateralAssetId: COLLATERAL_ASSET,
            collateralBindingVersion: 1,
            maximumLiability: 1_000,
            privacyModeId: request.privacyModeId,
            executionModeId: request.executionModeId,
            disclosurePolicyHash: request.disclosurePolicyHash,
            eligibleMakerSetHash: request.eligibleMakerSetHash,
            deadline: uint64(NOW + 1 hours),
            capacityExpiry: uint64(NOW + 2 hours),
            permittedExecutor: request.permittedExecutor,
            nonce: nonce,
            salt: keccak256(abi.encode("quote", nonce))
        });
    }

    function _sign(uint256 privateKey, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
