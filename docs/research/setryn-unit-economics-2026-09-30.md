# Setryn unit economics and revenue status (2026-09-30)

This note separates the revenue Setryn collects onchain today from revenue that is only planned, and models
contribution margin at three volume levels. Every cost figure below is an assumption to be replaced with measured
numbers once Arbitrum One traffic exists.

## 1. What is implemented

| Stream | Status | How it works |
| --- | --- | --- |
| Taker execution fee | Implemented, onchain | 10 bps of the fill's consideration, charged by `FundedFeeEngine` during clearing and moved into the protocol fee account |
| Maker execution fee | Implemented, onchain | 5 bps of consideration, same path |
| Settlement, lapse, terminal resolution | Free by design | Normal settlement, holder-election lapse and the permissionless terminal fallback carry no fee actions, so a fee can never block an exit |

Details:

- **Fee base.** Consideration = lots × price ticks × tick size. On BTC-YC-24DEC26 at 613.4 bp one lot is
  1,533.50 USDC of consideration, so the taker pays about 1.53 USDC per lot. Fees are charged on consideration, not on
  the position's exposure or collateral (1,950 USDC per lot on that market).
- **Collateral-backed.** Each order signs a `maxFeeMinor` cap and the fee is funded from the account's collateral at
  clearing, so the protocol never extends credit for fees.
- **Updatable.** Rates live in versioned `FeeScheduleRegistry` entries, and each market version pins the exact fee
  version it trades under (historical objects never change economics). A fee change registers a new fee version, then a
  new market version and series version that pin it, and activates them while pausing the old ones. Open positions keep
  the terms they were opened under and still fix and settle on their original series version. On Arbitrum One this is a
  governance-timelock action through `RegistryStatusController`; on the local network the operator runs it from the
  Treasury page or the update script. Orders, quotes, the API, the maker and the solver read the active versions and
  rates from chain, so a fee change needs no code change or redeploy.
- **Recipient.** Fees accrue to a dedicated vault account controlled by a separately configured treasury controller
  (a Treasury Safe in production, required at deployment). Withdrawals go through `CollateralVault.withdraw` by that
  controller only.
- **Every execution channel pays.** Public book, private RFQ, streaming quotes, sealed auctions, batches and solver
  routes all clear through the same atomic clearing path, which charges the maker and taker fee actions on every fill.
  The public-book path has an end-to-end fee test; the other channels share that code path.

Repricing caveat: after a fee change, positions opened under the old market version can no longer be closed early by
trading, because trading requires the active version. They still settle at expiry, lapse, resolve through the terminal
fallback, or exit through lifecycle actions. Reprice at a quiet point in the calendar and announce it in advance.

## 2. What is planned, not implemented

These appear in the product plan (feature map, section Q) but collect nothing onchain today:

- Volume tiers and maker rebates.
- Lifecycle fees for amendment, unwind, roll or off-platform clearing (the fee engine supports explicitly authorized
  lifecycle fee actions; no schedule charges them yet).
- Clearing fee for third-party interfaces, and builder or strategy-publisher fees.
- Partner revenue share. Partner deployments carry a `revShareBps` (default 20% of attributed fees), but the payout is
  **modeled only**: no onchain payout or claim exists.
- Professional maker API and terminal subscriptions, privacy services, market-data licensing, enterprise support,
  collateral-yield share, market sponsorship.

## 3. Revenue at the current schedule

Every matched fill has one maker and one taker, so the combined take on matched consideration volume is the sum of
both rates.

| Schedule (maker / taker) | Combined take | $10M volume | $100M volume | $1B volume |
| --- | --- | --- | --- | --- |
| **Current: 5 / 10 bps** | 15 bps | $15,000 | $150,000 | $1,500,000 |
| Launch alternative: 0 / 10 bps | 10 bps | $10,000 | $100,000 | $1,000,000 |
| Launch alternative: 0 / 12 bps | 12 bps | $12,000 | $120,000 | $1,200,000 |
| Maker rebate: −1 / 10 bps | 9 bps | $9,000 | $90,000 | $900,000 |

"Volume" here means matched consideration. Exposure notional is several times larger. Treat any comparison with a perp
venue's notional volume accordingly.

A zero-fee maker tier with a 10 to 12 bps taker fee is the stronger launch posture for attracting quotes. Rebates below
zero should wait until they can be funded from realized revenue, per the plan's own rule. With versioned schedules this
is a governance decision, not an engineering task.

## 4. Contribution margin (assumptions)

Assumptions, per month:

| Input | Assumption | Basis |
| --- | --- | --- |
| Average fill consideration | $5,000 | Mid-size hedge; replace with measured data |
| Positions settled per fill | 2 (maker and taker side) | One position per side |
| Keeper cost per settled position | $0.05 | About 600k gas at 0.02 gwei plus L1 data, at $3,500 per ETH |
| Oracle cost | $1,000 fixed | Pull-oracle updates and a fixing feed subscription |
| RPC and indexing | $500 at $10M, $1,000 at $100M, $2,000 at $1B | Managed provider tiers |
| Partner-routed share of volume | 30% | Distribution through embedded partners |
| Partner revenue share | 20% of attributed fees | Default `revShareBps` (modeled today) |

Result at the current 5 / 10 bps schedule:

| Monthly volume | Gross fees | Partner share | Keeper | Oracle + RPC | Net contribution | Margin |
| --- | --- | --- | --- | --- | --- | --- |
| $10M | $15,000 | $900 | $200 | $1,500 | $12,400 | 83% |
| $100M | $150,000 | $9,000 | $2,000 | $2,000 | $137,000 | 91% |
| $1B | $1,500,000 | $90,000 | $20,000 | $3,000 | $1,387,000 | 92% |

Not included: team, audits, legal, insurance or default-fund capital, market-maker incentives, and gas sponsorship.
Those are fixed or strategic costs and belong in the operating budget, not in contribution margin.

## 5. Sensitivities

- **Fill size.** Keeper cost scales with the number of positions, not volume. At a $500 average fill, keeper cost at
  $10M rises to $2,000 and margin falls to about 71%.
- **Maker fee.** Moving to 0 / 10 bps cuts gross revenue by a third. It is justified only if the extra quoting it
  attracts raises taker volume by more than 50%.
- **Partner mix.** Each additional 10% of partner-routed volume at a 20% share costs 2% of gross revenue.

## 6. Next steps to make revenue real

1. Measure actual gas per settlement and fixing on Arbitrum Sepolia, and replace the keeper assumption.
2. Decide the launch schedule (current 5 / 10 or a zero-maker tier) and activate it as a fee-schedule version.
3. Build an onchain partner payout or claim before presenting partner revenue share as anything other than modeled.
4. Define lifecycle fee actions only where a user explicitly authorizes them, and keep settlement and terminal
   resolution free.
