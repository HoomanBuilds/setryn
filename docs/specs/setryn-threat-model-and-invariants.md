# Setryn threat model and protocol invariants

Date: 2026-09-25
Status: Phase 0 normative specification
Target networks: Arbitrum Sepolia and Arbitrum One

## 1. Purpose and authority

This document defines the protocol-wide security boundary for the Setryn first-party trading
platform. It turns the Phase 0 threat-model requirement into implementation constraints and named
invariants that every later contract, internal service, indexer, keeper, maker, solver, privacy
component, and first-party interface must preserve.

This document is normative for Phases 1 through 7. A module-level specification may make a rule
stricter. It may not weaken an invariant here. If implementation cannot satisfy an invariant, the
affected capability remains disabled and the conflict returns to specification before activation.

The scope includes:

- canonical definitions, registries, qualification, and activation;
- collateral custody, reservations, margin, fees, insurance, and default resources;
- public orders, private RFQs, streams, auctions, batches, direct and implied liquidity, packages,
  and solver execution;
- positions, lifecycle actions, fixing, settlement, default, and recovery;
- benchmark, session, calendar, curve, venue, settlement, delivery, risk, and privacy adapters;
- internal application data services, first-party web clients, indexers, relays, makers, solvers,
  keepers, monitoring, receipts, and incident operations;
- Arbitrum sequencer, L1 finality, reorganization, and chain-specific deployment assumptions.

Public APIs, external SDKs, externally consumed webhooks, embedded widgets, partner credentials, and
their abuse controls are Phase 8 and are outside this specification. Internal schemas, generated
bindings, indexer interfaces, and first-party application services remain in scope because the user
platform consumes them before Phase 8.

The requirements apply equally on Sepolia and One unless a deployment manifest explicitly narrows a
cap, role holder, dependency address, or test fixture. Sepolia may use qualified test adapters and
lower caps. It may not bypass authorization, collateral, replay, payoff, lifecycle, or settlement
rules.

## 2. Security objectives and protected assets

Setryn protects the following assets:

1. User collateral and the right to withdraw available collateral.
2. Locked collateral and the exclusive right of the pinned settlement path to consume it.
3. Position ownership, lifecycle rights, exercise rights, and terminal payout claims.
4. Maker and solver collateral, expiring pre-trade capacity, non-expiring
   `TerminalLiabilityReservation` cover, and cancellation rights.
5. Protocol fees, rebate budgets, insurance funds, and default resources.
6. The uniqueness and remaining quantity of every order, quote, reservation, package, position,
   fixing, settlement, and recovery action.
7. Canonical definitions, exact immutable versions, historical economics, and qualification
   evidence.
8. Signing authority, delegated-session authority, organization policy, nonces, and deadlines.
9. Confidential RFQ content, sealed bids, selective-disclosure material, viewing permissions, and
   private operational metadata.
10. Accurate public and private market state, including marks, quotes, books, routes, charts,
    positions, balances, and receipts.
11. Availability of risk-reducing actions, bounded user exits, fixing, settlement, and recovery.
12. Evidence needed to reconstruct an execution or incident without trusting a database operator.

The security goals are:

- no unbacked credit or unauthorized value movement;
- no execution beyond signed economics, funded collateral, live capacity, or qualified caps;
- no partial economic package when the user authorized an atomic package;
- no replay across chains, contracts, accounts, actions, versions, or consumed quantity;
- deterministic outcomes from identical accepted inputs;
- fail-closed behavior when qualification, data, timing, or dependencies are unknown;
- durable exits and lifecycle resolution after dependencies are paused or retired;
- bounded authority and visible evidence for every privileged action;
- explicit, testable privacy claims without promising protection from unavoidable metadata.

## 3. Trust boundaries

| Boundary | Trusted for | Not trusted for | Required control |
| --- | --- | --- | --- |
| User wallet or organization signer | Authorizing the exact displayed action | Correct input, safe key custody, correct network, or continued ERC-1271 validity | Typed payload, chain and contract separation, policy checks, nonce, deadline, explicit preview |
| Browser and first-party UI | Constructing requests and presenting state | Custody, settlement truth, nonce truth, finality, or secret-key storage | Contracts and signed messages remain authoritative; direct reconciliation before signing |
| Core contracts | Enforcing accepted state transitions | Correctness of arbitrary external code or offchain assertions | Minimal external calls, exact interfaces, fail-closed dependency gates, events |
| Registries | Immutable version resolution and activation state | Runtime behavior of consumers, proxies, or offchain evidence | Consumers recheck exact kind, interface, capability, code, and version |
| Settlement token | ERC-20 transfers for a qualified binding | Exact-transfer behavior, continued code, upgrade safety, availability, or absence of hooks | Qualification, code and decimals checks, exact balance deltas, reentrancy protection |
| Oracle and benchmark adapter | Authenticated observation under its committed capability | Economic correctness outside its bounds, perpetual freshness, or single-source honesty | Feed identity, freshness, future skew, confidence, sequence, session, sequencer, and fallback checks |
| Arbitrum sequencer and RPC | Transaction inclusion and chain reads under Arbitrum assumptions | Fair ordering, uninterrupted service, uncensored inclusion, or one-RPC correctness | Deadlines, ordering-independent rules, sequencer health gate, RPC diversity, L1 finality tracking |
| Maker | Its valid signatures and posted collateral | Honest quoting, continued availability, unique capacity, or reveal behavior | Reservations, expiry, cancellation, penalties, objective eligibility, no unilateral settlement power |
| Solver | Submission of candidate routes | Best execution, atomicity, unbiased ordering, or live capacity | Onchain validation, user limit, deterministic winner rule, atomic consumption, evidence |
| Keeper, oracle relay, or `DEFAULT_OPERATOR` | Timely permissionless calls and evidence delivery | Exclusive availability, discretionary validity, authority to open default, or authority to select an outcome | Multiple submitters, idempotence, bounded reward, permissionless transitions, deterministic checks |
| Privacy coordinator | Transport and access enforcement for encrypted material | Plaintext honesty, uptime, or concealment of public-chain metadata | End-to-end commitments, access audit, redundant retrieval, explicit leakage report |
| Indexer and database | Queryable projections | Authorization, balances, fills, finality, or settlement truth | Reorg-aware replay, reconciliation, direct-chain fallback, no privileged state repair |
| Governance and guardians | Narrowly specified administration | Benevolence, uncompromised keys, or authority beyond their role | Safe, delay, role separation, scoped pause, evidence, user exit window |
| Adapter and external venue | Declared qualified capability | Arbitrary callbacks, stable behavior, fill completion, or upgrade safety | Exact capability match, bounded calls, no arbitrary delegatecall, atomic accounting |
| L1 and cross-domain messaging | Finalized messages under the qualified bridge | Instant finality, atomic cross-domain execution, or absence of reorg and delay | Finality threshold, replay keys, timeout, refund or recovery state, disabled-by-default capability |

Registration, qualification, activation, and successful simulation are evidence, not blanket trust.
Every consumer must enforce the exact capability and version it understands.

## 4. Actors and adversaries

The model includes honest users, account controllers, delegated signers, makers, solvers, keepers,
qualifiers, status managers, guardians, governance signers, oracle publishers, data operators, and
indexer operators.

Any actor may instead be malicious, compromised, unavailable, colluding, or economically rational.
The protocol must specifically tolerate:

- arbitrary callers, contract wallets, callback-capable recipients, and malformed calldata;
- a maker or solver that withholds, races, duplicates, selectively reveals, or griefs submissions;
- one or more unavailable keepers, relays, RPC providers, indexers, or privacy coordinators;
- a stale, delayed, future-dated, low-confidence, disputed, or wrong oracle observation;
- sequencer downtime, censorship, reordering, delayed inclusion, and recovery-period uncertainty;
- a compromised operational role and a compromised guardian;
- a compromised governance threshold, subject only to the delay and exit guarantees stated here;
- adversarial ERC-20 behavior, including callbacks, false returns, short receipt, fees, pause,
  blocklist, rebase, proxy upgrade, and code drift;
- front-running, back-running, transaction copying, liquidation races, and public metadata analysis;
- inconsistent offchain projections and a database operator attempting to rewrite history;
- chain reorganization and delayed or duplicated cross-domain messages.

The model does not claim protection after a break of standard cryptographic assumptions, a failure of
the EVM execution model, or a finalized consensus failure of Ethereum and Arbitrum together. Such an
event is handled as an external systemic incident with new risk disabled and evidence preserved.

## 5. Entry points and transition requirements

Every value-moving or authority-changing entry point must name its caller, authorization, incentive,
deadline or timeout, success state, and failure state in its owning specification. The following
minimum rules apply.

| Entry-point family | Required authorization and checks | Failure outcome |
| --- | --- | --- |
| Register or qualify | Dedicated registrar or qualifier; complete nonzero commitments; exact dependency versions | Revert without mutation; record remains absent |
| Activate new risk | Separate status authority; all dependency and capability checks repeated against live state | Remain Paused; no implicit replacement of active version |
| Deposit | Existing account, qualified active binding, exact token receipt | Revert with no credit |
| Withdraw | Current account controller, historical binding, available balance, exact token delivery | Revert atomically; never require current Active status |
| Create `PreTradeLock` | Authorized engine plus account approval where applicable, unique reference, bounded amount and expiry | No reservation; no partial lock |
| Release `PreTradeLock` | Owner cancellation under signed rules, fill conversion, or permissionless expiry | Idempotent no-op or named terminal-state rejection |
| Create fully funded position | Atomic consumption or replacement of pre-trade cover by a non-expiring `TerminalLiabilityReservation` sufficient for maximum terminal liability | Whole fill reverts; no position exists |
| Resolve terminal liability | Pinned terminal rule consumes the reservation into payout or creates the fully collateralized claim | Reservation remains intact |
| Sign or submit order, quote, RFQ, auction, package, or lifecycle action | Exact typed payload, signer policy, nonce state, deadline, environment, pinned versions, user limits | Reject without consuming collateral or quantity unless the specification explicitly consumes a cancel nonce |
| Match or fill | Live authorization, live reservation, remaining quantity, caps, session, oracle state, atomic accounting | Whole fill reverts |
| Submit oracle evidence | Permissionless or qualified relay; authentic payload; exact feed and evidence class; provider sequence or finality; session, publication-lag, candidate-deadline, and sequencer rules | Evidence rejected; no silent cached or spot-price fallback |
| Fix | Permissionless caller; observation inside the half-open fixing window; committed historical-evidence and disruption rules; unique fixing state | Remain pending or enter the specified disruption state |
| Settle | Permissionless caller or pinned engine; final fixing; immutable payoff and fee versions; terminal liability cover | Idempotent retry or `RecoveryRequired`; no discretionary payout |
| Exercise, roll, unwind, split, merge, transfer, amend, or novate | Position owner or exact delegated policy; lifecycle state; counterparty consent where rights change | Original position remains valid and unchanged |
| Open default | Permissionless caller with objective onchain proof under the pinned risk-domain rules; `DEFAULT_OPERATOR` may submit evidence but has no discretionary validity power | Proof rejection without state change |
| Advance recovery | Permissionless caller; precommitted waterfall, bounded recipients, and immutable `finalResolutionAt` | Isolated domain state; no arbitrary asset seizure or new economic plan |
| Emergency pause | Scoped guardian role; reason and evidence reference | Stop only named new-risk or disputed-input paths |
| Upgrade or migrate | Safe and timelock, reviewed code hash, storage and migration evidence | Existing implementation and state remain active |

No entry point may interpret an unknown enum value, open typed identifier, missing record, zero hash,
unsupported capability, stale projection, or failed external call as a permissive default.

`PreTradeLock` and `TerminalLiabilityReservation` are distinct primitives. A `PreTradeLock` is an
expiring reservation used before execution and may be released on cancellation, replacement, fill
conversion, or permissionless expiry. A `TerminalLiabilityReservation` is immutable, non-expiring
cover attached to a fully funded position. It can be consumed only by the position's terminal payout
or converted by the precommitted terminal rule into a fully collateralized claim. A lifecycle action
that changes maximum terminal liability must atomically create sufficient replacement cover before
releasing the old reservation.

## 6. Threat register and required treatment

### T-01 Oracle corruption, staleness, and scale mismatch

An attacker may manipulate a source, submit an old signed payload, select the wrong feed, exploit a
decimal mismatch, report a future timestamp, exploit an overly wide confidence interval, or force a
single-source disagreement.

Every accepted observation binds the exact `BenchmarkVersion`, adapter version, evidence class, feed
key, provider sequence or finality reference, publication time, observation time, output decimals,
confidence, candidate deadline, and applicable session proof. All session windows use half-open
intervals: an observation at `opensAt` is inside and one at `closesAt` is outside.

Historical fixing eligibility is evaluated against the committed fixing window and historical
evidence, not the live age of the observation at submission. The observation time must be inside the
half-open fixing window, the provider sequence or finality rule must pass, publication must follow the
observation without exceeding `maxPublicationLag`, confidence and scale rules must pass, and
submission must occur no later than the candidate deadline. A generic check of
`block.timestamp - publicationTime` cannot invalidate otherwise eligible historical fixing evidence.
Block time is used only for the candidate deadline, sequencer recovery grace, and other explicit
lifecycle deadlines.

A stablecoin is priced from its qualified benchmark and is never assumed to equal one unit. A DEX
spot price is never an emergency oracle. Primary-source failure follows the committed fallback or
disruption policy and never an operator-selected replacement.

### T-02 Sequencer and session failure

Arbitrum sequencing may stop, censor, reorder, or resume after a gap. A calendar or session proof may
be missing, ambiguous, outside its horizon, or inconsistent with the fixing window.

New risk and price-sensitive submission fail closed while the qualified sequencer-health condition is
down or inside its configured recovery grace period. `L2_STATE` evidence observed during the outage
or recovery grace period is permanently invalid for that fixing candidate. `EXTERNAL_SIGNED` or
`L1_FINALIZED` evidence observed during that period may remain eligible only when its bound
`BenchmarkVersion` declares `outageIndependent` and every fixing-window, provider, publication-lag,
confidence, scale, and candidate-deadline rule passes. Even eligible outage-independent evidence
cannot be submitted until the recovery grace period has ended.

Execution never assumes fair FIFO ordering. Deadlines and limits bind every time-sensitive action.
Session and calendar versions are exact and historical proofs remain usable after pause or
deprecation. A missing day proof, unsupported window kind, closed window, maintenance window, or
horizon miss cannot be treated as open.

Risk reduction that does not depend on a disputed new price remains available. A fixing that cannot
be safely observed enters its versioned disruption state and resolves only by the precommitted rule.

### T-03 Signature theft, replay, and authority confusion

A valid signature may be copied across chains, deployments, accounts, actions, versions, partial
fills, or time. A relayer may substitute a recipient, package, fee schedule, or privacy policy.

Every signed action uses EIP-712 and binds chain ID, verifying contract, domain version, action type,
signer, account or organization policy context, unique nonce or salt, deadline, exact economic object,
all immutable dependency versions, quantity, limits, fee bound, recipient, and permitted executor when
applicable. ERC-1271 signatures are checked at execution. Acceptance of an obligation that must
survive later signer-policy changes is persisted onchain at acceptance rather than revalidated at
settlement.

Nonce state is owned by the contract that consumes the action. A one-shot action consumes its nonce
atomically. A partial-fill action persists original quantity, cumulative filled quantity, and
remaining quantity under one order identifier. Cancellation advances or marks nonce state so no
later fill can revive it. A signature never authorizes arbitrary calldata, delegatecall, or an
unbounded spender.

### T-04 Callback, cross-function, cross-contract, and read-only reentrancy

Tokens, recipients, adapters, venues, and hooks may call back while related state is inconsistent.

Value-moving functions follow checks, all effects, then interactions and use one shared reentrancy
guard across every function touching shared accounting. External calls are minimized and targets are
qualified. Pull claims are preferred to push loops. No user-selected delegatecall is permitted.
Views consumed during price-sensitive or solvency-sensitive operations must either be stable for the
whole call or expose and check a reentrancy probe. Batch entry points must not create a second route
around the same lock.

### T-05 Collateral insolvency and token behavior

False returns, fee-on-transfer, rebasing, token pause, blocklist, decimals drift, proxy upgrades,
donations, or accounting bugs may separate the ledger from assets held.

Credit is created only after exact balance receipt. External transfer debits and recipient credits
are checked exactly and revert atomically. Per-binding liability and aggregate per-token liability are
both tracked. Recovery can move only verified excess above aggregate liability. Rebasing and
fee-on-transfer tokens remain unqualified unless a later adapter and accounting specification proves
compatible behavior. Token pause or blocklist may make an external transfer unavailable, but cannot
authorize an alternate recipient or ledger write-off.

### T-06 Rounding extraction and numeric ambiguity

An attacker may split one economic action into many small actions, choose sign boundaries, exploit
decimal conversions, or collect the same residual twice.

Money remains in settlement-asset minor units and ratios use the canonical WAD or PPM scale. The
canonical executable price is signed `PriceTicks`, with one tick equal to the strictly positive
`TickSizeMinor` committed by the exact market version. Price per lot is
`PriceTicks * TickSizeMinor`, and fill notional is `Lots * PriceTicks * TickSizeMinor`. Signed order,
quote, package, and fill hashes bind `PriceTicks` and the exact source of `TickSizeMinor`.
`PackagePrice` is a legacy display or migration type only and cannot enter executable hashes,
matching priority, fill validation, payoff input, or settlement.

Every division names its direction. Pre-funding collateral and liability checks round conservatively.
Final payoff, fee, credit, and rebate calculations use their exact versioned rounding rule and cannot
exceed the value funded for that transition. Every allocation returns an explicit residual, and the
owning economic rule assigns it once to a named account or carries it forward. Partitioning and
recombination must not increase a party's value beyond the explicitly bounded residual. Overflow,
underflow, narrowing, and unsupported decimals are named failures.

### T-07 Partial package execution and route failure

A solver may fill favorable legs and abandon unfavorable legs, mix incompatible versions, or leave
collateral and positions half-created.

One accepted fill is one atomic economic package. All legs, quantities, ratios, dependency versions,
fees, collateral changes, reservations, and position records commit or revert together. User-approved
partial quantity means a smaller complete package in the same exact ratios, never a subset of legs.
Rounding or minimum-lot constraints that cannot express those ratios reject the fill. An external
venue leg cannot enter a native atomic package unless its qualified adapter provides the atomic
guarantee the package requires. A later maker hedge is independent and cannot alter the user's claim.

### T-08 Maker and solver griefing

Makers may reserve capacity without quoting, quote without usable capacity, fail to reveal, cancel at
the boundary, or submit many invalid messages. Solvers may spam expensive routes, withhold a winning
route, bias ordering, or force repeated external-call failure.

Reservations have bounded size and expiry. Quote firmness, eligibility, cancellation cutoff, reveal
deadline, and penalty or forfeiture policy are committed before competition. Verification cost is
bounded before expensive calls. Auction and solver selection use deterministic rules with explicit
tie breakers. No single maker, solver, or coordinator is required for cancellation, expiry, fixing,
settlement, or recovery. Failed submissions cannot lock another party's nonce or capacity unless a
valid state transition occurred.

### T-09 Capacity double-spend

The same maker headroom may back several firm quotes, implied routes, auctions, or packages and be
consumed more than once under concurrency.

Executable pre-trade capacity is an onchain or cryptographically committed `PreTradeLock` against the
exact account, collateral, risk domain, quote or route, and expiry. Creation checks available
headroom and increments outstanding capacity atomically. Partial fill decrements remaining quote
quantity and either retains sufficient pre-trade cover or atomically converts the filled quantity's
maximum liability into `TerminalLiabilityReservation` cover. Fill, cancellation, replacement,
expiry, and release are mutually exclusive uses of the same pre-trade state. Implied routes acquire
all required component locks atomically or acquire none.

Permissionless expiry applies only to `PreTradeLock`. It can never release, shorten, or otherwise
weaken a `TerminalLiabilityReservation`. No fully funded position may exist for even one transaction
boundary without immutable terminal liability cover sufficient for its maximum terminal obligation.

### T-10 Privacy and metadata leakage

Encryption of content does not hide sender, recipient set size, timing, transaction graph, gas payer,
commitment size, repeated identifiers, sparse book changes, settlement amount, or selective
disclosure activity.

Every privacy mode publishes a leakage matrix stating what is visible to the taker, invited makers,
coordinator, risk and recovery operators, chain observers, and later receipt viewers. Onchain events,
notifications, analytics, support tools, and logs carry only the minimum committed data. Secret quote
material, plaintext RFQs, viewing keys, delegated signing material, and decryption keys never appear
in URLs, browser persistence, notification payloads, telemetry, or incident bundles. Commitments bind
the exact ciphertext and policy. Access and disclosure are auditable. The product does not claim that
an onchain fill or settlement amount remains secret unless the selected mechanism actually proves it.

### T-11 Governance, guardian, and upgrade compromise

A privileged actor may activate malicious code, change economics, pause exits, replace dependencies,
rewrite history, or seize funds.

Registration and activation use separate roles. Production material changes are proposed by a Safe
and delayed by a timelock. Emergency guardians can only stop named new-risk or disputed-input paths.
The guardian is stop-only and cannot open default. A default transition is permissionless when an
objective onchain proof satisfies the pinned risk-domain rule. `DEFAULT_OPERATOR` is only an evidence
submitter and has no discretionary power to make evidence valid, declare default, select accounts,
or choose the economic outcome.
They cannot withdraw user funds, alter settled results, redirect payouts, extend existing lock
expiry, or delete history. Core modules are immutable unless their owning specification explicitly
justifies upgradeability. An upgradeable module requires protected initialization, explicit upgrade
authorization, storage-layout compatibility, reviewed implementation and code hash, exact migration
calldata, a rehearsed rollback or forward-fix path, and an event before and after the change.

A compromised governance threshold remains a material trust assumption. Timelock notice, independent
monitoring, narrowly scoped powers, historical immutability, and preserved exits bound its impact.

### T-12 Keeper, relay, and automation failure

A scheduled action may be missed, duplicated, reordered, or executed after its assumptions expire.

Economic lifecycle transitions are permissionless wherever caller identity is not part of the rule.
Every keeper action is idempotent or consumes a unique state, has an objective eligibility time, and
has a bounded reward that cannot exceed the value secured by the action. At least two independent
operators are required for the public test phase. A failed keeper causes a pending or disruption
state, not a discretionary payout, lost claim, or permanently locked balance.

`RecoveryRequired` is an operational state only and is never an economic terminal state. Every
obligation stores an immutable `finalResolutionAt` and a precommitted final-resolution rule before the
risk is accepted. No later than `finalResolutionAt`, any caller can apply that rule to produce either
an immutable payout or a fully collateralized claim backed by the obligation's
`TerminalLiabilityReservation`. Governance cannot author, select, or amend an economic recovery plan
after the triggering event.

### T-13 Indexer divergence and false finality

An indexer may miss logs, apply them twice, process a reorganization incorrectly, project a wrong
schema, or show a pending transaction as final.

Projection keys include chain ID, block hash, block number, transaction hash, and log index. Writes
are idempotent and reversible to a common ancestor. The indexer distinguishes observed, confirmed,
and finalized states. Every balance, position, fill, fixing, and settlement reconciles to contract
state and versioned events. The UI never treats indexed state as authorization and never marks wallet
signature or broadcast as success. A divergence alarm disables affected submission surfaces in the
UI, not user access to direct contract exits.

### T-14 Cross-domain and chain-environment failure

Canonical IDs may be portable, but custody accounts, collateral IDs, nonces, reservations, balances,
positions, and authority are chain-local. Sepolia data, signatures, roles, fixtures, and mock evidence
must never authorize an action on One.

Every signature and chain-local commitment binds chain ID and verifying contract as applicable.
Deployment manifests reject test roles, mocks, and wrong code hashes on One. The core product assumes
no atomic execution across domains. Any future L1 message, bridge, or cross-chain execution path is
disabled until it has its own qualified adapter, source and destination replay key, finality rule,
timeout, duplicate handling, refund or recovery outcome, and solvency analysis. A hedge performed on
an external domain cannot invalidate the user's native Setryn claim if that hedge fails.

### T-15 Market ordering and value extraction

Sequencer ordering, copied transactions, or disclosed intent may worsen execution or win a race.

Every fill enforces the user's exact limit, maximum input or minimum output, fee bound, and deadline.
Sealed or commit-reveal modes bind commitments before reveal and define non-reveal handling. Auction
and batch modes use an ordering-independent clearing rule where promised. Liquidation and default
rewards are bounded and objective. The interface distinguishes executable price, oracle index, mark,
model value, and indicative estimate.

### T-16 Denial of service and unbounded work

Unbounded arrays, pathological packages, duplicate legs, revert-heavy callbacks, or state growth may
make execution or settlement impossible.

Every list has a configured maximum; inputs are canonically sorted or uniquely keyed; duplicate
entries are rejected; and loops are bounded independently of total protocol history. Lifecycle and
withdrawal paths do not enumerate all users, positions, operators, or versions. Expensive route
validation is paid by or bounded against the submitting party.

## 7. Fail-closed and emergency behavior

### 7.1 New-risk gate

Opening or increasing risk requires every applicable condition to be true at execution time:

- exact market, instrument, payoff, fee, risk-domain, settlement-asset, benchmark, session, calendar,
  and adapter versions exist and are supported;
- the exact versions are active for new risk and every dependency remains open;
- oracle, sequencer, session, capacity, collateral, account policy, organization approval, nonce,
  deadline, cap, and user-limit checks pass;
- all required external calls succeed with exact expected results.

Unknown, missing, stale, disputed, unsupported, mismatched, overflowed, or unavailable inputs close the
path. There is no permissive default, active-pointer substitution, cached-price substitution, spot
fallback, or partial package fallback.

### 7.2 Risk-reducing and historical paths

Pause and deprecation stop new risk. They do not erase or invalidate exact historical versions.
Subject to the immutable rights of counterparties, the following paths remain reachable without
requiring current Active status:

- withdrawal of available collateral under a historical binding;
- permissionless release of expired `PreTradeLock` records and other explicitly expiring pre-trade
  locks;
- cancellation of unfilled risk and reduction of open exposure;
- proof verification, fixing, settlement, default, recovery, receipt replay, and audit under the
  versions pinned when the position was created.

Settlement continues during a scoped pause when it uses an already accepted final fixing and pinned
rules. If the required fixing is disputed or unavailable, settlement enters the committed challenge,
fallback, or disruption path. `RecoveryRequired` does not extend economic uncertainty beyond the
immutable `finalResolutionAt`. A guardian cannot choose a replacement price or payout.

`TerminalLiabilityReservation` cover is never an expiring lock. It remains reserved through pause,
default, disruption, and `RecoveryRequired` until terminal consumption or creation of the fully
collateralized claim required by the precommitted rule.

No protocol promise can force an externally paused or blocklisted token to transfer. In that case the
ledger and claim remain intact, no alternate recipient is selected, and the incident follows the
precommitted recovery policy.

### 7.3 Emergency powers

Emergency controls are separate capabilities, not one global pause:

- stop new risk for one market, benchmark, adapter, settlement asset, or risk domain;
- stop acceptance of new oracle evidence from one source;
- stop one execution mode or one compromised operator;
- place a disputed fixing into its committed challenge state;
- revoke operational roles and rotate relays or keepers;
- reduce future caps through the governed path.

Emergency authority cannot:

- debit or withdraw user collateral;
- pause available-balance withdrawal or permissionless expiry release;
- open default, validate default evidence by discretion, or select a default target;
- rewrite a definition, signature, order, fill, position, fixing, or settlement;
- release or shorten a `TerminalLiabilityReservation` before terminal consumption or claim creation;
- increase a user's obligation, redirect a payout, extend an existing expiry, or bypass a challenge;
- extend `finalResolutionAt` or author a new economic recovery plan after the event;
- activate new code, a new adapter, or a new economic version without its normal governance path;
- delete events, evidence, or historical resolution.

Every emergency action is linked to scope, caller, timestamp, previous state, new state, and a
nonzero incident-evidence reference. The emergency controller or governance wrapper emits the
reference when an existing base registry event cannot carry it. Resumption repeats live dependency
checks and does not happen implicitly.

## 8. Verification tiers

The tiers below identify planned evidence. They do not require broad review after each implementation
slice. Evidence is accumulated and reviewed at the owning phase gate, targeted to surfaces changed in
that phase.

| Tier | Evidence | Normal gate |
| --- | --- | --- |
| V0 | Specification trace, call graph, role matrix, state machine, and manual threat review | Phase 0 |
| V1 | Focused unit tests for authorization, boundaries, exact errors, and terminal states | Owning phase gate |
| V2 | Fuzz and differential properties for arithmetic, hashing, allocation, payoff, and serialization | Phase 1 or 2 |
| V3 | Stateful invariant handler across adversarial call sequences and actors | Phase 1 for custody; Phase 2 for exchange |
| V4 | Local integration and full lifecycle state-machine scenarios with adversarial dependencies | Phase 2 or 3 |
| V5 | Pinned Arbitrum One fork, current-block fork, and Arbitrum Sepolia public rehearsal | Phase 4 or 5 |
| V6 | Static analysis, upgrade and incident rehearsal, independent review, and launch configuration review | Phase 6 |

## 9. Named protocol invariants

### 9.1 Safety invariants

| ID | Invariant | Scope | Planned verification |
| --- | --- | --- | --- |
| SAFE-01 Exact-new-risk gate | No new or increased risk enters unless every exact version, dependency, capability, live-data bound, cap, signature, and collateral check succeeds in the same transaction. | Registries, execution, clearing, settlement adapters | V1, V3, V4, V5 |
| SAFE-02 Atomic-package fill | A package fill creates all authorized legs, fees, collateral effects, reservations, and positions or creates none. Partial quantity still preserves the full leg set and exact ratios. | Package compiler, matcher, solver, clearing | V1, V2, V3, V4 |
| SAFE-03 No capacity double-spend | For each account and risk domain, live reservations stay within reservation caps, current liability stays within liability caps, reservations remain inside uncommitted liability headroom, and one reservation can reach only one terminal use. | Quotes, RFQ, auction, implied liquidity, collateral locks | V1, V3, V4 |
| SAFE-04 Risk-domain isolation | A loss, pause, default, insurance draw, or recovery in one risk domain cannot consume collateral or authority assigned exclusively to another domain. | Clearing, insurance, default, recovery | V1, V3, V4, V5 |
| SAFE-05 Reentrancy consistency | No external callback can observe and exploit a state in which related ledger, reservation, position, or aggregate fields disagree. | Vault, adapters, venues, recipients, batch calls | V1, V3, V4 |
| SAFE-06 Terminal-state monotonicity | Filled, canceled, expired, settled, deprecated, consumed, released, and recovered terminal records never return to a live state. | All state machines | V1, V3 |
| SAFE-07 Pinned economics | An accepted order or position uses the exact immutable versions named at acceptance. Moving active pointers cannot change its payoff, margin rule, fee, fixing, session, or settlement rule. | Execution through receipt replay | V1, V3, V4 |
| SAFE-08 Bounded external authority | No token, adapter, venue, solver, keeper, relayer, callback, or privacy component can select an arbitrary storage context, debit, recipient, or payout. | Every external integration | V0, V1, V4, V6 |
| SAFE-09 Disputed-data containment | Future, low-confidence, fixing-window-invalid, provider-sequence-invalid, publication-late, candidate-expired, sequencer-unsafe, or disputed evidence cannot open risk or silently become a fixing. Historical fixing eligibility never depends on live block-time age. | Benchmark, oracle relay, fixing, UI | V1, V2, V4, V5 |
| SAFE-10 Cross-environment separation | Sepolia state, signatures, fixtures, roles, mocks, and manifests cannot authorize or resolve One state, and the converse holds for chain-local objects. | Signatures, deployment, custody, adapters | V1, V2, V5, V6 |
| SAFE-11 Permanent terminal cover | Every fully funded position has sufficient immutable `TerminalLiabilityReservation` cover at every transaction boundary. No expiry path, guardian, keeper, operator, lifecycle action, or governance action can remove that cover before terminal consumption or creation of a fully collateralized claim. | Execution, collateral, positions, settlement, recovery | V1, V3, V4, V5 |

### 9.2 Accounting invariants

| ID | Invariant | Scope | Planned verification |
| --- | --- | --- | --- |
| ACCT-01 Token solvency | After every successful protocol-controlled transition, vault token balance is at least aggregate token liability for every credited token. Out-of-band token drift closes new risk and raises an incident instead of permitting further credit. | Collateral vault and token bindings | V1, V3, V5 |
| ACCT-02 Ledger conservation | Sum of account totals for one `CollateralId` equals its liability; sum of collateral liabilities for binding versions sharing a token equals token liability; token balance above that liability is excess and never account credit. | Collateral vault | V2, V3 |
| ACCT-03 Lock conservation | For every account and collateral ID, the total locked or reserved amount is at most the account total and equals active `PreTradeLock` remaining amounts plus active `TerminalLiabilityReservation` cover. A reservation's remaining amount never exceeds its initial amount. | Collateral locks and reservations | V1, V3 |
| ACCT-04 Exact transfer credit | A deposit creates credit only for the exact amount received, and an external withdrawal commits only if both the vault debit and recipient credit equal the ledger debit. | Collateral vault and qualified tokens | V1, V4, V5 |
| ACCT-05 Fill conservation | Each fill conserves package quantity, creates equal and opposite contractual obligations where applicable, and records every fee or transfer as a named balancing entry. | Matcher, positions, fee engine | V1, V2, V3, V4 |
| ACCT-06 Settlement conservation | Total debits, credits, fees, insurance movements, keeper rewards, and explicit rounding residual for one settlement balance exactly to zero in the settlement asset. | Settlement and recovery | V1, V2, V3, V4 |
| ACCT-07 Bounded rounding | Every rounded result brackets the exact rational result in its named direction, and the explicit residual is bounded, assigned once, and never claimable twice. | Math, payoff, fees, allocation, settlement | V1, V2, differential vectors |
| ACCT-08 No partition gain | Splitting and recombining an equivalent order, position, fee, payout, or allocation cannot increase a party's value beyond the policy's explicit bounded residual. | Financial math and all consumers | V2, V3 |
| ACCT-09 Cap containment | Account liability is at most domain liability; account reservation is at most domain reservation; reservations remain inside liability headroom; actual live state remains within every active cap. | Risk domain and clearing | V1, V2, V3 |
| ACCT-10 Funded rebates and rewards | A rebate, keeper reward, solver reward, or insurance payment cannot be promised or paid unless its specific budget is reserved and solvent. | Fee, lifecycle, default, insurance | V1, V3, V4 |
| ACCT-11 Reservation-class conservation | Expiring `PreTradeLock` totals and non-expiring `TerminalLiabilityReservation` totals are accounted separately. Fill conversion, lifecycle replacement, terminal consumption, and claim creation conserve their combined covered amount without a gap or double count. | Collateral, execution, positions, settlement | V1, V3, V4 |

### 9.3 Authorization invariants

| ID | Invariant | Scope | Planned verification |
| --- | --- | --- | --- |
| AUTH-01 Exact caller authority | Every state mutation is permissionless by explicit design or checks the exact user, account, pinned operator, delegated policy, or protocol role required for that action. | All contracts and services that submit transactions | V0, V1, V3, V6 |
| AUTH-02 Signature domain separation | A signed action is invalid under a different chain, verifying contract, domain version, action type, signer, account context, or economic object. | EIP-712 consumers and wallets | V1, V2, V4 |
| AUTH-03 Replay and fill bound | Consumed or canceled one-shot nonces never execute again; partial fills cannot exceed original quantity; cancel and fill cannot both win for the same remaining quantity. | Orders, quotes, RFQ, permits, lifecycle instructions | V1, V3, V4 |
| AUTH-04 Two-layer collateral authority | New pledges require protocol-level locker authority plus current account approval; consumption requires current settler authority plus the settler pinned to that lock. Neither layer alone moves collateral. | Collateral vault and clearing engines | V1, V3 |
| AUTH-05 Control handover revocation | Account-control transfer requires acceptance by the new controller and invalidates prior delegated approvals without invalidating existing locks or balances. | Collateral accounts and organization policy | V1, V3 |
| AUTH-06 Qualification separation | Registration or qualification alone never opens risk. Activation is separately authorized and repeats live dependency checks. | Every registry and market activation | V1, V3, V5 |
| AUTH-07 Capability exactness | A consumer accepts only the exact kind, interface, capability, risk model, fee model, and configuration version it implements. Unknown or extra capability is not treated as compatible. | Adapters, benchmark, risk, fee, privacy | V1, V2, V4 |
| AUTH-08 Governance scope | Guardian, status manager, qualifier, upgrader, treasury, recovery, keeper, and settler powers are distinct; no operational role can withdraw user funds or rewrite history. | Roles, Safe, timelock, manifests | V0, V1, V5, V6 |
| AUTH-09 Disclosure authorization | Decryption, selective disclosure, and receipt publication reveal only fields permitted by the committed policy and log an auditable disclosure reference. | Privacy and receipts | V1, V4, V6 |
| AUTH-10 Objective default | Default opens only through a permissionless transition whose objective onchain proof satisfies the pinned rule. The guardian cannot open default, and `DEFAULT_OPERATOR` can submit evidence but cannot confer validity or choose a target or outcome. | Risk, default, recovery, roles | V1, V3, V4, V6 |

### 9.4 Liveness invariants

| ID | Invariant | Scope | Planned verification |
| --- | --- | --- | --- |
| LIVE-01 Available withdrawal | The controller can attempt withdrawal of available collateral under every historical binding without current Active status or a protocol pause gate. | Collateral vault | V1, V3, V5, V6 |
| LIVE-02 Expiry release | Any caller can release a reservation or collateral lock after its immutable expiry without the original operator, keeper, or active dependency. | Locks and reservations | V1, V3, V4 |
| LIVE-03 Permissionless lifecycle progress | Any eligible caller can advance fixing, settlement, default auction, and recovery steps whose result is fully deterministic, with idempotent retry. | Lifecycle and settlement | V1, V3, V4, V5 |
| LIVE-04 Keeper replaceability | Loss of one keeper, relay, maker, solver, privacy coordinator, or RPC cannot make a deterministic user claim permanently unreachable. | Offchain automation and contracts | V4, V5, V6 |
| LIVE-05 Scoped pause | Emergency action stops only its named risk-increasing or disputed-input path. Unaffected domains, cancellation, bounded risk reduction, historical proof, withdrawal, and deterministic settlement remain reachable. | Governance and all state machines | V1, V3, V4, V6 |
| LIVE-06 Disruption termination | Missing oracle data, closed session, sequencer outage, failed delivery, or token-transfer failure enters a versioned pending, fallback, challenge, or recovery state with a defined next condition. | Benchmark, settlement, delivery | V0, V1, V4, V5 |
| LIVE-07 No history-sized loop | User exits and lifecycle transitions have work bounded by the affected object, not by total users, positions, versions, operators, or protocol age. | All contracts | V0, V1, gas checks at V5 |
| LIVE-08 Bounded economic terminality | `RecoveryRequired` is operational only. By immutable `finalResolutionAt`, a permissionless precommitted rule produces an immutable payout or a fully collateralized claim, without a post-event governance-authored economic plan. | Settlement, default, recovery, claims | V1, V3, V4, V5, V6 |

### 9.5 Determinism invariants

| ID | Invariant | Scope | Planned verification |
| --- | --- | --- | --- |
| DET-01 Canonical identity | The same canonical definition derives the same chain-portable ID, while custody objects and operational qualifications deliberately bind their chain-local context. | IDs, schemas, registries | V1, V2 |
| DET-02 Canonical encoding | Each signed message, commitment, Merkle leaf, package, leg list, and evidence object has one accepted ordering and encoding. Duplicates and ambiguous forms are rejected. | Schemas, hashing, privacy, packages | V1, V2, differential vectors |
| DET-03 Deterministic matching | Given the same eligible orders, capacities, limits, timestamps, and tie-break inputs, every conforming matcher selects the same accepted fill. | Book, auction, batch, solver | V2, V4 |
| DET-04 Deterministic financial math | Onchain and offchain implementations produce identical payoff, margin, fee, allocation, fixing, and settlement values under the same versioned inputs and rounding rules. | Contracts, risk service, UI preview, receipts | V2, V4, V5 |
| DET-05 Coherent market snapshot | Marks, quotes, books, routes, charts, and preflight numbers compared in one view carry source and snapshot identity and cannot silently mix incompatible observation times or price classes. | Market data, indexer, UI | V1, V4, V5 |
| DET-06 Replayable receipt | A receipt can be recomputed from signed inputs, exact versions, transaction data, logs, fixing evidence, and deterministic rules without trusting the receipt service. | Receipts and audit | V2, V4, V5 |
| DET-07 Network parity | Given the same canonical inputs and configured dependency behavior, core economic logic produces the same result on Sepolia and One. | Contracts and shared schemas | V2, V5 |
| DET-08 Canonical executable price | Executable hashes, matching, fill validation, and settlement derive price only as signed `PriceTicks * TickSizeMinor` per lot under the exact market version. Legacy `PackagePrice` cannot enter any executable or settlement path. | Schemas, orders, quotes, packages, matcher, settlement | V1, V2, V4 |
| DET-09 Historical fixing eligibility | A historical fixing candidate is accepted identically regardless of later submission time except for its candidate deadline and sequencer recovery gate. Eligibility uses the half-open fixing window, provider sequence or finality, `maxPublicationLag`, confidence, scale, evidence class, and `outageIndependent` rule. | Benchmark, fixing, receipts | V1, V2, V4, V5 |

### 9.6 Historical-resolution invariants

| ID | Invariant | Scope | Planned verification |
| --- | --- | --- | --- |
| HIST-01 Append-only versions | Registered definitions and version commitments are never edited or deleted; status is the only allowed registry mutation and Deprecated is terminal. | All registries | V1, V3 |
| HIST-02 Exact-version resolution | Every order, position, fixing, settlement, recovery, and receipt resolves the exact version captured at creation, never a moving latest or active pointer. | Full lifecycle | V1, V3, V4 |
| HIST-03 Retirement survival | Paused or deprecated definitions remain resolvable for withdrawal, unwind, fixing, settlement, recovery, proof verification, receipt replay, and audit. | Registries and consumers | V1, V3, V4 |
| HIST-04 Event reconstruction | Versioned events plus chain state are sufficient to reconstruct every authoritative state transition without a privileged database edit. | Contracts and indexer | V1, V4, V5 |
| HIST-05 Evidence availability | Every nonzero evidence hash used for qualification, fixing, disclosure, emergency action, upgrade, or incident refers to retrievable, integrity-checked content retained for the required lifetime. | Operations, manifests, receipts | V0, V5, V6 |
| HIST-06 Correction without rewrite | A corrected schedule, benchmark, configuration, fixing, or policy creates an explicit new version or challenge outcome and preserves the superseded record. | Registries, fixing, governance | V1, V4, V6 |
| HIST-07 Reorg-safe history | Provisional indexed history can roll back to a common ancestor; finalized receipts identify their finality basis and never merge events from competing block hashes. | Indexer, receipts, UI | V4, V5 |

## 10. Current implementation alignment

The current Phase 1 contract foundation already supports the following parts of this specification:

- canonical and chain-local typed IDs are separated;
- registry versions are immutable, status transitions are explicit, and historical versions remain
  resolvable;
- qualification and activation are separate and activation repeats live dependency checks;
- adapter and settlement-token runtime code hashes are pinned, with proxy limitations documented;
- the collateral vault credits and transfers exact token amounts, tracks per-binding and per-token
  liability, rejects recovery beyond excess, protects shared paths from reentrancy, and publishes a
  read-only reentrancy probe;
- collateral account control is two-step, operator approvals are epoch scoped, settlement operators
  are pinned to locks, and expired locks are permissionlessly releasable;
- withdrawal uses historical binding resolution instead of current Active status;
- numeric libraries require explicit rounding and return allocation residuals;
- the EIP-712 helper binds chain ID and verifying contract and validates action, signer, and deadline.

The helper does not consume nonces by itself. Every future signature-consuming contract must own and
verify its nonce, cancellation, cumulative-fill, and replay state. The current registries and vault do
not implement the later execution, oracle observation, fixing, position, settlement, default,
privacy, or cross-domain state machines. Those modules must satisfy this document when added.
The current `CollateralVault` also has only expiring collateral locks. It does not implement the
non-expiring `TerminalLiabilityReservation` Phase 1 primitive required by SAFE-11 and ACCT-11. Its
permissionless expiry release is valid for pre-trade locks but cannot be reused for terminal liability
cover. A fully funded position path remains blocked until the separate primitive exists and is
atomically wired into fill, lifecycle replacement, terminal consumption, and claim creation.
Current base registry status events also do not carry an incident-evidence reference. Until an
emergency controller or governed wrapper supplies that link, the deployment runbook must bind the
status transaction hash to the retained incident record. Arbitrum One activation requires the durable
onchain linkage described in section 7.3.

## 11. Incident evidence requirements

An incident record must make the event independently reconstructable without publishing secrets. At
minimum it contains:

1. Incident ID, UTC timeline, affected networks, contracts, markets, accounts or pseudonymous
   identifiers, risk domains, and first and last affected blocks.
2. Block numbers and hashes, transaction hashes, log indices, raw calldata, receipts, relevant traces,
   revert data, and the finality or reorganization state used during analysis.
3. Exact deployed bytecode hashes, implementation and proxy-admin state where relevant, compiler and
   source revision, deployment manifest, role membership, Safe proposal, timelock operation, and
   initializer or migration calldata.
4. Signed typed-data payloads or their canonical hashes, recovered signer, nonce state, deadlines,
   cancellation state, cumulative fills, and organization-policy version.
5. Order, quote, RFQ, auction, package, solver-route, `PreTradeLock`,
   `TerminalLiabilityReservation`, capacity, position, fee, margin, insurance, fixing, settlement,
   claim, recovery, and `finalResolutionAt` identifiers and exact versions.
6. Oracle payload, evidence class, feed key, publisher or attestation reference, publication and
   observation times, `maxPublicationLag`, candidate deadline, provider sequence or finality,
   confidence, decimals, half-open session and fixing-window proof, sequencer outage and grace-period
   state, `outageIndependent` value, and every fallback or disruption decision.
7. Vault token balances, aggregate liabilities, per-binding liabilities, account totals and locks,
   cap usage, reservation state, and balancing entries immediately before and after the incident.
8. Keeper, relay, maker, solver, privacy coordinator, indexer, RPC, and reconciliation logs with
   synchronized timestamps and software revisions.
9. Indexer checkpoint, schema version, processed block hash, rollback history, reconciliation result,
   and the exact query or projection that produced a disputed user view.
10. Privacy commitment, ciphertext hash, access-policy version, disclosure audit, and leakage analysis.
    Plaintext, viewing keys, signing keys, decryption keys, authentication tokens, and unrelated user
    data are excluded from the general incident bundle and handled only under the approved restricted
    evidence process.
11. Every emergency action, rejected alternative, user-impact assessment, communication timestamp,
    recovery transaction, and post-incident invariant or regression evidence.

An onchain hash without retained retrievable content is not sufficient evidence. Evidence storage has
at least two independently controlled copies, integrity checks, access logs, and a retention period no
shorter than the lifetime of the affected positions and the applicable operational requirement.

## 12. Implementation and release gates

Each implementation handover identifies the invariants it can affect and the planned verification
tier. A module cannot be called complete because its normal path works while its applicable invariant
or failure state is absent.

At the Phase 1 gate, custody conservation, historical withdrawal, registry immutability,
qualification separation, exact identity, deployment separation, and a non-expiring
`TerminalLiabilityReservation` primitive distinct from expiring pre-trade locks are required.

At the Phase 2 gate, atomic package execution, replay protection, capacity and terminal-cover
conservation, canonical tick pricing, objective default, historical fixing eligibility, payoff and
rounding properties, risk isolation, settlement conservation, keeper replacement, and bounded
economic terminality are required.

At the Phase 3 gate, first-party UI and internal service state must reconcile to contracts, use one
coherent market snapshot, display privacy leakage and transaction finality honestly, and preserve
direct user exits during indexer or service failure.

At the Phase 4 and 5 gates, the exact dependency code, token behavior, sequencer handling, oracle
payloads, reorganization behavior, manifests, and lifecycle paths are rehearsed on a pinned One fork,
a current One fork, and Sepolia as applicable.

At the Phase 6 gate, changed security-critical surfaces receive targeted static analysis,
independent review, incident rehearsal, upgrade or migration rehearsal, and production role and
timelock review. Withdrawal and deterministic settlement are exercised under every scoped pause.

## 13. Remaining product and deployment decisions

The threat model itself has no open safety rule. The following values and mechanism selections remain
genuine owning-spec or deployment decisions and must be fixed before the affected capability is
activated:

1. The exact Safe threshold, signer composition, timelock duration, and maximum emergency scope for
   each Arbitrum One role.
2. Whether each future stateful core module is immutable or upgradeable. Upgradeability is opt-in and
   requires the controls in T-11; it is not inherited from the existence of a migration plan.
3. Per-benchmark oracle quorum, live new-risk staleness, `maxPublicationLag`, confidence, candidate
   deadline policy, sequencer recovery grace period, `outageIndependent` value, challenge window,
   fallback, and disruption outcome. The historical fixing semantics in T-01 and T-02 are fixed.
4. Per-risk-domain margin model, caps, liquidation and default auction parameters, insurance funding,
   and terminal loss-allocation waterfall.
5. The production privacy mechanism, its key custody and recovery design, retention policy, and
   measured metadata-leakage budget for each privacy mode.
6. Keeper and solver reward amounts, non-reveal penalties, auction tie breakers, and operation-specific
   timeouts, within the bounded and deterministic rules above.
7. Whether any cross-domain user feature is needed. It remains disabled by default and requires a
   separate threat model and qualification before implementation or activation.

These decisions cannot be replaced by an operator convention, UI default, private document, or
database flag. They enter as versioned specifications, deployment manifests, or qualified onchain
commitments before the corresponding gate.
