# Setryn Product and Phase Overview

Date: 2026-09-29

Status: Canonical concise product overview

Production target: Arbitrum One

Public release-candidate network: Arbitrum Sepolia

Current build phase: Phase 4 gate passed; completing the first-party trading platform before the Arbitrum Sepolia release candidate

Current deployment status: the complete production graph deploys locally within the EIP-170 and EIP-3860 limits, with separated principals and generated evidence. The graph covers the public book, private RFQ, sealed auctions, request-for-stream, batch clearing, collateral-aware routing, and the verifiable receipt ledger with 18 subject authorities, backed by 29 linked libraries. It passes the pinned Arbitrum One fork suite and has a complete read-only unsigned Arbitrum One deployment intent and gas budget. Arbitrum Sepolia deployment is Phase 5 release-candidate work. Browser preview state is legacy scaffolding and is not an accepted platform execution path.

Detailed references:

- [Mainnet-equivalent build plan](setryn-mainnet-equivalent-build-plan.md)
- [Interface specification](../specs/setryn-interface-spec.md)
- [Complete item-level feature map](../research/setryn-full-product-feature-map-2026-09-19.md)
- [Economic schema and rules](../specs/setryn-market-instrument-and-economic-rules.md)
- [Role and state-machine model](../specs/setryn-roles-and-state-machines.md)
- [Threat and invariant model](../specs/setryn-threat-model-and-invariants.md)

This document is the product and delivery entry point. The complete item-level feature map remains normative. No baseline, defining, or scale capability in that map is removed by the shorter descriptions here. Activation can be delayed by qualification, liquidity, security, legal, or capital gates, but the protocol and product scope stays complete.

## 1. Product in one paragraph

Setryn is the private dated-risk exchange on Arbitrum. It lets a person, business, treasury, DAO, fund, trader, or market maker define a future financial exposure, trade the corresponding fixed-expiry instrument or complete strategy, compete public and private liquidity, clear the result against collateral, manage the position through its full lifecycle, and verify execution, fixing, settlement, and recovery from signed data and onchain evidence. It is a complete exchange and clearing protocol, not a router, privacy wrapper, loan application, or single trading feature.

## 2. What problem Setryn solves

Most onchain trading products optimize for spot swaps or perpetual speculation. Users with a known future date still have to combine several venues, manually manage collateral and legs, trust opaque OTC processes, or approximate a dated hedge with a perpetual position whose funding and exit price remain uncertain.

Setryn makes the dated financial outcome the primary product object:

- a business can lock or cap the value of a future receivable or payable;
- a token holder can protect an unlock or treasury sale date;
- an investor can trade a defined expiry, payoff, or yield view;
- a fund can execute and manage a complete multi-leg strategy at one net price;
- a market maker can quote reusable surfaces instead of answering every trade manually;
- every party can see the collateral, guarantee, privacy, fixing, and settlement rules before signing.

## 3. Product boundaries

Setryn is:

- a native exchange for fixed-expiry, multi-asset instruments;
- an outcome-first hedge product and a professional trading terminal over the same protocol;
- a public order-book, private RFQ, auction, package, clearing, risk, lifecycle, and settlement system;
- an extensible protocol where new assets, instruments, calendars, benchmarks, collateral, and adapters can be added through qualified versioned registries;
- a production-shaped testnet product before any capped mainnet activation.

Setryn is not:

- only an FX exchange;
- only a carry or basis product;
- only a package-order service;
- a perp DEX with privacy added;
- a frontend that routes unrelated trades to external venues;
- a database demo with fake fills or frontend-generated receipts;
- a public API or SDK company before the first-party exchange is complete.

## 4. Users and their primary jobs

| User | Primary job in Setryn |
| --- | --- |
| Individual or investor | Protect a known future exposure, trade defined-risk opportunities, and understand the complete outcome before signing |
| Business or treasury | Hedge receivables, payables, inventory, debt, token unlocks, or treasury cash flows by date |
| DAO or organization | Use subaccounts, approvals, policies, allocations, and auditable execution evidence |
| Professional trader or fund | Trade curves, volatility, basis, options, packages, and relative-value strategies with portfolio-aware margin |
| Market maker | Publish firm quotes, manage inventory and capacity, hedge fills, control risk, and respond to private RFQs |
| Solver | Compete to execute complete packages under explicit price, capacity, settlement, and recovery bounds |
| Keeper or operator | Advance auctions, fixing, settlement, recovery, reconciliation, and monitored protocol operations |
| Auditor, accountant, or judge | Reconstruct the order, quote, fill, collateral, fixing, settlement, fees, and receipt from canonical evidence |

## 5. Core product objects

1. **Dated exposure**: what value is at risk, in which direction, for how much, in which currency, and by what date.
2. **Canonical market**: the qualified underlying, benchmark, session, calendar, collateral, risk domain, and settlement rules.
3. **Instrument or strategy**: a forward, option, rate, basis, event, or typed multi-leg payoff with bounded rules.
4. **Order or liquidity request**: a public order, maker quote, private RFQ, stream, auction bid, batch instruction, or solver request.
5. **Cleared position**: ownership, collateral, margin, obligations, lifecycle rights, and terminal liability after execution.
6. **Fixing and settlement record**: the qualified observation and deterministic terminal payout.
7. **Receipt**: the signed and onchain evidence needed to reconstruct execution, exclusions, fees, lifecycle actions, settlement, and recovery.

## 6. Markets and instrument universe

The protocol is asset-agnostic. Initial and future markets can include:

- crypto assets and token pairs;
- FX pairs and currency-linked exposures;
- commodities such as gold, energy, and agricultural references;
- equity, index, and RWA-style reference markets where access and oracle rules permit them;
- interest-rate, funding-rate, borrow-rate, yield, and basis references;
- event-defined or structured exposures with deterministic bounded payoffs.

Instrument families include:

- fixed-expiry forwards, capped forwards, and non-deliverable forwards;
- European options, calls, puts, collars, spreads, caps, and floors;
- dated basis, carry, funding, and rate markets;
- correlation, dispersion, curve, calendar, and relative-value structures;
- canonical N-leg packages that trade at one net package price;
- guided hedge templates and professional custom graphs over the same canonical instrument schema.

Most initial contracts are cash-settled in USDC. A reference asset does not need a synthetic token unless physical delivery is an explicit qualified market requirement.

## 7. Execution and liquidity system

Setryn supports several execution modes through one canonical order and instrument model:

- central limit order books for standardized instruments and packages;
- signed firm maker quotes with explicit capacity reservations;
- private multi-dealer RFQs and request-for-market flows;
- request-for-stream for continuously refreshed private liquidity;
- sealed auctions and scheduled batch execution;
- solver competition for complete package outcomes;
- direct package liquidity and safely derived implied liquidity;
- coincidence-of-wants matching, portfolio netting, and compression;
- market, limit, post-only, IOC, FOK, GTC, GTD, scheduled, and scaled execution policies where the selected market supports them.

Every executable quote exposes its all-in price, size, fees, expiry, firmness, capacity, eligibility, privacy class, settlement guarantee, source, and freshness. Indicative liquidity is never combined with firm executable depth.

### Liquidity providers

The maker network is open to qualified professional crypto market makers, options and OTC desks, proprietary trading firms, funds, treasuries, and automated maker operators. A maker must satisfy collateral, capacity, risk-domain, market, and operational requirements before its quote is treated as firm. Solvers may use their own capital and approved venue adapters, but the signed result must state who owns intermediate risk and what recovery obligation applies.

## 8. Collateral, clearing, and risk

The protocol owns the financial state after a trade. Its clearing and risk layer includes:

- native USDC custody and segregated clearing balances;
- deposits, withdrawals, reservations, fees, insurance, and default resources;
- portfolio accounts and organization subaccounts;
- initial and maintenance margin;
- scenario-based portfolio margin and explainable offsets;
- maker, market, instrument, account, and risk-domain caps;
- concentration, liquidity, oracle, settlement, and dependency risk checks;
- collateral-aware routing and quote comparison;
- liquidation, default auction, insurance, coordinated de-risking, and recovery states;
- strict collateral conservation and solvency invariants;
- scoped pauses that stop new risk without blocking valid withdrawals or terminal settlement.

The interface shows pre-trade and post-trade collateral, margin, maximum loss, liquidation distance, close cost, and residual risk before the user authorizes an action.

## 9. Complete position lifecycle

Setryn manages the position after entry instead of ending at a fill notification. Supported lifecycle operations include:

- enter, add, reduce, and close;
- amend or cancel eligible open orders;
- transfer or assign eligible positions;
- split, merge, net, and compress;
- rebalance and de-risk;
- exercise, expire, fix, and cash-settle;
- roll to a new expiry or strategy series;
- novate or migrate under explicit authorization;
- recover from bounded failures and reconcile unknown outcomes;
- preserve permissionless terminal completion from committed state even if an operator authority is revoked.

Every lifecycle action produces a before-and-after preview and a durable state timeline. The terminal never labels an order successful while completion, reconciliation, or recovery is unresolved.

## 10. Privacy and evidence

Privacy is part of the execution system, not the complete product thesis. The protocol can support:

- directed or open private RFQs;
- encrypted RFQ envelopes and selective disclosure;
- anonymous or policy-scoped taker identity;
- commit and reveal for sealed competition;
- confidential notionals and qualified zero-knowledge settlement paths;
- explicit metadata-leakage and capability reports.

Verifiability remains mandatory. Receipts can include the canonical order and quote hashes, eligible quote-set commitment, winning rule, capacity evidence, transaction and event references, fixing inputs, settlement calculation, fees, recovery journal, and evidence grade. Private content is disclosed only according to the signed policy.

## 11. First-party product surfaces

Setryn ships as one responsive web application and installable PWA with two entry experiences:

- **Protect** starts from a user's real exposure and desired outcome.
- **Trade** starts from markets, expiries, books, curves, volatility, packages, and RFQs.

Both experiences create the same canonical positions and lifecycle records.

### Customer application

- **Home**: account summary, opportunities, alerts, health, and required actions.
- **Protect**: outcome-first builder for receivables, payables, inventory, debt, unlocks, investments, and custom exposures.
- **Markets**: multi-asset discovery, favorites, filters, expiry ladders, curves, depth, volume, and qualification state.
- **Trade**: professional package and instrument terminal with live chart, order book, trades, ticket, route or quote comparison, positions, orders, and history.
- **Strategies**: guided templates and a professional typed N-leg graph builder with payoff and scenario analysis.
- **RFQs**: build, invite, compare, select, clear, and inspect private multi-maker requests.
- **Portfolio**: positions, PnL, collateral, exposure coverage, cash flows, scenarios, and cross-market risk.
- **Lifecycle**: fixing, expiry, exercise, roll, settlement, recovery, and reconciliation calendar.
- **Activity**: orders, fills, auctions, transfers, collateral actions, and protocol events.
- **Receipts**: execution, best-route, fixing, settlement, recovery, and accounting evidence.

### Professional and operating surfaces

- **Maker cockpit**: quote surfaces, RFQ queue, inventory, Greeks, reservations, hedge routes, profitability, limits, sessions, and kill switches.
- **Solver cockpit**: package requests, route construction, reserved capital, obligations, execution progress, and recovery.
- **Risk console**: portfolio scenarios, limits, concentrations, collateral, dependencies, insurance, and default state.
- **Operations console**: keepers, oracle relays, queues, incidents, reconciliation, environment policy, deployment state, and emergency controls.
- **Receipt explorer**: independent reconstruction of orders, quotes, fills, fixing, settlement, and recovery.

Public APIs, external SDKs, webhooks, widgets, and partner tooling are Phase 8 work. Internal schemas, generated bindings, indexing, and application services are built earlier because the first-party platform consumes them.

## 12. Trading terminal standard

The desktop terminal is a professional workstation, not a landing page with a trade card. It includes:

- synchronized market identity, expiry, executable bid and ask, mark, volume, open interest, fixing, settlement, and environment state;
- candlestick, line, area, payoff, term-curve, depth, volatility, basis, funding, and execution-history views where relevant;
- chart intervals, drawing and inspection tools, persistent preferences, position and order markers, and live coherent updates;
- direct, implied, firm maker, solver, private, and indicative liquidity shown as different classes;
- a complete ticket with quantity, price, time in force, collateral, fees, margin, maximum loss, settlement, privacy, and lifecycle policy;
- positions, open orders, RFQs, fills, settlements, recovery, receipts, and accounting history in the same workspace;
- keyboard operation, accessible focus states, responsive layouts, and no reliance on color alone.

Mobile is a purpose-built monitoring and bounded-action client with Overview, Market, Order, Lifecycle, and Activity views. Complex graph construction and maker operations remain desktop-first.

## 13. Data, oracle, fixing, and settlement model

- Preview prices, quotes, books, routes, and charts use one coherent feed so the application never contradicts itself.
- Every displayed value declares whether it is observed, executable, estimated, or modeled, plus its source and freshness.
- Qualified oracle adapters can include Pyth Core pull updates, Chainlink feeds, sequencer-health checks, and governed fallbacks.
- Markets define their benchmark, observation window, session, calendar, disruption handling, corporate-action policy, and fallback rules before activation.
- Fixing and settlement derive from versioned committed rules. An owner cannot rewrite a settled economic result.
- Indexing projects every state-changing event with explicit enum canonicalization and enough event data for deterministic reconstruction.

## 14. Extensibility and security model

Setryn is designed so new assets and market families can be added without redeploying unrelated systems or weakening existing guarantees:

- no hardcoded market universe, symbol list, vendor, calendar, venue, or asset-count assumption in core logic;
- append-only versioned registries for assets, benchmarks, sessions, calendars, markets, instruments, packages, adapters, collateral, and risk domains;
- registration, qualification, and activation are separate gates;
- historical definitions remain resolvable for balances, positions, settlement, recovery, receipts, and audit;
- unsupported capability combinations fail closed;
- adapters cannot bypass custody, authorization, solvency, replay, oracle, session, settlement, or pause rules;
- fees and risk parameters are versioned, capped, visible before signing, and updated through controlled governance;
- role separation, timelocks, Safe ownership, scoped emergency controls, monitoring, and preserved user exits protect production operation.

## 15. Network and development strategy

| Environment | Purpose | Write policy |
| --- | --- | --- |
| Local | Fast deterministic development, fixtures, financial math, state machines, and failure scenarios | Local writes only |
| Pinned Arbitrum One fork | Read real code and state, qualify adapters, rehearse deployment, simulate full flows, and estimate gas | Fork writes only, never broadcasts |
| Arbitrum Sepolia | Public production-shaped release candidate with test assets, makers, keepers, markets, receipts, and explorer evidence | Testnet writes allowed |
| Arbitrum One | Capped launch with native USDC, qualified markets, funded operations, and production governance | No writes until explicit launch approval |

The same core contract source, schemas, ABIs, storage layout, economic rules, state machines, and event model run on Sepolia and One. Environment differences are limited to reviewed addresses, adapters, roles, caps, budgets, and activation state. Testnet cannot bypass collateral or fabricate fills.

## 16. Revenue model

Setryn can earn revenue from the exchange activity it owns:

- execution and clearing fees on matched public, private, auction, and package volume;
- protocol share of solver or maker-assisted execution fees;
- premium organization features such as policy controls, approvals, advanced risk, accounting, and operational workspaces;
- optional professional maker and solver infrastructure services;
- lifecycle automation services where they add value without making permissionless settlement dependent on payment;
- later public API, webhook, widget, and partner-platform usage after the first-party exchange is complete.

Fee schedules are market-aware, versioned, capped, and disclosed in the signed pre-trade economics. Qualification or listing cannot become a pay-to-bypass-risk process.

## 17. Complete planned capability inventory

The complete Setryn scope is organized into the following capability families. This inventory prevents later implementation phases from accidentally collapsing the product into only a terminal, an RFQ screen, or one instrument.

### A. User application and portfolio

- Cash-flow-first hedge creation, plain-language outcome selection, complete quote comparison, position and order management, funding and withdrawals, cash-flow calendar, scenario comparison, budget-rate protection, hedge coverage, private activity, organization grouping, and later embedded hedge experiences.

### B. Instruments and market design

- Standard and custom-date forwards, capped forwards, NDFs, calls, puts, collars, participating and window forwards, average-rate contracts, layered hedges, option spreads, FX swaps, basis and calendar trades, packages, deliverable qualified assets, immutable instrument versions, and user-defined templates constrained by the supported payoff grammar.

### C. Execution and order management

- Firm multi-dealer RFQ, EIP-712 quotes, delegated signers, partial and complete fills, nonces and cancellation, market and limit orders, GTC, GTD, IOC, FOK, post-only, reduce-only, triggers, encrypted RFQ, sealed bids, uniform-price batches, request-for-stream, large-order scheduling, portfolio batches, allocations, and cleared off-platform trade capture.

### D. Liquidity and matching

- Firm versus indicative aggregate depth, public standard-series and package books, maker invitations, deterministic price-time, pro-rata, or batch priority, atomic collateral locking, fee and rebate allocation, hybrid liquidity waterfalls, relative-price orders, parametric quote surfaces, mass repricing, natural crossing, maturity-bucket netting, compression, clearing-only access, and measurable liquidity-quality scores.

### E. Collateral, margin, and clearing

- Native USDC clearing, segregated balances, terminal-liability reservations, maximum-loss collateralization, mark-to-market, initial and maintenance margin, account and market caps, isolated risk domains, default waterfalls, insurance, unified maker accounts, cross-position netting, scenario portfolio margin, variation margin, stress tests, collateral simulation, qualified multi-collateral support, yield-bearing collateral isolation, default auctions, and solvency evidence.

### F. Position lifecycle

- Open, partial fill, fill, cancel, expire, transfer, assign, split, merge, amend, exercise, lapse, reduce, rebalance, unwind, novate, roll, migrate, compress, partial settle, mature, fix, settle, recover, and reconcile, with permissionless terminal completion and an evidence-backed audit trail.

### G. Oracle, fixing, and settlement

- Pyth pull delivery, qualified Chainlink and other adapters, confidence and staleness checks, sequencer health, market sessions, holidays, daylight-saving and business-day rules, deterministic observation selection, mean and time-weighted fixing, decimal and rounding rules, fallback and deviation policies, disruption handling, batch settlement, settlement netting, reproducible calculators, ZK settlement proofs, and qualified payment-versus-payment or payment-versus-delivery paths.

### H. Confidentiality and selective disclosure

- A visibility model for public, counterparty, operator, auditor, and user-only data; encrypted RFQs and quotes; unlinkable requests; viewing keys; committed position state; nullifiers; proof of valid terms and collateral; confidential payout notes; eligibility credentials; scoped disclosures; signer recovery; batched privacy-preserving flows; aggregate solvency proofs; and honest leakage reports.

### I. MEV and execution fairness

- Taker-bound firm prices, exact cost bounds, replay protection, sealed maker competition, uniform clearing, commit and reveal, capacity reservation, deterministic tie-breaking, caller-independent fixing, multi-relay protected submission, Timeboost exposure analytics, auction or solver accountability, fairness transcripts, and surveillance for frontruns, backruns, fading, or suspicious behavior.

### J. Market-maker operating system

- Maker onboarding and collateral, RFQ inbox, auto-quote rules, quote surfaces, one-operation repricing, inventory and Greeks, capacity and pre-trade margin, skew controls, hedge connectors, fills, fees, PnL, analytics, quality scores, private qualified identity, subaccounts, strategy vaults, historical replay, session keys, API and FIX connectivity, cancel-on-disconnect, dead-man controls, and global or market kill switches.

### K. Cash-flow and treasury operating system

- Manual, CSV, API, and later accounting-system exposure ingestion; receivables, payables, payroll, subscriptions, inventory, debt, treasury, unlock, and investment objects; confirmed versus forecast classification; natural netting; timelines; hedge policies; proposals and automation; forecast ranges; approvals and Safe support; entity and department allocation; cash-flow linkage; effectiveness reporting; reconciliation; journal exports; intercompany netting; and payment application.

### L. Market data, analytics, and reporting

- Spot references, forward points, outright rates, implied yields, fixing countdowns, executable depth, spread, volume, open interest, curves, realized volatility, volatility surfaces, Greeks, mark and PnL decomposition, confirmations, statements, tax and accounting exports, transaction-cost analysis, maker analytics, hedge effectiveness, public risk metrics, privacy-preserving benchmark data, backtesting datasets, surveillance reports, and scheduled reporting.

### M. Accounts, onboarding, and everyday UX

- Wallet, hardware-wallet, Safe, passkey, email, and smart-account paths; sponsored gas; USDC-denominated fee presentation; safe transaction batching; explicit pending, confirmed, failed, expired, unknown, and recoverable states; address books; organization policy checks; guided onboarding; demo and simulation mode; human-readable signatures; in-app, email, push, Telegram, and webhook alerts; responsive PWA; localization; and organization signer recovery.

### N. Developer and integration platform

- After the first-party product is operating: public REST and WebSocket APIs, authenticated trading and portfolio access, TypeScript SDK, Solidity interfaces, exact fixed-point types, signed webhooks, stable errors, FIX adapters, embedded quote and hedge components, policy APIs, privacy tooling, sandbox replay, third-party clearing, authorized indexing, agent-safe credentials, quotas, versioning, and service objectives.

### O. Security, reliability, and operations

- Independent audits, formal economic and authorization properties, proportional unit, fuzz, invariant, differential, fork, and end-to-end verification, bug bounty, capped launches, pause-new-risk with preserved exits, redundant keepers, permissionless settlement, oracle and infrastructure monitoring, status and incident history, timelocks, role separation, verifier migration, stress and reconstruction testing, market-abuse surveillance, redundancy, disaster recovery, and chaos scenarios.

### P. Compliance, governance, and auditability

- Jurisdiction-aware access, risk disclosures, clear responsibility boundaries, legally required prohibited-address controls, immutable trade evidence, retention and privacy policy, optional private credentials, restricted counterparty pools, auditable best execution, suspicious-activity workflows, scoped auditor access, legal-entity hierarchies, delayed market-rule changes, independent methodology oversight, and jurisdiction-specific reporting adapters.

### Q. Revenue and network growth

- Transparent maker and taker execution fees, clearing fees, lifecycle fees, maker rebates, professional terminal and infrastructure subscriptions, partner revenue sharing, premium organization privacy and disclosure services, executable benchmark and market-data products after real volume exists, enterprise support, clearing membership, market sponsorship backed by real flow, and no dependency on a token, wash volume, or points as fake demand.

### R. Canonical strategy series and package protocol

- Immutable strategy manifests, canonical series IDs, typed directed graphs, spot, forward, option, collateral, payment, and approved external-action legs, dependency and atomic groups, exact package and leg fill policies, preconditions and postconditions, language-neutral encodings, economic-equivalence normalization, typed outcome schemas, package-wide fee and risk limits, persistent strategy state, signed recovery graphs, resource-aware compilation, every lifecycle operation, baseline adoption after external changes, reproducible compiler versions, conditional and scheduled actions, and formally verifiable compiler properties.

### S. Implied liquidity and package matching

- Direct, implied-in, implied-out, RFQ, and indicative classes; declared priority and tie-breaking; source invalidation; self-match and common-control protection; conservation proofs; cross-series and bounded multi-generation implication; adverse rounding; price-improvement allocation; source reservation; atomic source execution; provenance; liquidity-at-size curves; cross-user package crossing; deterministic combination of makers, natural flow, components, solvers, and backstops; privacy-preserving implication; circuit breakers; and historical implication simulation.

### T. Solver and firm-capacity network

- Signed capability manifests, separated keys, complete route and recovery commitments, relay-independent quote validity, objective reservations, capital ledgers, withdrawal fencing, discovery, reference solver, inventory allocation, encrypted transport, capital and solvency evidence, narrow objective bonds, performance metrics, common-control grouping, permissionless self-hosting, recovery-capital reservation, delegated capital mandates, independence requirements, and safe solver wind-down.

### U. Qualification, risk domains, and clearing expansion

- Immutable manifests, mutable qualification states, independent component qualification, automatic downgrade without automatic promotion, append-only history, normalized adapter output, explicit unknown states, dependency-based risk isolation, upgrade and liquidity monitoring, per-domain limits, conditional offsets, pre-liquidation de-risking, coordinated package reduction, typed external credit, shared dependency graphs, stress libraries, controllable strategy accounts, isolated guarantor domains, package clearing, cross-member default procedures, auditable private margin proofs, and public methodology changes.

### V. Settlement guarantees, evidence, and deterministic replay

- Explicit settlement class, complete and bounded terminal states, durable journals, reconcile-before-retry, comprehensive receipts, evidence grades, deterministic replay, candidate-route and exclusion records, complete-outcome best execution, expected versus realized comparison, delivery policies, fail-closed privacy, manual takeover, compensation proof, retention of every failed or uncertain outcome, selective receipt disclosure, execution-quality datasets, independent verification, proof aggregation, and cross-version replay.

### W. Strategy platform, distribution, and ecosystem products

- Visual strategy studio, executable opportunity feed, saved strategies, watchlists, alerts, presets, approvals, simulation, package comparison, explorers, realistic backtesting, attributed strategy catalogue, publisher and builder manifests, outcome-bound fees, later embedded widgets, partner console, white-label configuration, conformance suite, organization automation, human-readable package explanations, reviewed strategy marketplace, native mobile after web parity, enterprise self-hosting, certification, multi-party workflows, and a privacy-preserving research portal.

### X. Multi-asset and asset-specific engines

- Canonical asset and benchmark registries; sessions and calendars; distinct FX, crypto, metals, energy, rates, equity, index, stablecoin, and tokenized-asset families; explicit spot, perp, dated future, NAV, redemption, and rate benchmarks; market qualification; multiple genesis markets; procurement, revenue, inventory, debt, unlock, stablecoin, NAV, and investment templates; curve, volatility, corporate-action, futures-roll, and event engines; asset-specific stress; unified factor risk; multi-benchmark fixing; qualified delivery; custom indices; later economic-index markets, structured notes, RWA financing, repo, physical-claim coordination, cross-market auctions, market sponsorship, and permissionless extension behind strict qualification.

The item-level requirements, baseline, defining, and scale classifications, and dependency ordering for these capability families are preserved in the [complete feature map](../research/setryn-full-product-feature-map-2026-09-19.md).

## 18. Current build status

### Completed foundations

- **Phase 0 passed**: economic schema, roles, state machines, threats, invariants, network model, and interface architecture are specified.
- **Phase 1 passed**: the repository, canonical TypeScript schemas, generated internal bindings, deterministic indexer projections, deployment manifests, qualified registries, collateral accounting, fixtures, and fork profiles are in place and passed their phase gate.
- **Phase 2 implementation is complete**: exchange contracts, collateral and risk controls, lifecycle and compression, fixing and settlement, private execution and evidence, adapters, governance wiring, deployment metadata, bindings, and event projections are implemented.
- **Phase 2 verification is deferred**: it must not be described as verification-passed until its dedicated gate runs.

### Phase 3 application implementation complete

The current first-party platform already contains production-shaped local flows for:

- responsive market discovery and a professional trade workspace;
- coherent live preview marks, quotes, books, routes, and charts;
- candlestick, line, and area chart modes with intervals and persisted preferences;
- market and immediate entry, exit, and realized-result flows;
- local GTC resting orders and cancellation;
- private RFQ creation, maker responses, quote selection, execution, expiry, and receipt evidence;
- portfolio positions, collateral, risk, PnL, lifecycle actions, and activity history;
- strategy handoffs, maker RFQ visibility, receipt inspection, and local accounting export;
- organization control services and initial operator surfaces.

The primary local-devnet market now uses wallet signatures, contract transactions, contract-event restoration, firm maker capacity, signed private RFQs, and signed lifecycle exits. Reference markets, modeled analytics, and recorded operating scenarios remain visibly labeled and never count as executable evidence. The targeted Phase 3 verification gate remains deferred. Public persistence, public operators, qualified external market data, and Arbitrum Sepolia infrastructure belong to the Phase 5 release candidate.

## 19. Short phase plan

### Phase 0: specification freeze - passed

Lock the product schema, payoffs, rounding, fixing, margin, settlement, roles, state machines, threat model, invariants, network configuration, and complete route map.

### Phase 1: scaffold and protocol foundations - passed

Build the monorepo, contracts project, web application, internal schemas, bindings, indexer foundation, registries, collateral vault, deployment manifests, fixtures, and fork profile.

### Phase 2: complete core exchange - passed

Implement instruments, execution modes, positions, collateral, fees, portfolio risk, lifecycle, netting, compression, fixing, settlement, privacy, evidence, default, and recovery. Run its targeted verification gate before calling it verification-passed.

### Phase 3: full application and operator platform - implementation complete, gate deferred

Complete the user exchange, Protect flow, strategy studio, terminal, RFQs, portfolio, lifecycle, receipts, maker and solver systems, risk and operations consoles, internal data services, keepers, relays, monitoring, alerts, and runbooks. Replace local runtime flows with real contract and indexer integration.

### Phase 4: pinned mainnet-fork qualification - passed

Qualify real Arbitrum One dependencies, rehearse deployment and upgrades, test complete flows against real bytecode and state, estimate gas, and produce an unsigned production transaction bundle without broadcasting.

### Phase 5: Arbitrum Sepolia release candidate

Deploy explorer-verified contracts and the public application with test assets, multiple makers and keepers, qualified markets, receipts, status monitoring, recovery demonstrations, and a complete judge journey that needs no team intervention.

### Phase 6: security and launch readiness

Run static analysis and independent review, resolve critical findings, finalize Safe ownership, role separation, timelocks, monitoring, incident response, disclosure, legal review, and funded launch budgets.

### Phase 7: capped Arbitrum One launch

Deploy the signed release, transfer control to production governance, activate one canary risk domain with minimum caps, execute and reconcile full smoke positions, then raise caps only through the qualification process.

### Phase 8: public integration platform

After the first-party exchange and capped launch work, release versioned public APIs, external SDKs, webhooks, widgets, partner tooling, quotas, analytics, documentation, and service objectives.

## 20. Flagship proof of the product

A complete Setryn demonstration should prove one coherent financial lifecycle:

1. A fresh user receives test collateral and connects a wallet.
2. The user enters a dated exposure in Protect or selects a canonical market in Trade.
3. Setryn compares a public book, firm maker liquidity, and a private RFQ or solver outcome.
4. The user sees the exact payoff, price, fees, collateral, margin, privacy, fixing, settlement, and recovery rules.
5. The user signs the canonical payload and watches reservation, matching, clearing, and position creation.
6. The resulting position appears consistently in Portfolio, Lifecycle, Activity, and Receipts.
7. The user adds, reduces, rolls, or exits the position and sees the before-and-after risk.
8. A dated instrument reaches fixing and permissionless settlement.
9. The receipt explorer reconstructs the quote, fill, collateral, fixing, payout, fees, and evidence.
10. A controlled failure demonstrates an honest unresolved state, bounded recovery, and final reconciliation.
11. Maker and operator workspaces show the corresponding inventory, capacity, queues, risk, and actions.

## 21. Definition of the finished product

Setryn is ready for launch only when a user can discover or define a real dated exposure, obtain competing executable liquidity, understand the complete economics and risks, authorize an exact canonical instrument, clear it against real collateral, manage every supported lifecycle action, reach deterministic fixing and settlement, and independently verify the result. The same product must work on the public Sepolia release candidate with production-shaped components before any Arbitrum One funds are used.
