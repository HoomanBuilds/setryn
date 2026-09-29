# Arbitrum One product gap decision

Research snapshot: September 16, 2026.

Status: superseded comparative research. Blindbook is rejected as the current build direction because its category remains private secured lending. See the [current market-governed capital formation decision](./arbitrum-market-governed-capital-formation-decision-2026-09-16.md). This document remains historical research, not proof of customer demand, legal advice, an audit, or authorization to accept public funds.

Linkup deep search was used for discovery. Material product, deployment, mechanism, and pricing claims below were checked against protocol documentation, live APIs, repositories, or organizer sources. Funding and usage claims are not treated as proof of product-market fit.

## Decision

Build **Blindbook as a confidential repo network on Arbitrum One**.

The customer is a crypto market maker or trading treasury that needs fixed-term USDC financing against WETH without publishing a reconstructable healthy loan book. Qualified lenders fund term offers. Borrowers pledge collateral, draw USDC, service the loan, top up, repay, roll, or default. Loan size, collateral quantity, and healthy servicing remain private. Lenders receive selective disclosure and cryptographic state assurance. A threshold recovery operator set must be able to recover the latest valid state and liquidate collateral without a new borrower signature.

The product is not:

- a generic private lending protocol;
- an Aave privacy wrapper;
- a sealed-bid auction followed by public accounting;
- a Kimia port;
- an ORDR port;
- an AI agent interface;
- a single hidden-balance contract.

The working product sentence is:

> Blindbook is a confidential repo network for crypto market makers and trading treasuries. Qualified counterparties discover and settle fixed-term USDC financing against WETH on Arbitrum One. Loan size, collateral quantity, and healthy servicing remain private, while lenders receive cryptographic state assurance, selective audit access, and borrower-independent recovery.

This is the best current direction because it creates a new enforceable financing workflow, fits the team's demonstrated private-settlement capability, and can be shown as a complete mainnet lifecycle. It is still a high-risk startup. It returns to the research queue if lender and borrower validation fails.

## Candidate ranking after the final red team

| Rank | Candidate | Decision | Why |
| --- | --- | --- | --- |
| 1 | Blindbook confidential repo network | Build, subject to explicit validation gates | Full financial lifecycle, differentiated recovery mechanism, strong team fit, and credible Arbitrum reason. Capital distribution and privacy demand remain unvalidated. |
| 2 | Bonded liquidity mandate network | Do not make the flagship | The buyer is clearer, but Merkl, Arrakis Pro, Native Credit Pool, Aera, and the now-closed Hummingbot Miner cover most of the mechanism. Bonds and onchain SLA challenges are an increment, not enough moat. |
| 3 | GMX Term Carry Clearinghouse | Keep as a backup research candidate | A senior and junior loss waterfall is real risk transfer, but GMX, Boros, Pendle, Rho, and Ethena already own most of the distribution and rate stack. Junior capital is the cold start. |
| 4 | ORDR-style maker-native orderbook | No-build | Its Solana account-contention advantage does not transfer to Nitro, and Arbitrum already has Mangrove, Clober, Native, Arrakis, Renegade, and a published propAMM design. |
| 5 | Kimia-style fixed-yield stack | No-build | GMX, Pendle, Boros, Ethena, Dolomite, Notional, IPOR, and Spectra already cover the component stack. |

## Why not build Kimia on Arbitrum

[Kimia](https://docs.kimia.live/architecture) is not one small vault. Its documented devnet system combines an in-house SOL perpetual orderbook, delta-neutral funding vault, PT and YT split engine, yield AMM, fixed-rate router, and kUSD reserve system. That is useful product-depth inspiration, but it is the wrong Arbitrum opportunity.

Arbitrum already has the economic layers:

- [GMX](https://docs.gmx.io/docs/trading/order-types/) owns production perpetual execution, funding, borrow fees, and asynchronous order handling.
- [Pendle](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Fees) owns mature principal and yield tokenization plus yield liquidity.
- [Boros](https://docs.pendle.finance/boros-docs/Introduction) is already live on Arbitrum for fixed versus floating funding-rate trading, including margin, liquidations, a central limit order book, AMMs, settlement, APIs, and agents.
- Ethena is the scaled delta-neutral stable-yield alternative.
- Dolomite, Spectra, Notional, and IPOR cover adjacent leverage, yield, maturity, and interest-rate primitives.

The September 16 [Boros markets API](https://api-boros.pendle.finance/apis/v1/markets) snapshot returned 222 catalog markets after following every cursor. Thirty-one future-maturity, enabled markets represented about $5.27 million of reported notional open interest and $2.23 million of reported 24-hour volume. Its [TVL endpoint](https://api-boros.pendle.finance/apis/v1/total-value-locked) returned about $7.20 million. Those are API snapshots, not audited revenue, but they disprove an empty Arbitrum funding-rate category.

A GMX Term Carry Clearinghouse is the only serious survivor in this family. It would accept first-loss junior USDC, sell senior fixed-target claims, execute the actual GMX hedge, reconcile callbacks, and settle a defined loss waterfall at maturity. It is protocol-sized, but it only deserves promotion if a fully loaded 90-day simulation beats current fixed-yield alternatives and real junior capital commits. A standalone GMX funding future is a feature Boros can add more easily than a new team can bootstrap a venue.

## Why not build ORDR on Arbitrum

[ORDR](https://www.ordrtrade.com/) uses per-maker Solana accounts, one inventory vault, relative-price order levels, and protected cancellation flows. The architecture addresses Solana account write contention and maker repricing. Nitro executes EVM state sequentially, so copying per-maker account shards does not create the same concurrency advantage.

Arbitrum already has close maker infrastructure:

- [Mangrove smart offers](https://docs.mangrove.exchange/start-here/what-is-mangrove/smart-offers.md) let offers execute arbitrary logic, provide just-in-time liquidity, fail safely, and repost. Kandel supplies onchain two-sided grid strategies.
- [Clober V2](https://github.com/clober-dex/v2-core) has an Arbitrum deployment and onchain order-book contracts.
- [Native Credit Pool](https://docs.native.org/native-dev/solution/native-credit-pool) gives professional RFQ makers credit-backed inventory and has current Arbitrum router, RFQ pool, and CreditVault contracts in its [official address registry](https://docs.native.org/native-dev/resources/addresses).
- [Arrakis Pro](https://docs.arrakis.finance/arrakis-pro) already sells noncustodial active market making to token issuers.
- Renegade provides private matching, while UniswapX and other fillers compete for order flow.
- Biconomy's [Arbitrum propAMM design](https://github.com/bcnmy/propamm-arbitrum/blob/main/docs/propamm-on-arbitrum.md) already specifies signed price ladders, same-block commit and fill, maker provider contracts, caps, routing, and EIP-712 or EIP-1271 authorization.

[Stylus](https://docs.arbitrum.io/stylus/gentle-introduction) helps compute-heavy cryptography and mathematical hot paths, but its documentation says storage costs remain roughly comparable to EVM storage. A storage-heavy order book does not become a startup merely by being rewritten in Rust.

The chain ordering story also differs. Arbitrum governance approved moving from Timeboost toward priority gas auctions and Fast Feed, but an approved transition should not be reported as already active before activation. Even after activation, it does not reproduce ORDR's Solana-specific cancel-before-take protection.

## Why the bonded liquidity mandate network lost

The candidate would let token issuers fund a mandate, invite market makers to bid and post bonds, constrain issuer capital in a vault, measure executable spread, depth, uptime, and successful fills, and pay or slash makers after a challenge window. It initially looked attractive because an issuer is a recognizable payer and the protocol does not need to attract retail traders.

The overlap is too large:

- [Merkl](https://docs.merkl.xyz/merkl-mechanisms/technical-overview) already accepts prefunded campaigns, processes configurable onchain and offchain activity, computes time-weighted scores, publishes Merkle roots, exposes reward files, and runs bonded disputes. Its [standard fee](https://docs.merkl.xyz/distribute-with-merkl/fee-model) is 3 percent, declining to 1.5 percent at scale.
- Arrakis Pro already manages issuer-owned liquidity.
- Native Credit Pool already finances professional makers with single-sided LP and issuer capital.
- [Aera](https://docs.aera.finance/aera-protocol-in-one-page) already constrains professional offchain guardians inside noncustodial vaults using whitelisted operations, Merkle proofs, hooks, and configurable fees.
- [Hummingbot Miner](https://hummingbot.org/blog/introducing-the-hummingbot-foundation/) was almost the exact two-sided marketplace: issuers funded campaigns, market makers competed using their own capital, and the system paid for quoted liquidity. Hummingbot reports 3,300 makers, $2.5 billion of filled volume, and 84 issuers. The [live Miner notice](https://miner.hummingbot.io/) says all operations ended on March 16, 2026. No reviewed public source explains the closure.

The surviving difference is professional-maker procurement with explicit bonds and cross-venue executable quote SLAs. That is valuable, but Merkl could add the scoring and dispute type, Aera could add the vault constraints, and Arrakis or Native could add the maker relationship. At a 3 percent fee, $10 million of annual program budgets produces only $300,000 of gross revenue, and about $33.3 million is required for $1 million of gross revenue. This is not strong enough to displace Blindbook.

## The exact market gap Blindbook targets

Arbitrum does not lack lending. This review did not find a demonstrated mainnet product combining all of these properties:

1. Fixed-term, repo-style USDC financing against WETH.
2. Funded lender offers and actual capital encumbrance.
3. Private loan size, collateral quantity, and healthy-state servicing.
4. Selective disclosure to lenders, auditors, and approved operators.
5. Borrower-independent recovery from the latest valid private state.
6. Actual collateral sale, lender payment, borrower surplus, and bad-debt accounting.
7. A usable private USDC balance and settlement path, with honest disclosure of public-flow leakage.
8. An institutional web application, lender and recovery consoles, and an API.

Existing products prove that each neighboring category is real, but none reviewed proves the complete combination on Arbitrum One:

- [Secured Finance](https://docs.secured.finance/developer-portal/api-reference/fixed-rate-lending-subgraph) documents fixed-rate, fixed-maturity order books and an Arbitrum One endpoint.
- [Gavel](https://www.thegavelprotocol.org/) is an audited Arbitrum collateralized term-loan auction, but its current interface displayed zero active loans during this review.
- [August](https://docs.augustdigital.io/protocol-overview) offers institutional term-specific OTC credit, margin accounts, liquidation, and allowlisted DeFi execution on Arbitrum.
- Two Obscura repositories demonstrate confidential deal rooms or encrypted credit on Arbitrum Sepolia, but not the required mainnet recovery lifecycle.
- RAILGUN, Hinkal, and Hush supply private balances or private access to existing DeFi. A wrapper around public Aave debt would therefore not be enough.
- [Zama's September 15 launch](https://www.zama.org/post/confidential-defi-at-scale) reports 16 confidential Morpho vaults and more than $40 million in shielded TVL on Ethereum. This validates meaningful demand for position confidentiality while making generic confidential-yield claims weak.
- [Maple and Zodia](https://maple.finance/insights/zodia-custody-opens-interchange-to-maple) now offer onchain borrowing while collateral remains in segregated institutional custody. Blindbook initially targets contract-native trading firms, not institutions whose mandates require qualified custody.

Blindbook must never claim to be the first private lending protocol. Its defensible claim is the complete repo lifecycle and latest-state recovery design on Arbitrum One.

## Why Arbitrum One is a sensible home

[Arbitrum's confidentiality page](https://arbitrum.io/why-arbitrum/features/confidentiality) explicitly describes application-level confidentiality as available today, including selective disclosure, credit markets, derivatives, and fixed income. It separately labels confidentiality across a dedicated blockchain as coming soon. Blindbook therefore uses application-level proofs and encryption on Arbitrum One. It does not depend on a future confidential chain.

The mainnet has the necessary public primitives:

- Circle-issued native USDC at `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, listed in [Circle's registry](https://developers.circle.com/stablecoins/usdc-contract-addresses).
- [Canonical WETH](https://arbiscan.io/token/0x82af49447d8a07e3bd95bd0d56f35241523fbab1) at `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`.
- Chainlink ETH/USD pricing and an Arbitrum sequencer uptime feed. The liquidation policy must follow [Chainlink's L2 sequencer guidance](https://docs.chain.link/data-feeds/l2-sequencer-feeds) and enforce a recovery grace period after downtime.
- EVM-compatible Solidity custody and accounting.
- Solidity verification for BN254 proofs. A Stylus verifier can be explored later for compute savings, but it is not required to make the first product real.

The strongest reason to use Arbitrum is not cheap gas alone. It is the combination of native USDC, WETH, a deep trading and lender ecosystem, familiar EVM integrations, and explicit Foundation interest in programmable financial confidentiality.

Only Arbitrum One is needed. Adding other chains would increase proof-domain, asset, oracle, deployment, and operational risk without improving the first customer outcome.

## Full protocol architecture

### Onchain contracts

1. `EligibilityRegistry`: binds approved borrower, lender, auditor, and recovery roles to revocable credentials without putting commercial terms onchain.
2. `FundedOfferBook`: escrows lender USDC and commits private rate, term, LTV, disclosure, and recovery conditions. Accepted capital cannot be double allocated.
3. `ShieldedAssetVault`: holds actual USDC and WETH, tracks commitment roots and nullifiers, and enforces asset conservation.
4. `LoanBook`: records the current commitment head for every active agreement, prevents stale-state replay, and owns maturity and status transitions.
5. `VerifierRouter`: selects audited circuit verifiers for origination, draw, top-up, repayment, rollover, close, and recovery.
6. `RecoveryRegistry`: manages threshold operator keys, epochs, rotation, liveness bonds, and valid recovery recipients.
7. `RecoveryEscrow`: consumes the latest loan head after a proven maturity or oracle-bound default and releases only the agreed recovery path.
8. `LiquidationAdapter`: sells actual WETH for USDC using bounded slippage and distributes lender proceeds, operator compensation, borrower surplus, and recognized bad debt.
9. `FeeController`: accounts only for protocol origination and servicing fees. Lender interest and principal are never reported as startup revenue.
10. `EmergencyController`: caps exposure, pauses new origination, and preserves repay, close, and recovery paths.

### Proof and encrypted-state layer

Every continuing state transition must prove:

- ownership and authorization of the consumed private notes;
- membership of the exact current loan head;
- conservation of USDC, WETH, debt, accrued interest, fees, and change;
- compliance with the agreed rate, term, LTV, and permitted action;
- correct commitment of the replacement state;
- encryption of a complete replacement recovery snapshot to the registered operator threshold;
- binding between snapshot plaintext, ciphertext hash, new head, chain, contract, loan terms, key epoch, and recipients;
- unique nullifiers and atomic consumption so repay and recovery cannot both win.

The critical mechanism is the proof-bound recovery snapshot. A view key alone provides information, not authority over collateral. The escrow contract separately enforces when recovery is permitted and where proceeds go. Full repayment can close privately without an operator acknowledgement because no continuing debt remains. Default recovery must not require a new borrower signature.

The company target is a 2-of-3 recovery committee with an epoch public key, decryption shares, key rotation, and liveness bonds. A single operator should not be able to decrypt a healthy loan. If the event implementation instead encrypts a redundant envelope to each operator, it must disclose that any one operator can read the state and must not call that threshold privacy.

### Offchain services

- Browser prover and private wallet core.
- Encrypted output and loan-state indexer.
- Transaction relay that never receives the private witness.
- Threshold recovery operator network with health monitoring.
- Lender risk and statement service.
- Oracle and sequencer monitor.
- KYB and sanctions provider integration.
- Institutional API for offers, funding, state proofs, reports, and recovery status.
- Encrypted client recovery and device synchronization.

### User products

The first interface is a professional web application, not Android.

- Borrower desk: eligible collateral, funded quotes, usable proceeds, current obligations, top-up, repay, roll, and disclosure controls.
- Lender desk: free and allocated capital, term offers, portfolio proofs, maturities, loss and recovery statements, and view-key controls.
- Recovery console: operator key status, recoverable agreements, proof construction, auction execution, proceeds, and incidents.
- Admin and risk console: caps, credential status, oracle state, sequencer state, paused functions, verifier versions, and audit trail.
- API and SDK: treasury integration and lender automation.

## Mainnet demonstration that proves the product

The event build should use a capped, dust-value Arbitrum One market with real WETH and native USDC. It must demonstrate one complete adversarial lifecycle:

1. A lender escrows a funded 7-day offer.
2. A borrower pledges WETH and privately accepts the terms.
3. The borrower draws real USDC into a reusable private note.
4. The borrower performs at least one private top-up or partial repayment, replacing the current recovery snapshot.
5. The borrower stops cooperating.
6. A secondary recovery operator, not the borrower and not the primary operator, reconstructs the latest state.
7. The protocol consumes the current head, sells actual WETH, pays actual USDC to the lender, and returns any borrower surplus.
8. A competing stale recovery or full repayment attempt fails atomically.
9. The lender opens a scoped view showing agreement state and settlement without revealing unrelated loans.

If the demo only verifies a health proof, emits a liquidation event, or cancels a debt record without selling collateral and paying the lender, the product claim has not been demonstrated.

The public repository must include contracts, circuits, test vectors, verifier artifacts, deployment manifests, an architecture document, threat model, known privacy leaks, integration tests, and an explorer-verifiable mainnet lifecycle. No unaudited public deposits should be accepted.

## Revenue model and economic reality

Revenue comes from borrower origination and servicing fees, plus a separately disclosed recovery fee when recovery actually occurs. Lender interest, collateral TVL, loan principal, and gross liquidation proceeds are not revenue.

The aggressive benchmark previously considered was 25 basis points per origination plus 50 basis points annual servicing:

| Average term | Annual gross take on average debt | Gross revenue at $20M average debt | Average debt for $1M gross |
| --- | ---: | ---: | ---: |
| 30 days | 3.54% | $708,000 | $28.2M |
| 90 days | 1.51% | $303,000 | $66.1M |
| 180 days | 1.01% | $201,000 | $99.3M |

Those numbers are not automatically attractive. On a $500,000, 30-day loan at 8 percent APR, gross lender interest is about $3,288 while the stated Blindbook fees are about $1,455. The protocol would consume roughly 44 percent of gross interest economics. A buyer is unlikely to accept that without an exceptional confidentiality benefit.

At a more defensible 10 basis-point origination fee plus 25 basis-point servicing fee, reaching $1 million annual gross revenue requires roughly $68.2 million average debt at 30-day turnover, $152.5 million at 90-day turnover, or $220.9 million at 180-day turnover.

This is therefore a capital and distribution business as well as a software protocol. The buildathon can prove mechanism quality, but it cannot manufacture lender capital or a privacy premium.

## Risks that must remain visible

### Privacy and recovery

- Public deposits, withdrawals, timing, liquidations, and sparse aggregate changes can reveal amounts or relationships.
- Recovery operators can leak data or fail to remain available.
- A small allowlisted market has a weak anonymity set.
- External DeFi calls may hide the user link while still revealing the external amount and asset.
- A complete recovery snapshot is a new circuit and data-availability obligation, not something inherited from Moros.

### Capital and commercial risk

- Gavel's visible zero-loan state warns that correct term-loan contracts do not create borrowing demand.
- August, Secured Finance, Maple, Term, and custody-based workflows may offer better liquidity, capital efficiency, or institutional compatibility.
- Locking WETH in isolated escrow has a real opportunity cost.
- Lenders may demand more disclosure than borrowers will accept.
- A privacy premium may be lower than proving, recovery, security, and compliance costs.

### Asset and infrastructure risk

- Circle can freeze USDC addresses. Pooling USDC in one shielded vault concentrates this risk.
- Bad price gaps, thin liquidation liquidity, oracle faults, or sequencer downtime can create lender loss.
- Proof system, verifier, key rotation, relay, indexer, and operator failures need explicit escape and incident paths.
- Mainnet contracts require external security review before meaningful value.

### Regulatory risk

The first market should be credentialed, not falsely described as both permissionless and institutional. Operator control, fee extraction, asset selection, lender receipts, privacy, and Singapore-facing activity require specialist legal review. Protocol branding does not determine legal treatment.

## Validation gates

Continue building the mainnet proof of mechanism, but do not pretend the startup is validated. Blindbook remains the flagship only if all of these gates are pursued:

1. Two trading firms describe a recurring financing workflow where public loan size or collateral creates a concrete cost, and accept a specific collateral, term, disclosure, and fee structure.
2. One lender conditionally allocates capital against the same recovery and disclosure policy.
3. A fork or capped mainnet test proves secondary-operator recovery of the latest state after multiple private updates.
4. Reconstruction testing shows the intended real-world draw and repayment flow preserves useful confidentiality.
5. The all-in borrower price remains competitive after proving, relay, recovery, legal, and servicing costs.
6. Counsel defines a viable credential, lending, operator, and distribution structure before public capital is accepted.

Failure of gates 1 or 2 is not a marketing problem. It means the flagship should be reconsidered before a production launch.

## Startup path after the event

### Phase 1: proof of mechanism

- One WETH and USDC market on Arbitrum One.
- One lender and one borrower lifecycle.
- Complete latest-state recovery.
- Professional web desks and API.
- Dust-value cap and no public deposit campaign.

### Phase 2: design-partner pilot

- Two borrowers and one lender under explicit participation terms.
- Threshold operators and key rotation.
- Independent circuit and contract reviews.
- Statements, selective disclosure, risk caps, incident response, and privacy reconstruction testing.
- Measured all-in funding cost and operational reliability.

### Phase 3: production repo network

- Multiple lenders and maturity tenors.
- WBTC only after asset-specific custody, pricing, and recovery review.
- Funded rollover and claim-transfer mechanisms.
- Lender allocation policies and reporting.
- Recovery auctions and deeper liquidation routing.
- No additional chain until the Arbitrum market has repeat use.

## Open House framing

The Bengaluru winner Orbital combined difficult mathematics, a coherent market mechanism, deployed contracts, tests, APIs, liquidity, and a browser product. The lesson is not to copy its AMM. It is to make the difficult mechanism inspectable through one complete economic workflow. [Arbitrum's own winner guidance](https://dev.to/arbitrum/what-winning-arbitrum-open-house-teams-do-differently-18f8) says judges inspect the repository and demo before the deck and look for a functioning end-to-end product.

Blindbook has the right depth only if the demo ends in actual lender recovery. Its strongest event story is:

> A trading firm privately finances WETH, updates the loan twice, disappears, and a backup operator still recovers the exact latest obligation and pays the lender on Arbitrum One.

That is memorable, technically hard, commercially legible, and impossible to fake with a dashboard. It also extends the team's existing Moros and Orcus capabilities without copying either product.

## Final no-build list

Do not spend the event building:

- a new general-purpose perpetual exchange;
- another PT and YT splitter or yield AMM;
- a Boros clone or a GMX funding-rate market;
- an ORDR clone or generic EVM order book;
- an issuer incentive dashboard;
- an Aave privacy wrapper;
- a sealed auction whose winning loan becomes public;
- a health-proof demo without collateral recovery;
- an Android client before the institutional web and API workflow exists;
- a token before repeat financed volume exists.

The decision is Blindbook, narrowly defined as a confidential repo network with proof-bound latest-state recovery. The mechanism is deep enough for the event and the company scope is real. The commercial thesis remains conditional on counterparties accepting the same terms.
