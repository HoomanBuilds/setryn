# FeeForward: Historical Product Selection

Research cutoff: September 15, 2026, IST.

Status: selection reopened on September 15, 2026 after further competition, commercial-sizing, and protocol-depth research. FeeForward is not the locked product. Use the [current ecosystem and protocol search](./arbitrum-open-house-ecosystem-protocol-search.md) for the latest comparison and decision status. The recommendation and scope below are preserved as historical research, not current implementation instructions.

Historical decision: select FeeForward, a short-dated LP fee-risk RFQ product, for commercial validation. Build the mainnet pilot only after the counterparty and safety gates below pass. This was a researched recommendation, not a claim of product-market fit.

At the time of the recommendation, this report superseded the earlier PayLock, StateLatch, InvariantRail, and replacement-search recommendations. It is now historical too. Their competitor findings remain useful research. FeeForward is a working name, not a checked trademark.

## 1. The decision in plain English

An existing liquidity provider can accept USDC today in exchange for the trading fees attached to one eligible LP position over a short term. A buyer purchases those uncertain fee receipts without supplying or owning the LP's much larger principal inventory. The LP retains the residual position, but cannot withdraw or rebalance it while the sale is active.

Launch as a desktop-first web app on Arbitrum One mainnet, initially supporting canonical Uniswap v3 NFTs in one deep core-asset pool. Default commercial term: 72 hours. Support 24-hour terms only where the cashflow ticket is economically sufficient. No new AMM, debt, liquidation, native Android application, protocol token, or three-chain deployment.

The product is fee-income hedging for liquidity already intended to stay deployed. It is not working-capital finance. It is not fixed-income investing. The buyer can lose its entire purchase price, and the LP remains exposed to changing inventory and impermanent loss.

The fee entitlement is a conditional contract claim, not a natively detached Uniswap property. Its precise checkpoint and failure rules matter as much as its pricing.

The startup hypothesis is that standardized terms, credible underwriting, repeat funded buyers, and settlement history can make this a recurring market. A contract that redirects fees by itself is not the company.

## 2. Why this survived the research

Three independent research streams examined competition, economics, and mainnet feasibility, with a further decision audit. All returned a conditional go for a narrow experiment, not an unconditional build or funding-ready business.

Two earlier filtering mistakes are corrected:

- Competitors do not automatically invalidate a startup. Direct overlap matters when there is no credible switching reason, distribution path, or distinct buyer job.
- Mainnet-only is a deployment constraint. It does not establish that the eventual company must sell only to Arbitrum-native organizations or remain a one-adapter business forever. Expansion still requires a later decision and compliance with any award exclusivity terms.

FeeForward has a clear economic object: a particular position's collectable future trading fees. The cashflow can be controlled without relying on an offchain borrower voluntarily routing tomorrow's business revenue through our system. That is stronger than the rejected protocol-revenue financing thesis.

It also fits the team's demonstrated math and DeFi engineering strengths without reproducing the Orbital AMM concept. Engineering fit is useful; it does not establish customer access.

### Alternatives we are not selecting

| Direction | Why it is not our event product |
|---|---|
| Another Orbital-style AMM | Direct winner comparison, liquidity bootstrapping burden, and no distinct commercial job established |
| Generic Safe transaction guardrails | Strong incumbent distribution and substantial overlap; earlier revenue depended on bespoke integration work |
| Protocol-revenue credit marketplace | Near-exact Inkwell positioning plus bypassable revenue paths for many prospective borrowers |
| Liquidation rescue | Existing automation already covers the obvious user workflow |
| Generic stablecoin payroll or checkout | Existing products own payment workflows and regulated distribution; an Arbitrum deployment alone does not differentiate |
| Generic private payroll | Existing privacy infrastructure already addresses transfers and disclosure workflows |
| RWA compliance/preflight layer | Established issuer tooling, permission semantics, and compliance engines cover much of the proposed control point |
| Liquidity-incentive SLA platform | Existing campaign and market-maker platforms own distribution; attribution and manipulation remain difficult |
| Savings circles | Smart contracts cannot compel future contributions; collateralizing all obligations removes much of the credit benefit |

These are findings from the [earlier commercial red team](./arbitrum-open-house-revenue-and-product-depth-red-team.md) and its linked research, not proof that every company in these categories must fail. The original recommendation was to end broad idea hunting; the user subsequently requested continued cross-ecosystem research, which is recorded in the current report linked above.

## 3. What the event is actually asking for

The online Buildathon began September 14. Public scheduling runs through October 4. Online awards total $115,000: $70,000 overall, $15,000 Promising Products, and $30,000 discretionary grants. Published criteria include contract quality, product-market fit, innovation, and genuine problem solving. Solidity and Rust are both accepted; no native-mobile requirement is published. At least one award in each listed three-place prize track is reserved for Robinhood Chain, so do not treat every advertised dollar as available to an Arbitrum One-only entry. [Official HackQuest listing](https://www.hackquest.io/en/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)

Founder House is October 23-25 in Singapore, with $300,000 in prizes and grants. Its application is separate and reviewed on a rolling basis. Luma says all online winners receive a guaranteed spot; HackQuest's wording refers to the top three. Apply to both processes and ask the organizers to clarify the difference. Founder House expects an existing product and meaningful new progress, not arrival with just a fresh idea. [Official Founder House application](https://luma.com/openhouse-singapore)

There is a deadline and payout-document conflict in the earlier research. The previously reviewed linked terms specified October 1, 23:59 SGT and 25/25/50 milestone payments, while public pages advertised later scheduling and newer communication described a different split. The terms URL now returns inaccessible/HTML content in our recheck, so those provisions are historical observations, not newly verified binding rules. Set September 30 as our internal submission freeze and obtain the current signed terms before budgeting any award. Do not plan development around the October 4 date until clarified. [Previously linked terms](https://openhouse.arbitrum.io/singapore_version_open_house_buildathon_terms___conditions.pdf), [Foundation program announcement](https://blog.arbitrum.foundation/builders-block-023-415k-in-prizes-at-open-house-singapore-apply-now/)

You mentioned a maximum of three chains. The retrieved rules do not establish that limit or require using three. One qualifying deployment is enough for our strategy. Mainnet-only remains our stricter product constraint, even though the event also accepts testnet deployments.

### What to learn from earlier winners

The Bengaluru mathematics project was Orbital AMM Protocol. It won first place in September 2025 with higher-dimensional concentrated liquidity and a high-precision Stylus math layer. Shinobi.Cash and GuardChain.ai placed second and third. The online edition recognized Plexi, Orbital, and TriggerX. The useful pattern is a coherent problem, implemented mechanism, and understandable workflow, not a requirement to build another AMM or force Rust into every project. [Official India recap](https://blog.arbitrum.foundation/arbitrum-open-house-india-concludes-with-bengaluru-hacker-house-full-recap/)

The NYC and London research also showed variety rather than a mandatory consumer/mobile category. Treat winners as execution examples, not a formula for winning. [NYC winners](https://blog.arbitrum.foundation/open-house-nyc-buildathon-concludes-meet-the-winning-teams/), [London Founder House winners](https://blog.arbitrum.foundation/top-founders-take-home-300k-at-london-founder-house/)

Our strongest judging evidence would be two independent counterparties, a real fee purchase, a completed settlement, transparent failure tests, and a second term. That is more persuasive than a large architecture diagram with no users. No outcome or prize is guaranteed.

## 4. The exact customers

### Seller

An identifiable owner of an established, material, fee-generating Uniswap v3 position who already intends to keep its ticks unchanged for longer than our term.

Good initial candidates are broad-range or treasury-managed liquidity with genuine holding intent. Those are hypotheses to verify from actual NFT IDs, owner behavior, and interviews. A treasury may still need governance approval or emergency exit, so it is not automatically an easier customer.

Poor candidates are active narrow-range market makers, launch-token liquidity, tiny retail positions, already-locked NFTs whose current locker cannot hand over custody, or anyone expecting unilateral exit during the term.

Current workaround: wait and collect fees, collect already-earned fees immediately, remove some liquidity, or borrow against the NFT. Revert Lend is a concrete alternative, with LP-position-backed borrowing and liquidation risk. We must beat the customer's actual preference, not merely demonstrate that borrowing and fee sales differ. [Revert borrowing](https://docs.revert.finance/revert/revert-lend/borrowing), [Revert liquidations](https://docs.revert.finance/revert/revert-lend/liquidations)

Why switch: a seller values a known short-term receipt enough to accept the buyer's discount and the incremental cost of losing flexibility. If it does not, no amount of product polish rescues the trade.

### Buyer

A sophisticated fee-risk trader, independent dealer, or small quantitative fund willing to pay a bounded premium for uncertain token-denominated receipts.

This is not an ordinary USDC depositor looking for safe APY. The buyer is expressing a view on volume, range occupancy, competing liquidity, fee policy, and fee-token prices. The buyer avoids ownership of LP principal, but collected WETH or other tokens still carry price exposure.

Current workaround: hold LP inventory, buy a liquid yield token, trade volatility, or decline the exposure. FeeForward must justify its expected return, data quality, contract risk, and illiquidity against those options.

### Who is not a customer

Judges, prize sponsors, the founding team trading with itself, incentive farmers, and people who only call the idea interesting. Count team and related-party activity separately and never report it as organic demand.

## 5. Competitors: the primitive is not new

| Product or precedent | Mechanism overlap | Meaningful distinction and evidence status |
|---|---|---|
| ScopeLift Fixed Fee Swap | Direct LP principal/yield separation and short-term fee markets | March 11, 2026 open-source Uniswap v4 proof of concept using fungible static-position vault shares and a yield AMM; production gaps explicitly remain. Existing individual v3 NFTs plus funded RFQ is a different implementation and distribution job, not a wholly new invention. [Source](https://scopelift.co/blog/liquidity-provider-fixed-fee-swap) |
| Flashstake | Upfront yield against locked assets; its 2023 RFC explicitly proposed future Uniswap LP fees for yield buyers | Near-exact economic prior art. The retrieved strategy directory does not list a Uniswap LP strategy. That does not prove none ever shipped. No current repeat NFT-fee market was verified. [RFC](https://gov.uniswap.org/t/rfc-flashstake-enabling-upfront-yield-for-uniswap-liquidity-v2-v3/21410/1), [directory](https://docs.flashstake.io/time-vault-strategies-tvs/time-vaults-database) |
| Pendle | Principal/yield separation; documented GLP principal and fee-reward separation | Strong substitute with established yield architecture. Our exact-position terms differ from fungible underlying markets, but a future pooled FeeForward product would collide more directly. [Architecture](https://docs.pendle.finance/pendle-v2-dev/HighLevelArchitecture) |
| Spectra | Permissionless maturity markets for fungible interest-bearing tokens | An individual NFT's trading-fee claim differs from an ERC-4626-based yield strip. Vault packaging is not our launch wedge. [Permissionless pools](https://docs.spectra.finance/core-concepts/permissionless-pools) |
| Napier v2 | Curator-led principal/yield issuance and markets | Another substrate or competitor for standardized yield. No direct individual-NFT implementation verified in this research. [v2 announcement](https://napier.finance/blog/napier-v2-is-live-fix-trade-and-curate-yield) |
| Timeless | Perpetual yield rights, rather than a bounded cashflow window | Public implementation exists; present meaningful activity was not established here. [Code](https://github.com/timeless-fi/timeless) |
| Resonate/Revest | Locked principal, upfront yield, temporal matching and separate rights | Prior art for non-AMM matching and rolling terms. Public implementations and historical launches exist; current active LP-fee liquidity was not verified. [Contracts](https://github.com/Revest-Finance/ResonateContracts), [whitepaper](https://www.resonate.finance/assets/NewWhitepaper.a5e3eb3a.pdf) |
| HyperSwap / Raydium fee-right lockers | Transferable collection rights over permanently locked liquidity | Useful inspiration from other ecosystems. Permanent principal lock is materially different from an intended short-term NFT return. [HyperSwap Burn & Delegate](https://docs.hyperswap.exchange/docs/amm/protocol-concepts/liquidity-pool/burn-and-delegate/), [Raydium Burn & Earn](https://docs.raydium.io/user-flows/burn-and-earn) |
| Revert / PWN | Upfront liquidity against pledged assets | Loans, not a fee sale; repayment and collateral-loss conditions remain. [Revert](https://docs.revert.finance/revert/revert-lend/borrowing), [PWN](https://docs.pwn.xyz/guides/lending-on-pwn/creating-a-lending-proposal) |

Search did not verify a live Arbitrum One marketplace offering our complete combination. That is a bounded search result, not proof of global absence or a moat.

The business must earn differentiation through exact-position underwriting, executable repeat quotes, low-cost settlement, and embedded distribution. Shorter maturities and an NFT wrapper are not defensibility by themselves.

### What we can and cannot claim

Can claim, once built: an existing-position fee sale, specified rights, funded quotes, no loan repayment, and observed settlement outcomes.

Cannot claim: first-ever yield separation, guaranteed USDC returns, protection from impermanent loss, uninterrupted buyer fee ownership under every failure, automatic timestamp expiry, or a liquid secondary market that does not exist.

## 6. The harsh roast that shaped the product

The single most damaging issue is the mismatch between the tiny fee advance and the entire NFT placed under custody.

Assume, only for illustration, a constant 20% annual trading-fee rate:

| LP marked value | 24-hour fees | 72-hour fees | 70% premium for 72-hour fees |
|---|---:|---:|---:|
| $100,000 | $54.79 | $164.38 | $115.07 |
| $500,000 | $273.97 | $821.92 | $575.34 |
| $1,000,000 | $547.95 | $1,643.84 | $1,150.68 |

These are arithmetic scenarios, not observed pool returns or forecasts. Locking $100,000 to receive approximately $115 is generally a weak financing proposition. During a shock, the option to exit can be worth much more than the premium.

| Priority | Problem | Required response | Effort |
|---|---|---|---|
| P0 | No evidence sellers and buyers cross on price | Same-position reservation prices and capital-backed bids before contract implementation | 48-hour discovery |
| P0 | Whole-position custody can destroy seller demand | Only users already intending to stay static; terms accepted explicitly; compare against partial withdrawal and borrowing | Discovery plus product constraints |
| P0 | Maturity and recovery promises can be false | Checkpoint-defined expiry and disclosed terminal collection-failure treatment | Significant design and adversarial review |
| P1 | Empty public marketplace | Recruit two funded quoting buyers before publishing executable offers | Founder-led distribution |
| P1 | Tiny platform revenue and manual service costs | Cashflow ticket floor, repeat quotes, and automated reproducible analysis | Ongoing product work |

Do not respond to failed demand by adding AI, baskets, leverage, tokens, or longer locks. That would turn a failed trade into a larger unvalidated product.

## 7. Product surface and complete workflow

Desktop-first web is the decision because the first users need position analysis, quote comparison, wallet signing, and risk review. Make it mobile-responsive for monitoring and claims. Native Android is deferred until observed usage demonstrates a phone-specific acquisition or workflow advantage. No such evidence exists yet.

The complete first product has four surfaces, not a dashboard with one deposit button:

| Surface | Required behavior |
|---|---|
| LP workspace | Read-only NFT discovery, ownership verification, fee history, range exposure, alternatives, term selection, net quote comparison, acceptance and recovery |
| Buyer terminal | Eligible offers, reproducible data, limits, capital availability, quotes, acquired rights, native-token claims and realized returns |
| Shared term page | Parties, exact NFT/pool/ticks, premium, fees, activation time, settlement eligibility, longstop, estimated collectable fees, realized claim balances and explorer-backed history |
| Operations console | Indexer health, failed collections, settlement lag, suspicious activity, quote availability and fee reconciliation; no authority to redirect principal |

### Seller journey

1. Connect or enter an address to inspect eligible positions without signing anything.
2. See the last 30 days of measured fees, range occupancy and data gaps. A short history is a warning, not annualized certainty.
3. Compare doing nothing, collecting existing fees, partially withdrawing, borrowing, and selling the proposed term's fees.
4. Request quotes for 24 or 72 hours. The NFT stays in the owner's wallet while quoting. No buyer means no lock.
5. Review actual bids, net USDC proceeds, forfeited fee upside, loss of exit flexibility, and checkpoint/recovery terms.
6. Approve only the chosen NFT and execute an atomic purchase. Clear old owed balances to the seller, activate the fee contract, and fund the premium in the same successful transaction.
7. Monitor without pretending the position is managed. After settlement eligibility, invoke settlement directly if needed.
8. Recover the residual NFT and see realized economics. A new term requires a new explicit acceptance; no silent auto-roll.

### Buyer journey

1. Analyze the same exact NFT and disclosed data snapshot, not a pooled headline APY.
2. Submit a quote with amount, term, expiry and capacity. The commercial gate initially uses conditional commitments, not deposits into unreviewed contracts.
3. In the implemented pilot, acceptance must atomically pull the premium and enforce available capital. An allowance or wallet balance alone is not guaranteed quote funding.
4. Own one recorded fee entitlement for that term. No fractionalization, transferable claim token or secondary exchange in the first release.
5. Collect realized native-token receipts through pull claims. Display cost, receipts, marked value, realized conversion if any, and net performance separately.
6. Quote again only if the exposure and execution quality justify it.

RFQ means competitive requests for quotes from known funded buyers. It does not mean an undisclosed team-controlled price or a guaranteed bid. The initial service can curate offers and distribute quotes, while contract settlement must not depend on an operator's later consent.

Position-level history is a requirement awaiting verified data infrastructure. It must distinguish swap-fee growth from burned principal and handle liquidity changes. Current `tokensOwed` and historical `Collect` totals alone cannot supply reconciled fee history. Estimated collectable fees are not realized stored balances or guaranteed payouts.

## 8. Revenue and honest market size

Proposed price test, not a validated market price:

- Seller origination fee: 2% of the accepted upfront USDC premium.
- Buyer cashflow fee: 2% of actual collected term fees, charged in the native pool tokens.
- No charge on LP principal, no fee on the DEX's entire swap volume, no emissions, and no mandatory token-to-USDC conversion.

For premium `P` in USDC and collected fee tokens `F0` and `F1`:

`Platform revenue = 0.02 * P + mark(0.02 * F0, 0.02 * F1)`

`Seller net premium = 0.98 * P`

`Buyer receipts = 0.98 * F0 and 0.98 * F1`

The mark must carry source and timestamp. In-kind receipts are not already realized dollars. Buyer dollar return also depends on acquisition and conversion timing. Pendle's documented 5% YT yield fee is a useful adjacent pricing benchmark, not evidence customers will accept our fees. [Pendle fees](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Fees)

### One trade

Using the $500,000 illustration above, expected fees are $821.92 and a hypothetical buyer premium is $575.34. Seller net premium is $563.84. Platform origination revenue is $11.51; if fees realize exactly as assumed, marked cashflow revenue is $16.44. Gross platform revenue is $27.95.

If a distribution partner receives 20% of platform revenue, $22.36 remains before execution, infrastructure, support, quote acquisition and amortized security/legal costs. Partner commission is a scenario, not an agreement.

Manual bespoke underwriting cannot remain in this unit economics. For an initial ticket, test expected fees of at least $500 and an actual premium of at least $350, with at least $10 contribution after measured variable costs. These floors generate $17 gross and $13.60 after the illustrative partner share, leaving only $3.60 for other variable costs if the contribution target is to pass. They do not guarantee acceptable margins. The thresholds are hypotheses to update from quotes. A small mechanics demo can use smaller amounts, but must not count as validation of commercial margins.

### Current fee base

Direct DefiLlama API queries rechecked during this research returned these Arbitrum trailing-30-day records:

| Metric | Observed value |
|---|---:|
| Gross swap fees in the Uniswap v3 record | $2,374,017 |
| Revenue in the record labeled Uniswap v3 | $605,956 |
| Annualized gross v3 fees, multiplying by 365/30 | $28,883,874 |

The two records are not safely subtractable as v3 LP income. DefiLlama's methodology says other Uniswap versions' revenue is tracked in the v3 adapter; source inspection also found revenue based on shared buyback-release events rather than each position's contemporaneous fee accrual. The earlier $21.5 million annualized LP-remainder calculation is withdrawn. [Methodology](https://defillama.com/protocol/uniswap?fees=true&revenue=true), [Adapter source](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/uniswap-v3.ts)

For reproducibility, select `slug == "uniswap-v3"` and `total30d`, but verify the metric's scope rather than trusting the slug. The gross-fee source filters v3 trades; the revenue record has shared scope. These are aggregate USD-marked observations, not forecasts, LP customers or transferable receivables. [Fees API](https://api.llama.fi/overview/fees/Arbitrum?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees), [Revenue API](https://api.llama.fi/overview/fees/Arbitrum?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue)

If premiums equal 70% of realized fees, the modeled combined take is 3.4% of sold cashflows. The actual effective take on nonzero realized receipts is `2% + 2% * premium / realized cashflows`, so forecast errors and checkpoint extensions change it. Applying the 3.4% scenario to 20% of annualized gross v3 fees gives about $196,000 gross annual platform revenue; at an unrealistic 100%, about $982,000. These optimistic scope comparisons ignore protocol cuts and eligibility, and are not estimates of actual addressable LP income or the first pool's opportunity. The eligible base is much smaller.

A $1 million annual-revenue business at that take needs about $29.4 million of sold yearly cashflows. A $10 million business needs about $294 million. A single Arbitrum v3 adapter does not support that pitch. Future mainnet venue/chain expansion is a business hypothesis requiring real demand, adapter review and award-term clearance, not part of the event build.

The immediate bottom-up model must enumerate eligible NFT owners and observed fee production. Reject this as a venture-scale thesis if scaling requires implausible adoption, even if it can support a niche small business.

## 9. Depth compared with recently funded products

Funding is not proof of product-market fit. Company fundraising pages are self-reported and their product claims require separate verification.

| Product and recent evidence | What its depth actually consists of | Lesson for us |
|---|---|---|
| Kimia, Solana; current MetaDAO page shows $60,000 raised | Exchange, funding-rate strategy, vaults and settlement form one proposed cashflow engine; the page describes devnet and future mainnet rollout | Coherence and precise deployment milestones matter more than feature count. The page also shows a failed August 19 liquidation/IP-return proposal. Failed does not mean approved liquidation, but this is not uncomplicated success evidence. [Company page](https://metadao.fi/companies/kimia) |
| P2P Protocol, currently Base with Solana expansion described; $6 million raised | Merchant supply, reputation, dispute handling, local rails and distribution; reports $4 million monthly volume in February 2026 and $578,000 annual revenue run rate | The local supply network and recurring paid trade are the company, not just ZK verification or matching. Reported run rate is not audited ARR. [Company page](https://metadao.fi/companies/p2p-protocol) |
| Credible; $4 million raised | Reports $784 million processed, $146 million in June 2026 and $3.5 million revenue run rate; rails, risk, compliance and banking relationships support the recurring job | Small take rates need real volume and costly distribution infrastructure. A neat revenue formula is not evidence that customers exist. [Company page](https://metadao.fi/companies/credible) |
| Midas; $50 million Series A announced March 30, 2026 | Investment products, liquidity capacity and DeFi integrations; announcement reports up to $40 million initial liquidity-layer capacity | Capital, redemption operations and integrations solve the complete product job. We cannot claim market liquidity merely because an RFQ screen exists. [Announcement](https://blog.midas.app/midas-raises-50m-series-a-to-launch-instant-liquidity-layer/) |
| Cambrian; August 24, 2026 announcement reports $11.9 million total raised | Financial data and intelligence infrastructure, rather than another generic analytics page | Reproducible data and a real consumer can compound into infrastructure. Our underwriting data must improve actual bids, not decorate charts. [Announcement](https://www.cambrian.org/blog/cambrian-raises-11-9M-seed-funding) |

FeeForward does not yet have comparable traction, distribution or organizational depth. Its proposed depth is one connected loop: discover suitable positions, price risk, obtain funded quotes, settle enforceable rights, measure outcomes, and repeat through integrations. Every part must serve an actual trade.

### What would accumulate

- Position-level fee histories and model calibration, including failed forecasts.
- Quote curves, dealer capacity and actual seller reservation prices.
- Settlement reliability and dependency-failure history.
- Repeat counterparties and embedded LP-workspace distribution.

Public-chain data is not proprietary by itself. Contracts and terms can be copied. The potential moat is a reliable repeated market with better execution, not secrecy around a wrapper.

## 10. Mainnet and technical boundaries

This is a product-level feasibility specification, not reviewed contract architecture. Do not treat it as permission to deploy or move funds.

### Chain and first adapter

Use Arbitrum One, chain ID 42161. Start with Uniswap v3 because existing NFT ownership and collection semantics are documented and mainnet-verifiable. Camelot is an important native ecosystem, but its separate accounting should be reviewed before a later adapter. Neither a native DEX logo nor extra chain improves the first trade.

Official deployment references confirm the position manager and native USDC. Read-only RPC checks also found position-manager code, a matching factory, and an active native-USDC/WETH 500-tier pool. That pool is a mechanical pilot candidate, not a promise of sufficient eligible sellers. [Uniswap Arbitrum deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-arbitrum-deployments), [Circle addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Camelot deployments](https://docs.camelot.exchange/contracts/arbitrum/one-mainnet/)

### Custody and baseline

Escrow must actually own the NFT. Seller approval alone is revocable and insufficient. Neither party receives transfer, decrease-liquidity or arbitrary-execution authority while the term is active. The accepted NFT, ticks, liquidity snapshot, premium, term, counterparties and fee rules must be bound to that transaction. [Canonical position interface](https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol), [Collection guide](https://developers.uniswap.org/docs/protocols/v3/guides/managing-liquidity/collect-fees)

Clear all old owed tokens before activation. `tokensOwed` can include principal from earlier liquidity decreases, not just swap fees. Prohibit decreases during the sold term, and account using actual received balances rather than assuming event amounts equal payouts. Liquidity additions are permissionless, so ticks can stay fixed while liquidity increases. Disclose that all fees attached to the NFT during the term, including donated additions, follow the buyer claim; terminal added inventory follows the seller's NFT. [Position-manager source](https://github.com/Uniswap/v3-periphery/blob/main/contracts/NonfungiblePositionManager.sol)

### Maturity is a checkpoint, not a magical timer

Version one uses this explicit rule: settlement becomes eligible at target time T; the purchased fee window ends at the first successful permissionless collect-and-release checkpoint after T.

Uniswap v3 does not natively supply historical fee growth at an arbitrary expiry timestamp. Delayed collection therefore includes later accrual. A displayed countdown cannot turn that into exact timestamp settlement. [Pool implementation](https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Pool.sol)

The LP wants its NFT back, the buyer wants payment, and either can settle. A keeper provides a service, not a guarantee. Anyone must be able to call without a privileged backend. Quote pages disclose the target and actual checkpoint times separately.

### Recovery tradeoff

Choose seller-principal recoverability over indefinite custody under a terminal collection failure, subject to the NFT transfer itself remaining functional.

Proposed longstop: T plus 24 hours. A permissionless recovery call must first attempt normal collection. Only a genuine collection failure may lead to NFT return and extinguishment of unpaid buyer fee rights. Previously collected balances remain claimable. The buyer purchases this explicit dependency-failure risk.

This is not a claim that every failure can be cleanly solved. A permanently reverting NFT transfer can still prevent return. An attacker must not be able to manufacture the collection-failure branch by supplying insufficient gas, provoking a receiver callback, or abusing reentrancy. A failed low-level call or ordinary `try/catch` alone does not prove genuine dependency failure. The exact allowlisted dependencies need a reviewed gas-forwarding and failure-classification boundary. Proving that boundary is a mandatory safety gate. If it cannot be established, do not ship this recovery mechanism or conceal indefinite-lock risk.

Collect into escrow and assign pull balances instead of pushing funds to the buyer during NFT return. Buyer payout failure should not ordinarily block seller exit. USDC's pause and blocklist powers remain dependency risks; noncustodial branding does not remove them. [Circle token implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v1/FiatTokenV1.sol), [Pause controls](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v1/Pausable.sol), [Blocklist controls](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v1/Blacklistable.sol)

### Settlement states and callers

| State or transition | Caller and purpose | Necessary boundary |
|---|---|---|
| Quoting | Seller requests, buyers quote | NFT remains with seller; quote expiry and cancellation work |
| Atomic activation | Seller accepts an executable buyer quote | Buyer pays, baseline clears and NFT enters custody together, or everything reverts |
| Active | Parties monitor; collection can be user-triggered where economical | No rebalance, early principal exit or double sale |
| Settlement eligible | Anyone calls after T | Successful fee checkpoint and NFT return; buyer does not need to co-sign |
| Recovery eligible | Anyone calls after longstop | Reviewed genuine-failure branch; unpaid rights treatment is disclosed |
| Settled or recovered | Beneficiaries claim stored balances | Terminal state cannot reopen; no double claims |

Pause authority, if needed for the pilot, should stop new activations, not silently disable existing settlement or recovery. Active-term rules and fees cannot be changed by the team. Publish any remaining authority and dependency risks.

### Stylus and stack decision

Solidity is the first custody/settlement implementation choice. Offchain position analysis can use TypeScript or a Rust library where benchmarking justifies it. Do not place probabilistic forecasts in a fund-moving contract.

Stylus is not required for version one. A later exact-expiry design could explore authenticated historical-state verification, but read-only research has not demonstrated a complete safe solution. Archive proof availability and verifier review add dependencies. It is not the 15-day critical path or a submission claim. [Arbitrum block/hash documentation](https://docs.arbitrum.io/arbitrum-essentials/arbitrum-vs-ethereum/block-numbers-and-time)

For a later implementation, a conventional web frontend, wallet integration, event indexer, database-backed RFQ service and reproducible analysis worker are sufficient. Final dependency versions belong to implementation planning, not this research snapshot. There is no justification for a novel chain, custom wallet, or new AMM.

## 11. Risk engine and economic attacks

The underwriting output must estimate term receipts in both native tokens, uncertainty intervals, and break-even against an actual bid. Start with empirical replay and scenario analysis, not an opaque AI score.

Required inputs: exact ticks/liquidity, net LP fee growth, time in range, recent swap flow, active competing liquidity, protocol fee settings, token prices and data quality. Expected fee tier times volume is insufficient.

Read-only checks found the candidate USDC/WETH pool's protocol fee setting was `0x44`, corresponding to one quarter of swap fees in each direction retained by the protocol at that observation. This is dynamic, pool-specific data, not a permanent 25% assumption. Price net LP receipts and recheck at quote time. [Uniswap protocol fee concepts](https://developers.uniswap.org/docs/protocols/protocol-fee/concepts/fees)

| Risk | Product response and residual limitation |
|---|---|
| Position leaves its range | Show zero-fee scenario and range-survival sensitivity; no guaranteed floor |
| Seller offers ahead of volume collapse | Established history and conservative quotes; private information cannot be eliminated |
| Manufactured historical swaps | Flag suspicious flow and related parties; do not reward headline volume |
| Competing liquidity dilutes fees | Replay share sensitivity; present share is not a future guarantee |
| Buyer recaptures fees from its own toxic trades | Deep core pools and conservative concentration screening; seller still bears inventory losses |
| Fee policy changes | Quote current settings and disclose governance uncertainty |
| Fee token price moves | Native-token payout plus timestamped marks; no silent USDC guarantee |
| Settlement delay or sequencer disruption | User-accessible settlement, lag monitoring, explicit checkpoint extension and recovery rules |
| Collection or token failure | Disclosed recovery tradeoff, reviewed code, bounded pilot exposure |
| Sparse or missing historical data | No executable offer without adequate evidence; display gaps instead of fabricated precision |

An admission cap on the NFT's current share of active liquidity is a screening rule, not a promise that its share stays capped as other LPs leave. Do not invent slashing or oracle guarantees to conceal this limitation.

## 12. Validation before implementation

The riskiest assumption is that independently funded buyers bid enough to satisfy real LP sellers after both sides understand lost flexibility and conditional recovery.

### Gate A: 48-hour commercial discovery

Contact owners and buyers using a concise offer sheet and read-only position analysis. Do not deploy a contract to test whether anyone wants the trade.

Pass requires all of the following:

- Three independent eligible LP owners provide actual mainnet NFT IDs, intended holding duration, a chosen term and minimum net USDC proceeds.
- Two independent buyers provide actionable bids for those same positions and terms, conditional only on the agreed safety/deployment checks.
- Two trades cross after platform fees, involving two distinct sellers and both independent buyers, with at least $700 aggregate premium committed from external buyers at the proposed ticket floor.
- Both parties explicitly accept no rebalancing/exit during the term, possible zero fees, token-denominated payouts, checkpoint extension and longstop unpaid-fee treatment.
- A reproducible owner/NFT prospect list and per-trade cost model supports plausible contribution without bespoke engineering per trade. Include onboarding labor, collection/settlement, infrastructure, support and any dealer-acquisition payments; modeled contribution is not measured contribution.

Capital-backed means a specific wallet or credible funding commitment supports the quote. A read-only balance check is supporting evidence, not an escrowed deposit. Report commitments as commitments. No money moves during this research, and no participant should deposit into unreviewed code.

Fail if the only crossing bids are team-funded, subsidized, dependent on tokens, or require unilateral seller rebalancing. Fail if meaningful ticket sizes occur only in thin/manipulable pools. If Gate A fails, do not build FeeForward as the selected startup. That result is customer evidence, not a reason to expand its feature list.

### Gate B: safety and mechanics

After commercial demand passes, implementation must prove on local Arbitrum One forks:

- Atomicity across funding, NFT custody and baseline clearing.
- No old burned-principal balance paid to the fee buyer.
- No transfer, approval, decrease, reentrancy or replay route around active rights.
- Permissionless donated liquidity handled according to disclosed terms.
- Correct native-token accounting, decimals, dust and rounding.
- Expiry boundary, delayed settlement, zero fees and multiple claims.
- A failed buyer payout does not ordinarily block NFT return.
- Longstop failure cannot be spoofed with gas manipulation or callback behavior.
- Team disappearance and paused-new-activation behavior leave existing rights callable.

Use an independent reviewer before external funds. Small value and an audit label are not guarantees. A mainnet pilot requires explicit wallet authority, dollar caps and informed participants; this report does not authorize execution.

### Gate C: repeat behavior

After the first reviewed mainnet term, require at least one original seller and one original buyer to repeat in a paid term. Commitment to three terms is useful, but only three completed paid terms establish that behavior. Track seller and buyer repeat rates, quote coverage, fee receipts, settlement lag, forecast calibration and contribution after variable costs.

A one-off subsidized demo is not startup validation. A technically correct but non-repeating market is not yet the full product business we want.

## 13. Distribution and product expansion

First ten customers: identifiable existing LP owners and a small quoting-buyer network, not generic crypto audience acquisition.

Potential routes to test are LP analytics/management communities, treasury-owned liquidity teams, and an embedded quote action inside an existing LP workspace. These are prospect channels, not signed partners. Begin with a free read-only position report because it creates the exact quote conversation without a custody commitment.

Before public offers, establish two independently funded buyers. After repeat terms, test one integration that delivers recurring eligible positions. Target reusable onboarding measured in minutes, not custom smart-contract work for every seller.

Expansion order is conditional:

1. More eligible positions in the reviewed initial pool, with repeat quotes and reliable economics.
2. Additional deep pools and a separately reviewed Camelot adapter if sellers request it.
3. Buyer portfolio analytics and quoting automation for actual repeat buyers.
4. Other mainnet venues or chains only after proven demand, independent review and award-term clearance.

No buyer basket vault, secondary token, automatic rollover or leverage before the exact-position market demonstrates repeat demand. These are not required to make the first product feel full-fledged.

## 14. Event execution and funding story

This is a proposed work sequence, not a claim these actions have occurred.

| Period | Required outcome |
|---|---|
| September 15-17 | Commercial gate, same-position quote comparison, organizer clarification, both application processes |
| September 18-22, only if gates pass | One-adapter implementation, complete web journey, fork adversarial tests and independent review |
| September 23-26 | Authorized, bounded mainnet pilot: external premium, genuine subsequent fees, checkpoint, claims and residual NFT return |
| September 27-29 | Repeat term, contribution economics, data reconciliation, judge-facing explanation and demo recording |
| September 30 | Internal freeze, submission package and acceptance confirmation |
| October 1-4 | Deadline buffer, clarification and necessary repairs, not planned feature work |
| October 23-25, if admitted | Meaningful new feature chosen from observed repeat-user demand, not a speculative feature checklist |

If independent safety review cannot finish, do not accept external funds. Show local-fork results and read-only mainnet integration honestly, and disclose that the pilot has not launched. Such evidence may not satisfy the event's deployment requirement; do not imply eligibility without a qualifying deployment. Small exposure is not a substitute for the safety gates.

### Mainnet demonstration

Show one real existing-pool NFT, one independent buyer, a nonzero USDC purchase, an actual platform fee, accrued post-activation pool fees, rejected early principal withdrawal, settlement, native-token buyer claim and seller NFT return.

Capture activation and settlement at their real times. A short video may combine clearly labeled recordings from the same term; do not pretend 72 hours passed live. A small or staged mechanics test must be labeled and excluded from organic commercial metrics. Existing organic pool trading can generate fees without manufacturing demo volume.

Prepare a short product demo, live read-only inspection, verified addresses and explorer links, public reproducible code, documented authority/failure boundaries, and separate historical-versus-new-work disclosure. The 90-second demo format is our packaging recommendation, not a verified Singapore hard limit.

### Funding request

The funding story should be: an observed two-sided fee-risk trade that needs reviewed settlement and embedded distribution. It should not be: a novel NFT wrapper needs money to find its users.

An illustrative $30,000 milestone request, if eligible under current terms:

- $12,000 for scoped independent security review and remediation, subject to real quotes.
- $10,000 for the complete first-adapter product, reliability and reproducible analysis.
- $5,000 for an embedded distribution integration with actual customer pull.
- $3,000 for legal classification and operational contingency, with additional budget required if advice is more expensive.

Do not use the grant to pay buyers above market or count grant proceeds as product revenue. Tie proposed milestones to independently funded settled premiums, repeat terms, contribution margins, disclosed risk and reliable mainnet settlement. Award availability and payout depend on organizer selection and current agreements.

## 15. Legal, operational and research limits

Before a public commercial market, obtain advice covering fee-right classification, arranging/matching transactions, token custody, marketing, sanctions, counterparties and where the business operates. No claim is made that the product is exempt from Singapore or Indian requirements merely because it is noncustodial, uses NFTs, or has no leverage.

Singapore's July 2026 MoneySense guidance discusses DeFi loss and withdrawal risks; the Securities and Futures Act separately governs relevant capital-market activity. These are reasons to classify our exact structure, not a finding that FeeForward is regulated or exempt. Restricting a pilot to sophisticated counterparties does not itself establish an exemption. [Government risk guidance](https://www.moneysense.gov.sg/risks-of-trading-payment-token-derivatives/), [Current SFA](https://sso.agc.gov.sg/Act/SFA2001?WholeDoc=1)

Research used parallel agents, direct Linkup HTTP searches and primary documentation/source checks. Linkup's SDK is not installed and the earlier temporary installation is absent. Search-generated answers were treated as leads: one overstated competitor absence and cited an unofficial lookalike site. Those assertions are not relied upon here.

No customer interviews, executable contract bids, deployment, audit, wallet transfer or paid pilot were performed in this research. Dynamic fees and fundraising pages are snapshots. Search cannot establish global uniqueness. Prior event terms could not be freshly fetched. Customer access, pricing, repeat demand, recovery safety and legal classification remain the named uncertainties.

## Final call

FeeForward is the single candidate to test now: a complete, mainnet-native fee-risk trading workflow, not another AMM or a renamed safety dashboard.

Its technical feasibility is credible and its economics are explicit. Its demand is not proven. Make the next decision from real seller reservation prices and real buyer bids within 48 hours. If they cross and the safety gates pass, build the bounded full workflow and stop broad research. If they do not, reject it instead of dressing it up as a funded-startup-quality product.
