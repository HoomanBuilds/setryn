# Capacity-native credit markets: conditional startup thesis

Research date: September 15, 2026.

Status: superseded research thesis, not the current build direction. Capacity-native credit remains a credit-market variant and did not survive the final cross-ecosystem comparison. See the current [Charter Protocol decision](../research/arbitrum-market-governed-capital-formation-decision-2026-09-16.md). This is not a validated company, implementation instruction, or authorization to deploy capital.

## 1. The product in one sentence

A market where token holders buy funded, time-bounded USDC credit commitments, while capital providers earn explicit availability and borrowing fees under enforceable collateral, reserve, recovery and exit rules.

The buyer purchases cash availability subject to agreed credit conditions. They do not purchase unconditional credit after their collateral becomes worthless.

Native spot liquidity is a possible part of the market, not the reason to build the company. Reserved cash must not also be promised to spot traders, another borrower or withdrawing LPs. If shared spot inventory does not improve executable economics, remove the native AMM rather than preserve it for complexity.

Working positioning: "Reserve your USDC borrowing capacity before you need it. See the capital, conditions and total cost before committing."

## 2. Why the research changed

The rejected bounty platform offered a narrower ecosystem version of mature services without a compelling switching reason. A generic unified swap-and-lending pool would repeat that mistake at greater financial risk.

Omnipair already combines pair-isolated spot trading and withdrawable borrowing on Solana. MetaDAO lists $1.1m raised and a passed May 4, 2026 strategic fundraising proposal involving Theia and Colosseum. Its complete credit/default lifecycle is a useful depth benchmark, not evidence that an Arbitrum port has customers. [MetaDAO company record](https://metadao.fi/companies/omnipair), [Colosseum portfolio](https://colosseum.com/companies/omnipair)

LIKWID already describes native spot, plain borrowing and leverage using real and mirror reserves. Its official v2.2 deployment page lists Ethereum, Base and BNB in February-May 2026. No Arbitrum listing on that page is an observation, not proof that Arbitrum has no competing mechanism. [Plain borrowing versus leverage](https://docs.likwid.fi/whitepaper/protocol-mechanics/lending-vs-leverage), [deployment listings](https://docs.likwid.fi/product/contract-address)

LIKWID also documents staged LP exits, pair insurance and receipt-token substitutes during exhausted liquidity. Consequently, adding a withdrawal queue, insurance pot or debt cap does not independently establish originality. [Exit framework](https://docs.likwid.fi/whitepaper/risk-management-and-strategies/liquidity-protection-with-dynamic-unlock-mechanism), [loss fund](https://docs.likwid.fi/whitepaper/protocol-mechanics/insurance-fund-mechanism), [exhausted-liquidity mechanism](https://docs.likwid.fi/whitepaper/protocol-mechanics/handling-exhausted-liquidity-in-special-cases)

Euler's official Q1 2026 retrospective reports that credit-based market making could exhaust illiquid vaults, destabilize borrowing rates and make credit unpredictable. It also identifies unsustainable long-tail servicing and incentive-driven deposits. This supports researching dependable capacity and operations, not claiming that a new pool automatically solves them. [Euler retrospective](https://www.euler.finance/blog/euler-q1-2026)

## 3. Specific users and the switching proposition

Initial borrower hypothesis: a professional Arbitrum inventory desk or holder of an economically valuable, transferable token that periodically needs USDC without immediately selling that inventory.

Initial distributor hypothesis: a token issuer already maintaining liquidity and able to introduce actual holders and an independent capital provider. The issuer is not automatically the borrower or the only lender.

Initial lender hypothesis: professional capital willing to price the credit and cash-reservation exposure. This is not a passive-USDC-savings product.

Current alternatives:

- Borrow from an existing pool when needed, accepting utilization and lender-withdrawal risk.
- Borrow the full expected amount upfront and retain unused proceeds in acceptable liquid assets.
- Negotiate a bilateral credit line or inventory loan.
- Use existing fixed-term credit such as Timeswap or Teller, or configured collateral credit on Euler/Fluid.
- Sell inventory instead of financing it.

Proposed switching reason: an identified counterparty cannot redirect the buyer's funded borrowing capacity during the agreed period, provided the buyer satisfies the published credit conditions. The buyer receives explicit availability and expiry rights rather than an app displaying today's liquidity.

The riskiest assumption is commercial: buyers value conditional funded availability enough to cover the lender's reservation opportunity cost, credit/option risk, servicing and our fee. Research has not confirmed this.

## 4. What is already occupied

| Product | Relevant prior art | What the proposal must prove instead |
|---|---|---|
| Omnipair | Unified pair liquidity, usable loans, endogenous collateral pricing and LP shortfall allocation | A paid commitment right and commercially useful availability, not an EVM rewrite |
| LIKWID | Unified spot/borrow/leverage, withdrawable loan proceeds, liquidity protection and pair insurance | Reservation terms that improve a real customer's executable alternative |
| Fluid | Smart collateral/debt and capital reuse through a liquidity layer and vaults | A different financing service with acceptable conditions and costs |
| EulerSwap | LP-account market making connected to supply/borrow vaults | Dependable funded capacity rather than unbounded competition for shared cash |
| GammaSwap | Arbitrum AMM-liquidity borrowing and options-like invariant debt | Specific usable-asset credit commitments, not another volatility trade |
| Timeswap | Oracleless fixed-term credit for Arbitrum long-tail assets | Better availability, draw flexibility or total financing economics for an actual holder |
| Teller | Pair-isolated loans plus commitment limits, expiry, duration, rates and collateral terms | A funded, protected right rather than an available lender-wallet allowance; newer pooled versions still need comparison |
| Wildcat | Configurable institutional credit facilities, reserves and lender withdrawals | A separately priced, funded undrawn right, with a superior total offer |
| Credit Coop | Deposited revolving credit positions, drawn/undrawn rates, deadlines, withdrawal compensation and repayment control | Strict non-recallable capacity plus distinct underwriting/distribution, not another facility-fee implementation |
| Gavel | Reported One BTC-backed auction credit; generalized shared-vault/spot v2 is listed as unaudited Sepolia | A real current-production comparison, not treating planned competitors as absent |

Sources: [Fluid architecture](https://docs.fluid.instadapp.io/), [EulerSwap LP considerations](https://docs.euler.finance/curate/euler-swap/lp-considerations/), [GammaSwap debt mechanics](https://docs.gammaswap.com/guides/tradeperpoptions/perpetual-options-explained), [Timeswap use cases](https://timeswap.gitbook.io/docs/introduction/use-cases), [Teller commitment terms](https://docs.teller.org/v2/personas/lenders/create-commitment), [Teller draw mechanism](https://docs.teller.org/v2/personas/borrowers/accept-commitment), [Wildcat borrower terms](https://docs.wildcat.finance/using-wildcat/day-to-day-usage/borrowers), [Credit Coop current lending operations](https://docs.creditcoop.xyz/core-concepts/secured-line-of-credit/secured-line-of-credit/core-lending-operations.md), [Gavel stages](https://www.thegavelprotocol.org/)

Important late-stage correction: Credit Coop's current lending-operations page says deposited positions already have mutually agreed rates, deadlines and lender early-withdrawal fees paid to the borrower. Draws require collateral health and lenders can recall undrawn deposits with compensation. Its older V1 formula already charges separate drawn and undrawn rates. Teller's documented standard commitment transfers principal from a lender wallet at acceptance. Strict cash lockup could change the financial bargain, but facility fees, commitment terms and revolving credit are occupied. Neither the old wallet-based Teller path nor older Credit Coop formulas establish that their newest deployments lack a configurable equivalent. [Credit Coop current operations](https://docs.creditcoop.xyz/core-concepts/secured-line-of-credit/secured-line-of-credit/core-lending-operations.md), [V1 fee formula](https://docs.creditcoop.xyz/developers/v1-developer-material/functions-and-methods/interestratecredit.sol/accrued-interest-calculation.md), [Teller draw funding](https://docs.teller.org/v2/personas/borrowers/accept-commitment)

Originality here is a hypothesis about participant rights, market operation and distribution. A funded credit commitment is not a first-ever financial invention. No current search establishes that competitors cannot offer it.

A single non-recallable-reserve policy is not enough to justify a flagship new protocol. If an existing facility can deliver the same priced service with a small configuration change, use that as the commercial experiment and do not describe the change as a new financial invention. An independently operated market needs its own demonstrated underwriting, capital sourcing, servicing and recovery advantage before a new protocol implementation is justified.

## 5. Evidence of need, and its limits

Timeswap describes an issuer-supported USDC/plsARB market addressing missing oracle coverage and approximately $60,000 DEX liquidity at launch. It is concrete historical Arbitrum evidence for inventory financing, but also direct competition. It does not verify today's plsARB demand or endorse lending against a thin internally priced market. [Named historical use cases](https://timeswap.gitbook.io/docs/introduction/use-cases)

GammaSwap's February 2024 application describes rapidly rising utilization and a conflict between borrowing and substantial spot depth. Euler Labs' May 2025 treasury proposal sought to move protocol-owned liquidity into credit-enabled EulerSwap positions. These are historical workflow/capital-allocation signals, not commitments to our product. [GammaSwap application](https://forum.arbitrum.foundation/t/gammaswap-ltipp-application-final/21586), [Euler treasury proposal](https://forum.euler.finance/t/eulerswap-liquidity/1398)

Current GHO liquidity operations are not our empty-market opportunity: an Arbitrum remoteGSM was proposed in May and reported deployed in July 2026. Its job is peg liquidity, not financing an issuer against arbitrary own-token inventory. [Proposal](https://governance.aave.com/t/arfc-launch-remotegsm-on-arbitrum/24986), [July deployment update](https://governance.aave.com/t/al-development-update-july-2026/25482)

No named issuer or desk has accepted our terms, rejected an executable competing offer or supplied an independent lender quote. There have been no customer interviews, paid transactions or outreach in this research.

## 6. Full financial lifecycle required

These are product requirements, not a finalized contract architecture.

1. Capital admission: lenders commit real quote assets and accept the market's collateral, exit and loss rules. Disclose issuer/LP/borrower related parties.
2. Offer: quote a maximum line, reservation expiry, repayment maturity, collateral conditions, availability fee, drawn interest and permitted cancellation conditions.
3. Purchase: reserve the undrawn quote cash and establish the buyer's enforceable right. No reservation based on hypothetical future deposits.
4. Collateral: lock eligible transferable assets under independently reviewable terms. Unsupported price-feed coverage and malicious token behavior are different problems.
5. Draw: transfer actual USDC to the buyer's chosen authorized recipient if the published conditions pass. Draws change reserved and drawn balances, not the buyer's agreed maximum limit.
6. Service: show total outstanding principal, accrued charges, remaining reservation, maturity and current collateral eligibility. Monitoring is not enforcement.
7. Repay: allow partial and full repayment without team intervention. Repaid principal restores the line only while its reservation remains valid.
8. Expiry: release unused capacity at the agreed time. Expiry must not silently forgive or extend drawn debt; each draw has a defined repayment deadline no later than the agreed terminal maturity.
9. Breach: specify when further draws stop, when repayment is required and when collateral recovery becomes available. A legitimate existing draw cannot be revoked by arbitrary front-end state.
10. Recovery: incentivize an independent actor to execute recovery. Selling or absorbing collateral must not be confused with recovering USDC at face value.
11. Loss settlement: recognize unrecovered principal against the correct claims. Any funded first-loss allocation must be real, finite and disclosed; residual loss stays with the relevant market's risk capital.
12. LP exit: requests cannot remove reserved cash or evade already recognized losses. Queued claims remain exposed until settlement, with explicit pricing time, cash availability and remaining risk.
13. Shutdown: stop new exposure while maintaining repayment, collateral recovery, fee accounting and claim settlement. A paused deposit button is not a recovery plan.

No protocol token, agent marketplace, AI pricing, cross-chain credit or privacy layer is required for this first product.

## 7. Capacity and collateral are separate problems

Define quote cash Q available to the capital program after excluding user collateral and other separately owed cash claims, undrawn committed quote U and a market's deliberately retained free-cash floor F. A necessary reservation condition is:

`Q >= U + F`

This is a cash allocation identity, not a solvency theorem or a guarantee that any size of spot trade can execute.

A draw reduces Q and its corresponding U together. New offers, other borrowing, spot outputs and LP exits must not spend someone else's U. A repayment increases Q; it restores U only if the line is still live. Partial cancellation and expiry must settle charges and release only the correct right.

Outstanding debt is a receivable, not spendable quote cash. Displaying `cash + debt` as pricing/accounting reserves must not advertise that entire amount as immediately available liquidity. Borrowed principal, locked collateral, lender claims and fee balances cannot be counted repeatedly as new capital.

Collateral conditions are not settled. A pool-derived reference removes dependence on an external feed but remains an endogenous price benchmark. The issuer or borrower may control token supply, collateral, LP shares, starting reserves and multiple accounts. Price smoothing is not a proof that sustained manipulation is unprofitable.

Requirements before adopting an endogenous risk model:

- Account for recoverable collateral-sale proceeds, aggregate simultaneous liquidation and liquidation order, not just quantity times displayed spot price.
- Bound additional debt and commitments under cash outflow, liquidity removal, fee rounding and interest accrual.
- Evaluate the attacker's net cash extraction after swaps, loans, LP exits and related-party fee recycling.
- Specify benchmark warm-up, stale-state and chain-interruption behavior.
- Reject unsupported rebasing, transfer-tax, freeze and transfer-hook behavior rather than claim safety for every ERC20.
- Decide whether a new draw needs collateral support for the drawn amount or the entire remaining line, and price the resulting option accordingly.

If a reviewed external-price route produces a better initial underwriting service, use it. "Oracleless" is not the customer promise and should not dictate the product.

## 8. Native trading: only if the economics justify it

One ordinary TOKEN/USDC pair could provide spot execution against unencumbered inventory. It must return the token the trader requested, or revert. Do not silently substitute a future-redemption receipt for missing USDC.

The AMM introduces inventory losses, arbitrage, manipulation incentives and the need for actual order flow. Revenue from native trading is not guaranteed by being on Arbitrum.

The commercial comparison must include a credit-only facility alongside existing Camelot/Uniswap liquidity. If migrating liquidity worsens execution enough to erase financing benefits, the native AMM loses its justification. Removing it would reshape the market into a focused committed-credit protocol, not excuse an incoherent "everything finance" pitch.

## 9. Revenue and illustrative unit economics

Proposed pricing, not market-validated rates:

- A time-based availability charge on the agreed line limit, including undrawn capacity.
- Additional interest on actually drawn principal.
- A disclosed protocol share of collected availability and borrowing charges.
- Optional disclosed swap-fee revenue if native trading survives validation.

Do not count loan principal, lender interest in full, collateral TVL, token sales or liquidation penalties as startup revenue.

Illustrative convention: availability is charged on the whole live limit, with an additional drawn rate. This is not an undrawn-only fee. Quote the effective fully drawn rate to avoid misleading borrowers.

For a $100,000 line live for 30 days, 6% annual availability and 8% additional drawn interest, with average drawn principal of $40,000:

- Availability charge: $493.15.
- Drawn interest: $263.01.
- Total finance charges: $756.16.
- A 15% share of these charges produces $113.42 gross protocol revenue.
- Borrowing the full $100,000 at 14% for 30 days costs $1,150.68 before any yield earned on unused proceeds.
- Borrowing only an average $40,000 from an uncommitted venue at 14% costs $460.27.

The buyer therefore pays approximately $295.89 over the uncommitted comparison for availability, while paying approximately $394.52 less than the unreinvested full-prefunding comparison. At an illustrative 5% annual yield on the average unused $60,000, parked borrowed proceeds earn $246.58 over 30 days: net prefunding costs $904.11 and the proposed benefit falls to $147.95. These examples use a 365-day convention and constant average balances. Actual timing, yields, risks and executable quotes can reverse the comparisons.

Annualized scale illustration using the same rates and 40% average draw:

| Average committed line limits | Average drawn principal | Gross annual finance charges | 15% gross protocol share |
|---|---|---|---|
| $2m | $0.8m | $184,000 | $27,600 |
| $20m | $8m | $1.84m | $276,000 |
| $100m | $40m | $9.2m | $1.38m |

These are arithmetic scenarios, not forecasts, revenue already earned or currently available lender capital. They exclude credit losses, legal/compliance, servicing, infrastructure, security and acquisition costs. The lender receives 7.82% of committed notional before those costs at this illustrative take rate, not risk-free net yield.

Reserved USDC cannot simultaneously earn unrestricted lending or quote-output spot yield. At a hypothetical 5% alternative annual yield, warehousing $1m for 30 days sacrifices approximately $4,109.59 before credit-option exposure and operations. Nominal bank-line commitment fees are not interchangeable with a fully cash-funded onchain promise.

The business scales with independently supplied capital, repeated borrower usage and positive net lender economics. A hackathon grant can pay for software/security work; it does not create the lending balance sheet.

The illustrative $147.95 prefunding saving alone is not a compelling reason to entrust collateral to a new protocol. An actual buyer must identify a larger operational/availability benefit, or real quotes must improve the financial comparison. Do not substitute hypothetical stress-time demand for that evidence.

### Distribution, capital bootstrap and defensibility

Start with one issuer-supported financing program and independent professional capital, not a permissionless launch campaign. Match committed lines to actual borrower requests. A treasury borrowing only the USDC it supplied itself is circular capital movement, not evidence of credit demand.

Counterparty introductions and borrower integrations should precede a broad asset factory. A credible expansion path is another program using the same enforceable commitment and servicing rules, with separately priced collateral risk. Expanding collateral lists without independent lenders increases liability and support burden, not the business.

Defensibility would come from reliably committed funding, repeated borrower relationships, asset-specific underwriting/recovery evidence, distribution partnerships and integrations. Cash segregation, a dashboard or a new token is not a durable moat. These advantages do not currently exist for our proposed company.

Contribution economics must deduct servicing, monitoring/recovery execution, security amortization, legal/compliance work and acquisition from the protocol fee share. Capital-provider losses and opportunity cost must be evaluated separately. A startup may have positive fee revenue while destroying value for its lenders; that is not sustainable product-market fit.

## 10. Lessons from funded products

Kimia's own launch proposal describes a peer-to-peer funding-rate exchange, market-neutral vaults, kUSD and a yield-tokenization layer. Its disclosed $60,000 raise goal is a capped team receipt, with oversubscriptions described as refundable. The page describes public devnet and a future private-mainnet beta. This is not evidence of a large completed institutional round, audited revenue or current broad mainnet adoption. [Kimia launch disclosure](https://www.futard.io/launch/FwCDgK9C8mjWr7wULPFzEv4QBt6koTnMQrKTC45TxWAk)

USD.AI's announced Series A supports a hardware-title/origination/recovery system, not a token-only yield wrapper. Its redemption queue has economic rules for illiquid claims. Rho has an explicit rates market and announced a $4m seed in February 2025. Neither funding outcome predicts ours. [USD.AI raise](https://usd.ai/insights/usdai-raises-13M-to-scale-ai-infra), [USD.AI queue](https://docs.usd.ai/structured-finance-for-limited-liquidity/queue-extractable-value-qev), [Rho seed](https://rho.trading/blog/crypto-rates-exchange-rho-protocol-secures-4-million-in-seed-funding-led-by-coinfund)

Visa's current Credit Coop case describes a real customer and enforcement loop: card-settlement receivables, independent settlement data, repeated draws and programmatic repayments. It reports $2.5b-plus cumulative platform financing and Karta's $125m credit facility separately from $15m equity. This is the business-depth benchmark: identified obligations, capital providers, source-of-repayment control and distribution. It is not our buyer evidence or permission to reuse their private data rails. [Visa case study](https://www.visa.com/en-us/thought-leadership/innovation/onchain-settlement-financing)

## 11. Product surface and chain choice

Choose a professional responsive web application and integration interface, not Android-first.

Borrower product: compare total terms, reserve a line, inspect the capital and conditions, lock collateral, draw real USDC, monitor remaining capacity, repay and export receipts. Show what makes a draw unavailable before asking for a signature.

Lender product: inspect counterparties and token risks, allocate capital, view reserved versus drawn balances, see fees separately from inventory/default losses, request an exit and inspect outstanding recovery exposure.

Issuer/desk product: configure a proposed financing program, invite actual counterparties, compare financing with existing liquidity arrangements and export exposure/accounting records. Configuration cannot silently rewrite existing commitments.

Operational product: reliable chain-state indexing, reproducible financial quotes, transaction/status reconciliation, independent recovery execution, alerts and a documented integration API. Backend availability must not be a prerequisite for an existing borrower to repay or exercise an already valid exit.

First deployment target: Arbitrum One mainnet. Its existing collateral, inventory and counterparty ecosystem is the rationale, not simply gas cost. Local mainnet forks and adversarial simulations respect the mainnet-only production constraint.

Do not add Ethereum, Base or Robinhood only to fill three slots. Robinhood's current official documentation lists a mainnet, contrary to older testnet-only claims. A second chain requires an actual borrower/capital distribution reason and its own operational review. Cross-chain routing does not make cross-chain lending risk disappear. [Robinhood current connection documentation](https://docs.robinhood.com/chain/connecting/)

Solidity is the default if fixed-point accounting and risk checks are affordable. Choose Stylus only after a benchmark establishes useful computation or precision benefits. No parallel EVM/Rust financial engine should be added solely for prize appeal.

## 12. Event strategy and delivery boundary

Official dates: online Buildathon September 14-October 4, 2026; Singapore Founder House October 23-25. September 15 is the second calendar day, not the opening date. Founder House has a separate approval-based application; Luma says online winners receive a place. HackQuest's narrower top-three wording should be reconciled before relying on lower-ranked automatic invitations. [Official application and dates](https://luma.com/openhouse-singapore)

Public Buildathon criteria include execution/security, originality, real problems and user attraction/retention. Solidity/Rust are accepted and Android is not mandatory. The detailed listing assigns ranked prizes to both Arbitrum and Robinhood entries. Mainnet-only is our production constraint, not a hackathon requirement. The user's maximum-three-chain rule remains unverified in retrieved binding terms. [Buildathon listing](https://www.hackquest.io/es/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)

Orbital was the Bengaluru mathematics-heavy winner: $40,000 first place. It implemented higher-dimensional AMM mathematics and a high-precision Stylus layer inspired by Paradigm's model. Borrowing a mechanism and implementing an original coherent product can win; inventing mathematics is not the only route. [Official recap](https://blog.arbitrum.foundation/arbitrum-open-house-india-concludes-with-bengaluru-hacker-house-full-recap/)

An honest submission would demonstrate one complete commitment lifecycle and adversarial capacity accounting. A possible capped One pilot can follow commercial signal, local/fork tests, suitable independent review and explicit capital authorization. There is no present assurance that this can be safely completed before October 4.

No unrestricted factory, arbitrary collateral, public saver deposits, native mobile app, privacy layer, cross-chain credit or claimed independent audit belongs in the first submission. Full lifecycle depth is compatible with one reviewed market. Broad asset coverage is a later operating business, not evidence of depth today.

## 13. Cheapest decisive experiment and kill criteria

The next authorized activity is desk research and quote-model preparation. Contacting counterparties, purchasing services or moving funds needs separate direction.

Before implementation, the proposed commercial experiment needs:

1. One identified issuer or inventory desk that describes a repeated need, actual inventory, maximum draw, timing and costly current workaround.
2. Three prospective borrowers prepared to accept a concrete priced term sheet and draw conditions, not just join a waitlist.
3. One independent capital provider quoting enough funded capacity to service those requests without a new token subsidy.
4. A side-by-side comparison with a feasible existing term loan/bilateral line and full prefunding with acceptable parking yield.
5. Borrower expected benefit exceeding the total availability premium, with positive lender economics after opportunity cost, risk and servicing.

This is not validated until behavior supports those conditions. A serious expression of interest is weaker than signed economic terms, and both are weaker than repeat paid use.

Before a capital pilot, additional financial-model evidence must cover simultaneous draws, debt interest/rounding, commitment cancellation/expiry, borrower default, liquidity removal, manipulated references, split accounts, token collapse, stale state, recovery failure and exit runs. Do not describe proposed tests as executed.

Kill or reshape the thesis if:

- Demand is only subsidized speculative leverage.
- A prefunded existing loan plus safe parked proceeds is cheaper and operationally sufficient.
- The reserve fee is commercially unacceptable or independent LPs will not fund it.
- Conditional collateral checks remove availability precisely when the buyer needed the promise, leaving no measurable benefit.
- The borrower can cheaply manufacture the collateral benchmark and extract quote principal.
- Adding native swaps only makes both trading and financing worse.
- Profitability relies on undisclosed LP losses, IOU outputs, fake insurance or a future token.

## 14. Priority stack from the product roast

1. Critical: prove an independently funded, profitable switching offer. Fix with concrete borrower and lender terms, not more architecture.
2. Critical: distinguish conditional cash availability from unconditional credit. Fix the commitment language and cancellation conditions before selling it.
3. High: prove cash is not promised twice and recovery losses reach the correct claims. Fix with a reviewed economic model and adversarial state-transition evidence.
4. High: justify native spot against a focused credit-only product. Fix with executable comparisons rather than a generic capital-efficiency claim.
5. Medium: deliver a usable professional product, reliable servicing and explicit receipts. Fix the end-to-end workflow before extra chains, mobile or AI.

Final judgment: this is a substantive market hypothesis with a clearer customer right than a generic lending-AMM clone. It is the direction to price and falsify next, not a claim that we found an empty ecosystem niche, justified a new protocol implementation or established a funding-ready startup.
