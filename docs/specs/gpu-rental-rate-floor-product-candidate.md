# GPU rental-rate floors: funded compute-risk clearing

Status: full-product comparison candidate, not selected or commercially validated. No first-ever GPU derivative or verified Arbitrum market-gap claim.

Research snapshot: September 15, 2026. This is product reference material, not runtime configuration, a financial quote, or authorization to deploy contracts or move funds.

## Product and initial customer

A professional web application and API through which an infrastructure operator buys a specified monthly GPU rental-index floor. The buyer prepays an agreed premium. Risk-capital sellers fund the maximum promised USDC payout before the policy is issued. The first complete lifecycle would settle on Arbitrum One mainnet only.

The initial customer hypothesis is a financed operator selling variable-price B200 capacity while servicing fixed debt and operating costs. It is not every GPU owner, every USD.AI borrower, or a consumer buying inference tokens. B200 is a proposed first SKU because funded B200 infrastructure and relevant benchmark products exist, not because any named operator has accepted our hedge.

[USD.AI's current borrower terms](https://usd.ai/borrow) price investment-grade offtake at 7-10% simple interest and on-demand/uncontracted revenue at 12-15%, with a 3% origination charge. Its [September 1 funding recap](https://usd.ai/insights/august-recap-100m-facility-susdai-ath) reports Corvex's commissioned B200 financing and QumulusAI's separate B300 draw. These support the financing category, not proof those operators have unhedged merchant exposure or demand our floor. A facility ceiling is not deployed debt.

Fixed multi-year offtake operators are excluded from the initial exposure claim. Their near-term risk can be customer default or contract termination rather than falling spot rentals. A buyer seeking protection against rising compute costs needs a different instrument, not this floor.

Customer eligibility, launch jurisdictions and the contractual/access model remain explicit business-design work. Computable's own eligible-counterparty restriction is not a licence or exemption for our venue. The candidate is not presented as an already authorized insurance business.

## Purchased outcome, not a revenue guarantee

For month m, define agreed covered GPU-hours `Q_m`, floor `K_m`, and the contractual benchmark period rate `I_m`, all normalized to USD per GPU-hour:

`payout_m = Q_m * max(K_m - I_m, 0)`

This is an established monthly cash-settled put structure. The candidate difference is transparent, funded settlement and underwriting distribution, not new payoff mathematics.

Actual operator revenue is approximately realized hourly price times billable hours. If billable hours equal covered hours and realized price equals the benchmark, rental receipts plus payout reach the benchmark floor before premium and costs. If those assumptions fail, total revenue is not guaranteed. Idle capacity, discounts, regional/cluster differences, electricity costs, outages, customer credit and hardware resale value remain separate risks.

Over-covering installed calendar hours can make part of the position speculative. The product must show covered volume, actual exposure assumptions and remaining basis risk without presenting installed GPUs as fully utilized revenue.

## Complete lifecycle

1. Operator treasury records its hardware, region, revenue type, covered months and volume, then sees the mismatch between actual exposure and the selected index.
2. Competing writers quote premium, floor, quantity, benchmark, settlement dates, data-disruption terms, fees and maximum liability. Indicative estimates are clearly separate from binding funded offers.
3. Issuance atomically receives the buyer premium, reserves writer USDC and creates the full remaining claim. No policy depends on raising collateral after an adverse event.
4. During coverage, the product tracks reserved liabilities, benchmark status, exposure assumptions, claim ownership and genuinely free writer capital. It does not promise a risk-free LP yield.
5. Each month, the agreed period rate becomes final under the reporting/dispute policy. The protocol calculates the payout, credits actual buyer USDC and releases only the liability no longer owed.
6. A buyer may transfer the complete remaining claim to an eligible holder or accept a funded buyback. Transferability alone supplies no executable bid or instant exit.
7. Writers exit free capital, matched cancelled liabilities or settled vintages. They cannot withdraw cash needed for outstanding promises. Final maturity distributes remaining cash after every admitted liability and fee is reconciled.

The product owns underwriting admission, reserve accounting, issuance, transferable claims, period settlement, cash payouts, cancellation and capital exit. A quotation dashboard or an oracle adapter into a generic derivative is not the entire business.

## Capital and loss rules

For a benchmark contractually bounded below by zero, the maximum remaining payout is:

`reserve = sum_m(Q_m * K_m)`

Use conservative integer rounding for reserved USDC, including agreed settlement costs where applicable. Missing data is not a legitimate zero price. If any product admits a negative index or a different payout definition, the bound must be re-derived before issuance.

Fully funded same-direction floors do not earn assumed correlation offsets: every covered month can settle at zero. Future premium, borrower revenue, inventory resale and an expected new writer deposit are not cash collateral. If one USD of reserves backs multiple simultaneous maximum payouts, the product is not fully funded under this definition.

Illustrative arithmetic, not a B200 quote: 20,000 covered GPU-hours each month, a $6 floor and three months require $360,000 maximum payout reserves. Period rates of $6.50, $4 and $0 pay $0, $40,000 and $120,000. Total claims are $160,000, not an opportunity to call unpaid liabilities profit. At a hypothetical $36,000 premium with 5% retained by the venue, writers receive $34,200 and lose $125,800 net before other costs in that path. If every rate stays above the floor, writers instead earn premium before expenses. Both outcomes are possible; no guaranteed APY is justified.

Underwriting capital, startup runway and any separate operational reserve must be funded independently. USDC denomination does not remove stablecoin issuer/depeg risk, contract bugs or chain disruption. No automatic protection from every possible loss is claimed.

## Writer supply and the price of reserved capital

[Architect's compute-options explanation](https://architect.co/insights/education/compute-options/) identifies frontier model companies and AI labs as possible cash-secured put sellers, and neoclouds as covered-call writers. Its US options discussion is prospective, not a named committed B200 writer or a live options quote.

If a compute buyer continues buying exactly `Q` hours at the same realized rate as index `I`, its physical expense plus short-put payout equals `Q * max(I, K)` before premium and costs. It gives up some cheap-compute benefit in return for premium. This natural exposure requires matching volume, SKU, fixing period and provider basis. Reserved USDC may also be needed for intramonth procurement. Merchant operators and GPU lenders are already exposed to falling rentals; asking them to write puts adds wrong-way downside rather than establishing a natural risk pool.

Specialist dealers and capitalized funds remain possible writers, not verified allocations. Writer break-even premium is expected claims plus capital opportunity cost, expenses and venue fees, with additional compensation required for estimation error, tail risk and profit.

Explicitly invented one-month sensitivity: 100,000 covered hours, a $6 floor, and probabilities 70%/$6.50, 25%/$4.50 and 5%/$2 produce $57,500 expected claims and $600,000 maximum reserves. At an assumed 8% annual hurdle, one-twelfth-year cash carry is $4,000. Adding $2,000 venue fee and $1,000 expenses requires $64,500 premium before tail/profit loading. None of these probabilities, premiums or costs is an observed market quote. Moving five percentage points of probability from the above-strike case to $2 increases expected claims by $20,000.

A lower $4 floor reserves $400,000 for the same volume. A $6/$4 put spread reserves $200,000 but stops increasing its payout below $4; it is not an unconditional $6 floor. These are explicitly different coverage choices, not a quiet reduction of the buyer promise to make capital economics look better.

An enforceably pledged matching long $4 put can reduce a short $6 writer's own residual reserve to $200,000, but its source writer still backs $400,000: aggregate backing remains $600,000. No incremental saving exists if an existing book already uses exact maximum-loss net margin. A long floor's maximum possible payout is also not its present collateral value for a GPU loan.

## Benchmark and settlement business

No production Arbitrum GPU rental feed or benchmark licence has been selected. Legitimate settlement data is a business dependency, not a freely assumed public API.

- [Computable's data licence](https://github.com/getcomputable/gpu-index/blob/main/LICENSE-DATA.md) separates Apache-licensed code from noncommercial published index data and requires written permission for financial-product settlement/reference use.
- [Ornn Data's terms](https://data.ornn.com/terms) require explicit written authorization for external settlement/reference and related use. A data subscription is not automatically an index-product licence.
- [Silicon Data's pricing](https://www.silicondata.com/pricing) likewise separates its $998/month Pro subscription from financial-product index licensing. No licence price or permission has been obtained for this candidate.

Benchmark selection must match GPU model, configuration, geography, rental terms and the customer's economic exposure. [Silicon Data's B200 product](https://www.silicondata.com/products/silicon-index/b200) is relevant, but no benchmark perfectly reproduces every customer's negotiated realized price or utilization. [Ornn's current OCPI methodology](https://data.ornn.com/methodology) uses executed on-demand rentals; an investor's broader description must not override its exclusion of bespoke reserved/long-term contracts. Computable uses provider-published rentals instead. These are not interchangeable definitions.

Reports must bind the index identity, normalization, coverage period, observation policy, methodology-change treatment, missing-data handling, finality and dispute deadlines. Verifying a report signature or reproducing arithmetic does not prove the underlying rentals were genuine.

The first policy cannot leave outage outcomes to an administrator after seeing which side loses. Stale reports, inadequate coverage, licence withdrawal, erroneous publication and unavailable calculation agents need pre-agreed fallback and cash-release rules. The candidate has not selected those commercial terms. A premium refund after a severe market event is not equivalent to delivering the promised hedge; keeping capital locked forever is not an exit policy.

## Revenue and capital efficiency

Retained revenue is an explicit issuance/clearing share of premium or disclosed service charge. Writer risk premium, GPU operating revenue and the financing lender's interest are not startup revenue. Computable's physical-capacity marketplace fees must not be copied into claims about its hedge pricing.

Sensitivity only: a $10M maximum-liability cohort charging a hypothetical 10% premium and retaining 5% of that premium produces $50,000 gross per cohort. Repeating genuinely fresh 90-day demand produces about $203,000 annual gross; $100M cohorts produce about $2.03M. These are not accepted rates, executable quotes or forecasts. Benchmark licensing, monitoring, eligible-customer onboarding, reporting/disputes, security and servicing reduce gross revenue.

Capital intensity is material: the same $10M cohort locks up to $10M USDC to generate $1M premium before payouts and platform fees. Buyer premium and writer opportunity cost must both work. GPU rental capacity is perishable; writers cannot assume they can warehouse the underlying or obtain a liquid offsetting futures hedge today.

## Current competition and possible advantage

[Computable Hedge](https://www.getcomputable.com/hedge) already advertises this economic payoff, leaving existing leases unchanged, with indicative quotes and bilateral larger transactions. Its published page does not establish collateral/default terms. That is not evidence its counterparties are unsecured.

[Ornn's $33M seed announcement](https://a16zcrypto.com/posts/article/investing-in-ornn) and [Silicon Data's $30.5M initial Series A closing](https://www.silicondata.com/news-room/silicon-data-raises-30-5-million-series-a) confirm serious 2026 financing for compute market infrastructure. Their benchmarks, counterparties and risk-transfer distribution are competitors and possible suppliers, not proof funding follows technical module count.

[AX's production instrument API](https://gateway.architect.exchange/api/instruments) lists dated GPU futures; its [platform documentation](https://docs.architect.exchange/) describes margin and liquidation. Listed contracts are not independently verified executable depth. [CME's announcement](https://www.cmegroup.com/media-room/press-releases/2026/8/11/cme_group_and_silicondatatolaunchcomputefuturesonoctober5tounloc.html) targets October 5 for H100/B200 futures pending regulatory review. NVDA equity exposure is not a rental-rate hedge.

[AX's current product page](https://architect.co/ax/) describes OCPI-H100 and labels H200/B200/B300 as roadmap even though its instrument API lists those symbols. Listing, advertised launch scope and executable depth are separate evidence. Its [margin policy](https://architect.co/legal/ax-margin-policy.pdf) permits liquidation and ultimately auto-deleveraging; an external hedge therefore does not supply guaranteed available USDC to this venue's reserves.

The hypothesized advantage is a prepaid asymmetric floor with already-reserved USDC payouts and no subsequent buyer margin call. It must outperform available funded bilateral offers on all-in premium, benchmark fit, custody/security, usability and recovery. Existing firms can offer equivalent collateralization; putting the same payoff on Arbitrum does not establish a moat.

Arbitrum's existing stablecoin and infrastructure-credit activity can help distribution and funding access. It does not prove operators want a new contract venue or that this is the chain's uniquely missing product.

## Research position and next evidence

Retain as a serious alternative to Blindbook, not an instruction to build or a selected startup. The distinct research tasks are exposure fit for merchant B200 operators, priced legitimate benchmark/settlement availability, and risk-capital quotes capable of supporting a buyer-competitive premium. Those can inform a research recommendation without uncommissioned customer outreach; actual commercial and security validation remain launch work.

No SDK installation, licence purchase, outreach, trading, deployment, customer commitment, mainnet implementation or security audit is claimed by this specification.
