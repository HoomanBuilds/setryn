// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";

import {ISessionRegistry} from "../src/interfaces/ISessionRegistry.sol";
import {ITradingSessionPolicy} from "../src/interfaces/ITradingSessionPolicy.sol";
import {SessionId, WindowKindId} from "../src/types/Identifiers.sol";
import {SessionDay, SessionWindow} from "../src/types/SessionDefinition.sol";

/// @notice Publishes every missing session day in a range from the session-day proofs file BootstrapSetrynMarkets
/// wrote (`deployments/<network>/session-days.json`). TradingSessionPolicy.publishSessionDay is permissionless: the
/// day, its windows and its Merkle proof are checked against the session version's registered day-schedule root, so
/// any funded account may run this. Trading needs the current day published; the keeper sweep keeps today through
/// three days ahead published, and this script is the manual path.
///
///   SETRYN_SESSION_DAYS=deployments/<network>/session-days.json \
///   [SETRYN_SESSION_DAY_FROM=<UTC day>] [SETRYN_SESSION_DAY_THROUGH=<UTC day>] \
///   forge script script/PublishSessionDays.s.sol:PublishSessionDays --root contracts --rpc-url <rpc> --broadcast ...
///
/// The range defaults to today through three days ahead and is clipped to the session's horizon. Days already
/// published are skipped. Arbitrum One is refused.
contract PublishSessionDays is Script {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    uint256 private constant SESSION_DAYS_SCHEMA_VERSION = 1;
    uint32 private constant DEFAULT_DAYS_AHEAD = 3;
    bytes4 private constant DUPLICATE_SESSION_DAY = bytes4(keccak256("DuplicateSessionDay()"));

    error MainnetPublishingDisabled(uint256 chainId);
    error InvalidSessionDaysFile(string reason);
    error EmptyRange(uint32 fromDay, uint32 throughDay);
    error InvalidSessionDayProof(uint32 day);

    struct SessionDays {
        ITradingSessionPolicy policy;
        ISessionRegistry sessions;
        SessionId sessionId;
        uint32 sessionVersion;
        uint32 fromDay;
        uint32 throughDay;
    }

    function run() external returns (uint32[] memory published) {
        string memory json = vm.readFile(vm.envString("SETRYN_SESSION_DAYS"));
        uint32 today = uint32(block.timestamp / 1 days);
        uint32 first = uint32(vm.envOr("SETRYN_SESSION_DAY_FROM", uint256(today)));
        uint32 last = uint32(vm.envOr("SETRYN_SESSION_DAY_THROUGH", uint256(first + DEFAULT_DAYS_AHEAD)));
        return publish(json, first, last);
    }

    /// Publishes each day in [first, last] that the file covers and the policy has not published yet.
    function publish(string memory json, uint32 first, uint32 last) public returns (uint32[] memory published) {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID) revert MainnetPublishingDisabled(block.chainid);
        SessionDays memory file = _read(json);
        if (first < file.fromDay) first = file.fromDay;
        if (last > file.throughDay) last = file.throughDay;
        if (first > last) revert EmptyRange(first, last);

        uint32[] memory days_ = new uint32[](last - first + 1);
        uint256 count;
        for (uint32 day = first; day <= last; ++day) {
            string memory path = string.concat(".days[", vm.toString(uint256(day - file.fromDay)), "]");
            if (vm.parseJsonUint(json, string.concat(path, ".day")) != day) revert InvalidSessionDaysFile(path);
            SessionDay memory sessionDay = SessionDay({
                day: day,
                windowsHash: vm.parseJsonBytes32(json, string.concat(path, ".windowsHash")),
                evidenceHash: vm.parseJsonBytes32(json, string.concat(path, ".evidenceHash"))
            });
            SessionWindow[] memory windows = _windows(json, path);
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, string.concat(path, ".proof"));
            if (
                file.sessions.hashWindows(windows) != sessionDay.windowsHash
                    || !file.sessions.verifyDay(file.sessionId, file.sessionVersion, sessionDay, proof)
            ) revert InvalidSessionDayProof(day);
            if (_published(file, sessionDay, windows, proof)) {
                console2.log("session day already published", day);
                continue;
            }
            vm.broadcast();
            file.policy.publishSessionDay(file.sessionId, file.sessionVersion, sessionDay, windows, proof);
            console2.log("published session day", day);
            days_[count++] = day;
        }
        published = new uint32[](count);
        for (uint256 i; i < count; ++i) {
            published[i] = days_[i];
        }
    }

    /// Probes the permissionless publish against a state snapshot: it reverts with DuplicateSessionDay exactly when the
    /// day is already published. Nothing the probe does is broadcast or kept.
    function _published(
        SessionDays memory file,
        SessionDay memory sessionDay,
        SessionWindow[] memory windows,
        bytes32[] memory proof
    ) private returns (bool published) {
        Vm cheats = Vm(address(vm));
        uint256 snapshot = cheats.snapshotState();
        try file.policy.publishSessionDay(file.sessionId, file.sessionVersion, sessionDay, windows, proof) {
            published = false;
        } catch (bytes memory reason) {
            if (reason.length < 4 || bytes4(reason) != DUPLICATE_SESSION_DAY) {
                assembly ("memory-safe") {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
            published = true;
        }
        cheats.revertToState(snapshot);
    }

    function _read(string memory json) private view returns (SessionDays memory file) {
        if (vm.parseJsonUint(json, ".schemaVersion") != SESSION_DAYS_SCHEMA_VERSION) {
            revert InvalidSessionDaysFile("schemaVersion");
        }
        if (vm.parseJsonUint(json, ".chainId") != block.chainid) revert InvalidSessionDaysFile("chainId");
        file.policy = ITradingSessionPolicy(vm.parseJsonAddress(json, ".tradingSessionPolicy"));
        file.sessions = ISessionRegistry(vm.parseJsonAddress(json, ".sessionRegistry"));
        if (address(file.policy).code.length == 0 || address(file.sessions).code.length == 0) {
            revert InvalidSessionDaysFile("contracts have no code on this chain");
        }
        file.sessionId = SessionId.wrap(vm.parseJsonBytes32(json, ".sessionId"));
        file.sessionVersion = uint32(vm.parseJsonUint(json, ".sessionVersion"));
        file.fromDay = uint32(vm.parseJsonUint(json, ".fromDay"));
        file.throughDay = uint32(vm.parseJsonUint(json, ".throughDay"));
    }

    function _windows(string memory json, string memory path) private view returns (SessionWindow[] memory windows) {
        uint256 count;
        while (vm.keyExistsJson(json, string.concat(path, ".windows[", vm.toString(count), "]"))) ++count;
        windows = new SessionWindow[](count);
        for (uint256 i; i < count; ++i) {
            string memory window = string.concat(path, ".windows[", vm.toString(i), "]");
            windows[i] = SessionWindow({
                kindId: WindowKindId.wrap(vm.parseJsonBytes32(json, string.concat(window, ".kindId"))),
                opensAt: uint64(vm.parseJsonUint(json, string.concat(window, ".opensAt"))),
                closesAt: uint64(vm.parseJsonUint(json, string.concat(window, ".closesAt"))),
                policyHash: vm.parseJsonBytes32(json, string.concat(window, ".policyHash"))
            });
        }
    }
}
