# Hedged-book financing: controlled term credit for carry traders

Status: comparison candidate, not selected. High incumbent overlap and a simpler native GMX collateral route prevent treating the separate-spot version as the preferred product.

Research snapshot: September 15, 2026. This is a proposed product, not a deployed protocol, customer commitment or implementation authorization.

## Product and buyer

A credit protocol that finances a trader's spot inventory and matched perpetual hedge inside one restricted account, to an agreed maturity. The trader owns the residual equity and strategy outcome; lenders own repayment claims, not an advertised risk-free carry yield.

The initial customer hypothesis is professional ETH carry traders and small crypto-native trading firms already using Arbitrum. The initial book is WETH spot plus a matched GMX ETH short, financed in native USDC. Do not add Pendle positions, nested Aave loans, other exchanges or synthetic stablecoin issuance to make the first product appear larger.

Important native baseline: [GMX's own documentation](https://docs.gmx.io/docs/trading/fees/#perps) describes an index-token-collateralized short as a way to obtain delta-neutral funding exposure. A trader need not universally hold separate spot inventory and additional USDC margin. The separate-spot layout below is one proposed book type, not an established customer necessity or the selected architecture. Any financing advantage must beat the native route as well as external lenders.

The purchased offer is a binding term-financing quote with specified permitted positions, required equity, local margin, cash reserves, recovery obligations and fees. Financing price and capacity must reflect realizable recovery, not simply a low displayed net delta.

This is not a passive strategy vault, universal margin wallet or autonomous trading bot. The proposed business originates and services debt against a controlled trading book throughout its lifecycle.

## Complete customer lifecycle

1. A manager requests a quote for notional, term and permitted actions. The quote separates lender interest, retained protocol fees, GMX costs and any compensation for committed recovery capital.
2. The trader contributes first-loss equity. Lenders allocate actual USDC against the approved mandate. Financing and formation costs have defined ownership before either leg is opened.
3. The controlled account buys spot and submits its GMX short. It enters a formation state until execution confirms. Failed or partial formation follows an unwind policy; the unconfirmed hedge is not credited as completed collateral protection.
4. The manager can exercise bounded operational authority, such as approved hedge adjustments. It cannot remove a leg, redirect order cancellation proceeds or withdraw required reserve cash.
5. Servicing accounts for debt, accrued interest, cash, confirmed positions, pending orders, fees and realized losses. Risk actions require submitted transactions and execution agents; smart contracts do not monitor or act by themselves.
6. An approved early repayment or refinance closes the old obligation under disclosed terms. Healthy lenders cannot recall a genuinely committed fixed-term loan merely because market rates change. Default and mandated risk reduction remain possible.
7. At maturity, the account submits unwind orders, receives settlement assets, repays actual USDC debt and fees, then releases any surplus to the trader. Positive unreceived PnL is not repayment.
8. On breach, ordinary trader permissions stop. Independent recovery agents execute the agreed liquidation or takeover route without a fresh borrower signature. Failed orders, absent bidders, partial repayment and residual lender losses have explicit states rather than being hidden behind an insurance label.

## Capital and loss ownership

Three capital roles must remain separate:

- Trader equity absorbs the book's first losses.
- Lender USDC funds the loan and receives the agreed financing return.
- A recovery-capital provider, if included, commits separately priced and bounded USDC capacity to acquire or stabilize an eligible distressed account. Its existence and pricing are not assumed.

Remaining losses after realizable assets and any contracted recovery capacity reach lenders under disclosed terms. A trading hedge is not lender principal insurance. Term capital cannot simultaneously promise unconditional instant lender withdrawals.

An account-level auction could let a buyer pay USDC and acquire control while the account address and its positions remain intact. This is a proposed enforcement mechanism, not a verified deployed integration or proof that positions are freely transferable. The buyer would warehouse subsequent execution and settlement risk. No bidder means no immediate recovery cash.

## Separate-spot risk is not shared venue margin

| Event | Why a matched hedge is insufficient | Required treatment |
| --- | --- | --- |
| ETH rises | Spot appreciation does not automatically supply the USDC needed by the short's local margin | Conservatively size cash reserves and permitted liquidation/rebalancing actions |
| ETH falls | Positive short PnL may be pending, capped or unavailable while spot collateral loses value | Underwrite recoverable proceeds and delay, not instantaneous marked net wealth |
| GMX order freezes or cancels | One leg can remain exposed and cancellation outputs can create an escape route | Account-controlled receivers, reconciled order states and bounded failure recovery |
| Maturity or default | Closing a GMX position requires asynchronous execution | Actual settlement, a funded takeover buyer or a specifically contracted backstop |

GMX documents output/cancellation receivers and callbacks in its [ExchangeRouter integration](https://docs.gmx.io/docs/api/contracts/exchange-router/). These are useful control surfaces, not atomic close guarantees. Its [known issues](https://docs.gmx.io/docs/api/contracts/known-issues/) and [local liquidation rules](https://docs.gmx.io/docs/trading/liquidations/) remain binding. Ordinary GMX borrowing charges, funding reversals, price impact and execution costs also remain trading risks.

Loan sizing must include conservative stress proceeds, local margin requirements, oracle/basis discrepancies, keeper delay, price impact and liquidity. A portfolio offset cannot be counted if the supposed offset cannot be realized in the required asset and time window.

## Actual carry economics to compare

For the separate-spot/USDC-margin variant, matched notional `N`, loan `L`, equity `E`, posted GMX collateral `M` and cash reserve `R` require approximately `E + L = N + M + R + entry_costs`. This is not the same capital equation as an index-token-collateralized neutral short; do not count the same ETH both as separate inventory and already-posted collateral.

The official [ETH-USDC production rate query](https://arbitrum.gmxapi.io/v1/rates?period=30d&averageBy=1d&address=0x70d95587d40A2caf56bd97485aB3Eec10Bee6336), read independently at September 15, 14:27:18 UTC, returned 31 daily buckets from August 16 through September 15. Short funding was negative in 11 buckets, short net funding less borrowing was negative in 12, and borrowing was nonzero in 24. These are indexed rate averages, including the current partial bucket, not realized portfolio returns. No APR is inferred from unverified raw-unit conversions.

[Published GMX position fees](https://docs.gmx.io/docs/trading/fees/) are 4 or 6 bps per operation for standard markets. An opening and close alone therefore cost 8-12 bps of notional, approximately 0.97-1.46% simple annualized drag for a 30-day hold, before other costs. Default slippage is a tolerance, not a fee; the separate atomic-swap fee is not automatically a required spot-acquisition cost.

A consistent proposed comparison is:

```text
Annualized cost per matched notional
= (L/N) * (lender_APR + servicing_APR + origination_fraction * 365/T)
  + average_short_borrowing_APR
  + average_signed_short_funding_cost_APR
  + (round_trip_cost_fraction + incremental_reserve_backstop_fraction) * 365/T
```

`T` is the hold in days. Funding cost is negative when received. Round-trip costs include actual spot routing, position fees, net impact, gas and recovery execution. Do not charge financed reserve interest again inside the incremental reserve/backstop term. Unstaked WETH has no native staking yield. A fixed loan coupon does not fix GMX funding, borrowing or total book returns.

## Revenue hypothesis

Borrowers pay a disclosed origination fee and/or annual servicing fee. Lender interest and recovery-capital premiums are not retained protocol revenue. Do not stack multiple fees without showing the buyer's all-in cost.

For fixed principal, proposed gross fee revenue is `principal * origination_fee + principal * annual_servicing_fee * days / 365`. For changing debt, servicing uses time-weighted outstanding principal. These are business-accounting relationships, not chosen contract implementation details.

An illustrative 50 bps annual retained servicing fee yields $100,000 gross annually at $20 million average outstanding debt, or $500,000 at $100 million. Those amounts are not forecasts or accepted prices. Monitoring, execution, legal work, underwriting, audits and any recovery-capital expense still need to be paid. A 25 bps origination charge on a 90-day loan adds approximately 101 bps annualized to the borrower's cost before servicing or lender interest; frequent renewal can erase the purported advantage.

The business only improves the existing workflow if better financing capacity or price exceeds these additional costs and the cost of required reserves.

## Closest competition and unresolved difference

[August](https://docs.augustdigital.io/protocol-overview) already advertises financed delta-neutral mandates, GMX adapters, customer subaccounts and correlation-aware underwriting. Its [loan terms](https://docs.augustdigital.io/legal/legal-notices/loan-product-terms) include genuine fixed terms and default enforcement. An exact competing ETH/GMX quote is unverified, not established as absent. These basic capabilities cannot be presented as our invention.

[Gearbox](https://dev.gearbox.finance/core/debt-collateral) already supplies financed controlled accounts and portfolio collateral accounting. Its [2024 Arbitrum proposal](https://forum.arbitrum.foundation/t/gearbox-ltipp-application-final/21672) explicitly contemplated GMX basis trading; a dated roadmap is not evidence of current production availability. [Dolomite's GM integration](https://docs.dolomite.io/integrations/gmx/gm) addresses GMX LP tokens and asynchronous execution, not proof of financing trader perpetual positions.

Gearbox's [current curator documentation](https://docs.gearbox.finance/core/gearbox-permissionless-for-curators) also expressly includes basis-trading credit products. The unverified current GMX-specific deployment is not permission to describe basis lending itself as new.

The proposed difference must therefore be demonstrated in concrete GMX-aware underwriting, executable quotes, capital efficiency or recovery execution. Publishing more modules, calling the account cross-margin or adding privacy would not independently establish it.

## Interface and chain decision

Professional web application plus quote and account APIs. The critical surfaces are debt terms, account authority, formation status, reserves, live risk, permitted actions, maturity and recovery. No Android-first customer workflow was established.

The complete first lifecycle must settle and enforce on Arbitrum One using real USDC and the selected spot/perp integrations. No second chain, cross-chain guarantee collateral or new token is assumed. Network logos do not improve underwriting.

## Comparison decision

Retain this as a complete alternative to compare with Blindbook and prepaid borrowing-rate protection, not as the flagship. Its advantage over August is presently unknown, and the separate-spot layout cannot be justified by inventing fragmentation that native GMX collateral may avoid. The next research comparison should use identical position, term, local margin and recovery assumptions, including the native collateral route, then show total financing cost and usable capital under adverse execution paths.

Research can reach a recommendation before paid customer validation. Here, however, published incumbent overlap still prevents an evidence-backed superiority claim. Demand, supplied capital and pricing remain launch assumptions rather than invented prerequisites for completing the research itself.
