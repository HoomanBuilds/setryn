// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {
    AuctionReceiptAuthority,
    FixingReceiptAuthority,
    ReceiptAuthorityBase,
    RecoveryReceiptAuthority,
    SolverReceiptAuthority,
    StreamReceiptAuthority
} from "../../src/evidence/ProtocolReceiptAuthorities.sol";
import {IFixingEngine} from "../../src/interfaces/IFixingEngine.sol";
import {IOperationalAdapterExecutor} from "../../src/interfaces/IOperationalAdapterExecutor.sol";
import {ISealedAuctionHouse} from "../../src/interfaces/ISealedAuctionHouse.sol";
import {IStreamingQuoteEngine} from "../../src/interfaces/IStreamingQuoteEngine.sol";
import {
    AuctionId,
    AuctionStatus,
    AuctionVersion,
    SolverRouteId,
    SolverRouteRecord
} from "../../src/types/AuctionTypes.sol";
import {ReceiptSubjectTerminalState} from "../../src/types/EvidenceTypes.sol";
import {FixingProposal, FixingResolutionKind, FixingResult} from "../../src/types/FixingTypes.sol";
import {SeriesId} from "../../src/types/Identifiers.sol";
import {ExternalActionRecord, OperationalActionState} from "../../src/types/OperationalAdapterTypes.sol";
import {StreamId, StreamPolicy} from "../../src/types/StreamTypes.sol";

contract ReceiptAuctionHouseMock {
    mapping(bytes32 key => AuctionVersion record) private _auctions;
    mapping(SolverRouteId routeId => SolverRouteRecord record) private _routes;

    function setAuction(AuctionId auctionId, uint32 version, AuctionStatus status, bytes32 clearingResultHash)
        external
    {
        AuctionVersion storage record = _auctions[keccak256(abi.encode(auctionId, version))];
        record.version = version;
        record.status = status;
        record.clearingResultHash = clearingResultHash;
    }

    function setRoute(SolverRouteId routeId, AuctionId auctionId, uint32 version, bytes32 routeHash) external {
        SolverRouteRecord storage record = _routes[routeId];
        record.route.auctionId = auctionId;
        record.route.auctionVersion = version;
        record.routeHash = routeHash;
        record.revealed = true;
    }

    function getAuction(AuctionId auctionId, uint32 version) external view returns (AuctionVersion memory record) {
        record = _auctions[keccak256(abi.encode(auctionId, version))];
        require(record.status != AuctionStatus.Unspecified, "unknown auction");
    }

    function getRoute(SolverRouteId routeId) external view returns (SolverRouteRecord memory record) {
        record = _routes[routeId];
        require(record.revealed, "unknown route");
    }
}

contract ReceiptFixingEngineMock {
    mapping(bytes32 key => FixingProposal proposal) private _proposals;
    mapping(bytes32 key => FixingResult result) private _results;

    function deriveFixingKey(SeriesId seriesId, uint32 version, uint8 slot) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), seriesId, version, slot));
    }

    function propose(SeriesId seriesId, uint32 version, uint8 slot, bytes32 proposalHash) external {
        _proposals[deriveFixingKey(seriesId, version, slot)].proposalHash = proposalHash;
    }

    function finalize(SeriesId seriesId, uint32 version, uint8 slot, bytes32 resultHash) external {
        FixingResult storage result = _results[deriveFixingKey(seriesId, version, slot)];
        result.resultHash = resultHash;
        result.resolutionKind = FixingResolutionKind.PrimaryFinal;
    }

    function getProposal(SeriesId seriesId, uint32 version, uint8 slot) external view returns (FixingProposal memory) {
        return _proposals[deriveFixingKey(seriesId, version, slot)];
    }

    function getFinalizedFixing(SeriesId seriesId, uint32 version, uint8 slot)
        external
        view
        returns (FixingResult memory)
    {
        return _results[deriveFixingKey(seriesId, version, slot)];
    }
}

contract ReceiptStreamEngineMock {
    mapping(StreamId streamId => StreamPolicy policy) private _policies;
    mapping(StreamId streamId => bool active) private _active;

    function setStream(StreamId streamId, address maker, bool active) external {
        _policies[streamId].maker = maker;
        _active[streamId] = active;
    }

    function getPolicy(StreamId streamId) external view returns (StreamPolicy memory policy) {
        policy = _policies[streamId];
        require(policy.maker != address(0), "unknown stream");
    }

    function streamActive(StreamId streamId) external view returns (bool) {
        return _active[streamId];
    }

    function nextSequence(StreamId) external pure returns (uint64) {
        return 3;
    }
}

contract ReceiptExecutorMock {
    mapping(bytes32 actionId => ExternalActionRecord record) private _actions;

    function setAction(bytes32 actionId, OperationalActionState state, uint64 timeoutAt, uint64 recoveryDeadline)
        external
    {
        ExternalActionRecord storage record = _actions[actionId];
        record.state = state;
        record.timeoutAt = timeoutAt;
        record.recoveryDeadline = recoveryDeadline;
        record.resultHash = keccak256(abi.encode("result", actionId, state));
    }

    function getExternalAction(bytes32 actionId) external view returns (ExternalActionRecord memory) {
        return _actions[actionId];
    }
}

contract ProtocolReceiptAuthoritiesTest is Test {
    bytes32 private constant AUCTION_KIND = keccak256("SetrynReceiptSubjectV1:Auction");
    bytes32 private constant SOLVER_KIND = keccak256("SetrynReceiptSubjectV1:Solver");
    bytes32 private constant FIXING_KIND = keccak256("SetrynReceiptSubjectV1:Fixing");
    bytes32 private constant STREAM_KIND = keccak256("SetrynReceiptSubjectV1:Stream");
    bytes32 private constant RECOVERY_KIND = keccak256("SetrynReceiptSubjectV1:Recovery");

    ReceiptAuctionHouseMock private house;
    ReceiptFixingEngineMock private fixings;
    ReceiptStreamEngineMock private streams;
    ReceiptExecutorMock private executor;
    AuctionReceiptAuthority private auctionAuthority;
    SolverReceiptAuthority private solverAuthority;
    FixingReceiptAuthority private fixingAuthority;
    StreamReceiptAuthority private streamAuthority;
    RecoveryReceiptAuthority private recoveryAuthority;

    function setUp() public {
        house = new ReceiptAuctionHouseMock();
        fixings = new ReceiptFixingEngineMock();
        streams = new ReceiptStreamEngineMock();
        executor = new ReceiptExecutorMock();
        auctionAuthority = new AuctionReceiptAuthority(AUCTION_KIND, ISealedAuctionHouse(address(house)));
        solverAuthority = new SolverReceiptAuthority(SOLVER_KIND, ISealedAuctionHouse(address(house)));
        fixingAuthority = new FixingReceiptAuthority(FIXING_KIND, IFixingEngine(address(fixings)));
        streamAuthority = new StreamReceiptAuthority(STREAM_KIND, IStreamingQuoteEngine(address(streams)));
        recoveryAuthority = new RecoveryReceiptAuthority(RECOVERY_KIND, IOperationalAdapterExecutor(address(executor)));
    }

    function test_AuctionSubjectMustBeRegisteredBeforeItResolves() public {
        AuctionId auctionId = AuctionId.wrap(keccak256("auction"));
        bytes32 subjectId = auctionAuthority.deriveSubjectId(auctionId, 1);
        ReceiptSubjectTerminalState memory unregistered =
            auctionAuthority.receiptSubjectTerminalState(AUCTION_KIND, subjectId);
        assertFalse(unregistered.transitionValid, "unregistered subjects are not valid");

        vm.expectRevert(bytes("unknown auction"));
        auctionAuthority.registerSubject(auctionId, 1);

        house.setAuction(auctionId, 1, AuctionStatus.CommitOpen, bytes32(0));
        assertEq(auctionAuthority.registerSubject(auctionId, 1), subjectId);
        assertEq(auctionAuthority.registerSubject(auctionId, 1), subjectId, "registration is idempotent");
        ReceiptSubjectTerminalState memory open = auctionAuthority.receiptSubjectTerminalState(AUCTION_KIND, subjectId);
        assertTrue(open.transitionValid);
        assertFalse(open.terminal, "an open auction is not terminal");

        bytes32 clearing = keccak256("clearing");
        house.setAuction(auctionId, 1, AuctionStatus.Settled, clearing);
        ReceiptSubjectTerminalState memory settled =
            auctionAuthority.receiptSubjectTerminalState(AUCTION_KIND, subjectId);
        assertTrue(settled.terminal);
        assertEq(settled.outcomeHash, clearing, "settled auctions commit to the clearing result");
    }

    function test_SolverRouteResolvesWithItsAuction() public {
        AuctionId auctionId = AuctionId.wrap(keccak256("auction"));
        SolverRouteId routeId = SolverRouteId.wrap(keccak256("route"));
        bytes32 routeHash = keccak256("route hash");
        house.setAuction(auctionId, 2, AuctionStatus.RevealOpen, bytes32(0));
        house.setRoute(routeId, auctionId, 2, routeHash);
        ReceiptSubjectTerminalState memory open =
            solverAuthority.receiptSubjectTerminalState(SOLVER_KIND, SolverRouteId.unwrap(routeId));
        assertTrue(open.transitionValid);
        assertFalse(open.terminal);

        bytes32 clearing = keccak256("clearing");
        house.setAuction(auctionId, 2, AuctionStatus.Settled, clearing);
        ReceiptSubjectTerminalState memory settled =
            solverAuthority.receiptSubjectTerminalState(SOLVER_KIND, SolverRouteId.unwrap(routeId));
        assertTrue(settled.terminal);
        assertEq(settled.outcomeHash, keccak256(abi.encode(routeHash, clearing)));
    }

    function test_FixingSubjectUsesTheEngineKeyAndResolvesOnFinalization() public {
        SeriesId seriesId = SeriesId.wrap(keccak256("series"));
        bytes32 fixingKey = fixings.deriveFixingKey(seriesId, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(FixingReceiptAuthority.UnknownFixing.selector, fixingKey));
        fixingAuthority.registerSubject(seriesId, 1, 0);

        fixings.propose(seriesId, 1, 0, keccak256("proposal"));
        assertEq(fixingAuthority.registerSubject(seriesId, 1, 0), fixingKey);
        ReceiptSubjectTerminalState memory proposed =
            fixingAuthority.receiptSubjectTerminalState(FIXING_KIND, fixingKey);
        assertTrue(proposed.transitionValid);
        assertFalse(proposed.terminal);

        fixings.finalize(seriesId, 1, 0, keccak256("result"));
        ReceiptSubjectTerminalState memory finalized =
            fixingAuthority.receiptSubjectTerminalState(FIXING_KIND, fixingKey);
        assertTrue(finalized.terminal);
        assertEq(finalized.outcomeHash, keccak256("result"));
    }

    function test_StreamIsTerminalOnlyOnceInactive() public {
        StreamId streamId = StreamId.wrap(keccak256("stream"));
        streams.setStream(streamId, makeAddr("maker"), true);
        assertFalse(streamAuthority.receiptSubjectTerminalState(STREAM_KIND, StreamId.unwrap(streamId)).terminal);
        streams.setStream(streamId, makeAddr("maker"), false);
        ReceiptSubjectTerminalState memory closed =
            streamAuthority.receiptSubjectTerminalState(STREAM_KIND, StreamId.unwrap(streamId));
        assertTrue(closed.terminal);
        assertTrue(closed.transitionValid);
    }

    function test_RecoveryCoversOnlyActionsWithABoundedRecoveryPath() public {
        bytes32 recovered = keccak256("recovered");
        executor.setAction(recovered, OperationalActionState.Recovered, 100, 200);
        ReceiptSubjectTerminalState memory state =
            recoveryAuthority.receiptSubjectTerminalState(RECOVERY_KIND, recovered);
        assertTrue(state.terminal);
        assertTrue(state.transitionValid);

        bytes32 lapsed = keccak256("lapsed");
        executor.setAction(lapsed, OperationalActionState.NoEffect, 100, 200);
        assertTrue(recoveryAuthority.receiptSubjectTerminalState(RECOVERY_KIND, lapsed).terminal);

        bytes32 atomic = keccak256("atomic");
        executor.setAction(atomic, OperationalActionState.NoEffect, 0, 0);
        ReceiptSubjectTerminalState memory atomicState =
            recoveryAuthority.receiptSubjectTerminalState(RECOVERY_KIND, atomic);
        assertFalse(atomicState.transitionValid, "actions without a recovery path are not recovery subjects");
        assertFalse(atomicState.terminal);
    }

    function test_AuthoritiesRejectForeignSubjectKinds() public {
        vm.expectRevert(abi.encodeWithSelector(ReceiptAuthorityBase.UnsupportedSubjectKind.selector, AUCTION_KIND));
        streamAuthority.receiptSubjectTerminalState(AUCTION_KIND, bytes32(uint256(1)));
    }
}
