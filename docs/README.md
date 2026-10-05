# Setryn documentation

Setryn is the fixed-expiry exchange on Arbitrum. This directory separates current product and protocol requirements from implementation plans, operating runbooks, and historical research.

> Risk has a date. Trade it.

Start with the [repository README](../README.md) for the product, live deployment, architecture, contracts, revenue model, API, SDK, and local setup. Use the indexes below when implementing or reviewing a specific system.

## Product definition

| Document | Purpose |
| --- | --- |
| [Project summary](specs/setryn-project-summary.md) | Concise product, user, market, and protocol definition |
| [Product and phase overview](plans/setryn-product-and-phase-overview.md) | Complete feature map and phased delivery state |
| [Market, instrument, and economic rules](specs/setryn-market-instrument-and-economic-rules.md) | Series economics, bounded payoff, fixing, collateral, and settlement rules |
| [Interface specification](specs/setryn-interface-spec.md) | Terminal, markets, portfolio, maker, lifecycle, evidence, and mobile behavior |
| [Brand and product naming](specs/setryn-brand-naming.md) | Setryn name, product language, and positioning |
| [Unit economics and revenue status](research/setryn-unit-economics-2026-09-30.md) | Implemented fees, revenue boundaries, and economic assumptions |

## Protocol specification

| Document | Purpose |
| --- | --- |
| [Threat model and invariants](specs/setryn-threat-model-and-invariants.md) | Trust boundaries, value-moving invariants, and failure requirements |
| [Roles and state machines](specs/setryn-roles-and-state-machines.md) | Authority, lifecycle, clearing, fixing, settlement, and recovery transitions |
| [Numeric conventions](specs/setryn-numeric-conventions.md) | Units, precision, rounding, signed values, and display boundaries |
| [Mark methodology](specs/setryn-mark-methodology.md) | Expiry-specific model, reference inputs, candles, and chart semantics |
| [Adapter registry](specs/setryn-adapter-registry.md) | Adapter identity, qualification, versioning, and activation |
| [Calendar registry](specs/setryn-calendar-registry.md) | Trading days, holidays, and calendar versioning |
| [Session registry](specs/setryn-session-registry.md) | Trading windows, fixing windows, and session rules |
| [Settlement asset qualification](specs/setryn-settlement-asset-qualification.md) | Collateral asset admission and environment constraints |

## Build and release plans

| Document | Purpose |
| --- | --- |
| [Mainnet-equivalent build plan](plans/setryn-mainnet-equivalent-build-plan.md) | Complete exchange architecture and release sequence |
| [Repository execution plan](plans/setryn-repository-and-agent-execution-plan.md) | Workspace boundaries, phase gates, ownership, and delivery order |
| [Network runtime and real data](plans/network-runtime-real-data.md) | Runtime selection, live reads, market movement, and environment behavior |
| [Mainnet readiness register](research/setryn-mainnet-readiness-cost-and-dependency-register-2026-09-21.md) | Dependencies, costs, launch gates, and unresolved production work |

Arbitrum One is a read-only production target until an explicit launch authorization. Testnet readiness must never be presented as an audited mainnet deployment.

## Operating runbooks

| Runbook | Covers |
| --- | --- |
| [Network deployment](runbooks/network-deployment.md) | Local rehearsal, Sepolia deployment, bootstrap, evidence, and governance handoff |
| [Firm quotes](runbooks/firm-quotes.md) | Capacity-backed quote generation, streaming, settlement, exit, and failure behavior |
| [Market data](runbooks/market-data.md) | PostgreSQL, reference-round ingestion, fills, candles, freshness, and recovery |
| [Incident response](runbooks/incident-response.md) | Detection, classification, containment, reconciliation, and recovery |

## Code-facing guides

- [Contract architecture and all 88 Sepolia deployments](../contracts/README.md)
- [Web exchange, routes, data semantics, and wallet flow](../apps/web/README.md)
- [Shared packages and public TypeScript SDK](../packages/README.md)
- [Persistent services and operating boundaries](../services/README.md)
- [SDK methods and integration examples](../packages/sdk/README.md)
- [Hosted OpenAPI 3.1 document](https://setryn.vercel.app/api/v1/openapi.json)

## Historical research boundary

Files under `research/` document the opportunity search, competitive analysis, rejected candidates, product selection, and later economic or readiness work. Earlier candidate documents under `specs/` are also retained as project history.

Historical material is not runtime configuration and does not override a current Setryn specification, deployment artifact, contract, or runbook. A historical decision becomes current only when its behavior is incorporated into a canonical specification or production implementation.
