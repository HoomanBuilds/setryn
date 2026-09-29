# Arbitrum Open House Singapore 2026: Full Product Decision

> Historical and superseded. StateLatch failed the direct competitor and company-boundary review; the later FeeForward selection was reopened too. Use the [living ecosystem and protocol research](./arbitrum-open-house-ecosystem-protocol-search.md) for current decisions and caveats, not the implementation scope below.

Research cutoff: September 14, 2026

Status: historical product brief, not current implementation instructions

## The decision

Build **StateLatch**, a working name for the protected execution runtime for autonomous finance on Arbitrum One.

> StateLatch converts every automated transaction into a declared outcome, a state-sensitive inclusion plan, atomic final assertions, and a deterministic replan signal when reality changes.

The product is not a transaction simulator, a conditional-RPC wrapper, a Safe module, a generic agent wallet, or a dashboard. Its recurring job is to operate the complete protected-run lifecycle for teams whose bots, keepers, agents, or treasury automations move funds without a human inspecting every transaction:

1. A customer defines the financial outcome and operational limits they will accept.
2. StateLatch simulates the complete action against current Arbitrum One state.
3. It identifies the observed state dependencies that can change the declared outcome.
4. It creates atomic final assertions and an Arbitrum conditional-submission plan.
5. The customer signs and submits from a local runner that StateLatch cannot control.
6. StateLatch distinguishes acceptance, rejection, inclusion, revert, expiry, and reorganization.
7. A failed or stale run returns a machine-readable replan signal and a human-readable incident record.
8. A successful run creates an independently inspectable receipt tied to the Arbitrum One transaction.

The product surface is fixed:

- **Primary application:** desktop-first responsive web console.
- **Execution component:** customer-controlled TypeScript/Node runner distributed as a Docker image and CLI.
- **Integration surface:** TypeScript SDK for existing automations.
- **Onchain component:** small immutable `OutcomeVerifier` contract on Arbitrum One.
- **Public surface:** browser-based receipt and Attack Lab pages.
- **Mobile:** responsive read-only monitoring only. No native Android app, iOS app, browser extension, consumer wallet, or event-specific mobile build.

Every public contract and real transaction will use **Arbitrum One mainnet, chain ID 42161**. Local development and Arbitrum One forks are allowed for testing. There will be no Sepolia deployment, Robinhood Chain deployment, custom chain, or multi-chain pitch.

The working name passed a basic exact-name web search, but this is not legal, trademark, company-registry, package-registry, or domain clearance. Clear the final name before launch.

## Why the earlier answer was incomplete

The earlier CausalShield recommendation described a hard technical mechanism and a 48-hour spike. It did not decide the complete product, customer journey, interface, operating model, or company boundary. It therefore read like an infrastructure patch.

StateLatch keeps the original technical insight only because it can anchor a larger repeat-use product. The event build is a complete vertical slice of that product, not the entire eventual enterprise feature list. A user must be able to onboard, configure a protected workflow, run it, see both successful and adversarial outcomes, investigate a rejection, and integrate the replan signal without leaving the product.

The rename also avoids collision with an existing organization using CausalShield in AI governance.[^1]

## 1. What the hackathon is actually asking for

The online Buildathon runs from September 14 to October 4, 2026. Founder House runs from October 23 to October 25 in Singapore. The online portal lists 115,000 USDC across overall prizes, Promising Products, and discretionary grants. The Founder House application advertises another 300,000 USDC in prizes and grants.[^2][^3]

The Buildathon is broad. Teams may build DeFi, gaming, social, DePIN, or something new, using Solidity or Rust/Stylus. Existing projects and new projects are accepted. Deployment to an Arbitrum chain is mandatory.[^2]

The four published Singapore criteria are:

1. Smart-contract quality.
2. Product-market-fit and retention potential.
3. Innovation and creativity.
4. Solving a genuine market problem.[^2]

Arbitrum's official winner guidance adds useful operational detail. Judges inspect the repository and demo before the pitch deck. They expect a functional MVP, maintainable code, documentation, tests, a real deployment, a clear user, and evidence that the team will continue. The same guidance explicitly includes developer tooling and infrastructure among strong Arbitrum categories.[^4]

The submission form asks for a frontend or demo URL, core contract addresses, relevant factory/pool/token addresses or `N/A`, the code produced during the Buildathon, and sponsor technologies used. The Founder House application is separate, rolling, curated, and based on product quality, execution potential, and Arbitrum alignment.[^2][^3]

This leads to four non-negotiable conclusions:

- A contract and README are not a product.
- A pitch deck cannot compensate for a weak live flow.
- Native mobile earns no explicit judging credit.
- A complete browser demo plus a deep onchain engine is the highest-leverage package for this user.

No accessible official source states that teams may select at most three chains. That does not matter for this plan because StateLatch intentionally uses one chain.

## 2. Why web, not Android

### Final platform decision

Build a **desktop-first responsive web application**, a **local Docker runner**, and a **TypeScript SDK**. Do not build a native Android application.

This is a user decision, not merely a schedule compromise. The initial user is an automation engineer or onchain operations lead working with backend jobs, Safe transactions, RPC endpoints, traces, incidents, and deployment configuration. Their high-frequency environment is a terminal plus a desktop operations console. Moving transaction construction or keys to a phone would make the product less credible.

The event evidence agrees:

- The submission requires an accessible frontend or demo URL.[^2]
- Judges open the demo and repository first.[^4]
- The current Singapore gallery is dominated by web stacks and did not identify a native Android or iOS entry when reviewed on September 14.[^5]
- Previous technical winners paired hard protocol work with an instantly inspectable browser surface.[^6]
- Native app distribution adds installation, signing, device, release, and store-review failure modes without strengthening the onchain invariant.

Mobile support means a responsive run-status and incident view that an executive can open from an alert. It does not mean mobile signing, an installable offline PWA, or a consumer wallet.

### Exact surfaces

| Surface | Primary user | Job | Event status |
|---|---|---|---|
| Web console | Automation engineer, security lead, operations lead | Configure profiles, inspect runs, investigate incidents, export receipts | Full |
| TypeScript SDK | Automation developer | Wrap an existing job with protected-run semantics | Full |
| Local runner and CLI | Customer infrastructure | Build, sign, submit, monitor, and replan without giving StateLatch keys | Full |
| `OutcomeVerifier` | Safe or smart-account transaction | Atomically reject an unacceptable final state | Full |
| Public receipt | Judge, auditor, customer | Verify what was declared and what settled | Full |
| Responsive status view | Executive or on-call engineer | Read status and incident summary on a phone | Full |
| Native Android/iOS | No initial user | None that the web and local runner cannot serve better | Rejected |

## 3. The exact initial customer

### User

The hands-on user is an **automation engineer at an Arbitrum-native protocol, DAO treasury, vault operator, market maker, keeper network, or agent company** that controls its own job runner.

The buyer is the Head of Engineering, Head of Security, or Onchain Operations Lead. The budget comes from security engineering, trading infrastructure, or protocol operations.

The first reference workflow is an automated Safe treasury rebalance on Arbitrum One. StateLatch does not choose the trade. It protects the action produced by the customer's existing strategy.

### Current workflow

Today the team typically:

1. Builds an action from a strategy.
2. Simulates it against current state.
3. Gets the necessary signature or Safe approvals.
4. Broadcasts seconds or minutes later.
5. Discovers after submission that an oracle, pool, position, proxy, balance, nonce, or allowance changed.
6. Spends gas on a revert, executes inside a still-valid but economically unacceptable envelope, or leaves the automation stuck without a consistent replan path.
7. Reconstructs the incident from separate RPC logs, simulation output, Safe data, and transaction traces.

Simulation providers correctly help a team understand a proposed transaction, but simulation alone does not bind the later chain state. Tenderly now markets production-state modeling and operational simulation, while Blockaid Cosigner simulates transactions and enforces organization policies before signing.[^7][^8] Those products validate the buyer and budget. They also make it fatal to pitch StateLatch as another simulator.

### The specific pain

StateLatch owns the gap between **simulation**, **sequencer admission**, **actual execution outcome**, and **automation recovery**.

The user promise is:

> An automation should not execute a transaction it would no longer choose, and it should always know whether to complete, stop, or replan.

The first willingness-to-pay hypothesis is 2,000 to 10,000 USD per month for teams with frequent unattended transactions and meaningful capital exposure. This is a research inference, not a measured price. It must be validated before being shown as traction.

## 4. Why blockchain and why Arbitrum One

### The enforceable invariant

For an activated protection profile, an action may complete only if:

- It targets an allowed contract and selector.
- It spends no more than the declared maximum.
- It sends assets only to allowed recipients.
- The final received balance or position is at least the declared minimum.
- The final debt, allowance, fee, or risk metric remains within the declared bound.
- The account nonce, code identity, and validity window are acceptable.
- Every in-transaction assertion passes atomically.

If a final assertion fails, the entire Safe batch reverts. A database cannot provide that atomic property over an onchain transaction.

### The Arbitrum-specific mechanism

Arbitrum One activated `eth_sendRawTransactionConditional` through AIP-2. The endpoint lets a sender provide exact storage, balance, nonce, code, block, and timestamp conditions that the sequencer should check before accepting the transaction.[^9][^10]

AIP-2 also describes a backwards-looking state-age check intended to reduce denial-of-service abuse. This can make rapidly changing pool or oracle slots poor conditions even when they are economically relevant.[^9] The event proof must measure this behavior rather than assume the current ERC-7796 text and Arbitrum's deployed implementation match perfectly. StateLatch needs versioned encoding, endpoint capability detection, and a refusal path when a critical dependency cannot produce a usable condition.

StateLatch uses this in two distinct layers:

1. **Pre-inclusion state conditions** reduce known-stale submissions and expose why an action must be replanned.
2. **Atomic postconditions** enforce the final financial outcome inside the transaction even if relevant state changes after admission.

These layers are not interchangeable. ERC-7796 explicitly says RPC acceptance does not guarantee inclusion and exact conditions can become stale. It also supports exact slot values rather than inequalities.[^10]

### Critical honesty boundary

The raw signed transaction and condition object are separate RPC parameters. The transaction signature does not inherently authenticate the condition object.[^10] An untrusted hosted intermediary could therefore strip the conditions and submit the raw transaction normally. This is an inference from the standard's message structure.

The product design responds directly:

- Signed transactions never pass through a StateLatch hosted relay in the event product.
- The customer-controlled runner submits directly to the Arbitrum One endpoint.
- Atomic onchain postconditions are the user-fund protection.
- Conditional admission is presented as stale-execution and operational protection, not an onchain cryptographic policy.
- The receipt labels the RPC response as operational evidence, not a sequencer attestation.

If users obtain nearly all value from postconditions and do not care about stale rejection, replan semantics, or failure cost, the differentiated company thesis fails. This is a kill criterion, not a limitation to hide.

### Mechanisms transferred, not products copied

StateLatch combines ideas that are mature elsewhere without cloning another chain's application:

- Compare-and-swap and optimistic concurrency from databases inspire "execute only if the relevant state still matches."
- Program slicing and mutation testing inspire reducing a large runtime read set to observed outcome-critical dependencies.
- Safety interlocks and circuit breakers inspire atomic final-outcome assertions.
- Workflow engines inspire explicit completion, stop, retry, and replan states.
- Audit/event-sourcing systems inspire a durable run receipt and incident trail.

Arbitrum One contributes the missing production primitive: sequencer-side conditional admission alongside EVM atomicity. The product work is compiling user outcomes into those layers and operating the full lifecycle safely. It is not a port of an existing wallet, AMM, agent, or protocol.

## 5. Complete user journeys

### A. Setup and activation

1. The operator creates a workspace in the web console.
2. They connect a dedicated Arbitrum One Safe in read-only mode.
3. StateLatch verifies chain ID, Safe nonce, canonical batch contract, owners, threshold, and balance caps.
4. The developer installs the SDK and customer-controlled runner.
5. The operator creates a versioned protection profile with account, target, selector, maximum input, minimum outcome, recipient, maximum fee, expiry, and retry policy.
6. The runner generates a dry-run report against an Arbitrum One fork.
7. The report displays raw dependencies, retained dependencies, excluded dependencies, atomic assertions, confidence classification, and unsupported behavior.
8. The operator activates that exact profile version.

### B. Every protected run

1. The customer's existing strategy produces an unsigned action.
2. The SDK validates it against the active profile.
3. The runner builds a call-only Safe batch containing exact approvals where needed, the intended action, approval reset, and final assertions.
4. StateLatch simulates the complete batch at a recorded block hash.
5. The analyzer collects storage, balance, nonce, code, return-value, and external-call dependencies.
6. Mutation analysis finds observed dependencies capable of violating a declared outcome.
7. Uncertain behavior causes a conservative raw-read-set fallback or refusal.
8. The customer signs locally.
9. The local runner submits the raw transaction and conditions directly to Arbitrum One.
10. The monitor waits for inclusion and confirmation instead of treating RPC acceptance as settlement.
11. On success, StateLatch records final assertions, receipt, gas, and transaction evidence.
12. On rejection, expiry, Safe batch failure, outer revert, or reorganization, it returns a typed replan signal.

### C. Incident and replan

1. The run enters `REPLAN_REQUIRED` with an alert.
2. The incident view distinguishes condition rejection, non-inclusion, RPC failure, onchain revert, and reorganization.
3. It shows the expected and observed dependency, the declared outcome at risk, whether gas was spent, and the last valid simulation snapshot.
4. The operator triggers a fresh simulation.
5. A materially different action requires a new signature.
6. The old run and evidence remain immutable in the audit history.

### D. Public verification

1. A judge or auditor opens the public receipt URL.
2. They see chain ID, Safe, action hash, profile version, simulation block, assertions, included transaction, and `OutcomeVerified` event.
3. They can open Arbiscan and the verified contract source.
4. The page clearly distinguishes onchain proof from locally signed or RPC-origin operational evidence.

## 6. Web information architecture

The web application is an operations product, not a metrics dashboard with a transaction button.

### Screen 1: Runs

The default work queue groups runs by action required:

- Awaiting signature
- Compiling
- Submitted
- Included
- Condition rejected
- Postcondition failed
- Expired
- Replan required

Metrics are secondary to the queue.

### Screen 2: New protection profile

The event version supports one Safe, native Arbitrum USDC, one approved adapter, and explicit fields for target, selector, input cap, output floor, recipient, fee cap, deadline, and unsupported-token warning.

### Screen 3: Preflight report

This is the technical centerpiece:

- Simulation block number and hash
- Raw and retained dependency counts
- Dependency groups and classifications
- Exact conditional options
- Final outcome assertions
- Mutation evidence
- Confidence level
- Raw fallback or refusal reason

The product never calls the dependency set "provably minimal."

### Screen 4: Live run

- Safe and transaction hashes
- Safe nonce
- Submission time
- Condition deadline
- Current attempt
- RPC response class
- Inclusion and confirmation monitor
- Explicit resimulate/replan action

### Screen 5: Blocked-run diff

- Expected state
- Observed state
- Layer that blocked the run
- Outcome that could have changed
- Gas spent or avoided, clearly labeled
- Next safe action

### Screen 6: Attack Lab

The judged product includes a first-class Attack Lab with repeatable scenarios:

- Change irrelevant fixture state.
- Change outcome-critical state.
- Cause an unsafe final outcome after pre-admission analysis.
- Replay an expired action.
- Change a proxy-like implementation slot.

Each scenario identifies the protection layer and produces reproducible evidence.

### Screen 7: Receipt

The public receipt binds the declared outcome to the included Arbitrum transaction and verifier event. It does not claim that the chain attested to the RPC condition object.

### Screen 8: Workspace and integration

This screen holds profile versions, team roles, webhook credentials, runner health, SDK snippets, retention controls, and export settings. Billing and enterprise SSO are post-event work.

## 7. Technical architecture

```text
Existing automation
  -> StateLatch TypeScript SDK
  -> customer-controlled local runner
  -> simulation, tracing and dependency analysis
  -> call-only Safe batch with final assertions
  -> local customer signature
  -> direct conditional submission to Arbitrum One
  -> inclusion monitor and OutcomeVerifier event
  -> complete, stop or replan signal
  -> web console and public receipt
```

### Web and control plane

- Next.js and TypeScript responsive application.
- Postgres for workspaces, profiles, redacted run metadata, incidents, and receipt indexes.
- Authentication and role-based access for configuration.
- Webhook and email notification delivery.
- No private keys, seed phrases, raw Safe owner signatures, or reusable signed transactions in the hosted database.
- Hash-first telemetry. Full traces are opt-in, encrypted, and retention-limited after the event.

### SDK and runner

- TypeScript SDK built on `viem` and Safe tooling.
- Node runtime and Docker distribution.
- Local transaction construction and signing integration.
- Direct conditional RPC submission.
- Nonce, expiry, inclusion, confirmation, and reorganization handling.
- Typed callbacks: `COMPLETE`, `STOP`, `RESIMULATE`, `REPLAN`, and `MANUAL_REVIEW`.
- No automatic broadcast of an old signed transaction after a stale-state rejection.

### Trace collector and analyzer

- Runs against a recorded Arbitrum One fork.
- Collects `SLOAD`, account balance, nonce, code, return-value, and external-call dependencies.
- Recognizes common proxy implementation and beacon slots.
- Starts from the conservative raw read set.
- Mutates individual and grouped dependencies.
- Replays the complete action and retains mutations that can violate a declared outcome.
- Falls back to the raw set or refuses the route when behavior is unsupported.

This is observed dependency reduction, not formal proof-producing program analysis.

### Condition compiler

The event compiler supports exact:

- Storage-slot values
- Account balance
- Account nonce
- Contract code
- Maximum block
- Maximum timestamp

It does not invent inequality support that ERC-7796 does not provide.[^10]

### `OutcomeVerifier`

Deploy one immutable, stateless Solidity contract with bounded assertion methods for:

- ERC-20 balance at least a value
- ERC-20 spend at most a value
- Recipient balance delta at least a value
- Native balance within a bound
- Static view result within a declared bound
- Target code hash equals an expected value

The contract has no administrator, proxy, custody, token approvals, upgrade path, or withdrawal method. It accepts no deposits. It emits `OutcomeVerified(runHash, account)` only when all specified assertions pass.

The event integration uses Safe's canonical call-only batch mechanism. StateLatch exposes no arbitrary application-controlled `delegatecall`; any batching behavior is restricted to Safe's established call-only path.[^11]

Safe execution status needs special handling. Depending on the signed Safe gas fields, a failed inner execution can return `false` and emit `ExecutionFailure` while the outer Ethereum transaction is still mined. In the event profile, StateLatch binds `safeTxGas` and Safe `gasPrice` to zero so the reviewed Safe implementation fails closed by bubbling the inner revert. The monitor still checks the Safe success/failure event and final state instead of trusting the top-level receipt status alone. The integration must pin and test the exact deployed Safe version before use.[^25]

### `DependencyFixture`

Deploy a clearly labeled, no-funds demonstration contract with critical, irrelevant, correlated, and proxy-like state. Its purpose is to make false rejection, critical drift, and post-admission failure deterministic and independently reproducible on Arbitrum One.

Do not deploy an intent registry, policy NFT, receipt NFT, badge, governance token, or redundant onchain history contract.

### Run state machine

```text
DRAFT
  -> PREFLIGHT
  -> AWAITING_SIGNATURE
  -> SUBMITTED
  -> INCLUDED
  -> CONFIRMED

PREFLIGHT -> REFUSED
SUBMITTED -> CONDITION_REJECTED -> REPLAN_REQUIRED
SUBMITTED -> EXPIRED -> REPLAN_REQUIRED
SUBMITTED -> RPC_FAILED -> MANUAL_REVIEW
INCLUDED -> SAFE_BATCH_FAILED -> REPLAN_REQUIRED
CONFIRMED -> REORGED -> REPLAN_REQUIRED
```

Every transition has an explicit reason and retry rule. This state machine is part of the product value, not merely backend plumbing.

## 8. Data model

| Entity | Required fields |
|---|---|
| Workspace | Organization, members, roles, retention policy |
| Account | Safe address, chain fixed to 42161, owner/threshold snapshot |
| ProtectionProfile | Version, target, selector, assets, caps, recipients, expiry and retry policy |
| RunIntent | Run hash, profile version, action hash, nonce, outcome assertions, validity window |
| Simulation | Block hash/number, result, gas estimate, trace digest |
| Dependency | Account, slot/property, observed value, group, classification |
| MutationEvidence | Dependency, mutation, observed outcome, retain/exclude decision |
| ConditionalPlan | Exact options, raw count, retained count, deadline |
| SubmissionAttempt | Endpoint, time, response class, transaction hash |
| OutcomeResult | Declared values, observed values, verifier event or revert |
| Incident | Failure class, stale dependency, gas result, replan result |
| RunReceipt | Intent, simulation digest, condition-plan digest, transaction receipt |

The database is an operations index. Arbitrum One and the customer's signatures remain authoritative for execution and settlement.

## 9. Security and mainnet threat model

| Threat | Control and honest boundary |
|---|---|
| Analyzer misses a critical dependency | Atomic final assertions, conservative fallback, unsupported-route refusal |
| Hosted service strips conditions | Hosted service never receives the signed transaction; local direct submission |
| State changes after admission | Final assertions execute atomically after the action; Safe fail-closed gas fields and success events are verified |
| RPC accepts but never includes | Explicit chain monitor, deadline, no acceptance-equals-success claim |
| Reorganization | Bind analysis to block hash, wait for confirmations, return replan after reorg |
| Safe nonce race | Include nonce condition and short validity window |
| Proxy upgrade | Condition recognized implementation/beacon slot or code hash; refuse unknown patterns |
| Malicious or unusual token | Native Arbitrum USDC only during the event |
| Fee-on-transfer or rebasing token | Unsupported during the event |
| Unlimited approval | Exact approval and reset in the same batch |
| Bad outcome definition | Preview, templates, explicit activation, and unsupported-policy refusal |
| Compromised customer key | Not solved; dedicated capped Safe and existing threshold controls |
| Cloud compromise | Cloud cannot sign or broadcast; onchain assertions remain authoritative |
| Trace leaks strategy | Hash-first telemetry, opt-in encrypted trace storage, limited retention |
| Exact conditions cause liveness failure | Short deadlines, bounded resimulation, no blind retry |

The product enforces the user's declared boundary. It cannot turn a bad economic policy into a good one.

### Event mainnet limits

- Fresh team-controlled Safe.
- 20 to 50 USDC maximum total balance.
- 5 USDC maximum per demonstrated action.
- Native Arbitrum USDC only.
- One approved action adapter.
- Exact approvals and reset.
- No public deposits or third-party funds.
- No proxy, governance, or token.
- No unrestricted executor.
- Manual local kill switch.
- No automatic retry without fresh simulation and authorization.
- Public "unaudited beta" label.
- Verified contract source and reproducible deployment manifest.

The fixture can safely demonstrate adversarial mainnet behavior without manipulating a production liquidity pool. One real capped treasury action proves the complete integration.

## 10. Competitive map and whitespace

| Product | What it already owns | StateLatch boundary |
|---|---|---|
| Tenderly | Simulation, virtual environments, production-state modeling, incident reproduction | Compiles a run into sequencer conditions, atomic outcome assertions, and automation replan semantics[^7] |
| Blockaid Cosigner | Pre-sign simulation, threat intelligence, organization policies, Safe/Fireblocks/MPC cosigning | Protects state drift between simulation and inclusion plus final declared outcomes; no claim to replace threat intelligence[^8] |
| Fordefi/Fireblocks | Wallet policy, roles, approvals, whitelists, custody workflows | Integrates beside the existing signer; does not replace custody or organization authorization[^12] |
| OpenZeppelin Relayer | Signing, nonce, relaying, monitoring, policies, Docker and plugins | State-sensitive admission, outcome compilation, and replan loop; not a generic relayer[^13] |
| Verderer | Simulation-derived read sets and conditional submission | Must prove materially fewer false rejects plus atomic outcome checks and full incident lifecycle[^14] |
| Backpac | Multi-provider RPC reliability, routing, retries, finality and execution evidence | Declared financial outcomes and state dependencies; do not claim ownership of the phrase "execution assurance"[^15] |

### Defensibility

The RPC method and verifier contract are not a moat. The possible moat is:

- Protocol-specific dependency graphs and semantic adapters.
- A growing adversarial mutation and incident corpus.
- Measured false-rejection data for real automation classes.
- Profile templates for common protocol actions.
- Reliability history across RPC endpoints and transaction types.
- Deep integration in customer automation and response workflows.
- Audit evidence accepted by security reviewers, insurers, and custodians.

An incumbent can copy the feature. StateLatch only becomes defensible if it accumulates better execution semantics and becomes the standard `protectAndSend()` path for Arbitrum automations.

### Funding signal

Blockaid announced a 50 million USD Series B in February 2025 and Hypernative announced a 40 million USD Series B in June 2025.[^16][^17] These rounds validate a serious onchain security budget, not demand for StateLatch specifically. They also raise the bar: a vague security dashboard will be crushed by incumbents.

Kimia's 2026 MetaDAO raise was capped at 60,000 USD, despite much larger demand. Its useful lesson is product coherence, not fundraising magnitude: multiple mechanisms formed one integrated cashflow engine with concrete mainnet milestones.[^18][^19] StateLatch applies that lesson by making simulation, state locking, final assertions, monitoring, receipts, and replanning parts of one recurring protected-run product.

## 11. Why the other ideas lost

| Candidate | Strength | Decisive problem | Decision |
|---|---|---|---|
| PayoutSeal, formerly PayLock | Obvious B2B user, powerful recipient-substitution demo, complete web workflow | Direct collision with Request Finance, Utila, Fireblocks, Safe tooling, and PayeeProof; bilateral supplier signing creates adoption friction | Keep as contingency only if two buyer-supplier pairs commit to a live pilot |
| ProofBond | Objective equivocation evidence and simple mainnet safety | Two-sided provider/buyer integration, narrow fault model, weak proof of truth for stochastic APIs | Reject as current company |
| StreamFactor | Real financial primitive and revenue opportunity | Lending regulation, underwriting, legal receivable assignment, capital formation, defaults | Incubate only after real payment volume and regulated partner |
| Private AP | Strong privacy need | Railgun and privacy-chain overlap, compliance and wallet friction, excessive security surface | Reject |
| MilestoneChannel | Agent payment trend and recurring use | ERC-8183 and Arbitrum MPP already cover much of the primitive; evaluation remains unsolved | Reject |
| Deadman/continuity modules | Genuine treasury risk | Existing Safe recovery, role, and custody products; module alone is a feature | Reject standalone |

PayoutSeal deserves special scrutiny because it looks more like a conventional full product. PayeeProof already sells pre-send stablecoin payout checks from 399 USD per month. Request Finance already supports Arbitrum One payment contracts, batch payments, conversion, and reconciliation. Fireblocks already provides address whitelisting, admin quorum, transaction policies, and one-time address controls.[^20][^21][^12] Supplier co-signing plus onchain enforcement is differentiated, but it is not enough evidence to justify entering a broad accounts-payable and custody competition without customer commitments.

StateLatch wins the decision because it has the clearest unoccupied technical boundary, strongest Arbitrum-specific story, safest mainnet deployment, and deepest adversarial demo. It has weaker validated demand than PayoutSeal's general fraud problem, so its technical and customer gates are mandatory.

## 12. What previous winners actually teach

The mathematics-related Bengaluru winner was **Orbital AMM**. It combined high-dimensional stablecoin math, a Q96.48 precision layer in Stylus, trade segmentation, working liquidity and swap flows, APIs, tests, deployed contracts, and a browser demonstration. The lesson is not to clone an AMM. It is to expose difficult engineering through a complete economic workflow.[^6]

Shinobi.Cash paired ZK and cross-chain privacy with a usable deposit/withdraw flow. GuardChain.ai paired contracts with a sharply regional insurance problem. Plexi paired ERC-4626 contracts with working deposit, withdrawal, statistics, and emergency exit. TriggerX paired automation infrastructure with an operator-facing execution flow.[^6]

NYC and London continued the same pattern. Winners included functioning escrow, risk, tokenized-asset, RWA collateral, privacy, and agent-finance products. The official recaps reward execution, product clarity, ecosystem alignment, and continued progress, not raw contract count or native mobile.[^22][^23][^24]

StateLatch must meet that bar with:

- A genuinely hard core.
- One complete repeated user job.
- A real Arbitrum One success.
- At least two visible adversarial failures.
- A polished browser surface.
- Tests, documentation, and reproducibility.
- External user evidence before submission.

## 13. Buildathon scope: complete wedge, not feature soup

### Team operating assumption

The schedule assumes three active technical contributors:

1. Contracts, Safe integration, mainnet deployment, and security tests.
2. Runner, tracing, analyzer, compiler, and monitoring.
3. Web product, control-plane backend, receipts, design, and demo.

A fourth teammate, if available, should own customer interviews, partner onboarding, documentation, QA, and submission operations while still contributing verifiable work. With only one or two builders, keep the complete journey but reduce analyzer generality, historical sample size, and visual breadth. Do not cut the live mainnet success, adversarial failures, local trust model, tests, or incident/replan flow.

### Must ship by September 30

- Responsive web console with the eight core product screens.
- Public landing page, docs, integration quickstart, status, and receipt route.
- TypeScript SDK with one `protectAndSend()` integration.
- Docker/local runner and CLI.
- Profile schema and run state machine.
- Trace collector and experimental mutation analyzer.
- Conservative raw-read-set fallback and explicit refusal paths.
- ERC-7796 condition compiler for Arbitrum One.
- Immutable `OutcomeVerifier` and no-funds `DependencyFixture`.
- Safe call-only batch integration with fail-closed gas fields and explicit `ExecutionSuccess`/`ExecutionFailure` handling.
- One native-USDC treasury action adapter.
- Inclusion, confirmation, expiry, and reorganization monitor.
- Webhook-based replan callback.
- Unit, fuzz, invariant, integration, and Arbitrum One fork tests.
- Verified Arbitrum One contracts and capped live transactions.
- Attack Lab with reproducible scenarios.
- Public architecture, security boundary, and known limitations.
- Demo video and complete submission package.

### Explicitly not in the event build

- Android or iOS application.
- Consumer wallet or browser extension.
- Hosted key custody or hosted signed-transaction relay.
- More than one chain.
- More than one production action adapter.
- Autonomous strategy selection.
- Unlimited generic call execution.
- Token, governance, NFT, or points system.
- Billing, enterprise SSO, insurance, or compliance certification.
- Claims of formal completeness, guaranteed inclusion, or universal MEV protection.

### Suggested repository shape

```text
apps/
  web/
  docs/
services/
  runner/
  monitor/
packages/
  sdk/
  profile-schema/
  condition-compiler/
  analyzer/
contracts/
  src/
  test/
examples/
  safe-treasury-rebalance/
fixtures/
  dependency-lab/
```

The exact framework versions should be selected from the repository's current toolchain when implementation begins. Do not add technology merely for sponsor count.

## 14. Twenty-day execution plan

Treat September 30 as the internal submission deadline because previously linked terms and the live portal have shown conflicting dates. The live portal currently displays an October 4 submission close.[^2]

### September 14 to 15: existential proof

- Mine at least five valid conditional transactions through a public Arbitrum One path.
- Demonstrate exact-condition pass and fail behavior.
- Verify that the endpoint preserves the expected semantics across repeated submissions.
- Build the first atomic assertion batch.
- Interview five target automation teams.

No brand, design system, or broad frontend work precedes this proof.

### September 16 to 18: engine and customer gate

- Freeze the profile and run schemas.
- Implement trace collection, raw dependency extraction, compiler, and fallback.
- Run at least 10,000 individual and grouped adversarial mutations.
- Prove a meaningful false-rejection reduction on two representative routes without admitting a declared-outcome violation.
- Secure at least one design partner willing to run shadow mode.

### September 19 to 22: complete first journey

- Implement workspace, account, profile, preflight, and run screens.
- Integrate the local runner and Safe batch.
- Complete one successful 1 to 5 USDC Arbitrum One action.
- Produce the first public receipt.
- Start continuous fork, fuzz, and invariant testing.

### September 23 to 25: adversarial product

- Implement condition rejection, postcondition revert, expiry, RPC failure, and reorganization states.
- Build the Attack Lab and incident diff.
- Add webhook replan callback.
- Give feedback-session reviewers an unassisted demo.
- Fix the first three misunderstandings before adding features.

### September 26 to 28: external proof and hardening

- Run the design partner in shadow mode.
- Benchmark at least 1,000 historical actions from the reference class.
- Publish false-rejection, compilation, and refusal results with methodology.
- Obtain one external security review of the contract surface.
- Complete verified deployment, docs, threat model, and reproducible setup.

### September 29 to 30: submission freeze

- Freeze product scope.
- Record a 2 to 4 minute demo and a shorter fallback cut.
- Confirm every demo action against the production deployment.
- Package repository, contract addresses, architecture, test results, screenshots, progress log, and pilot evidence.
- Submit early and preserve a working hosted build.

### October 1 to 4: buffer, not planned development

Use only for organizer-requested corrections, availability, demo resilience, and post-submission traction. Do not depend on these days for the core product.

## 15. Existential validation gates

StateLatch is approved for the full build only if all of the following are true by the end of September 16:

### Technical gates

- At least five correctly conditioned transactions are mined on Arbitrum One.
- A critical state change is rejected.
- An irrelevant state change is tolerated after minimization but rejected by a conservative raw-read-set plan.
- Final postconditions revert every tested unsafe outcome atomically.
- The customer-controlled direct-submit path works without StateLatch receiving a signing key.

### Customer gates

- Five target operators are interviewed.
- At least three report a current stale-execution, revert-cost, incident-reconstruction, or replan problem.
- At least one agrees to install the shadow-mode SDK.
- At least one has 100 unattended weekly transactions or at least 1 million USD exposed to the workflow.

### Usability gate

Three technical outsiders watch a 60-second rough demo without narration. All three must identify:

- Who is protected.
- Which state changed.
- Which layer blocked the unsafe run.
- Why this is more than simulation.

### Kill conditions

Stop the product if any of these is true:

- Public Arbitrum One submission does not reliably honor the condition object.
- Deployed endpoint semantics materially differ from the compiler's supported ERC-7796 variant.
- Critical dependencies change too frequently to satisfy Arbitrum's state-age behavior at a useful inclusion rate.
- Dependency minimization does not materially reduce false rejection.
- Any adversarial mutation violates a declared outcome without atomic revert.
- Postconditions alone provide nearly all perceived customer value.
- Operators do not care about stale rejection, gas loss, or automated replan.
- The added P95 decision latency is unacceptable for the selected workflow.
- Customers want simulation but refuse any atomic enforcement path.
- No buyer accepts a serious paid-pilot conversation after the event proof.

Do not keep the brand and quietly replace the engine with ordinary simulation. That would be the patch product the team explicitly rejected.

### Contingency

If StateLatch fails by September 16, activate PayoutSeal only if two real buyer-supplier pairs commit to test supplier-bound payout mandates and one commits to a capped Arbitrum One payment. Without that evidence, return to customer discovery instead of forcing a fallback into the hackathon.

## 16. Demo that can win

### Opening

> Your automation simulated a safe transaction. Seconds later, the state changed. Should it still execute? Today, most systems only find out after submission. StateLatch turns the intended outcome into an enforceable run and tells the automation when to replan.

### Two-to-four-minute sequence

1. Open a real protected treasury run in the web console.
2. Show the outcome policy, not raw storage slots first.
3. Reveal that simulation read 40 fixture slots and StateLatch retained five outcome-critical dependencies.
4. Change an irrelevant slot from a second team account.
5. Show the raw plan becoming stale while the reduced plan still succeeds.
6. Start another run and change a critical slot.
7. Show the conditional RPC rejection and absence of an included action transaction.
8. Run an adversarial action that changes an unconditioned value during execution.
9. Show `OutcomeVerifier` failing the Safe batch, rolling back every earlier call, and producing the expected outer revert or Safe failure signal for the pinned configuration.
10. Execute one real capped native-USDC treasury action successfully.
11. Open the public receipt, verified contract, transaction, tests, and design-partner evidence.

The visible story is:

- Irrelevant change tolerated.
- Critical pre-execution change rejected.
- Unsafe final outcome atomically reverted.
- Safe action settled and produced a receipt.
- Automation received a deterministic complete or replan result.

Do not claim that a rejected RPC request emitted an onchain event. Show the actual RPC response and independent chain absence.

## 17. Metrics and traction

### Product reliability

- Protected runs compiled.
- Compilation refusal rate.
- Raw and retained dependency counts.
- False-rejection reduction.
- Conditional rejection rate.
- Inclusion rate after acceptance.
- Postcondition revert rate.
- Median time to replan.
- Reorganization recovery.
- Unsupported-contract incidence.
- RPC endpoint disagreement.

### Commercial evidence

- Time to first protected run.
- External design partners.
- Weekly active workspaces.
- Repeat protected jobs per workspace.
- Production profiles activated.
- SDK retention after seven and thirty days.
- Protected transaction value, clearly separated from custody, revenue, and organically sourced activity.
- Paid-pilot commitments.

Do not count team-generated demo transactions as adoption. Label estimated gas avoided as a counterfactual and publish the calculation.

## 18. Business and twelve-month company plan

### Business model

- Open-source `OutcomeVerifier`, profile schema, and minimal local client.
- Free local analysis for developers.
- Paid hosted control plane, policy management, monitoring, incident history, and collaboration.
- Team subscription based on active protected jobs and analyzed runs.
- Enterprise self-hosted runner, audit export, support, and service-level agreement.
- No percentage of transaction value and no token.

The price hypothesis starts at 2,000 USD per month for professional teams and rises with protected jobs, run volume, support, and self-hosting. Customer interviews decide the actual packaging.

### Distribution

1. Publish `protectAndSend()` for viem-based Arbitrum automations.
2. Open-source the Attack Lab, mutation corpus, and raw-versus-retained benchmark.
3. Recruit Arbitrum keeper, agent, treasury, and vault teams as design partners.
4. Ship one excellent Safe integration.
5. Publish incident-oriented technical content with reproducible transactions.
6. Add an OpenZeppelin Relayer plugin only after direct-submit semantics are proven.
7. Earn protocol-specific templates from real partner workflows.

### Months 1 to 3

- Three production design partners.
- Stable shadow-mode runner and three semantic adapters.
- Independent audit of `OutcomeVerifier` and Safe batching.
- Measured conditional-RPC reliability.
- First paid pilot.

### Months 4 to 6

- Safe and ERC-4337 integrations.
- Versioned policy-as-code.
- Better static plus dynamic dependency analysis.
- Enterprise incident export and access controls.
- Ten active workspaces.

### Months 7 to 9

- Ten high-quality Arbitrum protocol adapters.
- Formal analysis for selected bounded routes.
- Self-hosted control plane and support process.
- Custodian, insurer, or security-partner pilot.

### Months 10 to 12

- Demonstrable false-rejection and incident dataset moat.
- Annual contracts.
- Reliability service level.
- At least 100 million USD in monthly protected transaction value, clearly not custody or revenue.

Do not add another chain to the Open House roadmap. Win the Arbitrum One execution category first and expand only after product-market fit, not for logo count.

## 19. Founder House and funding strategy

Apply to Founder House independently now. The application is rolling and explicitly wants teams with an existing product or prototype that can ship meaningful progress, validate direction, and continue.[^3]

The Founder House narrative should be:

1. **Before Buildathon:** state-drift insight and Arbitrum capability research.
2. **During Buildathon:** working Arbitrum One protected-run product, benchmark, external shadow user, mainnet receipt, and adversarial evidence.
3. **Before Founder House:** audited event contract, three design partners, first additional semantic adapter, and measured RPC reliability.
4. **At Founder House:** launch the self-hosted runner and first paid pilot, not a cosmetic dashboard feature.

### Provisional 30,000 USD milestone-grant request

Keep this to three independently verifiable deliverables. The amounts are planning figures, not a final budget. Replace the security-review estimate with a real written quote and map every engineering line to the actual team before submission.

| Milestone | Deliverable and acceptance criteria | Timeline | Provisional budget |
|---|---|---:|---:|
| 1. Arbitrum One conditional-execution benchmark | Open-source harness and report covering at least 100 capped mainnet attempts plus 1,000 historical/fork replays, endpoint behavior, inclusion, expiry, failure classes, and reproducible raw data | Weeks 1 to 3 | 7,500 USD |
| 2. Reviewed onchain enforcement release | Independent review of `OutcomeVerifier` and Safe batching, public report, all critical/high findings resolved, Foundry unit/fuzz/invariant/fork suite, verified immutable v1 deployment | Weeks 2 to 6 | 12,000 USD |
| 3. Production self-hosted runner | Signed Docker release, one semantic adapter, operations runbook, three external design-partner installations, and at least 100 external shadow runs in one week | Weeks 5 to 10 | 10,500 USD |

Suggested provisional cost basis is engineering at 100 USD per hour, benchmark/RPC infrastructure, and an audit line supported by the eventual reviewer quote. Do not put marketing, general salary, token liquidity, or unexplained contingency into the grant budget.

### Grant-readiness gate

Do not submit a follow-on grant application until all of these are true:

- Apache-2.0 or similarly clear open-source license is present for the core contracts, schema, SDK, and harness.
- Public repository, working product, Arbitrum One deployment, verified source, and test evidence exist.
- Team identities or pseudonymous shipping records are linked.
- No known critical or high-severity issue is unresolved.
- Every requested dollar maps to a deliverable and acceptance criterion.
- The ecosystem benefit is stated as safer recurring Arbitrum automation, active protected runs, integrations, and reusable open-source tooling, not speculative TVL.

Funding is not the product goal. The best grant argument is that a team already proved a hard Arbitrum-specific behavior, converted it into a recurring workflow, attracted external operators, and knows exactly what the next grant-funded risk reduction buys.

### Ready-to-use application core

**Idea/project description, 265 characters:**

> StateLatch is the protected execution runtime for autonomous finance on Arbitrum One. It turns each automated transaction into state-sensitive inclusion conditions, atomic outcome checks, an auditable receipt, and a deterministic replan signal when reality changes.

**Problem and solution, 277 characters:**

> Bots and treasury automations simulate against one state but execute against another, causing reverts, unsafe outcomes, and unclear recovery. StateLatch binds current-state assumptions to submission, enforces final outcomes atomically, and tells the job when to stop or replan.

**Category:** Developer tooling and infrastructure, with AI and agentic finance as the initial workflow.

**Technology tags:** Arbitrum One, Solidity, TypeScript, Safe, ERC-7796, Foundry, Next.js.

**Founder House progress claim to earn before using:**

> Built and deployed a complete protected-run lifecycle on Arbitrum One, including a local direct-submit runner, atomic outcome verifier, incident/replan console, public receipts, adversarial benchmark, and an external design partner running shadow mode.

Do not submit the progress claim until every component is real and linked.

## 20. Final no-slop checklist

Reject any build change that introduces one of these:

- A generic dashboard disconnected from the operator's next action.
- A chain integration added for prizes rather than product need.
- A token, NFT, points program, badge, or onchain hash registry.
- An AI agent that merely writes policies or narrates transaction data.
- A Safe Guard before a recovery design and serious audit.
- Arbitrary external calls in a fund-moving contract.
- A mobile app with no mobile-native user job.
- Claims that conditions are signed, inclusion is guaranteed, analysis is complete, or all MEV is prevented.
- More adapters before the first one is reliable.
- More screens before the complete protected-run lifecycle works.
- Team transactions labeled as traction.
- A fallback idea built without its own customer evidence.

The product wins only if a judge can see a real user, a hard invariant, a complete workflow, a dangerous state change, the exact protection layer, a successful Arbitrum One result, and evidence that an external operator wants it.

## Locked decisions

| Question | Decision |
|---|---|
| Product | StateLatch protected execution runtime |
| Initial user | Arbitrum automation engineer/onchain operations lead |
| Buyer | Head of Engineering, Security, or Onchain Operations |
| Primary interface | Desktop-first responsive web console |
| Developer interface | TypeScript SDK plus Docker/local runner and CLI |
| Mobile | Responsive read-only status only; no Android/iOS app |
| Account | Dedicated, capped Safe |
| Chain | Arbitrum One mainnet only |
| Asset | Native Arbitrum USDC only during event |
| Reference workflow | Automated Safe treasury rebalance |
| Contract | Immutable stateless `OutcomeVerifier` plus no-funds fixture |
| Custody | None |
| Hosted signed relay | None |
| Token | None |
| Public mainnet capital | Team funds, 20 to 50 USDC maximum |
| Event deadline | Internal freeze September 30 |
| Existential decision | September 16 technical and customer gates |
| Commercial model | Developer-open core plus paid operations control plane |

## Sources

[^1]: [AI Decoded, existing CausalShield usage](https://aidecoded.io/)
[^2]: [HackQuest, Arbitrum Open House Singapore Online Buildathon](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)
[^3]: [Luma, Arbitrum Open House Singapore Founder House](https://luma.com/openhouse-singapore)
[^4]: [Arbitrum, What winning Open House teams do differently](https://dev.to/arbitrum/what-winning-arbitrum-open-house-teams-do-differently-18f8)
[^5]: [HackQuest, current Singapore project gallery](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon?tab=projectGallery)
[^6]: [Arbitrum Foundation, India and Bengaluru recap](https://blog.arbitrum.foundation/arbitrum-open-house-india-concludes-with-bengaluru-hacker-house-full-recap/)
[^7]: [Tenderly, simulation for onchain operations](https://tenderly.co/)
[^8]: [Blockaid, Cosigner recommended policies](https://blockaid.io/blog/introducing-recommended-policies-for-cosigner-onchain-operational-security-powered-by-ai)
[^9]: [Arbitrum AIP-2, conditional endpoint on One and Nova](https://forum.arbitrum.foundation/t/aip-2-activate-support-for-account-abstraction-endpoint-on-one-and-nova/14790)
[^10]: [ERC-7796, Conditional send transaction RPC](https://eips.ethereum.org/EIPS/eip-7796)
[^11]: [Safe, batch transaction creation](https://docs.safe.global/reference-sdk-protocol-kit/transactions/createtransaction)
[^12]: [Fireblocks, whitelisted addresses](https://developers.fireblocks.com/docs/whitelist-addresses)
[^13]: [OpenZeppelin Relayer](https://docs.openzeppelin.com/relayer)
[^14]: [Verderer, bundles and conditional transactions](https://verder.tech/bundles)
[^15]: [Backpac, RPC and execution-assurance positioning](https://www.linkedin.com/company/backpac-inc)
[^16]: [Blockaid, 50 million USD Series B](https://blockaid.io/blog/behind-blockaids-series-b-securing-an-onchain-future)
[^17]: [Hypernative, 40 million USD Series B](https://www.hypernative.io/insights/blog/hypernative-raises-40m-series-b-to-remove-security-barriers-to-web3-mass-adoption)
[^18]: [MetaDAO, Kimia company and capped raise](https://metadao.fi/companies/kimia)
[^19]: [Kimia, product overview](https://www.kimia.live/about)
[^20]: [PayeeProof, pre-send stablecoin payout checks](https://payeeproof.com/)
[^21]: [Request Finance, Arbitrum One payment contracts](https://help.request.finance/en/articles/10123680-smart-contracts-at-request-finance)
[^22]: [Arbitrum Foundation, NYC Buildathon winners](https://blog.arbitrum.foundation/open-house-nyc-buildathon-concludes-meet-the-winning-teams/)
[^23]: [Arbitrum Foundation, NYC Founder House winners](https://blog.arbitrum.foundation/nyc-founder-house-concludes-with-340k-in-awards-to-winning-teams/)
[^24]: [Arbitrum Foundation, London Founder House winners](https://blog.arbitrum.foundation/top-founders-take-home-300k-at-london-founder-house/)
[^25]: [Safe smart-account implementation, `execTransaction` failure handling](https://github.com/safe-global/safe-contracts/blob/main/contracts/Safe.sol)
