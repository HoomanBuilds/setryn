#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_directory="$repository_root/.setryn/local-chain"
state_file="$state_directory/anvil-state.json"
pid_file="$state_directory/anvil.pid"
log_file="$state_directory/anvil.log"
deployment_directory="$repository_root/deployments/local"
rpc_url="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
chain_id="${LOCAL_CHAIN_ID:-31337}"

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
            [[ "${command_parts[$((index + 1))]}" == "$expected_value" ]]
            return
        fi
    done
    return 1
}

managed_command_matches() {
    local managed_pid="$1"
    local -a command_parts=()
    mapfile -d '' -t command_parts <"/proc/$managed_pid/cmdline"
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

    [[ "$managed_pid" =~ ^[0-9]+$ ]] &&
        kill -0 "$managed_pid" 2>/dev/null &&
        [[ -r "/proc/$managed_pid/stat" ]] &&
        [[ -r "/proc/$managed_pid/cmdline" ]] &&
        [[ "$(process_start_identity "$managed_pid")" == "$expected_start_identity" ]] &&
        [[ "$(process_command_hash "$managed_pid")" == "$expected_command_hash" ]] &&
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
    if [[ "${#managed_identity[@]}" -ne 3 ]] ||
        ! managed_identity_matches "$managed_pid" "${managed_identity[1]:-}" "${managed_identity[2]:-}"; then
        printf 'Refusing to stop PID %s because its managed process identity does not match.\n' "${managed_pid:-unknown}" >&2
        exit 1
    fi

    kill "$managed_pid"
    wait "$managed_pid" 2>/dev/null || true
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
rm -f "$state_file" "$log_file" "$deployment_directory/manifest.json"

anvil --silent --host "$rpc_bind_host" --port "$rpc_port" --chain-id "$chain_id" --state "$state_file" >"$log_file" 2>&1 &
anvil_pid=$!
trap cleanup_failed_start ERR INT TERM

for _ in {1..20}; do
    if [[ -r "/proc/$anvil_pid/stat" ]] && [[ -r "/proc/$anvil_pid/cmdline" ]]; then
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

accounts_json="$(cast rpc eth_accounts --rpc-url "$rpc_url")"
deployer_address="$(ACCOUNTS_JSON="$accounts_json" node -e 'const accounts = JSON.parse(process.env.ACCOUNTS_JSON); if (!accounts[0]) process.exit(1); process.stdout.write(accounts[0]);')"

SETRYN_DEPLOYMENT_ENVIRONMENT=local \
SETRYN_DEPLOYER_ADDRESS="$deployer_address" \
SETRYN_INITIAL_ADMIN="$deployer_address" \
SETRYN_EVALUATION_GAS_HARD_CAP=2000000 \
SETRYN_DEPLOYMENT_ID=0x6c6f63616c2d73657472796e2d7068617365320000000000000000000000000000 \
forge script script/DeploySetryn.s.sol:DeploySetryn \
    --root "$repository_root/contracts" \
    --rpc-url "$rpc_url" \
    --sender "$deployer_address" \
    --unlocked \
    --broadcast

node "$repository_root/scripts/generate-deployment-evidence.mjs" \
    --environment local \
    --rpc-url "$rpc_url" \
    --broadcast "$repository_root/contracts/broadcast/DeploySetryn.s.sol/$chain_id/run-latest.json" \
    --output "$deployment_directory/manifest.json"

trap - ERR INT TERM
printf 'Local Setryn deployment ready at %s (anvil PID %s).\n' "$rpc_url" "$anvil_pid"
