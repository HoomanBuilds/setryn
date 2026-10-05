# Setryn packages

Shared packages keep contract identity, schemas, market data, persistence, and public client behavior consistent across the exchange application and long-running services.

## Package map

| Package | Visibility | Responsibility |
| --- | --- | --- |
| `@setryn/internal-contracts` | Internal | Generated contract ABIs, deployed bytecode identity, and typed binding metadata |
| `@setryn/internal-schemas` | Internal | Canonical network, deployment, event, identifier, and JSON-safe schemas |
| `@setryn/market-data` | Internal | Shared Chainlink round reads, Setryn fill decoding, order-book reads, and stream identities |
| `@setryn/persistence` | Internal | PostgreSQL document state, advisory locks, market history, fills, positions, and ingestion cursors |
| `@setryn/sdk` | Public client | TypeScript API client, EIP-712 signing helpers, order entry, exits, private RFQs, pagination, and structured errors |

## Internal contracts

`@setryn/internal-contracts` is generated from the pinned Foundry artifacts and deployment inventory. It exports:

- canonical ABIs used by web and services;
- contract binding metadata;
- a generated binding hash for drift detection;
- TypeScript types for ABI items and parameters.

Do not hand-edit generated bindings. Regenerate and check them from the repository root:

```bash
pnpm internal:bindings:generate
pnpm internal:bindings:check
```

The binding gate makes a contract change visible to every consumer instead of letting the application silently use an older ABI.

## Internal schemas

`@setryn/internal-schemas` defines cross-package values that need one meaning everywhere:

- supported networks and environment policy;
- deployment and runtime document shapes;
- canonical event envelopes and projection values;
- protocol identifier validation;
- JSON-safe encoding for bigint and binary values.

Schemas are boundaries, not duplicate business logic. Solidity remains authoritative for value-moving rules.

```bash
pnpm --filter @setryn/internal-schemas typecheck
pnpm --filter @setryn/internal-schemas test
```

## Market data

`@setryn/market-data` is the shared read and decoding layer for the terminal and market-data ingester. It includes:

- qualified Chainlink feed addresses for BTC, ETH, ARB, EUR/USD, and XAU/USD on Arbitrum One;
- proxy-phase and round-range reading;
- staleness and gap semantics;
- canonical decoding of Setryn fills and position state;
- public-book reads and deployment stream identities;
- no chain-writing capability.

Sharing this package prevents the chart, quote engine, API, and ingestion worker from interpreting the same round or fill differently.

```bash
pnpm --filter @setryn/market-data typecheck
```

## Persistence

`@setryn/persistence` provides PostgreSQL primitives for serverless and persistent consumers:

- network-scoped JSON documents with transactional updates;
- transaction-scoped advisory locks for single-use or serialized operations;
- append-only Chainlink reference rounds;
- idempotent Setryn fill and position projections;
- resumable stream cursors;
- candle and market-history queries;
- TLS required automatically for non-loopback database hosts.

The package expects migrations under `supabase/migrations/` to be applied to the selected PostgreSQL database. The migration format is portable and does not require Supabase hosting.

```bash
pnpm --filter @setryn/persistence typecheck
```

## Public TypeScript SDK

`@setryn/sdk` is an ESM client for API v1. Its only runtime dependency is viem.

It supports:

- exchange status, markets, books, trades, accounts, orders, fills, positions, and receipts;
- non-custodial public order preparation and submission;
- EIP-712 validation and wallet signing helpers;
- full position exit preparation and submission;
- private RFQ request, quote, selection, settlement, and cancellation;
- authenticated and replay-protected API requests;
- pagination, rate-limit handling, and typed API errors.

Build it from the repository root:

```bash
pnpm --filter @setryn/sdk build
pnpm --filter @setryn/sdk typecheck
```

The full endpoint table and integration examples are in [`sdk/README.md`](sdk/README.md). The hosted OpenAPI 3.1 document is available at [setryn.vercel.app/api/v1/openapi.json](https://setryn.vercel.app/api/v1/openapi.json).

## Dependency rules

- The web app and services may consume shared packages.
- Shared packages must not import application components or route handlers.
- Generated contract bindings come only from pinned contract artifacts.
- Canonical schemas remain transport-neutral.
- Market-data code remains read-only.
- Persistence stores observations and projections, never invented chain state.
- The public SDK never receives or stores a user's private key and never signs without the caller's wallet client.

## Workspace checks

```bash
pnpm internal:typecheck
pnpm internal:test
pnpm --filter @setryn/sdk build
```
