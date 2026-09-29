# Setryn Interface Specification

Date: 2026-09-21
Status: Build specification
Product: Setryn, the private dated-risk exchange on Arbitrum
Naming specification: [`setryn-brand-naming.md`](setryn-brand-naming.md)

## 1. Product interface decision

Build one responsive exchange platform with two first-party user experiences over the same protocol:

1. `Protect` is the goal-first application for a person, business, treasury, DAO, or investor that starts from a dated exposure and desired outcome.
2. `Trade` is the professional market interface for traders, funds, market makers, and advanced users that starts from instruments, curves, volatility, books, packages, and RFQs.

They are not separate products. A hedge created in `Protect` becomes the same canonical position shown in `Trade`, `Portfolio`, `Lifecycle`, and `Receipts`. The interface must prove that the company owns the complete workflow from exposure to settlement, not only an order ticket.

The first client is a responsive web application and installable PWA. Mobile is a deliberately composed workflow, not a desktop grid squeezed onto a phone. Native mobile can reuse the protocol client after the web state machines and transaction flows stabilize.

### Primary product objects

The interface has four primary objects:

1. A `dated exposure` states what value is at risk, in which direction, for how much, and by when.
2. A `canonical instrument or strategy` defines the forward, option, rate, event, or multi-leg payoff used to manage that exposure.
3. A `cleared position` records collateral, obligations, ownership, margin, and lifecycle rights after execution.
4. A `fixing and settlement record` proves how the terminal outcome was calculated and paid.

A multi-leg package is important but is not the product boundary. A single forward, option, or rate instrument remains a first-class market and position. The exchange must feel native to dated risk rather than like a package router with an exposure form added on top.

### Transfer boundary from package-exchange research

Borrow the protocol-grade interaction rules that improve user trust:

- one canonical schema across public books, private RFQs, and sealed auctions;
- explicit liquidity provenance, quote firmness, capacity, expiry, and eligibility;
- durable execution, fixing, settlement, and recovery timelines;
- guided and professional construction modes over the same instruments;
- evidence-backed receipts and inspectable data freshness;
- maker operations for quoting, reservations, risk, and kill switches.

Do not import multichain routing, external-venue leg orchestration, cash-and-carry positioning, or a package-only mental model. This product owns native instruments, collateral, clearing, fixing, and settlement on Arbitrum.

## 2. Benchmark conclusion

### Kryon

Kryon is the primary implementation reference for a crypto-native trading workspace. Its useful patterns are:

- a dense chart, order book, order ticket, and position grid;
- a compact market strip with price and market statistics;
- clickable order-book levels that populate the ticket;
- persisted chart and market state;
- an account bar with deposited, available, and used margin;
- positions, open orders, trades, order history, and funding in one activity rail;
- mobile tabs that keep the chart mounted and a persistent trade action bar;
- explicit mainnet and testnet selection;
- collateral deposit and withdrawal inside the trading product.

Kryon cannot define our information architecture because it is organized around one perpetual instrument at a time. Its live product currently lacks the objects that define our exchange:

- expiry selection and contract calendars;
- forward and basis curves;
- option chains, volatility surfaces, and Greeks;
- outcome-first hedge construction;
- multi-leg package building and payoff simulation;
- private multi-maker quote competition;
- quote firmness and reserved-capacity evidence;
- portfolio margin impact before execution;
- fixing, exercise, roll, novation, and settlement workflows;
- selective disclosure and execution receipts;
- maker surface management and risk operations.

The inspected Kryon implementation also exposes patterns we should improve:

- repeated literal color values should become semantic design tokens;
- a fixed 160px desktop activity panel is too shallow for lifecycle-heavy positions;
- a free TradingView embed cannot place real position and order controls on the chart, so Kryon uses a separate DOM overlay;
- raw transaction errors and network-specific language can leak into user messages;
- the mobile market strip and bottom action area can clip at narrow widths;
- market discovery is a basic table without favorites, grouping, saved filters, sorting, expiry, or curve context;
- portfolio reporting is useful but too shallow for cross-asset scenario risk and dated cash flows.

### Leading platform patterns

| Platform class | Strong interface pattern | Application to this product |
| --- | --- | --- |
| Hyperliquid and Coinbase Advanced | Fast chart, depth, ticket, activity rail, persistent settings, advanced order types | Baseline behavior for standardized public markets |
| GMX and Ostium | Clear oracle execution, collateral choice, price impact, position editing, and multi-asset discovery | Explain benchmark execution and collateral consequences before signing |
| Deribit and Aevo | Expiry chains, IV orders, selectable Greeks, scenario margin, option portfolio analysis | Make expiry, payoff, volatility, and portfolio impact first-class views |
| Paradigm | Multi-leg market builder, private RFQ, anonymous mode, counterparty selection, two-way quotes, hedge legs | Define the private package RFQ workflow and quote board |
| CME Direct and QuikStrike | Strategy builder, delta hedge, term structure, open-interest heatmaps, simulation, incremental margin | Join analysis and execution in one workspace |
| FXall, Tradeweb, MarketAxess, and Talos | RFQ, request-for-market, request-for-stream, list and portfolio trading, allocations, netting, best-execution analytics, straight-through processing | Treat execution as one step inside a complete exposure and settlement workflow |
| TradingView | Saved workspaces, watchlists, alerts, multi-chart layouts, chart trading, keyboard workflows | Provide configurable professional workspaces without hiding protocol risk |

### Arbitrum-specific non-copy boundary

Arbitrum already has strong trading products, so the interface and pitch must not claim that multi-asset trading, options, RFQ, or cross-margin alone are new:

- GMX already provides mature oracle-based perpetual execution and position management.
- Vertex established the integrated spot, perpetual, lending, and unified cross-margin pattern.
- Ostium already offers Arbitrum perpetual exposure across FX, commodities, indices, stocks, and crypto, including market schedules and RWA-aware oracle behavior.
- Premia already provides options, public orderbook quotes, and taker-bound private RFQ quotes on Arbitrum infrastructure.

Our non-copy boundary is the combination of native fixed-expiry multi-asset instruments, outcome-first exposure workflows, canonical package markets, private multi-dealer competition, firm capacity, portfolio clearing, full lifecycle operations, selective disclosure, and verifiable execution and settlement. Every major interface decision must make that boundary visible.

## 3. Information architecture

### Global navigation

- `Home`: account summary, opportunities, alerts, and pending actions.
- `Protect`: outcome-first hedge builder.
- `Markets`: multi-asset discovery, chains, curves, and standardized books.
- `Strategies`: strategy studio, saved packages, and templates.
- `RFQs`: active requests, quote competition, history, and maker responses.
- `Portfolio`: positions, exposure coverage, risk, collateral, and PnL.
- `Lifecycle`: fixing, expiry, exercise, roll, settlement, and reconciliation calendar.
- `Activity`: orders, fills, auctions, transfers, and protocol actions.
- `Receipts`: best-execution, fixing, settlement, recovery, and disclosure evidence.

### Workspace switcher

The account menu switches between:

- Personal or organization workspace;
- Trading subaccounts;
- Maker cockpit;
- Solver cockpit;
- Risk and operations console for authorized operators;
- Partner console for embedded distribution.

Switching workspace must change permissions, collateral context, positions, limits, and signing authority visibly. It must never only change a cosmetic label.

### Persistent system strip

Every application screen exposes:

- connected wallet or organization account;
- Arbitrum environment;
- collateral balance and available capacity;
- portfolio health state;
- oracle and sequencer health;
- private execution service health;
- pending signatures, settlements, or required actions;
- command search and notifications.

Testnet and simulated markets must have persistent, unmistakable environment treatment. They cannot rely on a small toggle alone.

## 4. Core customer journeys

### 4.1 Protect a dated exposure

The user selects:

1. exposure type, such as receivable, payable, inventory, debt, treasury, token unlock, or investment;
2. underlying or pair;
3. amount and direction;
4. expected date or date window;
5. accounting and settlement currency;
6. desired outcome: lock, cap loss, preserve upside, protect a range, or build a custom payoff;
7. privacy and approval policy.

The result screen compares unhedged, forward, option, collar, layered hedge, and custom package outcomes. Each candidate shows:

- guaranteed or bounded result;
- premium and all fees;
- collateral requirement;
- maximum loss and maximum payout;
- effective rate or price;
- liquidity mode and quote firmness;
- settlement asset and date;
- privacy visibility matrix;
- scenario chart and break-even points;
- lifecycle actions available after execution.

The user can request private quotes, use a standardized public market, or schedule an auction without learning derivative syntax first.

### 4.2 Trade a standardized dated market

The professional flow is:

1. select asset class, underlying, instrument family, and expiry;
2. analyze the curve, chain, payoff, depth, recent trades, and fixing specification;
3. choose public book, RFQ, sealed auction, or package execution;
4. set size, price or volatility, time in force, privacy, collateral, and lifecycle policy;
5. review portfolio margin before and after the order;
6. sign the exact compiled instrument or package;
7. monitor matching, collateral reservation, settlement, and receipt finality.

### 4.3 Build and execute a strategy

The strategy studio has two deliberate construction modes:

- `Guided` starts from an economic objective and offers curated, constrained structures with plain-language outcomes.
- `Graph` provides professional N-leg construction with typed legs, ratios, dependencies, fixing rules, settlement constraints, and a precise leg table.

A user can start from a collar, spread, calendar, basis trade, rate cap, multi-currency batch, cross-asset package, or blank graph. Natural language may populate a draft, but it cannot sign, silently choose a counterparty, or select a collateral, privacy, fixing, or recovery policy.

Every edit updates:

- payoff at expiry and through time;
- net premium or forward points;
- Delta, Gamma, Vega, Theta, carry, and basis where relevant;
- maximum profit and loss;
- break-even levels;
- collateral and scenario margin;
- direct and implied package liquidity;
- privacy compatibility;
- settlement class and recovery boundary;
- compile status and invalid-leg explanations.

Saving a strategy creates a deterministic draft, not an executable authorization. Execution always requires a compiled preview and explicit signature.

### 4.4 Run a private multi-maker RFQ

The RFQ flow has six visible stages:

1. `Build`: exact legs, ratios, quantity, expiry, optional hedge leg, allocations, and limit.
2. `Invite`: eligible makers, open or directed access, disclosure policy, and response deadline.
3. `Compete`: live two-way quotes, amount, firmness, reserved capacity, maker quality, and quote countdown.
4. `Preflight`: complete economics, portfolio impact, privacy leakage, fees, and execution rule.
5. `Clear`: submitted, matched, collateral reserved, clearing, settled, or rejected states.
6. `Receipt`: winning rule, eligible quote set commitment, execution, fixing, and settlement proof.

The quote board ranks by the user's declared objective, not a hidden frontend heuristic. The user can expand every quote to inspect net outcome, leg prices, fees, capacity evidence, maker response history, and exclusions.

Automatic ranking is permitted only among quotes with equivalent guarantee, privacy, settlement, and firmness classes. If the best price carries a different execution or disclosure risk, the interface presents the tradeoff rather than collapsing it into one winner.

The RFQ board also supports:

- request-for-market and two-way quotes so the taker can compare both directions before disclosing intent;
- explicit maker eligibility and exclusion reasons;
- quote expiry countdowns and reserved-capacity status;
- reprice, cancel selected, and cancel all actions;
- immutable history for expired, canceled, rejected, failed, and settled requests;
- a public aggregate trade tape that never reveals private RFQ contents.

### 4.5 Manage the complete lifecycle

Every open position exposes direct actions for:

- amend;
- add or remove collateral;
- unwind through competitive reverse RFQ;
- roll as one close-and-open package;
- exercise or lapse;
- split, merge, transfer, or assign;
- attach or change the protected cash flow;
- change selective-disclosure recipients;
- download accounting records;
- settle or inspect permissionless settlement status.

## 5. Professional market workspace

### Desktop composition

The default desktop layout has five regions:

1. Left rail: watchlists, asset-class tree, expiry tree, saved screens, and alerts.
2. Market header: instrument identity, expiry countdown, fixing method, mark, forward or IV, open interest, firm depth, volume, and qualification state.
3. Central analysis canvas: chart, forward curve, basis curve, option chain, volatility surface, payoff, scenario matrix, and contract specification tabs.
4. Right execution rail: public order, RFQ, auction, and package tickets.
5. Resizable lower blotter: positions, orders, RFQs, fills, lifecycle events, settlements, collateral, and receipts.

Panels are resizable, hideable, detachable, and saved per workspace. There are focused presets for `Standard Market`, `Options`, `RFQ`, `Strategy`, `Maker`, and `Risk`.

```text
+----------------------+------------------------------------------------------+----------------------+
| Markets, expiries,   | Instrument identity, expiry, fixing, qualification   | Account and system   |
| watchlists, alerts   +------------------------------------------------------+ health               |
|                      | Chart | Curve | Chain | Surface | Payoff | Scenarios  |                      |
|                      |                                                      | Book | RFQ | Auction |
|                      |                 Analysis canvas                      | Package ticket       |
|                      |                                                      |                      |
+----------------------+------------------------------------------------------+----------------------+
| Positions | Orders | RFQs | Fills | Lifecycle | Settlements | Receipts                            |
+---------------------------------------------------------------------------------------------------+
```

### Market header

A dated instrument header must prioritize:

- underlying and settlement currency;
- instrument family and payoff summary;
- expiry and exact time remaining;
- fixing source, window, and session;
- spot reference, forward or strike, mark, and implied volatility;
- bid, ask, and firm executable size;
- open interest and recent volume;
- market, oracle, privacy, and settlement qualification;
- contract specification shortcut.

Generic 24-hour high and low are secondary. A dated market is not understood from spot-style ticker statistics alone.

### Central analysis canvas

The default view changes by instrument:

- Forward or NDF: term structure and forward-points curve first, candle chart second.
- Option: option chain and volatility surface first, payoff and spot chart adjacent.
- Package: payoff diagram, leg graph, and package depth first.
- Rate product: curve, tenor ladder, and scenario shocks first.
- Commodity: forward curve, seasonality, and contract calendar first.
- Stablecoin risk: redemption basis, depeg scenarios, and liquidity state first.

### Execution rail

The execution rail supports:

- market, limit, stop, post-only, IOC, FOK, GTC, GTD, and reduce-only where valid;
- price, forward-point, premium, implied-volatility, spread, and package-outcome entry modes;
- public book, private RFQ, request-for-stream, sealed auction, and batch modes;
- amount presets and custom allocations;
- counterparty and eligibility policies;
- slippage, price impact, fee, margin, and settlement previews;
- target outcome, take-profit, stop-loss, and lifecycle instructions;
- review screen with the exact signing payload and downgrade protections.

Controls that do not apply to an instrument are removed, not disabled without explanation.

Primary actions name the economic result. Examples include `Lock EUR/USD for 30 Sep`, `Buy downside protection`, `Enter BTC December collar`, and `Roll to 31 Oct`. A generic `Trade` or `Submit` label is not sufficient at the signature boundary.

### Liquidity and quote provenance

Every executable row declares its source class:

- `DIRECT` for resting liquidity in the native instrument or strategy market;
- `IMPLIED` for liquidity derived from executable component markets;
- `MAKER_FIRM` for a signed, capacity-backed maker commitment;
- `RFQ_PRIVATE` for a response visible only under the request's disclosure policy;
- `SEALED` for an encrypted response awaiting auction clearing;
- `INDICATIVE` for a non-executable estimate.

Rows expose all-in price or outcome, available size, firmness, expiry, collateral effect, settlement class, fees, maker identity or privacy state, capacity evidence, and provenance. Indicative size is never included in executable depth. Implied liquidity displays its source markets, reservation state, invalidation conditions, and matching priority.

## 6. Market discovery

The markets screen is not one flat token table. It supports:

- asset class, underlying, payoff family, expiry, settlement asset, and execution mode filters;
- favorites, saved screens, recently traded, and organization-approved markets;
- table, expiry ladder, heatmap, term-structure, and volatility-surface views;
- sortable firm spread, available size, open interest, volume, IV, basis, annualized rate, time to expiry, and qualification columns;
- clear separation between firm, indicative, direct, and implied liquidity;
- market-session, holiday, fixing, oracle, and disruption status;
- quick actions to trade, hedge an exposure, build a package, request quotes, or set an alert.

Global search must accept symbols, asset names, exposure goals, expiries, strategy names, and contract IDs.

## 7. Portfolio and risk workspace

The portfolio home shows:

- total equity, available collateral, reserved collateral, initial margin, maintenance margin, and stress headroom;
- exposure coverage by amount and date;
- confirmed, forecast, protected, and unhedged cash flows;
- PnL split into price, volatility, time decay, carry, basis, funding, fees, and settlement;
- Delta, Gamma, Vega, Theta, DV01, currency, commodity, issuer, oracle, and settlement concentrations where applicable;
- expiry ladder and upcoming cash requirements;
- risk-domain usage and offsets;
- current and projected liquidation or default thresholds;
- scenario losses and the scenario currently binding margin;
- collateral quality, haircut, capacity, and withdrawal availability.

Positions can be grouped by entity, subaccount, exposure, strategy, underlying, expiry, counterparty class, or settlement date. A package can be expanded into legs without losing its package identity.

## 8. Lifecycle and settlement center

The lifecycle center uses a timeline and calendar to show:

- quote and order expiry;
- fixing observation windows;
- market holidays and business-day adjustments;
- option exercise cutoffs;
- maturity and settlement dates;
- collateral calls and capacity release;
- scheduled rolls, auctions, and compression cycles;
- missing oracle data or market disruption;
- pending reconciliation and required user action.

Each settlement has a state timeline with observed prices, rule version, fallback path, payout calculation, transaction status, and receipt. Unknown submission, pending clearing, rejected clearing, recovery, and settled are distinct states.

The timeline is durable and remains available after route changes, wallet reconnects, browser refreshes, and terminal completion. It exposes the instrument or strategy ID, order ID, quote commitment, transaction hashes, fixing record, payout record, and receipt hash where applicable.

## 9. Maker operating system

The maker cockpit is a first-class product with:

- RFQ inbox with eligibility, privacy, response deadline, and requested structure;
- one-click or automated two-way quoting;
- leg-price and package-price editing;
- parametric quote surfaces across underlying, tenor, strike, size, and cap;
- reference-price offsets and constant-work surface repricing;
- inventory, Greeks, carry, basis, collateral, and concentration views;
- firm-capacity reservations and future capacity forecast;
- hedge actions and hedge execution status;
- spread, fill rate, response rate, adverse selection, PnL, and quote-quality analytics;
- per-market, per-asset, per-counterparty, and portfolio limits;
- cancel-all, reduce-only, and scoped kill switches;
- delegated signer and API-session management;
- replayable automation decisions and incident timeline;
- RFQ intake preferences by product, asset, tenor, size, counterparty class, privacy mode, and settlement risk;
- quote toxicity, adverse-selection, response-latency, and post-trade markout analytics;
- reserved, available, withdrawal-delayed, and recovery capacity as separate balances;
- session-level and global kill switches with visible cancellation scope.

The maker UI must show what is private from other makers, visible to the taker, committed onchain, and revealed after execution.

## 10. Risk and operations console

Authorized operators need:

- oracle, sequencer, keeper, privacy coordinator, indexer, and RPC health;
- market and dependency qualification;
- open interest, concentration, collateral, and risk-domain caps;
- maker solvency and capacity reservation health;
- auction, fixing, settlement, recovery, and reconciliation queues;
- insurance and default-fund accounting;
- default auction workflow;
- alert triage, incident timeline, and deterministic replay;
- scoped pause controls that preserve safe exits, settlement, and withdrawal;
- upgrade, role, delay, and multisig status;
- mainnet cost and gas budget monitoring.

## 11. Mobile product

The mobile navigation is:

- `Discover`;
- `Protect`;
- `Portfolio`;
- `Activity`;
- `Account`.

The advanced terminal remains available through task tabs, but the phone defaults to goal-first flows. An instrument detail page uses vertically stacked sections for outcome, curve or chart, quotes or depth, risk, and ticket. The primary action remains visible without covering content.

Mobile requirements:

- minimum 44px interaction targets;
- no clipped market statistics or action buttons at 320px width;
- inputs use at least 16px text to prevent browser zoom;
- wallet, approval, signature, and settlement states survive route changes;
- long tables become labeled cards or horizontal data grids with visible scroll affordance;
- maker users can receive RFQs, quote, cancel, and trigger a kill switch safely;
- critical oracle, margin, fixing, and settlement alerts support push notifications;
- no private key, delegated trading authority, or secret quote material is stored in notification payloads.

The final mobile signing sheet always shows the named economic outcome, exact instrument or strategy, collateral change, all fees, maximum loss, fixing and settlement method, privacy visibility, approval authority, and environment. Complex graph editing and market-wide maker operations remain desktop-first, but monitoring, quoting, canceling, rolling, exercising, settling, and bounded risk reduction remain possible on mobile.

## 12. Transaction and state UX

Every state-changing action uses a domain-specific state machine.

### Collateral

`Review -> Approve if required -> Deposit or withdraw -> Confirming -> Available or failed`

### Public order

`Draft -> Preflight -> Sign -> Submitted -> Open or partial -> Filled, canceled, expired, or rejected`

### Private RFQ

`Draft -> Encrypt -> Invite -> Collecting quotes -> Quote selected -> Capacity reserved -> Sign -> Submitted -> Included or submission unknown -> Reconciling -> Clearing -> Settled, rejected, or recovery required -> Receipt`

### Dated settlement

`Live -> Fixing window -> Fixing observed or unavailable -> Payout computed -> Challenge or fallback if required -> Settling -> Included or submission unknown -> Reconciling -> Reconciled or manual intervention`

The UI must never show success at wallet signature. It shows success only when the protocol state reaches the action's defined terminal condition.

Errors are translated into user language and retain technical details in an expandable diagnostic panel. Every recoverable failure presents the exact next action.

Every state-changing control derives its label and disabled state from wallet connection, Arbitrum network, permissions, allowance, balance, collateral, market state, transaction submission, receipt state, and indexed protocol state. Wallet submission and onchain confirmation are separate states. A rejected wallet request cannot leave the action locked, and a pending transaction cannot re-enable a duplicate submission path.

An amendment is displayed as cancel-and-replace when that is its actual protocol behavior. Before signature, the user sees priority loss, quote or capacity invalidation, collateral changes, authorization changes, and any new fees.

### Data trust model

Every material number is classified as one of:

- `OBSERVED`: read from an identified oracle, venue, chain event, or signed record;
- `EXECUTABLE`: backed by an active order, quote, auction rule, or reserved commitment;
- `ESTIMATED`: calculated from current executable inputs but not itself guaranteed;
- `MODELED`: produced by a scenario, forecast, volatility model, or stress assumption.

Inspection reveals source, observation time, block or sequence where relevant, freshness threshold, calculation version, and degraded or stale state. A chart and table being compared use the same versioned market-data snapshot. Venue mark, oracle index, external reference, model value, and executable price are never silently substituted for one another.

A disabled action explains the exact missing balance, allowance, permission, market qualification, oracle state, maker capacity, or lifecycle condition. Unsupported behavior is removed rather than rendered as decorative functionality.

## 13. Visual system

### Direction

Use a restrained professional terminal aesthetic:

- near-black application background with two clearly separated panel elevations;
- one brand accent for focus, selection, and primary neutral actions;
- green and red only for economic direction or result;
- amber for risk and pending action;
- blue or violet for private, cryptographic, and informational states;
- tabular monospaced numerals and a highly legible sans-serif interface face;
- compact desktop density with deliberate whitespace around decision summaries;
- borders and tonal separation instead of excessive cards, shadows, or gradients.

### Semantic tokens

At minimum define tokens for:

- application, panel, panel-raised, and input surfaces;
- primary, secondary, muted, and disabled text;
- border, separator, focus, selected, and hover states;
- positive, negative, warning, pending, private, and critical states;
- bid, ask, mark, index, strike, fixing, liquidation, and break-even lines;
- public, RFQ, auction, direct, and implied liquidity.

### Density and data behavior

- Desktop body text is generally 12px to 14px, with 14px as the default for important interactive copy.
- Prices and amounts use tabular numerals and stable decimal alignment.
- Tables support sticky headers, column resizing, show or hide columns, density, sorting, filtering, and saved views.
- Values update without changing column width or causing layout shift.
- Streaming changes use restrained flashes with reduced-motion support.
- Every chart, curve, and surface has a table equivalent and data provenance.
- Observed, executable, estimated, and modeled values have persistent labels that remain distinguishable without relying on color.
- Mainnet, testnet, fork, conformance, and simulation evidence use persistent environment labels.
- Success color is reserved for terminal protocol outcomes, never wallet signature or transaction broadcast.

## 14. Build route map

Build the application shell and the complete product route system before decorative marketing work:

1. `/app` account and system home.
2. `/protect/new` exposure and outcome builder.
3. `/exposures` imported, forecast, confirmed, netted, and protected exposures.
4. `/markets` discovery with table, expiry ladder, heatmap, curve, and surface modes.
5. `/trade/[market]` standardized market terminal.
6. `/strategies` saved packages, templates, catalogue, and performance.
7. `/strategies/new` multi-leg strategy studio.
8. `/rfqs` active requests, responses, and history.
9. `/rfqs/new` RFQ builder.
10. `/rfqs/[id]` quote competition and clearing timeline.
11. `/auctions` sealed and batch auction board.
12. `/portfolio` portfolio, collateral, coverage, and risk.
13. `/positions/[id]` complete lifecycle management.
14. `/lifecycle` fixing, expiry, roll, and settlement calendar.
15. `/settlements` fixing observations, payouts, reconciliation, and exceptions.
16. `/activity` orders, fills, transfers, signatures, and protocol actions.
17. `/receipts/[id]` verifiable execution and settlement evidence.
18. `/alerts` market, risk, fixing, settlement, and system alerts.
19. `/maker` maker RFQ inbox, surfaces, inventory, risk, analytics, and automation.
20. `/solver` solver opportunities, routes, capacity, performance, and recovery.
21. `/ops` risk, dependency, qualification, incident, and default-management console.
22. `/developers` API keys, delegated signers, SDKs, webhooks, and integration logs.
23. `/partners` embedded deployments, permissions, attribution, and revenue reconciliation.
24. `/settings` organizations, subaccounts, roles, approvals, privacy, and security.

All routes use the same typed market, instrument, package, quote, position, settlement, and receipt objects. Demo data and testnet data must implement the production schemas instead of using page-specific mocks.

## 15. Acceptance bar

The interface is product-grade when a judge or user can complete these flows without narration:

1. Enter a future cash flow and compare several bounded outcomes.
2. Inspect a multi-asset dated market through the correct curve, chain, or payoff view.
3. Build a multi-leg strategy and see its economics, margin, and failure boundaries update live.
4. Request private quotes from several makers and understand why one quote wins.
5. Execute on testnet with production-shaped collateral, oracle, privacy, and settlement states.
6. Observe the position in both plain-language protection and professional risk views.
7. Roll or unwind the position as one lifecycle action.
8. Trigger fixing and settlement, then verify the receipt and payout.
9. Quote the request from the maker cockpit and observe capacity reservation and inventory impact.
10. Inspect the same activity from the operations console with oracle and protocol evidence.
11. Distinguish observed, executable, estimated, and modeled values without opening documentation.
12. Compare quotes without hiding differences in firmness, privacy, capacity, fixing, or settlement risk.
13. Refresh during execution or settlement and resume from the authoritative protocol state without losing context.
14. Recognize the product as a dated-risk exchange after removing its logo, name, and brand color.

A polished candle chart and buy or sell ticket alone do not satisfy this bar.

## Sources

- [Kryon live trading application](https://kryonprotocol.live/trade/BTC-PERP)
- [Hyperliquid order types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types)
- [Coinbase Advanced dashboard](https://help.coinbase.com/coinbase/trading-and-funding/advanced-trade/dashboard-overview)
- [GMX positions and order types](https://docs.gmx.io/docs/trading/order-types/)
- [Deribit Block RFQ](https://support.deribit.com/hc/en-us/articles/25951371614621-Deribit-Block-RFQ)
- [Deribit combo books](https://support.deribit.com/hc/en-us/articles/31424954956061-Combo-Books)
- [Deribit Position Builder](https://support.deribit.com/hc/en-us/articles/31238900906781-Position-Builder)
- [Aevo portfolio margin](https://docs.aevo.xyz/aevo-products/aevo-exchange/trading-on-aevo/options-specifications/portfolio-margin)
- [Paradigm Unified Markets](https://docs.paradigm.co/unified-markets/summary)
- [Paradigm interface workflow](https://www.paradigm.network/help/getting-started/unified-markets)
- [LSEG FXall](https://www.lseg.com/en/fx/venues/fxall-electronic-trading-platform)
- [Tradeweb trade workflows](https://www.tradeweb.com/our-markets/institutional/trade-cycle/)
- [MarketAxess RFQ-hub](https://www.marketaxess.com/trade/rfq-hub)
- [Talos trading platform](https://www.talos.com/our-solutions/trading)
- [CME QuikStrike](https://www.cmegroup.com/tools-information/quikstrike.html)
- [TradingView Supercharts](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/)
- [Ostium documentation](https://ostium-labs.gitbook.io/ostium-docs)
- [Vertex overview](https://docs.vertexprotocol.com/getting-started/overview)
- [Premia orderbook and RFQ](https://docs.premia.blue/the-premia-protocol/concepts/orderbook-and-request-for-quote-rfq)
