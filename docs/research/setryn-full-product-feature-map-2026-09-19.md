# Setryn Full Product and Feature Map

Date: 2026-09-19
Network: Arbitrum One mainnet only
Product decision: Build Setryn as a private fixed-expiry, multi-asset risk exchange with native markets, verifiable clearing, and complete lifecycle infrastructure
Relationship to prior research: Expands the product boundary in `setryn-product-decision-2026-09-19.md`. It does not revive FeeRate, Blindbook, a perpetual DEX, or an ORDR clone.

## Executive decision

Setryn is a complete multi-asset exchange, not a single capped-loan-like hedge contract, not a EUR/USD application, and not a treasury dashboard over another venue.

A person, business, DAO, fund, or protocol records a dated exposure, chooses the outcome it needs, receives competing firm prices from market makers, executes a fixed-expiry hedge or investment, and manages that position through settlement, amendment, unwind, roll, reporting, and reconciliation. The exposure can be an exchange rate, commodity input, interest rate, equity index, tokenized asset, crypto asset, stablecoin peg, treasury holding, debt obligation, token unlock, or a package spanning several of them. The protocol creates the instrument, reserves collateral, matches the trade, owns the position state, calculates the payout, and settles it in native USDC or an explicitly qualified deliverable asset on Arbitrum One.

The defining product sentence is:

> A private-by-default exchange for locking the future price, rate, index, or exchange-rate outcome of a real cash flow, asset, inventory position, debt obligation, treasury holding, or investment exposure, with competitive onchain price discovery, bounded counterparty risk, automatic settlement, and selective disclosure.

The product has eight inseparable systems:

1. A consumer and business application organized around invoices, payroll, procurement, subscriptions, debt service, inventory, token unlocks, treasury balances, and other dated exposures.
2. Native fixed-expiry markets for FX, crypto, commodities, rates, indices, tokenized assets, and cross-asset packages.
3. A liquidity network with firm RFQs, encrypted sealed auctions, standardized batch markets, and professional maker tooling.
4. A clearinghouse with collateral reservation, netting, risk limits, lifecycle operations, oracle fixing, and default management.
5. A confidentiality and fairness layer that protects order intent, quotes, positions, business activity, and settlement without hiding solvency from the protocol or approved auditors.
6. A canonical package and implied-liquidity layer that turns forwards, options, spot liquidity, cash flows, and lifecycle actions into interoperable strategy markets.
7. An open solver and firm-capacity network that proves execution authority, capital, route quality, and recovery capability rather than merely advertising indicative prices.
8. A protocol evidence and distribution layer with deterministic replay, qualified integrations, builder attribution, embedded products, and independently verifiable execution records.

This is the Kimia lesson applied correctly. Kimia is deep because six programs compose into one user outcome: a perpetual engine, hedged vault, PT and YT splitter, yield AMM, intent router, and stablecoin system. Copying its funding-rate product would be wrong for Arbitrum, but matching its depth means owning every primitive required for our own outcome. [Kimia architecture](https://docs.kimia.live/architecture)

This is also the ORDR lesson applied correctly. ORDR is not interesting because it has a trading screen. It is interesting because it attacks the market maker bottleneck with private maker accounts, shared capital, constant-cost repricing, and protection from toxic flow. Our equivalent is a collateral-efficient maker account, parametric forward and volatility surfaces, firm quote capacity, private RFQs, and fair settlement. [ORDR](https://ordr.trade/)

## Research notes and limits

Most hackathon projects do not turn into successful startups. Projects mentioned here are useful for understanding mechanisms and seeing what has been attempted. They may no longer be active, so current status must be verified before making competitive claims.

The product map is intentionally not constrained to a hackathon-sized MVP. The labels describe product role, not an excuse to omit features:

- `B` means baseline. A credible exchange is incomplete without it.
- `D` means defining. This is part of why users or makers choose this exchange.
- `S` means scale. It becomes necessary as markets, capital, integrations, and regulatory responsibilities grow.

The map contains 461 concrete capabilities: 169 baseline exchange requirements, 192 product-defining capabilities, and 100 scale capabilities. This count excludes architecture components, threat-model controls, product pages, and rejected distractions listed elsewhere in the document.

### Scope commitment

The complete protocol and all eight product surfaces are the project boundary. Baseline, defining, and scale labels describe the function of a capability, not whether it will be removed. Mainnet gates control limits, counterparties, risk domains, and public access while the implementation, schemas, interfaces, simulations, and product surfaces retain the complete design.

More features do not solve the three hardest non-feature problems: licensed distribution, committed market makers, and repeat cash-flow demand. Those remain company risks.

## What serious exchanges and adjacent products teach us

### Kimia: own a composed financial outcome

Kimia documents six interoperating programs and the complete lifecycle around them. It includes an orderbook, collateral and margin, mark price, funding, liquidations, an insurance fund, permissionless keepers, a delta-neutral vault, tokenized principal and yield, a maturity-aware AMM, an intent state machine, generated clients, events, error handling, risk disclosures, and security work. The lesson is not to copy all six mechanisms. The lesson is that a deep protocol owns the machinery underneath its headline outcome. [Kimia documentation index](https://docs.kimia.live/llms.txt), [Kimia perpetual engine](https://docs.kimia.live/programs/kimia-perp)

### ORDR: optimize for makers, not only takers

ORDR gives each maker an independent book, lets one vault support markets, stores orders relative to a mid price so a complete book can be repriced in constant work, and uses protected sequencing so makers can cancel before toxic arbitrage reaches stale quotes. Its own terms correctly say the design reduces but does not eliminate MEV. Our market needs the same honesty. [ORDR product](https://ordr.trade/), [ORDR terms](https://www.ordr.trade/terms)

### Hyperliquid, GMX, and Aevo: the risk engine is the exchange

Hyperliquid exposes market, limit, trigger, scale, and TWAP orders, subaccounts, maker rebates, isolated and cross margin, portfolio margin, liquidations, ADL, self-trade prevention, vaults, and APIs. GMX adds explicit execution details, oracle spreads, pool selection, dynamic open-interest constraints, two-phase execution, risk-isolated pools, and clear treatment of price impact. Aevo shows that options require scenario-based portfolio margin, not a simplistic leverage slider. [Hyperliquid trading](https://hyperliquid.gitbook.io/hyperliquid-docs/trading), [GMX order types](https://docs.gmx.io/docs/trading/order-types/), [Aevo portfolio margin](https://docs.aevo.xyz/aevo-exchange/options-specifications/portfolio-margin)

### CME and Deribit: multi-asset depth comes from common clearing and native packages

CME's risk systems cover futures, options, OTC FX, and interest-rate swaps, but tailor margin to the behavior of each product group, including liquidity, seasonality, volatility, correlation, and event risk. Its portfolio tools expose hypothetical portfolios, incremental margin, offsets, and optimization rather than treating every instrument as an isolated trade. Deribit's combo books execute several related legs at one package price, removing leg risk while leaving each position independently manageable afterward. The protocol should copy these structural properties: one clearing account and package language, asset-specific risk engines, scenario analysis before execution, and native multi-leg books. It should not flatten every asset into the same oracle plus leverage formula. [CME margin services](https://www.cmegroup.com/solutions/risk-management/margin-services.html), [CME futures and options margin model](https://www.cmegroup.com/solutions/risk-management/performance-bonds-margins/futures-and-options-margin-model.html), [Deribit combo books](https://support.deribit.com/hc/en-us/articles/31424954956061-Combo-Books)

### Hashflow, 0x, CoW, and Drift: execution is a set of modes

Hashflow uses cryptographically signed firm RFQ prices to remove slippage and sandwich risk. 0x demonstrates quote expiry, taker binding, unique salts, partial fill, fill-or-kill, delegated signers, and bulk cancellation. CoW uses combinatorial batch auctions and coincidence of wants. Drift combines a just-in-time maker auction, committed orders, and last-resort AMM liquidity. A serious venue does not force every trade through one matching mechanism. [Hashflow](https://docs.hashflow.com/hashflow), [0x RFQ orders](https://docs.0xprotocol.org/en/development/basics/orders.html), [CoW Protocol](https://docs.cow.fi/), [Drift matching](https://docs.drift.trade/developers/market-makers/orderbook-and-matching)

### Renegade and Fairblock: privacy has separate pre-trade and post-trade jobs

Renegade hides orders before matching with MPC and hides settlement state with zero-knowledge proofs. It also supports opt-in counterparty identity requirements. Fairblock shows that Arbitrum Stylus can support encrypted sealed-bid auctions and threshold decryption. The correct design is selective disclosure, not absolute opacity: the public should not see a company's payroll hedge, but the user, counterparty, approved auditor, and regulator may require different access. [Renegade](https://renegade.fi/), [Arbitrum confidentiality](https://arbitrum.io/why-arbitrum/features/confidentiality), [Fairblock auctions](https://blog.arbitrum.io/how-fairblock-is-unlocking-confidential-payments-and-auctions-on-arbitrum/)

### FXall, Bloomberg FXGO, 360T, and Kantox: the trade is only the middle

Institutional FX products cover spot, forwards, swaps, NDFs, and options. They provide RFQ, request-for-stream, anonymous books, resting and algorithmic orders, order splitting, multi-bank batches, allocations, confirmations, settlement instructions, straight-through processing, transaction-cost analysis, and FIX APIs. Treasury systems add exposure collection, policy automation, netting, valuation, hedge accounting, reconciliation, and ERP integration. Our exchange should compress this entire workflow into a self-custodial product rather than recreate only the execution ticket. [LSEG FXall](https://www.lseg.com/en/fx/venues/fxall-electronic-trading-platform), [Bloomberg FXGO](https://professional.bloomberg.com/products/trading/electronic-markets/fx-electronic/), [360T products](https://www.360t.com/products/), [Kantox](https://www.kantox.com/)

## Product surfaces

The company should ship one protocol and eight first-party product surfaces.

### 1. Exposure and hedge application

The default application is for a person, contractor, internet business, finance operator, payment company, DAO, treasury, or investor. It speaks in goals and exposures, not derivative jargon.

- `/hedge`: create a hedge from exposure type, underlying, amount, direction, date, and desired outcome.
- `/exposures`: import, group, net, schedule, and monitor cash flows, inventory, debt, treasury, unlocks, and investments.
- `/markets`: discover qualified FX, commodity, rate, index, tokenized-asset, crypto, and cross-asset markets.
- `/portfolio`: view active protection, budget rate, worst-case result, collateral, and lifecycle actions.
- `/settlements`: see fixing status, payout, reconciled cash flow, and downloadable records.
- `/policies`: configure hedge ratios, allowed instruments, approval thresholds, and automation.

### 2. Markets terminal

The advanced interface exposes standardized expiries, forward curves, option surfaces, public aggregate depth, recent executions, order tickets, portfolio Greeks, and batch-auction status. It serves sophisticated traders without forcing business users into a pro terminal.

### 3. Maker terminal

Market makers manage collateral, quote surfaces, inventory, RFQs, fills, Greeks, risk limits, hedges, performance, and API sessions. This is a first-class product, not an internal admin page.

### 4. Risk and operations console

Operators monitor oracle health, settlement queues, exposure caps, maker solvency, privacy infrastructure, abnormal order flow, disputed events, upgrades, and incidents. Emergency controls must preserve unwind, repayment, and withdrawal paths.

### 5. Developer platform

Payment companies, wallets, payroll products, invoicing tools, treasury systems, and autonomous software can create cash flows, request prices, execute, monitor, settle, and export records through APIs and SDKs.

### 6. Strategy and package studio

Advanced users construct, simulate, compare, save, and execute collars, layered hedges, rolls, option spreads, calendar and basis trades, multi-asset baskets, correlation trades, multi-currency batches, and custom exposure packages. The studio compiles every visual strategy into the same typed package format used by APIs and solvers.

### 7. Protocol and receipt explorer

Users, auditors, integrators, and researchers inspect qualified markets, template manifests, risk domains, aggregate liquidity, fixing evidence, terminal outcomes, route decisions, settlement proofs, and selectively disclosed private records without trusting the first-party interface.

### 8. Partner and distribution console

Wallets, payroll products, payment companies, accounting systems, treasury platforms, strategy publishers, and brokers manage embedded deployments, builder identities, fee schedules, permissions, customer cohorts, qualification state, support, attribution, and revenue reconciliation.

## Complete feature map

### A. User application and portfolio

- `B` Cash-flow-first hedge ticket with receive or pay direction, currency, amount, date, and accounting currency.
- `B` Plain-language outcome selector for lock a rate, cap a bad move, preserve upside, or protect a range.
- `B` Quote comparison showing fixed rate, premium, protocol fee, collateral, maximum payout, and effective all-in rate.
- `B` Position dashboard with current mark, protected amount, expiry, collateral, unrealized value, and settlement state.
- `B` Complete transaction and lifecycle history with human-readable status and explorer evidence.
- `B` Active-order management with amend, cancel, partial-fill status, quote expiry, and failure recovery.
- `B` Cash-flow and hedge calendar with fixing dates, market holidays, settlement dates, and reminders.
- `B` Funding, withdrawal, bridge, and collateral-transfer flows inside the product.
- `D` Side-by-side scenario chart for unhedged, forward, option, collar, and current spot outcomes.
- `D` Budget-rate protection view showing exactly what business margin is protected.
- `D` Hedge coverage meter that distinguishes confirmed, forecast, and unhedged exposure.
- `D` Private-by-default activity view with explicit disclosure controls per position.
- `S` Portfolio workspace that groups hedges by entity, department, invoice, customer, vendor, or strategy.
- `S` White-label embedded hedge component for payroll, invoice, wallet, and payment applications.

### B. Instruments and market design

- `B` Cash-settled capped NDF with a defined pair, direction, strike, cap, notional, fixing, and settlement currency.
- `B` Standardized weekly and monthly capped-forward series for comparable public price discovery.
- `B` Custom-date bilateral capped forwards for exact invoice and payroll dates.
- `B` European FX calls and puts with bounded buyer loss and fully collateralized writer exposure.
- `B` Contract specifications covering tick, lot, notional bounds, calendar, fixing, payout rounding, and disruption rules.
- `D` Zero-cost and premium collars built as atomic call-and-put packages.
- `D` Participating forwards that guarantee a base rate while preserving a disclosed fraction of upside.
- `D` Window forwards for cash flows whose final date can move inside a defined interval.
- `D` Average-rate contracts for businesses exposed across a payroll or billing period rather than one timestamp.
- `D` Layered hedge packages that spread one exposure across multiple strikes and expiries.
- `D` Multi-leg strategy compiler with atomic package pricing, collateral, fill, and lifecycle state.
- `D` Deliverable stablecoin forwards when both currency assets have sufficient liquidity and valid redemption paths.
- `S` FX swaps combining near and far legs for rolling treasury balances.
- `S` Risk reversals, call spreads, put spreads, butterflies, and other bounded option packages.
- `S` User-defined templates with deterministic validation against the protocol's supported payoff grammar.
- `S` Instrument versioning so old positions retain immutable rules while new series adopt improved templates.

### C. Execution and order management

- `B` Multi-dealer firm RFQ for bespoke notional, expiry, cap, and direction.
- `B` EIP-712 signed quotes with chain ID, verifying contract, maker, taker, terms, fee, expiry, nonce, and salt.
- `B` Fill-or-kill and partial-fill behavior with explicit minimum fill size.
- `B` Quote time-to-live and visible countdown.
- `B` Maker, taker, pair, and global nonce cancellation.
- `B` Delegated quote signers that cannot withdraw maker collateral.
- `B` Market, limit, and resting orders for standardized contract series.
- `B` Good-till-cancelled, good-till-time, immediate-or-cancel, fill-or-kill, post-only, and reduce-only flags.
- `B` Self-trade prevention and duplicate-order protection.
- `B` Take-profit, stop-loss, and target-rate triggers for secondary exits where appropriate.
- `D` Encrypted multi-dealer RFQ where invited makers see only the request and the public sees no pre-trade intent.
- `D` Threshold-encrypted sealed auction with one deterministic clearing rule.
- `D` Frequent uniform-price batch auction for standardized contracts.
- `D` Coincidence-of-wants matching that nets opposing customer cash flows before using maker balance sheets.
- `D` Request-for-stream for recurring users who need continuous firm pricing for a pair and tenor range.
- `D` Firm quote capacity reservation so a maker cannot drain collateral and invalidate an accepted price.
- `D` Best-execution receipt proving which eligible quote won under the user's declared rule.
- `S` Algorithmic execution for large packages, including time slicing, notional slicing, and randomized scheduling.
- `S` Portfolio batch execution across currencies, dates, allocations, and legal entities.
- `S` Off-platform trade capture for counterparties that negotiate privately but want protocol clearing and lifecycle services.

### D. Liquidity and matching network

- `B` Public aggregate market view that separates firm depth from indicative liquidity.
- `B` Maker invitation lists and open RFQs with configurable eligibility.
- `B` Standard-series public book of signed orders with price-time or batch priority defined per market.
- `B` Atomic matching and collateral lock at acceptance.
- `B` Deterministic fee and rebate calculation at fill.
- `D` Hybrid liquidity waterfall: private RFQ, sealed auction, public batch book, then optional protocol backstop.
- `D` Parametric quote surfaces across pair, notional band, expiry, strike, and cap.
- `D` Relative-price orders expressed as forward points or volatility offsets from a trusted reference.
- `D` One-operation repricing of a maker's complete eligible quote surface after the reference market moves.
- `D` Cross-user natural netting before maker routing.
- `D` Maturity-bucket netting so offsetting positions consume less incremental maker collateral.
- `D` Position compression cycles that replace offsetting bilateral trades with smaller net obligations.
- `S` Permissionless market creation governed by a strict instrument grammar and risk templates.
- `S` Clearing-only access for approved external frontends and OTC desks.
- `S` Liquidity quality score based on spread, response rate, firm-fill rate, uptime, and settlement performance.

### E. Collateral, margin, and clearing

- `B` Native USDC collateral and settlement on Arbitrum One.
- `B` Segregated user collateral ledger with verifiable deposits, reservations, release, and withdrawals.
- `B` Maximum-loss collateralization for capped instruments and long options.
- `B` Per-market, per-maker, per-user, and global open-interest caps.
- `B` Collateral checks at order creation, fill, position transfer, amendment, and withdrawal.
- `B` Mark-to-market calculation and disclosed valuation source.
- `B` Risk-isolated market buckets so failure in one currency or instrument does not automatically consume every pool.
- `B` Default waterfall with explicit order: position collateral, maker margin, insurance reserve, default fund, and final loss allocation.
- `B` Insurance and default-fund accounting separated from protocol revenue.
- `D` Unified maker account that supports all pairs and tenors while reserving risk per fill.
- `D` Cross-position netting for offsetting delta, expiry, and payout exposures.
- `D` Scenario-based portfolio margin for options and multi-leg packages.
- `D` Variation-margin process for undercollateralized professional portfolios.
- `D` Collateral utilization and projected margin simulation before accepting an order.
- `D` Concentration, jump, gap, stablecoin-depeg, and correlation stress tests.
- `S` Multiple approved collateral assets with oracle haircuts, concentration caps, and liquidity requirements.
- `S` Yield-bearing collateral adapters with segregated risk and immediate exit capacity.
- `S` Default auctions for transferring a distressed maker portfolio rather than immediately closing every position.
- `S` Mutualized clearing membership with contribution requirements, exposure tiers, and loss-sharing rules.
- `S` Proof-of-solvency and aggregate liabilities attestations compatible with confidential positions.

### F. Position lifecycle

- `B` Open, partially fill, fully fill, expire, cancel, mature, settle, and close states.
- `B` Permissionless settlement after a valid fixing becomes available.
- `B` Early unwind through a competitive reverse RFQ.
- `B` Roll to a new expiry as one atomic close-and-open package.
- `B` Position receipt and complete audit trail for every state transition.
- `D` Amend amount, cap, strike, or date through consensual novation with a disclosed value adjustment.
- `D` Split one position into smaller positions without changing aggregate economics.
- `D` Merge economically identical positions.
- `D` Transfer or assign a position subject to collateral and eligibility checks.
- `D` Exercise, lapse, and cash-settle option lifecycle.
- `D` Partial settlement for cash flows received or paid in tranches.
- `D` Cash-flow linkage that records which invoice, payroll run, or obligation a position protects.
- `S` Portfolio compression and multilateral novation rounds.
- `S` Succession and recovery rules for organization wallets and lost signing devices.
- `S` Dispute state for objective market disruption events, never for discretionary repricing after a loss.

### G. Oracle, fixing, and settlement

- `B` Pyth multi-asset pull-price integration with publish-time, staleness, confidence, feed-ID, benchmark-type, and market-session validation.
- `B` Deterministic fixing window rather than first-caller-selected settlement price.
- `B` Time-weighted or observation-median fixing rule defined in each instrument specification.
- `B` Currency market calendars, holidays, daylight-saving changes, and business-day adjustments.
- `B` Decimal precision and round-against-protocol rules that prevent dust arbitrage.
- `B` Sequencer downtime detection and recovery grace period.
- `D` Independent fallback oracle with precommitted activation criteria.
- `D` Cross-source deviation check around fixing and settlement.
- `D` Market-disruption policy for missing observations, closed markets, and extraordinary price gaps.
- `D` Batched settlement across a complete expiry series.
- `D` ZK settlement proof that calculates payout from public fixing data and committed private terms.
- `S` Deliverable payment-versus-payment settlement for sufficiently liquid currency stablecoins.
- `S` Settlement netting by user, maker, currency, and expiry.
- `S` Published fixing attestations and reproducible settlement calculator.

### H. Confidentiality and selective disclosure

- `B` Explicit privacy model separating public, counterparty-visible, operator-visible, auditor-visible, and user-only data.
- `B` Encrypted RFQ requests so the public cannot see pair, direction, size, or expiry before execution.
- `B` Encrypted or pairwise delivery of maker quotes.
- `B` One-time RFQ identifiers and unlinkable request channels.
- `B` Per-position viewing keys controlled by the user or organization.
- `D` Commitment-based position ledger hiding exact notional, strike, cap, expiry, owner, and PnL.
- `D` Nullifiers that prevent a private position or payout from being used twice.
- `D` Zero-knowledge proof of valid instrument terms, collateral coverage, and state transition.
- `D` Confidential payout notes that do not reveal a user's entire portfolio at settlement.
- `D` Selective disclosure packages for counterparties, auditors, accountants, and regulators.
- `D` Credential proof that shows eligibility without publishing identity to the market.
- `D` Threshold recovery of encrypted organization state when authorized signers rotate or disappear.
- `D` Batched deposits, withdrawals, and settlement to reduce timing and amount reconstruction.
- `S` FHE-assisted private risk aggregation for limits and portfolio margin where justified by performance.
- `S` Privacy-preserving aggregate open interest, solvency, and concentration proofs.
- `S` User privacy report that explains remaining leakage from deposits, withdrawals, timing, counterparties, and small anonymity sets.

### I. MEV and execution fairness

- `B` Signed firm prices so transaction ordering cannot worsen an accepted exchange rate.
- `B` Taker-bound quotes that cannot be copied and filled by another account.
- `B` Nonces, expiries, chain binding, contract binding, and replay protection.
- `B` Slippage and maximum-cost bounds enforced by the settlement contract.
- `B` Oracle-independent quote acceptance followed by deterministic payout at the contractual fixing.
- `D` Sealed bids that prevent makers from copying, shading, or reacting to competing quotes.
- `D` Uniform clearing prices for standardized batch markets so queue position does not determine price.
- `D` Commit and reveal or threshold encryption for public batch orders.
- `D` Firm quote collateral reservation that eliminates maker cancel-versus-fill races.
- `D` Randomized or verifiable tie breaking among economically identical bids.
- `D` Batch settlement so the caller cannot select a favorable observation or ordering.
- `D` MEV monitoring that classifies frontruns, backruns, failed fills, quote fading, and suspicious maker behavior.
- `S` Protected transaction submission with multiple relay paths and public fallback.
- `S` Sequencer and Timeboost exposure analytics without claiming that chain ordering alone prevents all MEV.
- `S` Solver or auctioneer bond with objective slashing for censorship, invalid outcomes, or omitted eligible bids.
- `S` Fairness proofs or reproducible auction transcripts that reveal the outcome without revealing losing commercial terms.

### J. Market maker product

- `B` Maker onboarding, collateral deposit, withdrawal, and account health.
- `B` RFQ inbox with accept, decline, auto-quote, and reason codes.
- `B` Inventory, delta, vega, tenor, expiry, currency, and counterparty exposure dashboard.
- `B` Quote surface editor across notional bands, forward points, volatility, cap, and tenor.
- `B` Mass cancel, per-market cancel, dead-man's switch, and cancel-on-disconnect.
- `B` API keys and delegated session keys with granular permissions.
- `B` Real-time fills, open quotes, reserved collateral, free collateral, fees, and PnL.
- `B` REST, WebSocket, and FIX-compatible connectivity.
- `D` Constant-work repricing of quote surfaces relative to spot, forward, or volatility references.
- `D` Automatic quote skew from maker inventory and risk limits.
- `D` Pre-trade margin simulation and capacity-aware quoting.
- `D` Private maker identity option for public markets with disclosed qualification status.
- `D` Hedge connectors to external spot, futures, options, and bank venues for maker inventory management.
- `D` Latency, rejection, stale-quote, toxic-flow, and realized-spread analytics.
- `D` Maker quality score and tiered access to sensitive RFQs.
- `S` Subaccounts for strategies, legal entities, desks, and clients.
- `S` Maker vaults that let approved capital providers allocate to a disclosed quoting strategy.
- `S` Backtesting and replay environment using historical RFQs, curves, fixings, and fills.
- `S` Colocation-style low-latency gateway using Arbitrum's real-time sequencer feeds when production-ready.
- `S` Market-maker cockpit for price construction, distribution rules, client segmentation, and automated hedging.

### K. Cash-flow and treasury operating system

- `B` Manual creation of receivables, payables, payroll runs, subscriptions, treasury obligations, and expected conversions.
- `B` CSV import and export with reusable column mappings.
- `B` Confirmed versus forecast exposure classification.
- `B` Natural netting across opposite currency cash flows before hedging.
- `B` Exposure timeline by currency and date.
- `B` Hedge policy with coverage percentage, maximum tenor, permitted products, and approval threshold.
- `B` Multi-user organizations with preparer, approver, trader, viewer, and auditor roles.
- `D` Invoice and payment object linked directly to each hedge and settlement.
- `D` Layered, static, and micro-hedging policy automation.
- `D` Automatic hedge proposals triggered by exposure, budget-rate, date, or volatility thresholds.
- `D` Cash-flow confidence ranges and hedge sizing that avoids over-hedging uncertain forecasts.
- `D` Approval workflow with quorum, amount limits, and Safe support.
- `D` Realized hedge effectiveness and protected-margin reporting.
- `D` Settlement reconciliation against the original cash flow and actual payment.
- `D` Journal-entry and valuation exports for finance teams.
- `S` Xero, QuickBooks, NetSuite, SAP, Oracle, and treasury-management integrations.
- `S` Multi-entity intercompany netting and internal allocation.
- `S` Hedge-accounting workpapers and designation records, subject to jurisdiction and accounting review.
- `S` Payment orchestration that can apply settlement proceeds to the intended recipient or obligation.
- `S` Forecast-versus-actual learning loop that improves policy sizing without making speculative price predictions.

### L. Market data, analytics, and reporting

- `B` Live spot reference, forward points, outright forward rate, implied yield, and fixing countdown.
- `B` Public aggregate quotes, spread, available notional, recent fills, volume, and open interest.
- `B` Historical price, forward curve, realized volatility, and settlement fixings.
- `B` Portfolio mark, realized and unrealized PnL, premium, fees, and effective rate.
- `B` Downloadable confirmations, statements, settlement records, and tax history.
- `D` Implied-volatility surface and Greeks for option markets.
- `D` Best-execution and transaction-cost analysis against contemporaneous eligible quotes and benchmarks.
- `D` Maker response, fill, rejection, uptime, and realized-spread analytics.
- `D` Hedge effectiveness, budget variance, and savings versus unhedged outcome.
- `D` Public risk dashboard with collateral, aggregate obligations, caps, oracle status, and incidents.
- `S` Anonymous benchmark curves created from executable quotes rather than indicative submissions.
- `S` Research and backtesting dataset with privacy-preserving aggregation.
- `S` Regulatory and market-surveillance reports.
- `S` Custom scheduled reports and event-driven delivery.

### M. Accounts, onboarding, and everyday UX

- `B` Standard wallet connection for institutional and crypto-native users.
- `B` Passkey or email-based smart account for non-crypto-native users.
- `B` Sponsored gas and USDC-denominated fee presentation.
- `B` Batched approvals, deposits, quote acceptance, and position creation where safe.
- `B` Clear pending, confirmed, failed, expired, and recoverable transaction states.
- `B` Address book, trusted recipients, and organization policy checks.
- `B` Hardware wallet and Safe compatibility.
- `B` Responsive web application and installable PWA.
- `D` One balance and one activity history across simple hedge and advanced market modes.
- `D` Guided onboarding that teaches outcome and risk without forcing NDF jargon.
- `D` Demo portfolio and settlement simulator using real market data but no funds.
- `D` Alerts through email, push, Telegram, webhook, and in-app inbox.
- `D` Human-readable signature previews for every delegated permission and quote.
- `S` Native mobile applications only after the PWA and organization workflows are stable.
- `S` Localized currencies, calendars, languages, number formatting, and time zones.
- `S` Recovery contacts and organization-controlled signer rotation.

### N. Developer platform and integrations

- `B` Public market-data REST API.
- `B` Authenticated trading and portfolio REST API.
- `B` WebSocket streams for quotes, RFQs, fills, positions, fixings, and risk events.
- `B` TypeScript SDK with exact fixed-point types and generated contract clients.
- `B` Solidity interfaces for instrument creation, fill, transfer, lifecycle, and settlement.
- `B` Webhooks with signatures, retries, idempotency keys, and replay protection.
- `B` Stable error taxonomy with actionable recovery instructions.
- `D` FIX adapter for institutional makers and treasury systems.
- `D` Embedded quote and hedge SDK for wallets, payroll, invoicing, and payment products.
- `D` Policy API that converts an approved cash-flow rule into executable hedge intents.
- `D` Privacy SDK for encryption, proof generation, viewing keys, and selective disclosure.
- `D` Sandbox and deterministic market replay environment.
- `S` Clearing API for third-party venues and private OTC desks.
- `S` Indexing endpoints for public aggregates and authorized private portfolio state.
- `S` Agent-safe scoped credentials, transaction simulation, spend limits, and revocation without making an AI assistant the product.

### O. Security, reliability, and operations

- `B` Independent audits for contracts, circuits, cryptography, matching, and economic design.
- `B` Unit, fuzz, invariant, fork, differential, and end-to-end mainnet tests.
- `B` Formal specification of payout, collateral conservation, authorization, nullifiers, and settlement invariants.
- `B` Bug bounty sized to value at risk.
- `B` Small initial exposure caps that rise only after observed reliability.
- `B` Pause-new-risk control that preserves cancel, unwind, settle, and withdraw paths.
- `B` Oracle, sequencer, keeper, relayer, proof-service, indexer, and RPC monitoring.
- `B` Redundant keepers and permissionless settlement.
- `D` Public status page, incident history, and postmortem process.
- `D` Upgrade timelock, role separation, emergency council bounds, and immutable position terms.
- `D` Circuit and verifier version registry with safe migration rules.
- `D` Economic stress harness for gaps, depegs, oracle failure, maker default, and mass expiry.
- `D` Privacy reconstruction testing that measures what observers can infer.
- `D` Market-abuse surveillance for wash trades, spoofing, quote stuffing, layering, and collusion.
- `S` Regional infrastructure redundancy and disaster recovery.
- `S` Chaos testing for failed relays, stale prices, delayed fixing, partial outages, and chain reorganization.
- `S` External risk committee and published parameter-change policy.
- `S` Insurance or third-party cover only when terms, exclusions, and claims process are real.

### P. Compliance, governance, and auditability

- `B` Jurisdiction-aware interface access and clear product risk disclosures.
- `B` Terms that distinguish the interface, protocol, maker, and user responsibilities.
- `B` Sanctions and prohibited-address controls where legally required.
- `B` Immutable trade receipt with all economically material terms.
- `B` Data-retention and privacy policy aligned with selective disclosure.
- `D` Optional identity credentials for qualified counterparties without public doxxing.
- `D` Counterparty pools restricted by credential, jurisdiction, organization, or disclosure policy.
- `D` Best-execution policy and auditable quote-selection record.
- `D` Surveillance and suspicious-activity workflow for operated services.
- `D` Approved-auditor viewing access that can be revoked or scoped by period and entity.
- `S` Legal-entity account hierarchy and beneficial-owner controls.
- `S` Market-rule governance with delayed parameter changes and public rationale.
- `S` Independent fixing, valuation, and risk methodology committee.
- `S` Regulatory reporting adapters by jurisdiction.
- `S` Dedicated-chain migration path only if later confidentiality or regulated sequencing requirements cannot be met on Arbitrum One.

### Q. Revenue and network growth

- `B` Transparent execution fee charged on matched notional or option premium.
- `B` Maker and taker fee schedules appropriate to each execution mode.
- `B` Fee preview before quote acceptance and complete fee attribution afterward.
- `B` Volume tiers and maker rebates funded by real exchange revenue.
- `D` Professional maker API and risk-terminal subscription.
- `D` Embedded distribution revenue share for payroll, invoice, wallet, and treasury partners.
- `D` Lifecycle fee for amendment, unwind, roll, or cleared off-platform trades.
- `D` Clearing fee for third-party interfaces using the protocol.
- `D` Premium privacy and selective-disclosure service for organizations, without weakening basic user protection.
- `D` Market-data and executable benchmark licensing after sufficient genuine volume exists.
- `S` Disclosed share of collateral yield where legally and operationally appropriate.
- `S` Enterprise support, service-level agreements, and custom integration fees.
- `S` Clearing membership and market-access subscriptions.
- `S` New-market sponsorship for businesses that need a specific corridor and commit real flow.
- `S` No token-dependent revenue, wash-volume incentives, or points program presented as product demand.

### R. Canonical strategy series and package protocol

- `B` Immutable strategy-series manifest binding the instrument templates, currencies, leg ratios, calendars, quote convention, risk class, and permitted lifecycle actions.
- `B` Canonical series identifier so economically identical packages share liquidity even when different applications construct them.
- `B` Typed directed package graph containing legs, dependency edges, atomic groups, owner, strategy account, expiry, nonce, privacy policy, and settlement policy.
- `B` Typed leg families for spot conversion, forward, NDF, option, collateral movement, settlement payment, and approved external hedge action.
- `B` Compiler rejection of dependency cycles, unsupported assets, unqualified adapters, unsafe partial states, arbitrary calldata, and recovery authority broader than the signed order.
- `B` Explicit all-or-none, exact-fill, bounded-partial, and minimum-fill policies at both package and leg level.
- `B` State preconditions and postconditions covering balances, collateral, positions, fees, allowances, obligations, and terminal exposure.
- `B` Language-neutral canonical encoding and domain-separated hashes for graph, order, quote, route, resource plan, template, receipt, and outcome.
- `D` Economic-equivalence normalizer that maps equivalent collars, layered hedges, rolls, and cash-flow batches into common series where user limits remain identical.
- `D` Template-specific outcome schema for forward rate, premium, protected rate, participation, maximum payout, Greeks, margin, and effective all-in result.
- `D` Complete-package limits for total fees, required collateral, minimum protected outcome, maximum interim exposure, maximum residual, and maximum recovery cost.
- `D` Persistent strategy state object that binds the authoritative current position, prior state hash, cash-flow links, accepted baseline, and intended resulting exposure.
- `D` Signed recovery graph that defines permitted completion, rollback, compensation, manual takeover, and deadline behavior before execution begins.
- `D` Resource-aware compiler producing gas estimate, calldata size, storage effects, call graph, adapter set, oracle age limit, quote-to-submit budget, and fallback policy.
- `D` Package lifecycle compilation for enter, increase, decrease, amend, rebalance, roll, migrate, split, merge, novate, assign, exit, and emergency unwind.
- `D` Baseline-adoption flow that detects external account changes and requires explicit user approval before automated lifecycle operations resume.
- `D` Reproducible compiler versions with golden fixtures across Solidity, TypeScript, Rust, and Python implementations.
- `S` Permissionless package-template proposals with simulation, security evidence, liquidity evidence, and delayed risk-domain activation.
- `S` Conditional branches, scheduled actions, recurring packages, event triggers, and policy-constrained automation expressed inside the signed graph.
- `S` Cross-template meta-packages combining several approved FX instruments and cash-flow obligations under one total risk constraint.
- `S` Formally verified compiler properties for authorization containment, conservation, bounded residuals, and equivalence-preserving normalization.

### S. Implied liquidity and package matching

- `B` Direct package orders, implied package quotes, firm RFQs, and indicative analytics displayed as distinct liquidity classes.
- `B` Deterministic price-time, batch, or pro-rata matching policy declared separately for every standardized series.
- `B` Direct-order priority, implied-order priority, firm-capacity priority, and tie-breaking rules published as part of each market specification.
- `B` Common-control and self-match prevention across wallets, maker subaccounts, solvers, builders, and implied legs.
- `B` Immediate invalidation of implied liquidity when any source order, oracle state, collateral reservation, qualification record, or fee assumption changes.
- `B` Conservation proof showing gross user obligations equal internal allocations plus external execution plus explicitly bounded residuals.
- `D` Implied-in engine deriving executable forward, swap, collar, and package prices from compatible outright and component markets.
- `D` Implied-out engine combining a resting package order with compatible component liquidity to expose executable liquidity in another market.
- `D` Multi-generation implication with bounded search depth, cycle rejection, resource limits, and prevention of an implied bid matching an implied offer derived from the same source.
- `D` Cross-series implication connecting spot stablecoin liquidity, dated forward series, option series, rolls, and lifecycle exit markets.
- `D` Exact tick, lot, notional, ratio, decimal, and adverse-rounding rules for implied prices and quantities.
- `D` Price-improvement allocation rule defining whether the package aggressor, resting package maker, or component liquidity provider receives rounding improvement.
- `D` Source-liquidity reservation that prevents the same component order or collateral capacity from supporting simultaneous incompatible fills.
- `D` Atomic execution of every source order contributing to a same-transaction implied fill.
- `D` Implied-liquidity provenance showing every source market, quote, fee, reservation, reference state, and transformation used to construct the displayed package price.
- `D` Executable liquidity-at-size curve calculated after fees, collateral, price impact, privacy cost, and settlement-class risk.
- `D` Cross-user package crossing that preserves every user's individual price, disclosure, collateral, and lifecycle bounds.
- `D` Package matching engine that can combine direct makers, customer coincidence, implied liquidity, and protocol backstop capacity in one deterministic allocation.
- `S` Portfolio implication across several currencies, dates, legal entities, and related packages while preserving ownership and accounting allocation.
- `S` Confidential implication that proves executable package economics without publicly revealing every source order or commercial cash flow.
- `S` Implied-liquidity circuit breakers for extreme reference divergence, recursive depth, source concentration, oracle failure, and inconsistent market sessions.
- `S` Historical implication simulator measuring price improvement, fill probability, source dependence, capital savings, and failure behavior before activation.

### T. Solver, market-maker, and firm-capacity network

- `B` Signed solver capability manifest with operator identity, quote keys, encryption keys, endpoints, supported templates, maximum notionals, settlement modes, and validity period.
- `B` Separate operator, quoting, encryption, execution, recovery, receipt, and withdrawal keys with explicit purpose and rotation history.
- `B` Exact order, graph, route, resource plan, fees, settlement guarantee, and terminal-risk bounds signed into every solver quote.
- `B` Quote expiry, nonce, replacement, cancellation, and single-use acceptance rules enforced independently of the hosted relay.
- `B` Objectively verifiable capacity reservation with reserved, filled, expired, released, and disputed states.
- `B` Solver capital ledger separating free inventory, quoted capacity, accepted reservations, venue margin, recovery capital, and withdrawable balance.
- `B` Emergency cancel-all and withdrawal fencing that protects accepted firm quotes and active recovery obligations.
- `D` Solver discovery directory verified by clients rather than trusted as the source of identity or capability truth.
- `D` Reference solver that compares direct inventory, natural crossing, implied liquidity, external hedges, batch execution, and protocol backstop routes.
- `D` Solver inventory manager allocating capital across currency pairs, tenors, strikes, settlement classes, privacy modes, and recovery cohorts.
- `D` Private quote transport encrypting each request to selected solver keys and each response to a user-controlled response key.
- `D` Capital and solvency proof covering current reservations, accepted obligations, risk-domain caps, recovery reserve, and permitted withdrawals.
- `D` Objective performance bond for narrowly defined faults such as dishonoring a funded reservation, censoring a committed bid, or submitting a provably invalid outcome.
- `D` Raw solver metrics for coverage, response latency, quote fade, settlement, residuals, recovery, price improvement, disputes, and evidence completeness.
- `D` Common-control grouping so several keys, endpoints, or legal entities cannot be represented as independent competition when they share capital or control.
- `D` Permissionless self-hosted solver operation through published schemas, fixtures, conformance tests, and settlement interfaces.
- `D` Recovery-capital allocator reserving enough capital for the worst permitted completion or rollback action before asynchronous execution begins.
- `S` Privacy-preserving proof of solver capacity that reveals sufficiency and concentration compliance without exposing complete inventory.
- `S` Solver delegation market where capital owners assign bounded inventory mandates without granting unrestricted custody or trading authority.
- `S` Independent solver network gate requiring recurring quotes from separately controlled economic organizations before decentralization claims are used.
- `S` Solver wind-down and replacement process that preserves accepted quotes, active positions, lifecycle access, evidence, and user withdrawal.

### U. Qualification, risk domains, and clearing expansion

- `B` Immutable instrument manifest identifying contracts, issuers, currencies, oracles, calendars, payout logic, settlement assets, administrative powers, and close routes.
- `B` Mutable qualification record with active, restricted, reduce-only, entry-paused, exit-only, quarantined, all-paused, and deprecated states.
- `B` Independent qualification of instruments, templates, makers, solvers, adapters, oracles, privacy backends, delivery paths, and settlement services.
- `B` Automated downgrade and cap-reduction authority that cannot automatically promote risk or raise a cap.
- `B` Append-only qualification history with evidence, trigger codes, observation time, effective time, expiry, authority, and signature.
- `B` Normalized position-adapter output covering ownership, authority, quantity, valuation, collateral, PnL, margin, pending actions, oracle state, and executable close routes.
- `B` Explicit unknown state when an adapter cannot prove a material position, authority, price, collateral, or close-route field.
- `B` Risk-domain isolation keyed by dependencies that can fail together rather than by product branding or interface grouping.
- `D` Continuous monitoring of proxy upgrades, administrator changes, oracle divergence, redemption problems, transfer restrictions, market sessions, liquidity loss, and close-route failure.
- `D` Per-domain gross, net, leverage, concentration, open-interest, liquidity, maximum-close-time, margin-floor, and recovery-capital limits.
- `D` Conditional portfolio offsets granted only when current positions, cancel authority, close authority, liquidity, oracle health, recovery capital, and unwind graphs are proven.
- `D` Immediate removal of an invalid offset followed by blocked risk expansion and a signed pre-liquidation de-risking policy.
- `D` Coordinated package de-risking that can cancel orders, reduce the weakest leg, execute a paired unwind, move authorized collateral, or lock for manual control.
- `D` Typed external credit and prime-broker adapters that preserve the lender's actual eligibility, rate, liquidation, withdrawal, and loss-boundary rules.
- `D` Solver, maker, issuer, stablecoin, oracle, bridge, sequencer, and privacy-network exposure represented in the same dependency graph.
- `D` Stress library covering currency gaps, stablecoin depegs, oracle corruption, sequencer outage, maker default, privacy failure, mass expiry, and correlated withdrawals.
- `D` Strategy clearing account that binds only positions, collateral, orders, authorities, and reserves the protocol can actually control.
- `S` Funded isolated guarantor domains that can convert advisory offsets into enforceable collateral benefits without mutualizing unrelated risks.
- `S` Native package clearing accounts for standardized strategy series after sufficient liquidity, security review, and independent member capital exist.
- `S` Cross-member default auction, portfolio transfer, hedging auction, assessment, and replenishment procedures with explicit loss boundaries.
- `S` Privacy-preserving portfolio-margin and concentration proofs that remain independently auditable.
- `S` Public risk methodology versions, parameter-change simulations, delayed activation, challenge periods, and external review.

### V. Settlement guarantees, evidence, and deterministic replay

- `B` Explicit settlement class attached to every order, quote, position, lifecycle action, and receipt.
- `B` Terminal outcome states for finalized complete, finalized bounded, recovered complete, recovered bounded, recovered flat, no effect, manual intervention, and unresolved pending state.
- `B` Durable execution journal written before any action that cannot be atomically reverted.
- `B` Reconcile-before-retry behavior for unknown submissions, delayed receipts, replacement transactions, keeper races, and disputed outcomes.
- `B` Receipt containing order, graph, template, quote, route, resource plan, fees, collateral changes, state deltas, fixing, settlement, recovery, and terminal outcome.
- `B` Evidence grades separating operator assertion, independent service corroboration, consensus verification, zero-knowledge verification, and direct onchain enforcement.
- `B` Deterministic replay that reconstructs validation, route comparison, matching, fixing, payout, fees, and terminal-state selection from committed inputs.
- `D` Declared candidate-route set with eligible routes, deterministic exclusions, normalization policy, selection objective, and selected route.
- `D` Best-execution proof that compares complete fee-adjusted and risk-adjusted outcomes rather than isolated headline prices.
- `D` Expected-versus-realized benchmark covering exchange rate, premium, fees, collateral, latency, residual exposure, recovery, and settlement timing.
- `D` Delivery-policy record distinguishing public, protected, private-required, batch, direct RFQ, and permitted fallback paths.
- `D` Privacy-downgrade control that fails closed when the user requires confidentiality and labels every permitted fallback before signature.
- `D` Manual-takeover protocol with fenced authority, reconciled baseline, independent approval, permitted actions, and verified unlock.
- `D` Compensation proof showing why an asynchronous recovery action was permitted and whether its loss remained inside the signed bound.
- `D` Failed, expired, cancelled, partial, recovered, disputed, manual, and unknown executions retained in performance and reliability datasets.
- `D` Public receipt commitments with selective disclosure of private terms to users, counterparties, accountants, auditors, lenders, and regulators.
- `S` Execution-quality data product covering route quality, maker and solver performance, venue reliability, fixing behavior, privacy availability, recovery cost, and tail outcomes.
- `S` Independent receipt verifier and light client that does not depend on the first-party API or indexer.
- `S` Cryptographic aggregation of large receipt sets for privacy-preserving solvency, execution-quality, and regulatory reporting.
- `S` Cross-version replay proving that historical positions retain their original template, risk, oracle, and settlement semantics after upgrades.

### W. Strategy platform, distribution, and ecosystem products

- `B` Visual strategy studio that compiles forwards, options, collars, rolls, layered hedges, payment conversions, and cash-flow batches into typed packages.
- `B` Executable opportunity feed based on real firm liquidity, total fees, collateral, protection, and close cost rather than indicative yield.
- `B` Saved strategies, watchlists, alerts, presets, draft approvals, and reusable organization policies.
- `B` Deterministic simulation and paper-trading environment using real market state without representing simulated fills as liquidity.
- `B` Package comparison across outcome, price, premium, collateral, privacy, counterparty set, settlement class, and lifecycle support.
- `B` Receipt explorer, qualification explorer, risk-domain explorer, fixing explorer, and public incident timeline.
- `D` Historical backtesting with executable-depth, fee, collateral, fixing, and lifecycle assumptions rather than frictionless mid prices.
- `D` Strategy catalogue containing protocol-authored, partner-authored, and user-authored templates with provenance, version, risk, and liquidity labels.
- `D` Strategy publisher manifest granting attribution and fee rights without spending, execution, withdrawal, or upgrade authority.
- `D` Signed builder manifest with identity, supported products, payout accounts, fee caps, validity, revocation, and domain binding.
- `D` Builder fee paid only after successful execution or another precisely defined lifecycle outcome accepted by the user.
- `D` Embeddable hedge tickets, strategy cards, portfolio widgets, lifecycle controls, settlement views, and disclosure controls.
- `D` Partner console for customer cohorts, permissions, builder attribution, revenue, incidents, support, qualification, and integration health.
- `D` White-label application configuration without forking instrument, clearing, privacy, or receipt semantics.
- `D` Public conformance suite allowing independent wallets, terminals, solvers, makers, indexers, and auditors to interoperate.
- `D` Organization automation studio for approval chains, amount limits, hedge ratios, permitted templates, counterparties, privacy levels, and emergency controls.
- `D` Human-readable package explanation showing each leg, dependency, maximum loss, collateral use, fixing, settlement, and recovery before signature.
- `S` Curated strategy marketplace with reviewed economic claims, performance methodology, disclosure, publisher accountability, and no guaranteed-return language.
- `S` Native mobile application with organization approvals, alerts, portfolio monitoring, disclosures, and emergency risk reduction after web parity.
- `S` Enterprise self-hosting for RFQ, solver, privacy, policy, reporting, and receipt services with protocol-compatible verification.
- `S` Integration certification program covering security, accounting, privacy, reliability, support, and correct economic presentation.
- `S` Multi-party workflow connecting payer, payee, treasury, maker, auditor, accountant, and payment provider to one selectively disclosed hedge record.
- `S` Protocol research portal exposing anonymized curves, market quality, execution benchmarks, failure distributions, and methodology versions.

### X. Multi-asset market universe and asset-specific engines

- `B` Canonical asset registry covering asset class, underlying identity, quote currency, unit, decimals, contract multiplier, settlement asset, legal wrapper, issuer, and dependency domain.
- `B` Benchmark registry binding each market to its primary price source, observation method, confidence limits, staleness limit, fallback hierarchy, dispute rule, and data-use rights.
- `B` Market-session engine covering trading hours, holidays, maintenance windows, early closes, observation windows, and rules for expiry outside an active session.
- `B` FX market family for major, minor, and qualified emerging-market pairs rather than a EUR/USD-only venue.
- `B` Crypto market family for fixed-expiry BTC, ETH, SOL, ARB, and other qualified digital-asset risk rather than a funding-dependent perpetual position.
- `B` Precious-metals market family for gold, silver, platinum, and palladium where benchmark and maker qualification are satisfied.
- `B` Energy market family for qualified oil, natural-gas, and related benchmarks with explicit spot, CFD, or futures-benchmark semantics.
- `B` Rates market family for qualified government-yield, reference-rate, bond-future, and onchain borrowing-rate benchmarks.
- `B` Equity-index and ETF market family for qualified broad-market, sector, regional, and thematic exposures.
- `B` Tokenized-asset market family that distinguishes the reference asset, token wrapper, issuer, redemption terms, transfer restrictions, and onchain market price.
- `B` Perpetual, spot, dated future, reference rate, NAV, and redemption rate represented as different benchmark types so the protocol never silently treats them as interchangeable.
- `B` Contract-specification inheritance that applies common clearing rules while preserving asset-specific lot, tick, calendar, payout, disruption, and settlement behavior.
- `B` Cash-settled forwards and options denominated and settled in qualified stable collateral across every supported asset class.
- `B` Explicit activation state per market, series, benchmark, execution mode, and user cohort, separate from whether its engine and interface are implemented.
- `B` Market-qualification gate requiring a reliable benchmark, two-sided maker capacity, executable close route, regulatory review, risk limits, and tested disruption handling.
- `B` Genesis market board containing multiple qualified FX, crypto, metals, energy, rates, and index series, with EUR/USD presented as one market rather than the company identity.
- `D` Commodity procurement hedge templates for manufacturers, merchants, miners, transport operators, data centers, and treasuries with dated input-cost exposure.
- `D` Revenue and inventory protection templates that connect a forecast sale, purchase order, shipment, or inventory lot to its hedge and settlement record.
- `D` Interest-rate forward, cap, floor, collar, and fixed-versus-floating package templates for debt service, refinancing, lending, and treasury yield.
- `D` Crypto treasury and token-unlock templates for protecting a known sale, vesting, grant, validator revenue, OTC payment, or protocol expense date.
- `D` Equity-index and tokenized-asset protection templates for collars, protective puts, covered calls, forward sales, and target-date accumulation.
- `D` Stablecoin depeg protection markets using precisely defined redemption, spot, and time-window benchmarks rather than an ambiguous one-tick price.
- `D` NAV discount and redemption-basis markets for tokenized funds and other qualified RWAs, with issuer and redemption dependencies isolated from reference-asset risk.
- `D` Calendar-spread packages across expiries with atomic execution, spread margin, curve visualization, and expiry-specific liquidity.
- `D` Basis packages across spot, dated, perpetual, futures, NAV, and redemption references with every benchmark difference visible before execution.
- `D` Cross-asset package orders that atomically combine currency, commodity, rate, index, tokenized-asset, and crypto legs under one outcome and collateral limit.
- `D` Multi-asset treasury hedge that prices an organization's complete exposure basket rather than forcing independent execution of each leg.
- `D` Correlation, dispersion, and relative-value packages constructed from qualified capped legs with bounded maximum loss.
- `D` Commodity curve engine covering contract months, roll schedules, prompt-month liquidity decline, contango, backwardation, seasonality, and weighted spot references.
- `D` Rate-curve engine covering tenor nodes, compounding conventions, day-count basis, fixing calendars, interpolation, and shock scenarios.
- `D` Volatility-surface engine separated by asset class, expiry, strike, session, event risk, and benchmark liquidity.
- `D` Corporate-action engine for splits, dividends, mergers, spin-offs, symbol changes, delistings, and index rebalances affecting equities or tokenized assets.
- `D` Futures-reference roll engine that declares the source contract, roll window, weighting, discontinuity treatment, and exact benchmark used by a dated instrument.
- `D` Market-event controls for central-bank decisions, earnings, token unlocks, index rebalances, contract expiry, commodity reports, and scheduled protocol upgrades.
- `D` Asset-specific scenario engine for FX gaps, commodity shocks, rate-curve shifts, index crashes, crypto jumps, depegs, NAV breaks, and correlated cross-asset moves.
- `D` Unified portfolio Greeks and factor exposures across delta, gamma, vega, theta, duration, DV01, curve, basis, currency, commodity, index, and stablecoin risk.
- `D` Cross-asset collateral offsets granted only from conservative stress losses, observable dependencies, close authority, and executable liquidity rather than historical correlation alone.
- `D` Multi-benchmark fixing that can settle a package from several observations while rejecting partial, stale, mismatched-session, or selectively submitted inputs.
- `D` Asset-specific disruption committee workflow with precommitted objective rules, bounded authority, public evidence, appeal, and deterministic replay.
- `D` Deliverable settlement adapter for qualified tokenized assets, stablecoins, and tokenized commodities with payment-versus-delivery and transfer-rule enforcement.
- `D` Exposure ingestion from invoices, payroll, purchase orders, debt schedules, custody accounts, token vesting contracts, onchain positions, and accounting systems.
- `D` Goal-first discovery for protect an exchange rate, cap an input cost, lock a borrowing rate, defend a portfolio floor, hedge an unlock, or trade a cross-asset view.
- `S` Custom index builder for transparent, capped, periodically rebalanced baskets with manipulation review, concentration limits, and reproducible calculation.
- `S` Inflation, wage, freight, carbon, power, and other economic-index markets only after benchmark licensing, update cadence, revision policy, and maker depth are qualified.
- `S` Structured-note factory composing principal protection, coupons, barriers, autocall rules, and bounded derivative packages without hiding issuer or collateral risk.
- `S` RWA financing and repo packages that combine tokenized collateral, rate exposure, haircut, maturity, transfer eligibility, and default handling inside one qualified risk domain.
- `S` Physical-delivery coordination layer for tokenized warehouse receipts or commodity claims without representing offchain custody as trustless.
- `S` Cross-market portfolio auction allowing a user to transfer or hedge a complete multi-asset book through one competitive and privacy-preserving process.
- `S` Market-sponsor framework through which a business or ecosystem can fund benchmark integration, maker commitments, audits, and risk reserves without controlling outcomes.
- `S` Permissionless asset-class extension interface requiring canonical schemas, reference implementations, conformance tests, risk evidence, governance delay, and isolated activation.

## Protocol architecture

The exchange should be modular in the same sense that Kimia is modular. Each contract owns one responsibility and can be tested, audited, and integrated independently.

1. `MarketRegistry`: asset classes, underlyings, calendars, oracle feeds, lot sizes, expiries, instrument versions, caps, and status.
2. `InstrumentFactory`: validates payoff templates and creates standardized or bespoke instruments.
3. `CollateralVault`: deposits, withdrawals, reservations, segregated balances, and collateral movements.
4. `Clearinghouse`: account equity, position obligations, margin, limits, netting, defaults, and insurance.
5. `QuoteSettlement`: EIP-712 firm quote validation, fill, partial fill, nonce cancellation, and fee collection.
6. `EncryptedAuction`: encrypted request and bid commitments, threshold decryption, clearing, and outcome verification.
7. `BatchBook`: standardized-series orders and uniform-price batch clearing.
8. `PositionLedger`: public position state or private commitments, ownership, transfers, splits, merges, and nullifiers.
9. `LifecycleEngine`: unwind, amend, novate, roll, compress, exercise, and mature.
10. `OracleFixing`: observation collection, validity checks, fixing computation, fallback, and disruption state.
11. `SettlementEngine`: payout calculation, batch settlement, collateral release, and payment netting.
12. `PrivacyVerifier`: proof verification for hidden terms, collateral coverage, transitions, payout, and disclosure claims.
13. `RiskController`: market, maker, user, and system caps plus stress and concentration parameters.
14. `DefaultManager`: variation margin, default auction, insurance use, and loss waterfall.
15. `FeeController`: exchange fees, rebates, referral splits, maker incentives, and revenue accounting.
16. `GovernanceController`: timelocks, role boundaries, upgrades, pause scope, and parameter history.
17. `StrategySeriesRegistry`: immutable canonical package definitions, economic-equivalence rules, quote conventions, and lifecycle permissions.
18. `PackageCompiler`: typed graph validation, normalization, resource planning, settlement-class selection, and recovery-graph enforcement.
19. `ImpliedLiquidityEngine`: implied-in, implied-out, reservation, priority, rounding, provenance, and conservation for component and package markets.
20. `SolverRegistry`: solver identity, capability manifests, scoped keys, supported markets, performance records, and common-control groups.
21. `FirmReservation`: objective maker and solver capacity reservations, expiry, fill, release, withdrawal fencing, and fault evidence.
22. `QualificationRegistry`: enforceable qualification state and append-only history for every instrument, adapter, service, and execution path.
23. `RiskDomainManager`: dependency-aware isolation, caps, conditional offsets, recovery reserves, and coordinated de-risking authority.
24. `ReceiptRegistry`: terminal outcomes, evidence commitments, route decisions, delivery policy, settlement proof, and deterministic replay anchors.
25. `BuilderRegistry`: signed builder and publisher identities, fee caps, attribution, revocation, and successful-outcome payment rights.
26. `AssetRegistry`: canonical underlying identity, benchmark type, quote unit, multiplier, issuer, wrapper, redemption terms, restrictions, and dependency domain.
27. `BenchmarkRegistry`: price sources, observation methods, data rights, validity bounds, fallback hierarchy, and disruption procedure.
28. `MarketSessionController`: trading sessions, holidays, maintenance windows, event windows, and expiry eligibility.
29. `RateCurveEngine`: rate tenors, conventions, interpolation, discounting, forward calculation, DV01, and shock scenarios.
30. `CommodityCurveEngine`: contract months, rolls, weighted references, seasonality, curve state, and expiry transitions.
31. `CorporateActionEngine`: equity, ETF, index, and tokenized-asset adjustment events with immutable evidence and replay.
32. `DeliveryAdapterRegistry`: qualified payment-versus-delivery routes for stablecoins, tokenized assets, and tokenized commodity claims.

Required offchain services are equally part of the product:

- RFQ gateway and maker connectivity;
- threshold encryption and decryption network;
- browser or delegated prover;
- public and permissioned private indexers;
- market-data and forward-curve service;
- asset-reference, market-session, rate-curve, commodity-curve, corporate-action, and benchmark-licensing services;
- oracle, fixing, and sequencer monitors;
- keeper and batch-settlement network;
- transaction-cost and best-execution engine;
- package compiler, implication indexer, and deterministic matching coordinator;
- solver discovery, capacity-proof, reservation, and performance services;
- qualification, dependency-identity, risk-domain, and close-route monitors;
- independent receipt verifier, replay service, and execution-quality data pipeline;
- strategy catalogue, builder attribution, partner console, and revenue reconciliation;
- accounting, ERP, and payment connectors;
- risk, surveillance, and incident systems.

## Privacy architecture decision

Privacy should be progressive but native, with a clear boundary at each level.

### Level 1: private RFQ

The request is encrypted to eligible makers. Makers return signed quotes through private channels. Only the accepted quote reaches settlement. This prevents the public from learning intent before execution and makes sandwiching economically irrelevant because the accepted price is fixed.

### Level 2: sealed competitive auction

The user commits an encrypted request. Makers submit encrypted, collateral-backed bids. After the auction closes, threshold decryption reveals only what the clearing rule needs. The protocol selects the winner deterministically and emits a best-execution receipt. Fairblock's DeBid design is the closest Arbitrum-native reference.

### Level 3: confidential position and settlement

The ledger stores commitments to the position rather than plaintext notional, strike, cap, expiry, and owner. Opening proves valid terms and sufficient collateral. Lifecycle operations consume the current commitment and create a replacement. At expiry, a proof calculates payout from the public fixing and private terms. Nullifiers prevent double settlement. Payout can remain inside a shielded balance until withdrawal.

### Level 4: selective disclosure

The owner can produce scoped disclosures for a counterparty, accountant, auditor, lender, or regulator. Each disclosure states exactly what it proves, which position or period it covers, and when access expires. A privacy system that cannot support authorized oversight will struggle to serve real businesses.

The system must disclose unavoidable leakage. Public USDC deposits, withdrawals, timestamps, unusual settlement sizes, and a small anonymity set can reveal commercial information even when the position itself is hidden.

## MEV threat model and controls

| Threat | Why it matters here | Required control |
| --- | --- | --- |
| RFQ intent leakage | Pair, size, direction, and date reveal a business obligation | Encrypt the request and invite only eligible makers |
| Quote copying | A maker can shade against another quote | Seal bids until the auction closes |
| Sandwiching | Public fills can be reordered around price-sensitive execution | Use firm signed prices and enforce exact or bounded output |
| Cancel-fill race | A maker can cancel a stale winning quote before the user fills | Reserve quote capacity and make the accepted bid non-cancellable for its firm window |
| Queue-jumping | Standardized orders can become a latency contest | Use frequent uniform-price batches for customer flow |
| Oracle sniping | A caller can try to choose a favorable settlement update | Use a contractual observation window and deterministic fixing |
| Settlement ordering | First caller could receive a special outcome | Make payout independent of caller and batch order |
| Backrun leakage | A visible hedge can reveal future demand or invite copy trading | Keep position terms committed and aggregate public data |
| Maker adverse selection | Stale quotes are picked after external prices move | Short quote TTL, reference bounds, automatic repricing, and dead-man controls |
| Sequencer advantage | Timeboost or a future PGA can privilege some order flow | Make correctness independent of priority and monitor ordering behavior |
| Auction censorship | An operator can omit a valid bid | Signed bid receipts, reproducible transcripts, multiple relays, and bonded auction operators |
| Withdrawal tracing | Shielded activity can be linked when exact amounts exit | Batched withdrawals, note splitting, delayed exits, and leakage warnings |

Arbitrum's continuous ordering and Timeboost reduce some traditional sandwich dynamics, but Timeboost also sells a timing advantage. The exchange must not depend on a sequencer promise for fair execution. Application-level firm quotes, encryption, batches, and deterministic settlement provide the stronger guarantee. [Arbitrum Timeboost](https://blog.arbitrum.io/gattaca-titan-timeboost-live-on-arbitrum/)

## What should define the product

The complete protocol remains in scope. Eight capabilities organize the pitch without limiting the product:

1. **A real exposure becomes a tradable intent.** Users describe an invoice, payroll run, purchase order, debt payment, inventory position, token unlock, treasury holding, investment, or cross-asset view rather than manually constructing venue-specific legs.
2. **Market makers compete for the complete dated risk.** The quote covers the whole position, fees, collateral, and lifecycle rather than one routed swap.
3. **The exchange owns clearing and settlement.** It is not an Ostium wrapper and not an automation service.
4. **Privacy protects real commercial information.** Exact exposure, quote competition, position, and PnL do not have to become public.
5. **MEV protection is measurable.** Firm prices, sealed bids, deterministic fixing, and best-execution receipts replace vague claims.
6. **One protocol serves simple users and professional desks.** The hedge application, markets terminal, maker terminal, APIs, and treasury workflow use the same instrument and clearing state.
7. **Package markets multiply liquidity.** Canonical series and implied-in and implied-out matching connect FX, crypto, commodities, rates, indices, tokenized assets, spot, forward, option, lifecycle, customer, and maker liquidity.
8. **Every outcome is independently verifiable.** Qualified dependencies, solver capacity, route decisions, settlement guarantees, and evidence-graded receipts can be replayed without trusting the interface.

## Features that would dilute the company

Unlimited engineering capacity is not a reason to add unrelated products. Do not add these to the company boundary:

- a generic crypto perpetual DEX;
- a spot-token AMM or aggregator;
- unsecured lending or a loan marketplace;
- copy trading, social feeds, trading games, or leaderboards;
- a speculative token, points campaign, or liquidity mining presented as demand;
- a generic AI chat assistant;
- three-chain deployment before the Arbitrum One venue has repeat use;
- opaque yield on customer collateral;
- an Android-only experience before the web, PWA, organization, and API workflows are complete;
- privacy claims that hide risk from users while exposing their deposits and withdrawals in reconstructable ways.

## Dependency order, not scope reduction

The complete product can be built without treating this as a small MVP, but dependencies still matter.

1. Define asset identities, benchmarks, market sessions, instruments, canonical strategy series, calendars, quote conventions, payout math, oracle fixing, collateral conservation, and lifecycle invariants.
2. Implement the package compiler, canonical encoding, graph validation, resource plans, conformance fixtures, and recovery policies.
3. Build collateral, clearing, position, quote, settlement, risk-domain, qualification, reservation, receipt, and governance contracts.
4. Build the public package book, direct and implied matching, firm RFQ, solver network, maker connectivity, and complete cash-flow hedge application.
5. Build encrypted RFQ, sealed auctions, threshold privacy, confidential positions, ZK settlement, and selective disclosure.
6. Build portfolio netting, options margin, conditional offsets, default auctions, compression, professional clearing, and coordinated de-risking.
7. Build the strategy studio, advanced markets terminal, maker and solver cockpit, risk console, receipt explorer, partner console, and organization automation studio.
8. Build SDKs, APIs, WebSockets, FIX, conformance suites, independent indexers, self-hosted services, and white-label components.
9. Build treasury automation, accounting, payments, ERP, audit, regulatory, and multi-party workflow integrations.
10. Build execution-quality, market-data, implication, qualification, solvency, and privacy-preserving research products.
11. Prove every capability through deterministic simulation, fork tests, capped mainnet cohorts, failure injection, replay, and independently verifiable evidence.
12. Activate markets, limits, risk domains, privacy modes, and clearing privileges progressively without removing their implementations or product surfaces.

## Final product verdict

The refined product is not merely a private loan-like forward and not an FX-only venue. It is a new exchange category positioned between a treasury and exposure operating system, a multi-asset institutional venue, and an onchain clearing protocol.

Its direct user value is simple: lock or shape the future price, rate, index, or exchange-rate outcome of a real exposure.

Its protocol depth is substantial: native multi-asset dated instruments, asset and benchmark registries, market-session and curve engines, multiple execution modes, collateral and clearing, privacy, MEV resistance, oracle fixing, lifecycle management, maker infrastructure, portfolio risk, exposure automation, and integration APIs.

Its startup moat will not be the number of screens or contracts. It will be the combination of repeated cash-flow distribution, competitive maker liquidity, proprietary executable forward and volatility data, trusted private execution, and a clearing record that third-party applications can rely on.

As of 2026-09-19, the reviewed landscape validates the neighboring components but does not show a visible Arbitrum One product combining private fixed-expiry markets, cross-asset packages, native clearing, exposure workflows, and verifiable lifecycle infrastructure across FX, crypto, commodities, rates, indices, and tokenized assets. This is a differentiation opportunity based on the available data, not proof that no competitor exists.
