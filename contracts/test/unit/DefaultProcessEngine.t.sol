// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IDefaultBidderGate} from "../../src/interfaces/IDefaultBidderGate.sol";
import {IDefaultLifecycleExecutor} from "../../src/interfaces/IDefaultLifecycleExecutor.sol";
import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {DefaultProcessLib} from "../../src/libraries/DefaultProcessLib.sol";
import {DefaultProcessEngine} from "../../src/default/DefaultProcessEngine.sol";
import {
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    DefaultProcessStatus,
    InsuranceDepositId,
    InsurancePolicy,
    LiquidationBidId,
    LiquidationBidReveal,
    ObjectiveDefaultState
} from "../../src/types/DefaultTypes.sol";
import {
    AccountId,
    AdapterId,
    AdapterKindId,
    AssetId,
    CollateralId,
    PositionId,
    RiskDomainId,
    RiskModelId
} from "../../src/types/Identifiers.sol";
import {RiskDomainDefinition} from "../../src/types/RiskDomainDefinition.sol";
import {
    DefaultBidderGateMock,
    DefaultCollateralVaultMock,
    DefaultLifecycleExecutorMock,
    DefaultRiskDomainRegistryMock,
    DefaultRiskEngineMock
} from "../mocks/DefaultProcessMocks.sol";

contract DefaultProcessEngineTest is Test {
    uint32 internal constant VERSION = 1;
    AccountId internal constant DEFAULTER = AccountId.wrap(bytes32(uint256(1)));
    AccountId internal constant BIDDER_ACCOUNT = AccountId.wrap(bytes32(uint256(2)));
    AccountId internal constant INSURANCE_ACCOUNT = AccountId.wrap(bytes32(uint256(3)));
    AccountId internal constant RECOVERY_ACCOUNT = AccountId.wrap(bytes32(uint256(4)));
    PositionId internal constant POSITION = PositionId.wrap(bytes32(uint256(5)));
    AssetId internal constant ASSET = AssetId.wrap(bytes32(uint256(6)));

    DefaultRiskDomainRegistryMock internal registry;
    DefaultCollateralVaultMock internal vault;
    DefaultRiskEngineMock internal riskEngine;
    DefaultBidderGateMock internal gate;
    DefaultLifecycleExecutorMock internal executor;
    DefaultProcessEngine internal engine;
    DefaultProcessRules internal rules;
    InsurancePolicy internal policy;
    RiskDomainId internal domainId;
    address internal bidder = address(0xB1D);
    address internal insurer = address(0x1A5);

    function setUp() public {
        vm.warp(100);
        rules = DefaultProcessRules({
            maximumProofAgeSeconds: 20,
            cureWindowSeconds: 10,
            commitWindowSeconds: 10,
            revealWindowSeconds: 10,
            executionWindowSeconds: 10,
            maximumBids: 8,
            requiredBondMinor: 5,
            minimumCapacityMinor: 10,
            recoveryAccountId: RECOVERY_ACCOUNT,
            bidderQualificationHash: keccak256("qualified"),
            scoringRuleId: DefaultProcessLib.SCORING_RULE,
            terminalRuleId: keccak256("terminal")
        });
        policy = InsurancePolicy({
            maximumDrawPerDefaultMinor: 20,
            maximumDepositsPerDraw: 4,
            insuranceAccountId: INSURANCE_ACCOUNT,
            allocationRuleId: DefaultProcessLib.INSURANCE_ALLOCATION_RULE
        });
        registry = new DefaultRiskDomainRegistryMock();
        domainId = registry.setDomain(_domain(), VERSION);
        vault = new DefaultCollateralVaultMock(address(registry));
        vault.setController(DEFAULTER, address(this));
        vault.setController(BIDDER_ACCOUNT, bidder);
        vault.setController(INSURANCE_ACCOUNT, insurer);
        vault.setController(RECOVERY_ACCOUNT, address(this));
        riskEngine = new DefaultRiskEngineMock(address(vault), address(registry));
        riskEngine.setState(_state(140, 40, 20, 1));
        gate = new DefaultBidderGateMock();
        executor = new DefaultLifecycleExecutorMock();
        engine = new DefaultProcessEngine(
            IPortfolioRiskEngine(address(riskEngine)),
            IDefaultBidderGate(address(gate)),
            IDefaultLifecycleExecutor(address(executor))
        );
    }

    function test_ObjectiveCureRecheckReleasesProcess() public {
        DefaultProcessId processId = _open();
        riskEngine.setState(_state(100, 100, 0, 2));

        assertTrue(engine.recheckCure(processId, rules));
        assertEq(uint8(engine.getDefaultProcess(processId).status), uint8(DefaultProcessStatus.Cured));
    }

    function test_FundedAuctionInsuranceAndNovationResolveOneShot() public {
        DefaultProcessId processId = _open();
        vm.warp(110);
        riskEngine.setState(_state(140, 40, 20, 2));
        engine.advanceProcess(processId, rules);

        LiquidationBidReveal memory reveal = LiquidationBidReveal({
            processId: processId,
            bidder: bidder,
            bidderAccountId: BIDDER_ACCOUNT,
            takeoverContributionMinor: 60,
            discountMinor: 2,
            maximumInsuranceDrawMinor: 20,
            eligibilityEvidenceHash: keccak256("eligibility"),
            revealSalt: keccak256("reveal")
        });
        bytes32 sealedBidHash = DefaultProcessLib.hashBidReveal(reveal);
        vm.prank(bidder);
        LiquidationBidId bidId =
            engine.commitBid(processId, rules, BIDDER_ACCOUNT, sealedBidHash, reveal.eligibilityEvidenceHash, 70);

        vm.warp(120);
        engine.advanceProcess(processId, rules);
        vm.prank(bidder);
        engine.revealBid(bidId, rules, policy, reveal);
        vm.warp(130);
        engine.advanceProcess(processId, rules);
        assertEq(LiquidationBidId.unwrap(engine.clearAuction(processId, rules, policy)), LiquidationBidId.unwrap(bidId));

        vm.prank(insurer);
        InsuranceDepositId depositId =
            engine.depositInsurance(domainId, VERSION, INSURANCE_ACCOUNT, 20, 1_300, keccak256("deposit"), policy);
        InsuranceDepositId[] memory deposits = new InsuranceDepositId[](1);
        deposits[0] = depositId;
        engine.reserveInsurance(processId, policy, deposits);
        bytes32 outcomeHash = engine.executeLiquidation(processId, rules, policy);
        DefaultProcess memory process = engine.getDefaultProcess(processId);

        assertEq(uint8(process.status), uint8(DefaultProcessStatus.Resolved));
        assertEq(process.takeoverContributionMinor, 60);
        assertEq(process.insuranceDrawMinor, 20);
        assertEq(process.terminalResidualMinor, 0);
        assertEq(process.outcomeHash, outcomeHash);
    }

    function _open() private returns (DefaultProcessId) {
        return engine.openDefault(POSITION, DEFAULTER, domainId, VERSION, rules, policy);
    }

    function _state(uint128 maintenance, uint128 collateral, uint128 available, uint64 sequence)
        private
        view
        returns (ObjectiveDefaultState memory state)
    {
        state = ObjectiveDefaultState({
            positionId: POSITION,
            accountId: DEFAULTER,
            riskDomainId: domainId,
            collateralId: CollateralId.wrap(keccak256(abi.encode(ASSET, VERSION))),
            riskDomainVersion: VERSION,
            evaluatedAt: uint64(block.timestamp),
            finalResolutionAt: 1_000,
            settlementDeadline: 1_200,
            sequence: sequence,
            maintenanceRequirementMinor: maintenance,
            collateralValueMinor: collateral,
            deficiencyMinor: maintenance - collateral,
            availableCollateralMinor: available,
            configurationHash: keccak256("configuration"),
            witnessHash: keccak256("witness"),
            observationsHash: keccak256("observations"),
            stateHash: bytes32(0)
        });
    }

    function _domain() private view returns (RiskDomainDefinition memory) {
        return RiskDomainDefinition({
            namespaceId: keccak256("setryn"),
            domainKey: keccak256("default.test"),
            riskModelId: RiskModelId.wrap(keccak256("risk.model")),
            collateralAssetId: ASSET,
            collateralAssetVersion: VERSION,
            riskAdapterId: AdapterId.wrap(keccak256("adapter")),
            riskAdapterVersion: VERSION,
            requiredAdapterKindId: AdapterKindId.wrap(keccak256("kind")),
            requiredInterfaceHash: keccak256("interface"),
            requiredCapabilityHash: keccak256("capability"),
            marginRulesHash: keccak256("margin"),
            scenarioSetHash: keccak256("scenarios"),
            concentrationRulesHash: keccak256("concentration"),
            defaultProcessHash: DefaultProcessLib.hashRules(rules),
            insurancePolicyHash: DefaultProcessLib.hashInsurancePolicy(policy),
            qualificationEvidenceHash: keccak256("evidence"),
            maxOpenInterestBaseUnits: 1_000,
            maxAggregateLiabilityBaseUnits: 1_000,
            maxAccountLiabilityBaseUnits: 500,
            maxAggregateReservationBaseUnits: 500,
            maxAccountReservationBaseUnits: 250
        });
    }
}
