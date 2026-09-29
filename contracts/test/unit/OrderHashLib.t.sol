// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {OrderHashLib} from "../../src/libraries/OrderHashLib.sol";
import {Side} from "../../src/types/Enums.sol";
import {AccountId, FeeScheduleId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    OrderActionId,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";

contract OrderHashHarness {
    function hash(PublicOrder calldata order) external pure returns (bytes32) {
        return OrderHashLib.hash(order);
    }

    function digest(PublicOrder calldata order, uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        return OrderHashLib.digest(order, chainId, verifyingContract);
    }

    function validate(PublicOrder calldata order, uint256 currentTimestamp, uint64 maximumOrderLifetime) external pure {
        OrderHashLib.validate(order, currentTimestamp, maximumOrderLifetime);
    }
}

contract OrderHashLibTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    uint64 internal constant MAXIMUM_LIFETIME = 30 days;
    address internal constant VERIFIER = address(0x1234);

    OrderHashHarness internal harness;

    function setUp() public {
        harness = new OrderHashHarness();
    }

    function test_TypehashMatchesPublishedTypestring() public pure {
        assertEq(OrderHashLib.ORDER_TYPEHASH, keccak256(bytes(OrderHashLib.ORDER_TYPESTRING)));
    }

    function test_DigestSeparatesChainAndVerifyingContract() public view {
        PublicOrder memory order = _order();
        bytes32 baseline = harness.digest(order, 42161, VERIFIER);
        assertTrue(baseline != harness.digest(order, 421614, VERIFIER));
        assertTrue(baseline != harness.digest(order, 42161, address(0x5678)));
    }

    function test_HashBindsEconomicAuthorizationFields() public view {
        PublicOrder memory order = _order();
        bytes32 baseline = harness.hash(order);

        order.priceTicks = PriceTicks.wrap(501);
        assertTrue(harness.hash(order) != baseline);
        order = _order();
        order.policyContextHash = keccak256("other policy context");
        assertTrue(harness.hash(order) != baseline);
        order = _order();
        order.maxFeeMinor += 1;
        assertTrue(harness.hash(order) != baseline);
        order = _order();
        order.permittedExecutor = address(0xBEEF);
        assertTrue(harness.hash(order) != baseline);
        order = _order();
        order.reduceOnly = true;
        assertTrue(harness.hash(order) != baseline);
    }

    function test_ValidationRejectsAmbiguousTarget() public {
        PublicOrder memory order = _order();
        order.packageId = PackageId.wrap(keccak256("package"));
        vm.expectRevert(OrderHashLib.InvalidOrderTarget.selector);
        harness.validate(order, NOW, MAXIMUM_LIFETIME);
    }

    function test_ValidationRejectsUnknownAndNonCanonicalPolicies() public {
        PublicOrder memory order = _order();
        order.timeInForce = TimeInForce.Unspecified;
        vm.expectRevert(OrderHashLib.InvalidTimeInForce.selector);
        harness.validate(order, NOW, MAXIMUM_LIFETIME);

        order = _order();
        order.allowPartialFills = false;
        vm.expectRevert(OrderHashLib.NonCanonicalPartialFillPolicy.selector);
        harness.validate(order, NOW, MAXIMUM_LIFETIME);

        order = _order();
        order.timeInForce = TimeInForce.IOC;
        order.remainderPolicy = RemainderPolicy.KeepOpen;
        vm.expectRevert(OrderHashLib.NonCanonicalTimeInForcePolicy.selector);
        harness.validate(order, NOW, MAXIMUM_LIFETIME);
    }

    function test_ValidationEnforcesGtcMaximumLifetime() public {
        PublicOrder memory order = _order();
        order.deadline = uint64(NOW + MAXIMUM_LIFETIME + 1);
        vm.expectRevert(
            abi.encodeWithSelector(OrderHashLib.GtcLifetimeExceeded.selector, order.deadline, NOW + MAXIMUM_LIFETIME)
        );
        harness.validate(order, NOW, MAXIMUM_LIFETIME);
    }

    function test_FokRequiresFullQuantityAndCancelRemainderPolicy() public view {
        PublicOrder memory order = _order();
        order.timeInForce = TimeInForce.FOK;
        order.allowPartialFills = false;
        order.minimumFillLots = order.lots;
        order.remainderPolicy = RemainderPolicy.CancelRemainder;
        harness.validate(order, NOW, MAXIMUM_LIFETIME);
    }

    function _order() internal pure returns (PublicOrder memory) {
        return PublicOrder({
            signer: address(0xA11CE),
            accountId: AccountId.wrap(keccak256("account")),
            policyId: keccak256("policy"),
            policyContextHash: keccak256("policy context"),
            actionId: OrderActionId.wrap(keccak256("enter")),
            targetKind: OrderTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            side: Side.Buy,
            lots: Lots.wrap(100),
            priceTicks: PriceTicks.wrap(500),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(NOW + 1 days),
            executionModeId: keccak256("execution mode"),
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee schedule")),
            feeScheduleVersion: 1,
            maxFeeMinor: 10_000,
            recipient: address(0xB0B),
            permittedExecutor: address(0),
            nonce: 7,
            salt: keccak256("salt"),
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(10),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }
}
