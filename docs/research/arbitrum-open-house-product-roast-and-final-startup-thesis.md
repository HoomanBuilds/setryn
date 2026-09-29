# Arbitrum Open House Singapore 2026: Product Roast and Final Startup Thesis

> Historical and superseded. InvariantRail failed the [commercial red team](./arbitrum-open-house-revenue-and-product-depth-red-team.md); the later FeeForward selection was reopened too. Use the [living ecosystem and protocol research](./arbitrum-open-house-ecosystem-protocol-search.md) for current decisions, not this historical thesis.

Research cutoff: September 14, 2026

Status: historical product critique, not current implementation instructions

## The decision in 60 seconds

Kill StateLatch. Kill generic protocol change management. Do not build another simulator, governance dashboard, agent wallet, payment wrapper, or AMM.

Proceed with a seven-day validation sprint for **InvariantRail**, a provisional working name for mandatory production release control for stablecoin, tokenized-asset, oracle, and risk-parameter changes on Arbitrum One.

> InvariantRail makes a privileged protocol change executable only when its exact payload, independent approvals, policy version, and final onchain state agree.

The initial customer has a dedicated Safe controlling high-consequence protocol settings. InvariantRail imports a Safe or Foundry change, converts it into a typed manifest, checks cross-field semantic rules, stress-tests it over selected Arbitrum One states, binds independent reviewer signatures to the exact Safe transaction, enforces the approval through a Safe Guard, executes the action and post-state assertions atomically, and produces a verifiable assurance receipt.

This is a conditional go, not a declaration that the startup is validated. The pain and security budget are real. Product-specific willingness to pay is not. The standalone company exists only if a protocol makes the gate mandatory and an outside party such as an auditor, insurer, allocator, or risk provider relies on its receipt.

The product choices are fixed for the event:

- One chain: Arbitrum One mainnet, chain ID 42161.
- Primary product: desktop-first responsive web application.
- Developer component: local Rust analysis engine and a small Foundry integration.
- Onchain components: a bounded Safe Guard, approval registry, and stateless post-state verifier written in Solidity.
- Demo: a team-owned Safe and oracle fixture with at most 30 USDC exposed and 5 USDC per attempt.
- No Android app, native iOS app, browser extension, testnet deployment, Robinhood Chain deployment, generic SDK, token, or multi-chain story.

`InvariantRail` passed exact quoted web, GitHub repository-name, and npm package searches better than `StateLatch` or `ChangeLatch`, but it has not received trademark, company-registry, domain, or legal clearance. ChangeLatch is already the name of a 2026 code-change product and must not be used.[^1]

## The one thing

The earlier thinking kept selecting an interesting mechanism before proving a control point. StateLatch had conditional submission, mutation analysis, final assertions, a runner, receipts, and an incident console, but no buyer had to use it. Aomi, Nava, Hypernative, Blockaid, Safe, Tenderly, and automation providers can absorb those features.

InvariantRail survives only by owning a required release gate:

> A protected Safe cannot execute a production admin change unless an exact, independently reviewed Change Pack is approved, and the complete action reverts unless the final protocol state satisfies that pack.

If the Safe can execute the same critical change through an ordinary path, the product has failed. If customers only value the report, the company has failed. If no external assurance consumer relies on the receipt, the moat has failed.

## 1. What the event is asking for now

The Online Buildathon is advertised as running from September 14 through October 4, 2026. The portal currently closes submissions on October 4 at 15:59 UTC, which is 23:59 Singapore time. The official Terms PDF instead sets the submission deadline at October 1 at 23:59 Singapore time, or 21:29 IST, and announces winners on October 4. Treat October 1 as binding, submit earlier, save screenshots of both sources, and ask the organizer to resolve the conflict. Founder House runs October 23 through October 25 in Singapore. The two applications are independent, while Buildathon winners receive a guaranteed Founder House spot.[^2][^3][^39]

The Online Buildathon lists 115,000 USDC:

| Bucket | First | Second | Third | Total |
|---|---:|---:|---:|---:|
| Overall Prize | $40,000 | $20,000 | $10,000 | $70,000 |
| Promising Products | $7,000 | $5,000 | $3,000 | $15,000 |
| Milestone grants | Case by case | Case by case | Case by case | $30,000 |

The official Terms describe a milestone payout for most awards: 25 percent after signing the grant agreement, 25 percent after a one-month check-in while building exclusively on an Arbitrum chain, and 50 percent after mainnet launch plus a mutually agreed KPI. The portal uses broader milestone language. Plan against the stricter Terms and confirm the Promising Products treatment with the organizer.[^39]

The portal says qualifying projects must deploy on an Arbitrum chain and evaluates smart-contract quality, product-market-fit and retention potential, innovation, and real problem solving. The Terms also score use of Arbitrum technology, potential impact, presentation quality, and novelty. Existing work requires more than trivial development during the event, so the new product needs a clean event-period history and a precise list of what was built. The submission asks for a live frontend or demo, contract addresses, factory or pool addresses when relevant, token addresses when relevant, the code produced during the event, and sponsor technology used.[^2][^39]

The official Founder House page is even clearer: it is curated for teams with an existing product, prototype, or business, and selection is based on product quality, execution potential, and ecosystem alignment. The point is meaningful product progress and validated direction, not a disposable weekend build.[^3]

There is no need to use three chains just because the interface may permit them. No accessible official rule states a three-chain maximum. Arbitrum One alone is an eligible production chain, and at least one Overall placement and one Promising Products placement are reserved for an Arbitrum project. Staying on one chain forfeits Robinhood-reserved prize paths, but it preserves product coherence, remains eligible for the Arbitrum-reserved placements, and honors the mainnet-only constraint.[^2][^39]

### What past winners actually teach

The remembered Bengaluru mathematics winner was **Orbital AMM**, not Orbswap. Orbital paired high-dimensional stablecoin math and a precision-heavy Stylus implementation with APIs, tests, deployed contracts, real liquidity and swap flows, and a visible product. It placed second online, improved, then won the Bengaluru Hacker House.[^4]

The lesson is not to copy its AMM. The local Orbswap work already proves this team can specify hard mathematical domains, implement fixed-point Rust, fuzz state transitions, differentially test models, and visualize real mechanics. Apply that discipline to semantic release invariants.

The 2026 NYC online winners were Tilt, Fangorn, and EqualFi. Founder House awards went to Kustodia, Laytus, EqualFi, Bond.Credit, and Tilt. London rewarded functioning RWA, risk, money movement, programmable equity, fixed-yield, and agent products. The recurring selection pattern is a clear user, a working end-to-end product, a credible Arbitrum reason, negative-path honesty, and evidence that the team will keep building. Arbitrum's own judging advice says evaluators inspect the repository and demo before the deck and expect a functional MVP, documentation, tests, and a real deployment.[^5][^6][^7][^40]

That pattern rules out a thin Safe plugin. The submission needs a complete workflow, a live Arbitrum One result, a hard technical core, and early customer evidence.

## 2. Brutal roast of the discarded products

### StateLatch

#### CRITICAL: it is already a market, not a white space

- Evidence: Aomi offers construction, fork simulation, policy controls, signing handoff, settlement, outcome verification, automation, CLI, MCP, API, and Arbitrum support. Nava Guardian checks actions against policy before funds move. Hypernative Transaction Guard and Blockaid Cosigner cover pre-sign simulation and policy enforcement. Tenderly models production state and invariants. Safe, custody systems, relayers, and keeper infrastructure own distribution.[^8][^9][^10][^11][^34]
- Why it matters: StateLatch's complete feature list is a combination of incumbent capabilities, not a unique control point.
- Fix: none. Do not rescue it with more screens, more agents, or an Android app.
- Effort: delete the thesis.

#### CRITICAL: the reference job was weak

- Evidence: a treasury rebalance already uses Safe approvals, `minOut`, deadlines, simulation, and transaction atomicity. State drift exists, but public evidence does not show it is a top-three pain for a broad automation buyer.
- Why it matters: an elegant failure mode cannot substitute for a frequent job and a budget owner.
- Fix: move to privileged protocol changes, where misconfiguration and compromised approvals have caused disclosed losses.
- Effort: full repositioning.

#### HIGH: activation was absurd

- Evidence: console, SDK, Docker runner, profile creation, Safe configuration, endpoint selection, and protocol adapters were required before first value.
- Why it matters: users would abandon the product before learning whether it catches anything.
- Fix: first value must be an unauthenticated Safe JSON check in under five minutes. Guard installation comes only after a useful shadow review.
- Effort: large.

#### HIGH: the moat was imaginary

- Evidence: conditional RPC envelopes are not authenticated by the raw transaction signature, exact state conditions go stale, accepted does not mean included, and postconditions are straightforward contract calls. Mutation results do not amount to formal verification.[^12]
- Why it matters: none of these primitives creates durable distribution or proprietary data by itself.
- Fix: the moat must come from required policy adoption, reviewed protocol packs, repeat usage, and external reliance on receipts.
- Effort: multi-year, if it works at all.

### Generic change control

#### CRITICAL: incumbents already own preflight

- Evidence: Tenderly simulates production changes and invariants; Agora decodes and simulates governor or timelock proposals; Forge Proposal Simulator creates calldata, runs full governance lifecycles on forks, and supports post-proposal validation; Certora Quorum compares payloads, reviewed repositories, descriptions, feeds, and listings; Aave Checkpoint now applies protocol knowledge and many specialized analyses to every Aave proposal.[^13][^14][^15][^16][^17]
- Why it matters: another attractive review report is not a company.
- Fix: consume these systems as evidence. Own mandatory execution control and a typed semantic policy for a narrow asset class.
- Effort: medium product integration, hard market development.

#### CRITICAL: atomic checks are a feature

- Evidence: a failing final call inside Safe MultiSend already rolls back its internal actions. Safe Guards can enforce pre-checks and post-checks. Phylax provides protocol-defined assertions at the block-building layer on supported networks.[^18][^19]
- Why it matters: generating a postcondition call is valuable but easily copied.
- Fix: bind the full release object to independent approvals and make an external institution consume the resulting assurance receipt.
- Effort: high.

#### HIGH: the integration can collapse into consulting

- Evidence: semantic rules differ across oracles, stablecoins, lending markets, vaults, and tokenized assets. Aave Checkpoint, Chaos Labs, LlamaRisk, and Certora derive power from protocol-specific knowledge, not a generic rules UI.[^17][^20][^21]
- Why it matters: if every customer needs weeks of custom modeling, margins, activation time, and repeatability die.
- Fix: start with six typed controls shared by stablecoin and tokenized-asset operators. Kill the product if two integrations each take more than one week.
- Effort: high.

#### HIGH: OpenZeppelin Defender is a warning, not a free market

- Evidence: Defender previously covered proposals, approvals, Safe and Fireblocks integrations, upgrades, relaying, monitoring, and audit evidence. The hosted service shut down on July 1, 2026, while Relayer and Monitor continued as open-source tools.[^22]
- Why it matters: a broad protocol-operations suite can be adopted and still fail as a durable hosted business.
- Fix: refuse the horizontal platform roadmap. Sell one mandatory control tied to measurable risk.
- Effort: strategic discipline.

## 3. The problem that survived

Privileged protocol changes combine three representations that are commonly reviewed in different places:

1. Human intent in a forum post, risk recommendation, audit handoff, or internal ticket.
2. Executable intent in Foundry code, Safe JSON, calldata, storage writes, and role operations.
3. Economic meaning in relationships among units, timestamps, ratios, caps, roles, implementations, reserves, and external feeds.

A normal simulation can show that the transaction succeeds and enumerate state changes. It does not automatically know that a ratio and timestamp must describe the same observation, that a feed is ETH-denominated rather than USD-denominated, or that a mint limit and reserve constraint have become jointly unsafe.

Recent primary-source incidents make the failure concrete:

| Incident | Disclosed effect | Configuration failure | What an enforced semantic pack could check |
|---|---|---|---|
| Aave wstETH CAPO, March 2026[^28] | About 10,938 wstETH liquidated across 34 accounts, about 512 ETH of bonuses and value, with a proposed net DAO cost of 357.56 ETH after recoveries | `snapshotRatio` and `snapshotTimestamp` advanced inconsistently, pushing the effective cap about 2.85 percent below the actual rate | Ratio and timestamp coherence, current-rate buffer, maximum effective-cap deviation |
| Moonwell cbETH, February 2026[^29] | 1,096.317 cbETH seized and $1,779,044.83 bad debt | Raw cbETH/ETH near 1.12 was configured as cbETH/USD instead of composing it with ETH/USD near $2,200 | Denomination, decimal scale, feed composition, output range |
| Radiant, October 2024[^30] | About $50 million lost across Arbitrum and BNB Chain | Compromised developer devices led Safe signers to approve malicious ownership and upgrade actions while the displayed task appeared legitimate | Exact payload binding, restricted implementations and roles, independent reviewer threshold, mandatory Guard |
| Morpho PAXG/USDC, October 2024[^31] | About $230,000 borrowed against roughly $350 of PAXG in the affected market | An incorrect oracle configuration was accepted | Decimal scale, reference-price deviation, source identity |

These examples support severity, not frequency. Aave's 2025 Chaos Labs renewal cited more than 1,100 parameter updates, yet severe disclosed configuration incidents are rare.[^20] No trustworthy public denominator exists for all privileged changes and near misses. That uncertainty is why interviews and historical payloads come before the full build.

## 4. The full product

### Product name and sentence

Working name: **InvariantRail**.

Category: production release control for onchain asset protocols.

One sentence:

> InvariantRail is the required check between a reviewed protocol change and its Arbitrum One execution.

Landing-page copy:

> Ship privileged protocol changes only when payload, policy, approvals, and final state agree.

Primary CTA: **Check a Safe change**.

### Exact initial market

Do not target every DAO.

- Initial company: an Arbitrum One stablecoin, tokenized-asset, lending, or structured-yield protocol with a dedicated production Safe.
- Hands-on user: protocol security engineer, release engineer, or risk operations engineer.
- Buyer: Head of Security, CTO, or Protocol Operations lead.
- Secondary buyer: risk service provider or auditor that authors and assumes reputational liability for the change.
- Required external consumer: auditor, insurer, institutional allocator, risk provider, or governance policy that relies on the receipt.
- Recurring job: ship a privileged production change without producing an unintended economic state, then prove exactly what was reviewed and executed.

The first supported changes are:

- Oracle source, units, freshness, ratio, and snapshot parameters.
- Supply, borrow, collateral, exposure, mint, burn, and redemption caps.
- Issuer, pauser, upgrader, owner, and risk-steward roles.
- Fee and rate-limit bounds.
- Proxy implementation code hashes.
- Backing and reserve constraints.

Do not support arbitrary governance proposals, treasury swaps, consumer transfers, or user-authored scripts during the event.

### Current workflow

1. A risk analyst or protocol engineer derives the intended values.
2. Another engineer converts them into a script or Safe transaction.
3. The team runs Foundry tests, a fork, Tenderly, or a bespoke simulator.
4. Reviewers compare prose, code, calldata, tables, and screenshots.
5. Safe owners sign.
6. An executor broadcasts.
7. The team monitors execution and assembles evidence after the fact.

InvariantRail does not replace Tenderly, Foundry, Certora, Chaos Labs, or the risk analyst. It converts their outputs into one enforceable release object.

### Complete customer journey

#### 1. First value without signup

The user uploads a Safe Transaction Builder JSON, a Foundry broadcast artifact, or pasted calldata. Within five minutes the web app returns:

- Decoded ordered calls.
- Targets, selectors, values, roles, implementations, and relevant parameters touched.
- A human-readable intended-state diff.
- Unit and decimal interpretations.
- Suggested policy template.
- Unsupported behavior and trust assumptions.

No wallet connection is required for this shadow review.

#### 2. Create the Change Pack

The operator selects an approved policy version and supplies the reviewed source commit or governance reference. The system constructs a canonical Change Pack containing:

- Chain ID 42161.
- Dedicated Safe address and nonce.
- Ordered call bundle and Safe transaction hash.
- Human intent digest and source commit.
- Policy version and invariant definitions.
- Reference contracts and code hashes.
- Selected fork blocks and state assumptions.
- Reviewer set and approval threshold.
- Deadline and emergency classification.

Every field is deterministically encoded and content addressed.

#### 3. Semantic analysis

The Rust engine evaluates a bounded policy rather than pretending to understand every protocol. Event predicates include:

- `CODEHASH_EQ(address, hash)`
- `ROLE_EQ(contract, role, account)`
- `UINT_BETWEEN(target, getter, min, max)`
- `ORACLE_FRESH(target, getter, maxAge)`
- `RATIO_TIME_COHERENT(oracle, rateProvider, maxDeviation)`
- `BACKING_GTE_SUPPLY(reserve, token, buffer)`

Only AND composition is supported. Values have explicit units, scaling, rounding, domains, and failure behavior. Unsupported dynamic calls fail closed.

The analysis runs on the current pinned Arbitrum One state plus selected historical or adversarial states. Boundary generation changes correlated values, decimals, timestamps, roles, call order, omitted calls, and implementation hashes. The product shows exactly which layer caught each mutation.

This is not formal verification. It is deterministic policy evaluation and adversarial transition testing.

#### 4. Independent review

Reviewers inspect the decoded diff, exact Safe hash, policy, state assumptions, stress matrix, margins, external reports, and limitations. They sign the canonical Change Pack locally with EIP-712. InvariantRail never receives a Safe owner key or reviewer private key.

For the event, two team-controlled reviewer wallets demonstrate the mechanism and are labeled as demo identities. A real pilot must use at least one independent reviewer.

#### 5. Mandatory execution gate

The customer's dedicated admin Safe installs `AssuranceGuard`. Every transaction from that Safe must reference a Change Pack whose exact Safe transaction hash has the required reviewer approvals. The Guard rejects:

- Unapproved transactions.
- Expired packs.
- Wrong Safe or nonce.
- Altered calldata or call order.
- Missing final verifier call.
- Unsafe delegatecall paths.
- Attempts to remove or bypass the Guard without the separately defined recovery process.

The event Safe has no enabled modules. Production module compatibility is out of event scope and must be threat-modeled before any pilot.

#### 6. Atomic execution

The approved Safe transaction uses `MultiSendCallOnly`:

1. Execute the intended privileged changes.
2. Call `PostStateVerifier` with the approved predicates.
3. Record the successful pack hash.

If any final predicate fails, the MultiSend operation fails and every internal action rolls back. The outer Safe transaction can still have a successful EVM receipt while Safe emits `ExecutionFailure`; the product must interpret Safe events and final state, not the outer status alone.

Immediately before broadcast, the executor replays the exact signed transaction and may submit it with Arbitrum One's conditional RPC to reject known-stale pre-state. Conditional submission is an extra operational layer. It is not signed policy, a consensus guarantee, or a substitute for the atomic verifier.[^12]

#### 7. Assurance receipt

A successful release has a public or access-controlled receipt with:

- Change Pack hash.
- Safe transaction hash, Safe, and nonce.
- Decoded actions and intended diff.
- Policy version and final predicate values.
- Reviewer addresses and EIP-712 signatures.
- Fork blocks and stress results.
- External simulation or proof links.
- Arbitrum One transaction and verified contract links.
- Guard decision and verifier event.
- Final state read directly from Arbitrum One.

Only signatures, contract state, events, and the chain transaction are immutable. Database history must never be called immutable proof.

The repeat loop is the next change against the saved, reviewed protocol policy.

## 5. Why blockchain and why only Arbitrum One

Most of the analysis could be ordinary CI. The chain is necessary for the final property: the exact approved action and its final safety checks are one atomic privileged operation. If a post-state assertion fails, the state transition must not remain partially applied.

Arbitrum One is the right initial chain for four concrete reasons:

1. The user required production mainnet only, and Arbitrum One qualifies directly.
2. Arbitrum reports 478 million transactions in the first half of 2026, more than $70 billion in average monthly stablecoin transfer volume, and leadership in tokenized real-world-asset deployments. That creates a concentrated initial buyer set for asset-control infrastructure.[^23]
3. AIP-2 exposes conditional transaction submission for a useful last-mile stale-state gate, subject to important limitations.[^12]
4. The event and ecosystem explicitly prioritize programmable finance, stablecoins, tokenization, DeFi infrastructure, and security-ready production teams.[^2][^3][^24]

Do not add chains for prize optimization. Do not claim that the eventual company can never expand. The first twelve months remain Arbitrum One-focused so the team can build useful policy depth and local design-partner relationships instead of shallow adapters.

## 6. Platform decision

Build a desktop-first responsive web app. Do not build Android.

The primary user compares calldata, protocol state, policy versions, signatures, traces, and historical results. Their normal environment is a desktop browser, terminal, Git repository, and Safe. A native phone application would add installation, signing, release, device, and testing failure modes without improving the job.

The four event screens are:

1. **Changes**: draft, checking, awaiting review, approved, executing, rejected, failed, or verified.
2. **Composer**: import the artifact, decode calls, inspect semantic diff, and select the oracle update template.
3. **Invariant Lab**: current and historical runs, boundary mutation matrix, exact margins, enforcement layer, and unsupported behavior.
4. **Review and Receipt**: local review signatures, Safe approvals, execute action, live status, and final public evidence.

The event product has no workspace administration suite, billing UI, notification center, generic policy builder, agent chat, token dashboard, native mobile shell, or fake analytics.

## 7. Technical architecture

```text
Safe JSON or Foundry artifact
  -> web importer and decoder
  -> typed Change Manifest
  -> Rust policy and mutation engine
  -> pinned Arbitrum One fork states
  -> canonical Change Pack
  -> independent EIP-712 review signatures
  -> approval registry
  -> Safe owner signatures
  -> conditional executor
  -> Arbitrum One admin Safe
       AssuranceGuard
       MultiSendCallOnly
         privileged update calls
         PostStateVerifier
         successful pack record
  -> receipt indexer
  -> assurance receipt
```

### Onchain contracts

`AssuranceGuard`

- Implements the pinned Safe Guard interface.
- Applies to a dedicated Safe with no modules in the event scope.
- Rejects a Safe transaction unless its hash, nonce, deadline, pack hash, reviewer threshold, and final verifier requirement match the approval registry.
- Rejects unauthorized Guard removal and unsafe transaction forms.
- Holds no funds.
- Has a separately specified, timelocked recovery procedure.

`ApprovalRegistry`

- Verifies bounded EIP-712 Change Pack approvals.
- Stores the approved pack digest, Safe transaction hash, expiry, and reviewer threshold.
- Prevents replay across chain, Safe, nonce, or policy version.
- Does not store private artifacts or keys.

`PostStateVerifier`

- Immutable and non-upgradeable for the event.
- Stateless apart from emitted evidence.
- Uses bounded target calls, return sizes, gas, predicate count, and arithmetic.
- Supports at most eight predicates per release.
- Holds no funds and has no withdrawal path.
- Reverts on unsupported or malformed return data.

`DemoCappedOracle` and `DemoAssetController`

- Team-owned fixtures deployed only for the mainnet demonstration.
- No public deposits or third-party capital.
- Model a correlated ratio and timestamp plus a small capped USDC position.
- Exist to prove the control, not to impersonate Aave or claim a production integration.

### Offchain product

- Next.js web application and small API.
- Viem and Safe Protocol Kit for exact transaction construction and signatures.
- Foundry and Anvil for pinned Arbitrum One forks.
- Rust reference evaluator, canonical encoder, boundary generator, and differential-test harness.
- Receipt database and Arbitrum event indexer.
- Narrow executor restricted to one approved Safe transaction hash during the event.

Rust is used where this team has a real advantage: deterministic arithmetic, explicit domains, mutation generation, fuzzing, and differential evaluation. The security boundary remains small Solidity contracts because forcing Stylus into a Safe Guard merely for sponsor theater adds risk. Technical depth is measured by correctness, not language count.

### Core data objects

- `ChangeManifest`
- `PolicyVersion`
- `InvariantPredicate`
- `ForkScenario`
- `MutationCase`
- `ChangePack`
- `ReviewApproval`
- `SafeApproval`
- `ExecutionAttempt`
- `AssuranceReceipt`

### Security boundaries

- Never accept a seed phrase or Safe owner private key.
- Never relay arbitrary calls.
- Never permit user-supplied delegatecall.
- Pin the Safe, Guard, MultiSendCallOnly, and verifier code hashes.
- Cap all arrays, external calls, return data, and gas forwarding.
- Bind chain ID, Safe, nonce, calldata hash, policy version, deadline, and reviewer set.
- Treat external simulation results as evidence, not authority.
- Treat conditional RPC acceptance as non-final.
- Fail closed on unknown ABI, proxy, feed denomination, decimals, units, or unsupported control flow.
- Test Safe `ExecutionFailure`, replacement, dropped transaction, expiry, and reorganization paths.
- Publish limitations and a threat model before the demo.

## 8. The event vertical slice

### The proof

Deploy a team-owned Arbitrum One oracle and asset controller governed by a fresh dedicated Safe.

The oracle stores a reference ratio and observation timestamp. A cap calculation advances through time. Updating only the timestamp or pairing it with an old ratio produces a value that remains individually well typed and inside naive bounds but violates the correlated economic policy. This mirrors the class of cross-field failure disclosed in the 2026 Aave postmortem without copying Aave code or touching Aave assets.

Demonstrate three transactions:

1. **Bypass attempt**: the Safe tries a direct privileged update without an approved pack. `AssuranceGuard` rejects it.
2. **Approved but unsafe attempt**: reviewers sign the exact bad payload. The privileged calls begin, the final correlated-state assertion fails, and the complete Safe batch rolls back.
3. **Valid release**: ratio and timestamp are updated coherently, all final assertions pass, the mainnet transaction succeeds, and the assurance receipt shows the exact final state.

The second case proves why approval alone is not correctness. The first proves why a report alone is not enforcement. The third proves the actual product.

### Mainnet limits

- Arbitrum One only.
- Fresh team-controlled Safe.
- Fresh team-owned fixture contracts.
- Native Arbitrum USDC only if value is required.
- 30 USDC maximum total exposure.
- 5 USDC maximum per attempt.
- No public deposits.
- No third-party protocol calls that can move user funds.
- No automatic retry.
- Gas-only executor key with a fixed allowlist.
- Verified source and reproducible deployments.

### Ninety-second video

- 0 to 8 seconds: "InvariantRail is the required release check for privileged Arbitrum protocol changes."
- 8 to 23 seconds: import a Safe oracle update and show the decoded ratio and timestamp change.
- 23 to 38 seconds: show the historical and boundary matrix revealing the correlated-state failure that a successful transaction simulation misses.
- 38 to 50 seconds: try the same critical update without a reviewed pack and show Guard rejection.
- 50 to 66 seconds: execute the signed unsafe pack and show atomic rollback at the post-state check.
- 66 to 82 seconds: execute the corrected pack on Arbitrum One and show the confirmed Safe and verifier result.
- 82 to 90 seconds: open the assurance receipt and show the Rust versus Solidity differential-test count plus the design-partner status.

Do not tour settings or narrate architecture for a minute. The judge should remember one thing: an approved change can still be wrong, and this product makes wrong final state non-executable.

## 9. Build plan from September 14 to October 1

### September 14 to 20: validate or kill

- Interview ten operators, including five who execute Arbitrum One privileged changes.
- Target BGD Labs, LlamaRisk, Chaos Labs, GMX contributors, and Dolomite contributors first.[^25][^26]
- Obtain two real historical payloads for confidential shadow analysis.
- Get two concrete near misses or failures that current tools did not catch.
- Secure one paid pilot or procurement-backed letter worth at least $5,000.
- Prove a Safe Guard can reject the unapproved path.
- Prove the exact update plus final assertion rolls back as one Safe operation.
- Probe the actual conditional endpoint behavior with a capped, team-owned transaction.

If the customer, payload, external-consumer, or mandatory-enforcement gates fail, stop. Do not hide behind the hackathon deadline.

### September 21 to 23: freeze the security core

- Freeze the one oracle-update template and six predicate semantics.
- Implement canonical Change Pack hashing and EIP-712 approvals.
- Implement and unit-test the registry, Guard, verifier, and fixtures.
- Pin Safe and MultiSendCallOnly behavior.
- Document recovery and module exclusions.

### September 24 to 26: build the hard engine

- Implement the deterministic Rust evaluator.
- Generate correlated boundary cases and call-order mutations.
- Differentially test Rust and Solidity results.
- Add fuzz, replay, malformed-return, overflow, empty-input, threshold, expiry, replay, and failure-path tests.
- Emit machine-readable evidence consumed by the web application.

### September 27 to 29: complete the web product

- Safe JSON and Foundry artifact import.
- Semantic diff and policy selection.
- Invariant Lab matrix and margins.
- Reviewer signing and Safe transaction construction.
- Execution status and receipt.

### September 30: mainnet proof

- Deploy verified contracts to Arbitrum One.
- Execute the bypass, unsafe, and valid cases under the published caps.
- Test with three external users.
- Obtain one independent contract review.
- Publish addresses, deployment inputs, transaction links, and limitations.

### October 1: submission freeze

- Submit before the stricter Terms deadline of 23:59 Singapore time.
- Record primary and backup demo videos.
- Freeze contract and evidence schemas.
- Fix only submission-blocking issues.

### October 2 to 4: emergency-only buffer

- Do not assume the portal's later date overrides the Terms.
- Use this period only for organizer-confirmed corrections, hosting continuity, and judging support.
- Do not introduce new contracts, predicates, screens, or integrations.

## 10. Competition and exact non-overlap

| Product | What it already owns | InvariantRail must not claim | Surviving non-overlap |
|---|---|---|---|
| Tenderly | Production-state simulation, historical replay, invariants, shared evidence | Better generic simulation | Required semantic policy bound to actual Safe execution |
| Agora and Tally | Governance UX, proposal creation, decoding, simulation, public review | Better governance frontend | Independent release control for dedicated protocol admin Safes |
| Forge Proposal Simulator | Calldata generation, full fork lifecycle, post-state tests, CI | Novel proposal testing | Import its artifacts and enforce reviewed output at production execution |
| Certora Quorum and Prover | Payload and source comparison, formal specifications, reports | Formal verification | Normalize external proof evidence into a mandatory Change Pack and final gate |
| Aave Checkpoint | Deep protocol-specific semantic review and human sign-off for Aave | A better Aave review system | Productize bounded controls for smaller Arbitrum asset protocols and enforce final state |
| Safe and Zodiac | Signing, batching, roles, modules, Guards, policy conditions | A new smart-account primitive | Reviewed policy packs, cross-field economic semantics, and external assurance receipts |
| Phylax | Continuous block-builder assertions on supported networks | First runtime assertion system | Proposal-local enforcement on Arbitrum One without sequencer integration |
| Chaos Labs, Gauntlet, LlamaRisk | Parameter recommendation, economic models, monitoring, risk automation | Better risk judgment | Make their reviewed recommendation the exact, enforced release artifact |
| Hypernative and Blockaid | Monitoring, transaction simulation, policies, intervention | Complete protocol security | The typed release object and atomic final semantic state |
| OpenZeppelin Relayer and Monitor | Reliable submission and monitoring | Generic operations suite | Integrate them later; do not rebuild them |

The defensible boundary is small. A competitor can reproduce the cryptography and batch structure. The company moat must become:

1. Reviewed policy packs accepted by auditors and protocols.
2. A standard assurance receipt consumed by external risk decisions.
3. Historical release and incident data that improves boundary scenarios.
4. Deep Arbitrum protocol integrations and repeat workflows.
5. Governance or institutional policy that makes the gate required.

Without points 1, 2, and 5, this is an open-source Safe feature.

## 11. What recent funding actually says

The funding scan does not say "add AI" or copy a recently financed protocol. It says investors and ecosystems pay for a sharp control point, proprietary operational depth, and a credible path to production.

| Product | Public funding signal | Lesson for this project |
|---|---:|---|
| Kimia Protocol | Asked to retain $60,000 while about $727,000 was committed through a 2026 futarchy raise | The attraction is a concrete economic machine: its own perpetual market creates funding cash flow, then PT, YT, and an AMM make that rate tradable. Copy the mechanism clarity and capital discipline, not the Solana perp product.[^33] |
| Nava | $8.3 million seed | Agent policy, audit trails, and payment control already have credible capital. This helped kill StateLatch rather than validate it.[^9] |
| Blockaid | $50 million Series B in 2025 | Broad transaction protection requires major distribution. Do not attack it with a thin pre-sign product.[^34] |
| Hypernative | $40 million Series B in 2025 | Monitoring, simulation, and intervention already occupy the protocol security budget. InvariantRail must become a required release control, not another alert.[^35] |
| Phylax | $4.5 million pre-seed | Runtime assertions are a financed category and a direct conceptual competitor. Arbitrum One proposal-local enforcement is the narrow opening.[^36] |
| Chaos Labs | $55 million Series A | Economic-security companies build defensibility through models, protocol data, and embedded workflows. A generic predicate UI cannot compete.[^37] |
| Turnkey | $12.5 million strategic investment in 2026 | Verifiable infrastructure can attract capital when it owns a sensitive execution boundary and already sits in customer workflows.[^38] |

The consistent implication is harsh: the onchain verifier is not the company. Required workflow adoption and accumulated policy knowledge are the company.

## 12. Business model, funding, and distribution

### Willingness-to-pay evidence

The category has money. Aave's 2025 Chaos Labs renewal requested $3 million for a year and cited more than 1,100 parameter updates. Aave's 2026 discussion says Aave Labs supported a $5 million renewal, while Chaos Labs estimated $8 million was required for the expanded risk scope. Arbitrum's security program reports 367 applications, 18 completed audits, 385 vulnerabilities including 13 critical and 40 high, and average audit cost above $50,000.[^20][^24][^32]

That does not prove anyone will pay InvariantRail. It proves protocols pay for risk, audit, and operational security. The product must win a distinct mandatory-control budget.

Pricing tests:

- Paid design pilot: $5,000 for one protocol pack, two shadow reviews, and one protected mainnet release.
- Protocol plan: $25,000 to $60,000 annually for one dedicated Safe, reviewed policy versions, protected changes, receipts, and support.
- Higher assurance: $60,000 to $100,000 annually for multiple Safes, self-hosted execution, custom retention, and auditor workflow.

These are hypotheses derived from adjacent public security budgets, including a $60,000 Hypernative package discussed by Balancer. They are not traction.[^27]

### Distribution

1. Offer a free forensic replay of a target protocol's last five privileged changes.
2. Convert the replay into a paid, concierge design pilot.
3. Partner with auditors and risk providers so a reviewed policy pack is delivered at audit or recommendation handoff.
4. Ask an allocator or insurer to consume the assurance receipt before claiming compliance value.
5. Publish specific incident-class replays and false-positive data, not generic security content.
6. Add a Safe App only after three protocols repeat the workflow.
7. Apply to relevant Arbitrum security and audit support only with a working pilot, clear milestones, and no claim that grant interest equals demand.[^24]

### Twelve-month roadmap

Months 1 to 3:

- Three Arbitrum design partners.
- One paid pilot and one external assurance consumer.
- Independent audit of the Guard and verifier.
- Oracle, role, cap, and proxy implementation policy packs.
- Under 15 minutes from artifact import to review-ready Change Pack.

Months 4 to 6:

- Five teams execute a second protected change.
- Foundry pull-request checks and Safe App beta.
- Timelock execution support.
- Auditor pack-authoring workflow.
- Self-hosted executor.

Months 7 to 9:

- Stablecoin backing, mint-limit, and redemption policy packs.
- Tokenized-asset issuance and role templates.
- Drift monitoring against the last successful pack.
- Evidence API for allocators, insurers, and governance interfaces.

Months 10 to 12:

- Twenty paying Arbitrum teams or kill the standalone-company thesis.
- Annual contracts and measured renewal intent.
- Public methodology for false positives, unsupported states, and reliability.
- Formal review of canonical encoding and predicate semantics.

## 13. Hard kill gates

### Seven-day market gate

Kill the startup thesis if any of these fail:

- Ten operator interviews, including five current Arbitrum One privileged-change operators.
- At least three targets make a material change monthly or more often.
- Two targets provide a real historical artifact.
- Two targets identify a near miss or gap not caught by current tools.
- One budget owner signs a paid pilot or procurement-backed letter worth at least $5,000.
- One external assurance consumer agrees to inspect and give actionable feedback on a receipt.

### Forty-eight-hour technical gate

Kill or reshape if any of these fail:

- A dedicated Safe Guard blocks the unapproved transaction path.
- The Guard cannot prevent ordinary Safe quorum from bypassing policy through the supported path.
- A bad privileged update plus post-state check does not roll back completely.
- Safe success and failure cannot be interpreted deterministically.
- Canonical Change Pack encoding differs between Rust, TypeScript, and Solidity.
- The required conditional RPC behavior is unavailable or adds no measurable value. In that case remove it from the demo, not from the atomic thesis.

### Product gate after the event

Kill the company or release it as open source if any two occur:

- Four of five targets consider Tenderly, FPS, Safe, and manual review sufficient.
- No protocol will make the gate mandatory.
- No auditor, insurer, allocator, or risk provider will consume the receipt.
- Two integrations each need more than one week of bespoke rule engineering.
- Fewer than three of five pilots execute a second protected change within 90 days.
- No buyer accepts at least $25,000 annual pricing.
- Users value only the report rather than the binding and enforcement.
- Safe, Certora, Agora, or another incumbent ships and distributes the same required workflow before InvariantRail establishes reliance.

## 14. What is actually good

- The problem has primary-source incidents with clear technical mechanisms and severe consequences.
- The product uses the team's demonstrated strengths in Rust, invariant specification, boundary analysis, fuzzing, and differential testing without copying Orbital or Orbswap.
- The event proof is visual and falsifiable: bypass rejected, bad approved change rolled back, valid change confirmed.
- Arbitrum One is functional to the product rather than a logo on a generic app.
- The product complements established simulators and risk providers instead of claiming to replace their expertise.
- A complete web workflow exists around the contracts, so this is not a patch or a contract demo.
- The negative case is honest: without mandatory adoption and external reliance, it is not a venture-scale company.

## 15. Immediate next actions

1. Use the first 48 hours for the Guard, atomic rollback, Safe failure-semantics, and conditional-endpoint proofs.
2. Run ten interviews in parallel with the technical spike. Ask for actual artifacts, not opinions about the pitch.
3. Get an auditor or risk provider to critique one proposed policy pack.
4. Freeze the initial template to the correlated oracle ratio and timestamp update.
5. Use `InvariantRail` only as a working name until proper clearance.
6. Do not start the frontend beyond the artifact-import skeleton until the mandatory path works.
7. Do not count hackathon acceptance, grants, interviews, compliments, or demo transactions as traction.
8. Apply to Founder House as soon as the 48-hour gate produces a real prototype. Do not wait for Buildathon results because applications are separate and rolling.

### Founder House application position

Do not claim that this research memo is a product. Submit after the Guard and atomic rollback proof exists.

- Present InvariantRail as the current company and the 48-hour proof as the existing prototype.
- Present Orbswap only as evidence that the team can ship difficult Rust, math, invariant tests, mainnet deployment pipelines, and a polished web product.
- Name the exact user, cross-field oracle failure, dedicated-Safe constraint, and Arbitrum One deployment.
- Report design-partner conversations and paid-pilot status exactly, including zero if no one has committed yet.
- State that the Founder House feature will be the first independently reviewed protocol policy pack plus the Safe App beta, not a vague multi-chain expansion.
- Offer a one-month KPI of two real historical payload reviews, one paid pilot, one outside receipt reviewer, and a published false-positive report.

## Sources

[^1]: [ChangeLatch, existing 2026 developer product](https://www.thinkitdoneapp.com/)
[^2]: [HackQuest, Arbitrum Open House Singapore Online Buildathon](https://arbitrum-singapore.hackquest.io/buildathons/Arbitrum-Open-House-Singapore-Online-Buildathon)
[^3]: [Luma, Arbitrum Open House Singapore and Founder House](https://luma.com/openhouse-singapore)
[^4]: [Arbitrum Foundation, India and Bengaluru recap](https://blog.arbitrum.foundation/arbitrum-open-house-india-concludes-with-bengaluru-hacker-house-full-recap/)
[^5]: [Arbitrum Foundation, NYC Online Buildathon winners](https://blog.arbitrum.foundation/open-house-nyc-buildathon-concludes-meet-the-winning-teams/)
[^6]: [Arbitrum Foundation, NYC Founder House winners](https://blog.arbitrum.foundation/nyc-founder-house-concludes-with-340k-in-awards-to-winning-teams/)
[^7]: [Arbitrum Foundation, London Founder House winners](https://blog.arbitrum.foundation/top-founders-take-home-300k-at-london-founder-house/)
[^8]: [Aomi, execution infrastructure for autonomous finance](https://aomi.dev/)
[^9]: [Nava, infrastructure for the agent economy](https://navalabs.ai/)
[^10]: [Hypernative, Transaction Guard](https://www.hypernative.io/product/transaction-guard)
[^11]: [Tenderly, simulation infrastructure for onchain operations](https://tenderly.co/)
[^12]: [ERC-7796, conditional transaction submission](https://eips.ethereum.org/EIPS/eip-7796) and [AIP-2, Arbitrum conditional endpoint](https://forum.arbitrum.foundation/t/aip-2-activate-support-for-account-abstraction-endpoint-on-one-and-nova/14790)
[^13]: [Agora, transaction verification](https://docs.agora.xyz/agora-app-tx-verification)
[^14]: [Solidity Labs, Forge Proposal Simulator](https://docs.soliditylabs.io/forge-proposal-simulator/overview/use-cases/)
[^15]: [Certora, Quorum](https://github.com/Certora/Quorum)
[^16]: [Tenderly, Virtual Environments](https://docs.tenderly.co/virtual-environments/overview)
[^17]: [Aave governance, introducing Aave Checkpoint](https://governance.aave.com/t/introducing-aave-checkpoint/24457)
[^18]: [Safe documentation, smart account Guards](https://docs.safe.global/advanced/smart-account-guards)
[^19]: [Phylax, Credible Layer overview](https://docs.phylax.systems/credible/credible-layer-overview)
[^20]: [Aave governance, Chaos Labs 2025 renewal](https://governance.aave.com/t/chaos-labs-x-aave-dao-early-renewal-proposal/22346)
[^21]: [LlamaRisk, LlamaGuard](https://dashboard.llamarisk.com/products/actions/pt)
[^22]: [OpenZeppelin, Defender sunset FAQ](https://www.openzeppelin.com/news/defender-sunset-faq) and [OpenZeppelin Defender documentation](https://docs.openzeppelin.com/defender)
[^23]: [Arbitrum Foundation, H1 2026 progress](https://blog.arbitrum.foundation/arbitrum-foundation-reports-first-half-2026-progress-update/)
[^24]: [Arbitrum governance, Arbitrum Security Program](https://forum.arbitrum.foundation/t/arbitrum-security-program/31207)
[^25]: [LlamaRisk, Aave risk-management continuity](https://governance.aave.com/t/llamarisk-ensuring-continuity-of-aaves-risk-management/24397)
[^26]: [GMX governance, Chaos Labs risk-oracle implementation](https://gov.gmx.io/t/implementation-of-chaos-labs-risk-oracles/3861) and [Dolomite, administrator privileges](https://docs.dolomite.io/admin-privileges)
[^27]: [Balancer governance, Hypernative security program budget](https://forum.balancer.fi/t/bip-545-funding-hypernative-security-program-for-balancer/5542)
[^28]: [Aave governance, wstETH CAPO incident](https://governance.aave.com/t/post-mortem-exchange-rate-misallignment-on-wsteth-core-and-prime-instances/24269) and [reimbursement proposal](https://governance.aave.com/t/direct-to-aip-wsteth-capo-oracle-incident-user-reimbursement/24275)
[^29]: [Moonwell governance, cbETH oracle incident](https://forum.moonwell.fi/t/mip-x43-cbeth-oracle-incident-summary/2068)
[^30]: [Radiant Capital, October 2024 postmortem](https://medium.com/@RadiantCapital/radiant-post-mortem-fecd6cd38081)
[^31]: [Morpho governance, PAXG/USDC oracle retrospective](https://forum.morpho.org/t/retrospective-paxg-usdc-market-oracle-configuration/891)
[^32]: [Aave governance, Chaos Labs departure and stated budget requirements](https://governance.aave.com/t/chaos-labs-is-leaving-aave/24386)
[^33]: [Kimia Protocol, product and raise summary](https://kimia.live/) and [MetaDAO, Kimia raise](https://metadao.fi/companies/kimia)
[^34]: [Blockaid, Series B announcement](https://blockaid.io/blog/behind-blockaids-series-b-securing-an-onchain-future)
[^35]: [Hypernative, Series B announcement](https://www.hypernative.io/insights/blog/hypernative-raises-40m-series-b-to-remove-security-barriers-to-web3-mass-adoption)
[^36]: [Phylax, pre-seed announcement](https://phylax.systems/blog/phylax-systems-raises-a-4-5mm-pre-seed-to-back-credible-security/)
[^37]: [Chaos Labs, Series A announcement](https://www.prnewswire.com/news-releases/chaos-labs-announces-55m-series-a-funding-round-led-by-haun-ventures-to-scale-onchain-economic-security-302223616.html)
[^38]: [Turnkey, 2026 strategic investment](https://www.turnkey.com/blog/turnkey-strategic-investment-crypto-verifiable-compute)
[^39]: [Official Singapore Buildathon Terms and Conditions](https://openhouse.arbitrum.io/singapore_version_open_house_buildathon_terms___conditions.pdf)
[^40]: [Arbitrum, what winning Open House teams do differently](https://dev.to/arbitrum/what-winning-arbitrum-open-house-teams-do-differently-18f8)
