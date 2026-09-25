# Setryn market, instrument, and economic rules

Date: 2026-09-25  
Status: Phase 0 implementation specification  
Scope: canonical markets, instruments, series, packages, payoff, fixing, margin inputs, exercise, and cash settlement

## 1. Authority and boundary

This document fixes the economic objects consumed by the first-party Setryn exchange. It is the
implementation contract between the market registries, execution, positions, fixing, clearing,
settlement, indexer, and first-party application.

The following existing specifications remain authoritative within their boundaries:

- [`setryn-numeric-conventions.md`](setryn-numeric-conventions.md) for `Lots`, `PriceTicks`,
  `TickSizeMinor`, `Rate`, signed arithmetic, decimal rescaling, and allocation;
- [`setryn-calendar-registry.md`](setryn-calendar-registry.md) for business-day evidence;
- [`setryn-session-registry.md`](setryn-session-registry.md) for absolute UTC windows;
- [`setryn-adapter-registry.md`](setryn-adapter-registry.md) for chain-local implementations;
- [`setryn-settlement-asset-qualification.md`](setryn-settlement-asset-qualification.md) for ERC-20
  settlement bindings;
- the implemented asset, benchmark, risk-domain, and fee-schedule registries for those exact
  dependencies.

This document does not define public APIs, external SDKs, webhooks, widgets, or partner tooling.
Those are Phase 8 products. Internal schemas, generated bindings, indexer records, and application
services may implement this specification when the first-party platform consumes them.

V1 positions are cash-settled. A later deliverable-settlement module may use the same extension
boundaries, but it is not an alternative interpretation of a V1 cash series.

## 2. Chain and time model

- Canonical lineage IDs exclude `chainId` and contract address. The same economic lineage therefore
  has the same ID on Arbitrum Sepolia, chain ID `421614`, and Arbitrum One, chain ID `42161`.
- Every definition that binds a chain-local adapter, settlement token, benchmark version, risk-domain
  version, fee-schedule version, or deployed module includes `block.chainid` in its definition and
  version hashes.
- Every signed order, quote, exercise instruction, and lifecycle authorization uses an EIP-712 domain
  containing the current chain ID and verifying contract. An ID being chain-portable never makes a
  signature replayable across chains.
- All instants are unsigned UTC seconds and all day labels are `floor(timestamp / 1 days)` as defined
  by the calendar and session registries. Contracts do not calculate timezones or daylight saving.
- Financial formulas and state transitions are identical on Sepolia and One. Addresses, active
  versions, caps, and qualification evidence may differ by deployment.

The already implemented identifiers are used without aliases: `MarketId`, `InstrumentId`,
`SeriesId`, and `PackageId`. `IdLib.deriveMarketId`, `deriveInstrumentId`, `deriveSeriesId`, and
`derivePackageId` remain their only derivation entry points.

## 3. Open tags and hard limits

The implementation adds open, namespaced `bytes32` tags rather than closed Solidity enums for:

- `PayoffFamilyId`;
- `QuoteUnitId`;
- `SettlementClassId`;
- `ExercisePolicyId`;
- `FixingSelectionRuleId`;
- `DisruptionOutcomeId`.

Any nonzero tag can be registered. A consumer accepts only exact tags and capability commitments it
implements and fails closed on every other value. Initial constants are conveniences, not allowlists.

V1 consumers enforce these bounds before hashing or storing a definition:

| Bound | Value |
| --- | ---: |
| Fixing slots per series | 16 |
| Ordered candidates per fixing slot | 4 |
| Package legs | 16 |
| Encoded payoff terms | 4096 bytes |
| Module return data | 4096 bytes |
| Session windows in one proof | 16, inherited from `SessionRegistry` |

Raising a bound requires a new consumer capability and a new version. A registry must never silently
truncate an oversized definition.

## 4. Object model and identity

The four economic objects have separate responsibilities.

| Object | Meaning | Stable lineage key |
| --- | --- | --- |
| Market | Chain-local trading, quote, settlement, session, fee, and risk perimeter for an asset pair | namespace, market key, base asset, quote asset |
| Instrument | A payoff family and an exact qualified module interface | namespace, instrument key, payoff family |
| Series | One dated use of an instrument in one market with immutable terms, fixings, bounds, exercise, and disruption rules | namespace, series key, market ID, instrument ID |
| Package | A canonical atomic ratio of exact series versions | namespace, package key |

Identity fields answer what the lineage is. Version fields answer how that lineage is qualified on a
particular chain. A revision to a module, cap, tick, date, fixing rule, or dependency creates a new
version. It never edits an earlier version and never creates a second lineage merely to evade version
history.

Every registry version starts at 1. Version 0 means absent. Definition hashes use explicit V1
typestrings and commit every field plus chain ID where the definition is chain-local. Version hashes
commit the typed ID, sequential version, definition hash, and chain ID. An identical definition hash
cannot be registered twice under one ID.

The lineage key typestrings are fixed as:

```text
SetrynMarketKeyV1(bytes32 namespaceId,bytes32 marketKey,bytes32 baseAssetId,bytes32 quoteAssetId)
SetrynInstrumentKeyV1(bytes32 namespaceId,bytes32 instrumentKey,bytes32 payoffFamilyId)
SetrynSeriesKeyV1(bytes32 namespaceId,bytes32 seriesKey,bytes32 marketId,bytes32 instrumentId)
SetrynPackageKeyV1(bytes32 namespaceId,bytes32 packageKey)
```

The definition typestring for each object is named `Setryn<Object>DefinitionV1`, lists the ABI type
of every field in the displayed struct order, unwraps each user-defined value type to its underlying
ABI type, and appends `uint256 chainId`. The version typestring is exactly
`Setryn<Object>VersionV1(bytes32 <object>Id,uint32 version,bytes32 definitionHash,uint256 chainId)`.
These spellings and orders cannot be edited in place. A changed encoding uses V2.

## 5. Canonical schemas

The Solidity implementation may split a large encoding across static `abi.encode` calls to avoid
stack limits, but the result must be byte-identical to the single canonical encoding described here.
Dynamic child records are canonically encoded, hashed, stored by commitment, and emitted in full at
registration. Anyone may later supply the same bytes and prove them against the stored hash.

The dynamic commitment rules are:

```text
termsDataHash = keccak256(terms)
payoffTermsHash = keccak256(abi.encode(
    keccak256("SetrynPayoffTermsV1(bytes32 termsSchemaHash,bytes32 termsDataHash)"),
    termsSchemaHash,
    termsDataHash
))

candidateHash = keccak256(abi.encode(
    keccak256("SetrynFixingCandidateV1(bytes32 benchmarkId,uint32 benchmarkVersion,bytes32 requiredWindowKindId,bytes32 selectionRuleId,uint64 targetAt,uint64 windowStartsAt,uint64 windowEndsAt,uint64 unavailableAfter,uint32 maxPublicationDelaySeconds,uint16 minimumObservations,uint16 maximumObservations,bytes32 selectionParametersHash)"),
    all candidate fields in that order
))

slotHash = keccak256(abi.encode(
    keccak256("SetrynFixingSlotV1(uint8 slot,bytes32 candidatesHash)"),
    slot,
    keccak256(abi.encodePacked(candidateHashes))
))

fixingSlotsHash = keccak256(abi.encode(
    keccak256("SetrynFixingSlotsV1(bytes32 slotsHash)"),
    keccak256(abi.encodePacked(slotHashes))
))

legHash = keccak256(abi.encode(
    keccak256("SetrynPackageLegV1(bytes32 seriesId,uint32 seriesVersion,int32 ratio)"),
    seriesId,
    seriesVersion,
    ratio
))

legsHash = keccak256(abi.encode(
    keccak256("SetrynPackageLegsV1(bytes32 legHashesHash)"),
    keccak256(abi.encodePacked(legHashes))
))
```

An empty fixing-slot or leg array is invalid, so the corresponding empty-list hash never enters a
series or package.

### 5.1 Market

```solidity
struct MarketDefinition {
    bytes32 namespaceId;
    bytes32 marketKey;
    AssetId baseAssetId;
    AssetId quoteAssetId;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    BenchmarkId markBenchmarkId;
    uint32 markBenchmarkVersion;
    CalendarId tradingCalendarId;
    uint32 tradingCalendarVersion;
    SessionId tradingSessionId;
    uint32 tradingSessionVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    QuoteUnitId quoteUnitId;
    TickSizeMinor tickSizeMinor;
    Lots lotStep;
    Lots minOrderLots;
    Lots maxOrderLots;
    PriceTicks minPriceTicks;
    PriceTicks maxPriceTicks;
    bytes32 executionModeSetHash;
    bytes32 qualificationEvidenceHash;
}
```

The V1 market key hashes `namespaceId`, `marketKey`, `baseAssetId`, and `quoteAssetId`. All other
fields belong to the immutable chain-local version.

V1 market validation requires:

1. Every ID, dependency version, and commitment is nonzero.
2. Base and quote assets exist and differ.
3. `quoteAssetId == settlementAssetId`. Cross-currency cash settlement requires a future qualified
   conversion module and is not accepted by a V1 consumer.
4. The settlement binding, mark benchmark, trading calendar and session, risk domain, and fee
   schedule all exist. The session must name the same calendar and calendar version as the market.
5. The mark benchmark base and quote assets exactly equal the market pair. A reversed pair is a
   different benchmark and is not inverted implicitly.
6. The risk domain and fee schedule name the same settlement asset ID and binding version as the
   market.
7. `quoteUnitId` equals the V1 tag `SetrynQuoteUnitV1:SettlementMinorPerLot`.
8. Tick size and all lot bounds are positive, `minOrderLots <= maxOrderLots`, and each of those two
   bounds is an exact multiple of `lotStep`.
9. `minPriceTicks <= maxPriceTicks`. Zero and negative prices are valid when inside the bounds.

The market stores no symbol-driven behavior. Asset class and symbols are discovery metadata only.

### 5.2 Instrument

```solidity
struct InstrumentDefinition {
    bytes32 namespaceId;
    bytes32 instrumentKey;
    PayoffFamilyId payoffFamilyId;
    SettlementClassId settlementClassId;
    AdapterId payoffModuleId;
    uint32 payoffModuleVersion;
    AdapterKindId requiredAdapterKindId;
    bytes32 requiredInterfaceHash;
    bytes32 requiredCapabilityHash;
    bytes32 termsSchemaHash;
    uint16 maxFixingSlots;
    uint32 maxTermsBytes;
    uint64 maxEvaluationGas;
    bytes32 lifecyclePolicyHash;
    bytes32 qualificationEvidenceHash;
}
```

The V1 instrument key hashes `namespaceId`, `instrumentKey`, and `payoffFamilyId`. The V1 settlement
class is `SetrynSettlementClassV1:Cash`. `payoffModuleId` and `payoffModuleVersion` refer to an exact
`AdapterRegistry` version whose kind is the open tag `SetrynAdapterKindV1:Payoff`. Interface and
capability hashes must match exactly. V1 rejects zero bounds, a fixing-slot bound above 16, a term
bound above 4096 bytes, and an evaluation gas bound above the settlement engine's published hard cap.

Payoff implementations are called only with `staticcall` and a fixed gas limit. `delegatecall` is
forbidden. Qualification evidence must show that the implementation is non-upgradeable, has no
self-destruct path, reads no mutable external state, and produces output solely from its calldata.
A proxy is not eligible as a payoff module. Runtime code-hash mismatch closes new risk immediately.

### 5.3 Series

```solidity
struct SeriesDefinition {
    bytes32 namespaceId;
    bytes32 seriesKey;
    MarketId marketId;
    uint32 marketVersion;
    InstrumentId instrumentId;
    uint32 instrumentVersion;
    uint64 tradingStartsAt;
    uint64 lastTradeAt;
    uint64 expiryAt;
    uint64 exerciseOpensAt;
    uint64 exerciseCutoffAt;
    uint64 fixingStartsAt;
    uint64 fixingEndsAt;
    uint64 primaryEvidenceDeadline;
    uint64 correctionCutoffAt;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
    ExercisePolicyId exercisePolicyId;
    DisruptionOutcomeId disruptionOutcomeId;
    bytes32 payoffTermsHash;
    bytes32 fixingSlotsHash;
    bytes32 dateAdjustmentEvidenceHash;
    uint128 maxLongDebitMinorPerLot;
    uint128 maxShortDebitMinorPerLot;
    bytes32 qualificationEvidenceHash;
}
```

The V1 series key hashes `namespaceId`, `seriesKey`, `marketId`, and `instrumentId`. Registration also
accepts the canonical payoff-term bytes and fixing-slot encoding, checks their lengths and hashes,
and emits both so an indexer is not a data-availability trust assumption.

Time ordering is exact. Trading stops before any fixing observation can begin:

```text
tradingStartsAt <= lastTradeAt < fixingStartsAt <= fixingEndsAt <= expiryAt
expiryAt <= primaryEvidenceDeadline
primaryEvidenceDeadline <= correctionCutoffAt < finalResolutionAt <= settlementDeadline
```

Exercise policy adds the constraints in section 12. Expiry may equal fixing end. Settlement may be
submitted after `settlementDeadline`, but a late submitter can only execute the terminal outcome that
became fixed at or before that deadline. Time passing never creates a different economic result.

Both per-lot debit bounds are stored in settlement-asset minor units. They are terminal obligations,
not unsigned notionals. At least one must be nonzero. The payoff module must independently derive the
same two bounds from the supplied terms during registration and activation. A mismatch is rejected.

### 5.4 Fixing slots

```solidity
struct FixingCandidate {
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    WindowKindId requiredWindowKindId;
    FixingSelectionRuleId selectionRuleId;
    uint64 targetAt;
    uint64 windowStartsAt;
    uint64 windowEndsAt;
    uint64 unavailableAfter;
    uint32 maxPublicationDelaySeconds;
    uint16 minimumObservations;
    uint16 maximumObservations;
    bytes32 selectionParametersHash;
}

struct FixingSlot {
    uint8 slot;
    FixingCandidate[] candidates;
}
```

Slots are strictly ordered from 0 with no gap. Candidate order is fallback priority, with index 0 as
primary. There are no duplicate benchmark-version-window tuples. Windows are nonempty, candidates
are chronologically coherent, and `unavailableAfter` is after the candidate window and no later than
`finalResolutionAt`. Every candidate benchmark's asset pair and output semantics must be accepted by
the payoff module capability hash. Observation bounds are nonzero and
`minimumObservations <= maximumObservations`. `Official`, `LastAtOrBefore`, and `FirstAtOrAfter`
require both bounds to equal 1.

The initial selection tags are:

- `Official`: one source-designated fixing identified by `selectionParametersHash`;
- `LastAtOrBefore`: the latest eligible observation no later than `targetAt`;
- `FirstAtOrAfter`: the earliest eligible observation no earlier than `targetAt`;
- `ArithmeticMean`: every scheduled observation in the closed interval, at the exact committed
  cadence, summed and divided by count toward zero;
- `TimeWeightedMean`: every source interval in the closed window, weighted by integer seconds, with
  the final division toward zero.

An adapter capability for these rules must prove selection completeness. A caller-supplied subset of
otherwise valid observations is not evidence for `LastAtOrBefore`, `FirstAtOrAfter`, either mean, or
an official fixing. The fixing engine never infers completeness from arrival order.

### 5.5 Package

```solidity
struct PackageLeg {
    SeriesId seriesId;
    uint32 seriesVersion;
    int32 ratio;
}

struct PackageDefinition {
    bytes32 namespaceId;
    bytes32 packageKey;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    bytes32 legsHash;
    QuoteUnitId quoteUnitId;
    TickSizeMinor tickSizeMinor;
    Lots lotStep;
    Lots minOrderLots;
    Lots maxOrderLots;
    PriceTicks minPriceTicks;
    PriceTicks maxPriceTicks;
    uint128 maxLongDebitMinorPerPackageLot;
    uint128 maxShortDebitMinorPerPackageLot;
    bytes32 lifecyclePolicyHash;
    bytes32 qualificationEvidenceHash;
}
```

The V1 package key hashes `namespaceId` and `packageKey`. Registration accepts and emits the legs.
Legs are strictly sorted by unwrapped `SeriesId` then version, each exact series occurs once, every
ratio is nonzero, the greatest common divisor of absolute ratios is 1, and the first ratio is
positive. This yields one canonical orientation and prevents economically identical encodings from
splitting liquidity.

One package lot contains `abs(ratio)` lots of each leg. A positive ratio holds the long side of that
series; a negative ratio holds the short side. `packageLots * abs(ratio)` must fit `uint128` before a
fill. Every leg must use the package's exact settlement binding. V1 packages cannot perform an
implicit currency conversion.

Package terminal bounds are conservative sums of leg bounds:

```text
long package bound  = sum(abs(ratio) * bound for the oriented long leg)
short package bound = sum(abs(ratio) * bound for the opposite leg)
```

Each multiplication and sum is checked and the stored bounds must equal the derived values. A risk
domain may grant a smaller margin requirement from enforceable portfolio offsets, but it cannot
rewrite the package's disclosed maximum liability.

Packages create atomic execution and retain package identity. Their legs remain independently fixed
and settled under their exact series versions. There is no package-level rounding that can change a
leg payout.

## 6. Executable quote and lot rules

The only V1 signed executable quote unit is settlement-asset minor units per market or package lot.
One lot's signed cash price is:

```text
priceMinorPerLot = PriceTicks * TickSizeMinor
fillPriceMinor   = lots * priceMinorPerLot
```

This is the existing `NotionalLib.fillNotional` result and has no division. Positive price means the
long buyer pays the short seller. Negative price means the long buyer receives cash from the short
seller. Zero is a valid price. `Side.Buy` acquires the canonical long payoff and `Side.Sell` acquires
the canonical short payoff. Lots never carry direction.

Forward points, outright forward level, annualized rate, implied volatility, spread, and target
outcome are first-party input and display modes. The compiler must turn them into immutable series
terms or a cash tick price before signature. They are never alternative interpretations of
`PriceTicks`, and a receipt always includes both the user's input mode and the resulting canonical
terms and cash price.

An order is valid only when:

- lots are between the inclusive min and max and divisible by `lotStep`;
- price ticks are between the inclusive min and max;
- the exact market, series, or package version is open for new risk;
- the current timestamp is within a proved `Trading` session window and outside every overlapping
  proved `Maintenance` window;
- its execution mode is committed by `executionModeSetHash` and implemented by the consumer.

Indicative values, model marks, oracle observations, and chart points cannot satisfy an executable
price field.

## 7. Payoff module contract

The required payoff interface is semantically equivalent to:

```solidity
interface IPayoffModuleV1 {
    function payoffFamilyId() external pure returns (PayoffFamilyId);

    function validateSeries(
        SeriesContext calldata context,
        bytes calldata terms,
        FixingSlot[] calldata slots
    ) external pure returns (uint128 maxLongDebitMinorPerLot, uint128 maxShortDebitMinorPerLot);

    function computeTransfer(
        SeriesContext calldata context,
        bytes calldata terms,
        FixingValue[] calldata fixings,
        Lots lots
    ) external pure returns (int256 transferMinor);
}
```

`transferMinor` is from short to long. A positive result debits the short and credits the long. A
negative result debits the long and credits the short. The settlement engine rejects a result below
`-lots * maxLongDebitMinorPerLot` or above `lots * maxShortDebitMinorPerLot`, even if the module was
qualified. A module cannot move collateral, call an adapter, inspect account state, choose a fixing,
charge a fee, or decide a lifecycle state.

Every V1 formula follows this evaluation order:

1. Validate exact fixing count, slot numbers, benchmark versions, scales, and terms hash.
2. Evaluate the unbounded signed rational formula with checked 256-bit intermediates.
3. Clamp the exact rational value to the declared integral debit bounds.
4. Convert to settlement minor units toward zero.
5. Check the returned integer against both stored bounds.

Clamping before the final conversion prevents rounding from crossing a cap. Toward-zero terminal
rounding never charges either payer an extra minor unit. Any remainder stays in the payer's locked
collateral and is released after settlement.

The formulas in section 8 are written per lot to expose their economic meaning and derive bounds.
For an actual position, the module multiplies the common numerator by `lots` before the final
division and rounds once. It does not round one lot and multiply the rounded result.

## 8. Initial payoff families

In the formulas below, `x`, `k`, and any second reference use a declared calculation scale `D =
10 ** calculationDecimals`. `n` is a nonnegative settlement-minor-unit amount per whole reference
unit per lot. `C(a,b,z)` means `min(b, max(a, z))`. All terms, including `calculationDecimals`, are
inside the emitted term bytes and their hash.

### 8.1 Capped forward and NDF

```text
raw = n * (x - k) / D
payoffPerLot = C(-longDebitCap, shortDebitCap, raw)
```

Division is deferred until the common numerator is formed and the terminal conversion is toward
zero. A capped forward and an NDF use the same cash formula. Their family tags differ because an NDF
explicitly represents a non-deliverable reference and carries different disclosure and qualification
evidence. Neither can be switched to delivery after a fill.

### 8.2 European call and put

```text
callPerLot = min(shortDebitCap, max(0, n * (x - strike) / D))
putPerLot  = min(shortDebitCap, max(0, n * (strike - x) / D))
```

The canonical long never owes a terminal amount, so its terminal debit bound is zero. Premium is the
separate fill price. Covered-call and protective-put strategies are packages, not a different
interpretation of these formulas.

### 8.3 Collar

For a canonical long call at `upperStrike` and short put at `lowerStrike`, with
`lowerStrike <= upperStrike`:

```text
raw = n * (max(x - upperStrike, 0) - max(lowerStrike - x, 0)) / D
payoffPerLot = C(-longDebitCap, shortDebitCap, raw)
```

A reversed collar uses a different series orientation or the short side. Strike equality is valid.

### 8.4 Rate cap, floor, forward, and collar

`accrualFactorWad` is an immutable WAD-scaled fraction produced from the committed day-count rule at
series registration. Runtime settlement does not recalculate a civil day count.

```text
rateForwardRaw = n * accrualFactorWad * (r - k) / (WAD * D)
rateCapRaw     = n * accrualFactorWad * max(r - k, 0) / (WAD * D)
rateFloorRaw   = n * accrualFactorWad * max(k - r, 0) / (WAD * D)
```

The forward and collar clamp to two-sided debit caps. A cap or floor clamps to its one-sided writer
cap. Compounding, tenor, and day-count methodology are benchmark or curve evidence and series terms,
never inferred from the asset class.

### 8.5 Basis and calendar spread

Each fixing is rescaled to the declared calculation decimals with signed truncation toward zero.

```text
raw = n * ((xA - xB) - strikeSpread) / D
payoffPerLot = C(-longDebitCap, shortDebitCap, raw)
```

A calendar spread uses two dated references to the same economic underlying. A basis spread may use
spot, perpetual mark, dated future, NAV, redemption, or another qualified benchmark kind. The kinds
and ordering are explicit terms. The engine never substitutes one benchmark kind for another.

### 8.6 Window and average-rate contracts

The fixing engine first produces the complete arithmetic or time-weighted mean specified by the
fixing candidate. The payoff module then applies the capped forward, option, collar, cap, or floor
formula to that one fixed value. A window contract is not allowed to accept an arbitrary sample as
its average.

### 8.7 Correlation and dispersion

V1 does not calculate logarithms or realized covariance from a caller-supplied price array. It takes
one qualified correlation or dispersion metric benchmark whose `observationRuleHash` commits the
constituents, weights, return convention, sample schedule, annualization, missing-data treatment,
corporate-action treatment, and metric scale. The cash formula is the capped scalar formula:

```text
raw = n * (metric - strikeMetric) / D
payoffPerLot = C(-longDebitCap, shortDebitCap, raw)
```

Directional exposures to constituents are separate package legs. This keeps the metric computation
qualified and replayable instead of hiding a floating numerical method in settlement.

### 8.8 Unsupported formulas

American exercise, Bermudan exercise, unbounded forwards, uncapped short options, path-dependent
barriers, arbitrary user bytecode, and formulas whose loss bound depends on a future governance
choice fail closed in V1. They require a new payoff capability and a new instrument version. A
package cannot make an unsupported formula valid by decomposing it into hidden offchain behavior.

## 9. Maximum loss and collateral admission

For `q` lots and signed fill price `p` in minor units, before fees:

```text
longTerminalLiability  = q * maxLongDebitMinorPerLot
shortTerminalLiability = q * maxShortDebitMinorPerLot
longEconomicMaxLoss    = max(0, longTerminalLiability + p)
shortEconomicMaxLoss   = max(0, shortTerminalLiability - p)
```

Positive `p` is the long's fill debit. Fees are added to the displayed economic maximum loss using
their independently bounded maximum charge. An entry credit can reduce economic loss, but it never
reduces the terminal liability lock unless the collateral ledger atomically retains that credit in
the same account.

No order can open a position unless both side-specific maximum terminal liabilities fit the risk
domain's account and aggregate liability caps. `maxOpenInterestBaseUnits` is checked separately from
liability because notional and loss are different measures.

The first production activation mode is `FullyFunded`: each side locks its full terminal liability,
plus fill cash debit, maximum fill fee, and any explicitly funded settlement reward. This produces no
instrument-level liquidation requirement.

`PortfolioMargin` is a separate risk-model capability. It may reserve less than gross terminal
liability only when the exact risk-domain version authorizes it. The maximum loss remains the series
bound, and default handling remains inside that domain. The user interface must not describe a
portfolio-margined position as fully funded.

## 10. Margin inputs and deterministic rounding

A margin result commits all of these inputs:

- exact risk-domain ID, version, definition hash, model ID, margin-rules hash, and scenario-set hash;
- account and subaccount;
- every position's series ID and version, side, lots, immutable debit bounds, and lifecycle state;
- every package relationship without replacing its component positions;
- current collateral balance, active locks, pending withdrawals, unpaid fees, and realized cash;
- all open orders, firm quote reservations, maximum fill cash debit, maximum fill fee, and expiry;
- versioned mark and volatility snapshots with benchmark evidence and observation times;
- scenario values, concentration buckets, liquidity and close-time add-ons, and recognized offsets;
- calculation timestamp, Arbitrum block number, and risk-engine capability hash.

For each scenario, losses are computed position by position, then summed with checked signed
arithmetic. The margin engine may recognize only offsets explicitly committed by the risk-domain
version. It cannot infer an offset from asset class, symbol, historical correlation, or package
membership.

Rounding is mandatory:

- terminal liabilities, initial margin, maintenance margin, concentration add-ons, liquidity
  add-ons, reservation requirements, charge fees, and default assessments round up;
- collateral credits, rebates, releases, and offset benefits round down;
- signed scenario PnL and terminal payout round toward zero only where this specification names that
  operation;
- a conversion used to test solvency rounds against the account, never in its favor;
- aggregation never assigns a rounding residual implicitly.

For the initial scenario models:

```text
scenarioRequirement = max over scenarios of max(0, -scenarioNetPnl)
grossFloor = risk-domain committed fraction of gross terminal liability, rounded up
initialMargin = max(grossFloor, scenarioRequirement + concentrationAddOn + liquidityAddOn)
maintenanceMargin = committed maintenance formula over the same input snapshot
```

All additions round up at their own rule boundary. `initialMargin >= maintenanceMargin` is required.
The domain's `marginRulesHash` fixes factors, scenario valuation, mark choice, offset eligibility, and
recalculation triggers. A changed factor or grid is a new risk-domain version. A live position keeps
the domain version it opened under unless a separately authorized novation creates a replacement
position and the user accepts the new terms.

## 11. Benchmark evidence and fixing selection

A benchmark adapter normalizes provider evidence into:

```solidity
struct BenchmarkObservation {
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    int256 value;
    uint8 decimals;
    uint64 observedAt;
    uint64 publishedAt;
    uint64 sequence;
    uint16 confidenceBps;
    bytes32 sourceEvidenceHash;
}
```

The adapter must verify the provider signature or onchain source, exact `feedKey`, output decimals,
publish and observation times, sequence or revision, confidence bound, and the selection-completeness
proof required by the candidate rule. Core fixing then verifies:

1. The exact benchmark and adapter versions committed by the series and benchmark definition.
2. `decimals == BenchmarkDefinition.outputDecimals` and confidence is no wider than
   `maxConfidenceBps`.
3. `publishedAt` is not earlier than `observedAt`, does not exceed the candidate's publication
   allowance, and is not more than benchmark `maxFutureSkewSeconds` ahead of the accepting L2 block.
4. The observation or aggregate belongs to the candidate window and selection rule.
5. A valid calendar day proof and exact session-day and window proof show the required `Fixing` or
   `Observation` window. The supplied window list must hash to the proved `SessionDay.windowsHash`.
6. The benchmark, calendar, and session versions are historically lifecycle-enabled. Current Active
   status is not required for a position that already exists.

`maxStalenessSeconds` governs a live mark at order and risk-check time. Historical fixing evidence is
instead governed by the series window, evidence deadline, provider publication allowance, and
adapter-verified historical proof. Applying `block.timestamp - publishedAt` to a historical fixing
would make permissionless late settlement impossible and is forbidden.

A fixing proposal is atomic across every slot. Partial vectors are rejected. One accepted value per
slot is stored under a fixing-record hash. Candidate priority is lowest index first. A fallback
candidate is ineligible before every higher-priority candidate's `unavailableAfter`. A later valid
higher-priority proposal replaces a lower-priority proposal before `correctionCutoffAt`.

For the same candidate, a higher provider revision supersedes a lower revision before the correction
cutoff. Two valid observations with the same sequence but different values put the record in
`Disputed`; neither value is selected. After `correctionCutoffAt`, anyone may finalize the complete,
highest-priority, highest-revision non-conflicting vector. Caller identity and transaction ordering
never affect the result.

## 12. Calendar, session, and exercise

### 12.1 Dates

Each series registration supplies proofs for its final trading, expiry, fixing, exercise, and
settlement day labels. Dates are resolved before registration. V1 supports only:

- `Unadjusted`, for which scheduled and effective day are equal; and
- `Following` or `Preceding`, with a maximum shift of 14 days.

For an adjusted day, the registration evidence proves the effective day is a business day and every
skipped day in the chosen direction is not. Modified-following, modified-preceding, end-of-month, and
asset-specific roll conventions require a new date-adjustment capability. No contract silently
implements them offchain.

Absolute timestamps are then frozen in the series. A later calendar correction creates a new series
version for new risk and never moves an existing position's dates.

### 12.2 Sessions

New risk requires a current `Trading` window and is blocked by any overlapping `Maintenance` window.
Fixing uses only the exact window kind in its candidate. An `Auction` window authorizes only an
auction execution path. Window overlap grants no implied capability.

Series activation proves that every trading, exercise, fixing, and settlement day falls inside the
relevant committed calendar and session horizons. Historical lifecycle operations verify the frozen
versions without requiring them to remain Active.

### 12.3 Exercise

V1 supports three European policies:

- `Automatic`: exercise is determined from the finalized payoff. Exercise open and cutoff are both
  zero.
- `HolderElection`: the long holder or an explicitly delegated policy may exercise from
  `exerciseOpensAt` through `exerciseCutoffAt`, inclusive. No valid election by cutoff lapses the
  series with zero terminal transfer.
- `AutomaticUnlessAbandoned`: the position exercises automatically when the absolute receivable is
  at least a nonzero, committed minor-unit threshold. The long may abandon during the stated window.

For the two election policies:

```text
expiryAt <= exerciseOpensAt <= exerciseCutoffAt <= finalResolutionAt
```

The series therefore states whether the holder election happens while evidence is pending or after a
fixing is proposed. Settlement readiness requires both a conclusive exercise result and a conclusive
fixing or disruption result.

An exercise or abandonment instruction binds position ID, current owner, position nonce, exact
series version, action, deadline, chain ID, and verifying contract. It is single-use. Transfer after
an instruction invalidates it unless the transfer explicitly carries and reauthorizes the instruction.
The short side cannot exercise. Exercise changes whether the formula runs, never its formula, cap,
fixing, or settlement asset.

## 13. Disruption and fallback

Fallbacks are the ordered candidates already committed in each fixing slot. A source cannot be added
after trading closes. An inactive current benchmark version is not substituted for the position's
exact historical version.

Every V1 series chooses one terminal disruption outcome:

- `Flat`: terminal transfer is zero; or
- `PrecommittedValue`: every unresolved slot uses an exact signed value and decimals included in the
  payoff terms at registration, after which the normal bounded formula runs.

`PrecommittedValue` is acceptable only when qualification evidence explains the economic meaning and
the resulting transfer is inside both stored debit bounds. A governance-selected price, an operator
assertion, or the latest UI mark is never a precommitted value.

At `finalResolutionAt`, if any slot has no complete non-conflicting fixing, anyone may finalize the
declared disruption outcome. If the qualified payoff module is unavailable or its runtime code hash
does not match, the only permitted V1 recovery is `Flat`. This produces `RecoveredFlat`, releases
terminal liability locks, and leaves already completed entry cash and fees unchanged.

There is no indefinite `Pending`, discretionary bounded price, or unilateral winner selection. A
future challenged manual-resolution module may be added as a new capability, but it cannot apply to
an existing V1 series.

## 14. Cash settlement

The settlement engine consumes the exact series version, term bytes, finalized fixing record or
terminal disruption record, exercise result, position lots, and collateral locks.

For a normal finalized fixing:

1. Hash all supplied dynamic data and match the stored commitments.
2. Staticcall the exact qualified payoff-module version with its fixed gas limit.
3. Enforce the long and short aggregate debit bounds independently.
4. If the position lapsed, replace the transfer with zero.
5. Debit the payer lock and credit the receiver in the exact settlement binding.
6. Charge only fees authorized by the position's exact fee-schedule version. Charges round up and
   funded rebates round down.
7. Release every unconsumed liability and fee reservation to its original account.
8. Store the terminal outcome and emit enough data to replay terms, fixing, arithmetic, fees, and
   collateral deltas.

Settlement is permissionless and idempotent. Repeating a settled position returns or reverts with the
same terminal record and can never move value twice. Batch ordering cannot change any individual
payout. A keeper reward is an explicit bounded fee funded before execution and is never deducted from
the receiver's payoff unless the signed series policy says so.

No settlement path mints internal credit, changes a position's settlement binding, uses the active
version in place of the stored version, or depends on an indexer or first-party service being online.

## 15. Lifecycle and terminal states

The position lifecycle is:

```text
Live -> ExerciseWindow or FixingPending -> FixingProposed -> FixingFinal -> SettlementReady -> terminal
```

Valid side paths are:

- `Live -> Unwound` when an atomic close consumes the full position;
- `Live -> Novated` when an authorized replacement position is created atomically;
- any fixing state before final resolution to `Disputed` on objective conflicting evidence;
- `FixingPending`, `FixingProposed`, or `Disputed` to disruption finalization at
  `finalResolutionAt`.

Partial split, merge, transfer, amendment, compression, and roll create or modify position records but
do not invent terminal economics. Amendment is cancel-and-replace or novation and must preserve an
auditable link to both versions. A roll is an atomic close-and-open package. The old position keeps
its original series version.

Terminal outcome tags are:

- `FinalizedComplete`, for an ordinary complete fixing and settlement;
- `FinalizedBounded`, when the payoff reached a declared debit cap;
- `Lapsed`, for an unexercised holder-election position;
- `NoEffect`, for an exercised or automatic position whose terminal transfer is zero;
- `Unwound`, for a full early close;
- `Novated`, for a consumed position with an atomic replacement;
- `RecoveredComplete`, when a fallback candidate produced the ordinary interior payoff;
- `RecoveredBounded`, when a fallback candidate or precommitted value reached a cap;
- `RecoveredFlat`, when the final disruption outcome was zero.

Every terminal state is immutable. `Pending`, `Disputed`, `SettlementReady`, `submission unknown`,
and `manual intervention` are operational states, not terminal outcomes. The finite
`finalResolutionAt` and permissionless finalization path ensure every admitted series has a terminal
route even if all external operators disappear.

## 16. Registration, qualification, and activation

Registration proves shape and immutable dependency existence, then lands every version in `Paused`.
It never grants new-risk authority. Separate roles register and activate each object.

Activation revalidates current dependencies and exact compatibility:

### Market activation

- both canonical assets are Active;
- settlement binding, mark benchmark, trading calendar and session, risk domain, and fee schedule are
  open for new risk;
- the mark and schedule dependencies cover the current day. Each series separately proves its full
  future horizon;
- all asset, settlement, risk, and fee relationships still match exactly.

### Instrument activation

- the payoff adapter version is the active pointer, open for new risk, still has the qualified code
  hash, exact payoff kind, interface hash, and capability hash;
- the implementation is eligible under the non-upgradeable pure-module rule.

### Series activation

- its exact market and instrument versions are active, not merely the latest versions;
- every fixing candidate exists, is semantically compatible, and covers its committed window;
- the payoff module revalidates terms, fixing slots, and both maximum debit bounds;
- all calendar and session proofs and frozen dates are valid;
- both aggregate liability bounds fit the exact risk-domain caps at `maxOrderLots`;
- the declared disruption outcome guarantees a finite terminal path.

### Package activation

- every exact series version is open for new risk;
- every leg uses the same exact settlement binding;
- ratios, quote rules, and derived maximum debit bounds still validate;
- the package maximum fill cannot exceed any affected account or risk-domain cap.

At most one version per lineage is Active. Activation never silently pauses another version. Pausing
or deprecating the active version clears its active pointer. `Deprecated` is terminal for registry
status.

An execution consumer must gate the exact signed version through `isOpenForNewRisk`. It must never
replace a signed version with `activeVersion()` or `latestVersion()`. Pausing a market, instrument,
series, package, or dependency invalidates unfilled new-risk orders and releases their reservations,
but does not change a filled position.

## 17. Historical resolvability

Every registry exposes the same split used by the existing registries:

- `isOpenForNewRisk(id, version, day)` is strict, dependency-aware, and requires the active pointer;
- `isLifecycleEnabled(id, version)` is true for every registered historical version, including
  Paused and Deprecated versions;
- `get...` returns the exact immutable record and reverts for an unknown version;
- boolean monitoring views return false and pointer views return 0 for unknown records.

Definitions, dynamic term blobs, fixing-slot encodings, package legs, hashes, statuses, and active
pointer changes are emitted as enumeration and data-availability events. Registries use no unbounded
onchain arrays.

Every position and receipt stores or commits the exact market, instrument, series, package if any,
benchmark, adapter, calendar, session, risk-domain, fee-schedule, and settlement-asset versions used
at creation. Fixing, exercise, settlement, withdrawal, recovery, receipt replay, and audit resolve
those versions without requiring current Active status.

A payoff-module code-hash failure cannot erase a definition or authorize a replacement module. It
uses the predeclared `RecoveredFlat` path in section 13. A later implementation version applies only
to new series versions and new risk.

## 18. Required events and receipts

Each registry emits `Registered`, `StatusChanged`, and `ActiveVersionChanged` events following the
existing registry pattern. Registered events include typed ID, version, version hash, definition
hash, full static definition, dynamic child data or its retrievable event payload, chain ID,
initial `Paused` status, and operator.

A fixing and settlement receipt commits at least:

- position, account, side, lots, and package provenance;
- every exact economic and dependency version hash;
- fill price, fill cash movement, fees, and original maximum-loss disclosures;
- fixing candidate, evidence hash, observation values and scales, selection rule, revision, session
  proof commitments, and whether fallback was used;
- payoff input hash, module code hash, signed raw result after rounding, cap application, and terminal
  transfer;
- collateral locks consumed and released;
- exercise or lapse evidence;
- disruption path and terminal outcome;
- transaction hash and emitted record hash.

Observed, executable, estimated, and modeled numbers remain distinct. Market marks, quote books,
routes, and charts in the first-party platform must use one coherent versioned feed snapshot, but a
mark snapshot never becomes settlement evidence merely because the UI displayed it.

## 19. Extensibility proof

1. Stable typed IDs separate lineage from immutable versions. New assets, benchmarks, dates, terms,
   modules, or risk policy revisions add versions rather than editing history.
2. Payoff, quote, settlement, exercise, selection, and disruption categories are open tags. Consumers
   require exact interfaces and capabilities and fail closed on unsupported combinations.
3. New payoff implementations enter through the existing chain-local adapter qualification path.
   They receive no custody authority and execute only by bounded `staticcall`.
4. Market, series, and package activation is separate from registration and transitively checks exact
   settlement, benchmark, calendar, session, module, risk, and fee dependencies.
5. Packages compose exact series versions with canonical signed ratios. They do not create a hidden
   offchain payoff or change leg settlement.
6. Old versions, terms, fixings, and legs remain resolvable from registry records and events for
   lifecycle, settlement, recovery, receipts, and replay.
7. A new module cannot bypass custody, collateral caps, maximum payoff bounds, fixing selection,
   session evidence, exercise authorization, fee limits, or terminal-state rules.
8. No market universe, symbol, vendor, token address, or asset-class branch is hardcoded into core
   economics.

## 20. Phase 0 acceptance consequences

Implementations derived from this specification must not proceed by inventing local alternatives for
quote units, payoff signs, package ratios, fixing choice, rounding, maximum loss, or terminal states.
The following are fixed:

- executable prices are signed settlement-minor-unit cash prices per lot;
- payoff transfer sign is always short to long;
- every series stores independently validated long and short terminal debit bounds;
- every package ratio and maximum liability has one canonical encoding;
- historical fixings use contractual windows and completeness proof, not caller-selected samples;
- every disruption reaches a precommitted finite outcome;
- every collateral, margin, fee, payoff, and release rounding direction is explicit;
- registration, qualification, activation, and historical lifecycle availability are different gates;
- public developer products remain outside this phase.
