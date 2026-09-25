// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "./ICollateralVault.sol";
import {IDefaultBidderGate} from "./IDefaultBidderGate.sol";
import {IDefaultLifecycleExecutor} from "./IDefaultLifecycleExecutor.sol";
import {IPortfolioRiskEngine} from "./IPortfolioRiskEngine.sol";
import {
    DefaultExecutionResult,
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    DefaultProcessStatus,
    InsuranceDeposit,
    InsuranceDepositId,
    InsurancePolicy,
    InsuranceReservation,
    InsuranceReservationId,
    LiquidationBidId,
    LiquidationBidRecord,
    LiquidationBidReveal
} from "../types/DefaultTypes.sol";
import {AccountId, PositionId, RiskDomainId} from "../types/Identifiers.sol";

interface IDefaultProcessEngine {
    event DefaultOpened(
        DefaultProcessId indexed processId,
        PositionId indexed positionId,
        AccountId indexed accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        bytes32 openingProofHash,
        uint128 deficiencyMinor,
        uint128 lockedCollateralMinor,
        uint64 cureEndsAt,
        uint64 finalResolutionAt
    );
    event DefaultStatusChanged(
        DefaultProcessId indexed processId,
        DefaultProcessStatus previousStatus,
        DefaultProcessStatus newStatus,
        bytes32 evidenceHash,
        address caller
    );
    event CureCollateralLocked(
        DefaultProcessId indexed processId, bytes32 indexed lockId, uint128 amountMinor, address caller
    );
    event LiquidationBidCommitted(
        DefaultProcessId indexed processId,
        LiquidationBidId indexed bidId,
        address indexed bidder,
        bytes32 sealedBidHash,
        bytes32 bondLockId,
        bytes32 capacityLockId,
        uint128 capacityMinor
    );
    event LiquidationBidRevealed(
        DefaultProcessId indexed processId,
        LiquidationBidId indexed bidId,
        uint128 takeoverContributionMinor,
        uint128 discountMinor,
        uint128 maximumInsuranceDrawMinor
    );
    event LiquidationAuctionCleared(
        DefaultProcessId indexed processId,
        LiquidationBidId indexed winningBidId,
        uint128 defaulterCollateralMinor,
        uint128 takeoverContributionMinor,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    );
    event InsuranceDeposited(
        InsuranceDepositId indexed depositId,
        RiskDomainId indexed riskDomainId,
        uint32 indexed riskDomainVersion,
        AccountId funderAccountId,
        bytes32 lockId,
        uint128 amountMinor,
        uint64 expiry
    );
    event InsuranceReserved(
        InsuranceReservationId indexed reservationId,
        DefaultProcessId indexed processId,
        uint128 amountMinor,
        bytes32 linesHash
    );
    event InsuranceConsumed(
        InsuranceReservationId indexed reservationId, DefaultProcessId indexed processId, uint128 amountMinor
    );
    event DefaultResolved(
        DefaultProcessId indexed processId,
        bytes32 indexed outcomeHash,
        bytes32 indexed positionOutcomeReference,
        DefaultProcessStatus status,
        DefaultExecutionResult result
    );

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error DependencyGraphMismatch(address expected, address actual);
    error UnknownDefaultProcess(DefaultProcessId processId);
    error DuplicateDefaultProcess(DefaultProcessId processId);
    error InvalidDefaultProcessStatus(DefaultProcessStatus status);
    error InvalidPolicyWitness(bytes32 expected, bytes32 actual);
    error InvalidProcessRules();
    error RiskDomainRecordMismatch();
    error DefaultStateMismatch();
    error PositionNotDeficient();
    error StaleDefaultProof(uint64 evaluatedAt, uint256 currentTimestamp);
    error DefaultProofNotNewer(uint64 previous, uint64 supplied);
    error DeadlineOutsideFinalResolution(uint64 deadline, uint64 finalResolutionAt);
    error PhaseNotOpen(uint64 opensAt, uint256 currentTimestamp);
    error PhaseClosed(uint64 closesAt, uint256 currentTimestamp);
    error BidCapacityReached(uint16 maximumBids);
    error BidderNotQualified(address bidder, AccountId bidderAccountId);
    error BidderControllerMismatch(address expected, address actual);
    error DuplicateBid(LiquidationBidId bidId);
    error UnknownBid(LiquidationBidId bidId);
    error BidCommitmentMismatch();
    error InvalidBidFunding();
    error NoWinningBid();
    error DuplicateInsuranceDeposit(InsuranceDepositId depositId);
    error UnknownInsuranceDeposit(InsuranceDepositId depositId);
    error InsuranceDepositMismatch(InsuranceDepositId depositId);
    error InsuranceDepositOrderMismatch(uint256 index);
    error InsuranceFundingInsufficient(uint128 required, uint128 available);
    error InsuranceAlreadyReserved(InsuranceReservationId reservationId);
    error InsuranceReservationMismatch();
    error InvalidExecutionResult();
    error ZeroAmount();
    error ZeroSalt();

    function portfolioRiskEngine() external view returns (IPortfolioRiskEngine);
    function collateralVault() external view returns (ICollateralVault);
    function bidderGate() external view returns (IDefaultBidderGate);
    function lifecycleExecutor() external view returns (IDefaultLifecycleExecutor);
    function openDefault(
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external returns (DefaultProcessId processId);
    function lockCureCollateral(DefaultProcessId processId, uint128 amountMinor) external;
    function recheckCure(DefaultProcessId processId, DefaultProcessRules calldata rules) external returns (bool cured);
    function advanceProcess(DefaultProcessId processId, DefaultProcessRules calldata rules) external;
    function commitBid(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        AccountId bidderAccountId,
        bytes32 sealedBidHash,
        bytes32 eligibilityEvidenceHash,
        uint128 capacityMinor
    ) external returns (LiquidationBidId bidId);
    function revealBid(
        LiquidationBidId bidId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        LiquidationBidReveal calldata reveal
    ) external;
    function clearAuction(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external returns (LiquidationBidId winningBidId);
    function depositInsurance(
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        AccountId funderAccountId,
        uint128 amountMinor,
        uint64 expiry,
        bytes32 salt,
        InsurancePolicy calldata policy
    ) external returns (InsuranceDepositId depositId);
    function reserveInsurance(
        DefaultProcessId processId,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external returns (InsuranceReservationId reservationId);
    function withdrawInsuranceDeposit(InsuranceDepositId depositId) external;
    function executeLiquidation(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external returns (bytes32 outcomeHash);
    function resolveTerminalDefault(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external returns (bytes32 outcomeHash);
    function getDefaultProcess(DefaultProcessId processId) external view returns (DefaultProcess memory process);
    function getBid(LiquidationBidId bidId) external view returns (LiquidationBidRecord memory bid);
    function getInsuranceDeposit(InsuranceDepositId depositId) external view returns (InsuranceDeposit memory deposit);
    function getInsuranceReservation(InsuranceReservationId reservationId)
        external
        view
        returns (InsuranceReservation memory reservation);
}
