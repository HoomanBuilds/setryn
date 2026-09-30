// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {LifecycleHashLib} from "../../src/libraries/LifecycleHashLib.sol";
import {SignedLifecycleEngine} from "../../src/lifecycle/SignedLifecycleEngine.sol";
import {
    AccountId,
    CollateralId,
    ExercisePolicyId,
    FeeScheduleId,
    PositionId,
    RiskDomainId,
    SeriesId
} from "../../src/types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleActionStatus,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../../src/types/LifecycleTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {PositionExerciseState} from "../../src/types/PositionTypes.sol";
import {
    LifecycleAccountAuthorityMock,
    LifecycleAtomicExecutorMock,
    LifecyclePolicyValidatorMock,
    LifecyclePositionSourceMock,
    LifecycleRiskDomainRegistryMock
} from "../mocks/LifecycleMocks.sol";

contract SignedLifecycleEngineTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    AccountId internal constant FIRST = AccountId.wrap(bytes32(uint256(1)));
    AccountId internal constant SECOND = AccountId.wrap(bytes32(uint256(2)));
    RiskDomainId internal constant DOMAIN = RiskDomainId.wrap(bytes32(uint256(3)));
    CollateralId internal constant COLLATERAL = CollateralId.wrap(bytes32(uint256(4)));
    FeeScheduleId internal constant FEE = FeeScheduleId.wrap(bytes32(uint256(5)));

    LifecyclePositionSourceMock internal source;
    LifecycleAccountAuthorityMock internal authority;
    LifecyclePolicyValidatorMock internal validator;
    LifecycleAtomicExecutorMock internal executor;
    LifecycleRiskDomainRegistryMock internal risks;
    SignedLifecycleEngine internal engine;
    address internal actor;
    uint256 internal actorKey;
    address internal counterparty;
    uint256 internal counterpartyKey;

    function setUp() public {
        vm.warp(NOW);
        (actor, actorKey) = makeAddrAndKey("actor");
        (counterparty, counterpartyKey) = makeAddrAndKey("counterparty");
        source = new LifecyclePositionSourceMock();
        authority = new LifecycleAccountAuthorityMock();
        validator = new LifecyclePolicyValidatorMock();
        executor = new LifecycleAtomicExecutorMock();
        risks = new LifecycleRiskDomainRegistryMock();
        risks.setDomain(DOMAIN, 1, true, false);
        authority.setSigner(FIRST, actor, true);
        authority.setSigner(SECOND, counterparty, true);
        engine = new SignedLifecycleEngine(
            3 days, address(this), source, authority, validator, executor, IRiskDomainRegistry(address(risks))
        );
    }

    function test_SignedFullUnwindExecutesAtomicallyWhileDomainPaused() public {
        LifecyclePositionSnapshot memory snapshot = _snapshot();
        source.setPosition(snapshot, LifecycleActionKind.FullUnwind, true);
        LifecycleInput[] memory inputs = new LifecycleInput[](1);
        inputs[0] = LifecycleInput({
            positionId: snapshot.positionId,
            expectedImmutableHash: snapshot.immutableHash,
            expectedLifecycleHash: snapshot.lifecycleHash,
            expectedPositionLots: snapshot.positionLots,
            actionLots: snapshot.positionLots
        });
        LifecycleSuccessor[] memory successors = new LifecycleSuccessor[](0);
        LifecycleCollateralReplacement[] memory replacements = new LifecycleCollateralReplacement[](2);
        replacements[0] = LifecycleCollateralReplacement(FIRST, COLLATERAL, 0);
        replacements[1] = LifecycleCollateralReplacement(SECOND, COLLATERAL, 0);
        LifecycleConsent[] memory consents = new LifecycleConsent[](1);
        consents[0] = LifecycleConsent({
            actionId: LifecycleActionId.wrap(bytes32(0)),
            accountId: SECOND,
            signer: counterparty,
            nonce: 1,
            deadline: uint64(NOW + 100),
            maximumLiabilityIncreaseBaseUnits: 0,
            maximumCollateralIncreaseBaseUnits: 0,
            allowsPackageBreak: false,
            salt: keccak256("counterparty consent")
        });
        LifecycleAction memory action = _action(inputs, successors, replacements, consents);
        LifecycleActionId actionId =
            LifecycleHashLib.deriveActionId(LifecycleHashLib.hashAction(action, block.chainid, address(engine)));
        consents[0].actionId = actionId;
        bytes[] memory consentSignatures = new bytes[](1);
        consentSignatures[0] =
            _sign(counterpartyKey, LifecycleHashLib.consentDigest(consents[0], block.chainid, address(engine)));
        bytes memory actorSignature =
            _sign(actorKey, LifecycleHashLib.actionDigest(action, block.chainid, address(engine)));

        engine.authorizeAction(action, inputs, successors, replacements, consents, consentSignatures, actorSignature);
        vm.expectRevert();
        engine.authorizeAction(action, inputs, successors, replacements, consents, consentSignatures, actorSignature);
        vm.prank(action.permittedExecutor);
        engine.executeAction(action, inputs, successors, replacements, consents);

        assertEq(uint8(engine.getAction(actionId).status), uint8(LifecycleActionStatus.Executed));
        assertEq(executor.calls(), 1);
    }

    function test_SignedExerciseCommitsToFixingWitnessAndExecutes() public {
        LifecyclePositionSnapshot memory snapshot = _snapshot();
        source.setPosition(snapshot, LifecycleActionKind.Exercise, true);
        LifecycleInput[] memory inputs = new LifecycleInput[](1);
        inputs[0] = LifecycleInput({
            positionId: snapshot.positionId,
            expectedImmutableHash: snapshot.immutableHash,
            expectedLifecycleHash: snapshot.lifecycleHash,
            expectedPositionLots: snapshot.positionLots,
            actionLots: snapshot.positionLots
        });
        LifecycleSuccessor[] memory successors = new LifecycleSuccessor[](0);
        LifecycleCollateralReplacement[] memory replacements = new LifecycleCollateralReplacement[](1);
        replacements[0] = LifecycleCollateralReplacement(FIRST, COLLATERAL, 0);
        LifecycleConsent[] memory consents = new LifecycleConsent[](0);
        LifecycleAction memory action = _action(inputs, successors, replacements, consents);
        action.kind = LifecycleActionKind.Exercise;
        action.salt = keccak256("exercise");

        // Without the fixing witness commitment the action is malformed.
        bytes memory missingSignature =
            _sign(actorKey, LifecycleHashLib.actionDigest(action, block.chainid, address(engine)));
        vm.expectRevert(LifecycleHashLib.InvalidLifecycleAction.selector);
        engine.authorizeAction(action, inputs, successors, replacements, consents, new bytes[](0), missingSignature);

        action.economicTransitionHash = keccak256(abi.encode(keccak256("fixing reference"), keccak256("final fixings")));
        LifecycleActionId actionId =
            LifecycleHashLib.deriveActionId(LifecycleHashLib.hashAction(action, block.chainid, address(engine)));
        bytes memory actorSignature =
            _sign(actorKey, LifecycleHashLib.actionDigest(action, block.chainid, address(engine)));
        engine.authorizeAction(action, inputs, successors, replacements, consents, new bytes[](0), actorSignature);
        vm.prank(action.permittedExecutor);
        engine.executeAction(action, inputs, successors, replacements, consents);

        assertEq(uint8(engine.getAction(actionId).status), uint8(LifecycleActionStatus.Executed));
        assertEq(executor.calls(), 1);
    }

    function _snapshot() internal pure returns (LifecyclePositionSnapshot memory) {
        return LifecyclePositionSnapshot({
            positionId: PositionId.wrap(bytes32(uint256(1))),
            immutableHash: keccak256("immutable"),
            lifecycleHash: keccak256("live"),
            seriesId: SeriesId.wrap(bytes32(uint256(9))),
            seriesVersion: 1,
            longAccountId: FIRST,
            shortAccountId: SECOND,
            riskDomainId: DOMAIN,
            riskDomainVersion: 1,
            feeScheduleId: FEE,
            feeScheduleVersion: 1,
            collateralId: COLLATERAL,
            positionLots: Lots.wrap(10),
            remainingExerciseLots: Lots.wrap(10),
            entryPriceTicks: PriceTicks.wrap(100),
            economicsHash: keccak256("economics"),
            packageProvenanceHash: bytes32(0),
            exercisePolicyId: ExercisePolicyId.wrap(keccak256("SetrynExercisePolicyV1:HolderElection")),
            exerciseState: PositionExerciseState.ElectionOpen,
            automaticExerciseThresholdMinor: 0,
            expiryAt: uint64(NOW - 10),
            exerciseOpensAt: uint64(NOW),
            exerciseCutoffAt: uint64(NOW + 50),
            lapseEligibleAt: uint64(NOW + 51),
            longTerminalLiabilityBaseUnits: 10,
            shortTerminalLiabilityBaseUnits: 10
        });
    }

    function _action(
        LifecycleInput[] memory inputs,
        LifecycleSuccessor[] memory successors,
        LifecycleCollateralReplacement[] memory replacements,
        LifecycleConsent[] memory consents
    ) internal view returns (LifecycleAction memory) {
        return LifecycleAction({
            kind: LifecycleActionKind.FullUnwind,
            actor: actor,
            actorAccountId: FIRST,
            policyContextHash: keccak256("policy"),
            inputsHash: LifecycleHashLib.hashInputs(inputs),
            successorsHash: LifecycleHashLib.hashSuccessors(successors),
            collateralReplacementsHash: LifecycleHashLib.hashCollateralReplacements(replacements),
            participantSetHash: LifecycleHashLib.hashParticipantSet(FIRST, consents),
            consentsHash: LifecycleHashLib.hashConsentTerms(consents),
            riskDomainId: DOMAIN,
            riskDomainVersion: 1,
            feeScheduleId: FEE,
            feeScheduleVersion: 1,
            economicTransitionHash: bytes32(0),
            compressionPlanId: bytes32(0),
            breaksPackageProvenance: false,
            packageBreakPermissionHash: bytes32(0),
            actorMaximumLiabilityIncreaseBaseUnits: 0,
            actorMaximumCollateralIncreaseBaseUnits: 0,
            inputCount: uint16(inputs.length),
            successorCount: uint16(successors.length),
            participantCount: uint16(consents.length + 1),
            deadline: uint64(NOW + 100),
            nonce: 1,
            permittedExecutor: address(0xBEEF),
            salt: keccak256("action")
        });
    }

    function _sign(uint256 privateKey, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
