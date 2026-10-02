#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repository_root/deployments/arbitrum-sepolia/manifest.json"
rpc_override=""
broadcast=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      [[ $# -ge 2 ]] || { printf 'usage: accept-sepolia-admin-transfers.sh [--manifest <path>] [--rpc-url <url>] [--broadcast]\n' >&2; exit 2; }
      manifest="$2"; shift 2;;
    --rpc-url)
      [[ $# -ge 2 ]] || { printf 'usage: accept-sepolia-admin-transfers.sh [--manifest <path>] [--rpc-url <url>] [--broadcast]\n' >&2; exit 2; }
      rpc_override="$2"; shift 2;;
    --broadcast)
      broadcast=true; shift;;
    -h|--help)
      printf 'usage: accept-sepolia-admin-transfers.sh [--manifest <path>] [--rpc-url <url>] [--broadcast]\n' >&2
      exit 0;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2; exit 2;;
  esac
done

require_command() {
  command -v "$1" >/dev/null 2>&1 || { printf 'Missing required command: %s\n' "$1" >&2; exit 1; }
}
require_command cast
require_command jq

case "$manifest" in
  /*) ;;
  *) manifest="$repository_root/$manifest";;
esac
[[ -f "$manifest" ]] || { printf 'Manifest not found.\n' >&2; exit 1; }

manifest_chain="$(jq -r .chainId "$manifest")"
[[ "$manifest_chain" == "421614" ]] || { printf 'Manifest is for chain %s, expected 421614.\n' "$manifest_chain" >&2; exit 1; }

rpc_url="${rpc_override:-${ARBITRUM_SEPOLIA_RPC_URL:-${SETRYN_SEPOLIA_RPC_URL:-}}}"
[[ -n "$rpc_url" ]] || { printf 'Set ARBITRUM_SEPOLIA_RPC_URL or pass --rpc-url.\n' >&2; exit 1; }

expected="${SETRYN_GOVERNANCE_ADMIN:-}"
[[ "$expected" =~ ^0x[0-9a-fA-F]{40}$ ]] || { printf 'Set SETRYN_GOVERNANCE_ADMIN to the expected governance address.\n' >&2; exit 1; }
expected_lc="${expected,,}"
zero="0x0000000000000000000000000000000000000000"

observed_chain="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$observed_chain" == "42161" ]]; then
  printf 'Refusing Arbitrum One (42161); this command targets Arbitrum Sepolia (421614) only.\n' >&2
  exit 1
fi
[[ "$observed_chain" == "421614" ]] || { printf 'RPC is chain %s, expected 421614.\n' "$observed_chain" >&2; exit 1; }

now="$(cast block --field timestamp --rpc-url "$rpc_url")"
[[ "$now" =~ ^[0-9]+$ ]] || { printf 'Unable to read the current block timestamp.\n' >&2; exit 1; }

declare -A is_library=()
while IFS= read -r name; do
  if [[ -n "$name" && "$name" != "null" ]]; then
    is_library["$name"]=1
  fi
done < <(jq -r '.linkedLibraries[]?.name' "$manifest")
inventory="$repository_root/deployments/phase2-contract-inventory.json"
if [[ -f "$inventory" ]]; then
  while IFS= read -r name; do
    if [[ -n "$name" && "$name" != "null" ]]; then
      is_library["$name"]=1
    fi
  done < <(jq -r '.linkedLibraries[]?.name' "$inventory")
fi

declare -A seen=()
names=()
targets=()
while IFS= read -r line; do
  name="${line%% *}"
  address="${line##* }"
  [[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]] || continue
  [[ -z "${is_library[$name]:-}" ]] || continue
  key="${address,,}"
  [[ -z "${seen[$key]:-}" ]] || continue
  seen["$key"]=1
  names+=("$name")
  targets+=("$address")
done < <(jq -r '[(.contracts[]? | "\(.name) \(.address)"), (.phase2.deployments[]? | "\(.name) \(.address)")] | .[]' "$manifest")

[[ "${#targets[@]}" -gt 0 ]] || { printf 'Manifest holds no deployed contracts.\n' >&2; exit 1; }

compatible_names=()
compatible_targets=()
statuses=()
pending_addrs=()
schedules=()
for i in "${!targets[@]}"; do
  name="${names[$i]}"
  target="${targets[$i]}"
  default_out=""
  default_out="$(cast call --rpc-url "$rpc_url" "$target" "defaultAdmin()(address)" 2>/dev/null)" || continue
  pending_raw="$(cast call --rpc-url "$rpc_url" "$target" "pendingDefaultAdmin()(address,uint48)" 2>/dev/null)" || continue
  mapfile -t pending_lines <<<"$pending_raw"
  [[ "${#pending_lines[@]}" -ge 2 ]] || continue
  pending_addr="${pending_lines[0]}"
  schedule="${pending_lines[1]%% *}"
  [[ "$default_out" =~ ^0x[0-9a-fA-F]{40}$ ]] || continue
  [[ "$pending_addr" =~ ^0x[0-9a-fA-F]{40}$ ]] || continue
  [[ "$schedule" =~ ^[0-9]+$ ]] || continue
  default_lc="${default_out,,}"
  pending_lc="${pending_addr,,}"
  status="unexpected"
  if [[ "$pending_lc" == "$zero" && "$default_lc" == "$expected_lc" ]]; then
    status="already accepted"
  elif [[ "$pending_lc" == "$expected_lc" && "$schedule" != "0" ]]; then
    if [[ "$schedule" -le "$now" ]]; then
      status="ready"
    else
      status="pending before schedule"
    fi
  fi
  compatible_names+=("$name")
  compatible_targets+=("$target")
  statuses+=("$status")
  pending_addrs+=("$pending_addr")
  schedules+=("$schedule")
  printf '%s %s %s\n' "$name" "$target" "$status"
done

compatible="${#compatible_targets[@]}"
[[ "$compatible" -gt 0 ]] || { printf 'No AccessControlDefaultAdminRules contracts discovered.\n' >&2; exit 1; }

unexpected=0
ready=0
waiting=0
accepted=0
for status in "${statuses[@]}"; do
  case "$status" in
    "already accepted") accepted=$((accepted + 1));;
    "ready") ready=$((ready + 1));;
    "pending before schedule") waiting=$((waiting + 1));;
    *) unexpected=$((unexpected + 1));;
  esac
done
printf 'compatible=%d accepted=%d ready=%d waiting=%d unexpected=%d\n' "$compatible" "$accepted" "$ready" "$waiting" "$unexpected"

if [[ "$broadcast" != true ]]; then
  [[ "$unexpected" -eq 0 ]] || { printf 'Refusing: %d contracts need manual review.\n' "$unexpected" >&2; exit 1; }
  exit 0
fi

[[ -n "${ETH_PASSWORD:-}" ]] || { printf 'Set ETH_PASSWORD for the setryn-governance keystore before --broadcast.\n' >&2; exit 1; }
[[ "$unexpected" -eq 0 ]] || { printf 'Refusing to broadcast with %d unexpected contracts.\n' "$unexpected" >&2; exit 1; }
[[ "$waiting" -eq 0 ]] || { printf 'Refusing to broadcast: %d transfers are pending before schedule.\n' "$waiting" >&2; exit 1; }
[[ "$ready" -gt 0 ]] || exit 0

for i in "${!compatible_targets[@]}"; do
  [[ "${statuses[$i]}" == "ready" ]] || continue
  name="${compatible_names[$i]}"
  target="${compatible_targets[$i]}"
  [[ "${pending_addrs[$i],,}" == "$expected_lc" ]] || { printf '%s has an unexpected pending admin.\n' "$name" >&2; exit 1; }
  [[ "${schedules[$i]}" -le "$now" ]] || { printf '%s is pending before schedule.\n' "$name" >&2; exit 1; }
  receipt="$(cast send --rpc-url "$rpc_url" --chain 421614 --account setryn-governance --confirmations 1 --json "$target" "acceptDefaultAdminTransfer()")"
  transaction_hash="$(jq -r '.transactionHash // empty' <<<"$receipt")"
  [[ "$transaction_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || { printf '%s returned no transaction hash.\n' "$name" >&2; exit 1; }
  after="$(cast call --rpc-url "$rpc_url" "$target" "defaultAdmin()(address)")"
  [[ "${after,,}" == "$expected_lc" ]] || { printf '%s did not hand to governance.\n' "$name" >&2; exit 1; }
  printf '%s %s accepted %s\n' "$name" "$target" "$transaction_hash"
done
