# Setryn Mainnet-Equivalent Build Plan

Date: 2026-09-21
Status: Approved implementation plan
Target production network: Arbitrum One
Public development network: Arbitrum Sepolia
Naming specification: [`../specs/setryn-brand-naming.md`](../specs/setryn-brand-naming.md)
Mainnet readiness register: [`../research/setryn-mainnet-readiness-cost-and-dependency-register-2026-09-21.md`](../research/setryn-mainnet-readiness-cost-and-dependency-register-2026-09-21.md)

## 1. Objective

Build the complete Setryn protocol and application without spending mainnet funds during development. The public Arbitrum Sepolia deployment must demonstrate the same instruments, matching, collateral, risk, lifecycle, privacy, settlement, receipts, and operating surfaces that will run on Arbitrum One.

The testnet is not a reduced demo. It is the mainnet release candidate with test assets, test oracle adapters, lower caps, and test operator keys. If mainnet funding is not available before judging, the Sepolia deployment must still prove exactly how the mainnet system works.

### Current phase status

Status date: 2026-10-02

- Active implementation work: operating and qualifying the live Arbitrum Sepolia release candidate. The first-party application, deployed protocol graph, 15 markets, mintable test collateral, designated-maker path, operator status, and user faucet are live. Remaining work is persistent operator hosting, delayed governance-admin acceptance, complete explorer verification, independent maker and keeper redundancy, and the scripted judge and recovery journeys.
- Phase 0 passed its targeted gate review on 2026-09-25. The canonical economic schema and rules, role and state-machine model, and threat and invariant model are defined in the corresponding Setryn specifications.
- Phase 1 passed its targeted gate review and verification on 2026-09-25. The verified foundation includes canonical TypeScript schemas, internal generated contract bindings, deterministic event projections, guarded deployment manifests and scripts, qualified market, instrument, and series registries, terminal-liability collateral accounting, local fixtures, fork profiles, and collateral-conservation coverage.
- The Phase 1 gate passed contract compilation, generated-binding drift checks, internal typechecks, 3 schema tests, 7 indexer tests, deployment-manifest validation, contract formatting, and 425 contract tests with 0 failures. One pinned Arbitrum One read-only fork case was skipped because no RPC URL or block number was supplied; no network call, deployment, broadcast, or mainnet write occurred.
- Phase 2 source implementation completed on 2026-09-25. The public order path was connected to its production policy gates, risk admission, atomic clearing, and public books on 2026-09-28. The complete graph, including sealed auctions, request-for-stream, batch clearing, collateral-aware routing, and the verifiable receipt ledger, now deploys and produces role evidence on a local chain within production code-size limits.
- Phase 4 passed its targeted gate on 2026-09-29 at pinned Arbitrum One block 509990000.
  - Thirteen oversized contracts were modularized into DELEGATECALL-linked libraries with byte-identical ABIs, and the production profile builds with every runtime at or below 24,576 bytes and every initcode at or below 49,152 bytes.
  - The local deployment rehearsal runs without any code-size override, and the evidence records all 24 linked libraries.
  - The focused pinned fork suite passed 26 of 26 cases, covering the complete journey, the deployment rehearsal, and the control rehearsals.
  - The production manifest validates at the pinned and latest blocks.
  - The complete unsigned intent has 219 operations. Its sequential, L1-aware gas budget comes to a 0.02201017 ETH deployer requirement including the 2x reserve.
  - No mainnet write occurred. Evidence is in `docs/plans/claude-phase-handoff.md` and `deployments/arbitrum-one/qualification/`.
- The Phase 2 verification gate passed on 2026-09-29 with the following evidence:
  - 744/744 contract tests;
  - 23/23 invariants, including the compression-conservation invariant, which now runs through a conservation-preserving handler;
  - the pinned fork suite at 26/26;
  - a local deployment with on-chain role evidence.

  All 35 former contract-test failures were fixed, and no production blockers remain. The fixes include a solver-route capacity lock defect, route-engine griefing authorization, and a terminal-disruption settlement deadlock. The capacity-backed venues and the receipt ledger with all 18 subject authorities are deployed.
- Phase 3 source implementation completed on 2026-09-29. The first-party platform now includes wallet-signed collateral, public-book and private-RFQ execution, firm maker capacity, contract-restored orders, RFQs, fills, positions and receipts, signed full-position exits, portfolio and lifecycle workspaces, strategy and hedge construction, maker and operations workspaces, internal projection and organization services, accounting export, and live local-runtime health. Catalog-only markets and modeled analytics remain explicitly labeled and are not represented as executable evidence.
- The Phase 3 verification gate remains open. It must not be described as verification-passed until the targeted mobile, keyboard, accessibility, wallet rejection, RPC failure, replacement, and complete fresh-wallet journey checks run. Public persistence, public operators, and Arbitrum Sepolia infrastructure are Phase 5 release-candidate work.
- The Phase 5 release candidate is deployed on Arbitrum Sepolia. The live application reads the committed deployment runtime, all seven critical operator health probes pass, designated-maker quotes are executable on the public book, and the web faucet successfully mints 10,000 tUSDC through the deployed token. Phase 5 remains open until its redundancy, soak, explorer-verification, governance-handoff, and journey gates pass.
- Public APIs, external SDKs, webhooks, embedded widgets, and partner tooling are post-user-platform work and do not block the Phase 1 through Phase 7 product gates.
- Primary-agent reviews and broad verification run at phase gates after the phase deliverables are complete, not after individual implementation slices.

## 2. Hard operating rules

1. Do not sign or broadcast an Arbitrum One transaction until the mainnet launch review is approved.
2. Mainnet research uses RPC reads, simulation, tracing, code inspection, a pinned fork, and unsigned transaction construction only.
3. Never place a mainnet deployer, owner, keeper, oracle, maker, or Safe key in the repository, frontend, logs, or shell history.
4. Core protocol contracts must use the same source, compiler settings, ABIs, storage layout, state machines, and economic checks on Sepolia and One.
5. Network differences must live in reviewed deployment manifests and adapters, not in test-only branches inside core settlement logic.
6. Mock contracts must reject deployment or activation on chain ID 42161.
7. Every externally supplied address must be verified against official documentation, checked with `eth_getCode`, and pinned with a code hash in the deployment manifest.
8. Every market must remain disabled until its collateral, benchmark, session, payoff, cap, and disruption configuration passes qualification.
9. Full product scope remains intact. Activation gates control production exposure, not whether a capability belongs to the protocol.
10. The extensibility invariant in section 5 applies to every contract, service, schema, and interface. Any design that closes the system to future assets, adapters, markets, or risk domains is rejected regardless of short-term convenience.
11. Verification is proportional to risk, as defined in section 10. Proportionality sets the default effort per slice and never relaxes the phase gates, qualification gates, or launch gates in this plan.

## 3. Environment model

### Environment A: local unit and invariant tests

Purpose:

- develop deterministic financial math and state machines quickly;
- fuzz payoff, margin, netting, allocation, signature, and settlement behavior;
- test adversarial token, oracle, role, callback, and reentrancy behavior;
- run complete lifecycle scenarios without public-network latency.

This environment uses local test assets and deterministic clock, session, oracle, venue, and privacy fixtures.

### Environment B: pinned Arbitrum One fork

Purpose:

- exercise production adapters against real mainnet bytecode and state;
- validate native USDC behavior, decimals, approvals, balances, and transfer semantics;
- test Pyth Core pull updates, Chainlink feeds, sequencer status, provider fallbacks, and stale-data rejection;
- simulate Camelot, GMX, Aave, and Uniswap interactions where they are part of hedging or liquidity workflows;
- estimate gas for deployments and complete user journeys;
- perform deployment rehearsals and upgrade or migration rehearsals without broadcasting.

The fork must pin an explicit block number. CI records the RPC provider, chain ID, block number, dependency addresses, and code hashes. A second current-block fork run catches integrations that changed after the pinned fixture.

### Environment C: Arbitrum Sepolia

Purpose:

- provide a public, persistent, explorer-verifiable exchange for judges and testers;
- prove wallet signatures, approvals, quote competition, order matching, collateral movement, lifecycle automation, settlement, indexing, receipts, and recovery end to end;
- run real integrations where available and production-shaped test adapters where unavailable;
- expose the web application, maker cockpit, risk console, receipt explorer, API, SDK, keeper, and market-making services.

Network facts:

- chain ID: `421614`
- public RPC: `https://sepolia-rollup.arbitrum.io/rpc`
- settlement token: Circle test USDC at `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

Public RPC is suitable for checking and fallback, not production service reliability. The deployed application will use a managed RPC with at least one independent fallback.

### Environment D: Arbitrum One

Purpose:

- capped production launch using native USDC;
- qualified markets only;
- Safe-owned administration with timelocks, monitoring, emergency controls, and preserved exits;
- funded keepers, oracle delivery, gas sponsorship, insurance, and canary trading.

Network facts:

- chain ID: `42161`
- public RPC: `https://arb1.arbitrum.io/rpc`
- native USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`

## 4. Mainnet parity contract

The following behavior must be identical on Sepolia and One:

- typed market and instrument schemas;
- EIP-712 quote, order, approval, cancellation, RFQ, auction, lifecycle, and receipt messages;
- bounded payoff and rounding rules;
- collateral accounting and segregation;
- quote validity, nonces, replay protection, partial-fill rules, and capacity reservations;
- public book, RFQ, request-for-stream, sealed auction, batch, package, and solver execution paths;
- position creation, transfer, split, merge, amendment, exercise, roll, novation, unwind, fixing, settlement, and recovery states;
- portfolio accounts, scenario calculations, netting, compression, default handling, and insurance accounting;
- role boundaries, pause scopes, delayed recovery, and preserved user exits;
- event schemas, indexer mappings, APIs, SDK types, UI flows, observability, and receipt formats.

Permitted environment differences:

- contract and external dependency addresses;
- oracle adapter implementation selected for a market;
- test faucet availability;
- risk and open-interest caps;
- fee recipient and operator identities;
- qualification state of a market or feature;
- sponsorship and keeper budgets;
- controlled test scenarios and accelerated test expiries.

Not permitted:

- bypassing collateral checks on Sepolia;
- operator-only fake fills;
- changing payoff math for the demo;
- database-only positions or settlements;
- frontend-generated receipts that cannot be reproduced from chain events;
- unrestricted owner mutation of settled results;
- silently substituting mock prices for production feeds.

## 5. Extensibility invariant

Setryn must stay open to new assets, token bindings, calendars, sessions, benchmarks, oracle adapters, venue adapters, market specifications, payoff modules, collateral types, execution modes, and risk domains at any time, without weakening security and without mutating historical economics. This section is authoritative and overrides any convenience shortcut in a lower-level design note.

Non-negotiable rules:

1. No hardcoded market universe, symbol list, contract address, oracle vendor, calendar name, venue list, or fixed asset-count assumption in core logic. Core logic is parameterized, never enumerated.
2. Canonical typed IDs and explicit interface boundaries connect modules. Modules reach each other through those IDs and interfaces, never through concrete implementation types.
3. New definitions and new implementations enter only through append-only versioned registries or registered adapters. Existing records are never overwritten in place.
4. Registration is permissioned or permissionless as specified per registry. Registration never grants risk authority by itself.
5. Qualification and activation are separate, fail-closed gates. Qualification checks dependency identity and codehash, declared capability, required evidence, caps, and risk-domain constraints where applicable. Activation is a distinct approval that can be withheld or revoked.
6. Old versions stay resolvable for balances, withdrawals, positions, fixing, settlement, recovery, receipts, audit, and replay. No upgrade silently changes existing economics.
7. Unsupported capability combinations fail closed rather than degrading to a default. Adding one module must not require redeploying unrelated modules.
8. Per-market and per-risk-domain parameters are versioned records, not global constants.
9. Enumerability comes from events and indexers, not from unbounded onchain arrays.
10. Extension interfaces do not allow arbitrary delegatecall and cannot bypass custody, solvency, authorization, replay, oracle, session, settlement, or pause rules.
11. Mainnet activation remains separately approved even when the implementation already exists and is qualified on testnet.

## 6. System architecture

### 6.1 Onchain protocol

The contracts are organized by economic responsibility, while retaining every product capability in the feature map.

1. **Protocol registry and qualification**
   - asset, benchmark, session, calendar, market, instrument, package, adapter, and risk-domain registries;
   - qualification states, dependency code hashes, caps, delays, and feature activation;
   - versioned market specifications with immutable historical references.

2. **Collateral vault and clearing accounts**
   - native USDC custody;
   - segregated balances, reservations, withdrawals, fees, insurance, and default resources;
   - portfolio accounts, subaccounts, conditional offsets, scenario margin, and cap enforcement;
   - strict conservation and solvency invariants.

3. **Exchange and execution**
   - signed maker quote surfaces and firm capacity reservations;
   - central limit and package books;
   - private RFQ, request-for-stream, sealed auction, and batch modes;
   - solver competition, deterministic matching, partial fills, implied liquidity, and allocation;
   - best-route and best-execution evidence.

4. **Instrument and position engine**
   - capped forwards, NDFs, European options, collars, spreads, caps, floors, basis, correlation, dispersion, and typed packages;
   - position claims and lifecycle state;
   - split, merge, transfer, assignment, amendment, novation, exercise, roll, unwind, and migration.

5. **Benchmark and settlement engine**
   - oracle adapters, fixing windows, sessions, curves, corporate actions, disruption states, and fallback policies;
   - cash settlement, qualified delivery, deterministic payout, terminal outcomes, and reconciliation;
   - permissionless settlement with reimbursable execution where economically justified.

6. **Risk, default, and recovery**
   - isolated risk domains, maker limits, concentration limits, default auctions, insurance, coordinated de-risking, and emergency states;
   - scoped pause powers with unaffected withdrawal and settlement paths;
   - delayed recovery and evidence-backed governance actions.

7. **Privacy and proof layer**
   - encrypted RFQ envelopes, commit and reveal, confidential notionals, selective disclosure, privacy-preserving solvency, and ZK settlement paths;
   - explicit metadata leakage reports and capability-specific qualification.

The final contract topology will follow measured code size, upgrade, audit, and storage-layout constraints. It will not combine unrelated risk domains merely to reduce the contract count.

### 6.2 Offchain services

- API gateway and authenticated organization service;
- event indexer and deterministic state projection;
- maker and solver gateway;
- market-making engine with quote curves, inventory, Greeks, hedging, limits, and kill switches;
- oracle update relay supporting Pyth Core pull payloads and other qualified providers;
- keeper network for auctions, fixing, settlement, recovery, and reconciliation;
- privacy coordinator for encrypted RFQ and sealed auction transport;
- risk engine for scenarios, explainable pre-trade checks, and independent reconciliation;
- receipt generator that derives proofs only from signed messages, transaction receipts, logs, and versioned rules;
- monitoring, alerting, incident response, and deployment control plane.

### 6.3 Product surfaces

The route architecture, responsive behavior, professional workspace, customer journeys, transaction states, and visual system are specified in [`../specs/setryn-interface-spec.md`](../specs/setryn-interface-spec.md).

- responsive exchange application and installable PWA;
- goal-first hedge builder and cash-flow calendar;
- strategy studio and professional trading terminal;
- maker and solver cockpit;
- risk and operations console;
- receipt and settlement explorer;
- SDKs, typed APIs, webhooks, embedded widgets, and partner console;
- mobile application after the shared protocol client and core web flows stabilize.

## 7. Test assets and market fixtures

Most dated contracts are cash-settled in USDC. We do not need to mint a fake token for every underlying reference asset.

### Settlement assets

- Sepolia default: Circle test USDC.
- Local fallback: a six-decimal `MockUSDC` with controllable failure, fee-on-transfer rejection, blacklist, pause, and malformed-return test variants.
- Mainnet: Circle native USDC only for the initial settlement domain.
- Other collateral assets remain disabled until separately qualified.

### Reference markets

The Sepolia genesis board will include production-shaped series in these families:

- FX: EUR/USD, GBP/USD, USD/JPY, USD/INR;
- crypto: BTC/USD, ETH/USD, ARB/USD, ETH/BTC;
- metals: XAU/USD and XAG/USD;
- energy: WTI and Brent reference markets;
- rates: SOFR, US 2-year, US 10-year, and selected yield-curve packages;
- indices: S&P 500, Nasdaq 100, and a qualified crypto index;
- stablecoin risk: USDC/USD and selected redemption or depeg packages;
- tokenized assets: qualified NAV, reference-to-token basis, and redemption-risk fixtures;
- cross-asset packages: crypto plus FX, commodity plus FX, rate plus index, and collateral-basis packages.

Fixtures cover live quotes and deterministic scenarios including stale updates, confidence widening, closed sessions, holidays, weekend gaps, benchmark delay, correction, cancellation, corporate action, contract roll, depeg, market disruption, and oracle disagreement.

### Test oracle policy

1. Prefer the Pyth Core pull flow for public testnet development. A user, maker, or keeper obtains the signed update, includes it with the protocol transaction, and pays only Sepolia gas. Pyth currently reports a zero Core onchain update fee.
2. Obtain the free Pyth data trial for testnet Hermes access. Keep the key in the server-side oracle relay and never expose it to the browser.
3. Do not rely on Pyth push mode on Arbitrum. Pyth's current sponsored EVM push list does not include Arbitrum One or Arbitrum Sepolia. If cached updates are useful, our keeper can call the pull receiver, but that is our gas-funded service rather than a sponsored Pyth push feed.
4. Treat the existing Pyth Core receiver contracts found on Arbitrum One at `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C` and Arbitrum Sepolia at `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF` as unqualified candidates. Both have bytecode and return a 60-second valid period and zero update fee, but neither network appears in Pyth's current official Core address list. We must successfully verify a fresh payload and obtain current Pyth confirmation before depending on them.
5. Keep the protocol independent of Pyth Core, Pyth Pro, Chainlink, or any other provider through `IBenchmarkAdapter`. Mainnet market qualification chooses providers per benchmark without changing instrument or settlement contracts.
6. Resolve the current feed catalog during qualification. Pin selected IDs and metadata in a versioned deployment manifest only after checking delivery compatibility, state, channel, publishers, schedule, entitlement, and terms.
7. Use qualified Chainlink feeds for independent verification and sequencer status where available.
8. Use a controlled `ScenarioOracleAdapter` only for missing benchmarks and deliberate adverse-condition demonstrations. It is not the default data path for supported feeds.
9. Every price includes source, observed time, publish time, confidence, session, sequence, and rule version.
10. The mock adapter exposes its test status in events, APIs, UI, and receipts.
11. Mock oracle contracts contain an immutable chain guard that excludes Arbitrum One.

Current Pyth reference-data coverage was checked on 2026-09-21. This table proves catalog availability, not that each feed is included in Pyth Core, free, entitled, or qualified for production. It is research evidence, not permanent runtime configuration.

| Genesis reference | Current Pyth symbol | Current catalog ID | Minimum channel | Stable publishers reported |
| --- | --- | ---: | --- | ---: |
| BTC/USD | `Crypto.BTC/USD` | 1 | Real time | 3 |
| ETH/USD | `Crypto.ETH/USD` | 2 | Real time | 3 |
| USDC/USD | `Crypto.USDC/USD` | 7 | Real time | 3 |
| ARB/USD | `Crypto.ARB/USD` | 37 | 200 ms | 3 |
| EUR/USD | `FX.EUR/USD` | 327 | Real time | 3 |
| GBP/USD | `FX.GBP/USD` | 333 | 200 ms | 3 |
| USD/JPY | `FX.USD/JPY` | 340 | Real time | 3 |
| XAG/USD | `Metal.XAG/USD` | 345 | 200 ms | 3 |
| XAU/USD | `Metal.XAU/USD` | 346 | 200 ms | 3 |
| ETH/BTC | `Crypto.ETH/BTC` | 419 | 200 ms | 3 |
| Nasdaq 100 proxy | `Equity.US.QQQ/USD` | 1363 | 50 ms | 1 |
| S&P 500 proxy | `Equity.US.SPY/USD` | 1398 | 50 ms | 1 |
| USD/INR | `FX.USD/INR` | 1512 | 200 ms | 2 |
| SOFR | `InterestRate.SOFR` | 1525 | 200 ms | 2 |
| US 10-year | `InterestRate.US10Y` | 1527 | 200 ms | 1 |
| US 2-year | `InterestRate.US2Y` | 1530 | 200 ms | 1 |
| Brent index | `Commodities.Index.BRENT/USD` | 3446 | 50 ms | 1 |
| WTI one-month index | `Commodities.Index.WTI1M/USD` | 3707 | 50 ms | 1 |

Testnet availability does not automatically qualify a feed for uncapped mainnet use. Single-publisher feeds require an independent source, conservative caps, or a deterministic disruption outcome before production activation. Feed IDs, state, schedules, publisher counts, and entitlements can change and must be revalidated during each release.

### Test external venues

- Camelot and GMX Sepolia deployments are used for real public integration paths where their available assets and markets match the scenario.
- A `ReferenceVenueAdapter` reproduces production venue interfaces for missing markets, failure modes, partial fills, price impact, delay, and cancellation.
- Fork tests use the real Arbitrum One venues and state.
- A test venue can prove orchestration behavior, but it can never be presented as production liquidity.

### Testnet funding services

- Circle's public faucet supports Arbitrum Sepolia and sends 20 test USDC per address and network every two hours.
- Pyth provides a free data trial that can be used to test authenticated Hermes and signed update delivery before a production plan is selected.
- Arbitrum Sepolia ETH is used only as valueless test gas and is kept in separate deployer, user, maker, keeper, oracle, and guardian accounts.
- If a third-party faucet becomes unavailable, the protocol fixtures remain reproducible locally and on the pinned fork. The application must never depend on a faucet during normal operation.

## 8. State-transition ownership and incentives

| Transition | Expected caller | Incentive or authority | Failure handling |
| --- | --- | --- | --- |
| Deposit and withdraw | User or organization policy account | Access to trading collateral | Revert safely, never create unbacked credit |
| Reserve quote capacity | Maker | Eligibility to publish firm quotes | Reservation expires and capital unlocks |
| Fill quote or order | User, relayer, or solver | Desired execution or solver fee | Deadline, nonce, cap, and slippage checks |
| Run auction phase | Permissionless keeper | Fixed bounded reward from taker or protocol budget | Any keeper can continue after deadline |
| Submit benchmark evidence | User, maker, oracle relay, or keeper | Settlement reward or own payout | Multiple valid submitters, strict evidence checks |
| Settle position | Permissionless keeper or party | Bounded settlement reward | Idempotent settlement and retry |
| Exercise option | Holder or delegated policy | Economic value of exercise | Explicit automatic or manual rule per series |
| Run compression | Participants or solver | Collateral release and solver fee | Original positions remain valid |
| Start default process | Risk keeper or authorized guardian | Protect clearing domain | Objective thresholds and delayed escalation |
| Execute default auction | Qualified bidders and keeper | Discounted transfer plus keeper reward | Backstop and isolated recovery path |
| Pause a risk domain | Scoped guardian | Safety authority | Other domains and preserved exits continue |
| Resume or change configuration | Safe plus timelock | Governance authority | Delay, simulation, event, and cap checks |

No lifecycle step may rely on the founding team remembering to call it manually. Each automated transition needs at least two independent operators in the public test phase.

## 9. Repository and delivery structure

`/home/shreyas/code/work/arbitrum-openhouse` is the Setryn repository root. The implementation uses a monorepo with separate deployable applications, protocol contracts, autonomous services, reusable packages, and network manifests. The detailed boundaries, agent ownership model, and integration rules are defined in [`setryn-repository-and-agent-execution-plan.md`](setryn-repository-and-agent-execution-plan.md).

```text
apps/
  web/
contracts/
  src/
  script/
  test/
services/
  api/
  indexer/
  execution/
  risk/
  lifecycle/
  maker/
  privacy/
  receipts/
packages/
  schemas/
  sdk/
  client-core/
  market-spec/
  financial-math/
  ui/
  config/
  database/
  testkit/
deployments/
  local/
  arbitrum-sepolia/
  arbitrum-one/
infra/
scripts/
docs/
  plans/
  specs/
  research/
  operations/
inspiration/
```

The contracts workspace is independent Foundry code. The web application is a standard TypeScript, React, Next.js App Router, Tailwind CSS application. TypeScript services and packages use one root package manager and lockfile. Onchain contracts never import application code. First-party applications and services consume generated ABIs, canonical schemas, and internal client bindings instead of redefining protocol types. The later public SDK consumes those same sources.

The local `docs/` and `inspiration/` trees are intentionally ignored by Git at the user's request. They remain planning and reference material, never runtime dependencies. Production code cannot import them, parse them, or require their presence.

Deployment manifests contain chain ID, block number, contract address, implementation address if applicable, constructor or initializer arguments, compiler metadata, code hash, transaction hash, owner, roles, caps, and external dependencies. The Arbitrum One manifest remains unsigned until launch approval.

## 10. Implementation sequence and gates

### Proportional verification policy

Verification effort scales with the risk of the change.

An ordinary bounded contract slice is verified with focused unit tests for the custom behavior it introduces, a small number of fuzz properties for numeric and state boundaries, formatting, and compile plus contract size checks. Related failure cases are consolidated into looped or table-style tests rather than one test per trivial field. OpenZeppelin and other audited dependency internals are not retested.

Invariant, fork, integration, coverage, full CI, and full repository suites do not run per ordinary slice unless the change specifically requires them. Broad repository checks run after a coherent group of dependent slices. Invariant and fork suites run at the explicit phase gates below, in particular the Phase 2, Phase 4, and Phase 6 gates. A broad check that has passed is never rerun merely to capture cleaner output.

Standard access control, cryptography, Merkle proofs, token interfaces and transfers, and common primitives use pinned audited libraries. A custom implementation requires a project-specific semantic reason recorded in the handover.

Security-critical accounting, custody, settlement, and permission changes may justify stronger verification within the slice itself. The handover must name why the slice is security-critical.

Every gate listed in this section remains mandatory and unchanged. Proportionality governs per-slice effort only.


### Phase 0: specification freeze

Deliverables:

- market and instrument type system;
- exact payoff, rounding, fixing, margin, and settlement rules;
- state machines and role matrix;
- threat model and invariants;
- network configuration schema;
- production dependency qualification format.
- complete application route map, workspace model, and interface state machines.

Gate:

- every value-moving transition has a caller, authorization rule, incentive, timeout, and failure outcome;
- every instrument has a maximum loss and deterministic terminal state;
- no unresolved oracle or session ambiguity enters contract implementation.

### Phase 1: scaffold and protocol foundations

Deliverables:

- workspace, CI, formatting, linting, contract build, frontend, indexer, and internal generated contract bindings;
- registries, native USDC vault, access control, deployment manifests, event schemas, and local fixtures;
- invariant test harness and fork profile.

Gate:

- clean deployment and reset from one command;
- source, ABI, internal generated bindings, and indexer schemas cannot drift silently;
- collateral conservation holds under fuzzing.

### Phase 2: complete core exchange

Deliverables:

- instrument compiler and payoff engines;
- quote, book, RFQ, stream, auction, batch, package, and solver execution;
- capacity reservations, positions, lifecycle operations, collateral, fees, and settlement;
- portfolio risk, netting, compression, insurance, default, and recovery;
- oracle, session, curve, corporate-action, and delivery adapters;
- privacy and evidence primitives.

Gate:

- unit, fuzz, invariant, differential, integration, and state-machine tests pass;
- failure-path coverage includes stale oracle, sequencer down, partial fill, expired quote, insolvency attempt, replay, rounding boundary, unavailable keeper, and dependency failure;
- every product capability is implemented or explicitly recorded as implemented but activation-gated.

### Phase 3: full application and operator platform

Deliverables:

- user exchange, hedge builder, strategy studio, terminal, lifecycle timeline, and history;
- maker cockpit, solver gateway, risk console, operations console, and receipt explorer;
- internal application data services, organization policies, approvals, and accounting exports;
- maker bots, solver, oracle relay, keepers, monitoring, alerts, and runbooks.

Gate:

- a fresh wallet can obtain test assets and complete every flagship flow without team intervention;
- every UI balance and state can be reconciled to contract state and indexed events;
- mobile viewport, keyboard, accessibility, wallet rejection, RPC failure, and transaction replacement paths work.

### Phase 4: pinned mainnet-fork qualification

Deliverables:

- dependency code-hash checks;
- complete deployment rehearsal;
- real USDC, oracle, sequencer, DEX, perp, and lending adapter tests;
- gas report and unsigned production transaction bundle;
- upgrade, migration, pause, recovery, and rollback rehearsals.

Gate:

- production manifest validates at the pinned block and a current block;
- no mock address or test role can enter the Arbitrum One configuration;
- complete user and settlement journeys succeed on the fork;
- deployer ETH requirement is calculated from `eth_estimateGas`, live fee data, and a two-times safety reserve.

### Phase 5: Arbitrum Sepolia release candidate

Deliverables:

- explorer-verified contracts and public manifests;
- funded test keepers, maker bots, test faucet, markets, API, UI, and status page;
- scripted judge journey plus adversarial and recovery demonstrations;
- public receipts proving quote, fill, collateral, fixing, settlement, and accounting.

Gate:

- at least two independently operated makers or maker identities quote overlapping markets;
- at least two keeper identities can continue lifecycle operations;
- 24-hour soak run completes without unreconciled balances or stuck positions;
- no privileged database edit is needed to finish a flow.

### Phase 6: security and launch readiness

Deliverables:

- Slither and static analysis;
- independent review or audit;
- resolved findings and regression tests;
- Safe ownership, role separation, timelock, monitoring, incident runbook, disclosure policy, and bug bounty plan;
- legal and market-access review for each activated market family.

Gate:

- zero unresolved critical or high-severity issues;
- exact production bytecode is rehearsed and verified on Sepolia and the fork;
- all launch capital and recurring service budgets are funded;
- withdrawal and settlement paths survive every scoped pause.

### Phase 7: capped Arbitrum One launch

Sequence:

1. Fund the deployer with only the approved ETH amount.
2. Deploy and verify contracts from the signed release tag.
3. Transfer administration to the production Safe and verify every role.
4. Fund keeper, oracle, sponsorship, and insurance budgets.
5. Configure dependencies and markets in disabled state.
6. Run read-only verification and simulated calls against deployed addresses.
7. Activate one canary risk domain with minimum caps.
8. Execute funded smoke positions from entry through settlement.
9. Reconcile contracts, indexer, receipts, Safe, and treasury.
10. Increase caps only through the documented qualification process.

### Phase 8: public integration platform

This phase begins only after the complete first-party user platform and capped production exchange are operating.

Deliverables:

- versioned public API and authentication;
- external SDKs and integration examples;
- webhooks for external consumers;
- embedded trading and market-data widgets;
- partner console, API keys, quotas, usage analytics, and developer documentation.

Gate:

- every public response and SDK action derives from the same contract state, indexed events, and internal schemas used by the first-party platform;
- versioning, deprecation, rate limits, authentication, replay protection, and service objectives are documented and enforced;
- the public integration layer cannot bypass qualification, collateral, execution, settlement, or organization-policy controls.

## 11. Judge-ready proof when mainnet is unfunded

The Sepolia submission will prove production equivalence with:

- verified contract source and public deployment manifest;
- a visible chain ID and dependency status panel;
- real Circle test USDC collateral movement;
- two competing maker quotes and a user-selected fill;
- a package order and either direct or implied liquidity execution;
- a private RFQ or sealed auction with the public settlement commitment;
- a complete lifecycle action such as split, roll, novation, or early unwind;
- benchmark evidence, fixing, permissionless settlement, and payout;
- a stale-oracle or sequencer-down rejection demonstration;
- a maker-capacity exhaustion and recovery demonstration;
- a default or disruption simulation in an isolated test risk domain;
- a verifiable receipt tied to signed inputs, contract events, and settlement output;
- an Arbitrum One fork replay using the production manifest and real dependency bytecode;
- an unsigned mainnet deployment bundle with exact estimated ETH and capital requirements.

The demo must label real testnet dependencies, controlled fixtures, and fork-only production checks honestly.

## 12. Mainnet launch decision

Implementation can begin now. Mainnet activation cannot begin until all of the following are true:

- deployment, Safe, keeper, oracle, sponsor, insurance, and canary budgets are funded;
- maker collateral commitments cover the activated open-interest caps;
- production oracle coverage, delivery support, licensing, credentials, and service cost are confirmed for every activated benchmark;
- every activated benchmark has an independent fallback or explicit disruption outcome;
- contracts pass the security gate;
- production operators and keys are separated;
- all production addresses and code hashes are reverified;
- legal review approves the users, jurisdictions, and market families exposed by the public interface;
- the team gives explicit approval to sign the first Arbitrum One transaction.

## 13. Immediate build start

The first implementation work is Phase 0 followed by Phase 1. Repository setup starts with Git, the root workspace, the standalone Foundry contracts project, and the standard TypeScript, React, Next.js App Router, and Tailwind CSS web project. Core protocol implementation then begins in this order: canonical schemas and financial rules, collateral and registry contracts, execution and position state machines, settlement and risk, internal generated bindings and event projection, then the complete first-party product surfaces. Public APIs and external SDKs follow the working user platform and capped launch.

The initial engineering milestone is not a landing page. It is a locally deployable protocol foundation with native-USDC-compatible accounting, deterministic instrument math, market qualification, production-shaped manifests, internal generated contract types, an indexer skeleton, and invariant tests. Every later surface will build against those same contracts and schemas. The primary agent remains the architecture and integration owner and issues bounded handovers to implementation agents using the repository execution plan.

## Sources

- [Arbitrum RPC endpoints and chain information](https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers)
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Pyth Core pull and push overview](https://docs.pyth.network/price-feeds/core)
- [Pyth Core EVM contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/evm)
- [Pyth Core current onchain fees](https://docs.pyth.network/price-feeds/core/current-fees)
- [Pyth Core sponsored push networks](https://docs.pyth.network/price-feeds/core/push-feeds/evm)
- [Pyth Core upgrade and test access](https://docs.pyth.network/price-feeds/core/upgrade/preparing)
- [Pyth reference-data API](https://docs.pyth.network/price-feeds/pro/api/history)
- [Circle testnet faucet](https://faucet.circle.com/)
- [Chainlink L2 sequencer uptime feeds](https://docs.chain.link/data-feeds/l2-sequencer-feeds)
- [Camelot Arbitrum Sepolia contracts](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/)
- [GMX contract addresses](https://docs.gmx.io/docs/api/contracts/addresses/)
- [Arbitrum gas overview](https://blog.arbitrum.io/understanding-gas-fees-on-the-blockchain/)
