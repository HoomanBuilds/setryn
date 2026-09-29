# Arbitrum Private Perps and Package Execution Decision

Date: 2026-09-18

## Executive decision

Do not build a standalone private perpetual DEX.

Do not build the broad package execution network exactly as proposed, and do not use cash-and-carry as the first product.

Build a narrower protocol with a stronger unclaimed job:

> A venue-native portfolio transition network. A user specifies the final position they want, bonded solvers compete on the complete transition, and the protocol either delivers the actual positions into the user's Arbitrum account by a deadline or performs a deterministic unwind and compensates the bounded loss.

The first user-facing product is **Perp Shift**:

- Detect an existing perpetual position on an Arbitrum venue.
- Compare the cost of holding it against another venue.
- Quote the complete migration, including close cost, reopen cost, fees, price impact, funding difference, and temporary exposure.
- Move the exposure from the source venue to the destination venue with one signature.
- Keep dollar delta within a user-defined tolerance during the transition.
- If a venue order fails or expires, unwind safely and pay the user from the solver's bond according to an agreed formula.

This retains the deepest and most defensible part of the original package thesis: typed outcomes, competitive complete-position quotes, explicit settlement classes, solver commitments, asynchronous failure recovery, and lifecycle management. It removes the features that are already products elsewhere.

## Why the two obvious directions are rejected

### Standalone private perps is already a funded category

Privacy is a real trader problem, but it is not empty Arbitrum whitespace.

- **Hibachi** is already a live privacy-focused perpetual exchange accepting USDT and USDC from Arbitrum One. DefiLlama currently attributes roughly $478 million of its trailing 30-day perp volume and more than $8 billion of cumulative volume to Arbitrum, and records a $5 million seed round. Its private exchange state is published as verifiably encrypted data. [Hibachi API](https://www.postman.com/hibachi-xyz/hibachi-public/documentation/kjruxq4/hibachi-api), [Celestia private blockspace case study](https://docs.celestia.org/build/private-blockspace/about/), [current Hibachi metrics](https://defillama.com/protocol/hibachi)

- **Paradex** now documents end-to-end private orders, trades, positions, balances, PnL, and liquidation levels. Its production RFQ API also supports as many as 25 legs. [Paradex privacy architecture](https://docs.paradex.trade/trading/privacy), [Paradex RFQ API](https://docs.paradex.trade/api/prod/rfqs/rfq-create)

- **Aster** markets encrypted orders plus private positions on a purpose-built trading chain. [Aster documentation](https://docs.asterdex.com/)

- **OPAL** uses client-side encrypted orders and micro-auctions and was selected for Base Batch 003. [Base Batch 003](https://blog.base.org/introducing-base-batches-003-2), [OPAL](https://www.opaldex.com/)

- **Defx** raised $2.5 million for a purpose-built private perp L1 with encrypted order flow, hidden PnL and liquidation points, a ZK trading engine, and vault liquidity. [Defx funding announcement](https://blog.defx.com/p/defx-raises-25m-to-launch-a-layer)

- **Renegade** already owns the private trading narrative on Arbitrum for spot, using MPC for private discovery and ZK proofs for settlement. [Renegade](https://renegade.fi/)

- Arbitrum itself now promotes application-level confidentiality for derivatives through Fairblock, Renegade, and Fhenix. [Arbitrum confidentiality](https://arbitrum.io/why-arbitrum/features/confidentiality)

A credible private perp is not encrypted order submission added to an existing DEX. It needs confidential collateral, position state, funding, margin checks, liquidation eligibility, solvency proofs, withdrawals, backstop liquidity, viewing keys, an oracle, and professional market makers. Hibachi, Paradex, OPAL, Defx, Aster, and others already have teams and liquidity focused on that entire stack.

The remaining claim, "private perps native to Arbitrum One," is not enough to make traders move. Users choose a perp venue primarily for pricing, liquidity, latency, markets, reliability, and incentives. Privacy must improve those properties or serve a segment that will pay for it.

**Decision: kill standalone private perps.** Use pre-trade confidentiality later as one execution mode, not as the company.

### The broad package network collides with multiple products

The original package thesis has several exact or close precedents:

- **Paradigm Unified Markets** already offers private multi-dealer RFQs and public complex strategy books. Its packages clear all legs or reject the complete trade at the selected settlement venue. [Paradigm Unified Markets summary](https://docs.paradigm.co/unified-markets/summary), [Paradigm RFQ workflow](https://docs.paradigm.co/unified-markets/rfq-request-for-quotes)

- **Paradex** accepts packages of as many as 25 legs and supports anonymous takers. [Paradex RFQ API](https://docs.paradex.trade/api/prod/rfqs/rfq-create)

- **Variational Pro** is the most dangerous Arbitrum collision. Its documented product lets advanced traders define custom derivatives, receive competing market-maker quotes, book them into onchain settlement pools, and automate collateral, margin, funding, liquidation, and settlement. [Variational Pro](https://docs.variational.io/pro/about-pro), [Variational RFQ lifecycle](https://docs.variational.io/variational-protocol/key-concepts/trading-via-rfq)

- **Ithaca** already runs an Arbitrum-settled multi-product auction engine with linked multi-leg orders, net package prices, synchronized execution, and collateral optimization. [Ithaca multi-leg orders](https://docs.ithacaprotocol.io/docs/architecture/pre-match-processing/frequent-batch-auctions-fba/orders), [Ithaca matching engine](https://docs.ithacaprotocol.io/docs/architecture/pre-match-processing/frequent-batch-auctions-fba)

- **Convergence RFQ** describes a common market-maker API, competitive RFQs, spot, perpetual and options structures, venue selection, risk calculation, and atomic multi-leg settlement. It is the closest conceptual competitor even though its public deployments and SDK are Solana-centered. [Convergence FAQ](https://www.convergence.so/faq), [Convergence GitHub](https://github.com/convergence-rfq)

- **CoW Protocol** already owns competitive solver auctions, Coincidence of Wants, conditional orders, and outcome-constrained token execution. [CoW Protocol](https://docs.cow.fi/)

- **Enso** compiles complex, multi-step DeFi workflows into executable calldata and already supports lending migrations, leverage, collateral swaps, and strategy entry. [Enso documentation](https://docs.enso.build/home), [Enso lending workflows](https://docs.enso.build/pages/use-cases/lending-markets/index)

- **Bebop** supports firm RFQ pricing and multi-token trades on Arbitrum. [Bebop RFQ API](https://docs.bebop.xyz/rfq-api/quickstart)

Therefore, these are not sufficient differentiators:

- N-leg compilation
- A strategy builder
- Public package orders
- Private RFQ
- Competitive maker quotes
- Coincidence-of-wants matching
- Generic lifecycle dashboards
- "One click" multi-step execution

Each is useful, but together they still describe a crowded aggregation layer unless the protocol owns a new settlement guarantee.

### Cash-and-carry is the wrong first wedge

Cash-and-carry strongly validates the operational problem but no longer provides a clean product claim.

Pendle ships an open-source **Boros with Gate CrossEx** application that scans opportunities, calculates capital and every modeled cost, guides the execution of two Boros rate legs and two offsetting perp legs, and monitors the resulting four-leg position from one dashboard. [Boros CrossEx overview](https://docs.pendle.finance/boros-docs/arbitrage-with-crossex/overview), [opening and monitoring a position](https://docs.pendle.finance/boros-docs/arbitrage-with-crossex/opening-a-position)

Convergence also documented a historical Arbitrum design on Vertex that combined a spot purchase and short perpetual into a one-click carry intent with competing maker quotes. I found no evidence that it became a public Arbitrum mainnet product, and Vertex later announced the closure of its EVM trading deployments. It is prior art, not a current live competitor. [Convergence design article](https://patrickkiefer.substack.com/p/intents-and-hybrid-systems-in-web3), [Vertex EVM closure announcement](https://www.prnewswire.com/news-releases/vertex-protocol-team-to-join-ink-foundation-build-new-defi-primitives-on-ink-layer-2-302499517.html)

The useful unresolved problem is visible in its execution sequence. Legs are still established in stages. A trader can carry temporary exposure if one venue fills and another does not. That failure boundary, not cash-and-carry discovery, is the valuable protocol problem.

**Decision: cash-and-carry can become a later package template, but it should not be the launch product or headline.**

## Similar projects and lessons from funded builders

Most hackathon projects do not become successful startups. Some projects below may be inactive or may have changed direction. They are evidence of builder density and mechanism choices, not proof of current market share.

- `blackpool` won second place in DeFi at Colosseum Radar and later became accelerator company DARKLAKE. It used ZK-based private execution. The lesson is that "private DEX" is already a recognized funded category. [Blackpool submission](https://colosseum.com/projects/explore/blackpool)

- `archer-exchange` won fourth place in DeFi at Cypherpunk and entered accelerator C4. It uses dual-flow batch auctions to protect makers from adverse selection. The lesson is that execution-market design, not a cosmetic UI, can support a company. [Archer submission](https://colosseum.com/projects/explore/archer-exchange)

- `urani` won first place in DeFi and Payments at Renaissance and entered accelerator C1. It built intent-based swap execution with a competitive liquidity market. The lesson is that solver competition needs a precise execution advantage and real liquidity providers. [URANI submission](https://colosseum.com/projects/explore/urani)

- `vanish` won first place in DeFi at Breakout with private SPL swaps using routing and position pooling. The lesson is that privacy wins when attached to a concrete trading harm such as wallet tracking and copy trading. [Vanish submission](https://colosseum.com/projects/explore/vanish)

- `opsonchain-1` received a Cypherpunk DeFi honorable mention for liquidity-aware VWAP execution for treasuries. The lesson is that professional execution products need measurable price improvement. [OPSONCHAIN submission](https://colosseum.com/projects/explore/opsonchain-1)

- `lomen-ai` received a Cypherpunk DeFi honorable mention and entered accelerator C5 as Cesto. It lets mobile users enter and manage multi-step DeFi positions. The lesson is that a one-click strategy interface alone is also occupied. [Lomen submission](https://colosseum.com/projects/explore/lomen-ai)

The repeated pattern is clear: funded products own a difficult primitive, a repeat user, and an economic loop. They do not stop at "we aggregate protocols."

## Archive insights

- Intents are declarative constraints on the state a user wants, while transactions specify the execution path. A package protocol is only defensible when it verifies an outcome that existing routers cannot guarantee. [Alliance essay on intents](https://alliance.xyz/essays/intents-are-just)

- Large and complex orders create both operational risk and adverse-selection costs. This is why TradFi uses brokers and execution algorithms rather than asking every user to manually split and monitor legs. [Paradigm TWAMM research](https://www.paradigm.xyz/2021/07/twamm)

- Generalized state intents already exist as an infrastructure thesis. Essential explicitly defines an intent as a constraint on final state. A startup on Arbitrum therefore needs a vertical product and a specialized economic guarantee, not merely a new intent schema. [Essential on intent state constraints](https://essential.ghost.io/a-slightly-more-formal-definition-of-intents/)

## The opportunity that survives

### Product category

**Venue-native portfolio transition protocol**

The protocol moves or unwinds stateful DeFi positions across independently operated venues. It does not issue a new derivative, create a new margin engine, or keep the user's final exposure inside a proprietary settlement pool.

The user's order describes the destination state rather than a list of calls:

- Close my $100,000 ETH short on venue A.
- Open an economically equivalent ETH short on venue B.
- Keep absolute delta below $2,000 during the transition.
- Finish within 90 seconds.
- Charge no more than 8 basis points all-in.
- Leave at least $X of equity after fees and realized PnL.
- If the transition cannot complete, restore the source exposure or flatten both sides and compensate the agreed loss.

Solvers compete on the complete result, not on individual legs.

### What the user-facing application does

The application is a professional web terminal, not an Android app in the first release. Active perp and vault users work with charts, positions, risk, and wallet signing on desktop. Mobile can become monitoring and emergency-action support later.

The first screen shows:

- Positions detected across supported Arbitrum venues
- Current funding and holding cost
- Estimated migration savings
- Available destination venues
- Net migration quote
- Maximum transition time
- Maximum temporary delta
- Solver bond and compensation cap

The user selects a source position and destination venue, compares complete quotes, and signs once. The application then shows a package-level timeline:

- Source close requested
- Destination hedge requested
- Delta inside or outside tolerance
- Venue callback received
- Transition completed, restored, or compensated
- Final fees, slippage, funding change, and execution improvement

### Exact initial users

The first users are:

- Arbitrum perp traders with $25,000 to $500,000 positions
- Market-neutral traders who move exposure when funding or liquidity changes
- Small onchain funds that operate across GMX and another perp venue
- Vault managers who currently maintain venue-specific close, hedge, retry, and accounting code
- Trading terminals and wallets that want a migration API

Do not start with large institutions. They already use Paradigm, centralized block RFQ systems, and bilateral dealer relationships. Do not start with small retail traders because a few basis points of migration improvement is not material at small size.

### Current alternative

The user currently:

1. Calculates expected close cost on the source venue.
2. Calculates open cost, funding, and collateral on the destination.
3. Closes one position or partially opens the other.
4. Watches both venues during their asynchronous order lifecycles.
5. Repairs a rejection, partial fill, frozen order, price-impact breach, or oracle delay.
6. Reconciles realized PnL, fees, collateral, and new liquidation risk.

GMX specifically uses keeper execution, callback contracts, acceptable-price checks, frozen and cancelled order states, and delegated subaccounts. These are useful integration surfaces, but they also prove that a cross-venue transition is not a single atomic call. [GMX ExchangeRouter](https://docs.gmx.io/docs/api/contracts/exchange-router/), [GMX known integration issues](https://docs.gmx.io/docs/api/contracts/known-issues/), [GMX delegated trading](https://docs.gmx.io/docs/api/contracts/delegated-trading/)

Gains also exposes asynchronous market-order callbacks and explicit cancellation reasons such as slippage, exposure limits, price impact, and maximum leverage. [Gains callback interface](https://docs.gains.trade/developer/technical-reference/contracts/interfaces/types/itradingcallbacks)

### Why this is not Enso, CoW, Variational, or DeFi Saver

- **Not Enso:** Enso returns executable routes. It does not make a solver post capital against the final equity and exposure of an asynchronous position migration.

- **Not CoW:** CoW verifies token input and output constraints. Perpetual positions have margin, funding, liquidation, venue callbacks, and persistent lifecycle state.

- **Not Variational:** Variational books a new bilateral derivative inside its settlement pools. This protocol leaves the user holding the actual GMX, Gains, Ostium, lending, or spot position.

- **Not Ithaca or Paradex:** Their package legs live inside their own product universes. This protocol transitions state across independently operated protocols.

- **Not DeFi Saver:** DeFi Saver proves that users value one-click position migration, but it focuses on lending positions and executes known recipes. Its Loan Shifter is an important adjacent competitor and a strong validation of the job. [DeFi Saver overview](https://help.defisaver.com/general/what-is-defi-saver)

- **Not a generic perp aggregator:** Aggregators compare and route new trades. The core product here is the bonded movement of an existing position under a verified terminal-state constraint.

## Protocol core

### 1. `TransitionIntent`

An EIP-712 typed order contains:

- Source position identifier and a verified starting-state snapshot
- Destination position constraints
- Target delta and tolerance band
- Minimum final equity
- Maximum total fee and price impact
- Deadline
- Accepted settlement class
- Compensation cap
- Nonce and replay domain

The order does not prescribe the venue call sequence.

### 2. Complete-transition RFQ

Registered solvers return signed quotes containing:

- Guaranteed final state
- Total user cost
- Execution deadline
- Required user collateral
- Solver bond
- Maximum compensation
- Restore or flatten policy after failure
- Quote expiry

Only successful execution pays a protocol fee.

### 3. User-controlled transition account

The user's smart account owns the actual venue positions and grants narrow, expiring permissions for the accepted transition. The solver cannot withdraw arbitrary assets or continue trading after the action budget expires.

GMX's delegated trading model already supports expiring action permissions and constrains outputs to the main account, which makes it a credible first adapter. [GMX delegated trading](https://docs.gmx.io/docs/api/contracts/delegated-trading/)

### 4. Adapter and validator registry

Each venue integration separates:

- Execution adapter: allowed calls
- State validator: how to verify position size, direction, collateral, and ownership
- Callback handler: executed, cancelled, and frozen states
- Risk module: acceptable price, fee, margin, and transition limits

Arbitrary calldata is prohibited in the first version.

### 5. Explicit settlement classes

- `ATOMIC`: every action and postcondition can succeed or revert inside one transaction.
- `ALL_OR_COMPENSATED`: asynchronous operations use a deadline, solver bond, unwind rule, and bounded compensation formula.
- `BEST_EFFORT`: not supported.
- `CROSS_DOMAIN`: future research only.

Do not call asynchronous cross-venue execution atomic.

### 6. Bond and compensation engine

Before execution, the winning solver locks enough collateral to cover the agreed maximum transition loss.

A simple first compensation rule is:

`compensation = min(bond, max(0, quoted_final_equity - verified_final_equity))`

The production rule must also specify:

- The oracle and timestamp used for valuation
- Which venue fees count
- What happens during an oracle outage
- Whether the source is restored or the portfolio is flattened
- How temporary delta outside tolerance is measured
- The maximum loss the user knowingly accepts beyond the bond

The bond is not a claim of unlimited insurance.

### 7. Lifecycle operations

The same typed primitive later supports:

- Migrate
- Flatten
- Hedge
- Unhedge
- Rebalance collateral
- Add margin
- Roll a dated position
- Close a complete package

The protocol becomes a company only if wallets and vaults integrate this lifecycle API rather than building their own venue orchestration.

## Privacy position

Privacy is useful, but the truthful first release is **pre-trade confidential RFQ**:

- The user commits to an intent onchain.
- Details are encrypted separately to selected solvers.
- Solvers commit signed quotes before reveal.
- Only the accepted transition becomes visible during execution.
- Resulting venue positions remain publicly inferable if the external venue is public.

Do not claim:

- Private balances
- Hidden post-trade positions
- Private liquidation levels
- House-blind matching
- FHE on Arbitrum One mainnet unless production support is verified

Fhenix documentation explains that computation requested from a chain such as Arbitrum One is performed asynchronously by the coFHE system, while current public starter deployments prominently list Arbitrum Sepolia. That is not enough evidence to make coFHE a mainnet launch dependency. [coFHE data evaluation](https://cofhe-docs.fhenix.zone/fhe-library/core-concepts/data-evaluation), [coFHE templates](https://cofhe-docs.fhenix.zone/cofhejs/resources/templates)

## Revenue model

Charge on the largest absolute leg, not the sum of all legs.

- Direct application: 3 to 5 basis points for a successful transition
- High-volume API integrators: 1 to 2 basis points
- Failed transition: no protocol fee
- Solvers retain the spread in their accepted quote
- Slashed bonds compensate users, not protocol treasury
- No token or liquidity mining is required

Illustrative revenue at 3 basis points:

- $1 million daily completed notional: about $109,500 annual revenue
- $10 million daily completed notional: about $1.095 million annual revenue
- $50 million daily completed notional: about $5.475 million annual revenue

These are scenarios, not forecasts. The business only works if it becomes an integration layer for wallets, vaults, and terminals. A standalone migration screen with low recurring volume is a feature.

## Go-to-market

### Supply first

Start with:

- One team-operated reference solver
- Two external execution firms or market makers
- One source venue
- One destination venue
- ETH and BTC only
- RFQ only, with no public package book

Solvers earn because they can price the complete transition, internalize offsetting flow, hedge through their existing accounts, and keep their quoted spread.

Do not subsidize solver participation with a token. If no solver will quote without emissions, the market is not ready.

### Demand

Find candidate wallets from Arbitrum history that repeatedly close a position on one venue and open equivalent exposure on another within a short window. Then recruit:

- Five active perp traders
- Two small funds or vault managers
- One wallet or trading terminal

The pitch is measurable:

- Fewer failed transitions
- Lower time outside the target delta
- Better all-in price
- One integration instead of multiple venue state machines
- Bounded compensation on failure

## Riskiest assumption and cheapest falsification

The riskiest assumption is not that users dislike manual execution. It is:

> Professional solvers can quote a firm, bonded cross-venue transition at a price that beats manual execution after bond cost, adverse selection, gas, and failure risk.

The cheapest falsification is a concierge shadow RFQ before building the full contracts:

1. Collect 20 real migration requests from at least five wallets.
2. Have two solvers return signed complete-transition quotes.
3. Compare each quote with the user's actual or simulated sequential close and reopen.
4. Ask users to choose between the cheapest route and a route charging 3 basis points with bounded compensation.

Proceed only if:

- At least two solvers will quote the same transition and post a meaningful bond.
- Median all-in improvement exceeds 5 basis points, or users explicitly accept a 3 basis point fee for the guarantee.
- Candidate users represent at least $5 million of plausible monthly transition notional.
- The smart-account and venue permission model leaves the user in control of the final position.

Kill or reshape if those conditions fail.

## Mainnet product slice

The hackathon product should be a real Arbitrum One web application with small, capped mainnet value.

### Contracts

- `TransitionIntent` verifier
- `QuoteSettlement`
- `SolverBondVault`
- `TransitionAccount`
- GMX adapter and state validator
- One second Arbitrum perp venue adapter and state validator
- Callback and timeout state machine
- Oracle-based compensation module
- Fee collector

### Offchain services

- Position indexer
- RFQ relay
- Two solver implementations with different pricing logic
- Transition monitor
- Public execution-quality explorer

### User flow

1. Connect wallet.
2. Detect a supported live position.
3. Select a destination venue.
4. Review competing complete-transition quotes.
5. Sign one typed intent and narrow session permission.
6. Watch source close and destination open as one lifecycle.
7. Receive either the destination position or a verified unwind plus compensation.

### Mainnet evidence

- At least ten real migrations across at least three wallets
- At least two competing solver implementations
- Actual positions owned by user-controlled accounts
- One deliberately induced venue failure that triggers unwind and bond slashing
- Published quote latency, completion time, time outside delta tolerance, final cost, and compensation

The failure demo is more valuable than a long feature list. It proves the new primitive.

## What is deliberately excluded from v1

- A new perp exchange
- A protocol-owned liquidity pool
- A public package order book
- Arbitrary N-leg calldata
- Cross-venue portfolio margin
- Cross-chain settlement
- Post-trade private positions
- FHE-dependent mainnet execution
- Options, lending, and yield adapters
- AI strategy generation
- A token

These can be researched after the transition primitive proves demand.

## Long-term company boundary

Perp Shift is the wedge, not the entire company.

If it works, the same protocol expands from position migration into:

- Emergency portfolio flattening
- Collateral refinancing
- Lending position migration with competitive quotes
- Delta-neutral hedge construction
- Complete package open, rebalance, and close
- Treasury portfolio transitions
- Wallet and vault execution APIs

At that point the original package thesis returns in a defensible form. The protocol is not valuable because it can describe many legs. It is valuable because integrators can specify a terminal portfolio state and outsource venue-specific execution, callbacks, failure recovery, accounting, and bounded-loss guarantees to a competitive network.

## Final positioning

Use this:

> We are building the execution network for moving live onchain positions. A user signs the end state they want, solvers compete on the complete transition, and bonded settlement either lands the actual venue-native positions in the user's Arbitrum account or restores and compensates the portfolio under an explicit failure rule. Perpetual position migration is the first product.

Do not use this:

- Private perp DEX
- Generic multi-leg RFQ
- Cash-and-carry app
- Strategy aggregator
- AI trading agent
- Atomic execution across asynchronous venues

This is the strongest surviving product because the hard part is the product: economically guaranteed movement of stateful positions across protocols that do not share one execution model.
