# Firm quotes: offchain quoting, permissionless onchain settlement

Setryn's designated maker no longer keeps resting orders on the public book. It streams **firm quotes**: EIP-712 signed
orders backed by collateral it locked onchain once. Prices move with no transaction. When a trader accepts a quote, one
transaction to `QuoteSettlementRouter.settle` settles both sides atomically, and anyone can send it: the trader, any
bot, any relayer, or Setryn's optional relayer. Users' own limit orders still rest on `PublicOrderBook` exactly as
before.

## Why

Every order needs a bound risk admission, and an admission may be dated at most `maximumObservationAge` (300 s, immutable
in `PortfolioRiskEngine`) ahead. A resting maker order therefore died about five minutes after its admission, and keeping
fifteen markets two-sided meant sign, reserve, bind, register and place again for every side every few minutes. The
fix is to create the admission when a quote is taken instead of when it is shown: the router reserves it, binds it and
the clearing engine consumes it in one transaction, so the 300 s bound no longer limits quoting.

## Flow

1. **Capacity (occasional).** The maker signs `SetrynQuoteCapacityV1` terms for one series; anyone submits them to
   `openQuoteCapacity`. The stream capacity manager locks `maximumLiability` of the maker's collateral until the
   capacity's expiry. The app opens the current three-day epoch's capacity the first time a series is viewed; each lasts
   two epochs, so lifetimes overlap.
2. **Quotes (continuous, offchain).** Every tick the quote engine (`apps/web/src/lib/quotes/quote-engine.ts`) prices
   every market from one Chainlink read and signs, per side, a `PublicOrder` (GTD, 20 s deadline, random 128-bit nonce)
   and a `SetrynOrderRiskAuthorizationV1` naming the router as binder and `hash(SetrynMakerQuoteTermsV1{capacityId})` as
   binder terms. Signatures are verified before a quote is published. Quotes stream over `GET /api/quotes/stream`
   (server-sent events); `GET /api/quotes` is the snapshot.
3. **Acceptance.** The trader signs typed data only: an opposite fill-or-kill `PublicOrder` at the quote's price and its
   own risk authorization, whose binder terms commit to `SetrynTakerSettlementTermsV1{quoteOrderHash, relayer,
   relayerAccountId, maxRelayerFeeMinor}`. The terminal names no relayer and offers no fee, so the same signatures
   settle through any submitter.
4. **Settlement (one transaction, any sender).** `settle` checks compatibility (series, version, opposite sides, the
   taker's limit against the quote price, no self-trade, the capacity belongs to the maker and series), draws and
   finalizes the maker's capacity, reserves both risk admissions sized exactly to the fill, binds both through
   `RiskAdmissionBindingRegistry.bindOrderRiskWithAuthorization`, registers both orders (`OrderState` verifies both
   order signatures and consumes both nonces), clears through `AtomicClearingEngine.clearSeries`, pays any relayer fee
   the taker signed for, and emits `QuoteSettled` with the full receipt. Any failure reverts everything.

A quote settles once: the first settlement registers its order and consumes an admission sized to that fill. Re-quoting
is free.

## What the chain enforces

| Check | Where |
| --- | --- |
| Maker and taker order signatures, order nonces (single use), order deadlines | `OrderState.registerSignedOrder` |
| Risk authorization signatures, authorization nonces, deadlines, exact order hash, account, risk domain, open-interest, liability and admission-deadline bounds, binder | `RiskAdmissionBindingRegistry.bindOrderRiskWithAuthorization` |
| Margin, open-interest and liability caps for both accounts | `PortfolioRiskEngine.reserveNewRisk` (unchanged checks) |
| Maker capacity: owner, series, remaining liability, inventory bound, expiry, sequential consumption | `VaultBackedStreamCapacityManager` via the router |
| Price crossing, fill size, fees within each order's cap, positions, collateral locks | `AtomicClearingEngine` and its gates |
| Quote replay, relayer restriction, relayer fee bound | `QuoteSettlementRouter` |

Postgres is not involved in any of it. The quote engine's cache is disposable: a restarted server derives the same
capacity ids from the same terms and signs fresh quotes.

## Contract graph (V2)

`RiskAdmissionBindingRegistry` gains the signature path, and everything that holds it (or what holds that) immutably is
a new instance. Unchanged sources are redeployed only because their immutable references change.

| Contract | Change | Why |
| --- | --- | --- |
| `RiskAdmissionBindingRegistry` | new source | signature-authorized binding |
| `QuoteSettlementRouter` | new | permissionless settlement |
| `OrderValidationGate`, `ClearingAdmissionGate` | redeployed | immutable `riskBindings` |
| `OrderState` | redeployed | immutable validation gate |
| `AtomicClearingEngine` | redeployed | immutable `OrderState` and admission gate |
| `PublicBookEligibilityGate`, `PublicOrderBook` | redeployed | immutable `OrderState` and clearing engine |
| `StreamingQuoteEngine`, `BatchClearingEngine` | redeployed | immutable clearing engine |
| `ProtocolRouteLiquiditySource`, `CollateralAwareRouteEngine` | redeployed | immutable book and stream engine |
| Order, book, fill, stream and route receipt authorities | redeployed | immutable sources |
| Collateral vault, position engine, fee engine, risk engine, registries, markets, series, capacity manager and registry, RFQ book, auction house, lifecycle | reused | role grants only |

Contract-level roles the router holds (no externally owned account needs any of them per trade):
`STREAM_ENGINE_ROLE` on the stream capacity manager, `MATCH_EXECUTOR_ROLE` on the clearing engine, `RISK_CONSUMER_ROLE`
on the risk engine, and `COLLATERAL_LOCKER_ROLE` and `COLLATERAL_SETTLER_ROLE` on the vault (relayer fees only). The
router has no admin.

`DeploySetryn` deploys the whole V2 graph with these roles; `scripts/generate-deployment-evidence.mjs` verifies them.

## Keys and nonce lanes

| Role | Key | Sends |
| --- | --- | --- |
| Maker | `SETRYN_MAKER_PRIVATE_KEY` | quote signatures (no transactions); capacity opening once per series per epoch |
| Relayer (optional) | `SETRYN_RELAYER_PRIVATE_KEY` | users' signed settlements; no fee |
| Operator | `SETRYN_OPERATOR_PRIVATE_KEY` | public-book risk admission, faucet, keeper calls |

Each key is its own account with its own send queue and nonce manager, so no role's transaction can take another's
nonce. Order nonces of quotes are random 128-bit values, so parallel servers never collide.

## Accounts

A trader approves the clearing engine and the position engine as lock operators once (the ticket does it the first time,
as before). A relayer fee additionally needs the router approved; the terminal's settlements carry no fee and need
nothing more. The maker account is created, funded with test collateral where the token is mintable, and approved the
first time capacity opens.

## Operations

- **Idle markets spend nothing.** No quote ever touches the chain unless a trader takes it; a series nobody views never
  opens capacity.
- **Quote lifetime.** 20 s, re-signed with 12 s left; the terminal offers a quote only with at least 6 s left and drops it
  at expiry, so a reconnect never shows an expired quote as executable.
- **Firm or not.** A market without live capacity, without a fresh reference, with an inactive fee schedule, or whose
  maker collateral is committed is published as `INDICATIVE` or `UNAVAILABLE` with the reason, never with a quote.
- **Gas.** One settlement is about 9.7M gas on the production graph, of which the clearing engine's `clearSeries` is
  about 6.5M (the same path a public-book match takes).
- **Revoking.** The maker stops quoting by closing a capacity (`closeQuoteCapacity`), which fails every quote drawing
  on it, or by retiring an authorization nonce (`invalidateAuthorizationNonce`).
