# Setryn web

The Setryn web application contains the public landing experience, the fixed-expiry exchange, professional operating workspaces, API v1, and embedded partner surfaces.

Production: [setryn.vercel.app](https://setryn.vercel.app)

## Product boundary

The application is the first-party client for the Setryn protocol. It does not invent fills, balances, fees, positions, or settlement state. Executable values come from the selected runtime, deployed contracts, signed maker quotes, or indexed chain events. Modeled marks and scenario values are labelled separately from executable prices and final fixing values.

The current release activates 15 Arbitrum Sepolia capped dated-forward markets. The same application also contains the product surfaces for private RFQs, auctions, strategies, lifecycle, maker operations, solver operations, treasury, evidence, public integrations, and organization controls.

## Application structure

The app uses separate root layouts so the landing experience cannot leak its fonts, sound, scrolling, or visual state into the professional terminal.

| Route group | Responsibility |
| --- | --- |
| `src/app/(landing)/` | Public landing at `/`, splash sequence, product story, and entry into the exchange |
| `src/app/(platform)/` | Exchange shell, wallets, market context, account context, transaction state, and product workspaces |
| `src/app/(embed)/` | Framed partner widgets under `/embed/*` |
| `src/app/api/v1/` | Versioned public API and OpenAPI 3.1 document |
| `src/app/api/internal/` | First-party gateway, operator, quote, funding, and environment-specific handlers |
| `src/app/global-not-found.tsx` | Platform-styled terminal 404 |

Moving between the landing and platform is a full document navigation. The landing enters the product through `src/lib/landing/app-links.ts`.

## User surfaces

### Trading and discovery

| Route | Surface |
| --- | --- |
| `/trade/[market]` | Professional market terminal with synchronized chart, order book, trades, ticket, routes, positions, orders, and execution timeline |
| `/markets` | Search, filters, expiry ladder, term structure, depth, qualification, and liquidity state |
| `/protect`, `/protect/new` | Outcome-first dated-exposure and hedge workflow |
| `/strategies`, `/strategies/new` | Strategy discovery and typed multi-leg construction |
| `/rfqs`, `/rfqs/new`, `/rfqs/[id]` | Private request, quote comparison, selection, and settlement |
| `/auctions` | Sealed and scheduled auction workflows |

### Account, lifecycle, and evidence

| Route | Surface |
| --- | --- |
| `/portfolio` | Equity, collateral, PnL, positions, and account state |
| `/portfolio/collateral` | Deposit, withdraw, reservations, and available collateral |
| `/portfolio/positions`, `/positions/[id]` | Position detail, payoff, risk, counterparties, and lifecycle actions |
| `/portfolio/risk` | Concentration, scenario, dependency, and liquidation-risk views |
| `/lifecycle` | Fixing, expiry, roll, unwind, recovery, and required actions |
| `/settlements` | Settlement calendar, fixing windows, and terminal progression |
| `/activity` | Orders, fills, RFQs, collateral actions, and protocol events |
| `/receipts`, `/receipts/[id]` | Verifiable execution, fee, fixing, lifecycle, and settlement evidence |
| `/alerts` | Account and market alerts |

### Professional and protocol operations

| Route | Surface |
| --- | --- |
| `/maker` | Quote surfaces, capacity, inventory, fills, limits, and maker controls |
| `/solver` | Route construction, obligations, execution, and recovery |
| `/operations`, `/ops` | Operator health, dependencies, jobs, and reconciliation |
| `/treasury` | Protocol fees, vault state, and versioned fee administration |
| `/status` | Chain, RPC, database, service, and deployment status |
| `/developers` | API keys, OpenAPI, examples, and developer access, release-gated in production |
| `/partners` | Widgets, attribution, webhooks, and partner configuration, release-gated in production |
| `/settings` | User terminal and account preferences |

## Terminal data model

Every market workspace is built around one synchronized series context:

- expiry-specific mark history and candles;
- a separately labelled Chainlink reference overlay;
- public resting orders and capacity-backed maker quotes as distinct sources;
- real fills as trade markers and volume;
- floor, cap, expiry, fixing, and settlement boundaries;
- available collateral, required collateral, fee cap, and route state;
- a durable transaction timeline from signature through clearing or failure.

The preview feed must stay coherent. Marks, maker quotes, book midpoints, ticket estimates, and charts cannot use contradictory snapshots. The mark methodology is versioned in [`docs/specs/setryn-mark-methodology.md`](../../docs/specs/setryn-mark-methodology.md).

### Data classifications

| Classification | Meaning |
| --- | --- |
| Observed | A chain event, contract read, or qualified external reference |
| Executable | A resting order or signed firm quote that can be submitted under its stated constraints |
| Estimated | A deterministic preview based on current executable state, such as fees or collateral |
| Modeled | A valuation or scenario result that is not itself an executable quote or final fixing |

The interface never merges indicative liquidity into executable depth and never labels a transaction complete while its outcome remains unknown or recovery is unfinished.

## Wallet and transaction flow

Wallet connection uses wagmi, viem, TanStack Query, and RainbowKit. Browser wallets discovered through EIP-6963, Coinbase Wallet, and Safe are always available. WalletConnect appears when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is configured.

`WalletBridge` provides the connected EIP-1193 wallet to the internal gateway. Signatures and user-owned transactions stay in the wallet. Server-held operator, maker, oracle, and optional relayer keys are separate roles and never substitute for user consent.

The transaction UX uses explicit states:

```text
review -> sign -> submit -> included -> clearing -> confirmed
                    |                       |
                    +-> failed              +-> recovery or reconciliation
```

Firm quote execution uses two EIP-712 signatures from the trader and one atomic `QuoteSettlementRouter.settle` call. A configured relayer may submit the transaction, but the signed constraints and onchain checks are identical if any other caller submits it. New accounts can require one-time contract approvals before their first trade.

## Public API

API v1 is implemented under `src/app/api/v1/`. The hosted OpenAPI document is public at [setryn.vercel.app/api/v1/openapi.json](https://setryn.vercel.app/api/v1/openapi.json).

Endpoint families include:

- system status and OpenAPI;
- markets, books, and trades;
- accounts and positions;
- orders, preparation, submission, lookup, and cancellation;
- fills and receipts;
- full position exits;
- private RFQ preparation, quotes, acceptance, settlement, and cancellation;
- API-key lifecycle;
- partner deployments, attribution, usage, and modeled revenue;
- webhook subscriptions, events, delivery inspection, testing, and secret rotation.

Authenticated requests use bearer API keys. Writes additionally use timestamped, nonce-protected HMAC request signatures. Public integration behavior and client examples live in [`packages/sdk/README.md`](../../packages/sdk/README.md).

The OpenAPI document can be public while key issuance and partner administration remain controlled-release surfaces.

## Internal application boundaries

| Area | Location |
| --- | --- |
| Wallets and network configuration | `src/components/wallet/`, `src/lib/wallet/` |
| Trading terminal | `src/components/terminal/`, `src/lib/terminal/` |
| Contract gateway and reads | `src/lib/internal-gateway/` and generated bindings from `packages/internal-contracts/` |
| Market data and marks | `src/lib/market-data/`, `src/lib/pricing/` |
| Public API | `src/lib/public-api/`, `src/app/api/v1/` |
| Webhooks and partners | `src/lib/webhooks/`, `src/components/partners/` |
| Landing | `src/components/landing/`, `src/lib/landing/` |
| Shared generated market catalog | `src/lib/terminal/catalog.generated.json`, synchronized by `scripts/sync-market-catalog.mjs` |

Pages must not duplicate protocol rules. Canonical types and contracts belong in shared packages; chain projections belong in services; UI components consume those boundaries.

## Runtime and environments

The selected deployment runtime is read from `deployments/<environment>/runtime.json`.

| Environment | Use |
| --- | --- |
| `local` | Anvil development, mintable test collateral, local operator and maker |
| `arbitrum-sepolia` | Public release candidate and judge testing |
| `arbitrum-one-fork` | Pinned qualification against read-only mainnet state |
| `arbitrum-one` | Production target, writes disabled until explicitly authorized |

The current Sepolia runtime uses schema 11. Fee, market, series, collateral, fixing, and route behavior is read from the runtime and contracts, not copied into page constants.

### Environment variables

Start from `.env.example` or `.env.arbitrum-sepolia.example`. The main groups are:

- `SETRYN_NETWORK`, `SETRYN_RUNTIME_PATH`, and RPC URLs;
- server-only operator, maker, relayer, and oracle keys;
- `SETRYN_DATABASE_URL` for persistent API, chart, fill, and webhook state;
- `SETRYN_PUBLIC_ORIGIN` for canonical API and link generation;
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for mobile wallet discovery;
- local-only filesystem stores and local key-console switches.

Never expose a server key through a `NEXT_PUBLIC_*` variable. Never use a mainnet private key in the web environment.

## Commands

Run from the repository root:

```bash
pnpm dev
pnpm --filter @setryn/web lint
pnpm --filter @setryn/web typecheck
pnpm --filter @setryn/web build
```

Focused tests for the web-owned financial and transport surfaces:

```bash
pnpm --filter @setryn/web test:quotes
pnpm --filter @setryn/web test:maker
pnpm --filter @setryn/web test:mark
pnpm --filter @setryn/web test:rpc
```

The `predev` and `prebuild` hooks synchronize the generated market catalog before Next.js starts.

## Local development

From the repository root:

```bash
pnpm install
bash scripts/local-deploy-reset.sh
pnpm dev
```

The reset starts Anvil at `127.0.0.1:8545`, deploys the complete protocol graph, creates test collateral, bootstraps 15 markets, and writes the local runtime. Open [http://localhost:3000](http://localhost:3000).

Local-only devnet handlers refuse public chains and non-loopback use. Do not weaken those guards to make a demo easier.

## Production deployment

The web application is deployable as a Next.js service on Vercel. Persistent indexing, market ingestion, operator tasks, and webhook delivery run as separate services with PostgreSQL. See [`services/README.md`](../../services/README.md).

Production requirements:

- point the app at a committed runtime for exactly one environment;
- provide server and browser RPCs with fallbacks;
- provide durable PostgreSQL storage;
- keep all private roles server-only and separated;
- configure the canonical public origin;
- publish the runtime and market artifacts used by the deployment;
- never enable Arbitrum One writes without explicit authorization and the launch gate.

## Visual and interaction standard

Setryn uses a restrained professional workstation: neutral near-black surfaces, thin borders, compact information hierarchy, tabular market numbers, one brand accent, and semantic green or red only for market direction and state. Controls must be real, data provenance must be inspectable, and disabled actions must explain the missing condition.

The interface specification, including desktop, mobile, maker, lifecycle, evidence, and state UX, is in [`docs/specs/setryn-interface-spec.md`](../../docs/specs/setryn-interface-spec.md).
