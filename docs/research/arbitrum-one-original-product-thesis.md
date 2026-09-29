# Arbitrum One Original Product Thesis

> Historical and superseded, including the later FeeForward selection. Use the [living ecosystem and protocol research](./arbitrum-open-house-ecosystem-protocol-search.md) for current decisions. This file is historical candidate research, not implementation instructions.

Research cutoff: September 14, 2026

This file remains a historical mechanism and candidate research record.

## Decision

Start with a 48-hour technical spike for **CausalShield**, a working name for an intent firewall that protects unattended Arbitrum One transactions from simulation-to-inclusion state drift.

Do not commit the full event to it merely because the idea sounds difficult. It earns the build only if a real conditional transaction is mined through a public Arbitrum One endpoint and causal dependency minimization materially outperforms a raw simulation read set without admitting an unsafe state change.

The irreversible build order is:

1. CausalShield, if every technical and customer gate passes.
2. ProofBond, if CausalShield fails and a real deterministic API provider agrees to bond.
3. PayLock, if both infrastructure theses fail or a real buyer and supplier commit to a capped mainnet pilot.
4. Reopen discovery if none earns implementation. Do not rescue a failed thesis by adding chains, agents, tokens, or features.

Every public deployment, judged transaction, contract address, activity metric, and pilot in this plan uses **Arbitrum One mainnet**. Local tests and an Arbitrum One fork are verification tools only. There is no Sepolia deployment and no multi-chain narrative.

## What original means

The strategy is not to copy a successful product from another chain and change its RPC URL.

The acceptable transfer pattern is:

1. Find a mechanism that works in another technical or financial system.
2. Identify an Arbitrum-specific failure that the mechanism does not already solve.
3. Re-design the mechanism around Arbitrum One's state, users, liquidity, or execution features.
4. Prove a new invariant on mainnet.
5. Build distribution and proprietary operational data around the invariant.

Examples:

- Babylon's objective double-sign evidence inspires ProofBond, but ProofBond does not reproduce Bitcoin staking.
- UK and EU beneficiary checks inspire PayLock, but PayLock is not a bank-name lookup or a Fireblocks clone.
- Program slicing and mutation analysis inspire CausalShield, but the product is built around Arbitrum conditional transaction admission and smart-account postconditions.
- Cosmos Hydro and Berachain incentive markets inspire OutcomeBond, but the proposed product adds performance bonding and retained-use settlement rather than copying token voting.

## Anti-slop gate

A candidate is rejected if any of these is true:

- Its contract can be replaced by a database plus a token-transfer button.
- The chain only stores a hash, timestamp, badge, or status that the application itself decides.
- The difficult work is hidden behind a trusted administrator, model, or oracle while the contract only pays.
- It is a dashboard, aggregator, wrapper, marketplace, ordinary vault, simple escrow, or generic agent wallet without a new enforceable invariant.
- Its Arbitrum story would be identical on every EVM chain.
- The demo only shows a happy path.
- Complexity comes from integrating many sponsors rather than solving the failure.
- The public mainnet deployment would be irresponsible without pretending that a testnet is traction.

A survivor needs all of:

- A precise user who loses money or operational reliability today.
- An onchain invariant that changes what an account or counterparty is allowed to do.
- At least one adversarial failure path visible in the demo.
- A bounded Arbitrum One deployment safe enough for the event window.
- A narrow difference from the closest incumbent.
- A post-event company moat beyond the contract.

## Ranked convergence

Scores are research judgments before empirical validation.

| Rank | Candidate | Technical core | Originality | Customer pain | Mainnet safety | Judge demo | Company path | Decision |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | CausalShield | 9.0 | 9.0 | 7.0 | 9.0 | 10.0 | 8.0 | Run 48-hour spike |
| 2 | ProofBond | 8.0 | 9.0 | 5.0 | 10.0 | 9.0 | 6.0 | Build only with provider and buyer evidence |
| 3 | PayLock | 8.5 | 7.0 | 9.3 | 7.8 | 9.5 | 8.6 | Commercial fallback with real pilot |
| 4 | MPP Session and Conformance | 8.0 | 5.5 | 7.0 | 8.0 | 8.0 | 7.0 | Too close to current implementations |
| 5 | OutcomeBond | 8.5 | 7.5 | 7.0 | 4.5 | 4.5 | 6.5 | Incubate after event |

The top rank is conditional. CausalShield becomes a no-go immediately if its empirical claims fail.

## 1. CausalShield

### Product thesis

**CausalShield is an intent firewall for unattended Arbitrum transactions. An agent states the outcome it will accept. CausalShield discovers the smallest observed set of state dependencies capable of violating that outcome, submits those dependencies as conditional transaction constraints, and enforces final postconditions inside the smart account.**

The first user is a wallet, keeper, trading agent, treasury agent, or automated DeFi operator that simulates a transaction and broadcasts it later. The failure is state drift between simulation and execution. A quote, oracle, pool, debt position, proxy, allowance, or nonce can change before inclusion.

Normal simulation does not close that gap. Alchemy explicitly warns that chain state can change between simulation and actual execution. [Alchemy simulation documentation](https://www.alchemy.com/docs/transaction-simulation)

Arbitrum's finalized [AIP-2](https://forum.arbitrum.foundation/t/aip-2-activate-support-for-account-abstraction-endpoint-on-one-and-nova/14790) activated the conditional transaction endpoint on Arbitrum One. [EIP-7796](https://eips.ethereum.org/EIPS/eip-7796) specifies account, storage, block, and time conditions and also states that successful submission does not guarantee inclusion. Admission-time conditions and execution-time postconditions therefore solve different parts of the problem.

### Why this is Arbitrum-native

The product depends on Arbitrum One's conditional transaction path. A public RPC probe on September 14 recognized `eth_sendRawTransactionConditional`, although recognition alone does not prove that ordinary signed transactions are accepted and mined reliably.

Verderer already simulates transactions, derives `knownAccounts` from the observed read set, and submits conditional bundles on Robinhood Chain. It also acknowledges that state can still move between conditional admission and execution. [Verderer bundle documentation](https://verder.tech/bundles)

The defensible difference is narrow:

> CausalShield minimizes a raw simulation read set to outcome-critical dependencies, then combines admission-time conditions with execution-time outcome enforcement for unattended Arbitrum One transactions.

If the product merely locks every read slot, it is a Verderer-style port. If it merely checks minimum output inside a transaction, it is an ordinary executor. Both layers and the measured minimization benefit are mandatory.

### Hard technical engine

The engine has six stages:

1. **Intent schema:** The user specifies permitted recipients and assets, minimum output, maximum input or debt increase, minimum health factor, fee ceiling, expiry, and nonce policy.
2. **Trace collection:** Simulate the signed call against an Arbitrum One fork and collect storage, balance, code, nonce, external-call, and return-value dependencies.
3. **Candidate grouping:** Group correlated slots and dynamic storage accesses so the analyzer does not assume every slot is independent.
4. **Mutation analysis:** Perturb individual and grouped dependencies, replay the transaction, and retain dependencies whose mutation can violate an explicit outcome.
5. **Conditional admission:** Encode the retained conditions for `eth_sendRawTransactionConditional` using the public specification supported by the endpoint.
6. **Execution enforcement:** Execute through a small immutable smart-account module that checks the final outcome atomically before accepting the transaction result.

This is dynamic analysis, not a formal proof of causality. Never claim that the set is provably minimal or complete. Dynamic storage, nonlinear branches, proxies, external calls, correlated variables, rebasing assets, and malicious contracts can hide dependencies.

### Exact mainnet demonstration

Use a team-controlled account with no more than 50 USDC exposure.

1. Deploy a fixture that reads 40 storage slots but uses only five to determine the declared output.
2. Produce the raw simulation read set and the minimized condition set.
3. Change an irrelevant slot.
4. Show that raw read-set conditioning rejects while CausalShield still admits the transaction.
5. Change an outcome-critical slot.
6. Show that conditional admission rejects before execution.
7. Show the execution-time postcondition rejecting an unsafe change that occurs outside the admission snapshot.
8. Execute one real, tightly capped Arbitrum One swap-like or lending action.
9. Publish a signed receipt binding intent, transaction hash, simulation block, conditional set, postconditions, and result.

The visual story is strong: forty observed reads become five critical conditions, an irrelevant change is tolerated, and a dangerous change is blocked.

### 48-hour kill gate

#### Hours 0 to 4

- Freeze the intent schema and one controlled fixture.
- Set a fixed ETH gas budget for all experiments.
- Do no frontend, brand, landing page, token, or general contract work.

#### Hours 4 to 16

- Submit at least five valid signed conditional transactions through a public Arbitrum One endpoint.
- Prove that a critical mutation rejects.
- Prove that an irrelevant mutation passes after minimization.
- Prove that the same irrelevant mutation rejects under the raw read-set method.
- Reproduce the result across five submissions.

Hard failure: method recognition without a mined transaction does not pass.

#### Hours 4 to 24

Interview five wallet, keeper, bundler, or agent developers. At least three must identify stale-state execution, wasted gas, bundler exposure, or excessive conditional rejection as a current problem. At least one must agree to test an SDK.

#### Hours 16 to 32

- Analyze the fixture, one swap-like route, and one collateral-sensitive route.
- Reduce the conditioned set by at least 30 percent on two of the three routes.
- Run at least 10,000 individual and correlated mutations.
- Admit zero mutations that violate a declared invariant.
- Compare with execution postconditions alone.

Hard failure: if postconditions provide equivalent protection and failed execution cost is immaterial to the user, the company thesis fails.

#### Hours 32 to 48

- Produce a 60-second ugly demo.
- Show it to three technical outsiders without an explanation.
- Require them to identify the protected user, the unsafe state change, and why this is not merely a simulator.
- Freeze the build decision.

### Mainnet safety boundary

- Team-controlled smart account only.
- Maximum 50 USDC exposure.
- Immutable minimal executor.
- No proxy, delegatecall, public deposits, token issuance, or arbitrary external call surface.
- One fixture and one capped live workflow.
- A failure in the analyzer must fail closed or fall back to explicit postconditions.
- Local and fork tests cover proxy upgrades, nonce races, deadline expiry, reorganization, correlated mutations, slot overflow, RPC disagreement, oracle changes, fee-on-transfer tokens, rebasing tokens, and hidden dynamic dependencies.

### Company path

The company is not a transaction simulator. It is the execution policy compiler between autonomous wallets and Arbitrum protocols.

The moat can become:

- A historical trace and adversarial mutation corpus.
- Protocol-specific semantic maps and invariant libraries.
- False-rejection measurements across real transaction classes.
- Wallet, bundler, keeper, and agent-framework integrations.
- Multi-RPC conditional relay reliability.
- Signed execution-intent receipts and incident data.
- Formal-analysis upgrades for high-value paths.

The revenue model is an SDK and hosted relay subscription priced by protected transaction volume or service tier, not a new token.

### Claims that are forbidden

- Provably minimal dependencies.
- Complete MEV protection.
- Guaranteed inclusion.
- Protection from every malicious contract.
- First conditional transaction system.
- First simulation-derived state lock.

## 2. ProofBond

### Transferable mechanism

Babylon's EOTS system turns signing two conflicting blocks at the same height into compact, objectively attributable slashing evidence. [Babylon EOTS architecture](https://docs.babylonlabs.io/guides/overview/babylon_genesis/architecture/btc_staking_program/eots_manager/)

ProofBond transfers that design principle into deterministic paid services. It does not reproduce Bitcoin staking and does not claim to prove an API result true.

### Product thesis

**ProofBond is a bonded consistency layer for deterministic financial APIs consumed by autonomous agents. A provider signs every canonical result. Two contradictory signatures for the same committed request scope form an objective fault proof that slashes the provider's Arbitrum One bond.**

The first endpoint should be a pure deterministic risk decision over a committed Arbitrum state snapshot, such as whether a token or vault satisfies a fixed policy. Do not start with generative AI, subjective research, inventory-sensitive quotes, or nondeterministic models.

### Receipt scope

The signed EIP-712 envelope must bind:

- Provider and signing-key validity range.
- Request domain and canonical request hash.
- Arbitrum block hash, not only block number.
- Schema and canonical serialization version.
- Engine or policy version.
- Relevant input-data commitment.
- Result hash.
- Expiry and receipt nonce.
- Chain ID 42161 and verifying contract.

Two receipts are slashable only when every equivalence field matches and the result hash differs.

### Why it is not an existing product

- Arbitrum's x402 and MPP work settles paid requests but does not secure the returned result. [Arbitrum x402 and MPP announcement](https://blog.arbitrum.io/x402-and-mpp-for-agentic-finance-on-arbitrum/)
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) provides agent identity, reputation, and validation hooks but leaves incentives and slashing to specialized systems.
- API3 signs first-party data but is an oracle-feed system, not a generic paid-service equivocation bond. [API3 documentation](https://docs.api3.org/oev/in-depth/data-feeds/)
- EigenLayer provides general stake-backed slashing, while EigenAI goes further toward deterministic request and output validation. ProofBond must remain a lightweight endpoint-level consistency primitive rather than claim a new general verification network.

The current Singapore gallery is already crowded with agent identity, permissions, evidence, and verification products. ProofBond only survives because the fault is objective and economically enforced.

### Mainnet proof

- One deterministic x402 or MPP endpoint.
- One team-controlled provider.
- 30 USDC maximum bond.
- 10 USDC maximum slash.
- 48-hour exit challenge delay.
- One watcher bounty per equivalence key.
- No public capital, truth claims, arbitration, proxy, token, arbitrary calls, or non-delivery disputes.
- Show identical honest receipts, two deliberately conflicting receipts, a single successful slash, duplicate-proof rejection, and an exit blocked by a valid pending proof.

### Kill gate

Build ProofBond only if:

- One independent deterministic API provider agrees to integrate and bond.
- Two consuming teams confirm that harmful equivocation matters to their workflow.
- The provider and buyer approve one complete equivalence specification.
- One thousand replayed canonical requests produce zero legitimate divergence.
- Receipt gossip or a watcher can discover a targeted conflict.
- The bond exceeds the maximum value the provider can gain from the pilot equivocation.

If a provider can make every response unique with a nonce, timestamp, inventory field, or uncommitted model version, kill the endpoint. Do not mutate ProofBond into a reputation dashboard or truth oracle.

### Company path

The moat is the library of canonical service schemas, agent-runtime integrations, receipt-gossip network, watcher infrastructure, bond history, incident data, and eventually risk pricing. The hard commercial problem is convincing providers to accept capital-backed liability before enough buyers demand it.

## 3. PayLock

### Transferable mechanism

PayLock takes its strongest product insight from mature banking safety systems, not from another Arbitrum hackathon winner.

UK Confirmation of Payee checks the supplied account name and details when a new payee is created or amended. More than 140 banks, building societies, and payment providers offer it. [Pay.UK Confirmation of Payee](https://www.wearepay.uk/what-we-do/overlay-services/confirmation-of-payee/faqs/)

The EU now requires payee verification for euro instant payments to help prevent mistakes and scams. [European Commission instant-payment rules](https://finance.ec.europa.eu/news/new-eu-rules-make-instant-euro-payments-faster-and-safer-2025-10-10_en)

Singapore recorded 377 business-email-compromise cases and S$35.3 million lost in 2025. A documented pattern was a known supplier apparently changing its payment details. [Singapore 2025 scams and cybercrime brief](https://www.scamshield.gov.sg/files/Scams%20and%20Cybercrime%20Briefs/2025_annual_scams_and_cybercrime_brief.pdf)

The new product is not a name-matching service. Self-custodied wallets have no bank that owns the recipient directory. PayLock makes the buyer and established supplier jointly control the payment mandate.

### Product thesis

**A stablecoin payment leaves the buyer's dedicated Safe only when the buyer and established supplier signed the same invoice, amount, and payout mandate. An address rotation requires both sides and a cooldown.**

The hard components are:

- Supplier-signed EIP-712 invoice intent.
- Buyer Safe approval.
- Exact binding of Safe, supplier, recipient, native USDC, amount, invoice hash, nonce, expiry, mandate epoch, chain ID, and verifying contract.
- Bilateral payout rotation with a cooldown.
- Replay prevention and rolling caps.
- A Safe module and Guard that prevent direct transfer, approval, batching, alternate-module, delegatecall, Guard-removal, or emergency-exit bypass.
- ERC-1271 supplier smart-account support.

Fireblocks already provides wallet whitelisting and internal approval policy. Request Finance already provides bill workflows, approval rules, and recipient confirmation. Safe already provides Guards, modules, and spending limits. PayLock survives only because the supplier participates cryptographically at execution.

### Mainnet proof

- A fresh dedicated Safe with 20 to 50 USDC maximum lifetime exposure.
- One buyer and one established supplier.
- Native Arbitrum One USDC only.
- One valid 1 USDC invoice payment.
- Modified recipient, amount, token, nonce replay, premature rotation, direct Safe call, module call, batch, delegatecall, Guard removal, and emergency bypass tests.
- No existing production treasury, public deposits, escrow, FX, cross-chain action, or general agent execution.

### Kill gate

PayLock earns the build only if:

- Three of five treasury operators rank recipient substitution as serious.
- One real buyer and existing supplier commit to the capped mainnet pilot.
- Their current process does not bind the supplier signature to execution.
- The supplier accepts per-invoice signing and the rotation ceremony.
- No alternate treasury path bypasses the mandate.

Without supplier signatures, bilateral rotation, and non-bypassable treasury enforcement, PayLock is a registry plus a transfer and must be rejected.

## Cross-ecosystem transfer matrix

| Source mechanism | Arbitrum-native thesis | Result |
|---|---|---|
| Program slicing and state mutation analysis plus Arbitrum conditional transactions | CausalShield | First build spike |
| Babylon objective equivocation slashing | ProofBond | Strong fallback with PMF gate |
| Banking Confirmation of Payee and beneficiary-change controls | PayLock | Commercial fallback with pilot gate |
| Solana payment channels and Stellar MPP sessions | Production Arbitrum MPP session | Technically real, but MegaETH, Execution Market, KiroPay, and the developing Arbitrum MPP path create close collision |
| Bitcoin Liana timelocked recovery | Monotonically degrading agent Safe authority | Useful security module, but Zodiac and Safe recovery make the gap narrow |
| Cosmos Hydro and Berachain incentive auctions | OutcomeBond performance-bonded growth capital | Strong Arbitrum alignment, but retained-use attribution cannot be proven honestly in 17 days |
| Solana CrowdBrain demand-funded field data | FieldProof | Rejected because the contract cannot prove data quality without unavailable device and validation infrastructure |
| Celestia data availability and retrievability distinction | Continuity Bond for dApp recovery packages | Rejected because storage and retrieval incumbents already cover most demand |
| Solana attn revenue tokenization and Huma receivable financing | StreamFactor API revenue advance | Rejected because it is close to existing revenue financing and Arbitrum agent credit work |
| Namada or Penumbra privacy | Private payroll or sealed treasury swaps | Rejected because RAILGUN and CoW already cover the central mechanisms, and a new value-holding privacy pool is unsafe in 17 days |
| Solana Actions and Blinks | Arbitrum action cards | Rejected as a client standard without wallet distribution, not a standalone company |
| Solana and TON consumer miniapps | Generic mobile crypto application | Rejected because a mobile shell is distribution, not a product invariant |

## Why the other sophisticated ideas lost

### OutcomeBond

Cosmos Hydro lets projects offer tribute and compete for protocol-owned liquidity. [Hydro documentation](https://hydro.cosmos.network/docs) Berachain similarly lets protocols offer incentives for emissions. [Berachain incentive marketplace](https://docs.berachain.com/general/proof-of-liquidity/incentives)

Arbitrum has a real incentive-accountability problem. Its STIP required self-reporting, dashboards, and streamed funding, while current tooling such as Karma, Thrive, Hedgey, and Merkl already covers grant tracking, human milestone review, streaming, and campaign distribution.

Performance bonding is the novel component, but a grantee can sybil wallets, wash volume, subsidize fees, or choose favorable cohort definitions. A committee-signed KPI would reduce the idea to existing grant administration with a bond attached. A genuine retained-use proof needs an indexer, precommitted cohort, attribution design, challenge system, and a time window longer than the event.

### MPP session channels

The hard version uses a capped USDC channel, cumulative EIP-712 vouchers, newest-state challenges, crash-safe provider persistence, settlement, expiry, and unused-fund recovery. It could run hundreds of paid calls with one open and one close.

It is not original enough for the first choice. Solana has audited payment channels, Stellar MPP documents session channels, MegaETH has an EVM MPP session demo, Execution Market exposes metered sessions on Arbitrum, and KiroPay describes Arbitrum support. The defensible work is conformance and crash consistency, which is better packaged as a security contribution than a category-leading company.

### Fixed-price gas

The technical version uses an ERC-4337 paymaster, provider capital, fixed USDC capacity, selector and target policy, actual-cost accounting in `postOp`, delayed withdrawal, and solvency invariants.

The economics are weak. Full collateralization makes it prepaid gas credits with extra contracts. Partial collateralization sells unhedged gas insurance to buyers who participate when the quote is underpriced. Alchemy and existing paymaster programs already offer policy limits and predictable budgets. Arbitrum also advertises dynamic pricing as improving cost predictability.

### FieldProof

Mobile data capture, buyer funding, encrypted media, consent hashes, curator approval, and USDC payout look impressive but fail the anti-slop test. The buyer still trusts the application and curators for every fact that matters. The chain proves neither location, consent, novelty, nor data quality.

## Day-one execution

Do not build three projects. Run one controlled selection sprint.

### Track A: CausalShield technical proof

- One engineer owns the conditional RPC and mainnet fixture.
- One engineer owns tracing, mutation, and dependency reduction.
- One engineer owns postcondition executor and adversarial cases.
- One person interviews wallet, keeper, bundler, and agent teams.

### Track B: customer falsification

Run the CausalShield, ProofBond, and PayLock interviews in parallel because customer calls do not require three codebases.

The questions must request evidence:

- Show the last stale-state, failed-transaction, inconsistent-service, or payout-change incident.
- Show the current workaround and its cost.
- Identify who owns the budget.
- Ask for an integration artifact, deterministic endpoint, or real supplier pair.
- Ask what would make the product unacceptable.

Friendly statements such as "cool idea" do not count.

### Selection at hour 48

Select CausalShield only if every mining, minimization, safety, problem, and design-partner threshold passes.

Otherwise select ProofBond only if the endpoint is deterministic, replay tests show no legitimate divergence, and one provider plus one consuming team commit.

Otherwise select PayLock only with a real buyer-supplier pair and no bypass in the dedicated treasury.

If none passes, stop. The research has done its job by preventing a polished but unneeded build.

## Final position

CausalShield is the best answer to the clarified goal because it is not an imported application, it uses an underused Arbitrum One execution capability, its core is genuinely difficult, and the demo exposes the mechanism rather than hiding it behind a frontend.

Its uncertainty is also the reason for the 48-hour gate. A hard idea that does not work is still slop. The team should earn complexity with measured protection, not perform complexity for judges.
