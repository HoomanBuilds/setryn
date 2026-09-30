#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# A second, isolated devnet (for example on another port) sets these so it neither stops the default managed anvil nor
# overwrites the default deployment files or broadcast records. Unset, every path keeps its default.
state_directory="${SETRYN_LOCAL_STATE_DIR:-$repository_root/.setryn/local-chain}"
state_file="$state_directory/anvil-state.json"
pid_file="$state_directory/anvil.pid"
log_file="$state_directory/anvil.log"
deployment_directory="${SETRYN_LOCAL_DEPLOYMENT_DIR:-$repository_root/deployments/local}"
broadcast_directory="${SETRYN_LOCAL_BROADCAST_DIR:-$repository_root/contracts/broadcast}"
if [[ -n "${SETRYN_LOCAL_BROADCAST_DIR:-}" ]]; then
    export FOUNDRY_BROADCAST="$broadcast_directory"
fi
rpc_url="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
chain_id="${LOCAL_CHAIN_ID:-31337}"
# The devnet starts on the web preview's scenario clock (SCENARIO_CLOCK_ISO), so chain-stamped fills, receipts, and
# order deadlines fall on the same day and hour as the preview feed. Its trading session is open from 08:00 UTC.
devnet_epoch_iso="${SETRYN_DEVNET_EPOCH:-2026-09-22T09:00:00Z}"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

process_start_identity() {
    awk '{print $22}' "/proc/$1/stat"
}

process_command_hash() {
    sha256sum "/proc/$1/cmdline" | awk '{print $1}'
}

has_argument_pair() {
    local expected_name="$1"
    local expected_value="$2"
    shift 2
    local -a command_parts=("$@")

    local index
    for ((index = 0; index + 1 < ${#command_parts[@]}; index++)); do
        if [[ "${command_parts[$index]}" == "$expected_name" ]]; then
            # An explicit status: a bare return inside a trap handler reports the command that fired the trap.
            [[ "${command_parts[$((index + 1))]}" == "$expected_value" ]]
            return $?
        fi
    done
    return 1
}

managed_command_matches() {
    local managed_pid="$1"
    local -a command_parts=()
    mapfile -d '' -t command_parts <"/proc/$managed_pid/cmdline"
    [[ "${#command_parts[@]}" -gt 0 ]] &&
        [[ "${command_parts[0]##*/}" == "anvil" ]] &&
        has_argument_pair --host "$rpc_bind_host" "${command_parts[@]}" &&
        has_argument_pair --port "$rpc_port" "${command_parts[@]}" &&
        has_argument_pair --chain-id "$chain_id" "${command_parts[@]}" &&
        has_argument_pair --state "$state_file" "${command_parts[@]}"
}

managed_identity_matches() {
    local managed_pid="$1"
    local expected_start_identity="$2"
    local expected_command_hash="$3"

    # The start time pins one process instance of the PID, and the live command line must still be this script's
    # anvil invocation. The recorded command hash is kept for audit but not compared, because a hash taken during
    # exec can describe the pre-exec command line.
    [[ "$managed_pid" =~ ^[0-9]+$ ]] &&
        [[ -n "$expected_command_hash" ]] &&
        kill -0 "$managed_pid" 2>/dev/null &&
        [[ -r "/proc/$managed_pid/stat" ]] &&
        [[ -r "/proc/$managed_pid/cmdline" ]] &&
        [[ "$(process_start_identity "$managed_pid")" == "$expected_start_identity" ]] &&
        managed_command_matches "$managed_pid"
}

write_managed_identity() {
    local managed_pid="$1"
    anvil_start_identity="$(process_start_identity "$managed_pid")"
    anvil_command_hash="$(process_command_hash "$managed_pid")"
    printf '%s\n%s\n%s\n' "$managed_pid" "$anvil_start_identity" "$anvil_command_hash" >"$pid_file"
}

stop_managed_anvil() {
    if [[ ! -f "$pid_file" ]]; then
        return
    fi

    local -a managed_identity=()
    mapfile -t managed_identity <"$pid_file"
    local managed_pid="${managed_identity[0]:-}"
    if [[ "$managed_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$managed_pid" 2>/dev/null; then
        rm -f "$pid_file"
        return
    fi
    if [[ "${#managed_identity[@]}" -ne 3 ]]; then
        printf 'Refusing to stop PID %s because the managed identity file is malformed.\n' "${managed_pid:-unknown}" >&2
        exit 1
    fi
    if ! managed_identity_matches "$managed_pid" "${managed_identity[1]}" "${managed_identity[2]}"; then
        # The recorded start time or anvil command differs, so the managed anvil is gone and the PID was reused
        # (for example after a container restart). Nothing is stopped; the stale record is dropped and the port
        # check below still refuses to start over an occupied port.
        printf 'Discarding stale managed anvil record for reused PID %s.\n' "$managed_pid" >&2
        rm -f "$pid_file"
        return
    fi

    kill "$managed_pid"
    # A previous run started this anvil, so it is not a child of this shell and `wait` cannot block on it. Poll until
    # it exits so the port check below does not race its shutdown.
    local attempt
    for attempt in {1..50}; do
        kill -0 "$managed_pid" 2>/dev/null || break
        sleep 0.1
    done
    if kill -0 "$managed_pid" 2>/dev/null; then
        printf 'Managed anvil PID %s did not exit after SIGTERM.\n' "$managed_pid" >&2
        exit 1
    fi
    rm -f "$pid_file"
}

cleanup_failed_start() {
    if [[ -n "${anvil_pid:-}" ]] &&
        [[ -n "${anvil_start_identity:-}" ]] &&
        [[ -n "${anvil_command_hash:-}" ]] &&
        managed_identity_matches "$anvil_pid" "$anvil_start_identity" "$anvil_command_hash"; then
        kill "$anvil_pid"
        wait "$anvil_pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
}

port_is_occupied() {
    RPC_HOST="$rpc_host" RPC_PORT="$rpc_port" node -e '
        const net = require("node:net");
        const socket = net.createConnection({ host: process.env.RPC_HOST, port: Number(process.env.RPC_PORT) });
        socket.setTimeout(250);
        socket.once("connect", () => { socket.destroy(); process.exit(0); });
        socket.once("timeout", () => { socket.destroy(); process.exit(1); });
        socket.once("error", () => process.exit(1));
    '
}

require_command anvil
require_command cast
require_command forge
require_command node
require_command sha256sum

mapfile -t rpc_parts < <(
    RPC_URL="$rpc_url" node -e '
        const parsed = new URL(process.env.RPC_URL);
        const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
        if (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname)) process.exit(1);
        if (parsed.username || parsed.password || !["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) process.exit(1);
        process.stdout.write(`${parsed.hostname}\n${parsed.port || "80"}\n`);
    '
) || {
    printf 'LOCAL_RPC_URL must be an HTTP loopback URL without credentials, path, query, or fragment.\n' >&2
    exit 1
}
if [[ "${#rpc_parts[@]}" -ne 2 ]]; then
    printf 'Unable to parse LOCAL_RPC_URL.\n' >&2
    exit 1
fi
rpc_host="${rpc_parts[0]}"
rpc_port="${rpc_parts[1]}"
rpc_bind_host="${rpc_host#[}"
rpc_bind_host="${rpc_bind_host%]}"

mkdir -p "$state_directory" "$deployment_directory"
stop_managed_anvil
if port_is_occupied; then
    printf 'Refusing to start anvil because %s:%s is already occupied.\n' "$rpc_host" "$rpc_port" >&2
    exit 1
fi
rm -f \
    "$state_file" \
    "$log_file" \
    "$deployment_directory/manifest.json" \
    "$deployment_directory/runtime.json" \
    "$deployment_directory/runtime.tmp.json" \
    "$deployment_directory/devnet-markets.json"

devnet_epoch="$(date -u -d "$devnet_epoch_iso" +%s)" || {
    printf 'SETRYN_DEVNET_EPOCH must be an ISO-8601 UTC timestamp.\n' >&2
    exit 1
}
anvil --silent --host "$rpc_bind_host" --port "$rpc_port" --chain-id "$chain_id" --timestamp "$devnet_epoch" \
    --state "$state_file" >"$log_file" 2>&1 &
anvil_pid=$!
trap cleanup_failed_start ERR INT TERM

for _ in {1..100}; do
    # Record the identity only after exec, once the command line is the anvil invocation itself.
    if [[ -r "/proc/$anvil_pid/stat" ]] && [[ -r "/proc/$anvil_pid/cmdline" ]] && managed_command_matches "$anvil_pid"; then
        write_managed_identity "$anvil_pid"
        break
    fi
    if ! kill -0 "$anvil_pid" 2>/dev/null; then
        printf 'Anvil exited before its process identity could be recorded. See %s.\n' "$log_file" >&2
        exit 1
    fi
    sleep 0.05
done
if [[ ! -f "$pid_file" ]] || ! managed_identity_matches "$anvil_pid" "$anvil_start_identity" "$anvil_command_hash"; then
    printf 'Unable to verify the spawned anvil process identity. See %s.\n' "$log_file" >&2
    exit 1
fi

anvil_ready=false
for _ in {1..50}; do
    if ! managed_identity_matches "$anvil_pid" "$anvil_start_identity" "$anvil_command_hash"; then
        printf 'Spawned anvil exited or changed identity before readiness. See %s.\n' "$log_file" >&2
        exit 1
    fi
    if cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then
        anvil_ready=true
        break
    fi
    sleep 0.1
done
if [[ "$anvil_ready" != true ]]; then
    printf 'Spawned anvil did not become ready at %s. See %s.\n' "$rpc_url" "$log_file" >&2
    exit 1
fi

observed_chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$observed_chain_id" != "$chain_id" ]]; then
    printf 'Local chain ID mismatch: expected %s, received %s.\n' "$chain_id" "$observed_chain_id" >&2
    exit 1
fi

cast rpc evm_mine --rpc-url "$rpc_url" >/dev/null

accounts_json="$(cast rpc eth_accounts --rpc-url "$rpc_url")"
mapfile -t local_accounts < <(
    ACCOUNTS_JSON="$accounts_json" node -e '
        const accounts = JSON.parse(process.env.ACCOUNTS_JSON);
        if (accounts.length < 10 || new Set(accounts.slice(0, 10).map((account) => account.toLowerCase())).size !== 10) process.exit(1);
        process.stdout.write(`${accounts.slice(0, 10).join("\n")}\n`);
    '
) || {
    printf 'Local Anvil must expose at least ten distinct unlocked accounts.\n' >&2
    exit 1
}
if [[ "${#local_accounts[@]}" -ne 10 ]]; then
    printf 'Local Anvil returned an invalid principal set.\n' >&2
    exit 1
fi

deployer_address="${local_accounts[0]}"
export SETRYN_DEPLOYMENT_ENVIRONMENT=local
export SETRYN_DEPLOYER_ADDRESS="$deployer_address"
export SETRYN_INITIAL_ADMIN="$deployer_address"
export SETRYN_GOVERNANCE_ADMIN="${local_accounts[1]}"
export SETRYN_GOVERNANCE_OPERATOR="${local_accounts[2]}"
export SETRYN_GUARDIAN="${local_accounts[3]}"
export SETRYN_EXCESS_RECOVERY_OPERATOR="${local_accounts[4]}"
export SETRYN_PRIVACY_KEY_PUBLISHER="${local_accounts[5]}"
export SETRYN_LIFECYCLE_WITNESS_STAGER="${local_accounts[6]}"
# The protocol fee recipient account is controlled by its own account, never the operator: anvil #9 by default (#7 and #8
# are left to local traders). The bootstrap creates the account as the operator and hands control over in two steps.
export SETRYN_TREASURY_CONTROLLER="${SETRYN_TREASURY_CONTROLLER:-${local_accounts[9]}}"
for principal_index in 0 1 2 3 4 5 6; do
    if [[ "${SETRYN_TREASURY_CONTROLLER,,}" == "${local_accounts[$principal_index],,}" ]]; then
        printf 'SETRYN_TREASURY_CONTROLLER must not be a deployment principal (anvil #%s).\n' "$principal_index" >&2
        exit 1
    fi
done
export SETRYN_EVALUATION_GAS_HARD_CAP=2000000
export SETRYN_SEQUENCER_RECOVERY_GRACE=1
export SETRYN_DEPLOYMENT_ID=0xd008df4e26809366bea8099013ff60a895a26d818a8604d326067034ed7a7c93

# The deployment creates contracts from standalone artifacts; build them and refuse a stale artifact manifest.
forge build --root "$repository_root/contracts" >/dev/null
node "$repository_root/scripts/generate-deploy-artifacts.mjs" --check

forge script "$repository_root/contracts/script/DeploySetryn.s.sol:DeploySetryn" \
    --root "$repository_root/contracts" \
    --rpc-url "$rpc_url" \
    --sender "$deployer_address" \
    --unlocked \
    --non-interactive \
    --slow \
    --broadcast

node "$repository_root/scripts/generate-deployment-evidence.mjs" \
    --environment local \
    --rpc-url "$rpc_url" \
    --broadcast "$broadcast_directory/DeploySetryn.s.sol/$chain_id/run-latest.json" \
    --output "$deployment_directory/manifest.json"

mapfile -t bootstrap_addresses < <(
    SETRYN_MANIFEST="$deployment_directory/manifest.json" node -e '
        const manifest = require(process.env.SETRYN_MANIFEST);
        const deployments = [...(manifest.contracts ?? []), ...(manifest.phase2?.deployments ?? [])];
        const required = [
            "AssetRegistry",
            "AdapterRegistry",
            "CalendarRegistry",
            "SessionRegistry",
            "SettlementAssetRegistry",
            "BenchmarkRegistry",
            "FeeScheduleRegistry",
            "RiskDomainRegistry",
            "InstrumentRegistry",
            "MarketRegistry",
            "SeriesRegistry",
            "CanonicalStrategyCompiler",
            "CappedForwardPayoffModule",
            "CollateralVault",
            "FundedFeeEngine",
            "PortfolioRiskEngine",
            "RiskAdmissionBindingRegistry",
            "ExecutionPolicyRegistry",
            "TradingSessionPolicy",
            "OrderState",
            "AtomicClearingEngine",
            "PrivateRfqValidationGate",
            "PrivateRfqBook",
            "PublicOrderBook",
            "PositionEngine",
            "LifecyclePolicyValidator",
            "SignedLifecycleEngine",
        ];
        for (const name of required) {
            const matches = deployments.filter((deployment) => deployment.name === name);
            if (matches.length !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(matches[0].address)) process.exit(1);
            process.stdout.write(`${matches[0].address}\n`);
        }
    '
) || {
    printf 'Deployment manifest does not contain the complete devnet bootstrap dependency graph.\n' >&2
    exit 1
}
if [[ "${#bootstrap_addresses[@]}" -ne 27 ]]; then
    printf 'Deployment manifest returned an invalid devnet bootstrap dependency set.\n' >&2
    exit 1
fi

export SETRYN_ASSET_REGISTRY="${bootstrap_addresses[0]}"
export SETRYN_ADAPTER_REGISTRY="${bootstrap_addresses[1]}"
export SETRYN_CALENDAR_REGISTRY="${bootstrap_addresses[2]}"
export SETRYN_SESSION_REGISTRY="${bootstrap_addresses[3]}"
export SETRYN_SETTLEMENT_ASSET_REGISTRY="${bootstrap_addresses[4]}"
export SETRYN_BENCHMARK_REGISTRY="${bootstrap_addresses[5]}"
export SETRYN_FEE_SCHEDULE_REGISTRY="${bootstrap_addresses[6]}"
export SETRYN_RISK_DOMAIN_REGISTRY="${bootstrap_addresses[7]}"
export SETRYN_INSTRUMENT_REGISTRY="${bootstrap_addresses[8]}"
export SETRYN_MARKET_REGISTRY="${bootstrap_addresses[9]}"
export SETRYN_SERIES_REGISTRY="${bootstrap_addresses[10]}"
export SETRYN_CANONICAL_STRATEGY_COMPILER="${bootstrap_addresses[11]}"
export SETRYN_CAPPED_FORWARD_PAYOFF_MODULE="${bootstrap_addresses[12]}"
export SETRYN_COLLATERAL_VAULT="${bootstrap_addresses[13]}"
export SETRYN_FUNDED_FEE_ENGINE="${bootstrap_addresses[14]}"
export SETRYN_PORTFOLIO_RISK_ENGINE="${bootstrap_addresses[15]}"
export SETRYN_RISK_ADMISSION_BINDING_REGISTRY="${bootstrap_addresses[16]}"
export SETRYN_EXECUTION_POLICY_REGISTRY="${bootstrap_addresses[17]}"
export SETRYN_TRADING_SESSION_POLICY="${bootstrap_addresses[18]}"
export SETRYN_ORDER_STATE="${bootstrap_addresses[19]}"
export SETRYN_ATOMIC_CLEARING_ENGINE="${bootstrap_addresses[20]}"
export SETRYN_PRIVATE_RFQ_VALIDATION_GATE="${bootstrap_addresses[21]}"
export SETRYN_PRIVATE_RFQ_BOOK="${bootstrap_addresses[22]}"
export SETRYN_PUBLIC_ORDER_BOOK="${bootstrap_addresses[23]}"
export SETRYN_POSITION_ENGINE="${bootstrap_addresses[24]}"
export SETRYN_LIFECYCLE_POLICY_VALIDATOR="${bootstrap_addresses[25]}"
export SETRYN_SIGNED_LIFECYCLE_ENGINE="${bootstrap_addresses[26]}"
export SETRYN_RUNTIME_OUTPUT="$deployment_directory/runtime.tmp.json"
# Every market in the terminal catalog is registered as its own onchain market and series, projected from the catalog.
export SETRYN_DEVNET_MARKETS="$deployment_directory/devnet-markets.json"
node --no-warnings "$repository_root/scripts/generate-devnet-markets.mjs" --output "$SETRYN_DEVNET_MARKETS"

forge script "$repository_root/contracts/script/BootstrapSetrynDevnet.s.sol:BootstrapSetrynDevnet" \
    --root "$repository_root/contracts" \
    --rpc-url "$rpc_url" \
    --sender "$SETRYN_GOVERNANCE_OPERATOR" \
    --unlocked \
    --non-interactive \
    --slow \
    --broadcast

if [[ ! -s "$deployment_directory/runtime.tmp.json" ]]; then
    printf 'Devnet bootstrap completed without producing runtime evidence.\n' >&2
    exit 1
fi
SETRYN_RUNTIME="$deployment_directory/runtime.tmp.json" node -e '
    const runtime = require(process.env.SETRYN_RUNTIME);
    const catalog = require(process.env.SETRYN_DEVNET_MARKETS);
    const hash = /^0x[0-9a-fA-F]{64}$/;
    const fail = (reason) => { process.stderr.write(`Invalid devnet runtime: ${reason}\n`); process.exit(1); };
    if (runtime.schemaVersion !== 9 || runtime.chainId !== 31337) fail("schema version or chain");
    if (!Array.isArray(runtime.markets) || runtime.markets.length !== catalog.markets.length) fail("market count");
    const seen = new Set();
    runtime.markets.forEach((market, index) => {
        const spec = catalog.markets[index];
        if (market.marketKey !== spec.marketKey) fail(`market ${index} is ${market.marketKey}, expected ${spec.marketKey}`);
        for (const field of ["marketId", "instrumentId", "seriesId", "benchmarkId"]) {
            if (!hash.test(market[field] ?? "")) fail(`${spec.marketKey}.${field}`);
        }
        if (seen.has(market.seriesId.toLowerCase()) || seen.has(market.marketId.toLowerCase())) fail(`${spec.marketKey} ids repeat`);
        seen.add(market.seriesId.toLowerCase());
        seen.add(market.marketId.toLowerCase());
        if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(market.payoffTerms ?? "")) fail(`${spec.marketKey}.payoffTerms`);
        if (market.tickSizeMinor !== spec.tickSizeMinor || market.priceScale !== spec.priceScale || market.maxOrderLots !== spec.maxOrderLots) {
            fail(`${spec.marketKey} economics differ from the catalog`);
        }
        if (market.maxLongDebitMinorPerLot !== spec.bandMinor || market.maxShortDebitMinorPerLot !== spec.bandMinor) {
            fail(`${spec.marketKey} debit bounds differ from the payoff band`);
        }
    });
    const primary = runtime.markets[0];
    for (const field of ["marketId", "marketVersion", "seriesId", "seriesVersion", "payoffTerms", "tickSizeMinor", "maxOrderLots", "maxLongDebitMinorPerLot", "maxShortDebitMinorPerLot", "instrumentId", "benchmarkId"]) {
        if (runtime[field] !== primary[field]) fail(`top-level ${field} does not name the primary market`);
    }
    const version = (value) => Number.isSafeInteger(value) && value > 0;
    runtime.markets.forEach((market) => {
        if (!version(market.marketVersion) || !version(market.seriesVersion)) fail(`${market.marketKey} market or series version`);
    });
    if (!version(runtime.feeScheduleVersion)) fail("feeScheduleVersion");
    if (!hash.test(runtime.feeRecipientAccountId ?? "")) fail("feeRecipientAccountId");
    if (!/^0x[0-9a-fA-F]{40}$/.test(runtime.treasuryController ?? "")) fail("treasuryController");
    if (runtime.treasuryController.toLowerCase() === String(runtime.operator).toLowerCase()) fail("treasuryController is the operator");
    if (runtime.treasuryController.toLowerCase() !== process.env.SETRYN_TREASURY_CONTROLLER.toLowerCase()) fail("treasuryController differs from SETRYN_TREASURY_CONTROLLER");
'
mv "$deployment_directory/runtime.tmp.json" "$deployment_directory/runtime.json"

trap - ERR INT TERM
printf 'Local Setryn deployment ready at %s (anvil PID %s).\n' "$rpc_url" "$anvil_pid"
