# Setryn incident response runbooks

## Scope and ground rules

These runbooks cover the operator response to the incidents Setryn is built to survive. Each one
lists how the incident is detected, which contract role acts and with which function, what users
can still do without any operator, and how to confirm the response worked.

- No mainnet write happens without explicit user authorization. That covers every transaction,
  role change, pause, activation, and deployment on Arbitrum One. Rehearse on the local devnet,
  Arbitrum Sepolia, or a pinned fork first. The operator runtime refuses Arbitrum One writes before
  it builds a client (`StrictEnvironmentWritePolicy` in `services/operator-runtime/src/policy.ts`).
- Pausing stops new risk. It never stops an existing position, lock, reservation, claim, or balance
  from reaching its terminal state. If a response would strand an existing obligation, stop and
  escalate instead of improvising.
- Terminal resolution follows committed onchain state. Any caller can complete it. Operator
  automation speeds it up but is never required.
- The rehearsal test for this document is
  [`contracts/test/integration/PausePathRehearsal.t.sol`](../../contracts/test/integration/PausePathRehearsal.t.sol).
  It pauses every registry surface and revokes every privileged role on the resolution path, then
  proves an open position still settles, reservations release, a payout claim is paid, and both
  traders withdraw their full balances. It also proves each pause refuses a new position and each
  resume restores admission. Run it with:

  ```sh
  forge test --root contracts --match-path '**/test/integration/PausePathRehearsal.t.sol' -vv
  ```

  The adapter pause, migration, and bounded async recovery sequence is rehearsed on a pinned fork
  in `contracts/test/fork/ArbitrumOneControlRehearsalFork.t.sol`.

## Who holds which role

Role holders come from `contracts/script/DeploySetryn.s.sol`. The target topology in
[roles and state machines](../specs/setryn-roles-and-state-machines.md) section 3 is a Guardian Safe
for immediate pauses and a timelocked Protocol Safe for activation and resumption.

| Principal | Holds |
| --- | --- |
| `governanceOperator` | Every registry qualifier role: `ADAPTER_*`, `SERIES_*`, `MARKET_*`, `INSTRUMENT_*`, `BENCHMARK_*`, `RISK_DOMAIN_*`, `FEE_SCHEDULE_*`, `PACKAGE_*`, `CALENDAR_*`, `SESSION_*`, and `QUALIFIER_ROLE` on `AssetRegistry` and `SettlementAssetRegistry` (status-manager roles sit with `RegistryStatusController`, below). Also `POLICY_ADMIN_ROLE`, `MATCH_EXECUTOR_ROLE`, `RISK_CONSUMER_ROLE`, `AUCTION_SCHEDULER_ROLE`, `ROUTE_CONSUMER_ROLE` |
| `RegistryStatusController` | Every registry status-manager role and `POLICY_ACTIVATOR_ROLE`; forwards pause selectors for the guardian and activate/deprecate selectors for the governance timelock |
| `guardian` | Pause through `RegistryStatusController.pause`, `AUCTION_GUARDIAN_ROLE` (`SealedAuctionHouse.cancelAuction`), `LIFECYCLE_GUARDIAN_ROLE` (`SignedLifecycleEngine.cancelAction`), `COMPRESSION_GUARDIAN_ROLE` (`CompressionCoordinator.cancelCompression`) |
| `governanceAdmin` | Pending `DEFAULT_ADMIN_ROLE` on every access-controlled contract, accepted after the `AccessControlDefaultAdminRules` delay |
| `excessRecovery` | `CollateralVault.EXCESS_RECOVERY_ROLE` (moves only token balance above total liability) |
| `treasuryController` | Controller of the protocol fee vault account (a Treasury Safe in production, set by `SETRYN_TREASURY_CONTROLLER` at deployment). Only it can withdraw accrued fees through `CollateralVault.withdraw`. It holds no registry or engine role |
| Protocol contracts | `PositionEngine` holds the vault locker, settler, reservation-creator and reservation-resolver roles. `CashSettlementCoordinator` holds `PositionEngine.FIXING_ENGINE_ROLE`, the vault reservation-resolver role and `FundedFeeEngine.FEE_ACTION_CONSUMER_ROLE` |

Registry status roles: every combined status-manager role (the 13 registries, including the
privacy policy registry) is held by `RegistryStatusController`, not by `governanceOperator`. The
guardian calls `RegistryStatusController.pause(registry, data)`, which forwards only the registry's
pause selector. The governance timelock calls `govern(registry, data)` for activate (also resume)
and deprecate. Neither principal can reach the other's selectors, and role administration is not
forwarded. On the local devnet only, the operator keeps the status roles directly and is the
controller's governance principal.

## Detection signals

| Signal | Where | What it shows |
| --- | --- | --- |
| `/status` | `apps/web` status board, fed by `/api/internal/deployment` and `/api/v1/status` | Chain id, head block, chain time, and live runtime code hash against the recorded hash for every deployed contract. `Hash differs` or `No code` is an incident |
| System strip and home health rows | `apps/web/src/lib/alerts/health.ts` | Chain, wallet, oracle, sequencer, private execution, and indexer as `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, or `CHECKING`. Chain comes from `/api/internal/operator/status`; oracle reads the Chainlink references in the market-data feed (`/api/market-data`); market data reports the feed's own status |
| `/operations`, `/alerts` | `apps/web` | Operator dependency freshness and raised alerts |
| Operator runtime health | `InternalOperatorRuntime.healthSnapshot(environment)` | `unhealthy` on a critical alert or unhealthy dependency. `degraded` on failed, blocked, or retry-scheduled jobs, or a degraded or unknown dependency. Lists active kill switches |
| Operator execution ports | `services/operator-runtime/src/ports.ts` | `maker` (quote cycles), `solver` (solver execution), `keeper` (expire-orders, resolve-fixing, settle-positions, recover), `oracle` (oracle relay). A port that is missing or failing blocks or retries its jobs |
| Contract events | Indexer | `FixingDisputed`, `SeriesStatusChanged`, `MarketStatusChanged`, adapter and binding status changes, `RoleGranted` / `RoleRevoked`, `TerminalClaimCreated` |

### Operator kill switches

`InternalOperatorRuntime.activateKillSwitch({ environment, scope, reason, activatedBy, activatedAt })`
blocks queued and future `new-risk` jobs for an environment, domain (`maker`, `solver`, `keeper`,
`oracle`), market, or resource. It never blocks `terminal-resolution` or `operational` jobs, so
keeper settlement keeps running. `deactivateKillSwitch(id)` lifts it. A kill switch is offchain
only. It stops Setryn's own automation, not third-party callers, so pair it with the onchain pause
when the incident needs one.

## What stays permissionless for users

Every step below needs no role. Users, the keeper, or any third party can call it.

| Step | Call |
| --- | --- |
| Cancel an order | `OrderState.cancelOrder(orderHash)` (signer only) |
| Expire orders and clear the book | `OrderState.expireOrder`, `PublicOrderBook.syncOrder`, `PublicOrderBook.pruneBest` |
| Release a pre-trade lock | `CollateralVault.releaseExpiredLock(lockId)` after expiry |
| Enter fixing | `PositionEngine.beginFixing(positionId)` once the fixing window opens |
| Submit fixing evidence | `FixingEngine.submitEvidence` / `submitEvidenceVector` |
| Finalize a fixing | `FixingEngine.finalizeFixing` / `finalizeFixingVector` inside `[correctionCutoffAt, finalResolutionAt)` |
| Apply the committed fallback | `FixingEngine.applyTerminalFallback` / `applyTerminalFallbackVector` at or after `finalResolutionAt` |
| Settle | `CashSettlementCoordinator.finalizeNormalSettlement` before `finalResolutionAt`, `finalizeTerminalDisruption` at or after it, `finalizeLapsedPosition` for lapsed positions. Each returns the existing settlement if one is recorded |
| Settle directly on the engine | `PositionEngine.settle`, `PositionEngine.applyTerminalFallback` |
| Release or convert terminal backing | `CollateralVault.finalizeTerminalLiabilityReservation`, `materializeTerminalClaimAfterFinalResolution` |
| Pay a claim | `CollateralVault.fulfillTerminalClaim`, `CashSettlementCoordinator.fulfillClaim` |
| Close an external action | `OperationalAdapterExecutor.reconcileExternal`, `recoverExternal`, `terminalizeExternal` |
| Withdraw | `CollateralVault.withdraw(assetId, bindingVersion, accountId, amount, recipient)` (account controller). Gated only on the binding having existed, never on its status |

The keeper port runs exactly these calls (`services/operator-runtime/src/adapters/keeper.ts`).

## Runbook 1: oracle or benchmark failure, disputed fixing

Detection: oracle row `DEGRADED` or `UNAVAILABLE` in the system strip, stale freshness on
`/operations`, failed `oracle-relay` jobs, a `FixingDisputed` event, or a fixing still `Proposed`
or `Disputed` near `correctionCutoffAt`.

Response:

1. Stop new risk on affected series. With `BENCHMARK_STATUS_MANAGER_ROLE`, call
   `BenchmarkRegistry.pauseBenchmark(benchmarkId, version)`. Every market that marks against the
   benchmark stops admitting risk. If the fixing adapter itself is suspect, also call
   `AdapterRegistry.pauseAdapter(adapterId, version)`. For a narrower scope use
   `SeriesRegistry.pauseSeries` or `MarketRegistry.pauseMarket`.
2. Activate the `oracle` domain kill switch if the relay is producing bad submissions.
3. For historical series, do nothing that tries to overwrite a fixing. `FixingEngine` accepts
   evidence for any lifecycle-enabled benchmark and adapter version, so a pause does not block it.
   A proposal is replaced only by a newer batch sequence or a higher-priority candidate. Two
   different proposals with the same candidate and batch sequence move the slot to `Disputed`, and
   `finalizeFixing` then reverts with `FixingDisputedState`.
4. If a valid proposal exists, anyone finalizes it after `correctionCutoffAt`. If none exists or the
   slot is disputed, anyone calls `CashSettlementCoordinator.finalizeTerminalDisruption` at or after
   `finalResolutionAt`. That applies the series' committed disruption outcome
   (`terminalDisruptionTransferMinorPerLot` and `disruptionOutcomeId`) and does not call the payoff
   module.
5. Resume only after a replacement benchmark or adapter version is qualified. Register it paused,
   then activate it through governance.

Verify: `FixingEngine.fixingStatus` is `Finalized` for every slot. `getFinalizedFixing` shows
`PrimaryFinal`, `FallbackFinal`, or `TerminalDisruption`. `CashSettlementCoordinator.settlementOf`
is nonzero for each affected position. `BenchmarkRegistry.isOpenForNewRisk` returns false until the
resume.

Known gap: there is no onchain quarantine for a compromised fixing input. The only defenses are
the dispute rule and the terminal fallback.

## Runbook 2: sequencer outage

Detection: sequencer row `DEGRADED` or `UNAVAILABLE`, `TradingSessionPolicy.sequencerOperational()`
returns false, and RPC head block stalls on `/status`.

Response:

1. No pause is needed. `TradingSessionPolicy.isOpenForNewRisk` returns false while the Chainlink
   uptime feed reports down (`answer != 0`) and for `recoveryGracePeriod` after it comes back. Every
   admission gate (order, public book, clearing, RFQ, auction) consults it.
2. `FixingEngine` rejects L2-state evidence observed during the outage or grace
   (`InvalidL2StateDuringSequencerOutage`). Outage-independent evidence is accepted once the grace
   ends (`SequencerRecoveryGraceActive` before that).
3. Activate the `maker` and `solver` kill switches so queued quote and solver jobs do not fire into
   the recovery window.
4. After recovery, let the keeper run `resolve-fixing` and `settle-positions`. Positions whose
   fixing window closed during the outage reach settlement through the terminal fallback if no
   valid fixing was finalized.

Verify: `sequencerOperational()` returns true after the grace period, admission resumes without
any governance action, and there are no blocked keeper jobs.

## Runbook 3: market or series pause and resume

Detection: an operator decision, a bad listing, or an abnormal fill or mark on a market.

Pause (status-manager role on each registry):

| Scope | Call |
| --- | --- |
| One series version | `SeriesRegistry.pauseSeries(seriesId, version)` |
| One market version and all its series | `MarketRegistry.pauseMarket(marketId, version)` |
| One instrument and all series on it | `InstrumentRegistry.pauseInstrument(instrumentId, version)` |
| One package | `PackageRegistry.pausePackage(packageId, version)` |
| Fee schedule, risk domain, calendar, session | `FeeScheduleRegistry.pauseFeeSchedule`, `RiskDomainRegistry.pauseRiskDomain`, `CalendarRegistry.pauseCalendar`, `SessionRegistry.pauseSession` |
| Canonical asset | `AssetRegistry.pauseAsset(assetId)` |

A pause clears the active-version pointer. `isOpenForNewRisk` returns false at every dependent
level, and `PositionEngine.createPosition` reverts with `SeriesClosedForNewRisk(seriesId, version)`.
`PublicOrderBook` placement and matching revert with `OrderNotExecutable`. `isLifecycleEnabled`
stays true, so settlement, fixing, claims, and withdrawals keep working. Use `deprecate*` for
permanent retirement. It has the same lifecycle guarantee.

Resume through governance, not the guardian: `activateSeries(seriesId, version, qualification)`
(which revalidates the qualification and fails after `lastTradingAt`), `activateMarket`,
`activateInstrument`, `activatePackage(packageId, version, legs)`, and the matching `activate*`
calls. Each activation rechecks that its dependencies are open.

Verify: `statusOf` and `activeVersion` on the registry, `isOpenForNewRisk` false while paused and
true after resume, and an existing position's `PositionEngine.positionStatus` unchanged. The
rehearsal test runs this cycle for every surface.

## Runbook 4: adapter compromise

Detection: `/status` shows `Hash differs` for an adapter, `AdapterRegistry.runtimeMatches` returns
false, the adapter reports wrong values, or an external disclosure.

Response:

1. With `ADAPTER_STATUS_MANAGER_ROLE`, call `AdapterRegistry.pauseAdapter(adapterId, version)`.
   The active pointer drops to zero and new requests through that version revert. For example,
   `OperationalAdapterExecutor.submitExternal` reverts with `AdapterUnavailable`. The instrument,
   risk domain, benchmark, and every market above them close for new risk.
2. Activate the kill switch for the affected domain or resource.
3. Migrate. With `ADAPTER_QUALIFIER_ROLE`, call `registerAdapter(definition)` for the fixed build.
   It keeps the lineage id, mints version `n + 1` in `Paused`, and leaves the old version readable.
   After review, `activateAdapter(adapterId, n + 1)` rechecks the live code hash.
4. Historical positions stay pinned to the version and code hash they opened with. Migration does
   not rewrite them. If a pinned payoff module reverts or its code changes, the normal path fails
   closed (`PayoffModuleRuntimeMismatch`, `PayoffModuleCallFailed`) and the position resolves
   through `finalizeTerminalDisruption` at `finalResolutionAt`, which does not call the module.
5. In-flight external actions close through `reconcileExternal`, `recoverExternal` (between
   `timeoutAt` and `recoveryDeadline`), and `terminalizeExternal` (after `recoveryDeadline`, applying
   the committed fallback). None of them need the adapter to be active.

Verify: `activeVersion(adapterId)` is the new version, `isOpenForNewRisk(adapterId, old)` is false,
`isLifecycleEnabled(adapterId, old)` is true, and `getAdapter(adapterId, old)` still reconstructs.

## Runbook 5: keeper, maker, solver, or relay operator outage

Detection: operator runtime health `degraded` or `unhealthy`, jobs stuck in `retry-scheduled` or
`blocked`, a missing execution port (`No <domain> execution port is configured`), or aging freshness
on `/operations`.

Response:

1. Makers and solvers add liquidity only. An outage means no new quotes or fills. It never stops
   exits. Activate the domain kill switch so stale jobs do not fire on restart.
2. The keeper runs only permissionless calls. While it is down, anyone can complete the same work
   from the "What stays permissionless" table. Publish the series ids, fixing slots, and position
   ids a user needs to call `finalizeTerminalDisruption` or `finalizeNormalSettlement` themselves.
3. The oracle relay is also permissionless (`submitEvidence`). If nobody submits valid evidence,
   the terminal fallback applies at `finalResolutionAt`.
4. Restart the worker (`services/operator-runtime`, `pnpm --filter @setryn/operator-runtime worker
   --environment <env> --jobs <file>`), then `resume(jobId)` blocked jobs once the dependency is healthy.

Verify: runtime health back to `healthy`, no `failed` or `blocked` jobs, and every due position has
a settlement id.

## Runbook 6: collateral token depeg or freeze

Detection: an external price or issuer notice, `CollateralVault.isSolvent(token)` false, or
`excessOf(token)` moving unexpectedly.

Response:

1. With `SettlementAssetRegistry.STATUS_MANAGER_ROLE`, call `pauseBinding(assetId, version)`.
   Deposits revert with `BindingClosedForNewRisk`, new locks and terminal reservations revert, and
   every market and risk domain on that binding closes for new risk.
2. Existing positions keep their pinned collateral and settle normally. `withdraw` checks only that
   the binding existed, so users can leave at any time.
3. If the issuer freezes the vault address, token transfers fail and no Setryn call can move funds.
   Nothing onchain can fix that. Accounting stays exact, and withdrawals succeed again when the freeze
   lifts. If only one user's address is frozen, they withdraw to another `recipient`.
4. Do not use `recoverExcess` to move user funds. It only moves balance above total liability.
5. A replacement token is a new binding version or a new asset with new markets. Positions do not
   migrate between bindings.

Verify: `isOpenForNewRisk(assetId, version)` false, `isLifecycleEnabled` true, and a test
withdrawal on the devnet or fork succeeds while the binding is paused (covered in the rehearsal test).

## Runbook 7: key compromise and role revocation

Detection: an unexpected `RoleGranted`, `RoleRevoked`, or status change event, an unknown
transaction from a role holder, or a signer report.

Response by key:

| Compromised key | Action |
| --- | --- |
| `governanceOperator` | Pause first, using the same key if it is still exclusively yours, the guardian through `RegistryStatusController.pause`, or the admin. Then have `DEFAULT_ADMIN_ROLE` call `revokeRole(role, operator)` for every registry role in the table above, and grant a fresh principal. Review every `activate*` and `register*` since the compromise. Anything activated maliciously gets `pause*` or `deprecate*` |
| `guardian` | Admin revokes `AUCTION_GUARDIAN_ROLE`, `LIFECYCLE_GUARDIAN_ROLE`, and `COMPRESSION_GUARDIAN_ROLE`. The guardian can only cancel pending auctions, lifecycle actions, and compressions, so review those cancellations |
| `excessRecovery` | Admin revokes `EXCESS_RECOVERY_ROLE`. Exposure is capped at `excessOf(token)` |
| `treasuryController` | Exposure is the fee account's available balance. The controller key itself proposes a control transfer to a fresh Safe and the Safe accepts it (vault account control is two-step). Withdraw remaining fees to a safe address first if the key is still under your control |
| `governanceAdmin` pending or accepted | While the transfer is pending, the current admin calls `cancelDefaultAdminTransfer()`. After acceptance, only a new admin transfer (`beginDefaultAdminTransfer`, then `acceptDefaultAdminTransfer` after the delay) rotates it. The delay is the response window |
| Protocol contract role (engine, coordinator) | Revoking vault `TERMINAL_RESERVATION_CREATOR_ROLE`, `TERMINAL_RESERVATION_RESOLVER_ROLE`, `COLLATERAL_LOCKER_ROLE`, or `COLLATERAL_SETTLER_ROLE` from an engine stops new positions and locks at once (`AccessControlUnauthorizedAccount` or `PositionEngineNotAuthorized`). It does not stop existing reservations from finalizing, because vault finalization reads pinned position state and checks no role |
| Operator runtime key (keeper, maker, solver, relay) | Activate the domain kill switch, rotate the key in the environment secret, and restart the worker. These keys hold no admin role |

Users should revoke engine approvals they no longer want with
`CollateralVault.setLockOperator(accountId, operator, false)`. That stops new locks. It does not
affect existing reservations.

Verify: `hasRole(role, oldHolder)` is false for every revoked role, `pendingDefaultAdmin()` shows the
expected state, and the rehearsal flow (open, pause, revoke, settle, withdraw) passes on the devnet
against the new role graph.

## Runbook 8: changing protocol fees

Fees are versioned and never edited in place. Each market version pins one fee version and each series version pins one
market version, so a fee change creates a new fee version and moves every market and series onto it. Open positions keep
the versions they opened under and still fix and settle.

Local chain:

1. `node scripts/update-devnet-fees.mjs --maker-bps <m> --taker-bps <t>` (or the fee form on `/treasury`). It registers
   fee version n+1, installs its witness on `FundedFeeEngine`, pauses version n, activates n+1, re-versions every market
   and series, and rewrites `deployments/local/runtime.json`. Running it again with the same rates does nothing.

Public chains (governance):

1. Run `contracts/script/UpdateFeeSchedule.s.sol` with `SETRYN_FEE_SCHEDULE_REGISTRY`, `SETRYN_FUNDED_FEE_ENGINE`,
   `SETRYN_FEE_SCHEDULE_ID`, `SETRYN_MAKER_FEE_RATE_PPM` and `SETRYN_TAKER_FEE_RATE_PPM`. It refuses to broadcast and
   prints unsigned calldata for: `registerFeeSchedule` (holder of `FEE_SCHEDULE_QUALIFIER_ROLE`),
   `installScheduleWitness` (anyone), and the timelocked `RegistryStatusController.govern` calls that retire the old
   version and activate the new one.
2. Register, activate and retire the matching market and series versions the same way. Series qualification data is
   specific to each series, so prepare it per market.
3. Announce the change in advance. After it lands, old-version positions can no longer be closed early by trading;
   resting orders on old-version books stay unexecutable until they expire or are cancelled.

Verification: `FeeScheduleRegistry.activeVersion(id)` returns the new version, every market's active version names it,
and the first fill after the change records `FeeLedgerEntryRecorded` amounts at the new rates. The `/treasury` page shows
the version history and revenue per version.

## Runbook 9: withdrawing protocol fees

1. Open `/treasury` with the treasury controller's wallet. The page shows the fee account's posted, reserved and
   available balance and revenue by market, channel, action and version.
2. Enter an amount up to the available balance. The page simulates `CollateralVault.withdraw` before asking for the
   signature; any other wallet is refused with `NotAccountController`.
3. Reconcile against the CSV export of `FeeLedgerEntryRecorded` entries before and after the withdrawal.

## Rehearsal findings

`PausePathRehearsal.t.sol` pauses the series, market, instrument, payoff, risk and benchmark
adapters, benchmark, risk domain, fee schedule, settlement binding, calendar, session, and base
asset, and revokes every vault role from `PositionEngine` plus its clearing, funding, and fixing
roles. With all of that in place:

- a new position is refused;
- `finalizeTerminalDisruption` from an unprivileged caller settles the open position, applies the
  fixing fallback, and releases both reservations;
- a normal-path payout settles through `PositionEngine.settle`, `finalizeTerminalLiabilityReservation`,
  and `fulfillTerminalClaim` from an unprivileged caller;
- an open pre-trade lock is released through `releaseExpiredLock`;
- both traders withdraw their full balances while the binding stays paused.

No pause surface deadlocks an existing position or its collateral. The remaining known gap is the
missing onchain quarantine for fixing inputs, noted in the oracle runbook above. The guardian pause
path is rehearsed in `contracts/test/unit/RegistryStatusController.t.sol`.
