# Arbitrum One product decision: Charter Protocol

Research date: September 16, 2026.

Status: superseded on September 16, 2026 after the user required a recurring user-facing application rather than founder capital formation. Use the [current CareBond consumer protocol decision](./arbitrum-consumer-protocol-decision-2026-09-16.md). This remains historical market research, not proof of demand, legal advice, an audit, or authorization to accept public funds.

> Historical decision: **Charter Protocol**, a market-governed capital formation and company operating protocol on Arbitrum One.

Charter is a working name and still needs a proper trademark and domain review.

The working pitch is:

> Raise a crypto-native company on Arbitrum, place the capital and token authority under programmable oversight, pay founders for long-term performance, and give participants an enforceable path to protect or return the remaining treasury.

This is not another launchpad. A launchpad stops when tokens are distributed. Charter owns the full lifecycle:

`USDC raise -> token and liquidity creation -> governed treasury -> monthly operations -> major capital decisions -> performance vesting -> NAV exit or orderly shutdown`

The decision has one hard gate. Before building the complete system, secure one serious crypto founder who says that binding treasury protection would materially improve their ability to raise and who will run a small, closed Arbitrum One pilot. If no such founder exists, the thesis is not validated.

Most hackathon projects do not become successful startups, and some projects referenced here may no longer be active. A prize, accelerator selection, funding announcement, or deployed contract is evidence of selection or execution, not proof of product-market fit.

## Similar Projects

### MetaDAO is the source-category proof

MetaDAO is the strongest evidence that the category can be a company rather than a mechanism demo. Its August 2026 founder page reports 22 companies, more than $45 million raised, and more than 140,000 participants. These figures are company-reported and were not independently audited, but they are materially stronger evidence than a hackathon prize alone. [MetaDAO founder letter](https://metadao.fi/founders)

Its product is an integrated operating model:

- Investors commit USDC during a four-day raise and receive pro-rata allocations.
- A failed minimum triggers refunds.
- A successful raise sends the capital to a market-governed treasury, not a founder wallet.
- Twenty percent of raised USDC and project tokens create initial liquidity.
- The team receives a configured monthly operating budget.
- Larger treasury spends and token issuance require decision-market proposals.
- Founder performance packages unlock at long-term price thresholds.
- An optional NAV bid wall gives tokenholders bounded exit liquidity and burns repurchased tokens.

The mechanics are documented in MetaDAO's [sale lifecycle](https://docs.metadao.fi/how-launches-work/sale), [listing requirements](https://docs.metadao.fi/how-launches-work/create), [decision markets](https://docs.metadao.fi/governance/markets), and [bid wall](https://docs.metadao.fi/how-launches-work/bid-wall).

Colosseum was MetaDAO's first venture investor, and Colosseum later created the STAMP legal instrument with Orrick to connect private financing to a future market-protected token launch. That connection matters because it shows this is part of a serious venture-capital thesis, not only a governance experiment. [Colosseum investment announcement](https://blog.colosseum.com/metadao-metaplex-core-circle-cctp/), [Colosseum STAMP](https://blog.colosseum.com/introducing-the-colosseum-stamp)

### Colosseum project history shows why a launchpad alone is weak

The Colosseum Copilot search surfaced multiple founder-capital projects across different hackathons:

- [KALA](https://colosseum.com/projects/explore/kala) offered Token-2022 fundraising for emerging-market startups.
- [OnlyFounders FUN](https://colosseum.com/projects/explore/onlyfounders-fun) combined founder reputation and token launches.
- [Venture Launch](https://colosseum.com/projects/explore/venture-launch-1) proposed retail seed investing and milestone-based releases.

None of those surfaced with a prize or accelerator record in the inspected project data. The lesson is not that fundraising is uninteresting. It is that token creation, reputation scoring, AI diligence, or milestone escrow by itself is not enough. The defensible unit is the full post-raise control system.

### Adjacent funded and winning transfers were tested and rejected

- **Yumi Finance** won first place in Cypherpunk DeFi and entered Colosseum Cohort 4. Its B2B Net-30 product is real and deep, but Yumi already supports EVM, while Credit Coop, Huma, Teller, BRRR, and Rain cover the surrounding credit and payment stack. Arbitrum deployment is not a moat. [Yumi overview](https://docs.yumi.finance/), [Credit Coop](https://docs.creditcoop.xyz/developers/introduction), [Teller](https://www.teller.org/docs)
- **Kormos** won second place in Cypherpunk DeFi and entered Cohort 4. It packages liquid senior deposits with locked first-loss capital and a withdrawal queue. Its live pool currently has only a few thousand dollars of NAV, while Arbitrum already has Pendle, EulerEarn, Morpho, Lagoon, Yearn, and fixed-term markets. Its distinctive feature is maturity mismatch and bank-run risk, not a durable distribution advantage. [Kormos submission](https://colosseum.com/arena/projects/kormos), [live Kormos API](https://expo.kormos.fi/v2/pools)
- **ODL-style RWA recovery** is commercially important, but Clearpool already operates default auctions that transfer recovery rights on Arbitrum. RedStone Settle, Centrifuge, and regulated marketplaces occupy the rest of the workflow. The missing moat is legal and servicing distribution, not contracts. [Clearpool default process](https://docs.clearpool.finance/clearpool/how-it-works/credit-vaults/protocol/default), [RedStone Settle](https://blog.redstone.finance/2026/04/28/redstone-settle-bringing-instant-settlement-to-real-world-assets-liquidations/)
- **Senthos-style prime brokerage** is already crowded by Atrium, CVEX, Variational, Ithaca, SYMMIO, and Premia. A hackathon version without lender capital would only be a risk dashboard. [Atrium](https://useatrium.me/), [CVEX](https://docs.cvex.xyz/protocol/overview), [Variational on Arbitrum](https://blog.arbitrum.io/how-variational-is-reinventing-derivatives-onchain-with-arbitrum/)

## Archive Insights

### Futarchy works best when adopted at formation

Galaxy's archive analysis called MetaDAO the first at-scale implementation of onchain futarchy and identified an important adoption constraint: migrating an existing DAO from token voting into decision markets is confusing, while launching with market governance from day one establishes the capital, liquidity, and governance loop together. The same analysis noted that early decision markets still had limited participation and liquidity, so their signals should not be treated as automatically correct. [Galaxy, The State of Onchain Futarchy](https://www.galaxy.com/insights/research/the-state-of-onchain-futarchy)

Charter should therefore target new organizations at financing time. Selling governance replacement to mature DAOs is a later product.

### The legal instrument and protocol must agree on where value lives

The Colosseum STAMP archive argues that the common SAFE plus token-warrant structure creates two competing economic units: company equity and a project token. It proposes a path where the token becomes the sole economic unit and the treasury and intellectual property are protected through market governance. The important transferable insight is not to copy the STAMP. It is to prevent the legal documents, token rights, treasury permissions, and founder compensation from contradicting one another. [Introducing the Colosseum STAMP](https://blog.colosseum.com/introducing-the-colosseum-stamp)

Charter must treat the legal wrapper as a jurisdiction-specific adapter produced with counsel. A smart contract cannot make an unenforceable token into equity, assign offchain intellectual property by itself, or make a public offering legal.

### Price is an incentive signal, not complete truth

Decision markets make participants pay for their beliefs, which is stronger than costless polling. But token price can still reward short-term extraction, thin markets are manipulable, confidential strategy cannot always be disclosed, and markets can liquidate a company that founders believe still has long-term value. The [Ranger Finance liquidation](https://solanafloor.com/news/ranger-finance-liquidation-divides-opinions-on-futarchic-markets) shows that investor downside protection and founder operating autonomy can directly conflict.

Charter therefore needs explicit constitutions, bounded proposal powers, slow price observations, minimum liquidity and volume requirements, and an operating budget that does not require a market vote for every ordinary expense.

## Current Landscape

### Arbitrum has the components but not the integrated lifecycle

| Product | What exists now | What it does not prove |
| --- | --- | --- |
| [Legion](https://help.legion.cc/en/articles/10335791-how-do-sales-work-on-legion) | Merit-based, compliance-aware pre-token and token sales; the [Arbitrum Foundation confirms Legion support](https://docs.arbitrum.foundation/assets/files/ArbitrumFoundationTransparencyReport2024-c09352f2302b42087b98738cf017a58a.pdf) | Proceeds are not bound to a market-governed company treasury with performance vesting and capital return |
| [Fjord Foundry](https://help.fjordfoundry.com/fjord-foundry-docs/for-sale-participants/how-to-participate-in-a-sale/how-to-participate-in-a-lbp) | Arbitrum liquidity bootstrapping pools and price discovery | It is a sale and liquidity mechanism, not a company operating system |
| [Euclid Arbitrum Program](https://launch.arbitrum.euclidprotocol.io/) | Day-one market, competing market makers, advisors, and incentives | No public evidence of market-governed treasury, founder performance package, or shutdown path |
| [Futarchy Labs](https://docs.futarchy.fi/protocol/) | EVM conditional-token and decision-market infrastructure, publicly deployed on Gnosis Chain | No confirmed Arbitrum deployment or integrated raise-to-company lifecycle |
| [real.fun](https://real.fun/) | Company-token launches and holder dividends on Robinhood Chain | Its inspected page showed many launches but zero displayed trading volume, and no comparable treasury-governance lifecycle |
| [fndr](https://www.hackquest.io/projects/fndr-new) | Arbitrum testnet concept for tokenized startup equity, yield, ZK identity, and AI scoring | No mainnet product, real raise, or decision-market treasury control was shown |
| Safe, OpenZeppelin Governor, Zodiac, and Aragon | Mature custody and governance components | They are building blocks, not a capital-formation network |

The Arbitrum Foundation reported a builder pipeline of more than 1,000 projects in 2025 and continues to run Open House, mentorship, grants, and ecosystem-capital programs. That creates a plausible founder acquisition channel, but it does not prove willingness to adopt Charter. [Arbitrum 2025 transparency report](https://forum.arbitrum.foundation/t/the-arbitrum-foundation-2025-transparency-report-the-year-of-institutional-adoption/30660)

### The Grid evidence is incomplete

The Grid keyword search identified MetaDAO platform as product `428`, type `dao_management_platform`, and Legion as product `id1764896329-yXtmIGp5Rw2-e-2gE7nXuw`, type `launch_pad`. It also indexed the Colosseum STAMP as a live legal-service product.

However, an Arbitrum-scoped category and saturation query for `launch_pad` plus `dao_management_platform` returned zero products and zero roots. That contradicts verified evidence for Legion, Fjord, and other Arbitrum launch products. The chain-scoped Grid count is therefore an indexing failure and was not used as proof of whitespace.

### Regulation is a product constraint, not a disclaimer

The US SEC states that a non-security crypto asset can still be offered subject to an investment contract when purchasers invest money with an expectation of profit from a team's essential managerial efforts. In August 2026 it proposed, but has not finalized, tailored crypto offering exemptions up to $5 million and $75 million with disclosure and antifraud conditions. [SEC crypto transactions guidance](https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/transactions-involving-crypto-assets), [proposed Regulation Crypto Assets](https://www.sec.gov/rules-regulations/2026/08/s7-2026-27)

MiCA likewise imposes issuer, disclosure, white-paper, marketing, and safeguarding requirements for covered European public offers. [EU MiCA regulation](https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32023R1114)

The product architecture must therefore support jurisdiction gates, transfer rules, disclosures, cancellations, refunds, audit trails, and replaceable compliance providers. It must never market "permissionless" as a way to ignore applicable law.

## Key Insights

1. **The company lifecycle is the product.** Fundraising, liquidity, treasury permissions, compensation, governance, and shutdown must be one state machine. Shipping only the raise contract would be another launchpad.
2. **The post-raise layer is the current Arbitrum gap.** Legion, Fjord, Euclid, and older launchpads already handle allocation or launch. The unoccupied claim is programmable accountability after the money arrives.
3. **The initial customer is a founder, not a retail trader.** Charter wins only if a serious founder prefers protected capital because it improves trust, distribution, and financing terms enough to offset reduced control.
4. **The initial buyer can be an ecosystem program.** Accelerators, founder programs, and venture communities can pay for compliant deployments and bring both founders and capital. This is a better go-to-market than waiting for random issuers.
5. **The contracts are not the moat.** Durable advantages would be founder and investor distribution, repeat legal structures, launch performance history, decision-market data, reputation, and liquidity.
6. **Market governance must be bounded.** A thin token market should not be able to drain a treasury, mint unlimited supply, or dismiss operators through one easily manipulated observation.
7. **Use a responsive web application.** Founders configure organizations and investors analyze offerings on desktop. Wallet signing and urgent proposal actions can work on mobile web. A native Android app would consume time without improving the wedge.
8. **Deploy only on Arbitrum One.** Development can use local tests and an Arbitrum fork, but the submitted protocol, pilot organization, USDC flow, and evidence should all settle on Arbitrum One.

## Opportunities & Gaps

| Rank | Candidate transferred from another ecosystem | Real Arbitrum gap | Decisive problem | Verdict |
| ---: | --- | --- | --- | --- |
| 1 | MetaDAO-style company formation | No confirmed integrated raise, governed treasury, performance compensation, decision market, and capital-return stack | Legal structure, thin-market manipulation, and founder adoption | **Build Charter, gated by one pilot founder** |
| 2 | SecondLane-style locked-allocation secondary market | Discovery, issuer consent, compliance, and settlement remain fragmented | Hedgey and Sablier already provide transferable positions; the company moat is licenses and issuer relationships | Keep as future Charter secondary module, not the initial company |
| 3 | Kormos-style maturity transformation | Exact liquid plus locked reserve design is not obvious on Arbitrum | Pendle, Euler, Morpho, Lagoon, Yearn, and Strata cover the primitives; the remaining novelty is withdrawal risk | No-build without an RWA issuer and first-loss provider |
| 4 | Yumi-style B2B embedded credit | No dominant Arbitrum-branded Net-30 checkout SDK | Yumi is already EVM-capable; Credit Coop, Huma, Teller, BRRR, and Rain own the important data, capital, collections, and distribution | No-build without a signed merchant and capital partner |
| 5 | ODL-style RWA workout | Full default-to-recovery coordination is still operationally fragmented | Clearpool already has Arbitrum default auctions; RedStone, Centrifuge, legal servicers, and regulated venues own the hard dependencies | No-build for this event |
| 6 | Senthos-style institutional risk and clearing | Cross-venue collateral remains inefficient | Atrium is an exact current Arbitrum competitor; CVEX, Variational, SYMMIO, Ithaca, and Premia crowd the lane | No-build |
| 7 | Orbit treasury clearing | Orbit expense and fee reconciliation remains fragmented | Requires a production Orbit or RaaS design partner; otherwise the core loop is demo theater | Preserve only as a partner-triggered fallback |

The important comparison is not raw contract count. Charter wins because it has a validated source category, an observable Arbitrum integration gap, a complete economic loop, several revenue surfaces, and a credible bounded mainnet demonstration without requiring lender capital, an RWA issuer, a licensed servicer, or a production Orbit operator.

## Deep Dive: Top Opportunity

### Market Landscape

Charter sits between four existing categories:

- Launchpads distribute tokens.
- DAO frameworks govern treasuries.
- DEXs create liquidity.
- Legal providers form entities and prepare offering documents.

Today a founder must assemble those systems manually, and the promises made during fundraising may not match the permissions that exist after the raise. Charter turns the promises into a deployable company constitution.

The closest complete product is MetaDAO on Solana. The closest Arbitrum competitors each cover only part of the lifecycle. The largest strategic risk is not an existing Arbitrum product. It is MetaDAO, Legion, or Futarchy Labs extending their existing distribution and technology into this exact EVM bundle.

### Problem

Crypto-native founders face a capital and trust problem:

- Community fundraising can create distribution, but contributors fear treasury rugs, hidden insider allocations, uncontrolled minting, and revenue escaping to a separate company.
- Founders need operating autonomy and cannot submit every payroll or server bill to tokenholder voting.
- Traditional SAFE plus token-warrant structures can split value between equity and tokens.
- Token launch products solve allocation and liquidity but do not enforce what happens to capital afterward.
- Conventional token voting rewards ownership size, has low participation, and does not make voters bear the price consequences of bad forecasts.

Charter's job is not to guarantee startup success. It is to make capital rights, operator authority, and failure handling explicit before money enters.

### Initial users and buyer

The narrow initial founder profile is:

- a crypto-native protocol or application team;
- a working product or credible prototype;
- an expected community token within 6 to 18 months;
- a $250,000 to $2 million target round;
- willingness to keep raised USDC in a governed treasury;
- willingness to publish a monthly operating allowance and founder performance package;
- access to jurisdiction-specific counsel.

The roles are:

| Role | Job |
| --- | --- |
| Founder/operator | Raise capital, execute the approved operating plan, and earn performance compensation |
| Participant | Commit USDC, receive the ownership token, monitor treasury use, and access protected exit paths |
| Decision trader | Price whether an extraordinary proposal is expected to increase long-term token value |
| Ecosystem or accelerator | Source credible founders, sponsor deployments, and optionally anchor the raise |
| Compliance and legal provider | Configure eligibility, disclosures, entity rights, and transfer restrictions |
| Keeper/indexer | Record price observations, finalize lifecycle transitions, and expose auditable state |

The paying customer is initially the founder or sponsoring ecosystem, through a successful-raise fee and an organization subscription. Participants and traders are network users, not the primary buyer.

### Product

#### 1. Formation

The founder configures:

- minimum and maximum USDC raise;
- sale duration and pro-rata allocation policy;
- ownership-token supply and reserved allocations;
- monthly operating allowance;
- initial-liquidity percentage;
- founder performance thresholds and minimum vesting time;
- proposal bond, trading duration, pass threshold, and timelock;
- NAV exit allocation;
- compliance and transfer-policy adapter;
- emergency and upgrade authorities.

Every parameter is visible before contributions open. Material parameters cannot change after the first commitment.

#### 2. Raise

Participants deposit USDC into `RaiseVault`.

- If the minimum is missed, each participant withdraws the full contribution.
- If the raise succeeds, allocations and excess refunds are calculated pro rata.
- No founder can withdraw the raise directly.
- Formation fees are explicit and deducted only on successful finalization.

#### 3. Company activation

Finalization atomically:

- deploys or activates the ownership token;
- sends operating capital to `GovernedTreasury`;
- allocates the configured liquidity budget;
- creates and locks the initial liquidity position;
- transfers token mint authority to the governance executor;
- starts the monthly operating allowance;
- initializes the performance package and NAV exit vault.

If any required activation leg fails, finalization reverts rather than leaving a half-created company.

#### 4. Normal operations

The operator can draw only the configured monthly allowance. Unused allowance can either expire or roll over within a published cap. Ordinary operations do not require a market vote.

The initial version supports extraordinary proposals for:

- a treasury transfer above the allowance;
- changing the monthly allowance;
- minting new tokens;
- changing liquidity allocation;
- replacing an operator;
- beginning an orderly shutdown.

#### 5. Conditional decision markets

Each proposal creates PASS and FAIL conditional claims for both the ownership token and USDC. Trading reveals the token price expected under each outcome.

A proposal passes only when:

- the observation delay has elapsed;
- minimum market liquidity and trading-volume requirements are satisfied;
- the lag-limited PASS TWAP beats the FAIL TWAP by the configured threshold;
- the proposal has not exceeded its maximum treasury or mint authority;
- the execution timelock expires without a narrowly scoped security veto.

The security council can stop an exploit, not choose the business strategy. A veto must publish a reason and expire into a new proposal or shutdown procedure.

#### 6. Founder performance package

Founder tokens unlock only after both:

- a minimum time period, initially at least 18 months; and
- sustained price thresholds measured over a long TWAP with liquidity and volume floors.

This prevents an immediate insider allocation and makes compensation contingent on long-term market value. The production design must also address manipulation from treasury buybacks, wash volume, borrowed liquidity, and thin markets.

#### 7. Exit and shutdown

Two distinct mechanisms are required:

- `NAVExitVault` uses only a precommitted portion of capital to buy tokens at a formula tied to remaining treasury NAV, then burns them. It is bounded liquidity, not a principal guarantee.
- An approved shutdown freezes new spending, realizes liquid assets, snapshots eligible supply, burns claimed tokens, and distributes remaining USDC pro rata after known liabilities and expenses.

Offchain liabilities must be represented in the legal and accounting process. Onchain NAV alone cannot prove that a company has no unpaid obligations.

### Protocol architecture

| Module | Responsibility |
| --- | --- |
| `OrganizationFactory` | Deploys versioned organization suites using audited implementations |
| `RaiseVault` | Holds USDC, tracks commitments, finalizes allocations, and processes refunds |
| `OwnershipToken` | ERC-20 ownership unit with governance-controlled mint authority and optional transfer-policy hook |
| `GovernedTreasury` | Holds capital, enforces the monthly allowance, and executes approved extraordinary actions |
| `LiquidityManager` | Creates and locks the initial Arbitrum DEX position and records treasury-owned liquidity |
| `ConditionalMarketFactory` | Creates proposal-specific PASS and FAIL assets and trading pools |
| `LaggedTwapOracle` | Records bounded price observations and resists single-block manipulation |
| `ProposalExecutor` | Enforces proposal type, spending cap, pass rule, timelock, and execution target |
| `PerformancePackage` | Unlocks founder tranches only after time, price, liquidity, and volume conditions |
| `NAVExitVault` | Offers formula-bound USDC exits and burns surrendered tokens |
| `ShutdownModule` | Freezes operations, snapshots liabilities and eligible supply, and distributes residual capital |
| `PolicyRegistry` | Connects each organization to jurisdiction, eligibility, disclosure, and transfer-policy adapters |
| Indexer and API | Reconstructs raises, treasury flows, price observations, proposals, and participant positions |

Use Solidity and Foundry for the safety-critical system. Do not force Stylus into the architecture for sponsor optics. Stylus is justified later only if market simulation or observation processing has a measured cost bottleneck.

### State machines

Organization:

`DRAFT -> RAISING -> FAILED | ACTIVATING -> ACTIVE -> WINDING_DOWN -> CLOSED`

Proposal:

`CREATED -> BONDING -> TRADING -> OBSERVING -> PASSED | FAILED -> TIMELOCKED -> EXECUTED`

Exceptional proposal states:

`CANCELLED`, `SECURITY_VETOED`, and `EXPIRED`

Performance tranche:

`LOCKED -> OBSERVING -> CLAIMABLE -> CLAIMED`

These must be contract states and events. They must not be frontend labels.

### Revenue

Proposed pricing should be tested rather than presented as fact:

- 1.5% successful formation fee;
- 0.20% decision-market trading fee;
- 1% NAV-exit fee;
- $500 to $2,000 monthly organization, compliance, reporting, and API subscription;
- negotiated deployment and administration fee for accelerators or ecosystems.

Illustrative annual model, not a forecast:

| Assumption | Revenue |
| --- | ---: |
| 20 raises at $1 million average, 1.5% fee | $300,000 |
| 20 active organizations at $1,000 per month | $240,000 |
| $25 million decision-market volume at 0.20% | $50,000 |
| $10 million NAV exits at 1% | $100,000 |
| **Illustrative total** | **$690,000** |

The business becomes venture-scale only if it owns distribution for repeated raises and remains the operating standard after launch. One-off contract deployment fees are not enough.

### Go-to-market

#### First 14 days

- Interview at least five Open House or accelerator founders who expect to raise within 12 months.
- Ask for actual round size, structure, treasury permissions, investor objections, and the amount of control they would surrender.
- Secure one design partner willing to configure a real organization and use team-owned USDC in a closed mainnet pilot.
- Recruit one crypto legal counsel or compliance provider for a design review, not an endorsement.

#### First three launches

- Source teams through Arbitrum Open House, mentorship, grants, and partner accelerators.
- Offer a founder-facing formation package, not permissionless self-service.
- Require a working product, identity verification, published constitution, security review, and jurisdiction policy.
- Bring one anchor participant or fund into each raise before opening broader access.
- Publish treasury and proposal dashboards from day one.

#### Expansion

- Turn successful founder and participant history into reputation.
- Standardize approved legal and policy adapters by jurisdiction.
- Add integrations for Legion allocations, Safe custody, multiple Arbitrum DEXs, and institutional identity providers.
- Add secondary transfers only after issuer consent, transfer restrictions, and market-operator obligations are solved.
- Expand beyond Arbitrum only after three real Arbitrum organizations complete a raise and six months of operation.

### Founder fit

This team should build Charter only if it wants to own mechanism design, smart-contract security, frontend trust, founder sales, legal coordination, and a two-sided capital network. It is not a pure engineering protocol. The founders will spend substantial time recruiting issuers and capital providers.

The existing Orcus and agentic-payment projects show the team can build multi-contract state machines and full-stack financial workflows. That meets the technical depth bar. It does not prove access to founders, investors, market makers, or counsel. The design-partner gate exists to test that missing founder-market fit.

### Why crypto and why Arbitrum One

Crypto is necessary because the product must make the following rights independently verifiable and executable:

- custody of raised capital;
- limits on operator withdrawals;
- token mint authority;
- pro-rata allocation and refunds;
- conditional proposal positions;
- founder vesting conditions;
- treasury-owned liquidity;
- token burns and residual-capital distributions.

A conventional fundraising portal can promise these policies. Charter makes them transaction preconditions.

Arbitrum One is the right initial chain because it combines native stablecoin settlement, mature EVM custody and governance tooling, deep DEX liquidity, low-cost repeated market interactions, and a large active founder funnel. The product should compose with existing Arbitrum infrastructure rather than invent a wallet, DEX, bridge, or identity system.

### Mainnet build for Open House

The hackathon build must prove the entire loop with bounded risk. It should not accept an unrestricted public raise.

#### Required shipped flow

1. Deploy the versioned factory and organization suite on Arbitrum One.
2. Create one pilot organization with a small, team-funded USDC raise.
3. Complete successful commitments, pro-rata allocation, and one refund path.
4. Activate the ownership token, governed treasury, and locked initial liquidity.
5. Draw one valid monthly allowance and reject one oversized draw.
6. Create and trade one conditional treasury proposal.
7. Finalize the proposal from recorded price observations and execute or reject it.
8. Show a locked founder performance tranche and a failing premature claim.
9. Execute a bounded NAV exit and token burn.
10. Show the full history in the web application and indexer.

#### Mainnet safety boundary

- Use only team-owned funds unless counsel and the event organizers approve external participation.
- Set a small immutable pilot cap.
- Allowlist pilot participants.
- Do not describe the pilot token as equity, profit ownership, or a guaranteed investment return.
- Keep upgrades behind a disclosed timelock and multisig during beta.
- Pause new commitments without blocking refunds.
- Do not launch permissionless organization creation until the contracts are audited and legal adapters exist.

### Security and economic invariants

At minimum, tests and review must prove:

- total finalized allocation never exceeds the configured sale supply;
- failed or cancelled raises remain fully refundable;
- successful finalization cannot be executed twice;
- the founder never receives raw control of raised USDC;
- monthly withdrawals cannot exceed the allowance and rollover cap;
- proposal execution cannot target an unapproved module or exceed its published bounds;
- conditional assets remain fully collateralized and can settle exactly once;
- a single-block spot price cannot unlock compensation or decide a proposal;
- NAV exits cannot spend operating capital reserved by the constitution;
- token burns cannot increase a caller's residual claim beyond the defined formula;
- shutdown claims cannot be replayed;
- pausing does not trap refunds or already matured claims;
- fee-on-transfer, rebasing, callback, decimal, rounding, and reentrancy edge cases are either supported explicitly or rejected.

Use unit, fuzz, invariant, and Arbitrum-fork tests. The economic simulator should test thin liquidity, wash trading, treasury buybacks, observation gaps, price shocks, simultaneous exits, and malicious proposal targets.

### Risks and kill gates

| Risk | Evidence required before expanding |
| --- | --- |
| Founders reject treasury constraints | One signed design partnership and three additional founders saying the protection improves financing terms or demand |
| Investors do not value the protection | At least ten qualified participants compare Charter against an ordinary token sale and commit nonbinding interest |
| Thin markets are manipulable | Independent mechanism review, attack simulations, minimum liquidity and volume policy, and bounded proposal powers |
| Public offering is unlawful | Written jurisdiction-specific counsel for the issuer, platform, token, marketing, transfer, and secondary-market structure |
| MetaDAO or Legion can copy rapidly | Arbitrum distribution partnership, faster integrations, standardized EVM legal adapters, and operating-history moat |
| Product becomes a generic launchpad | Do not ship self-service token creation until treasury governance, performance vesting, and shutdown work end to end |
| Pilot is only demo theater | Real founder configuration, real mainnet transactions, real negative-path demonstrations, and a dated post-event operating plan |

### Final decision

Build **Charter Protocol** on Arbitrum One.

Do not pitch it as "MetaDAO on Arbitrum," a launchpad, AI fundraising, tokenized equity, or crowdfunding. Pitch the missing operating system:

> Charter turns a founder's financing promises into an enforceable company lifecycle: fair formation, protected treasury, bounded operator autonomy, market-tested major decisions, performance-earned ownership, and an orderly capital-return path.

Start implementation only after the founder gate is met. The first 48 hours should be customer validation and a written pilot constitution. If no serious founder will accept the constraints, stop. If one will, this is the deepest, most defensible, and most mainnet-demonstrable product found in the research.
