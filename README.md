<p align="center">
  <img src="apps/web/src/app/(landing)/icon.svg" alt="Setryn" width="80" />
</p>

<h1 align="center">Setryn</h1>

<p align="center">
  <b>The fixed-expiry exchange on Arbitrum.</b>
</p>

<p align="center">
  Trade future price risk with a defined expiry, bounded payoff, funded collateral, and one deterministic settlement.
</p>

<p align="center">
  <a href="https://setryn.vercel.app">Live exchange</a> |
  <a href="https://setryn.vercel.app/markets">Markets</a> |
  <a href="https://setryn.vercel.app/api/v1/openapi.json">OpenAPI 3.1</a> |
  <a href="packages/sdk/README.md">TypeScript SDK</a> |
  <a href="contracts/README.md">Contracts</a> |
  <a href="docs/README.md">Documentation</a> |
  <a href="https://x.com/SetrynX">X</a>
</p>

> **Risk has a date. Trade it.** Setryn turns a future price, rate, yield, basis, or complete strategy into a native fixed-expiry market. Users can discover a series, compare public and private liquidity, clear against funded collateral, manage the resulting position, and verify its fixing and settlement through one exchange protocol.

Setryn is live as a production-shaped release candidate on **Arbitrum Sepolia**. The current application activates 15 capped dated-forward markets across BTC, ETH, ARB, EUR/USD, and XAU/USD. The protocol also contains the registries, payoff modules, private RFQ, auction, package, routing, lifecycle, capacity, risk, settlement, and evidence systems required to expand the exchange without hardcoding a single asset or market family.

Arbitrum One is the production target. It remains read-only and has not been deployed to or transacted against by this repository.

## Contents

- [What Setryn does](#what-setryn-does)
- [Why fixed expiry](#why-fixed-expiry)
- [What is live](#what-is-live)
- [Markets](#markets)
- [How a trade works](#how-a-trade-works)
- [Protocol architecture](#protocol-architecture)
- [Core contracts](#core-contracts)
- [Revenue model](#revenue-model)
- [Exchange application](#exchange-application)
- [API and SDK](#api-and-sdk)
- [Repository structure](#repository-structure)
- [Run locally](#run-locally)
- [Security and trust boundaries](#security-and-trust-boundaries)
- [For judges and reviewers](#for-judges-and-reviewers)

## What Setryn does

Setryn is one exchange composed of six connected systems:

1. **Fixed-expiry markets.** A market is a versioned combination of asset, benchmark, calendar, session, payoff, collateral, risk domain, fee schedule, and settlement rules. Each expiry is its own onchain series rather than a label applied by the frontend.
2. **Public and private liquidity.** Standardized markets can use a public order book, capacity-backed streaming maker quotes, private RFQs, sealed auctions, and batch clearing. Every executable source has explicit size, expiry, firmness, and provenance.
3. **Collateral and portfolio risk.** Orders reserve their maximum funded exposure before execution. The vault, risk engine, capacity managers, and admission gates prevent an accepted order or maker quote from depending on unsecured promises.
4. **Atomic execution.** Matching, fee collection, position creation, and collateral state move through the same clearing system. Firm maker quotes settle through one caller-independent router transaction or revert as a whole.
5. **Complete lifecycle.** Positions are not abandoned after a fill. The protocol models entry, offset, unwind, compression, fixing, settlement, default, recovery, and permissionless terminal completion.
6. **Evidence and integration.** Events, receipt authorities, an evidence ledger, an indexer, a versioned API, webhooks, and a TypeScript SDK expose the same canonical exchange state to the terminal and external applications.

This is not a perpetual DEX, a trade router, or a privacy layer around an existing venue. Setryn owns the market definition, liquidity admission, collateral, matching, positions, fixing, fees, settlement, and evidence.

## Why fixed expiry

Perpetuals are useful for continuous directional exposure, but they are a poor fit for risks that already have a date. A treasury payment, token unlock, invoice, procurement obligation, rate reset, or investment horizon should not require indefinite funding payments and a discretionary exit.

A Setryn series defines the important terms before anyone trades:

- the underlying reference and quote convention;
- the final trading time and expiry;
- the cap, floor, lot, and price grid;
- the benchmark and fixing window;
- the maximum loss and collateral rules;
- the fee schedule and permitted execution modes;
- the settlement deadline and terminal fallback.

The result is a position whose future outcome can be understood before signing and resolved from committed rules after expiry.

## What is live

| Surface | Arbitrum Sepolia status |
| --- | --- |
| Exchange web application | Live at [setryn.vercel.app](https://setryn.vercel.app) |
| Qualified markets | 15 onchain series across five underlyings and three expiries |
| Collateral | Mintable Setryn Test USDC with 6 decimals, isolated to testnet |
| Public liquidity | Resting limit orders plus separately labelled firm maker streams |
| Firm quote settlement | Signed EIP-712 maker and taker intent, capacity-backed, atomic router settlement |
| Positions and portfolio | Onchain positions, collateral, PnL, activity, risk, and lifecycle views |
| Market data | Expiry-specific marks, reference overlay, fills, books, and persisted candles |
| Fees | Versioned onchain schedule, currently 5 bps maker and 10 bps taker |
| Fixing and settlement | Signed observation fixing adapter, fixing engine, cash settlement, and terminal paths |
| Private and advanced execution | RFQ, auction, batch, package, capacity, and route contracts are deployed; activation depends on the selected product path and liquidity |
| Developer layer | Public API v1, OpenAPI 3.1, TypeScript SDK, partner attribution, and signed webhooks are implemented; key issuance remains a controlled release surface |

The distinction matters: a deployed module proves the production-shaped graph and its interfaces, but it is not presented as active liquidity until the corresponding market, operator, and capacity policy are enabled.

## Markets

The release candidate lists three expiries for each underlying: 24 December 2026, 26 March 2027, and 25 June 2027.

| Underlying | Series keys | Protocol lot | Price increment |
| --- | --- | ---: | ---: |
| BTC/USD | `BTC-YC-24DEC26`, `BTC-YC-26MAR27`, `BTC-YC-25JUN27` | 0.01 | 1 USD |
| ETH/USD | `ETH-FC-24DEC26`, `ETH-FC-26MAR27`, `ETH-FC-25JUN27` | 0.1 | 0.1 USD |
| ARB/USD | `ARB-BS-24DEC26`, `ARB-BS-26MAR27`, `ARB-BS-25JUN27` | 1,000 | 0.0001 USD |
| EUR/USD | `EURUSD-FW-24DEC26`, `EURUSD-FW-26MAR27`, `EURUSD-FW-25JUN27` | 10,000 | 0.00001 USD |
| XAU/USD | `XAUUSD-FW-24DEC26`, `XAUUSD-FW-26MAR27`, `XAUUSD-FW-25JUN27` | 1 | 0.1 USD |

Every listed series is a fully collateralized capped dated forward. The protocol also deploys payoff modules for NDFs, calls, puts, collars, rate forwards, caps, floors, basis spreads, calendar spreads, window averages, and correlation or dispersion products. Those modules make new qualified market families possible; they do not imply that every family already has active liquidity.

## How a trade works

### Public book or firm maker quote

1. The trader connects an Arbitrum wallet, claims test collateral on Sepolia, and deposits it into a Setryn collateral account.
2. The terminal loads one coherent market snapshot: expiry-specific mark, reference price, public orders, firm maker quotes, recent fills, fees, and route health.
3. The trader chooses a side, lot count, limit, and time in force. The ticket shows maximum collateral and fee consequences before signing.
4. The wallet signs the canonical EIP-712 order. Firm quotes carry the maker's signed opposite-side order and a signed capacity authorization.
5. Any caller or the optional relayer can submit the firm pair to `QuoteSettlementRouter`. The router verifies both signatures, binds risk, consumes capacity, registers both orders, and clears them in one transaction.
6. `AtomicClearingEngine` moves fees and collateral state and creates both positions. A failure reverts the entire settlement.
7. The indexer projects the fill, positions, receipt, and activity timeline back into the terminal. The consumed quote leaves the stream.

An unmatched GTC or GTD limit order can rest on `PublicOrderBook`. IOC and FOK orders either clear under their signed constraints or fail without becoming a resting order.

### Fixing and settlement

1. Each series commits its benchmark, observation window, correction period, and settlement deadline at activation.
2. A qualified adapter submits signed observations to `FixingEngine`.
3. The payoff module deterministically computes each side's terminal entitlement from the final fixing and the series terms.
4. `CashSettlementCoordinator` resolves the funded terminal liabilities in the collateral vault.
5. If an operator disappears, historical positions retain objective permissionless completion paths from committed state.

## Protocol architecture

```text
Trader or maker wallet
        |
        v
Next.js exchange and API v1
        |
        +-> public order book
        +-> signed firm quote stream
        +-> private RFQ and sealed auction
        |
        v
Admission gates -> portfolio risk -> collateral and capacity reservations
        |
        v
Atomic clearing -> funded fees -> positions
        |
        v
Lifecycle -> fixing -> cash settlement -> verifiable receipt

Chain events -> indexer -> PostgreSQL projections -> terminal, API, webhooks
References  -> market-data ingester -> marks and candles -> terminal and maker
Operator    -> maker, keeper, oracle, reconciliation, health
```

### Extensibility boundary

New assets and products are added through versioned registries and qualified adapters. Core execution does not rely on a hardcoded symbol list. A new series pins exact versions of its asset, benchmark, calendar, session, payoff, collateral, fee schedule, execution policy, and risk domain, so later additions cannot silently rewrite historical positions.

## Core contracts

Network: **Arbitrum Sepolia** (`421614`). Explorer: [Sepolia Arbiscan](https://sepolia.arbiscan.io).

The root keeps the review path concise. The release actually contains **88 deployed contracts**: 85 contracts in the core deployment and 3 contracts created during market bootstrap. See the [complete deployment registry](contracts/README.md#complete-arbitrum-sepolia-deployment) for every address and responsibility.

| Contract | Address | Responsibility |
| --- | --- | --- |
| CollateralVault | [`0x16344d20A4197927efE4545Bb3962006629fF5f6`](https://sepolia.arbiscan.io/address/0x16344d20A4197927efE4545Bb3962006629fF5f6) | Custody, accounts, reservations, funded fees, and settlement balances |
| MarketRegistry | [`0xB868c249eB66c279D087F2fcae79F57a2Ef1379d`](https://sepolia.arbiscan.io/address/0xB868c249eB66c279D087F2fcae79F57a2Ef1379d) | Versioned market definitions and qualification state |
| SeriesRegistry | [`0xDC9563eAE3Aa03e8Dd93DbCf46f3E4e636b865Fa`](https://sepolia.arbiscan.io/address/0xDC9563eAE3Aa03e8Dd93DbCf46f3E4e636b865Fa) | Expiry-specific economics and lifecycle dependencies |
| PortfolioRiskEngine | [`0xc106c9ceB3A7A6D96279e9433Bb59A45c807E1CD`](https://sepolia.arbiscan.io/address/0xc106c9ceB3A7A6D96279e9433Bb59A45c807E1CD) | Pre-trade funded risk admission |
| PublicOrderBook | [`0x2DdA32044026E562849228653FD56Ba7a05eA8F1`](https://sepolia.arbiscan.io/address/0x2DdA32044026E562849228653FD56Ba7a05eA8F1) | Resting public limit orders and price-time matching |
| PrivateRfqBook | [`0x0A06BF70692AD5683D3f202D1657e47fF0454d7f`](https://sepolia.arbiscan.io/address/0x0A06BF70692AD5683D3f202D1657e47fF0454d7f) | Private request, quote, selection, and clearing state |
| SealedAuctionHouse | [`0xc94D19B9a6FF17795c45239497182FE55b80Dee7`](https://sepolia.arbiscan.io/address/0xc94D19B9a6FF17795c45239497182FE55b80Dee7) | Sealed bid collection and deterministic auction settlement |
| QuoteSettlementRouter | [`0xf2C404D67D6cD04e1DFa7F836EA3ab9401957286`](https://sepolia.arbiscan.io/address/0xf2C404D67D6cD04e1DFa7F836EA3ab9401957286) | One-transaction settlement of signed, capacity-backed maker quotes |
| AtomicClearingEngine | [`0x12681127Db37Ff96FeF81F2685D1c0A3406E16D9`](https://sepolia.arbiscan.io/address/0x12681127Db37Ff96FeF81F2685D1c0A3406E16D9) | Atomic fills, collateral movement, fees, and position creation |
| PositionEngine | [`0x4E80Cc89555efde78436FEAf24f8D6c33c11E5b5`](https://sepolia.arbiscan.io/address/0x4E80Cc89555efde78436FEAf24f8D6c33c11E5b5) | Canonical position state and terminal liabilities |
| PositionLifecycleExecutor | [`0x31b6E7F329D9BAae490FD3C5557173E2C3017f21`](https://sepolia.arbiscan.io/address/0x31b6E7F329D9BAae490FD3C5557173E2C3017f21) | Authorized unwind, compression, and lifecycle state changes |
| FixingEngine | [`0xccbE3A19fbeBa1396DBF39A5ED13E614a70E8500`](https://sepolia.arbiscan.io/address/0xccbE3A19fbeBa1396DBF39A5ED13E614a70E8500) | Evidence-backed expiry observations and final fixing |
| CashSettlementCoordinator | [`0x821f6464714495e05752B26a024f476a836d27Bd`](https://sepolia.arbiscan.io/address/0x821f6464714495e05752B26a024f476a836d27Bd) | Deterministic funded cash settlement at expiry |
| VerifiableReceiptLedger | [`0xb548f0ab66470ddc442a3664e4dcc25170e06d69`](https://sepolia.arbiscan.io/address/0xb548f0ab66470ddc442a3664e4dcc25170e06d69) | Canonical evidence records across execution and lifecycle domains |
| SetrynTestUSDC | [`0x9768816048290e2Bee48729698EF3B60Af4F4D4F`](https://sepolia.arbiscan.io/address/0x9768816048290e2Bee48729698EF3B60Af4F4D4F) | Permissionless test collateral, blocked from Arbitrum One |

Canonical deployment artifacts:

- [`deployments/arbitrum-sepolia/manifest.json`](deployments/arbitrum-sepolia/manifest.json) records the deployment transactions, constructor dependencies, roles, bytecode evidence, and source commit.
- [`deployments/arbitrum-sepolia/runtime.json`](deployments/arbitrum-sepolia/runtime.json) is the application runtime and 15-market registry snapshot.
- [`deployments/arbitrum-sepolia/markets.json`](deployments/arbitrum-sepolia/markets.json) contains the complete market listing and bounded economic terms.
- [`deployments/arbitrum-sepolia/session-days.json`](deployments/arbitrum-sepolia/session-days.json) commits the trading-session calendar used by the listed series.

## Revenue model

Revenue is collected onchain during clearing, not calculated only in the interface.

| Revenue stream | Current status | Rule |
| --- | --- | --- |
| Maker execution fee | Implemented | 5 bps of matched consideration |
| Taker execution fee | Implemented | 10 bps of matched consideration |
| Settlement and terminal completion | Free by design | A fee cannot block expiry resolution or a valid exit |
| Lifecycle, partner, subscription, and data revenue | Planned | Not presented as current protocol revenue |

Every execution channel reaches the same funded fee engine. Each signed order caps the fee it accepts, and a market version pins one fee-schedule version. Governance can activate a new version without changing code, while historical positions keep the economics under which they opened. Fees accrue to a dedicated collateral-vault account controlled by the configured treasury controller.

At the current 5 bps maker and 10 bps taker schedule, the protocol take is 15 bps of matched consideration. See [unit economics and revenue status](docs/research/setryn-unit-economics-2026-09-30.md) for fee math, assumptions, and the explicit boundary between implemented and planned revenue.

## Exchange application

The first-party product is a dense trading workstation rather than a frontend wrapped around a contract demo.

| Surface | Purpose |
| --- | --- |
| Trade | Chart, book, firm quotes, ticket, routes, positions, orders, fills, and execution timeline |
| Markets | Search, expiry ladder, term structure, source filters, qualification, and liquidity at size |
| Protect | Outcome-first workflow for a dated exposure or hedge |
| Strategies | Guided and typed multi-leg strategy construction |
| RFQs and auctions | Private quote competition and sealed execution workflows |
| Portfolio | Equity, collateral, positions, PnL, exposures, and portfolio risk |
| Lifecycle and settlements | Fixing, expiry, unwind, roll, settlement, recovery, and calendar state |
| Activity and receipts | Orders, fills, protocol events, transaction state, and verifiable evidence |
| Maker and solver | Quote surfaces, capacity, inventory, obligations, and execution operations |
| Treasury and operations | Fee schedule, protocol balances, dependencies, keepers, and system health |

The terminal distinguishes observed, executable, and modeled data. Public orders, firm maker streams, private RFQs, and indicative values are never merged into an unlabeled depth number.

Read the [web application guide](apps/web/README.md) for route ownership, data flow, wallet behavior, and deployment configuration.

## API and SDK

The developer layer uses the same runtime, schemas, signatures, contract bindings, and projections as the first-party exchange.

- **REST API v1:** markets, books, trades, accounts, positions, orders, fills, receipts, exits, private RFQs, API keys, partners, and webhooks.
- **OpenAPI 3.1:** the current hosted schema is available at [setryn.vercel.app/api/v1/openapi.json](https://setryn.vercel.app/api/v1/openapi.json).
- **TypeScript SDK:** ESM client with typed reads, EIP-712 order preparation, wallet signing helpers, public-order submission, position exits, RFQs, pagination, HMAC request signing, rate-limit handling, and structured errors.
- **Webhooks:** signed delivery with replay-safe event storage and retry state.
- **Embedded distribution:** partner codes, attribution events, and the browser widget at `public/embed.js`.

API-key issuance and partner management remain controlled release surfaces. The interfaces and SDK are implemented and documented, but that does not mean unauthenticated production trading is enabled.

See [`packages/sdk/README.md`](packages/sdk/README.md) for the complete method and endpoint table, code examples, signature model, and current limitations.

## Repository structure

```text
setryn/
|-- apps/
|   `-- web/                    Next.js landing, exchange, API v1, and embedded widgets
|-- contracts/                 Foundry workspace, 287 Solidity source units, scripts, and tests
|-- packages/
|   |-- internal-contracts/     generated ABIs, bytecode identity, and typed contract bindings
|   |-- internal-schemas/       canonical API, order, event, and projection schemas
|   |-- market-data/            shared market-data types and pricing inputs
|   |-- persistence/            PostgreSQL-backed persistence adapters
|   `-- sdk/                    public TypeScript client and examples
|-- services/
|   |-- application-data/       chain and projection read model for product surfaces
|   |-- indexer/                event normalization, reduction, and deterministic projections
|   |-- market-data-ingester/   reference rounds, fills, candles, and resumable cursors
|   |-- operator-runtime/       maker, keeper, oracle, solver, reconciliation, and health
|   |-- organization-control/   policies, approvals, accounting, and organization state
|   `-- webhooks/               signed subscription and delivery worker
|-- deployments/               local, Sepolia, and unsigned Arbitrum One artifacts
|-- deploy/                     service definitions for persistent hosts
|-- scripts/                    deployment, evidence, bindings, markets, and qualification tools
|-- supabase/                   portable PostgreSQL schema migrations
`-- docs/                       product specs, research, plans, security, and runbooks
```

See [`packages/README.md`](packages/README.md) and [`services/README.md`](services/README.md) for package and service boundaries.

## Run locally

### Requirements

- Node.js 22 or newer
- pnpm 11.24.0
- Foundry stable
- PostgreSQL for persistent projections and market history

### Install and start

```bash
git submodule update --init --recursive
pnpm install

# Starts Anvil, deploys the complete graph, bootstraps 15 markets,
# and writes deployments/local/runtime.json.
bash scripts/local-deploy-reset.sh

# Starts the web application at http://localhost:3000.
pnpm dev
```

The local reset uses the same deployment and market-bootstrap architecture as Sepolia. Its settlement token is mintable test collateral, and its public-network reference reads are read-only.

### Focused commands

```bash
pnpm contracts:build
pnpm contracts:test
pnpm internal:typecheck
pnpm internal:test
pnpm --filter @setryn/web build
pnpm --filter @setryn/sdk build
```

`pnpm check` is the routine repository gate. `pnpm check:full` additionally runs the invariant suite.

### Deploying a testnet release

The exact rehearsal, broadcast, bootstrap, governance handoff, runtime generation, and evidence commands are in [`docs/runbooks/network-deployment.md`](docs/runbooks/network-deployment.md). Deployment scripts simulate by default and require explicit broadcast behavior for network writes.

## Technology stack

| Layer | Technology |
| --- | --- |
| Contracts | Solidity 0.8.37, Foundry, OpenZeppelin |
| Chain | Arbitrum Sepolia release candidate, Arbitrum One production target |
| Web | Next.js, React, TypeScript, Tailwind CSS |
| Wallets | wagmi, viem, RainbowKit, EIP-6963, WalletConnect |
| Data | PostgreSQL, resumable chain indexing, reference-round ingestion |
| Services | Node.js and TypeScript workers |
| Interfaces | REST API v1, OpenAPI 3.1, EIP-712, signed webhooks, TypeScript SDK |
| Market references | Chainlink reference history and qualified signed fixing observations; Pyth pull adapter available for qualified markets |

## Security and trust boundaries

The current deployment is a testnet release candidate, not an audited mainnet launch.

### Enforced in contracts

- bounded payoffs and maximum-loss collateral admission;
- EIP-712 domain separation, deadlines, nonces, signer checks, and quote consumption;
- versioned, qualified, and explicitly activated economic dependencies;
- atomic clearing for the selected execution path;
- capacity reservations that prevent firm maker capital from being promised twice;
- fee caps signed by the user and funded from collateral;
- scoped roles, delayed administration, and pause-new-risk behavior;
- historical settlement and terminal-resolution paths that survive new-risk revocation;
- explicit fixing, lifecycle, default, recovery, and evidence state machines.

### Remaining trust and release boundaries

- Arbitrum Sepolia uses a static testnet sequencer-health substitute because no official Chainlink uptime feed exists there.
- Setryn Test USDC is permissionlessly mintable and has no value. Its bytecode refuses Arbitrum One.
- Reference marks include a versioned model. Final settlement uses the series fixing rules, not the frontend chart.
- Operators and makers remain operational dependencies for fresh quotes and routine progression, while committed historical outcomes retain permissionless paths.
- Mainnet requires independent audits, complete explorer verification, production oracle and sequencer dependencies, governance acceptance, separate operator identities, real USDC qualification, liquidity, monitoring, and explicit authorization.

The full model is documented in [threat model and protocol invariants](docs/specs/setryn-threat-model-and-invariants.md), [roles and state machines](docs/specs/setryn-roles-and-state-machines.md), and [incident response](docs/runbooks/incident-response.md).

## For judges and reviewers

| Item | Link or value |
| --- | --- |
| Live product | [setryn.vercel.app](https://setryn.vercel.app) |
| Network | Arbitrum Sepolia, chain ID `421614` |
| First market | [BTC dated forward, 24 Dec 2026](https://setryn.vercel.app/trade/BTC-YC-24DEC26) |
| Market directory | [setryn.vercel.app/markets](https://setryn.vercel.app/markets) |
| Core contract | [`QuoteSettlementRouter`](https://sepolia.arbiscan.io/address/0xf2C404D67D6cD04e1DFa7F836EA3ab9401957286) |
| Complete contract registry | [88 deployed contracts](contracts/README.md#complete-arbitrum-sepolia-deployment) |
| Deployment evidence | [`manifest.json`](deployments/arbitrum-sepolia/manifest.json) |
| Runtime and markets | [`runtime.json`](deployments/arbitrum-sepolia/runtime.json), [`markets.json`](deployments/arbitrum-sepolia/markets.json) |
| OpenAPI | [Hosted OpenAPI 3.1 document](https://setryn.vercel.app/api/v1/openapi.json) |
| SDK | [`@setryn/sdk`](packages/sdk/README.md) |
| Product specification | [Concise product overview](docs/plans/setryn-product-and-phase-overview.md) |
| Economic rules | [Market, instrument, and settlement rules](docs/specs/setryn-market-instrument-and-economic-rules.md) |

Recommended review path:

1. Open a live market and inspect the expiry-specific chart, public book, firm maker stream, payoff, and complete ticket.
2. Claim test collateral, deposit, and execute one firm quote. Follow its pending, submitted, clearing, and confirmed states.
3. Open the resulting position, portfolio entry, activity event, and receipt.
4. Compare the transaction with `QuoteSettlementRouter`, `AtomicClearingEngine`, `CollateralVault`, and `PositionEngine` on Sepolia Arbiscan.
5. Inspect the manifest and complete contract registry to verify that the exchange is a deployed protocol graph, not a frontend-only demo.

**One-line story:** Setryn gives future risk its own market, with a fixed expiry, funded execution, complete lifecycle, and verifiable settlement on Arbitrum.
