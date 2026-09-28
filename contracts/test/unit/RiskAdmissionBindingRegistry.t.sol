// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {Eip712Lib} from "../../src/libraries/Eip712Lib.sol";
import {RiskAdmissionBindingRegistry} from "../../src/policy/RiskAdmissionBindingRegistry.sol";
import {Side} from "../../src/types/Enums.sol";
import {AccountId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    OrderActionId,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {
    RiskAdmission,
    RiskAdmissionCancellation,
    RiskAdmissionId,
    RiskAdmissionStatus
} from "../../src/types/RiskTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {RouteRiskEngineMock} from "../mocks/RoutingMocks.sol";

contract RiskAdmissionBindingRegistryTest is Test {
    bytes32 private constant CANCELLATION_TYPEHASH = keccak256(
        "SetrynRiskAdmissionCancellationV1(bytes32 admissionId,bytes32 orderHash,bytes32 accountId,address signer,uint256 nonce,uint64 deadline,bytes32 cancellationReference)"
    );

    RouteRiskEngineMock internal riskEngine;
    RiskAdmissionBindingRegistry internal registry;
    uint256 internal signerKey = 0xA11CE;
    address internal signer;

    function setUp() public {
        riskEngine = new RouteRiskEngineMock();
        registry = new RiskAdmissionBindingRegistry(IPortfolioRiskEngine(address(riskEngine)), address(0xBEEF));
        signer = vm.addr(signerKey);
    }

    function test_CancellationRequiresVersionedEip712Digest() public {
        AccountId accountId = AccountId.wrap(keccak256("account"));
        RiskAdmissionId admissionId = RiskAdmissionId.wrap(keccak256("admission"));
        riskEngine.setAdmission(
            admissionId,
            RiskAdmission({
                requestHash: keccak256("request"),
                resultHash: keccak256("result"),
                reservedResultCommitment: keccak256("result"),
                accountId: accountId,
                riskDomainId: RiskDomainId.wrap(keccak256("domain")),
                riskDomainVersion: 1,
                openInterestBaseUnits: 10,
                terminalLiabilityBaseUnits: 20,
                remainingOpenInterestBaseUnits: 10,
                remainingTerminalLiabilityBaseUnits: 20,
                deadline: uint64(block.timestamp + 1 hours),
                status: RiskAdmissionStatus.Reserved
            })
        );
        PublicOrder memory order = _order(accountId);
        vm.prank(signer);
        bytes32 orderHash = registry.bindOrderRisk(order, admissionId);
        RiskAdmissionCancellation memory cancellation = RiskAdmissionCancellation({
            admissionId: admissionId,
            orderHash: orderHash,
            accountId: accountId,
            signer: signer,
            nonce: 7,
            deadline: uint64(block.timestamp + 30 minutes),
            cancellationReference: keccak256("cancel")
        });

        bytes32 structHash = keccak256(
            abi.encode(
                CANCELLATION_TYPEHASH,
                RiskAdmissionId.unwrap(admissionId),
                orderHash,
                AccountId.unwrap(accountId),
                signer,
                cancellation.nonce,
                cancellation.deadline,
                cancellation.cancellationReference
            )
        );
        bytes32 digest =
            Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(block.chainid, address(registry)), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        registry.cancelBoundAdmission(cancellation, abi.encodePacked(r, s, v));

        assertEq(uint8(riskEngine.getAdmission(admissionId).status), uint8(RiskAdmissionStatus.Released));
    }

    function test_OrderVerifyingContractCanBeBoundExactlyOnce() public {
        RiskAdmissionBindingRegistry unbound =
            new RiskAdmissionBindingRegistry(IPortfolioRiskEngine(address(riskEngine)), address(0));

        unbound.bindOrderVerifyingContract(address(registry));

        assertEq(unbound.orderVerifyingContract(), address(registry));
        vm.expectRevert(RiskAdmissionBindingRegistry.OrderVerifyingContractAlreadyBound.selector);
        unbound.bindOrderVerifyingContract(address(registry));
    }

    function test_OnlyDeploymentAuthorityCanBindOrderVerifyingContract() public {
        RiskAdmissionBindingRegistry unbound =
            new RiskAdmissionBindingRegistry(IPortfolioRiskEngine(address(riskEngine)), address(0));

        vm.prank(signer);
        vm.expectRevert(RiskAdmissionBindingRegistry.UnauthorizedBindingAuthority.selector);
        unbound.bindOrderVerifyingContract(address(registry));
    }

    function _order(AccountId accountId) private view returns (PublicOrder memory) {
        return PublicOrder({
            signer: signer,
            accountId: accountId,
            policyId: keccak256("policy"),
            policyContextHash: keccak256("context"),
            actionId: OrderActionId.wrap(keccak256("action")),
            targetKind: OrderTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            side: Side.Buy,
            lots: Lots.wrap(10),
            priceTicks: PriceTicks.wrap(100),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(block.timestamp + 1 hours),
            executionModeId: keccak256("mode"),
            feeScheduleId: FeeScheduleId.wrap(keccak256("fees")),
            feeScheduleVersion: 1,
            maxFeeMinor: 5,
            recipient: signer,
            permittedExecutor: address(0),
            nonce: 1,
            salt: keccak256("salt"),
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(1),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }
}
