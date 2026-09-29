#!/usr/bin/env bash
# Runs the focused pinned Arbitrum One fork suite against the checked-in qualification profile.
# Foundry forks read-only mainnet state locally; this script never signs, broadcasts, or writes to any chain.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="$repository_root/deployments/arbitrum-one/qualification/fork-suite.env"

if [[ -z "${ARBITRUM_RPC_URL:-}" ]]; then
    printf 'Set ARBITRUM_RPC_URL to an archive-capable Arbitrum One HTTPS RPC.\n' >&2
    exit 1
fi
if [[ "$ARBITRUM_RPC_URL" != https://* ]]; then
    printf 'ARBITRUM_RPC_URL must be an explicit HTTPS URL.\n' >&2
    exit 1
fi

set -a
# shellcheck source=/dev/null
source "$profile"
set +a

observed_chain_id="$(cast chain-id --rpc-url "$ARBITRUM_RPC_URL")"
if [[ "$observed_chain_id" != "42161" ]]; then
    printf 'RPC resolves to chain %s, not Arbitrum One.\n' "$observed_chain_id" >&2
    exit 1
fi
observed_hash="$(cast block "$ARBITRUM_ONE_FORK_BLOCK_NUMBER" --field hash --rpc-url "$ARBITRUM_RPC_URL")"
if [[ "${observed_hash,,}" != "${ARBITRUM_ONE_FORK_BLOCK_HASH,,}" ]]; then
    printf 'Pinned block %s hash mismatch: expected %s, observed %s.\n' \
        "$ARBITRUM_ONE_FORK_BLOCK_NUMBER" "$ARBITRUM_ONE_FORK_BLOCK_HASH" "$observed_hash" >&2
    exit 1
fi

# Public archive RPCs rate-limit aggressively, so the suite runs serially with bounded retries by default.
FOUNDRY_PROFILE=arbitrum_one_fork forge test \
    --root "$repository_root/contracts" \
    --match-path 'test/fork/ArbitrumOne*' \
    --fork-url "$ARBITRUM_RPC_URL" \
    --fork-block-number "$ARBITRUM_ONE_FORK_BLOCK_NUMBER" \
    --fork-retries "${SETRYN_FORK_RETRIES:-12}" \
    --fork-retry-backoff "${SETRYN_FORK_RETRY_BACKOFF_MS:-3000}" \
    --compute-units-per-second "${SETRYN_FORK_COMPUTE_UNITS_PER_SECOND:-200}" \
    --threads "${SETRYN_FORK_THREADS:-1}" \
    "$@"
