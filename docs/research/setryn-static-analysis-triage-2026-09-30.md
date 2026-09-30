# Setryn static analysis triage (2026-09-30)

Phase 6 preparation evidence. Slither 0.11.6 ran over the production sources in `contracts/src` with the pinned
deployment profile (solc 0.8.37, via-IR, optimizer runs 1, Cancun). Tests and scripts were excluded
(`--skip ./test/** ./script/**`). The run used an isolated copy of the contracts tree so the repository build cache was
not touched.

| Impact | Findings |
| --- | --- |
| High | 9 |
| Medium | 202 |
| Low | 433 |

No High or Medium finding is an exploitable defect. Each class is triaged below with the code evidence that closes it.
Low and informational findings (naming, timestamps in comparisons, missing zero checks on role-gated setters,
assembly use) are not repeated here.

## High

### arbitrary-send-eth (1)

`GmxV2OrderSubmissionLib.withdrawNativeInventory` sends native inventory to a caller-supplied recipient.

- The only entry point is `GmxV2OrderAdapter.withdrawNativeInventory`, which is `onlyRole(INVENTORY_MANAGER_ROLE)` and
  `nonReentrant`.
- The library function can move only unreserved native inventory (`inventoried - reserved`), debits the inventory before
  the transfer, and checks the exact balance delta afterwards.
- The library function changes state, so Solidity's library call protection makes a direct call to the library address
  revert. It runs only by delegatecall from the adapter.

Status: false positive. The recipient is chosen by an authorized inventory manager.

### reentrancy-balance (7)

`UniswapV3ExactInputSingleAdapter.submitExternalAction` (3), `AaveV3SupplyWithdrawAdapter._executeSupply` and
`_executeWithdraw` (3), and `GmxV2OrderSubmissionLib.submitExternalAction` (1) read balances before a venue call and
compare deltas after it.

- The balance deltas are deliberate exact-settlement checks. Each adapter rejects a venue result whose observed token
  movement differs from the reported amount.
- Every external entry point that reaches these calls (`submitExternalAction` on all three adapters) is `nonReentrant`.
  A venue callback cannot re-enter the adapter to move the balances between the two reads.
- The venue addresses (router, pool, exchange router) are immutable, qualified dependencies bound at construction and
  recorded in the deployment manifest.

Status: false positive.

### uninitialized-state (1)

`SeriesRegistry._seriesCount` is reported as never written.

- The registry passes `_seriesCount.slot` (`_seriesCountSlot()`) to its linked registration library, which increments
  the counter through that storage slot. Slither does not follow writes made through a slot passed to a library.

Status: false positive.

## Medium

### uninitialized-local (134)

Locals declared without an initializer and assigned on every path before use, or intentionally zero (loop counters,
accumulators, optional outputs). Solidity zero-initializes locals.

Status: accepted as style. No behavior change.

### unused-return (45)

The ignored values fall into four groups, all intentional:

- Tuple getters where only some fields are needed: `positionEngine.getPosition`, `collateralVault.getAccount`,
  `collateralVault.balanceOf`, `assetRegistry.getAsset`, `Math.mul512`, and
  `streamingQuoteEngine.previewFirmQuote`.
- Validation calls that revert on failure and return data the caller does not need: `CapacityLockLib.requireExact`,
  `PublicBookLib.opposite(side)` (used as a side validator in `pruneBest` and `bestLevel`), `this.validateComponents`,
  `StreamPricingLib.quote` (band check before a route reservation), and `ProtocolReceiptAuthorities` reading
  `source.getAuction` as an existence check.
- State-changing calls whose outcome is re-read from state immediately afterwards: `fixingEngine.finalizeFixingVector`
  and `applyTerminalFallbackVector` (the caller then reads each finalized `FixingResult`), and
  `collateralVault.finalizeTerminalLiabilityReservation` and `materializeTerminalClaimAfterFinalResolution` (the
  reservation state is authoritative).
- Handles that the callee also stores under a caller-known key: `reserveStreamCapacity` (the lock is read back through
  `getStreamCapacity(streamId)`), `consumeClearingHandoff` (the handoff is validated beforehand by
  `_validateAuctionSource`, and consumption marks it used), and `replaceLifecycleReservations`.

Status: reviewed. No ignored value carries information the caller needs.

### reentrancy-no-eth (19)

State written after calls to protocol dependencies in `PublicOrderBook` (match, rest, reserve, prune, sync paths),
`CollateralAwareRouteEngine`, `StreamingQuoteEngine`, the vault-backed stream and batch capacity managers,
`BatchClearingEngine`, `CompressionCoordinator`, `DefaultProcessEngine.openDefault`, and the Uniswap and Aave adapters.

- Every external entry point on these paths is `nonReentrant`: `matchSeries`, `matchPackage`, `matchReservedSeries`,
  `matchReservedPackage`, `placeSeriesOrder` and `placePackageOrder`, `syncOrder`, `pruneBest`, `reserveForRoute`,
  `selectAndReserve`, `invalidateRoute`, `registerStream`, `reserveStreamCapacity`, `expireStreamCapacity`,
  `consumeBatchCapacity`, `expireBatchCapacity`, `executeSeriesBatch`, `executePackageBatch`,
  `authorizeCompression`, `openDefault`, and both adapters' `submitExternalAction`.
- The callees are immutable protocol dependencies (OrderState, AtomicClearingEngine, PositionEngine, CollateralVault)
  or qualified venues. Their privileged entry points are role-gated to the calling contract.

Status: false positive under the existing guards.

### incorrect-equality (4)

Strict equality against an enum's `Unspecified` value or a zero identifier in `getReservation`, `getReceipt`,
`getDefaultProcess`, and `GmxV2OrderCallbackLib.recoverExternalAction`. These are existence checks on stored records,
not comparisons of balances or timestamps.

Status: false positive.

## Follow-ups

- Re-run this triage after any change to a flagged function, and record new findings here before the Arbitrum Sepolia
  release candidate.
- `PublicBookLib.opposite(side)` is used only to validate a side in two places. A dedicated `requireSide` helper would
  make that intent explicit without changing behavior.
