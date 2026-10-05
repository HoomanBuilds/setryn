# Setryn services

Setryn's persistent services project onchain events, ingest reference history, operate routine protocol transitions, enforce organization policy, and deliver signed webhooks. They support the exchange but do not replace contract enforcement or wallet consent.

The web application can run on Vercel. Long-running ingestion, indexing, operator, and delivery processes belong on a persistent host with PostgreSQL.

## Service map

| Package | Responsibility | Writes onchain |
| --- | --- | --- |
| `@setryn/application-data` | Contract-backed read model and projection adapter used by product surfaces | No |
| `@setryn/indexer` | Canonical event decoding, normalization, reduction, replay, and projections | No |
| `@setryn/market-data-ingester` | Resumable Chainlink reference rounds, Setryn fills, positions, and derived candles in PostgreSQL | No |
| `@setryn/operator-runtime` | Maker, solver, keeper, oracle, fixing, settlement, reconciliation, and health policies | Only for explicitly configured operator actions |
| `@setryn/organization-control` | Organization accounts, approvals, policy checks, and accounting allocation | No direct chain writes |
| `@setryn/webhooks` | Subscription state, signed delivery, retries, event cursors, and test receiver | No |

## Production topology

```text
Arbitrum Sepolia RPC
        |
        +-> indexer -------------------+
        |                              |
        +-> market-data ingester ------+-> PostgreSQL
        |                              |       |
        +-> operator runtime           |       +-> web API and terminal
                                       |       +-> webhook worker
Chainlink reference RPC ---------------+

Wallet -> Vercel web/API -> contracts
Operator roles -> persistent worker -> contracts
```

PostgreSQL is a projection and operational store. Contracts remain authoritative for balances, orders, fills, positions, fees, fixing, and settlement. A database restart or replay must not create chain state or change an economic outcome.

## Persistence

The schema migrations under `supabase/migrations/` are portable PostgreSQL migrations. They are not coupled to Supabase hosting.

| Migration | Data |
| --- | --- |
| `20261001000100_runtime_documents.sql` | Runtime documents, API keys, organizations, partners, webhooks, and operational records |
| `20261003000100_market_data.sql` | Reference rounds, fills, candles, and resumable ingestion cursors |

Use `SETRYN_DATABASE_URL` for the selected PostgreSQL host and `SETRYN_DATABASE_POOL_SIZE` to bound each process. Non-loopback production database connections should use TLS. Do not point local development and the public release candidate at the same mutable schema.

## Application data

`services/application-data` exposes a contract-reader boundary and projection sources for the first-party application. Its adapters distinguish:

- local fixtures used by an isolated devnet;
- Arbitrum Sepolia contract reads;
- projected indexed data;
- write policies that refuse unsupported or unsafe environments.

The service cannot promote a modeled or indexed value into authoritative chain state.

## Indexer

`services/indexer` converts deployment events into deterministic product projections.

The indexer:

- defines every state-changing event explicitly;
- canonicalizes Solidity enums rather than leaking decoder-specific values;
- normalizes identifiers, quantities, prices, fees, and timestamps;
- reduces events into orders, fills, positions, settlement, and receipt projections;
- supports replay from fixtures and persisted cursors;
- keeps block identity so reorg handling can distinguish replaced observations.

Run its focused checks from the repository root:

```bash
pnpm --filter @setryn/indexer typecheck
pnpm --filter @setryn/indexer test
pnpm indexer:replay
```

## Market-data ingester

`services/market-data-ingester` maintains the continuous data needed by charts and market workspaces:

- qualified Chainlink reference rounds from read-only Arbitrum One RPC;
- Setryn fills and position events from the active deployment;
- expiry-specific derived marks and interval candles;
- trade count and volume derived only from real fills;
- resumable cursors for every ingestion stream.

It persists source inputs rather than treating maker quote snapshots as historical truth. A chart can therefore rebuild marks from versioned methodology and reference rounds, while real trade markers remain tied to chain fills.

Commands:

```bash
pnpm --filter @setryn/market-data-ingester typecheck
pnpm --filter @setryn/market-data-ingester test
pnpm market-data:ingest -- --environment arbitrum-sepolia
```

The systemd examples under `deploy/systemd/` run the ingester continuously and check freshness separately. They are templates; host paths, database topology, and secrets must be configured for the actual deployment.

## Operator runtime

`services/operator-runtime` is a policy-driven worker, not a privileged replacement for protocol rules. Its adapters cover:

- deployment and runtime loading;
- public-book and firm-maker operations;
- solver and route operations;
- fee and series reads;
- fixing observation submission;
- keeper progression for sessions, expiry, settlement, and reservation release;
- payload construction, result classification, health, and reconciliation.

The operator can advance permitted transitions, but contracts revalidate every economic dependency and authorization. Historical terminal resolution cannot depend solely on this worker remaining online.

Run a configured sweep:

```bash
pnpm --filter @setryn/operator-runtime worker --environment arbitrum-sepolia --sweep true
```

Run the local smoke path only against an isolated Anvil deployment:

```bash
pnpm --filter @setryn/operator-runtime smoke:local
```

Never use local smoke credentials or unlock behavior against a public network.

## Organization control

`services/organization-control` models organization accounts above the wallet and collateral-account layer:

- approval policies;
- accounting allocation;
- repository-backed organization records;
- pre-action policy checks;
- environment-aware write policy.

It cannot override contract account ownership, collateral, signatures, risk admission, or settlement rules.

## Webhooks

`services/webhooks` delivers signed protocol events to subscribed external applications.

Delivery includes:

- stored subscription and event cursors;
- HMAC signatures over the exact payload;
- attempt, response, and retry state;
- replay-safe event identifiers;
- secret rotation without disclosing existing secrets;
- a local receiver for integration testing.

Commands:

```bash
pnpm --filter @setryn/webhooks typecheck
pnpm --filter @setryn/webhooks worker
pnpm --filter @setryn/webhooks receiver
pnpm --filter @setryn/webhooks cli -- --help
```

## Environment boundaries

Common server variables:

| Variable | Purpose |
| --- | --- |
| `SETRYN_NETWORK` or `SETRYN_OPERATOR_ENVIRONMENT` | Selects local, Sepolia, or another explicitly supported runtime |
| `SETRYN_RUNTIME_PATH` | Overrides the committed deployment runtime path |
| `SETRYN_RPC_URL` | Active deployment RPC |
| `SETRYN_REFERENCE_RPC_URL` | Read-only reference-market RPC |
| `SETRYN_DATABASE_URL` | Persistent PostgreSQL connection |
| `SETRYN_DATABASE_POOL_SIZE` | Per-process connection limit |
| `SETRYN_WEBHOOKS_DIR` | Local-only webhook store fallback |

Operator and oracle private keys are required only by processes that perform those specific roles. Keep roles separated in production, lock down their files, and never expose them to the browser or logs.

## Operating rules

- No worker may silently switch networks or runtimes.
- Every transaction must be attributable to a configured role and explicit policy.
- Separate signing lanes must not share an unmanaged nonce stream.
- Restarts resume from chain state and persisted cursors, not from assumptions about the previous process.
- An unknown transaction outcome is reconciled before retrying.
- A stale reference or failed dependency makes affected data unavailable or degraded; it must not be presented as fresh.
- No service may write to Arbitrum One until the user explicitly authorizes mainnet work.
