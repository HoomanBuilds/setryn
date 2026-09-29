# Setryn Roles and State Machines

Date: 2026-09-25
Status: Phase 0 implementation specification
Scope: protocol authority, transition ownership, lifecycle safety, and reconciliation
Depends on: [`../plans/setryn-mainnet-equivalent-build-plan.md`](../plans/setryn-mainnet-equivalent-build-plan.md), [`../plans/setryn-repository-and-agent-execution-plan.md`](../plans/setryn-repository-and-agent-execution-plan.md), and [`setryn-interface-spec.md`](setryn-interface-spec.md)

## 1. Decision and scope

This specification closes the Phase 0 role-matrix and protocol-state-machine lane. It is normative for contracts, internal schemas, indexer projections, lifecycle workers, and first-party product state. It does not define public APIs, external SDKs, webhooks, widgets, or partner tooling.

The central rules are:

1. Registration, qualification, activation, emergency pause, and lifecycle execution are different authorities.
2. Operational qualification never opens risk. Chain-local and economic-policy versions register in `Paused` and require a separate activation decision. The unversioned canonical asset identity registry is the narrow exception described in section 6: registration marks an identity active but cannot by itself accept collateral or open a market.
3. A pause stops new or increasing risk at the narrowest available scope. It does not erase history, rewrite economics, block cancellation, or strand a safe user exit.
4. Historical versions remain resolvable for unwind, fixing, settlement, recovery, receipts, and audit.
5. User authorization and protocol authorization are both required where a transition affects user value. One never substitutes for the other.
6. Value-moving paths are atomic, replay protected, bounded, and reconstructible from signed inputs plus chain events.
7. Keepers can progress objective, time-gated lifecycle work without discretionary economic authority.
8. Unsupported identifiers, versions, capabilities, callers, signatures, evidence, or state combinations fail closed.
9. Unknown transaction outcome is a client or service reconciliation state, never evidence that an economic transition succeeded.
10. No privileged actor may edit a settled result in place. Corrections append evidence and can affect value only through a compensation or terminal rule committed before market activation.

## 2. Normative vocabulary and state conventions

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

Every durable protocol object MUST have:

- a typed identifier and immutable type/version tag;
- an explicit `Unspecified` or absent sentinel that is never a stored live state;
- an append-only state enum whose existing ordinals are never reordered or removed;
- an immutable definition or a reference to an immutable versioned definition;
- a monotonic transition sequence or state version;
- creation and last-transition block metadata in the indexer;
- every applicable deadline stored as an absolute UTC timestamp;
- a transition event containing object ID, prior state, new state, caller, operation ID, and cause or evidence hash;
- a terminal-state rule and an explicit list of legal outgoing transitions.

Contracts MUST reject an unknown object before evaluating a transition. They MUST reject an unsupported enum ordinal, typed capability, or version rather than mapping it to a default. Services MUST preserve unknown values for diagnostics but MUST NOT act on them.

### 2.1 Onchain state and transaction-observation state

Economic state and transaction observation are separate axes.

Onchain economic state is authoritative. First-party clients and services MAY project the following transaction states around a requested transition:

`NotSubmitted -> AwaitingWallet -> Signed -> Broadcast -> Included -> Finalized`

The following branches are also required:

- `AwaitingWallet -> WalletRejected`, which is terminal for that attempt;
- `Broadcast -> SubmissionUnknown -> Reconciling -> Included`, `Replaced`, `Dropped`, or `NotApplied`;
- `Included -> Reorged -> Reconciling` before configured finality;
- `Broadcast -> Replaced`, where the replacement transaction hash is linked to the same semantic operation;
- `Reconciling -> ManualReview` only after all deterministic checks are exhausted.

`Signed`, `Broadcast`, and `Included` MUST NOT be presented as economic success. Success is the required protocol terminal state at the configured finality threshold.

### 2.2 Canonical authorization envelope

Every signed user, maker, solver, or delegated-policy action MUST commit to at least:

- schema version and action type;
- chain ID and verifying contract;
- signer and controlled `AccountId` or organization policy ID;
- exact object, definition, and dependency version IDs;
- payload hash, side, quantity, and economic bounds where applicable;
- nonce space and nonce;
- `validAfter` and `validBefore`;
- permitted executor or executor class when execution is restricted;
- fee schedule and maximum fee;
- privacy and disclosure policy where applicable.

Nonces are scoped by signer, account, action type, and verifying contract unless a narrower schema explicitly proves that cross-action collision is impossible. Cancellation consumes either the exact nonce or a monotonic nonce floor. A consumed nonce can never become valid again, including after a controller transfer.

### 2.3 Canonical operation identity and idempotency

Every state-changing service request MUST carry one stable `operationId` for the intended economic action. Retrying transport reuses that ID. Repricing, changing size, changing authority, or replacing a signed payload creates a new operation ID and links the prior operation as superseded.

Contracts enforce idempotency through object existence, nonces, fill accounting, state guards, and one-time evidence consumption. Services enforce idempotency through a unique operation record and transaction-attempt children. An already applied operation returns or projects the existing result. It MUST NOT repeat a transfer, reward, fill, or receipt issuance.

## 3. Authority architecture

### 3.1 Authority classes

| Authority | Principal | Permitted purpose | Explicitly forbidden |
| --- | --- | --- | --- |
| Account controller | User wallet, smart account, or organization policy account | Control account, withdraw available collateral, approve account-scoped operators, authorize orders and lifecycle actions | Alter protocol qualification, debit another account, consume a collateral lock |
| Delegated signer | Session key or organization delegate constrained by signed policy | Sign only permitted action types within market, notional, fee, time, and destination bounds | Withdraw, change controller, broaden its own policy, grant protocol roles |
| Registration or qualification authority | Qualification Safe or a bounded registrar contract | Append a version and its evidence commitment in `Paused`; register a canonical asset identity under the section 6 exception | Activate an operational version, overwrite history, move user value |
| Activation authority | Governance timelock controlled by the protocol Safe | Activate qualified versions, resume paused scope, change bounded configuration, deprecate versions | Bypass dependency checks or historical resolution |
| Emergency guardian | Independent guardian Safe through a scope-restricted controller | Pause new or increasing risk and disable operational principals through predeclared kill switches | Activate, resume, transfer value, change economics, administer arbitrary roles, block preserved exits |
| Collateral locker | Qualified execution or clearing module | Create a bounded expiring pre-trade lock after account approval | Withdraw, consume, extend, redirect, or use that lock as post-fill terminal backing |
| Terminal-reservation creator | Clearing engine acting inside an authorized atomic fill | Convert exact pre-trade backing into a non-expiring position-specific `TerminalLiabilityReservation` | Create unbacked liability, add an expiry, release it, or bind it to another position |
| Collateral settler | Qualified settlement engine pinned into a lock or terminal-liability reservation | Consume an immediate-payment lock or resolve terminal backing under the exact position outcome | Consume other backing, withdraw tokens, change the recipient rule, or release terminal backing before terminal outcome |
| Matcher or solver | Permissionless caller or qualified solver, depending on mode | Submit mutually authorized executable fills | Invent authorization, exceed price or quantity bounds, choose undisclosed fees |
| Keeper | Permissionless caller or registered operator where data access requires it | Progress objective deadline and evidence based transitions | Choose arbitrary prices, payouts, counterparties, or policy |
| Oracle relay or evidence submitter | Any caller with valid evidence, or a qualified relay when entitlement requires it | Deliver verifiable benchmark evidence | Select an unsupported feed or waive validity bounds |
| Default caller | Any caller through the default engine | Open a default process only by supplying an objective onchain breach proof | Force an invalid default, choose the affected scope, or skip challenge and cure rules |
| Default evidence operator | Address holding `DEFAULT_OPERATOR_ROLE` | Submit or relay default evidence for permissionless verification | Open a default by discretion, bypass proof verification, or choose a liquidation outcome |
| Default bidder | Qualified account satisfying bid collateral and eligibility | Submit or reveal a bounded bid | Set auction rules, access other sealed bids, bypass settlement checks |
| Excess recovery operator | Governance timelock or treasury recovery Safe through a bounded module | Move token balance strictly above total token liability | Touch credited or locked collateral |
| Indexer and reconciler | Unprivileged read and projection services | Rebuild and compare state, raise incidents | Author protocol truth or mutate balances |
| Receipt assembler | Unprivileged deterministic service | Assemble evidence from signed records and finalized events | Claim finality without evidence or rewrite prior receipts |

### 3.2 Production control topology

Arbitrum One MUST use separate principals for these control planes:

1. `Protocol Safe`: owns the governance timelock proposer role. It approves activation, resumption, role administration, migrations, and non-emergency configuration.
2. `Guardian Safe`: can call only immediate pause and predeclared operational kill switches through a scope-restricted controller.
3. `Qualification Safe`: can append registry versions and evidence commitments. Operational versions always land paused. Canonical asset identity registration follows the section 6 exception.
4. `Treasury Safe`: receives protocol revenue and owns budgets. It has no direct custody-account debit authority.
5. Operational identities: independent keeper, oracle-relay, maker, solver, and deployment keys with no admin role.

No production EOA may hold a default-admin, activation, qualification, guardian, or excess-recovery role. A Safe signer MAY participate in more than one Safe only when the deployment manifest records the overlap and the resulting compromise threshold. The Guardian Safe MUST retain an independent threshold from the Protocol Safe.

The Protocol Safe MUST act through a timelock for role grants, activation, resumption, deprecation, economic-policy changes, adapter changes, and migrations. The delay MUST be nonzero on Sepolia and at least 48 hours on Arbitrum One. Default-admin transfer MUST use `AccessControlDefaultAdminRules` with a delay at least as long as the governance timelock. A longer delay MAY be configured in the deployment manifest.

Emergency pause and predeclared operational kill switches are immediate. They MUST NOT share a callable path with activation or resumption. Arbitrary AccessControl role administration remains timelocked. Where an existing registry exposes activation, pause, and deprecation behind one `STATUS_MANAGER_ROLE`, that role MUST be held by a policy-controller contract. The controller gives the Guardian Safe only the pause selector and gives the governance timelock the activate, resume, and deprecate selectors. Granting the shared role directly to the Guardian Safe is forbidden.

Core contracts are non-upgradeable by default. A replacement is a new deployment and versioned migration. Any future proxy deployment requires a separate specification, qualified implementation and admin code hashes, a governance timelock, storage-layout evidence, and a preserved exit path.

### 3.3 Safe policy minimums

| Control plane | Arbitrum One minimum | Sepolia | Local and fork |
| --- | --- | --- | --- |
| Protocol Safe | At least 3 signers and threshold at least 2, routed through timelock | Multisig or deterministic test Safe, nonzero delay | Deterministic test identities |
| Guardian Safe | At least 3 signers and threshold at least 2 | Separate test guardian identity | Deterministic guardian fixture |
| Qualification Safe | Multisig threshold at least 2 | Test qualification identity | Deterministic qualification fixture |
| Treasury Safe | Multisig threshold at least 2 | Test treasury identity | Deterministic treasury fixture |
| Default admin | Governance timelock contract | Timelock contract | Delayed admin fixture |

The release manifest fixes actual signer addresses, thresholds, timelock delays, role holders, and role admins. Signer identities and private material never enter the repository.

### 3.4 Environment separation

- Local, fork, Sepolia, and Arbitrum One use different deployers, Safe owners, guardians, operators, makers, relays, and signing domains.
- A signature from one chain or verifying contract is invalid everywhere else.
- Test roles and mock implementations MUST be rejected by the Arbitrum One manifest validator.
- Mock oracle and venue implementations MUST contain an immutable Arbitrum One chain guard.
- Fork operation is simulation only. No fork key or script may broadcast to Arbitrum One.
- Sepolia role ownership mirrors production topology even when signer counts are smaller.
- Configuration differences live in reviewed manifests and registry versions, not branches inside financial logic.

## 4. Contract role matrix

### 4.1 Existing Phase 1 contracts

| Contract | Existing role | Production holder | Authority and constraint |
| --- | --- | --- | --- |
| All access-controlled contracts | `DEFAULT_ADMIN_ROLE` | Governance timelock | Grant and revoke bounded roles, initiate delayed admin transfer. No routine operations |
| `AssetRegistry` | `REGISTRAR_ROLE` | Qualification Safe | Register immutable canonical asset identities, which the current contract marks active but which cannot alone accept collateral or open risk |
| `AssetRegistry` | `STATUS_MANAGER_ROLE` | Status policy controller | Guardian pauses. Timelock activates, resumes, or deprecates |
| `CalendarRegistry` | `CALENDAR_REGISTRAR_ROLE` | Qualification Safe | Register immutable calendar versions in paused state |
| `CalendarRegistry` | `CALENDAR_STATUS_MANAGER_ROLE` | Status policy controller | Same split by selector |
| `SessionRegistry` | `SESSION_REGISTRAR_ROLE` | Qualification Safe | Register immutable session versions in paused state |
| `SessionRegistry` | `SESSION_STATUS_MANAGER_ROLE` | Status policy controller | Same split by selector |
| `AdapterRegistry` | `ADAPTER_QUALIFIER_ROLE` | Qualification Safe | Register implementation, code hash, interface, capability, configuration, and evidence commitments in paused state |
| `AdapterRegistry` | `ADAPTER_STATUS_MANAGER_ROLE` | Status policy controller | Pause immediately. Activate only after live code-hash revalidation and delay |
| `SettlementAssetRegistry` | `QUALIFIER_ROLE` | Qualification Safe | Register an exact token binding version in paused state |
| `SettlementAssetRegistry` | `STATUS_MANAGER_ROLE` | Status policy controller | Pause immediately. Activate only while canonical asset and runtime checks pass |
| `BenchmarkRegistry` | `BENCHMARK_QUALIFIER_ROLE` | Qualification Safe | Register exact asset, adapter, calendar, session, and evidence versions in paused state |
| `BenchmarkRegistry` | `BENCHMARK_STATUS_MANAGER_ROLE` | Status policy controller | Pause immediately. Activation rechecks every dependency and exact capability |
| `FeeScheduleRegistry` | `FEE_SCHEDULE_QUALIFIER_ROLE` | Qualification Safe | Register immutable fee-policy envelope in paused state |
| `FeeScheduleRegistry` | `FEE_SCHEDULE_STATUS_MANAGER_ROLE` | Status policy controller | Pause immediately. Timelocked activation or deprecation |
| `RiskDomainRegistry` | `RISK_DOMAIN_QUALIFIER_ROLE` | Qualification Safe | Register exact collateral, risk adapter, caps, rules, scenarios, default, and insurance commitments in paused state |
| `RiskDomainRegistry` | `RISK_DOMAIN_STATUS_MANAGER_ROLE` | Status policy controller | Pause immediately. Activation rechecks collateral and adapter dependencies |
| `CollateralVault` | `COLLATERAL_LOCKER_ROLE` | Named clearing and execution modules only | Create locks only with current account-controller approval |
| `CollateralVault` | `COLLATERAL_SETTLER_ROLE` | Named settlement engines only | Consume only locks pinned to that engine |
| `CollateralVault` | `EXCESS_RECOVERY_ROLE` | Timelocked bounded recovery module | Recover only physical token excess above aggregate liability |

The deployment bootstrap admin temporarily receives operational roles because current constructors grant them. Before a public environment is considered initialized, bootstrap MUST grant the production holders, revoke its own non-admin roles, begin the delayed default-admin transfer, and prove the resulting role graph from events and direct reads.

### 4.2 Required roles for later core modules

Role identifiers are namespaced constants. Implementations MAY separate a row into narrower roles but MUST NOT combine rows if that grants broader authority.

| Module | Role or authority | Holder | Scope |
| --- | --- | --- | --- |
| Market, instrument, series, and package registries | Qualifier roles | Qualification Safe | Append definitions in paused state only |
| Market status | Status policy controller | Guardian for pause, timelock for activation and deprecation | One market version or risk domain at a time |
| Clearing | Vault locker role plus account approval | Clearing engine | Reserve exact collateral for an exact operation and expiry |
| Settlement | Vault settler role plus lock pin | Settlement engine | Consume exact locks under finalized execution or settlement result |
| Fee engine | Settlement engine internal authority | Settlement engine | Charge only the signed and qualified schedule, bounded by user maximum |
| Rebate engine | Funded incentive account approval | Incentive module | Pay only from pre-funded reserved budget |
| Fixing | Permissionless evidence | Any caller | Submit evidence matching exact benchmark version and window |
| Auction progression | Permissionless deadline calls | Any caller | Open, advance, and finalize by stored rules only |
| Default opening | Permissionless objective proof through default engine | Any caller | Open one account and risk-domain process only when the onchain proof and cure rules pass |
| Insurance use | Default engine | Default engine | Apply exact versioned waterfall after defaulter resources |
| Recovery adapter activation | Governance timelock | Governance timelock | Activate an already qualified, versioned adapter named by the precommitted policy, without changing economic terms |
| Pausing | Scope-restricted controller | Guardian Safe | Disable new or increasing risk only |
| Default evidence relay | `DEFAULT_OPERATOR_ROLE` | Bounded automation identity | Submit evidence to the permissionless default engine; role conveys no default or value-moving discretion |

## 5. Pause and exit matrix

Pauses are composable bit scopes, not one global boolean. At minimum implementations distinguish `NEW_RISK`, `EXECUTION`, `RESERVATION`, `LIFECYCLE_INCREASE`, `FIXING_SUBMISSION`, `SETTLEMENT`, and `DEFAULT_AUCTION`. A pause record commits scope, target, reason hash, caller, and timestamp.

| Action | Market pause | Risk-domain pause | Adapter or benchmark pause | Protocol incident pause |
| --- | --- | --- | --- | --- |
| Submit or fill new order | Block | Block | Block when dependency is required | Block |
| Select RFQ quote or reserve new capacity | Block | Block | Block when dependency is required | Block |
| Cancel order, quote, RFQ, or unused reservation | Allow | Allow | Allow | Allow |
| Deposit collateral | Allow only when exact binding remains open for new risk | Allow | Not applicable | May block new deposits if token safety is in doubt |
| Withdraw available collateral | Allow | Allow subject only to already locked amount | Allow for every historical binding | Always allow if token transfer itself succeeds |
| Add collateral or cure deficit | Allow | Allow | Allow for historical binding | Allow when it reduces insolvency and token is safe |
| Unwind, reduce, or exercise without increasing worst-case loss | Allow after deterministic risk check | Allow after deterministic risk check | Use historical versions | Allow when incident scope permits safe reduction |
| Create or extend a lock | Block | Block | Block if dependency is not open | Block |
| Release or expire a lock | Allow | Allow | Allow | Always allow |
| Release `TerminalLiabilityReservation` before position terminal outcome | Block | Block | Block | Block |
| Submit fixing evidence | Allow under historical exact version unless fixing input itself is quarantined | Allow | Use historical benchmark and adapter rules | Allow or route to committed fallback |
| Finalize fixing | Allow under historical policy | Allow | Allow under historical policy | Allow unless evidence is quarantined |
| Settle a valid existing obligation | Allow | Allow | Use historical versions | Allow unless the exact settlement path is unsafe, then enter recovery |
| Start or progress default process | Allow | Allow | Use historical rules | Allow permissionlessly on objective proof |
| Transfer ownership to increase exposure | Block | Block | Block | Block |
| Permissionless reconciliation and receipt assembly | Allow | Allow | Allow | Allow |

The vault has no administrative withdrawal pause. Pausing or deprecating a registry version gates future risk and does not make an existing balance, lock, position, fixing, or receipt unresolvable.

## 6. Registry and market state machine

### 6.1 Canonical asset identity exception

The current `AssetRegistry` is unversioned and stores immutable identity metadata. Its registration transition is `Absent -> Active`, not `Absent -> Paused`. This is allowed because an active canonical asset has no token address, market, payoff, benchmark, risk domain, or value-moving authority. New risk still requires separately qualified and activated settlement bindings, benchmarks, markets, fee schedules, and risk domains.

The asset registrar therefore controls namespace admission but not collateral or trading activation. `Active -> Paused -> Active` and `Active | Paused -> Deprecated` remain status-controller transitions. An unknown or paused canonical asset fails every dependent operational activation. A deprecated asset remains historically resolvable and cannot return to active.

### 6.2 Versioned operational registries and markets

The current `RegistryStatus` mapping is:

- `Unspecified`: unknown, never stored;
- `Paused`: qualified but not open, or emergency suspended;
- `Active`: the one version open for new risk;
- `Deprecated`: terminal for new risk and never reactivated.

`Paused` deliberately covers both pre-activation and temporary suspension. Events and the indexer distinguish the cause.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Absent | Register immutable version | Paused | Matching qualifier role | Valid schema, nonzero commitments, exact dependency versions exist, no duplicate definition | Revert without record |
| Paused | Activate | Active | Governance timelock through status controller | Delay elapsed, no active sibling, all dependencies open, live code and capability checks pass, caps configured | Revert and remain paused |
| Active | Pause | Paused | Guardian or governance through status controller | Known active version and permitted scope | Revert if unknown or invalid state |
| Paused | Resume | Active | Governance timelock through status controller | Same full checks as first activation | Revert and remain paused |
| Paused | Deprecate | Deprecated | Governance timelock | Known version, deprecation delay elapsed | Revert and remain paused |
| Active | Deprecate | Deprecated | Governance timelock | Implementation SHOULD require pause first so notice and exits are visible | Revert if direct transition is forbidden |
| Deprecated | Any status change | Invalid | Nobody | Terminal | Revert |

A market version can activate only if its exact instrument compiler, series, package rules when used, settlement asset, benchmark, calendar, session, fee schedule, risk domain, payoff module, and required adapter versions are open for new risk. Each consumer also requires the exact type, interface, and capability hashes it implements. A dependency returning unknown, unavailable, mismatched, paused, or deprecated makes the market fail closed. Benchmark observations use the historical observation-window, sequence, finality, publication-lag, and outage-independence rules in section 14.

Dependency pause propagation is evaluated when opening or increasing risk. It MUST NOT mutate historical market state or prevent risk-reducing lifecycle work.

Trading and Maintenance session windows are half-open intervals `[opensAt, closesAt)`: `opensAt <= timestamp < closesAt`. A timestamp equal to `closesAt` is outside the window. Session proofs and every consuming module MUST apply the same boundary rule.

## 7. Collateral account and reservation state machines

### 7.1 Account control

`Absent -> Controlled -> ControlProposed -> Controlled`

- Anyone creates an account, but the resulting `AccountId` is bound to creator, vault, chain, and salt.
- Only the current controller proposes or cancels a transfer.
- Only the pending controller accepts.
- Acceptance increments the operator epoch and retires all prior account approvals without enumerating them.
- Existing locks survive controller transfer with their pinned locker and settler. The new controller cannot redirect or consume them.

### 7.2 Expiring pre-trade `Lock`

`Lock` is a bounded pre-trade reservation for an order, quote, RFQ, auction bid, or one atomic execution attempt. The existing vault `LockStatus` is authoritative for this object:

`Unspecified -> Active -> Released | Consumed | Expired`

Partial consumption leaves the lock `Active` with a lower `remainingAmount`.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Unspecified | Create lock | Active | Global collateral locker | Current account approval, exact active binding, available amount, unique caller-scoped reference, future expiry within immutable maximum, named settler currently authorized | Revert, no collateral locked |
| Active | Consume part | Active | Pinned settlement engine | Caller still has settler role, before expiry, amount nonzero and not above remainder, recipient eligible and distinct | Revert, balances and lock unchanged |
| Active | Consume all | Consumed | Pinned settlement engine | Same guards, exact remainder consumed | Atomic ledger transfer and terminal lock |
| Active | Release early | Released | Original locker | Caller still has locker role and current time is before expiry | Revert, lock remains active |
| Active | Release after deadline | Expired | Anyone | Current time at or after expiry | Remaining amount unlocked and terminal lock |
| Terminal | Any consumption or release | Invalid | Nobody | Terminal | Revert |

A `Lock` cannot be extended or redirected. Extending duration, changing amount, changing the settlement engine, or changing its economic purpose requires releasing the old lock and creating a new lock with a new reference. The semantic reservation record MUST link its lock IDs and cannot claim more capacity than the sum of their live remaining amounts.

Maker capacity reservations are `Lock` objects and follow the same lifecycle. They additionally bind maker, quote or auction ID, risk domain, maximum liability, and expiry. Capacity released by cancellation or expiry is reusable only after the release is authoritative onchain.

### 7.3 Non-expiring `TerminalLiabilityReservation`

A filled position MUST NOT depend on an expiring `Lock`. At fill, the clearing engine atomically consumes or reclassifies the required pre-trade `Lock` into a `TerminalLiabilityReservation` that binds the exact position, account, collateral binding, risk-domain version, maximum terminal liability, and settlement engine.

`Unspecified -> Active -> Settled | ReleasedAtTerminal | ConvertedToClaim`

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Unspecified | Create at fill | Active | Clearing engine with vault authority and account authorization inherited from the fill | Finalized fill, exact position ID, full required collateral, unique reservation ID, pinned settlement engine | Entire fill reverts and no position is created |
| Active | Settle terminal payout | Settled | Pinned settlement engine through a permissionless settlement call | Position has immutable terminal payout, caller engine remains authorized, payout and recipient match exact terms | Atomic failure; reservation remains active |
| Active | Release zero-liability or unused remainder | ReleasedAtTerminal | Pinned settlement engine through terminalization | Position is already entering a deterministic terminal outcome and the exact terminal calculation proves the releasable amount | Atomic failure; reservation remains active |
| Active | Convert backing to terminal claim | ConvertedToClaim | Pinned settlement engine through permissionless terminal fallback | `finalResolutionAt` reached, precommitted recovery policy selects a fully collateralized claim, amount and owner are exact | Atomic failure; reservation remains active until retried |
| Terminal | Release, redirect, or consume again | Invalid | Nobody | Terminal | Revert |

A `TerminalLiabilityReservation` has no expiry and no permissionless release path. It survives every pause, operator outage, controller transfer, and elapsed pre-trade deadline until the bound position reaches a deterministic terminal outcome. Governance, the guardian, the account controller, and the original locker cannot release, redirect, extend, or reduce it. A terminal transition atomically pays the immutable payout and releases any proven surplus, or converts the exact backing into a fully collateralized claim whose owner, amount, priority, collateral binding, and redemption rule were committed before trading opened.

The current `CollateralVault` implements only the expiring `Lock`. It does not implement `TerminalLiabilityReservation`. Phase 1 MUST add this second primitive and the atomic fill conversion path before any market can activate. An expiring lock is not an acceptable substitute.

## 8. Public order state machine

The signed authorization and onchain order are distinguished. `Draft`, `Preflight`, and wallet states are client states. Durable protocol states are:

`Authorized -> Open -> PartiallyFilled -> Filled`

with terminal branches `Cancelled`, `Expired`, and `Rejected`.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Authorized or Open | Submit or register | Open | Signer, relayer, or solver | Valid signature, nonce, market and dependencies open, session open, risk and collateral preflight, time-in-force valid | Revert or deterministic rejection reason, no fill |
| Authorized or Open | Fill first quantity | Filled or PartiallyFilled | Any executor allowed by order | Exact market version, crossing price, quantity bound, nonce live, deadline live, account authorization, margin and caps pass, reservations atomic | Revert with no partial economic effect |
| PartiallyFilled | Fill remainder | Filled or PartiallyFilled | Allowed executor | Same checks against remaining quantity and current reduce-only semantics | Revert, prior fills stand |
| Open or PartiallyFilled | Cancel | Cancelled | Signer, account policy, or authorized cancel delegate | Exact nonce or order ID still live | Idempotent existing terminal result or revert without affecting fills |
| Open or PartiallyFilled | Expire | Expired | Anyone | GTD deadline passed or committed session rule reached | Remaining quantity cancelled and reservations released |
| Open or PartiallyFilled | Reject | Rejected | Protocol transition only | A committed condition makes execution permanently impossible, such as invalidated authorization | Remaining quantity terminal, reason emitted |
| Terminal | Fill or reopen | Invalid | Nobody | Terminal | Revert |

GTC still has a protocol maximum authorization lifetime. IOC cancels the unfilled remainder in the fill transaction. FOK either fills the whole requested quantity atomically or produces no fill. Post-only rejects rather than crosses. Reduce-only is evaluated against authoritative position state at execution, not submission.

## 9. RFQ and quote state machines

### 9.1 RFQ orchestration

`Draft -> Inviting -> Collecting -> SelectionLocked -> CapacityReserved -> Authorized -> Submitted -> Clearing -> Settled`

Terminal alternatives are `Cancelled`, `Expired`, and `Rejected`. `SubmissionUnknown`, `Reconciling`, and `RecoveryRequired` are operational projections only and do not create a second economic truth or extend an economic deadline.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Draft | Invite | Inviting or Collecting | Taker controller or delegate | Compiled instrument or package, disclosure policy, eligibility rule, deadline | Reject draft with validation reasons |
| Collecting | Submit quote | Collecting | Eligible maker signer | RFQ live, quote schema exact, two-way rule if required, fee and capacity claims bounded | Reject quote only |
| Collecting | Cancel quote | Collecting | Quote maker | Quote not selected or consumed | Quote becomes terminal, RFQ continues |
| Collecting | Select quote | SelectionLocked | Taker controller or delegate | Quote live, eligibility and ranking disclosures satisfied, RFQ deadline live | No selection |
| SelectionLocked | Reserve capacity | CapacityReserved | Maker clearing operator | Maker approval, global locker role, quote and risk domain reservation caps, expiry after clearing deadline | Selection unwinds or may select another live quote per committed RFQ rule |
| CapacityReserved | Authorize execution | Authorized | Taker and maker signers as schema requires | Exact quote, capacity proof, economics, privacy, and fee bound unchanged | Reservation remains until cancel or expiry |
| Authorized | Submit | Submitted | Party, relayer, or solver | Signatures and nonces live, market open, transaction deadline live | No economic change, reconcile if broadcast outcome unknown |
| Submitted | Clear | Clearing then Settled | Execution contract via caller | Atomic risk, collateral, fill, fee, and position checks, including conversion to non-expiring terminal-liability backing | Rejected on atomic failure; unused pre-trade locks release only by their rules |
| Nonterminal before clear | Cancel or expire | Cancelled or Expired | Taker when allowed, or anyone after deadline | Cancellation policy and deadline | Existing quote reservations released according to signed rule |

### 9.2 Maker quote

`Offered -> Reserved -> Selected -> Consumed`

Terminal alternatives are `Cancelled`, `Expired`, and `Rejected`. Quote amount may be partially consumed only if the signed quote explicitly permits partial fills and states minimum fill and remainder behavior. Every fill decrements both signed remaining quantity and live reserved capacity atomically.

A private RFQ's contents remain governed by its disclosure commitment. Settlement events expose only the committed public fields required for verification. Privacy does not relax authorization, solvency, or receipt evidence.

## 10. Sealed and batch auction state machine

`Scheduled -> CommitOpen -> RevealOpen -> ReadyToClear -> Cleared -> Settled`

Terminal alternatives are `Cancelled`, `Failed`, and `Settled`. `RecoveryRequired` may describe an operational delay but is not an auction state.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Scheduled | Open commit | CommitOpen | Anyone | Start time reached, market open, auction definition qualified | Remain scheduled or cancel under disruption rule |
| CommitOpen | Commit bid | CommitOpen | Eligible bidder | Deadline live, unique bidder nonce, commitment and required bid bond or capacity valid | Reject bid only |
| CommitOpen | Advance | RevealOpen | Anyone | Commit deadline reached | Deterministic advance |
| RevealOpen | Reveal bid | RevealOpen | Bidder | Preimage matches commitment, reveal deadline live, exact auction and account, collateral valid | Mark commitment unrevealed after deadline; apply predefined bond outcome |
| RevealOpen | Close reveal | ReadyToClear | Anyone | Reveal deadline reached | Invalid or unrevealed bids excluded by rule |
| ReadyToClear | Compute and submit result | ReadyToClear | Solver or anyone | Deterministic allocation and clearing-price proof under committed algorithm | Reject result only |
| ReadyToClear | Finalize | Cleared | Anyone | Winning result verified, capacity and risk checks pass | Failed or retry with another valid result until clear deadline |
| Cleared | Settle | Settled | Settlement engine via any caller | Atomic transfers, positions, terminal-liability reservations, fees, rewards, and losing-bid releases | Atomic failure; retry until the committed deadline, then apply the precommitted terminal or default outcome |
| Any pre-clear state | Cancel | Cancelled | Guardian through a predeclared auction kill switch, or anyone under the objective no-bid or disruption rule | Cancellation reason and bond treatment fixed in auction definition | Invalid caller or reason reverts |

Keeper calls cannot choose the winner. The clearing algorithm, tie-break, rounding, partial allocation, invalid-bid treatment, bond outcome, and no-bid outcome are versioned commitments. A caller receives a bounded reward only for the first successful transition at a deadline.

## 11. Package execution state machine

`Draft -> Compiled -> Authorized -> Reserved -> Executed`

Terminal alternatives are `Cancelled`, `Expired`, and `Rejected`. `RecoveryRequired` is an operational projection only and is never a package economic state.

- Compilation resolves every leg to an exact instrument and series version, ratio, side, quantity, fixing rule, settlement class, and dependency hash.
- Authorization commits the package hash, aggregate price or outcome bound, legging policy, allocation policy, maximum fee, and deadline.
- The default is atomic all-leg execution. No leg can remain filled when the package fails.
- A package may allow partial package units, but each accepted unit contains every leg at the committed ratios. It never permits an arbitrary subset of legs.
- Direct, implied, RFQ, auction, and solver routes produce the same canonical package fill and position records.
- Expiring pre-trade `Lock` objects cover the maximum atomic liability of the attempted fill. A successful fill atomically converts the required backing into non-expiring `TerminalLiabilityReservation` objects for the resulting positions. Failure releases only pre-trade locks created for that attempt and cannot release unrelated locks or terminal-liability backing.
- A package fill is idempotent by package authorization nonce plus cumulative filled units.

The executor MAY compose several internal routes inside one transaction. If any route, price, capacity, margin, fee, or position assertion fails, the whole economic transaction reverts. A broadcast transaction with unknown outcome enters reconciliation and MUST NOT be rebuilt with a fresh authorization until the original nonce and fill state are resolved.

## 12. Position state machine

`Live -> Fixing -> SettlementReady -> Settled`

Additional terminal states are `ClosedByUnwind`, `Replaced`, `Lapsed`, `CancelledByDisruption`, and `TerminalClaim`. `Defaulted` is nonterminal until `Settled` or `TerminalClaim` under the precommitted default and terminal-resolution policy.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Absent | Create from finalized fill | Live | Clearing engine | Valid fill, exact collateral, risk acceptance, unique position ID | Fill transaction reverts atomically |
| Live | Begin fixing | Fixing | Anyone | Contractual fixing window reached | Revert before window |
| Fixing | Accept final fixing | SettlementReady | Anyone | Every required observation final or disruption outcome final | Remain fixing |
| SettlementReady | Settle | Settled | Anyone invoking settlement engine | Deterministic payout and exact terminal-liability backing | Atomic failure; retry or follow the precommitted default path before `finalResolutionAt` |
| Live | Fully unwind | ClosedByUnwind | Parties through qualified execution path | Reverse execution finalized, all residual obligations zero | Revert or leave live |
| Live | Replace through split, merge, amendment, novation, or roll | Replaced | Required owners and counterparties through lifecycle engine | Successor positions created atomically with conserved rights, obligations, and collateral | Parent remains live and no child survives |
| Live | Exercise | Live, Fixing, or SettlementReady | Holder or delegated exercise policy | Exercise style, window, quantity, and authorization valid | Reject exercise without changing remainder |
| Live | Lapse | Lapsed | Anyone | Exercise deadline passed and series rule produces lapse | Deterministic terminal outcome |
| Live or Fixing | Apply disruption cancellation | CancelledByDisruption | Anyone | Exact committed disruption rule is final | Deterministic refund or payout path |
| Any obligation-bearing state | Prove default | Defaulted | Anyone through the default engine | Objective onchain deficiency proof and cure rule satisfied | Revert and remain in prior state |
| Fixing, SettlementReady, or Defaulted | Apply terminal fallback | Settled or TerminalClaim | Anyone | `finalResolutionAt` reached and exact precommitted terminal rule supplied | Revert if early or evidence does not match policy |

Positions are append-only economic records. A successor action never mutates a prior fill price, benchmark version, payoff rule, or historical owner period. Partial exercise or unwind reduces the remaining quantity and keeps the position live until zero, at which point the appropriate terminal state is recorded. Every position MUST reach an immutable terminal payout or a fully collateralized `TerminalClaim` at `finalResolutionAt`. The terminal result is derived from timestamp and precommitted policy even if its materializing transaction is submitted later. Operator, oracle, sequencer, RPC, or governance unavailability cannot extend or change that boundary.

## 13. Lifecycle action state machine

Transfer, assignment, split, merge, amendment, novation, roll, unwind, compression, exercise, and collateral-policy changes use one action envelope:

`Draft -> Authorized -> Reserved -> Ready -> Applied`

Terminal alternatives are `Cancelled`, `Expired`, and `Rejected`. `RecoveryRequired` is an operational projection only. It is never an economic lifecycle state and cannot extend an action or position deadline. Pure Setryn ledger actions MUST be atomic. A qualified external-effect action uses its precommitted terminal-resolution policy and cannot leave an unbounded economic obligation.

| Action | Required authorization | Core conservation rule |
| --- | --- | --- |
| Transfer | Current owner and receiving account acceptance when liabilities transfer | Quantity and obligations unchanged; recipient eligibility and margin pass |
| Assignment | Assignor, assignee, and any contractually required counterparty consent | No liability disappears; collateral follows exact rule |
| Split | Owner | Child quantities sum exactly to parent; economics and total collateral conserved |
| Merge | Owner of compatible positions | Inputs have identical immutable economics and total quantity is conserved |
| Amendment | Every party whose rights or obligations worsen | Old position becomes replaced; successor carries new versioned terms |
| Novation | Exiting party, entering party, and remaining counterparty | Replacement and release are atomic; entering party passes risk and eligibility |
| Roll | Position owner and new-market counterparties | Close old and open new as one package under aggregate bounds |
| Unwind | Position owner and reverse-trade counterparty | Closed quantity cannot exceed live quantity |
| Compression | Every affected participant or pre-authorized compression policy | Net payoff by scenario, settlement asset, and date is conserved within declared tolerance |
| Exercise | Holder or exact delegated policy | Style, window, quantity, and settlement election are honored |

Any incompatibility is a deterministic rejection. Implementations MUST NOT silently downgrade a novation to transfer, an atomic roll to two independent trades, or a package unwind to legged execution.

## 14. Fixing state machine

Every series fixes these absolute timestamps before market activation:

`lastTradingAt < fixingWindowOpen < fixingWindowClose <= primaryEvidenceDeadline <= correctionCutoffAt < finalResolutionAt`

The fixing observation interval is half-open `[fixingWindowOpen, fixingWindowClose)`: `fixingWindowOpen <= observedAt < fixingWindowClose`. Every fallback step has an immutable `unavailableAfter`. Those deadlines are ordered in declared fallback order, start no earlier than `primaryEvidenceDeadline`, and are no later than `finalResolutionAt`. No deadline moves after the market activates.

Normal permissionless finalization has the non-empty half-open interval `[correctionCutoffAt, finalResolutionAt)`. During that interval anyone may finalize a valid proposed primary or fallback result. At `finalResolutionAt`, any still unresolved fixing switches deterministically to the precommitted terminal fallback.

`Scheduled -> ObservationOpen -> PrimaryPending -> EvidenceProposed -> Resolved`

Fallback branches are `FallbackPending -> FallbackProposed -> Resolved`. `Resolved` records `PrimaryFinal`, `FallbackFinal`, `UnavailableFinal`, or `CancelledByDisruption` as the immutable resolution kind.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Scheduled | End trading | Scheduled | Anyone | `lastTradingAt` reached | Revert before boundary; no later trade is valid |
| Scheduled | Open observation | ObservationOpen | Anyone | `fixingWindowOpen` reached and exact session proof valid | Revert before boundary |
| ObservationOpen | Close observation | PrimaryPending | Anyone | `fixingWindowClose` reached | Revert before boundary |
| ObservationOpen or PrimaryPending | Submit initial evidence | EvidenceProposed | Anyone with valid payload | Submission no later than `primaryEvidenceDeadline` and before `finalResolutionAt`; historical validity rules below pass | Reject evidence only |
| EvidenceProposed | Submit corrected evidence | EvidenceProposed | Anyone with valid payload | Correction rule permits it; `block.timestamp < correctionCutoffAt`; sequence is newer and historical validity passes | Reject correction only; prior proposal remains |
| PrimaryPending or EvidenceProposed | Enter next fallback | FallbackPending | Anyone | Primary or preceding fallback `unavailableAfter` reached and its unavailability condition is objectively satisfied | Revert before deadline or on invalid outage proof |
| FallbackPending | Submit fallback evidence | FallbackProposed | Anyone with valid payload | Exact declared fallback step, submission before its `unavailableAfter` and before `finalResolutionAt`, historical validity rules pass | Reject evidence only |
| FallbackProposed | Submit permitted correction | FallbackProposed | Anyone with valid payload | Exact fallback correction rule; `block.timestamp < correctionCutoffAt`; sequence is newer and historical validity passes | Reject correction only |
| EvidenceProposed or FallbackProposed | Resolve evidence normally | Resolved | Anyone | `correctionCutoffAt <= timestamp < finalResolutionAt` and evidence calculation is reproducible | Remain proposed before the interval; terminal fallback applies at or after its end |
| Any nonterminal fixing state | Apply terminal fallback | Resolved | Anyone | `finalResolutionAt` reached and precommitted terminal rule supplied | Revert before boundary; after boundary no discretionary branch exists |

Historical evidence validity MUST use all of these rules:

- the observation belongs to the half-open fixing observation window;
- the source sequence is the expected sequence or a later permitted correction sequence, with the source-specific finality proof committed by policy;
- `publishedAt >= observedAt` and `publishedAt - observedAt <= maxPublicationLag`;
- source identity, normalized decimals, confidence bounds, calendar, session, and exact adapter version match the immutable fixing policy;
- evidence validity does not compare `publishedAt` with the current block timestamp or reject evidence merely because submission occurs long after observation;
- an RPC, relay, sequencer, source, or keeper outage after the historical observation does not invalidate otherwise valid evidence, extend any deadline, reorder fallbacks, or prevent terminal resolution;
- an outage of one source is independent of every other source unless the policy explicitly commits a shared-failure condition before activation.

The current benchmark field named `maxStalenessSeconds` MUST NOT gate a fixing by age at submission. Before market activation, the fixing schema MUST expose `maxPublicationLag` explicitly or bind that existing field to the exact historical publication-lag meaning without ambiguity.

No initial or corrected evidence is accepted at or after `finalResolutionAt`. At that boundary, the exact terminal fallback becomes the effective result by timestamp and precommitted policy. Anyone can materialize it permissionlessly and idempotently after the boundary, but a delayed transaction cannot change its effective time or value. The resulting fixing stores or commits the normalized value or terminal outcome, decimals, observed and published times when applicable, sequence and finality evidence, evidence hash, rule version, source class, resolution kind, and finalization block. Later information never edits the result.

## 15. Settlement state machine

`PendingFixing -> Ready -> Settled | TerminalClaim | CancelledByDisruption`

`DefaultRequired` is a bounded branch into the objective default process. `RecoveryRequired`, `SubmissionUnknown`, and `Reconciling` are operational projections only and never settlement states or deadline extensions.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| PendingFixing | Mark ready | Ready | Anyone | All fixings and lifecycle elections final, payout calculation reproducible | Remain pending |
| Ready | Settle | Settled | Anyone invoking qualified settlement engine | Exact position, payout, fees, terminal-liability reservations, recipients, and nonce; engine pinned to reservations; no overflow | Atomic revert; reservation and obligation remain until retried or terminalized |
| Ready | Open default | DefaultRequired | Anyone through the default engine | Objective onchain payer deficiency proof exceeds the exact cure rule | Default process created once; invalid proof reverts |
| PendingFixing, Ready, or DefaultRequired | Apply terminal fallback | Settled or TerminalClaim | Anyone | `finalResolutionAt` reached and exact precommitted terminal payout or claim rule supplied | Revert if early or rule mismatch; economic state cannot remain unresolved after a valid call |
| PendingFixing or Ready | Apply disruption cancellation | CancelledByDisruption | Anyone | Final committed disruption outcome | Exact refund or payout executed atomically |
| Terminal | Settle again | Invalid | Nobody | Settlement ID already consumed | Return existing result in services; contract reverts |

Payout calculation uses exact immutable instrument, fixing, rounding, fee, collateral, and risk-domain versions. Settlement reward is included in the calculation and bounded by policy. The caller cannot supply a different recipient, price, fee, or reward. Partial settlement is forbidden unless the instrument explicitly defines independent settlement units and each unit has a unique consumption key. At `finalResolutionAt`, every position has an immutable terminal payout or a fully collateralized `TerminalClaim` backed by converted terminal-liability collateral. Later materialization is permissionless and cannot change the result.

## 16. Operational recovery and terminal claims

`RecoveryRequired` is an operational condition indicating that the preferred adapter, relay, transaction path, or projection is unavailable or inconsistent. It is never an economic state, never an authorization to move value, and never a reason to extend `finalResolutionAt`.

Before market activation, the immutable recovery policy commits:

- every ordered operational adapter version and exact capability hash;
- every objective adapter-unavailability condition and `unavailableAfter` deadline;
- the terminal fixing and payout rule;
- whether the terminal result pays immediately or issues a fully collateralized `TerminalClaim`;
- claim owner derivation, amount calculation, priority, collateral binding, redemption rule, and `finalResolutionAt`;
- all fee, reward, rounding, and evidence rules.

Operational projection may move through `Healthy -> Degraded -> AdapterActivationPending -> Reconciling -> Healthy | Terminalized`. These labels never replace the position, fixing, settlement, reservation, or claim state machines.

| Operational transition | Caller | Required guard | Permitted effect | Forbidden effect |
| --- | --- | --- | --- | --- |
| Report degradation | Anyone | Evidence identifies affected adapter and scope | Alert and optionally trigger guardian pause | Change economics or deadlines |
| Pause unsafe path | Guardian controller | Predeclared pause scope | Stop new or increasing risk | Open default, choose payout, release terminal liability |
| Activate recovery adapter | Governance timelock | Adapter was qualified, versioned, and named in the already active recovery policy | Make that exact operational path callable | Change amount, priority, owner, collateral, fallback order, or deadline |
| Reconcile | Anyone | Canonical state and events available | Repair projections and attach evidence | Author protocol truth |
| Apply terminal fallback | Anyone | `finalResolutionAt` reached | Produce the exact immutable terminal payout or fully collateralized claim | Select a new plan or discretionary outcome |

Governance MUST NOT author, approve, schedule, or execute a post-incident economic recovery plan. It cannot alter a historical fixing, fill, position term, payout amount, claim priority, owner, collateral, or deadline. Its only incident-time economic-path action is activation of an already qualified and versioned operational adapter named by the precommitted policy.

A `TerminalClaim` is an immutable, fully collateralized right created at `finalResolutionAt` when immediate payout cannot complete. Creation atomically converts the exact `TerminalLiabilityReservation` backing to claim backing. The claim cannot expire, be subordinated, be redirected by governance, or be permissionlessly released. The owner or an authorized delegate may redeem it through any adapter already permitted by its policy, and redemption consumes the claim exactly once.

## 17. Default and default-auction state machine

Account health is projected as `Healthy`, `Warning`, `CureRequired`, or `DefaultEligible`. The durable process is:

`DefaultOpened -> CureWindow -> AuctionCommit -> AuctionReveal -> AuctionReady -> Transferred -> Waterfall -> Resolved`

Terminal alternatives are `Cured`, `Cancelled`, `Resolved`, and `TerminalClaimed`. `RecoveryRequired` is an operational projection only and is not a default-process state.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| DefaultEligible | Open default | DefaultOpened or CureWindow | Anyone through the default engine | Objective onchain margin or payment breach proof, exact account and risk-domain version, no existing process | Invalid proof reverts without seizure |
| CureWindow | Add collateral or reduce risk | Cured or CureWindow | Account controller or any payer for deposit | Health recomputed under exact rules | Remain in cure window |
| CureWindow | Start auction | AuctionCommit | Anyone | Cure deadline elapsed and account still default eligible | Revert if cured or early |
| AuctionCommit | Commit bid | AuctionCommit | Qualified bidder | Bid bond or capacity, eligibility, deadline | Reject bid only |
| AuctionCommit | Advance | AuctionReveal | Anyone | Commit deadline reached | Deterministic advance |
| AuctionReveal | Reveal | AuctionReveal | Bidder | Commitment match and deadline | Invalid or unrevealed bid handled by committed bond rule |
| AuctionReveal | Finalize allocation | AuctionReady | Anyone | Reveal deadline, deterministic scoring, transfer package within caps | Retry valid computation or no-bid branch |
| AuctionReady | Transfer portfolio | Transferred | Default engine | Winner collateral and risk checks, exact positions, atomic obligation transfer | No transfer and proceed only under defined fallback |
| Transferred or no-bid state | Apply waterfall | Waterfall | Anyone through the default engine | Defaulter resources first, then committed insurance and backstop order | Atomic failure; exact fallback remains callable |
| Waterfall | Close | Resolved | Anyone | Ledger conserved, residual losses allocated only by committed policy, all locks and terminal-liability reservations resolved | Remain open with reconciliation alert before `finalResolutionAt` |
| Any nonterminal default state | Apply terminal fallback | TerminalClaimed or Resolved | Anyone | `finalResolutionAt` reached and exact precommitted rule supplied | Revert if early or policy mismatch |

Default opening is permissionless and proof based. A holder of `DEFAULT_OPERATOR_ROLE` may submit or relay the same evidence as any other caller, but the role has no discretionary authority to make a healthy account default, choose scope, skip cure, choose a winner, or move value. The guardian has no default-opening authority and is limited to pause and kill-switch actions.

No guardian, default operator, or keeper chooses a winning bidder or loss allocation. A default is isolated to its exact risk domain. Funds or positions in another domain cannot be reached without an authorization that existed before the default. Insurance is never assumed: use is bounded by the funded balance and versioned policy. Every cure, auction, and waterfall deadline is no later than the affected positions' `finalResolutionAt`. At that boundary the prequalified terminal rule resolves each position to an immutable payout or fully collateralized claim. Unfunded residual loss cannot become an arbitrary debit or an unresolved recovery state.

## 18. Receipt state machine

`Absent -> Assembling -> Provisional -> Final`

Exceptional states are `Mismatch`, `Orphaned`, and `Superseded`.

| From | Transition | To | Caller | Required guard | Failure outcome |
| --- | --- | --- | --- | --- | --- |
| Absent | Assemble | Assembling | Anyone | Canonical receipt ID derived from subject and version | Duplicate resolves to existing receipt |
| Assembling | Commit evidence | Provisional | Receipt assembler or anyone | Signed inputs, transaction receipts, logs, definitions, and calculation hashes agree | Mismatch with diagnostics, no final claim |
| Provisional | Finalize | Final | Anyone | Required chain finality and every referenced protocol terminal state reached | Remain provisional |
| Provisional | Observe reorg | Orphaned | Reconciler | Referenced event no longer canonical | Rebuild from canonical chain |
| Final | Issue correction or extended evidence | Superseded | Anyone under receipt-version rules | Prior hash linked, reason and new evidence explicit | Old receipt remains resolvable |

A receipt does not move value and cannot make an invalid transition valid. Execution receipts commit authorization, eligibility, quote set or book state commitment, allocation, price, fees, reservations, fill events, and finality. Fixing receipts commit benchmark versions, evidence, window, fallback path, calculation, and finality. Settlement and recovery receipts additionally commit every debit, credit, reward, lock consumption, waterfall step, and reconciliation result.

## 19. Value-moving transition register

Every implementation handover for a row below MUST bind the named policy placeholders to exact qualified versions and deployment parameters. `Atomic failure` means all protocol ledger and token effects revert. External transaction uncertainty still follows section 20.

| Transition | Caller and authorization | Incentive | Timeout | Idempotency and replay rule | Normal outcome | Failure outcome |
| --- | --- | --- | --- | --- | --- | --- |
| Deposit collateral | Any payer; destination account must exist; exact binding open for new risk; ERC-20 allowance | Fund account or another account | Transaction deadline in client; no protocol reservation | Operation ID plus transaction hash; vault credits only measured exact receipt | Token enters vault and equal liability and account balance are credited | Atomic failure on token error, inexact receipt, unknown account, closed binding, zero amount, or overflow |
| Withdraw available collateral | Current account controller; historical binding must exist | Recover user funds | Signed organization policy deadline if applicable | Controller nonce for smart-account call; ledger debit and transfer occur once | Exact token amount leaves vault, liability and available balance fall equally | Atomic failure on insufficient available, bad recipient, token failure, or inexact transfer |
| Transfer available collateral | Source controller; destination exists; exact historical binding | Internal treasury or account management | Authorization deadline | Unique operation ID or controller transaction nonce | Equal ledger debit and credit, no token or aggregate-liability change | Atomic failure, no balance change |
| Create expiring pre-trade `Lock` | Qualified locker plus live account approval | Eligibility to quote, order, clear, or bid | Absolute expiry not beyond immutable maximum and after action deadline | Caller-scoped unique lock reference; duplicate reverts | Available becomes locked for the exact pre-trade purpose | Atomic failure on role, approval, cap, balance, binding, or expiry check |
| Release pre-trade `Lock` early | Original locker still holding role | Free unused capital | Before expiry | Lock terminal state prevents replay | Remainder returns to available | Failure leaves lock active; after expiry use permissionless path |
| Expire pre-trade `Lock` | Anyone | Optional bounded sweep reward only if separately funded; otherwise public good or own capital release | At or after expiry | One terminal transition per lock | Remainder returns to available | Early call reverts; terminal call is no-op in service projection and revert onchain |
| Consume pre-trade `Lock` for transaction-bounded payment | Pinned settler still holding role | Complete an authorized immediate payment | Before lock expiry | Lock remainder and payment consumption key | Exact amount moves between vault accounts, never outside vault | Atomic failure on wrong engine, expiry, amount, recipient, or state; it cannot back a position |
| Convert pre-trade backing to `TerminalLiabilityReservation` | Clearing engine with fill authorization, vault authority, and account approval inherited from the fill | Create a collateralized position | Same transaction and deadline as the fill | Unique position and reservation IDs; consumed pre-trade backing cannot be reused | Expiring backing becomes non-expiring position-specific terminal backing atomically | Entire fill reverts; no position or terminal reservation survives |
| Resolve `TerminalLiabilityReservation` | Pinned settlement engine through a permissionless terminal call | Pay the contractual result and free proven surplus | At settlement eligibility and no later than `finalResolutionAt` | Position terminal key and reservation state consumed once | Exact payout is credited, proven surplus is released, and reservation becomes terminal | Atomic failure leaves reservation active; it never expires or releases permissionlessly |
| Convert terminal backing to `TerminalClaim` | Pinned settlement engine through permissionless terminal fallback | Preserve the user's immutable fully backed right when immediate payout is unavailable | Exactly at or after `finalResolutionAt` | Position terminal key and claim ID consumed once | Exact backing, owner, amount, priority, and redemption rule become an immutable claim | Early or mismatched call reverts; reservation remains active for retry |
| Redeem `TerminalClaim` | Claim owner or authorized delegate through a policy-permitted adapter | Receive the already fixed terminal value | No claim expiry; adapter-specific transaction deadline may apply | Claim redemption key consumed once | Exact claim backing reaches owner and claim becomes redeemed | Atomic failure leaves claim and backing unchanged |
| Public or RFQ fill | Allowed executor with valid party signatures, live nonces, qualified market, margin, and pre-trade locks | User execution; maker spread; solver fee when signed | Order or quote deadline and session window | Order nonce plus cumulative fill; fill ID unique | Positions, fees, fill event, and conversion to terminal-liability backing occur atomically | Atomic failure; no leg, fee, position, or terminal reservation survives |
| Package fill | Allowed executor with valid package authorization and pre-trade locks | Package execution or solver fee | Package deadline and all component deadlines | Package nonce plus cumulative package units | All legs, positions, fees, and terminal-liability reservations apply atomically | Atomic failure of whole unit; no legging unless exact signed policy says otherwise |
| Charge execution or lifecycle fee | Settlement engine under exact active-at-authorization fee schedule and user max fee | Protocol or named recipient revenue | Same transaction as chargeable action | Fee keyed to action consumption ID | Charge debited and recipients credited atomically | Parent action fails if fee cannot be computed or paid |
| Pay rebate or incentive | Qualified funded incentive module under exact schedule | Maker, taker, solver, or liquidity incentive | Same action or claim deadline | One claim per action and recipient | Debit pre-funded incentive budget and credit recipient | No mint or unbacked credit; action follows explicit rule if budget insufficient |
| Post or return auction bond | Bidder through auction contract; qualified collateral and eligibility | Deter spam and support reveal | Commit deadline; return or slash deadline in auction policy | Auction ID, bidder, and bid nonce | Bond locked, then returned or distributed by committed outcome | Atomic failure or permissionless expiry release |
| Settle auction allocation | Anyone calling deterministic auction and settlement engines | Trade outcome plus bounded keeper reward | Clear and settlement deadlines, all no later than `finalResolutionAt` | Auction result hash and one settlement consumption key | Winner allocations, positions, terminal-liability reservations, fees, bonds, and releases apply atomically | Retry until deadline, then apply the exact no-clear, default, or terminal-claim outcome |
| Add collateral during cure | Any payer depositing to affected account | Avoid default and preserve position | Cure deadline | Deposit operation rules | Account health improves by measured credit | Deposit failure changes nothing; default clock continues |
| Transfer position obligations in novation or default auction | Lifecycle or default engine with all required signatures or objective default authority | Novation objective or discounted default acquisition | Action or auction deadline | Source position successor ID and action nonce | Old position replaced and obligations plus collateral conserved | Atomic failure, source remains unchanged |
| Exercise option | Holder or exact delegated policy through lifecycle engine | Realize option value | Exercise cutoff | Exercise nonce and remaining exercisable quantity | Quantity consumed and resulting payout or position created | Invalid, late, or excess exercise rejected without consuming quantity |
| Unwind, roll, or compression | Authorized participants through execution or lifecycle engine | Reduce, migrate, or release capital; solver fee if signed | Action deadline | Action nonce and exact input-position consumption keys | Atomic replacement, settlement, and collateral release | Entire action fails; original positions remain valid |
| Fixing submission reward | Any valid evidence submitter | Bounded oracle-delivery reimbursement | Applicable evidence or correction deadline and always before `finalResolutionAt` | First accepted evidence key per benchmark, window, sequence, and step | Reward paid only with accepted evidence from funded budget | Invalid, late, or duplicate evidence earns nothing; permissionless terminal fallback remains available |
| Settlement payout | Anyone invokes engine; payout rule and terminal-liability reservations authorize movement | Parties receive contractual outcome; caller may earn bounded reward | Settlement eligibility time through `finalResolutionAt`; reward claim follows exact policy | Position settlement key or independent unit key consumed once | Deterministic debits, credits, fees, reward, reservation terminalization, and position terminal state | Atomic failure or objective default path before the terminal boundary; never double pay |
| Keeper transition reward | Anyone completing eligible first transition | Compensate gas and availability | Exact transition window | One reward per state sequence and action | Bounded reward from pre-funded budget in successful transition | Failed, duplicate, or late call receives nothing |
| Apply default waterfall | Anyone through the default engine after objective proof | Restore solvency; bidders may receive committed discount | Cure, auction, and waterfall deadlines, all no later than `finalResolutionAt` | Default process ID and monotonic step | Defaulter collateral, auction transfer, insurance, and terminal rule apply in committed order | Atomic failure preserves state; at terminal boundary exact payout or fully collateralized claim applies, with no arbitrary debit |
| Apply precommitted terminal fallback | Anyone | Complete the position despite operational outage | At or after `finalResolutionAt` | One terminal key per position and immutable policy version | Exact terminal payout or fully collateralized claim is created | Early or mismatched call reverts; no governance-selected alternative exists |
| Recover token excess | Timelocked bounded recovery module | Return donations or stuck surplus | Governance delay and scheduled-action expiry | Recovery operation ID | Only balance strictly above aggregate token liability leaves vault | Atomic failure if amount touches backing or transfer is inexact |

## 20. Unknown outcomes and reconciliation

### 20.1 Submission protocol

Before broadcast, the submitting service persists the semantic operation ID, signed payload hash, signer, nonce, expected state transition, transaction request, chain ID, and verifying contract. After broadcast it persists every attempt hash and replacement relationship.

If RPC submission times out or returns an ambiguous error, the operation becomes `SubmissionUnknown`. The service MUST NOT create a fresh semantic operation or consume a fresh authorization merely to retry.

### 20.2 Reconciliation order

The reconciler performs these checks in order:

1. Read authoritative object state and consumed nonce or fill amount at a finalized block.
2. Search known transaction hashes and replacements by receipt.
3. Search canonical protocol events by operation ID, object ID, signer, and nonce.
4. Query at least one independent RPC when the primary has an availability or consistency failure.
5. If the transition is applied, link the canonical transaction and project success.
6. If a transaction reverted, project the decoded deterministic failure.
7. If not applied and the authorization remains live, rebroadcast the same signed transaction or an economically identical replacement with the same nonce as policy allows.
8. If not applied and the authorization expired or was cancelled, project `NotApplied` and release only reservations whose own release conditions are satisfied.
9. Escalate to `ManualReview` only when canonical state, receipts, and events still disagree after finality and independent-provider checks.

Services MUST reconcile from contract state and events after restart. Redis locks, queues, browser state, and database flags are never authority. A chain reorganization rolls back provisional projections and receipts to the common canonical ancestor, then replays events. Finality depth is an environment parameter and MUST be displayed with the receipt.

### 20.3 Reservation safety during uncertainty

An unknown fill or settlement outcome does not justify releasing collateral.

- An expiring pre-trade `Lock` remains until the fill is proved applied or not applied. An applied fill atomically converts the required backing to a `TerminalLiabilityReservation`. A fill proved not applied permits the original locker to release under its rule, or anyone to release after the lock expiry.
- A `TerminalLiabilityReservation` remains through every unknown settlement outcome. It has no expiry and cannot be permissionlessly released. It changes only when the position's deterministic terminal payout is applied or its backing is converted to an immutable `TerminalClaim` at `finalResolutionAt`.
- If the terminal transaction outcome is unknown at `finalResolutionAt`, reconciliation first checks canonical position, reservation, claim, and nonce state. If no terminal transition applied, anyone may submit the same precommitted terminal fallback. No fresh economic authorization or discretionary plan is created.

No service may infer release from a dropped mempool transaction alone.

## 21. Invalid transitions and failure taxonomy

Every rejected transition maps to one stable category while retaining the exact contract error:

- `UNKNOWN_OBJECT`: typed ID or version does not exist;
- `INVALID_STATE`: source state has no requested outgoing edge;
- `TERMINAL_STATE`: object is already terminal;
- `UNAUTHORIZED_CALLER`: role, controller, delegate, pinned operator, or participant check failed;
- `INVALID_AUTHORIZATION`: signature, nonce, signing domain, deadline, executor, or policy failed;
- `DEPENDENCY_CLOSED`: required version is not open for new risk;
- `CAPABILITY_MISMATCH`: kind, interface, capability, or schema commitment differs;
- `DEADLINE_NOT_REACHED` or `DEADLINE_PASSED`;
- `INSUFFICIENT_CAPACITY`: balance, reservation, margin, cap, insurance, or funded reward is insufficient;
- `EVIDENCE_INVALID`: oracle, session, Merkle, auction, risk, or recovery proof failed;
- `ECONOMIC_BOUND_FAILED`: price, slippage, quantity, fee, payout, or risk bound failed;
- `TOKEN_BEHAVIOR_REJECTED`: transfer failed or exact balance delta did not match;
- `DUPLICATE_OR_REPLAY`: nonce, fill, settlement, claim, receipt, or operation was already consumed;
- `EXTERNAL_DEPENDENCY_FAILURE`: qualified dependency could not perform its exact interface;
- `RECONCILIATION_MISMATCH`: indexed and canonical evidence disagree.

Invalid transitions make no state change and pay no caller reward. A service may return an existing canonical result for an idempotent duplicate, but it must label that response as previously applied.

## 22. Terminal-state rules

Terminal economic states are irreversible. Later information creates a linked successor or correction record. Value changes after terminalization are possible only when the market's pre-activation policy already committed the exact compensation rule.

- Registry versions: `Deprecated`.
- Expiring pre-trade locks: `Released`, `Consumed`, `Expired`.
- Terminal-liability reservations: `Settled`, `ReleasedAtTerminal`, `ConvertedToClaim`. They never expire.
- Orders and quotes: `Filled`, `Cancelled`, `Expired`, `Rejected`.
- RFQs: `Settled`, `Cancelled`, `Expired`, `Rejected`.
- Auctions: `Settled`, `Cancelled`, `Failed`.
- Package actions: `Executed`, `Cancelled`, `Expired`, `Rejected`.
- Positions: `Settled`, `ClosedByUnwind`, `Replaced`, `Lapsed`, `CancelledByDisruption`, `TerminalClaim`.
- Lifecycle actions: `Applied`, `Cancelled`, `Expired`, `Rejected`.
- Fixings: `Resolved` with resolution kind `PrimaryFinal`, `FallbackFinal`, `UnavailableFinal`, or `CancelledByDisruption`.
- Settlements: `Settled`, `TerminalClaim`, `CancelledByDisruption`.
- Default processes: `Resolved`, `TerminalClaimed`, `Cured`, `Cancelled`.
- Terminal claims: `Redeemed`; an outstanding claim does not expire and stays fully backed.
- Receipts: `Final`, `Superseded`; an orphaned receipt is rebuilt or remains explicitly orphaned evidence.

`RecoveryRequired` is absent from this list because it is never an economic state.

## 23. Extensibility and qualification requirements

State schemas use typed IDs and open namespaced tags for instrument family, payoff module, execution mode, benchmark kind, adapter kind, risk model, fee model, lifecycle action, and receipt subject. Open tags do not mean open execution. Every consumer has an explicit allowlist of exact versions and capability commitments it implements. Unknown combinations fail closed.

New canonical assets enter as immutable definitions. New bindings, calendars, sessions, benchmarks, adapters, markets, instruments, packages, fee schedules, risk domains, execution modes, and recovery policies enter through append-only versioned definitions. Historical objects pin exact definitions and versions. A new operational version never mutates existing economics and never becomes active merely because it was registered.

Enumerability comes from events and indexer projections, not unbounded onchain arrays. Every state-machine event carries enough identity and version data for deterministic reconstruction. The indexer may enrich but may not reinterpret an unsupported state.

Extension contracts cannot use arbitrary `delegatecall`, arbitrary caller-supplied targets, or caller-supplied calldata. They cannot bypass custody, solvency, authorization, replay, session, oracle, settlement, pause, or qualification gates.

## 24. Implementation acceptance criteria

This specification is implemented only when:

1. Every module exposes its append-only state enum, permitted transitions, caller guards, deadlines, idempotency keys, and terminal states in canonical schemas.
2. Contract events can reconstruct every object and transition without a privileged database edit.
3. Role-admin relationships and production holders match the deployment manifest, and bootstrap authority is removed.
4. Emergency pause is selector and scope restricted, while activation and resumption are timelocked.
5. Withdrawal of available collateral, cancellation, pre-trade lock expiry, historical fixing, settlement, terminal fallback, reconciliation, and receipt reconstruction remain available through applicable pauses.
6. Every value-moving transition conforms to section 19 and has one atomic accounting boundary or an exact precommitted terminal result.
7. Every signed action has chain and contract domain separation, deadlines, nonce consumption, fee bounds, and exact dependency versions.
8. Unknown transaction outcomes reconcile without duplicate value movement or premature reservation release.
9. Qualification and activation revalidate exact dependencies and capability commitments and fail closed.
10. No public API or external SDK work is treated as a dependency of these protocol state machines.
11. Phase 1 adds non-expiring `TerminalLiabilityReservation` support and atomic fill conversion to the vault before any market activates. Existing expiring locks cannot satisfy this criterion.

## 25. Remaining deployment decisions

The protocol behavior and authority boundaries in this lane are closed. The following are deployment inputs that cannot be named from the repository today and must be fixed before the relevant environment gate:

1. Actual Safe signer addresses, final signer counts above the stated minima, and overlap analysis.
2. Exact delays above the stated minima for each production action class.
3. Exact keeper, oracle-delivery, auction, and reconciliation reward amounts and the funded budget accounts.
4. Exact timeouts for order lifetime, pre-trade lock lifetime within the vault maximum, RFQ phases, auction phases, fixing deadlines satisfying section 14, settlement retries, and cure windows.
5. Exact finality thresholds and independent RPC providers per environment.
6. Exact versioned default waterfall, insurance policy, auction scoring, disruption, terminal payout, and fully collateralized claim rules for each activated risk domain and market family.

These values belong in qualified policy versions and reviewed deployment manifests. None may be supplied ad hoc by a keeper, operator, frontend, or database.
