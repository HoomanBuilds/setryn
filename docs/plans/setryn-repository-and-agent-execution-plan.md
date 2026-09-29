# Setryn Repository and Agent Execution Plan

Date: 2026-09-21
Status: Approved build organization
Repository root: `/home/shreyas/code/work/arbitrum-openhouse`

## 1. Decision

Setryn is one product and one repository, but it is not one application folder. Contracts, user interfaces, autonomous services, shared protocol libraries, deployment evidence, and infrastructure have different security boundaries and release cycles. They must remain visibly separate while sharing canonical schemas and one integration discipline.

The repository starts core-first:

1. Canonical protocol schemas, identifiers, financial rules, and test vectors.
2. Foundry contracts, unit tests, fuzz tests, invariants, deployment scripts, and fork tests.
3. Generated ABIs, internal typed contract bindings, indexer projections, and application service interfaces.
4. Execution, risk, lifecycle, maker, privacy, and receipt services.
5. The complete user exchange and professional operating surfaces.
6. Sepolia deployment, soak testing, security review, and mainnet rehearsal.
7. Public API, external SDKs, webhooks, widgets, and partner tooling after the first-party platform is operating.

The web application may establish its build system and design foundation immediately, but it must not invent protocol behavior ahead of canonical schemas and contract interfaces.

## 2. Lessons applied from the reference repositories

The Orcus repository proves the value of separating EVM contracts, an autonomous agent, a web client, chain-specific code, and media assets. The Agentic Payment Infrastructure repository proves the value of separating user applications, contract workspaces, circuits, reusable cores, deployment manifests, and fixtures.

Setryn adopts the structural strengths without copying either project's product architecture:

- contracts stay independently buildable and testable;
- browser code never owns settlement truth;
- autonomous workers are separate deployable processes;
- reusable client logic does not live inside pages or API routes;
- network configuration is manifest-driven;
- cryptographic and financial fixtures are versioned independently of UI fixtures;
- generated artifacts have one source and one documented generation command;
- local research and cloned inspiration never become runtime configuration.

## 3. Technical baseline

### Root workspace

- pnpm workspace with one root lockfile for all TypeScript applications, services, and packages;
- root scripts coordinate linting, type checking, builds, and contract commands;
- strict TypeScript across authored TypeScript code;
- no Turborepo or other task orchestrator until the workspace has enough packages to justify it;
- environment values validated per deployable process, with committed `.env.example` files and no committed secrets.

### Contracts

- Solidity and Foundry using the official `forge init` project structure;
- every Foundry dependency command runs from `contracts/`, and staged submodule paths must begin with `contracts/lib/`;
- pinned Solidity compiler and EVM target compatible with Arbitrum;
- OpenZeppelin dependencies pinned to reviewed releases;
- unit, fuzz, invariant, state-machine, integration, and pinned Arbitrum One fork suites;
- deployment scripts default to simulation and require an explicit broadcast flag;
- Arbitrum One broadcast remains prohibited until the launch gate is approved.

### Web

- TypeScript;
- React;
- Next.js App Router;
- Tailwind CSS;
- ESLint;
- `src/` application layout;
- viem and wagmi when wallet and contract integration begins;
- TanStack Query for remote and chain-derived server state when needed;
- protocol access through `@setryn/sdk`, not page-local ABI calls.

### Services and data

- TypeScript services by default so protocol schemas can be shared without translation drift;
- PostgreSQL for indexed and operational projections;
- Redis only for expiring reservations, queues, rate limits, and coordination that can be reconstructed;
- chain events and signed messages remain authoritative over database projections;
- every write path is idempotent and keyed by a canonical operation identifier;
- service boundaries are deployable independently even when local development starts them together.

## 4. Canonical repository layout

```text
arbitrum-openhouse/
  apps/
    web/                    # User exchange and professional workstations
  contracts/                # Standalone Foundry workspace
    src/
      registry/
      collateral/
      clearing/
      execution/
      instruments/
      settlement/
      risk/
      privacy/
      adapters/
      interfaces/
      libraries/
    script/
    test/
      unit/
      fuzz/
      invariant/
      integration/
      fork/
      fixtures/
  services/
    api/                    # Authenticated public and partner API
    indexer/                # Deterministic event projection and reconciliation
    execution/              # Book, RFQ, stream, auction, and solver coordination
    risk/                   # Pre-trade and portfolio scenario engine
    lifecycle/              # Keeper, fixing, settlement, recovery, oracle delivery
    maker/                  # Reference market-maker and quote automation
    privacy/                # Encrypted RFQ and sealed-auction transport
    receipts/               # Evidence assembly and deterministic replay
  packages/
    schemas/                # Canonical IDs, messages, events, JSON schema, EIP-712
    sdk/                    # Public typed protocol client, created after the user platform
    client-core/            # Shared wallet, order, quote, and lifecycle workflows
    market-spec/            # Instrument and benchmark specifications
    financial-math/         # Deterministic offchain math and contract test vectors
    database/               # Schema and migrations for projections
    config/                 # Non-secret environment and network parsing
    ui/                     # Product-specific reusable terminal components
    testkit/                # Factories, fixtures, simulators, and conformance tools
  deployments/
    local/
    arbitrum-sepolia/
    arbitrum-one/
  infra/                    # Containers, local stack, monitoring, and deploy definitions
  scripts/                  # Repository-level generation and verification commands
  docs/                     # Local-only plans, specs, research, and operations
  inspiration/              # Local-only cloned reference products
```

Directories are created when their first real consumer is assigned. Empty architecture theater is avoided, but the boundary names above are reserved and agents cannot invent competing locations.

## 5. Dependency direction

The allowed dependency direction is:

```text
contracts and canonical specs
  -> generated ABIs, schemas, financial test vectors, and internal client bindings
  -> client core, indexer, execution, risk, and lifecycle services
  -> web, maker cockpit, and operations console
  -> public SDK and partner integrations after the first-party platform
```

Rules:

1. `contracts/` imports only Solidity dependencies.
2. `packages/schemas` cannot import an application or service.
3. `packages/financial-math` must pass shared vectors derived from the contract specification.
4. Internal generated bindings consume canonical ABIs and schemas for the first-party platform. The later `packages/sdk` public product consumes the same sources and does not scrape deployment files at runtime.
5. Applications import packages. Packages never import applications.
6. Services communicate through versioned messages and APIs, not another service's database tables.
7. The indexer is a projection, not the source of truth for balances, fills, positions, or settlement.
8. `docs/` and `inspiration/` are never imported, bundled, parsed, or required at runtime.
9. Modules depend on canonical typed IDs and declared interfaces, never on a hardcoded asset, symbol, address, oracle vendor, calendar, venue, or market list. Dependency edges resolve through registries and adapters so a new definition or implementation can be added without editing or redeploying unrelated modules.

### Extensibility invariant

Setryn stays open to new assets, token bindings, calendars, sessions, benchmarks, oracle adapters, venue adapters, market specifications, payoff modules, collateral types, execution modes, and risk domains at any time, without weakening security and without mutating historical economics. Every lane in this plan inherits the following rules:

1. No hardcoded market universe, symbol list, contract address, oracle vendor, calendar name, venue list, or fixed asset-count assumption in core logic.
2. Canonical typed IDs and interface boundaries connect modules.
3. New definitions and implementations enter through append-only versioned registries or registered adapters.
4. Registration is permissioned or permissionless as specified per registry, and registration never grants risk authority.
5. Qualification and activation are separate, fail-closed gates, with dependency identity and codehash, capability, evidence, caps, and risk-domain checks where applicable.
6. Old versions stay resolvable for balances, withdrawals, positions, fixing, settlement, recovery, receipts, audit, and replay. No upgrade silently changes existing economics.
7. Unsupported capability combinations fail closed. Adding one module must not require redeploying unrelated modules.
8. Per-market and per-risk-domain parameters are versioned records, not global constants.
9. Enumerability comes from events and indexers, not unbounded onchain arrays.
10. Extension interfaces do not allow arbitrary delegatecall and cannot bypass custody, solvency, authorization, replay, oracle, session, settlement, or pause rules.
11. Mainnet activation remains separately approved even when the implementation exists and is qualified on testnet.

The full statement of this invariant lives in the mainnet-equivalent build plan. Where a lane-level note and this invariant disagree, the invariant wins.

## 6. Contract decomposition

The first contract handovers follow economic responsibility rather than one giant exchange contract:

1. **Protocol types and libraries**
   - canonical IDs, enums, fixed-point rules, EIP-712 hashes, errors, and events;
   - bounded arithmetic and rounding test vectors.
2. **Registry and qualification**
   - assets, benchmarks, calendars, sessions, adapters, market specifications, versions, and activation gates.
3. **Collateral and reservations**
   - USDC custody, subaccounts, deposits, withdrawals, reserved balances, fees, insurance, and conservation invariants.
4. **Execution**
   - maker quotes, nonces, capacity reservations, public orders, RFQs, auctions, batches, packages, and deterministic fills.
5. **Positions and instruments**
   - instrument compilation, bounded payoff, position creation, transfer, split, merge, amendment, novation, roll, and unwind.
6. **Benchmark and settlement**
   - oracle evidence, fixing windows, disruption policy, exercise, cash settlement, and terminal outcomes.
7. **Risk and default**
   - risk domains, caps, portfolio checks, netting, compression, default auctions, insurance, pause scopes, and recovery.
8. **Privacy commitments**
   - encrypted envelope commitments, commit and reveal, selective disclosure hooks, and proof-verifier interfaces.

No agent receives all eight areas in one handover. Shared types and event signatures are reviewed before dependent lanes begin.

## 7. Agent ownership lanes

The primary agent is the architecture, specification, and integration owner. It keeps the canonical plan, freezes interfaces, issues handovers, integrates returned work, resolves conflicts, and runs review and cross-lane verification at the applicable phase gate.

Implementation lanes are:

| Lane | Primary write scope | Must not change without approval |
| --- | --- | --- |
| Protocol schemas | `packages/schemas`, schema generation scripts | Contract behavior, UI implementation |
| Financial math | `packages/financial-math`, contract math libraries and vectors when assigned | Product scope, unrelated contracts |
| Contracts | Assigned subtree under `contracts/src` and matching tests | Other contract modules, web, service APIs |
| Indexing and data | `services/indexer`, `packages/database` | Contract event signatures |
| Execution services | `services/execution` | Contract fill semantics, risk rules |
| Risk services | `services/risk` | Onchain margin semantics, UI |
| Lifecycle services | `services/lifecycle` | Instrument payoff or settlement semantics |
| Maker system | `services/maker`, assigned maker UI routes | User exchange flows |
| Web product | `apps/web`, `packages/ui`, `packages/client-core` when assigned | Canonical schemas and contract behavior |
| SDK | `packages/sdk` and generators | Handwritten copies of ABI or events |
| Quality and operations | integration tests, `infra`, root scripts, deployment verification | Feature semantics without an issue and approval |

An agent may read across the repository but writes only inside its declared scope. Cross-cutting changes return to the primary agent for integration.

## 8. Required handover format

Every implementation handover will contain:

1. **Objective**: one concrete outcome.
2. **Context**: translated product behavior, not private research provenance.
3. **Required reads**: exact canonical files needed for the task.
4. **Write scope**: directories and files the agent owns.
5. **Frozen interfaces**: schemas, events, function signatures, and invariants it must preserve.
6. **Behavioral requirements**: normal paths, boundaries, and failure outcomes.
7. **Security constraints**: authorization, replay, accounting, oracle, and reentrancy rules that apply.
8. **Acceptance criteria**: observable results, not subjective completion claims.
9. **Verification commands**: the checks reserved for the applicable phase gate, plus any narrowly required security-critical slice check.
10. **Return report**: changed files, checks run when specifically required, assumptions, unresolved risks, and commit hash.
11. **Extensibility proof**: an explicit statement of how the slice supports adding new assets, token bindings, calendars, sessions, benchmarks, oracle or venue adapters, market specifications, payoff modules, collateral types, execution modes, and risk domains without weakening qualification. The proof must name the typed IDs and interfaces used, the registry or adapter path a new entry takes, the fail-closed behavior for unsupported combinations, and how prior versions stay resolvable. A handover without this proof is not accepted.

12. **Verification plan**: the proportional checks selected for this slice under section 9, and, when stronger verification is required, the named reason.

Agents do not receive instructions such as "build the exchange". They receive bounded modules with explicit contracts and executable acceptance checks. The primary agent accumulates these slices and reviews the integrated phase once its deliverables are complete.

## 9. Interface and integration policy

### Proportional verification

Verification effort is scaled to the risk of the slice, not applied uniformly.

For an ordinary bounded contract slice:

- focused unit tests covering the custom behavior the slice introduces;
- a small number of fuzz properties for numeric and state boundaries;
- formatting, and compile plus contract size checks;
- related failure cases consolidated into looped or table-style tests, rather than one test per trivial field;
- no tests over OpenZeppelin or other audited dependency internals;
- no invariant, fork, integration, coverage, full CI, or full repository suite run per ordinary slice unless the change specifically requires it.

Broad repository checks run after a coherent group of dependent slices, not after each slice. Invariant and fork suites run at the explicit milestone gates defined in the build plan. Once a broad check passes, it is never rerun merely to capture cleaner output.

Standard access control, cryptography, Merkle proofs, token interfaces and transfers, and common primitives use pinned audited libraries. A custom implementation requires a project-specific semantic reason stated in the handover.

Security-critical accounting, custody, settlement, and permission changes may justify stronger verification, including invariant or fork runs inside the slice. The handover must name why that slice is security-critical; unnamed escalation is not accepted.

This policy sets the default level of effort. It does not weaken or replace the milestone gates, qualification gates, or launch gates defined in the build plan.


### Before parallel implementation

- freeze canonical identifiers and message versioning;
- define the first event catalog;
- define monetary units, decimals, signedness, and rounding direction;
- define chain and environment identifiers;
- define deployment manifest schema;
- publish shared conformance fixtures.

### While agents work

- no duplicate type definitions across packages;
- no handwritten ABI fragments when generation is available;
- no database state that cannot be reconciled to a signed message or chain event;
- no UI mock that silently becomes production state;
- no network-specific branch inside core financial logic;
- no hardcoded asset, symbol, address, oracle vendor, calendar, venue, or asset-count assumption in core logic;
- no mainnet write or broadcast command.

### On return

- integrate bounded slices without repeating a primary-agent review after each one;
- record interface changes before issuing dependent handovers;
- regenerate artifacts once from the canonical source at the phase gate;
- review the integrated phase and run its affected checks at the phase gate;
- reject phase-complete claims when failure paths are absent;
- reject phase returns whose extensibility proof is missing, or whose implementation closes the system to future assets, adapters, markets, or risk domains.

## 10. Git and commit policy

- the repository root is `/home/shreyas/code/work/arbitrum-openhouse`;
- `docs/`, `inspiration/`, secrets, local deployments, build outputs, caches, and editor state are ignored;
- `deployments/arbitrum-sepolia` and `deployments/arbitrum-one` are tracked evidence, while `deployments/local` is not;
- commits use one-line conventional prefixes such as `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, and `chore:`;
- agents commit only their assigned logical unit;
- no AI attribution appears in commits;
- generated files are committed only when required by consumers and paired with their source and generation command;
- every staged diff is checked for secrets before commit.

## 11. Bootstrap sequence

1. Update the canonical documentation with this repository and ownership model.
2. Create the root `.gitignore` before initializing or staging Git.
3. Initialize the Git repository on branch `main`.
4. Create the root pnpm workspace and standard repository scripts.
5. Initialize `contracts/` with the official Foundry command and no sample counter contract.
6. Configure the pinned compiler, formatting, fuzz, invariant, Arbitrum Sepolia, and Arbitrum One profiles without credentials.
7. Create `apps/web/` with the official Next.js scaffold using TypeScript, React, App Router, `src/`, ESLint, and Tailwind CSS.
8. Install dependencies once from the repository root and preserve one pnpm lockfile.
9. Replace generated marketing content with a minimal Setryn development shell, not the final product interface.
10. Verify Foundry build and tests, web lint, web type check, and web production build.
11. Commit the repository foundation as logical commits.
12. Issue the first core handovers for canonical schemas and collateral or registry contract foundations.

## 12. Initial completion gate

Setup is complete only when:

- Git reports the intended root and branch;
- ignored local research, inspiration clones, and `.env` do not appear in tracked files;
- the root package manager installs from one lockfile;
- `contracts/` builds and its baseline tests run;
- `apps/web/` lints, type checks, and builds;
- root commands reproduce those checks;
- no secret, deployer key, API key, or authenticated RPC URL is committed;
- no mainnet transaction has been signed or broadcast;
- the next implementation lanes can be handed over without sharing write ownership.

## 13. Bootstrap record

Completed on 2026-09-21:

- Git repository initialized on `main` at the intended root;
- repository initialization committed as `e3badfd`;
- Foundry workspace committed as `3160b9f`;
- web and pnpm workspace committed as `b2336ca`;
- Foundry 1.5.1 stable with Solidity 0.8.37 and Cancun EVM target;
- forge-std 1.16.2 and OpenZeppelin Contracts 5.7.0 pinned under `contracts/lib/`;
- Node.js 22 baseline, pnpm 11.24.0, Next.js 16.3.5, React 19.2.8, and Tailwind CSS 4;
- root `pnpm check` passes lint, type checking, production build, Foundry formatting, contract build, and contract tests;
- `.env`, `docs/`, `inspiration/`, local deployment output, dependencies, and build artifacts remain ignored;
- no network write, signature, deployment, or mainnet expenditure occurred.
