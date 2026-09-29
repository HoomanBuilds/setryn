c# Arbitrum Open House Singapore 2026: Win and Company Strategy

> The event and landscape research remains useful, but its product recommendations and the later FeeForward selection are superseded. Use the [living ecosystem and protocol research](./arbitrum-open-house-ecosystem-protocol-search.md) for current decisions and updated event caveats.

Research cutoff: September 14, 2026, 6:00 PM IST

This file remains the historical event, winner, and market landscape record.

## First-pass decision, superseded by the mainnet-only revision

Build **PayLock**, an onchain verified-payee mandate for stablecoin business payments.

Singapore Police recorded 377 business-email-compromise cases and S$35.3 million lost in 2025. A common attack was a spoofed or compromised supplier email announcing new payment details.[^33] PayLock makes an existing supplier's payout address a two-party onchain mandate, so a fake invoice or emailed wallet change cannot redirect a stablecoin treasury payment.

The product is deliberately smaller than accounts payable software:

- A supplier signs each invoice intent with a passkey-bound account.
- The intent binds the buyer, supplier, payout address, token, amount, nonce, expiry, and chain.
- A payout-address change requires supplier authorization, buyer treasury approval, and a cooldown.
- The buyer's onchain treasury rejects the transfer itself when the mandate does not match.
- PayLock never holds funds, performs FX, decides delivery, or resolves commercial disputes.

The sharp initial customer is a crypto-native company or DAO already paying recurring vendors in stablecoins from a Safe or smart account. The company path is a security module and API for wallets, treasury tools, and accounts-payable platforms. The mobile PWA is a reference client, not the moat.

This is the best current bet because the problem is specific, the onchain enforcement is necessary, the regulatory surface is narrower than escrow or cross-border settlement, the adversarial demo is excellent, and a real pilot is achievable before Founder House.

Do not build another AMM, wallet, neobank, RWA marketplace, x402 wrapper, generic agent platform, index basket, social trading app, or yield vault. Those categories are already occupied by Open House winners, Arbitrum cohort companies, or well-funded products.

## The immediate call

Treat **October 1 at 11:59 PM Singapore time** as the submission deadline until the organizers answer in writing. The live portal says October 4, but the linked Buildathon terms say October 1.[^1] Submit by September 30 if possible.

Apply to both programs now:

1. Register separately for the online Buildathon.[^1]
2. Apply separately for Founder House because applications are rolling and curated.[^2]
3. Use the same team name for every Founder House team-member application.
4. Ask the organizers to resolve the deadline, payout, eligible-chain, and automatic-admission conflicts listed below.
5. Join the Arbitrum Discord `#open-house` channel and recover the September 14 kickoff recording or notes.

The phase beginning September 14 is online. Founder House is the in-person Singapore event from October 23 to October 25.[^2]

## 1. What this program actually is

Open House Singapore is a two-stage founder funnel, not a one-weekend hackathon:

| Stage | Dates | Format | Outcome |
|---|---|---|---|
| Online Buildathon | Sep 14 to Oct 4 on the live page | Global and online | Build a functional Arbitrum product, compete for prizes and grants |
| Founder House | Oct 23 to Oct 25 | In person, Singapore, approval required | Ship another meaningful feature, meet the ecosystem and investors, compete for $300K |
| Possible later path | Not guaranteed | Arbitrum Mentorship | Eight-week acceleration, investor introductions, mainnet work |

Founder House is designed for teams that already have a product, prototype, or operating business. Selection is based on product quality, execution potential, and ecosystem alignment.[^2] This is why a thin hackathon demo is the wrong goal.

The advertised Singapore pool is $415,000 in USDC prizes and grants.[^3]

| Stage | Track | Awards |
|---|---|---:|
| Buildathon | Overall | $40K, $20K, $10K |
| Buildathon | Promising Products | $7K, $5K, $3K |
| Buildathon | Discretionary milestone grants | Up to $30K |
| Founder House | Singapore Champions | $60K, $40K, $20K |
| Founder House | Robinhood Chain Founder in Residence | $60K |
| Founder House | Robinhood Chain Innovation | $30K |
| Founder House | Promising Products | $10K, $6K, $4K |
| Founder House | Discretionary milestone grants | Up to $70K |

The linked phase terms provide the detailed award and grant conditions.[^5][^42]

Robinhood Chain's broader $1 million Open House commitment covers early-stage teams across the program, not an extra $1 million Singapore prize.[^4]

### Milestone funding is not cash on announcement

The linked terms require most winners to sign a grant agreement and continue building. The Buildathon terms describe 25 percent after agreement execution, 25 percent after a one-month check-in subject to exclusive building on an Arbitrum chain, and 50 percent after Arbitrum mainnet launch plus a mutually agreed KPI.[^5] A newer official announcement describes a 50/50 upfront and milestone split.[^6]

Budget as if only 25 percent arrives first until the Foundation confirms otherwise. Promising Products is treated separately. Compliance checks, taxes, fees, milestones, and team-level prize division also apply.

### Eight conflicts that need a written answer

| Topic | Source A | Source B | Safe operating assumption |
|---|---|---|---|
| Buildathon deadline | Portal: Oct 4, 11:59 PM SGT | Terms: Oct 1, 11:59 PM SGT | Ship by Sep 30 |
| Winner announcement | Portal: Oct 12 | Terms: Oct 4 | Do not plan around either date |
| Payout schedule | Terms: 25/25/50 | Newer blog: 50/50 | Assume 25 percent first |
| Eligible networks | Portal includes One, Nova, Sepolia, Robinhood and others | Terms contain narrower wording and a likely typo | Get intended production chain approved |
| Founder House admission | Luma says all Buildathon winners | HackQuest says top three | Apply independently |
| Founder House format | Luma says in person | Terms also mention online | Plan for Singapore in person |
| Existing work | Main terms permit meaningful new work on an existing product | Code of Conduct has stricter new-work wording | Keep a clean event-period branch and delta log |
| Judges | Criteria are public | No panel is named | Optimize for published criteria |

Send these questions to `engineering@arbitrum.foundation` and ask in `#open-house`. Save the reply with the project records.

Suggested message:

> Subject: Singapore Open House rule clarifications
>
> We are registered for the Singapore Online Buildathon and are planning our delivery schedule. Please confirm: 1) whether the binding submission deadline is October 1 or October 4; 2) whether the payout is 25/25/50 or 50/50; 3) whether Promising Products winners also receive guaranteed Founder House admission; 4) whether Robinhood Chain counts within the Arbitrum-reserved placements or is treated separately; and 5) how to document permitted pre-event code versus work produced during the Buildathon. We will follow the stricter interpretation until confirmed. Thank you.

## 2. Eligibility, chains, and judging

The product must be functional, demonstrable, original or meaningfully improved during the event, and deployed to an Arbitrum chain. The live form recognizes Arbitrum One, Arbitrum Nova, Robinhood Chain, and Arbitrum Sepolia, with follow-up for other networks.[^1]

No public rule limiting teams to three chains was found in the live configuration, Buildathon terms, Founder House terms, or application forms. The likely confusion is the three ranked prizes, where at least one is reserved for Robinhood Chain and at least one for Arbitrum. If the team saw a three-chain limit inside a logged-in UI, ask for clarification and save a screenshot.

The published Buildathon criteria are:

- Smart-contract quality and security.
- Product-market fit and retention potential.
- Innovation and creativity.
- A genuine market problem.
- Technical implementation and meaningful Arbitrum use.
- Potential impact, presentation quality, and novelty.[^1][^5]

Arbitrum's own winner guidance says judges inspect the repository and demo before the deck, look for an end-to-end transaction, penalize generic "blockchain for X" stories, and use real traction as a tiebreaker.[^7]

### What judges will actually test

| Question | Winning evidence |
|---|---|
| Does this require a blockchain? | The treasury contract rejects a mismatched payee even if the email, AP account, frontend, or automation agent is compromised |
| Why Arbitrum? | Real USDC treasury payments, low enforcement cost, strong stablecoin activity, EVM smart accounts, and production deployment |
| Is the product real? | One buyer and existing supplier enroll, sign an invoice, and complete a low-value payment |
| Is the team continuing? | Two treasury design partners, a dated integration plan, weekly usage targets, and event-period commits |
| Is it safe? | Clear threat model, beta caps, nonce and signature controls, fuzz and invariant tests, three blocked attacks |
| Is it new? | It binds a bilateral supplier mandate to each payment at contract execution, rather than offering another UI allowlist or generic agent policy |

## 3. Schedule that matters

All listed session times are Singapore time. India is two and a half hours behind Singapore.

| Date and SGT | Session | Why the team should attend |
|---|---|---|
| Sep 15, 5:00 PM | Getting Started with Arbitrum | Confirm deployment and sponsor expectations |
| Sep 16, 4:00 PM | Pendle V2 and Boros with AI Agents | Useful only for future receivables, not MVP scope |
| Sep 16, 5:00 PM | Feedback Session 1 | Present problem and narrow user before contracts harden |
| Sep 17, 4:00 PM | Smart Contract Security Pitfalls | Validate signature domains, guard bypass, rotation, nonce and exit risks |
| Sep 17, 5:00 PM | How to Find Your Wedge | Challenge the target customer and initial corridor |
| Sep 18, 10:00 AM | Market Opportunities | Validate procurement versus other ideas |
| Sep 22, 4:00 PM | SBI: Tokenized RWAs | Learn what evidence future receivables financing needs |
| Sep 22, 5:00 PM | ZeroDev UX | Passkey and gas sponsorship implementation |
| Sep 23, 4:30 PM | Agentic Development and x402 | Keep agent authority bounded and human controlled |
| Sep 23, 5:00 PM | Feedback Session 2 | Demo successful payment and blocked recipient substitution |
| Sep 24, 10:00 AM | Robinhood Chain | Ask if the product has a legitimate Robinhood extension |
| Sep 25, 5:00 PM | Feedback Session 3 | Demo the full payment and rotation flow, then pressure-test security objections |
| Sep 28, 5:00 PM | Feedback Session 4 | Run near-final pitch and objections |
| Sep 29, 5:00 PM | Tracking the Market with Dune | Publish activity and funnel dashboard |

The official calendar can change and should remain the source of truth.[^1]

## 4. What previous winners built

### India and Bengaluru

The India online stage received 72 submissions. Plexi won first with an ERC-4626 vault interface, Orbital placed second with a high-dimensional stablecoin AMM, and TriggerX placed third with keeper automation.[^8]

At the Bengaluru Hacker House, around 500 applied, more than 100 were selected, and 23 submitted demos.[^8]

| Place | Product | Why it mattered |
|---|---|---|
| 1 | Orbital AMM Protocol | High-dimensional stablecoin AMM in Stylus with precise fixed-point math, segmented trades, APIs, tests, deployed contracts, and a live agent settlement demo |
| 2 | Shinobi.Cash | Cross-chain privacy pools with Arbitrum as the hub, ZK, intents, and account-abstraction paymasters |
| 3 | GuardChain.ai | Region-specific insurance for Indian gig workers and self-help groups, AI-assisted claims, community governance, and a claimed distribution relationship |

The math-sounding winner the team remembered was **Orbital**, not Orbswap. Orbital first placed second online, improved substantially, then won the $40,000 Bengaluru prize. A judge praised the combination of rigorous math, market thinking, and execution speed.[^9]

Orbital's lesson is not "build another hard AMM." Its lesson is to expose technical depth, ship a working transaction, show what changed between rounds, and connect engineering to an economic thesis.

### New York City

The NYC online Buildathon had 512 builders from more than 40 countries. Tilt, Fangorn, and EqualFi won with agent-fund infrastructure, threshold-encrypted paid data, and tokenized-asset index infrastructure.[^10]

Founder House selected 88 teams from 473 applications, and 55 products submitted.[^11]

| Award | Product | Prize |
|---|---|---:|
| 1st | Kustodia, programmable fiat and stablecoin escrow | $60K |
| 2nd | Laytus, correlation-aware prediction-market risk | $40K |
| 3rd | EqualFi, fully backed RWA index products | $20K |
| Robinhood Innovation | Bond.Credit, agent credit and underwriting | $50K |
| Founder in Residence | Tilt, AI and quant-fund infrastructure | $100K |

### London

London's online phase had 782 builders and 278 submissions. TradeVerus won the open category after adding Arbitrum venues, gasless execution, analytics, and security work to a real existing product.[^12]

Founder House received more than 490 registrations, selected 140 builders, and saw 64 submissions.[^13]

| Award | Product | Prize |
|---|---|---:|
| 1st | Liquida, tokenized UK government debt as programmable collateral | $60K |
| 2nd | Risk Protocol, onchain risk transfer | $40K |
| Joint 3rd | EdenFi and Obolos, global money and programmable startup equity | $10K each |
| Robinhood Founder in Residence | Saffron, fixed yield on concentrated LP positions | $60K |
| Robinhood Innovation | Agama, Stock Token yield infrastructure | $30K |
| Agentic winners | AlphaGrid, CanHav, ReineiraOS | $10K, $6K, $4K |

Liquida shows the current quality bar. It reported a regulatory sandbox application, bank and infrastructure conversations, a relationship pipeline, a signed pre-seed lead term sheet, and a testnet demo that included a rejected permission path. It clearly labeled simulated boundaries.

### The recurring winner formula

1. A functional deployment is the minimum.
2. A specific user and painful workflow beat a generic protocol category.
3. The Arbitrum reason must be functional, not a logo.
4. Real pilots, users, counterparties, liquidity, or partner conversations break ties.
5. Honest negative-path demos increase credibility.
6. A clean record of work produced during the event matters.
7. Continued progress between the online stage and Founder House can change the ranking.

## 5. Mobile is a channel, not the thesis

The historical evidence does not show a general mobile preference:

- Bengaluru's top projects were web or infrastructure products.
- Pledge shipped a native iOS experience at NYC and received an honorary mention, not a top place.
- Denaria placed third online in London with a mobile-first PWA, passkeys, gasless execution, and an existing community.
- EdenFi shared third at London Founder House with live mobile applications and regional bank or mobile-money cashout.[^13]

The signal is simple: build mobile-first when the target user works from a phone. For PayLock, start with a high-quality responsive PWA for supplier passkey signing and urgent treasury approvals. Do not spend the first event week on App Store packaging.

## 6. The funded product landscape

Funding is clustering around normal financial outcomes, clear cashflows, strong controls, and invisible crypto infrastructure.

| Product | Verified funding or selection | Product signal | Lesson |
|---|---:|---|---|
| Bleap | $6M seed in Jan 2026 | Arbitrum-origin self-custodial neobank, reporting 20K users and $30M 2025 volume | Generic wallet or neobank is occupied[^14] |
| Spiko | $22M Series A in Jul 2025 | Regulated tokenized money-market funds, reporting $400M AUM at funding | Regulated distribution and B2B APIs beat a generic RWA marketplace[^15] |
| Catena Labs | $18M in May 2025 | Regulated financial institution for agents with policies, accounts, audit trails, and stablecoin settlement | Agent controls matter, but generic agent banking is crowded[^16] |
| Kite AI | $18M Series A, $33M total in Sep 2025 | Agent identity, policy, payments, and commerce integrations | A new agent passport or chain is not the wedge[^17] |
| Credible | Colosseum cohort, standard $250K terms | India-focused B2B stablecoin remittance with a sharp corridor | A corridor and buyer are stronger than "global payments"[^18] |
| Halliday | $20M Series A in Mar 2025 | Workflow and payment abstraction | Use horizontal rails underneath a vertical product[^19] |
| NUVA | $5.2M seed in Apr 2026 | Noncustodial institutional RWA vault marketplace | Horizontal RWA access is well funded and crowded[^20] |
| KAST | $80M Series A in Mar 2026 | Stablecoin banking, cards, payments, savings, reported 1M users | A broad neobank is a capital and licensing war[^21] |
| Kimia | $60K capped MetaDAO raise in 2026 | Solana perps, delta-neutral vault, fixed and floating yield claims | Own a real cashflow and an integrated financial engine[^22] |

Company-reported usage should be treated as directional until independently verified. Funding proves investor interest, not product safety.

### Kimia, correctly interpreted

Kimia did not receive $727,114. The process was heavily oversubscribed, but its raise was capped at $60,000. The MetaDAO page confirms $60,000 raised.[^22]

Kimia's product combines a perpetuals venue, a delta-neutral vault that captures funding, principal and yield decomposition, a yield AMM, and a programmable stable settlement asset.[^23]

The useful inspiration is structural:

- Start with a cashflow the chain does not expose well.
- Build the engine required to produce that cashflow.
- Turn the cashflow into a composable product.
- Make the funding request map to concrete mainnet milestones.
- Explain the flywheel in one sentence.

Do not clone funding-rate yield. Arbitrum already has deep perpetuals and yield infrastructure, and the scope is too large for this event. Apply Kimia's discipline to PayLock instead: own one hard enforcement primitive, make every funding milestone concrete, and explain the security flywheel in one sentence. More protected payments create a stronger mandate history, which makes more treasury integrations useful.

## 7. Current competition and category traps

The public Singapore submission snapshot on September 14 already included these visible entries:[^1]

- Agent Guardian, a deterministic policy boundary for agent wallets with spend limits and recovery.
- QARBI, a Stylus and post-quantum agent marketplace narrative.
- INSTANT WIN, a highly tested asset distribution product with extensive proof artifacts.
- Apraxus, autonomous-agent payment and economic infrastructure.

The field will change throughout the event. The early signal is still useful: generic agent wallets and agent infrastructure are already crowded, and strong competitors are presenting hundreds of tests, deployments, and audits.

Arbitrum's first mentorship cohort also includes Tilt, T3tris, Bond.Credit, Kustodia, Capa, Prism, Carbon, and Twyne. The official recap says 13 of 902 applicants were selected, 10 reached Demo Day, the cohort raised more than $1 million collectively, received more than 40 investor introductions, and presented to more than 25 VCs.[^24]

### Categories to avoid

| Category | Why it is a weak entry now |
|---|---|
| High-dimensional AMM | Orbital already won; the local Orbswap and an Arbitrum Stylus variant already exist |
| Generic stablecoin bank | Bleap and Capa are already native to the ecosystem; large funded competitors dominate distribution |
| Generic agent wallet or guardrail | Current Singapore and previous London projects already target it; PayLock must remain a bilateral vendor-payment protocol, not a general permission system |
| x402 or MCP marketplace | Base, Solana, Arbitrum programs, Frames, and many startups already cover this |
| RWA index or basket | EqualFi won, Robinhood publishes an index-basket example, and multiple current repositories implement it |
| RWA marketplace | Spiko, NUVA, Tilt, T3tris, and institutional providers occupy the horizontal layer |
| Yield vault | Plexi, Saffron, Agama, T3tris, Pendle, Aave, and others make this crowded |
| Generic escrow | Kustodia already won on Arbitrum; PayLock should avoid custody and performance disputes entirely |
| Social trading | Prism and Fomo cover the category, including Robinhood Chain |
| Mobile wallet | Mobile form factor without a specific job is not differentiation |

### What the second research wave killed

The initial cross-border procurement thesis did not survive direct competitor research. Kustodia already has private and agentic escrow, evidence and disputes. Request Finance already has invoice OCR, duplicate detection, approvals, vendor management, wallet test payments, stablecoin and fiat payment, and reconciliation. Tazapay covers international escrow and release documents. Singapore TradeTrust covers trade-document integrity, while DBS Trusple combines trade documentation, smart-contract workflows, settlement and financing.[^35][^37][^38]

Generic family continuity also failed. Direct Arbitrum and multi-chain products already cover wills, inactivity switches, beneficiaries, signer recovery, encrypted instructions, and nontechnical heir flows.[^26][^39][^40]

Generic agent settlement failed even harder. Circle Refund Protocol, Base Commerce Payments, ERC-8183, Virtuals ACP, ReineiraOS, and recent agent-settlement work already cover escrow, capture, refunds, delivery evidence, evaluator roles, provider bonds, and compensation.[^41]

PayLock survived because it cuts across none of those product promises. It protects a direct payment to an established vendor before value leaves the treasury. Its validity depends on the supplier signature, bilateral rotation and onchain enforcement all remaining mandatory.

## 8. Ranked product theses

Scores use a 10-point scale and reflect current evidence, not certainty.

| Thesis | Win fit | Company fit | 17-day feasibility | Differentiation | Overall |
|---|---:|---:|---:|---:|---:|
| PayLock: bilateral vendor-payment mandate | 9.0 | 8.0 | 8.5 | 8.0 | 8.4 |
| Trade Preflight: corridor document exception engine | 7.0 | 8.0 | 7.0 | 7.5 | 7.4 |
| Private Income Passport | 7.0 | 7.0 | 6.5 | 7.5 | 7.0 |
| Receivables Rate Market | 7.5 | 9.0 | 3.5 | 8.0 | 6.8 |
| ReservePilot treasury risk engine | 7.0 | 7.5 | 6.5 | 5.5 | 6.6 |
| Family Wealth Continuity | 4.0 | 5.5 | 5.0 | 3.0 | 4.4 |
| Generic agent-commerce settlement | 4.5 | 6.0 | 7.0 | 2.5 | 5.0 |

### 1. PayLock

**User:** A finance lead at a crypto-native company or DAO paying established vendors from a Safe or smart treasury.

**Job:** Ensure a spoofed invoice, compromised mailbox, or emailed payout change cannot redirect a stablecoin payment.

**Product:** A bilateral vendor-payment mandate plus supplier-signed invoice intents enforced inside the buyer treasury.

**Why now:** Singapore's official 2025 scam report documents exactly this attack pattern and reports S$35.3 million in BEC losses.[^33] This proves the fraud pattern, not stablecoin product demand. The first 72 hours must validate that target treasuries fear the same failure and do not already prevent it.

**Company path:** Start as a Safe and smart-account module with a treasury dashboard. Distribute through accounts-payable, treasury, wallet, and custody providers. The long-term network is a portable set of vendor-controlled payment mandates, but do not claim that network before integrations exist.

### 2. Trade Preflight

Reconcile purchase orders, invoices, packing lists, shipping documents, and beneficiary changes before a bank or licensed payment provider receives the payment packet. A deterministic rule engine identifies exceptions; a model only extracts and explains fields.

The underlying pain is strong. Fewer than 1 percent of trade documents are fully digitized, Singapore is expanding InvoiceNow beyond invoices into procure-to-pay workflows, and ADB still reports a $2.5 trillion global trade-finance gap.[^25][^38] The product is viable only with real trade documents and a channel through freight forwarders, accountants, or payment providers. Its Arbitrum need is weaker than PayLock, so a document registry alone will not win.

### 3. Private Income Passport

Stablecoin-paid workers prove an income band, recurrence, or consistency without exposing every payment, client, or exact amount. It is differentiated and mobile-native, but it has no utility without a verifier such as a landlord, lender, insurer, or visa service. Do not code it without one verifier commitment.

### 4. Receivables Rate Market

Verified invoices become short-duration assets with fixed terms and repayment waterfalls. This is the most Kimia-like financial primitive, but it creates fraud, servicing, securities, licensing, default, and origination work. Build it only after a workflow product produces real receivables and a regulated capital partner exists.

### 5. Family Wealth Continuity

Do not build it for this event. Inheritor already operates on Arbitrum, Safe RecoveryHub covers delayed signer recovery, AfterLife has an Arbitrum testnet implementation, ERC-7878 standardizes bequeathable contracts, and Casa, RIP Wallet, Heres, and others cover adjacent flows.[^26][^39][^40] A contract also cannot determine death, probate, taxes, legal title, or family disputes. The remaining company moat is high-trust operations and distribution, which cannot be demonstrated credibly in 17 days.

## 9. PayLock product blueprint

### One-sentence pitch

**PayLock makes an existing supplier's payout address a two-party onchain mandate, so a spoofed invoice or emailed wallet change cannot redirect a stablecoin treasury payment.**

Say "existing supplier" and "payment mandate." Do not say "verified supplier." The protocol proves key control and agreement, not legal identity.

### Closest competitors and the exact delta

| Product | What it already does | PayLock must add |
|---|---|---|
| Fireblocks | External-wallet whitelisting, policy rules, admin quorum, optional activation delays | Supplier signs each invoice, rotation is bilateral, enforcement is open and onchain[^34] |
| Request Finance | Invoice import, duplicate detection, roles, approval policies, test payments and wallet confirmation | Cryptographic binding of supplier, invoice, recipient, token, amount, expiry, nonce and chain at execution[^35] |
| Safe | Multisig, modules, guards, delays and transaction simulation | The bilateral supplier-mandate protocol and reference workflow[^36] |
| Agent Guardian | Generic agent permissions, selector allowlists, spend limits and recovery | A supplier-controlled mandate and supplier-signed invoice, not another agent policy |
| Kustodia | Escrow for performance, delivery, refunds and disputes | Nothing overlapping: PayLock is direct payment and prevents recipient substitution[^37] |

Without supplier-signed invoice intents, bilateral address rotation, and enforcement inside the treasury, kill PayLock. It collapses into a Safe or Fireblocks allowlist.

### The first workflow

1. Buyer creates a vendor relationship from its Safe or PayLock treasury.
2. The existing supplier enrolls through a deliberate out-of-band ceremony and creates a passkey-bound smart account.
3. Buyer and supplier approve the payout address, token, per-invoice cap, rolling cap, and change delay.
4. Supplier creates or imports an invoice and signs an EIP-712 payment intent.
5. Buyer reviews the human-readable payment and obtains the existing treasury approval quorum.
6. The payment executor verifies the current mandate, invoice signature, amount, asset, nonce, expiry, and chain domain.
7. The executor transfers USDC directly to the supplier and emits a receipt atomically.
8. A payout-address change requires the supplier signature, buyer quorum, cooldown, and out-of-band notification.

### MVP boundaries

Ship:

- Pairwise buyer and supplier mandate registry.
- Supplier passkey account with ERC-1271 signature support.
- EIP-712 invoice intents.
- Safe guard or a capped treasury vault plus payment executor.
- Duplicate-nonce rejection.
- Per-invoice and rolling amount limits.
- Payout-address rotation with supplier approval, buyer quorum, and cooldown.
- Buyer emergency pause.
- Onchain payment-receipt events.
- Responsive PWA for enrollment, signing, approval, rotation, and attack simulation.
- Tightly capped Arbitrum One deployment after local and fork verification.
- Unit, fuzz, invariant, integration, and failure-path tests.

Do not ship:

- Escrow, milestones, refunds, or dispute resolution.
- OCR as a core dependency.
- Supplier identity, KYB, sanctions, or compliance claims.
- Fiat conversion or FX.
- Cross-chain payments.
- A general-purpose agent wallet.
- An open vendor marketplace.
- Automatic approval by an AI model.

### Contract model

The smallest useful contract surface is:

- `MandateRegistry`: pairwise current mandate and proposed rotation.
- `PaymentExecutor`: validates and consumes invoice intent, then transfers.
- `TreasuryGuard` or capped `TreasuryVault`: prevents bypass and supports pause.

Core invariants:

- A payment recipient always equals the active mandate recipient.
- An invoice nonce is consumed at most once.
- Rotation cannot activate before its cooldown.
- Supplier and buyer authorizations are both required for rotation.
- Invoice amount and rolling spend cannot exceed active limits.
- Token, chain ID, verifying contract, buyer, supplier, recipient, amount, nonce, and expiry are domain bound.
- A paused treasury cannot pay.
- A failed validation cannot consume a nonce or move funds.
- The module cannot strand funds if its emergency-exit process completes.

The emergency-exit path must itself be time delayed or separately approved. Otherwise an attacker can simply remove the guard and bypass every protection.

### Exact demo

1. Enroll an existing supplier and approve payout address A.
2. Supplier signs a 10 USDC invoice intent for address A.
3. Complete one successful payment and show the receipt.
4. Change the invoice recipient to attacker address B and show the contract revert.
5. Replay the paid invoice nonce and show the contract revert.
6. Propose a legitimate rotation to address B with both parties.
7. Attempt payment before the cooldown and show the contract revert.
8. After the real mainnet cooldown expires, complete the rotated payment.

The successful flow proves usability. The three blocked attacks prove the product.

### Technical stack

| Layer | Choice | Reason |
|---|---|---|
| Production settlement | Arbitrum One USDC | Real treasury asset and credible ecosystem fit |
| Verification | Foundry plus a local Arbitrum One fork | Exercise live integrations without making the judged product depend on a testnet |
| Contracts | Solidity and Foundry | Best path for a small, security-sensitive EVM module |
| Treasury | Safe guard first, capped vault fallback | Use existing quorum and transaction UX |
| Supplier account | Passkey smart account through ZeroDev or equivalent | Familiar signing without a seed phrase[^28] |
| Signatures | EIP-712 and ERC-1271 | Human-readable typed intents and smart-account verification |
| Contract libraries | OpenZeppelin | Standard token, signature, access, and safety primitives |
| Analytics | Dune | Public successful and blocked-attempt metrics |

Arbitrum reports roughly $70 billion in average monthly stablecoin transfer volume during H1 2026, which makes treasury-payment protection a credible ecosystem fit rather than a forced integration.[^29]

### Threat and honesty boundaries

- PayLock does not verify legal supplier identity.
- It protects established relationships after careful initial enrollment.
- It cannot help if the buyer and supplier authorization keys are both compromised.
- It does not prove that goods or services were delivered.
- It does not stop payments sent from an unprotected wallet.
- It must make guard removal and emergency exit visible and delayed.
- Passkeys reduce seed-phrase friction but do not remove device or account-recovery risk.
- Calling software noncustodial does not itself decide its regulatory treatment. Do not claim licensing or compliance status without Singapore counsel reviewing the exact flow.[^43]
- A local or forked transaction is technical proof, not traction.
- A low-value mainnet pilot is workflow proof, not an audit.

## 10. Chain strategy

### Recommended

Use **Arbitrum One as the only public chain for the Buildathon**. Use local tests and an Arbitrum One fork for verification, then deploy a tightly capped mainnet beta. This maximizes credibility and minimizes bridge, wallet, liquidity, and testing failure.

Do not add Robinhood Chain merely to chase a reserved prize. Robinhood Chain is built for tokenized real-world assets and has first-class account-abstraction support, but PayLock's first customer pays vendors in USDC from an Arbitrum treasury.[^30] A forced Stock Token or trading integration would weaken the problem and chain story.

The user-reported three-chain maximum could not be verified in public rules. Even if it exists in the portal, the correct answer is still one public chain: Arbitrum One.

Robinhood becomes legitimate later only if a Robinhood Chain treasury or RWA application asks PayLock to protect its own vendor or issuer payments. If that happens, use the approved term **Stock Tokens** and never describe them as tokenized stocks or tokenized equities.[^32]

## 11. Build and evidence plan

Assume September 30 is the internal deadline.

### Sep 14 to Sep 16: validate before hardening scope

- Apply to the Buildathon and Founder House.
- Interview at least five finance or treasury leads who pay recurring vendors in stablecoins.
- Ask them to show the current vendor-enrollment, wallet-change, approval, and Safe execution flow.
- Ask whether a spoofed invoice or compromised finance account could change the recipient.
- Ask whether Fireblocks, Safe policies, or their AP system already requires a supplier signature at contract execution.
- Secure two written pilot commitments from a buyer and one of its existing vendors.
- Present the thesis at Feedback Session 1.
- Kill PayLock if five target teams already have supplier co-signing and contract-enforced rotation controls.

### Sep 17 to Sep 20: contract and workflow spine

- Finalize the threat model and typed invoice schema.
- Implement the mandate registry, payment executor, nonce handling, limits, pause, and rotation cooldown.
- Integrate a Safe guard or document why a capped vault is the safer MVP.
- Add unit, fuzz, invariant, boundary, authorization, and failure-path tests.
- Complete local and Arbitrum One fork verification, then deploy the capped contracts to Arbitrum One.
- Complete enrollment, invoice signing, approval, direct payment, and rotation without OCR or agents.

### Sep 21 to Sep 24: invisible crypto UX

- Add the supplier passkey account and ERC-1271 verification.
- Add human-readable EIP-712 signing and sponsored gas where safe.
- Add out-of-band rotation notifications.
- Add invoice import only as a convenience layer, not core security.
- Demo one successful payment plus spoofed-payee and replay reverts at Feedback Session 2.

### Sep 25 to Sep 27: complete product loop

- Add delayed emergency exit and guard-removal visibility.
- Add buyer and supplier mandate history.
- Add payment and blocked-attempt receipts.
- Add event indexing and Dune dashboard.
- Run an internal adversarial review and all three attack demos.
- Freeze new features after Sep 27.

### Sep 28 to Sep 30: prove and submit

- Use Feedback Session 4 as the final judge rehearsal.
- Run one real, low-value Arbitrum One vendor payment if the contract review supports it.
- Cap the beta and clearly label it unaudited.
- Record a short product video and a separate technical walkthrough.
- Verify contracts, publish deployments, document limitations, and reconcile every claim.
- Submit by Sep 30.

### Oct 2 to Oct 22: earn Founder House before arriving

- Convert both design partners into recurring protected-payment pilots.
- Track active mandates, protected value, attempted violations, rotations, and repeat use.
- Start one Safe, wallet, custody, or accounts-payable integration conversation.
- Get one integration letter of intent.
- Scope one meaningful Founder House feature from observed use, not sponsor availability.

## 12. Metrics that judges and investors can believe

Do not lead with waitlist size. Lead with completed work.

| By Sep 30 | By Oct 22 |
|---|---:|
| 5 qualified treasury interviews by Sep 16 | 15 total interviews |
| 2 buyer-supplier pilot pairs | 3 active treasury pilots |
| 1 live low-value protected payment | 10 protected payments |
| 100 percent contract branch coverage target where practical | Repeat purchase from at least 2 buyers |
| 3 negative-path attack demos | Median mandate setup and payment times |
| 1 public activity dashboard | 1 wallet, Safe, custody, or AP integration LOI |

The strongest metric is repeat protected use by an unrelated buyer and supplier, not gross transaction value generated by the team itself. Separate organic activity from team-created test transactions.

## 13. Founder House and funding story

### Application paragraph

PayLock prevents supplier-payment substitution in self-custodied stablecoin treasuries. Singapore businesses lost S$35.3 million to business-email-compromise scams in 2025, often after a known supplier apparently changed payment details. PayLock binds an existing supplier, invoice, payout address, token, amount, nonce, expiry, and chain into a two-party mandate enforced by the treasury contract. A compromised email or AP frontend cannot redirect the transfer. We are validating it with crypto-native treasury teams and will demonstrate one real protected payment plus three blocked attacks on Arbitrum.

Replace future-tense claims with actual results before submission.

### Why this can be a venture-backed company

The company is not a Safe allowlist. It is the open supplier-mandate and enforcement layer:

- Bilateral, versioned payment instructions controlled by buyer and supplier.
- Invoice intents that are cryptographically bound to execution.
- Integrations that enforce the same mandate inside wallets, treasuries, and AP platforms.
- A portable history of rotations, payments, and attempted violations.
- Security analytics based on real mandate behavior, without pretending to verify legal identity.

Revenue can begin as a treasury subscription plus an integration fee. A usage fee may be tested later, but taking a percentage of payment volume adds commercial and regulatory questions without validating the first product.

The next product layer should be selected from real usage: vendor domain or vLEI credentials, accounting integrations, policy templates, higher-assurance onboarding, risk alerts, and recovery workflows. Do not expand into escrow, FX, lending, or disputes.

### Funding request logic

Kimia's funding page was unusually strong because every dollar mapped to five months of specific mainnet work.[^22] Use the same discipline:

- Contract audit and remediation.
- Three production pilots.
- Safe, wallet, custody, or AP integration.
- Higher-assurance supplier onboarding research.
- Mainnet caps increased only after security review.
- A measurable active-mandate, repeat-use, and protected-volume target.

## 14. Kill criteria

Kill or materially change PayLock if any two of these are true by September 17:

- Five qualified treasury teams say Safe, Fireblocks, or their current AP process already requires supplier co-signing and enforces address rotation onchain.
- Fewer than three target teams rank recipient substitution or wallet-change risk as a serious concern.
- No existing buyer and supplier pair will run a low-value pilot.
- Users refuse the initial enrollment ceremony or rotation cooldown.
- The protection can be bypassed by removing the guard or using a different treasury path without a visible delay.
- The team cannot explain the difference from Agent Guardian, Fireblocks, Request Finance, and Safe in one sentence each.
- The only valued feature is another approval dashboard.

If killed, pursue Trade Preflight only if three businesses provide real redacted document sets and a freight, accounting, or payment channel agrees to test it. Pursue Private Income Passport only if a verifier agrees to consume the credential. Do not fall back to inheritance, a generic agent wallet, or a generic escrow product.

## 15. Submission package

The live form asks for the frontend or demo, core contract addresses, factory or pool addresses where relevant, token addresses, event-period progress, and sponsor technology disclosure.[^1]

Ship this package:

- Public product URL.
- Buyer treasury and supplier test accounts.
- Verified Arbitrum deployment addresses.
- Repository with logical conventional commits from Sep 14 onward.
- `BUILT_DURING_OPEN_HOUSE.md` with before, during, and after boundaries.
- Architecture and trust-boundary diagram.
- Mandate, invoice, payment, rotation, and emergency-exit state diagrams.
- Unit, fuzz, invariant, and end-to-end test commands.
- Deployment records and explorer links.
- One happy-path video under three minutes.
- One technical walkthrough under seven minutes.
- A failure-path clip showing spoofed payee, replayed nonce, and premature rotation rejected.
- Security assumptions, beta caps, and unaudited warning.
- Dune dashboard with organic and team-generated activity separated.
- Two buyer-supplier pilot notes or permitted redacted confirmations.
- Founder House roadmap based on observed pilot needs.

Do not hide mocks. Label passkey, supplier-enrollment, notification, and mainnet boundaries explicitly.

## 16. Orbswap: what to carry forward

The local `/home/shreyas/code/Projects/Orbswap` repository is a separate Stellar and Soroban implementation of a polar-coordinate, multi-asset AMM. It was created after the Bengaluru event and is not the winning Orbital repository.

Transfer these strengths:

- Fixed-point discipline and clear invariants.
- Fuzzing and boundary tests.
- Deployment records.
- Visual explanations for difficult mechanisms.
- Honest separation of testnet and production status.
- Wallet, gas, and chain complexity hidden from users.

Do not transfer the AMM concept. Orbital already won the category, an Arbitrum Stylus Orbswap variant exists publicly, and another complex AMM would invite direct comparison without solving a new customer job.

## 17. Final decision rule

The product should pass this sentence without hand-waving:

> We talked to this exact buyer, watched this exact workflow fail, built the smallest shared financial state machine that fixes it on Arbitrum, and can show one real transaction plus the failure path.

If PayLock can produce that evidence, build it. If it cannot, do not rescue it with more protocols, chains, agents, or features.

## Sources

[^1]: [HackQuest: Arbitrum Open House Singapore Online Buildathon](https://www.hackquest.io/en/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)
[^2]: [Luma: Arbitrum Open House Singapore](https://luma.com/openhouse-singapore)
[^3]: [Arbitrum Foundation: $415K in Singapore prizes](https://blog.arbitrum.foundation/builders-block-023-415k-in-prizes-at-open-house-singapore-apply-now/)
[^4]: [Arbitrum Foundation: Robinhood Chain commits $1M across Open House](https://blog.arbitrum.foundation/builders-block-024-robinhood-chain-commits-1m-in-funding-to-open-house-arbos-elara-now-live/)
[^5]: [Singapore Buildathon terms](https://openhouse.arbitrum.io/singapore_version_open_house_buildathon_terms___conditions.pdf)
[^6]: [Arbitrum Foundation: Singapore applications open](https://blog.arbitrum.foundation/open-house-singapore-applications-are-now-open/)
[^7]: [Arbitrum: What winning Open House teams do differently](https://dev.to/arbitrum/what-winning-arbitrum-open-house-teams-do-differently-18f8)
[^8]: [Arbitrum Foundation: India and Bengaluru recap](https://blog.arbitrum.foundation/arbitrum-open-house-india-concludes-with-bengaluru-hacker-house-full-recap/)
[^9]: [Arbitrum Foundation Bengaluru winner release](https://www.prnewswire.com/in/news-releases/arbitrum-foundation-announces-winners-of-bengaluru-irl-hacker-house-302565059.html)
[^10]: [Arbitrum Foundation: NYC online winners](https://blog.arbitrum.foundation/open-house-nyc-buildathon-concludes-meet-the-winning-teams/)
[^11]: [Arbitrum Foundation: NYC Founder House winners](https://blog.arbitrum.foundation/nyc-founder-house-concludes-with-340k-in-awards-to-winning-teams/)
[^12]: [HackQuest: London Online Buildathon](https://www.hackquest.io/hackathons/Arbitrum-Open-House-London-Online-Buildathon)
[^13]: [Arbitrum Foundation: London Founder House winners](https://blog.arbitrum.foundation/top-founders-take-home-300k-at-london-founder-house/)
[^14]: [Bleap: $6M seed announcement](https://old.bleap.finance/blog/bleap-raises-6m-seed-round)
[^15]: [Spiko: $22M Series A announcement](https://www.spiko.io/blog/spiko-raises-22m-led-by-index-ventures)
[^16]: [Catena Labs funding announcement](https://catena.com/blog/announcing-catena-labs)
[^17]: [PayPal: Kite AI $18M Series A](https://newsroom.paypal-corp.com/2025-09-02-Kite-Raises-18M-in-Series-A-Funding-To-Enforce-Trust-in-the-Agentic-Web)
[^18]: [Colosseum: Accelerator Cohort 4](https://blog.colosseum.com/announcing-colosseums-accelerator-cohort-4/)
[^19]: [a16z crypto: Halliday investment](https://a16zcrypto.com/posts/article/investing-in-halliday-2/)
[^20]: [Animoca Brands: NUVA $5.2M seed](https://www.animocabrands.com/announcement/nuva-digital-raises-usd5200000-to-accelerate-development-of-web3-real-world-asset-platform-nuva)
[^21]: [KAST: $80M Series A announcement](https://www.prnewswire.com/news-releases/kast-raises-80-million-as-stablecoins-move-from-infrastructure-into-mainstream-financial-services-302708236.html)
[^22]: [MetaDAO: Kimia company and raise page](https://metadao.fi/companies/kimia)
[^23]: [Kimia: Product overview](https://www.kimia.live/about)
[^24]: [Arbitrum Foundation: First mentorship cohort results](https://blog.arbitrum.foundation/from-idea-to-raising-1m-in-eight-weeks-inside-arbitrums-first-mentorship-cohort/)
[^25]: [Asian Development Bank: 2025 Global Trade Finance Gap Survey release](https://www.adb.org/subjects/trade-and-supply-chain-finance)
[^26]: [Ethereum ERC-7878: Bequeathable Contracts](https://eips.ethereum.org/EIPS/eip-7878)
[^28]: [ZeroDev: Smart-account plugins](https://docs.zerodev.app/smart-accounts/use-plugins/overview)
[^29]: [Arbitrum Foundation: H1 2026 progress update](https://forum.arbitrum.foundation/t/the-arbitrum-foundation-h1-2026-progress-update/31378)
[^30]: [Robinhood Chain documentation](https://docs.robinhood.com/chain/)
[^32]: [Robinhood Chain terms: approved Stock Token terminology](https://docs.robinhood.com/chain/terms-of-service/)
[^33]: [Singapore ScamShield: 2025 Annual Scams and Cybercrime Brief](https://www.scamshield.gov.sg/files/Scams%20and%20Cybercrime%20Briefs/2025_annual_scams_and_cybercrime_brief.pdf)
[^34]: [Fireblocks: Whitelist external addresses](https://developers.fireblocks.com/docs/whitelist-addresses)
[^35]: [Request Finance: Verify a recipient wallet with a test payment](https://help.request.finance/en/articles/11425648-how-to-make-a-test-payment), [Request Finance: Approval policies](https://help.request.finance/en/articles/9825973-approval-policies-overview), and [Request Finance: Import bills](https://help.request.finance/en/articles/8580646-how-to-import-bills)
[^36]: [Safe: Smart Account Guards](https://docs.safe.global/advanced/smart-account-guards)
[^37]: [Kustodia: NYC Founder House submission](https://www.hackquest.io/projects/Arbitrum-Open-House-NYC-Founder-House-Kustodia) and [Kustodia agent tools](https://kustodia.app/ai-agents)
[^38]: [WTO: Standards Toolkit for Cross-Border Paperless Trade](https://www.wto.org/english/res_e/publications_e/standtoolkit22_e.htm), [IMDA: 2026 InvoiceNow expansion](https://www.imda.gov.sg/resources/press-releases-factsheets-and-speeches/factsheets/2026/committee-of-supply-2026), [IMDA: TradeTrust](https://www.imda.gov.sg/how-we-can-help/digital-utilities/tradetrust), [Tazapay: Escrow agreement scope](https://support.tazapay.com/what-is-covered-under-the-escrow-agreement-created-on-tazapay), and [DBS: Trusple](https://www.dbs.com.sg/sme/dbs-trusple)
[^39]: [Inheritor](https://www.inheritor.app/) and [AfterLife](https://github.com/Mrinmoy-programmer07/AfterLIfe)
[^40]: [Safe RecoveryHub](https://help.safe.global/articles/9622260218-account-recovery-with-saferecoveryhub), [RIP Wallet security and deployment status](https://ripwallet.app/security), [Heres](https://www.heresprotocol.com/), and [Casa inheritance](https://casa.io/inheritance)
[^41]: [Circle: Refund Protocol](https://www.circle.com/blog/refund-protocol-non-custodial-dispute-resolution-for-stablecoin-payments), [Base Commerce Payments](https://github.com/base/commerce-payments), [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183), and [ReineiraOS](https://www.hackquest.io/vi/projects/ReineiraOS)
[^42]: [Singapore Founder House terms](https://openhouse.arbitrum.io/irl_founder_house_singapore_terms___conditions.pdf)
[^43]: [Monetary Authority of Singapore: Payment-service licensing categories](https://ask.gov.sg/mas/questions/clx8ktis400bvryozwe0wzsg7)
