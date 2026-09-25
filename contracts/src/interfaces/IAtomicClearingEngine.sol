// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IClearingAdmissionGate} from "./IClearingAdmissionGate.sol";
import {IOrderState} from "./IOrderState.sol";
import {IPackageRegistry} from "./IPackageRegistry.sol";
import {IPositionEngine} from "./IPositionEngine.sol";
import {ISeriesRegistry} from "./ISeriesRegistry.sol";
import {ICollateralVault} from "./ICollateralVault.sol";
import {IFundedFeeEngine} from "./IFundedFeeEngine.sol";
import {IClearingChannelHandoffAdapter} from "./IClearingChannelHandoffAdapter.sol";
import {ClearingHandoffClaim} from "../types/ClearingHandoffTypes.sol";
import {
    ClearingChannelKind,
    ClearingEntryKind,
    FillRecord,
    PackageClearingRequest,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {AccountId, CollateralLockId, FillId, PositionId} from "../types/Identifiers.sol";
import {IPortfolioRiskEngine} from "./IPortfolioRiskEngine.sol";

interface IAtomicClearingEngine {
    event FillCleared(FillId indexed fillId, FillRecord record, address indexed submitter);
    event FillLedgerEntry(
        FillId indexed fillId,
        ClearingEntryKind indexed kind,
        AccountId indexed payerAccountId,
        AccountId receiverAccountId,
        uint128 amount,
        bytes32 fundingReference
    );
    event FillPositionCreated(
        FillId indexed fillId,
        PositionId indexed positionId,
        bytes32 indexed seriesId,
        uint32 seriesVersion,
        uint16 ordinal,
        int32 packageRatio,
        uint128 lots,
        int128 entryPriceTicks,
        bytes32 longReservationId,
        bytes32 shortReservationId
    );
    event OrderFundingReserved(
        bytes32 indexed orderHash,
        bytes32 indexed purpose,
        CollateralLockId indexed lockId,
        uint128 cumulativeLots,
        uint128 amount,
        uint64 expiry,
        address requester
    );
    event OrderFundingReleased(
        bytes32 indexed orderHash,
        bytes32 indexed purpose,
        CollateralLockId indexed lockId,
        uint128 cumulativeLots,
        address requester
    );
    event ClearingChannelActivated(
        ClearingChannelKind indexed channelKind, address indexed adapter, bytes32 indexed capabilityHash
    );

    error ZeroInitialAdmin();
    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error DependencyGraphMismatch(address expected, address actual);
    error IdenticalOrderHashes();
    error FillAlreadyExists(FillId fillId);
    error UnknownFill(FillId fillId);
    error OrderTargetMismatch();
    error OrderSideMismatch();
    error ExecutionModeMismatch(bytes32 takerMode, bytes32 makerMode);
    error FeeScheduleMismatch();
    error PriceDoesNotCross(int128 buyerLimit, int128 sellerLimit, int128 executionPrice);
    error InvalidPackageWitness();
    error PackageLegPriceMismatch(int256 expected, int256 actual);
    error ConsiderationOverflow(uint256 amount);
    error FundingLockRequired(bytes32 orderHash, bytes32 purpose);
    error FundingLockUnexpected(bytes32 orderHash, bytes32 purpose);
    error FundingLockMismatch(bytes32 orderHash, bytes32 purpose);
    error PositionCreationMismatch(uint256 expected, uint256 actual);
    error UnauthorizedFundingCaller(bytes32 orderHash, address caller);
    error InvalidFundingPurpose(bytes32 purpose);
    error InvalidFundingCumulativeLots(uint128 filled, uint128 cumulative, uint128 total);
    error UnsupportedClearingChannel(ClearingChannelKind channelKind);
    error ClearingChannelAlreadyActivated(ClearingChannelKind channelKind);
    error ClearingChannelSourceMismatch(address expected, address actual);
    error ClearingHandoffMismatch();

    function clearSeries(SeriesClearingRequest calldata request) external returns (FillId fillId);
    function clearPackage(PackageClearingRequest calldata request) external returns (FillId fillId);
    function clearSeriesWithHandoff(SeriesClearingRequest calldata request, ClearingHandoffClaim calldata claim)
        external
        returns (FillId fillId);
    function clearPackageWithHandoff(PackageClearingRequest calldata request, ClearingHandoffClaim calldata claim)
        external
        returns (FillId fillId);
    function activateClearingChannel(
        ClearingChannelKind channelKind,
        IClearingChannelHandoffAdapter adapter,
        bytes32 capabilityHash
    ) external;
    function clearingChannelAdapter(ClearingChannelKind channelKind)
        external
        view
        returns (IClearingChannelHandoffAdapter);
    function reserveOrderFunding(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose, uint128 amount)
        external
        returns (CollateralLockId lockId);
    function releaseOrderFunding(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose) external;
    function getFill(FillId fillId) external view returns (FillRecord memory);
    function fillPositions(FillId fillId) external view returns (PositionId[] memory);
    function deriveFundingReference(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose)
        external
        pure
        returns (bytes32);
    function orderState() external view returns (IOrderState);
    function seriesRegistry() external view returns (ISeriesRegistry);
    function packageRegistry() external view returns (IPackageRegistry);
    function positionEngine() external view returns (IPositionEngine);
    function collateralVault() external view returns (ICollateralVault);
    function admissionGate() external view returns (IClearingAdmissionGate);
    function fundedFeeEngine() external view returns (IFundedFeeEngine);
    function riskEngine() external view returns (IPortfolioRiskEngine);
}
