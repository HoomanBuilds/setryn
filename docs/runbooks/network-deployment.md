# Network deployment: Arbitrum Sepolia

This runbook deploys Setryn to Arbitrum Sepolia (chain 421614) with the real-data product of
[docs/plans/network-runtime-real-data.md](../plans/network-runtime-real-data.md): dated range forwards listed from live
Chainlink references, Setryn test USDC or Circle test USDC as collateral, signed-observation fixings, and continuous UTC
trading sessions.
The local devnet (`bash scripts/local-deploy-reset.sh`) runs the same listing generator, bootstrap and runtime schema.

Arbitrum One stays disabled: `DeploySetryn`, `BootstrapSetrynMarkets` and `PublishSessionDays` revert on chain 42161,
and nothing here writes to it. The only Arbitrum One access is read-only `eth_call` of Chainlink aggregators.

## Environment files

| File | Use |
| --- | --- |
| `.env.arbitrum-sepolia.example` | Deployment, market bootstrap and operator worker inputs. Copy to `.env.arbitrum-sepolia`, fill it in, `set -a; source .env.arbitrum-sepolia; set +a`. |
| `apps/web/.env.arbitrum-sepolia.example` | The web app pointed at the Sepolia deployment. Copy to `apps/web/.env.local` or set on the host. |
| `apps/web/.env.example` | Every web variable with its meaning and default. |
| `.env.example` | Local chain and local operator worker. |

Filled copies hold private keys and are gitignored; only the `.example` files are committed.

## Hosting the web app on Vercel

- Project root directory: `apps/web`. Install and build commands stay the defaults (`pnpm install`, `pnpm run build`).
- Environment variables: copy `apps/web/.env.arbitrum-sepolia.example` into the Vercel project settings
  (`SETRYN_NETWORK=arbitrum-sepolia`, RPC URLs, `SETRYN_OPERATOR_PRIVATE_KEY`, optional `SETRYN_MAKER_PRIVATE_KEY`,
  `SETRYN_PUBLIC_ORIGIN` = the Vercel domain).
- The app reads `deployments/arbitrum-sepolia/runtime.json`, `manifest.json` and `session-days.json` from the
  repository; they are bundled into the server routes at build time. After the bootstrap, commit those three files and
  redeploy. Until then the app builds and shows the listing and Chainlink references with the chain marked unavailable.
- `deployments/local/` is not in git, so a build without `SETRYN_NETWORK` keeps the committed market catalog.
- Vercel functions can only write to a temporary directory, so organization, API-key and webhook records do not
  persist across cold starts unless `SETRYN_ORG_STORE_PATH`, `SETRYN_PUBLIC_API_DIR` and `SETRYN_WEBHOOKS_DIR` point at
  durable storage.

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

pnpm run contracts:release:prepare
forge script "$PWD/contracts/script/DeploySetryn.s.sol:DeploySetryn" --root contracts \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain 421614 \
  --sender "$SETRYN_DEPLOYER_ADDRESS" --private-key "$DEPLOYER_KEY" \
  --slow --broadcast
```

The run sends about 300 transactions. Optional overrides keep their defaults: `SETRYN_DEFAULT_ADMIN_DELAY` (2 days),
`SETRYN_MAXIMUM_RISK_OBSERVATION_AGE` (300 s, the bootstrap must use the same value),
`SETRYN_SEQUENCER_RECOVERY_GRACE` (1 h; the static feed reports the sequencer up since an hour before its deployment,
so trading is open immediately).

The release preparation refuses modified tracked contract inputs, deletes compiler output, performs a forced build, and
checks the standalone deployment-artifact map. This prevents a deployment from reading bytecode left by an earlier
source revision. Commit the reviewed contract source before running it. Deployment broadcasts remain untracked local
evidence and do not block the check.

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
export SETRYN_SETTLEMENT_TOKEN=   # empty deploys Setryn Test USDC
# To use Circle test USDC instead:
# export SETRYN_SETTLEMENT_TOKEN=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
export SETRYN_ORACLE_SIGNERS=0x...,0x...                                     # fixing publishers, comma separated
export SETRYN_ORACLE_THRESHOLD=1                                            # distinct signatures per fixing
# export SETRYN_TREASURY_ACCEPT_CONTROL=true   # only if the treasury key is also passed below (default false here)

forge script "$PWD/contracts/script/BootstrapSetrynMarkets.s.sol:BootstrapSetrynMarkets" --root contracts \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain 421614 \
  --sender "$SETRYN_GOVERNANCE_OPERATOR" \
  --private-keys "$OPERATOR_KEY" --private-keys "$GOVERNANCE_ADMIN_KEY" \
  --slow --broadcast
```

About 140 transactions: when `SETRYN_SETTLEMENT_TOKEN` is empty the operator first deploys the six-decimal `SetrynTestUSDC`
faucet token, then deploys the `SignedObservationFixingAdapter` (immutable signer set and threshold) and the
`FullyCollateralizedRiskAdapter`. It registers the settlement asset, adapters, calendar, session, one base asset and
benchmark per family, the fee schedule (maker 500 ppm, taker 1,000 ppm, recipient account created by the operator and
proposed to the treasury), the risk domain, the instrument, and one market and series per listing market. Governance
activates each through the status controller. The operator then enables the execution modes and publishes today through
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

### 6. Governance handoff

DeploySetryn begins delayed default-admin transfers to `SETRYN_GOVERNANCE_ADMIN`. Inspect every compatible deployed
contract without signing or broadcasting:

```bash
set -a; source .env.arbitrum-sepolia; set +a
./scripts/accept-sepolia-admin-transfers.sh
```

The command reports transfers that are already accepted, ready, or still waiting for their acceptance schedule. It
refuses unexpected administrators and every chain except Arbitrum Sepolia. After all schedules have elapsed, unlock the
`setryn-governance` Foundry keystore through the environment and explicitly broadcast:

```bash
export ETH_PASSWORD="$SETRYN_TESTNET_KEYSTORE_PASSWORD"
./scripts/accept-sepolia-admin-transfers.sh --broadcast
unset ETH_PASSWORD
```

The broadcast is idempotent: already accepted contracts are skipped, every receipt is awaited, and each resulting
`defaultAdmin` is checked against `SETRYN_GOVERNANCE_ADMIN`.

## Web app

```bash
SETRYN_NETWORK=arbitrum-sepolia
NEXT_PUBLIC_SETRYN_NETWORK=arbitrum-sepolia
SETRYN_RPC_URL=<Arbitrum Sepolia provider RPC>     # private server primary
SETRYN_RPC_FALLBACK_URLS=https://sepolia-rollup.arbitrum.io/rpc,https://arbitrum-sepolia-rpc.publicnode.com,https://arbitrum-sepolia.drpc.org
NEXT_PUBLIC_SETRYN_RPC_URL=<Arbitrum Sepolia RPC>  # wallet and browser reads
SETRYN_REFERENCE_RPC_URL=https://arb1.arbitrum.io/rpc
SETRYN_OPERATOR_PRIVATE_KEY=<operator key>         # risk admission, witness staging, keeper calls
SETRYN_MAKER_PRIVATE_KEY=<optional maker key>      # signs firm quotes offchain; without it no house quotes stream
SETRYN_RELAYER_PRIVATE_KEY=<optional relayer key>  # gasless settlement submission; without it users submit themselves
# SETRYN_RUNTIME_PATH overrides deployments/arbitrum-sepolia/runtime.json
```

Restart the app; `sync-market-catalog` projects the runtime markets into the catalog on start. With Setryn Test USDC,
users claim 10,000 tUSDC per request from the in-app faucet and deposit it into their trading account. The faucet has
no cooldown; a wallet can hold at most 10M tUSDC through it (the token enforces the same cap), and it never sends ETH,
so users still need Arbitrum Sepolia ETH for gas. The operator signs the faucet mint, so its key must hold Sepolia ETH.
With the Circle override, users get test USDC from faucet.circle.com instead and the in-app faucet is off.

Designated maker. With `SETRYN_MAKER_PRIVATE_KEY` set and a runtime that names `quoteSettlementRouter`, the maker
streams a firm ten-level bid and ask ladder on every market (docs/runbooks/firm-quotes.md). Quotes are EIP-712 signed orders priced from
the Chainlink reference, valid 45 seconds and re-signed before they run low, so prices move with no transaction; the
terminal receives them over `GET /api/quotes/stream`. A taker signs typed data and one `QuoteSettlementRouter.settle`
transaction settles both sides, submitted by the optional relayer (`SETRYN_RELAYER_PRIVATE_KEY`, its own key and nonce
lane, no fee) or by the taker's wallet when no relayer answers. The maker's only recurring transaction locks one
series' quote capacity per three-day epoch, the first time the series is viewed; it mints its own tUSDC collateral and
needs Sepolia ETH for those transactions, as the relayer does for the settlements it submits. Without a router in the
runtime the terminal shows the public book only and says so.

Live Sepolia smoke trade. This prepares one ordinary wallet with faucet tUSDC, deposits 5,000 tUSDC, installs its two
clearing approvals, accepts one lot of the ETH December maker ask, and waits for the atomic settlement receipt. The
script refuses every network except Arbitrum Sepolia and never contains a key.

```bash
ARBITRUM_SEPOLIA_RPC_URL=<rpc> \
SETRYN_TEST_TAKER_PRIVATE_KEY=<test-wallet-private-key> \
node apps/web/scripts/smoke-arbitrum-sepolia.mjs
```

`SETRYN_SMOKE_MARKET`, `SETRYN_SMOKE_SIDE`, `SETRYN_SMOKE_LOTS`, and `SETRYN_SMOKE_DEPOSIT_USDC` override the default
market, buy direction, one-lot size, and available-collateral target. Reusing a wallet keeps its account and approvals;
the script tops up tUSDC only when the requested available-collateral target is no longer met.

## Operations

Session days. Trading needs the current UTC day published, and the bootstrap only publishes four days. The operator
worker's keeper sweep (below) publishes every missing day from today through today + 3 from the runtime's
`sessionDaysPath` through the permissionless `TradingSessionPolicy.publishSessionDay`. The manual path (any funded
account; days already published are skipped):

```bash
SETRYN_SESSION_DAYS="$PWD/deployments/arbitrum-sepolia/session-days.json" \
forge script "$PWD/contracts/script/PublishSessionDays.s.sol:PublishSessionDays" --root contracts \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --chain 421614 --private-key "$KEEPER_KEY" --broadcast
# SETRYN_SESSION_DAY_FROM / SETRYN_SESSION_DAY_THROUGH (UTC day numbers) override the default today .. today + 3
```

Fixings. Between `E − 1s` and `E + 1h`, a publisher reads the Chainlink Arbitrum One round in force at `E − 1s` for the
family's `referenceFeed`, builds the observation (`observedAt = publishedAt = E − 1s`, value = answer, 8 decimals),
signs the EIP-712 `SetrynSignedObservationBatchV1` (domain `Setryn`/`1`, this chain, the fixing adapter) and anyone
submits it through `FixingEngine.submitEvidence`. The operator worker does this in its `chainlink-signed` relay mode
(below). After corrections close (`E + 2h`) the keeper finalizes it; without a fixing by `E + 3h`, the permissionless
terminal fallback resolves the series flat.

Keeper. Run the operator worker on a schedule, at least every few minutes around each expiry and at least daily
otherwise. On a schema 11 runtime one `--sweep true` run:

1. publishes missing session days (today … today + 3) from `session-days.json`;
2. when an oracle signer is configured, relays `chainlink-signed` fixings: for every series whose fixing target has
   passed and that has no proposal yet, it reads the Chainlink round in force at the target from the market's
   `referenceFeed` (Arbitrum One, read-only, walking `getRoundData` back from `latestRoundData`), signs the batch with
   `SETRYN_ORACLE_SIGNER_KEY` (which must be one of the runtime's `oracleSigners`; the relay signs alone, so it needs
   `oracleThreshold` 1) and submits it through `FixingEngine.submitEvidence`;
3. sweeps every market: order expiry, fixing finalization or terminal fallback, settlement, reservation recovery.

```bash
SETRYN_SEPOLIA_RPC_URL="$ARBITRUM_SEPOLIA_RPC_URL" \
SETRYN_SEPOLIA_OPERATOR_KEY="$OPERATOR_KEY" \
SETRYN_ORACLE_SIGNER_KEY="$ORACLE_SIGNER_KEY" \
SETRYN_REFERENCE_RPC_URL=https://arb1.arbitrum.io/rpc \
pnpm --filter @setryn/operator-runtime worker --environment arbitrum-sepolia --sweep true
```

The runtime and manifest default to `deployments/arbitrum-sepolia/runtime.json` and `manifest.json`
(`SETRYN_SEPOLIA_RUNTIME_PATH` and `SETRYN_SEPOLIA_MANIFEST_PATH` override them); the worker refuses a runtime whose
`network` is not `arbitrum-sepolia`, and refuses Arbitrum One outright. Without `SETRYN_ORACLE_SIGNER_KEY` the sweep
skips fixings (publish them another way); `--relay none` turns the relay off, and `--relay chainlink-signed` runs only
the relay. Locally (`--environment local`) the oracle signer defaults to the operator's anvil account, which the local
bootstrap registers as the publisher. The worker prices with the runtime's `priceOffset`
(`ticks = (price − priceOffset) × priceScale`) and sizes bids by their consideration, since a range forward's long has a
zero terminal debit; such a long cannot back a private RFQ quote (whose liability must be positive), so the solver
quotes only the short side. The first listed expiry is in late December.

Maker liquidity. The designated maker streams firm quotes offchain (docs/runbooks/firm-quotes.md): signed EIP-712
orders backed by onchain capacity, settled only when a taker accepts one through `QuoteSettlementRouter`. Nothing
refreshes quotes onchain, so there is no maker refresher timer and an idle market spends no gas. The maker's only
recurring transaction opens a series' quote capacity once per three-day epoch, the first time that series is viewed.

A host that installed the retired refresher removes it:

```bash
sudo systemctl disable --now setryn-maker-refresh.timer setryn-maker-refresh.service
sudo rm -f /etc/systemd/system/setryn-maker-refresh.service /etc/systemd/system/setryn-maker-refresh.timer
sudo systemctl daemon-reload
sudo rm -f /etc/setryn/maker-refresh.env /var/lib/setryn/maker-refresh.cursor
```

The daily operator keeps wrapping its node command with `/usr/bin/flock --wait 180 /run/lock/setryn-wallet.lock`.

Status and logs:

```bash
systemctl list-timers setryn-operator.timer
journalctl -u setryn-operator.service -n 50
```

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
forge script "$PWD/contracts/script/UpdateFeeSchedule.s.sol:UpdateFeeSchedule" --root contracts --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL"
```

Oracle key rotation. The adapter has no admin. Deploy a new `SignedObservationFixingAdapter` with the new signer set,
register it as a new version of the same adapter id, register and activate benchmark versions pinning it, and
re-version the markets and series that should fix on them. Existing positions keep the versions they were opened on.
