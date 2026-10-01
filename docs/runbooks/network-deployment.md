# Network deployment: Arbitrum Sepolia

This runbook deploys Setryn to Arbitrum Sepolia (chain 421614) with the real-data product of
[docs/plans/network-runtime-real-data.md](../plans/network-runtime-real-data.md): dated range forwards listed from live
Chainlink references, Circle test USDC as collateral, signed-observation fixings, and continuous UTC trading sessions.
The local devnet (`bash scripts/local-deploy-reset.sh`) runs the same listing generator, bootstrap and runtime schema.

Arbitrum One stays disabled: `DeploySetryn`, `BootstrapSetrynMarkets` and `PublishSessionDays` revert on chain 42161,
and nothing here writes to it. The only Arbitrum One access is read-only `eth_call` of Chainlink aggregators.

## What gets deployed

| Step | Script | Sender | Result |
| --- | --- | --- | --- |
| 1 | `scripts/generate-network-markets.mjs` | none (reads Arbitrum One) | `deployments/arbitrum-sepolia/markets.json` |
| 2 | `DeploySetryn.s.sol` | deployer | core contracts, roles, static sequencer feed |
| 3 | `scripts/generate-deployment-evidence.mjs` | none | `deployments/arbitrum-sepolia/manifest.json` |
| 4 | `BootstrapSetrynMarkets.s.sol` | operator, status governance | listing registered; `runtime.json`, `session-days.json` |
| 5 | `CollateralVault.acceptController` | treasury | treasury controls the fee account |

Bootstrap results, per listing market: one market (price ticks bounded to `[0, band / tick size]`, zero ticks is the
floor) and one series compiled as a `CappedForward` on the family benchmark: strike = floor, multiplier =
`lotSize × 1e6 / 1e8`, transfer to the long clamped to `[0, band]`. The long's terminal debit is therefore zero (it pays
`lotSize × (F − floor)` at the fill) and the short's is the band `lotSize × (cap − floor)`. Schedule relative to the
08:00 UTC expiry `E`: trading from listing to `E − 2h`, fixing window `E − 1h … E`, primary evidence `E + 1h`,
corrections `E + 2h`, holder election `E + 2h … E + 2h45m`, final resolution `E + 3h`, settlement `E + 3h30m`. The
fixing is the last observation at or before `E − 1s` (a candidate's target must precede the window end, and the window
must close by expiry), signed by at least `threshold` of the configured oracle publishers; publishers attest the
Chainlink Arbitrum One answer in force at that second (the benchmark's observation rule commits the aggregator).

The calendar and session cover every UTC day from the listing day to two days after the last expiry, each committed as
a Merkle root (one leaf per day). Every day carries a trading window `00:00–24:00` and a fixing window `07:00–08:00`.
The bootstrap publishes today through three days ahead; later days must be published (permissionless) before they
start, see "Operations".

## Accounts

All six DeploySetryn principals must be distinct from each other and from the deployer.

| Variable | Role on Sepolia | Signs |
| --- | --- | --- |
| `SETRYN_DEPLOYER_ADDRESS` = `SETRYN_INITIAL_ADMIN` | bootstrap admin, hands admin to governance | step 2 |
| `SETRYN_GOVERNANCE_ADMIN` | registry status governance (`RegistryStatusController.governance`); pending default admin | step 4 activations |
| `SETRYN_GOVERNANCE_OPERATOR` | registry qualifier, execution policy admin, risk consumer, keeper | step 4 registrations |
| `SETRYN_GUARDIAN`, `SETRYN_EXCESS_RECOVERY_OPERATOR`, `SETRYN_PRIVACY_KEY_PUBLISHER`, `SETRYN_LIFECYCLE_WITNESS_STAGER` | operational principals | — |
| `SETRYN_TREASURY_CONTROLLER` | controller of the protocol fee account (a Safe is fine) | step 5 |
| `SETRYN_ORACLE_SIGNERS` | fixing publishers (1 to 16 addresses) | fixings |

On Sepolia the operator does not hold the registries' status roles, so the bootstrap activates every registration
through `RegistryStatusController.govern` from `SETRYN_GOVERNANCE_ADMIN`. Its key must therefore be available to the
bootstrap run (an EOA). If governance is a timelock or Safe, run the bootstrap on an anvil fork first to obtain the
call list, or use an EOA for the testnet.

## Commands

Run everything from the repository root with Foundry and Node 22 on `PATH`.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
export ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc   # or a provider URL
export SETRYN_REFERENCE_RPC_URL=https://arb1.arbitrum.io/rpc              # Arbitrum One, read-only
```

### 1. Listing

```bash
node scripts/generate-network-markets.mjs --network arbitrum-sepolia
```

Writes `deployments/arbitrum-sepolia/markets.json` (schema 2): five families (BTC, ETH, ARB, EUR/USD, XAU/USD) times the
next three quarterly expiries at least 14 days out, floors and caps struck around the current Chainlink answers. Review
it, then deploy on the same day; the bootstrap refuses a listing whose series can no longer trade.

### 2. Core

```bash
export SETRYN_DEPLOYMENT_ENVIRONMENT=arbitrum-sepolia
export SETRYN_DEPLOYER_ADDRESS=0x...            # address of $DEPLOYER_KEY
export SETRYN_INITIAL_ADMIN=$SETRYN_DEPLOYER_ADDRESS
export SETRYN_GOVERNANCE_ADMIN=0x...
export SETRYN_GOVERNANCE_OPERATOR=0x...
export SETRYN_GUARDIAN=0x...
export SETRYN_EXCESS_RECOVERY_OPERATOR=0x...
export SETRYN_PRIVACY_KEY_PUBLISHER=0x...
export SETRYN_LIFECYCLE_WITNESS_STAGER=0x...
export SETRYN_TREASURY_CONTROLLER=0x...
export SETRYN_EVALUATION_GAS_HARD_CAP=2000000
export SETRYN_DEPLOYMENT_ID=0x$(openssl rand -hex 32)
# Arbitrum Sepolia has no Chainlink L2 sequencer uptime feed (Chainlink lists only Arbitrum One's
# 0xFdB631F5EE196F0ed6FAa767959853A9F217697D, which has no code on Sepolia). This testnet-only choice deploys the
# static always-up DevnetSequencerUptimeFeed; DeploySetryn refuses it on any other chain.
export SETRYN_SEQUENCER_UPTIME_FEED=testnet-static

forge build --root contracts
node scripts/generate-deploy-artifacts.mjs --check
forge script script/DeploySetryn.s.sol:DeploySetryn --root contracts \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain 421614 \
  --sender "$SETRYN_DEPLOYER_ADDRESS" --private-key "$DEPLOYER_KEY" \
  --slow --broadcast
```

The run sends about 300 transactions. Optional overrides keep their defaults: `SETRYN_DEFAULT_ADMIN_DELAY` (2 days),
`SETRYN_MAXIMUM_RISK_OBSERVATION_AGE` (300 s, the bootstrap must use the same value),
`SETRYN_SEQUENCER_RECOVERY_GRACE` (1 h; the static feed reports the sequencer up since an hour before its deployment,
so trading is open immediately).

### 3. Manifest and bootstrap environment

```bash
node scripts/generate-deployment-evidence.mjs --environment arbitrum-sepolia \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" \
  --broadcast contracts/broadcast/DeploySetryn.s.sol/421614/run-latest.json \
  --output deployments/arbitrum-sepolia/manifest.json

eval "$(node scripts/network-bootstrap-env.mjs \
  --manifest deployments/arbitrum-sepolia/manifest.json \
  --broadcast contracts/broadcast/DeploySetryn.s.sol/421614/run-latest.json)"
```

The helper exports every core address the bootstrap needs (`SETRYN_ASSET_REGISTRY` … `SETRYN_SIGNED_LIFECYCLE_ENGINE`),
`SETRYN_REGISTRY_STATUS_CONTROLLER`, the venue and lifecycle contracts the runtime also names (`SETRYN_FIXING_ENGINE`,
`SETRYN_CASH_SETTLEMENT_COORDINATOR`, `SETRYN_POSITION_LIFECYCLE_EXECUTOR`, `SETRYN_SEALED_AUCTION_HOUSE`,
`SETRYN_STREAMING_QUOTE_ENGINE`, `SETRYN_BATCH_CLEARING_ENGINE`) and `SETRYN_DEPLOYMENT_BLOCK` (first core deployment
block, where event scans start).

### 4. Markets

```bash
export SETRYN_MARKET_LISTING="$PWD/deployments/arbitrum-sepolia/markets.json"
export SETRYN_RUNTIME_OUTPUT="$PWD/deployments/arbitrum-sepolia/runtime.json"
export SETRYN_SESSION_DAYS_OUTPUT="$PWD/deployments/arbitrum-sepolia/session-days.json"
export SETRYN_SETTLEMENT_TOKEN=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d   # Circle USDC; anything else is refused
export SETRYN_ORACLE_SIGNERS=0x...,0x...                                     # fixing publishers, comma separated
export SETRYN_ORACLE_THRESHOLD=1                                            # distinct signatures per fixing
# export SETRYN_TREASURY_ACCEPT_CONTROL=true   # only if the treasury key is also passed below (default false here)

forge script script/BootstrapSetrynMarkets.s.sol:BootstrapSetrynMarkets --root contracts \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain 421614 \
  --sender "$SETRYN_GOVERNANCE_OPERATOR" \
  --private-keys "$OPERATOR_KEY" --private-keys "$GOVERNANCE_ADMIN_KEY" \
  --slow --broadcast
```

About 140 transactions: the operator deploys the `SignedObservationFixingAdapter` (immutable signer set and threshold)
and the `FullyCollateralizedRiskAdapter`, registers the settlement asset, adapters, calendar, session, one base asset and
benchmark per family, the fee schedule (maker 500 ppm, taker 1,000 ppm, recipient account created by the operator and
proposed to the treasury), the risk domain, the instrument, and one market and series per listing market; governance
activates each through the status controller; the operator then enables the execution modes and publishes today through
three days ahead. It writes:

- `deployments/arbitrum-sepolia/runtime.json`: schema 11 (every schema 9 field plus `network`, `listedAt`,
  `fixingAdapter`, `fixingAdapterKind: "signed-observation"`, `riskAdapter`, `oracleSigners`, `oracleThreshold`,
  `sessionDaysPath`, `referenceChainId`, `deploymentBlock`, the venue addresses, and per market the listing economics,
  `priceOffset` = floor, and the schedule). `runtime.json` is gitignored; commit it with `git add -f` if the deployed
  app reads it from the repository.
- `deployments/arbitrum-sepolia/session-days.json`: session id and version and, for every covered day, the windows,
  evidence hash and Merkle proof. `sessionDaysPath` in the runtime is relative to the runtime file's directory.

Rehearse first without broadcasting: start `anvil --fork-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain-id 421614 --port 8546`
and run steps 2–4 against `http://127.0.0.1:8546` with `--unlocked` and anvil's accounts (Circle USDC exists on the
fork), writing outputs to a scratch path inside `deployments/arbitrum-sepolia/`.

### 5. Treasury

The treasury accepts control of the fee account (id `feeRecipientAccountId` in the runtime):

```bash
cast calldata "acceptController(bytes32)" "$(jq -r .feeRecipientAccountId deployments/arbitrum-sepolia/runtime.json)"
# send to $(jq -r .collateralVault deployments/arbitrum-sepolia/runtime.json) from SETRYN_TREASURY_CONTROLLER
```

Governance should also accept the pending default admin transfers DeploySetryn began (after `SETRYN_DEFAULT_ADMIN_DELAY`).

## Web app

```bash
SETRYN_NETWORK=arbitrum-sepolia
NEXT_PUBLIC_SETRYN_NETWORK=arbitrum-sepolia
SETRYN_RPC_URL=<Arbitrum Sepolia RPC>              # server reads
NEXT_PUBLIC_SETRYN_RPC_URL=<Arbitrum Sepolia RPC>  # wallet and browser reads
SETRYN_REFERENCE_RPC_URL=https://arb1.arbitrum.io/rpc
SETRYN_OPERATOR_PRIVATE_KEY=<operator key>         # risk admission, witness staging, keeper calls
SETRYN_MAKER_PRIVATE_KEY=<optional maker key>      # without it no house quotes are posted
# SETRYN_RUNTIME_PATH overrides deployments/arbitrum-sepolia/runtime.json
```

Restart the app; `sync-market-catalog` projects the runtime markets into the catalog on start. Users deposit Circle test
USDC (faucet.circle.com); the mint route is local only.

## Operations

Session days. Trading needs the current UTC day published, and the bootstrap only publishes four days. Publish ahead on
a daily schedule (any funded account; days already published are skipped):

```bash
SETRYN_SESSION_DAYS="$PWD/deployments/arbitrum-sepolia/session-days.json" \
forge script script/PublishSessionDays.s.sol:PublishSessionDays --root contracts \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain 421614 --private-key "$KEEPER_KEY" --broadcast
# SETRYN_SESSION_DAY_FROM / SETRYN_SESSION_DAY_THROUGH (UTC day numbers) override the default today .. today + 3
```

Fixings. Between `E − 1s` and `E + 1h`, a publisher reads the Chainlink Arbitrum One round in force at `E − 1s` for the
family's `referenceFeed`, builds the observation (`observedAt = publishedAt = E − 1s`, value = answer, 8 decimals),
signs the EIP-712 `SetrynSignedObservationBatchV1` (domain `Setryn`/`1`, this chain, the fixing adapter) and anyone
submits it through `FixingEngine.submitEvidence`. After corrections close (`E + 2h`) the keeper finalizes it; without
a fixing by `E + 3h`, the permissionless terminal fallback resolves the series flat.

Keeper. Run the operator worker sweep (order expiry, fixing finalization, settlement, reservation recovery) on a
schedule, at least every few minutes around each expiry:

```bash
SETRYN_SEPOLIA_RPC_URL="$ARBITRUM_SEPOLIA_RPC_URL" \
SETRYN_SEPOLIA_RUNTIME_PATH=deployments/arbitrum-sepolia/runtime.json \
SETRYN_SEPOLIA_MANIFEST_PATH=deployments/arbitrum-sepolia/manifest.json \
SETRYN_SEPOLIA_OPERATOR_KEY="$OPERATOR_KEY" \
pnpm --filter @setryn/operator-runtime worker --environment arbitrum-sepolia --sweep true
```

The operator runtime's schema 11 support (price offset, `chainlink-signed` relay mode with `SETRYN_ORACLE_SIGNER_KEY`,
session-day publication in the sweep) is a follow-up; until it lands, use `PublishSessionDays.s.sol` for session days
and submit signed fixings as described above. The first listed expiry is in late December.

Fee updates. On public chains `UpdateFeeSchedule.s.sol` never broadcasts; it prints the unsigned calls (qualifier
registration, witness install, and the governance `govern` calls that deprecate the active version and activate the new
one). Retiring a fee version closes every market pinned to it, so successor market and series versions must be
registered in the same governance batch; their qualification is rebuilt byte-for-byte by
`NetworkSeriesQualification` (the local path, `node scripts/update-devnet-fees.mjs`, does the whole cascade on a schema
11 runtime).

```bash
SETRYN_FEE_SCHEDULE_REGISTRY=$(jq -r .feeScheduleRegistry deployments/arbitrum-sepolia/runtime.json) \
SETRYN_FUNDED_FEE_ENGINE=$(jq -r .fundedFeeEngine deployments/arbitrum-sepolia/runtime.json) \
SETRYN_FEE_SCHEDULE_ID=$(jq -r .feeScheduleId deployments/arbitrum-sepolia/runtime.json) \
SETRYN_REGISTRY_STATUS_CONTROLLER=$(jq -r .registryStatusController deployments/arbitrum-sepolia/runtime.json) \
SETRYN_MAKER_FEE_RATE_PPM=500 SETRYN_TAKER_FEE_RATE_PPM=1000 \
forge script script/UpdateFeeSchedule.s.sol:UpdateFeeSchedule --root contracts --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"
```

Oracle key rotation. The adapter has no admin. Deploy a new `SignedObservationFixingAdapter` with the new signer set,
register it as a new version of the same adapter id, register and activate benchmark versions pinning it, and
re-version the markets and series that should fix on them. Existing positions keep the versions they were opened on.
