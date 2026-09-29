# Arbitrum Product Decision: FeeRate

Date: 2026-09-19
Decision: Do not build
Status: Superseded on 2026-09-19 after discovering Saffron, ScopeLift Fixed Fee Swap, and Flashstake overlap
Supersedes: `arbitrum-private-perps-and-package-execution-decision-2026-09-18.md`

> This decision is no longer valid. Saffron won $60K at Arbitrum Founder House London for a fixed-yield market built on Uniswap concentrated-liquidity positions, which is an effective product collision. The current decision is documented in `setryn-product-decision-2026-09-19.md`.

## Executive decision

Build **FeeRate**, the exchange for AMM fee cashflows.

FeeRate lets a concentrated-liquidity provider escrow an LP position, retain the principal and inventory exposure, and sell the fees that position will earn during a fixed epoch. The buyer receives a pure claim on real swap fees without supplying token inventory or taking the LP position's impermanent loss. Standardized fee claims from the same pool, range, and epoch are fungible and tradable.

The first product is a physically backed seven-day `WETH-USDC Fee Strip` on Uniswap v3 on Arbitrum One. That is the evidence path, not the company boundary. The protocol expands into:

- fee strips for additional pools, ranges, DEXs, and maturities;
- primary batch auctions and secondary trading for fee claims;
- an implied fee-rate curve for each pool;
- fixed-for-floating AMM fee swaps;
- fee-rate futures and perpetual markets;
- fee indices that let LPs hedge fee compression and traders express a view on DEX activity;
- integrations that let LP managers, vaults, wallets, and treasuries lock or trade fee income.

This is not an LP manager, yield aggregator, router, dashboard, or generic PT/YT wrapper. It creates a missing financial object: a transferable claim on future AMM fees, separated from the capital and inventory risk that generated those fees.

## 1. Similar projects and evidence

Most hackathon projects do not become successful startups. The submissions below are evidence of mechanisms, user interest, and judge taste, not proof of a durable company. Some may now be inactive or may have pivoted, so current status must be verified before treating any as a live competitor.

- **Pye**, slug `pye`, won 3rd Place in DeFi at Solana Radar in September 2024. It tokenizes and forward-sells proof-of-stake yield so operators receive cash today and buyers purchase future yield at a discount. It validates the user-facing pattern of separating principal from a future cashflow. FeeRate applies that pattern to path-dependent AMM fees rather than copying staking yield. [Pye submission](https://colosseum.com/projects/explore/pye), [Pye documentation](https://docs.pye.fi/)
- **H2O Finance**, slug `h2o-finance`, received a DeFi Honorable Mention at Solana Breakout in April 2025. It splits validator yield into issuance and MEV components so users can trade only the return they want. It validates that decomposing a bundled yield into economically distinct components can itself be a product. [H2O Finance submission](https://colosseum.com/projects/explore/h2o-finance)
- **Kormos**, slug `kormos`, won 2nd Place in DeFi at Solana Cypherpunk in September 2025 and entered Colosseum's accelerator. It creates liquid and locked depositor classes to price the liquidity-yield tradeoff. It validates explicit risk allocation rather than another opaque yield vault. [Kormos submission](https://colosseum.com/projects/explore/kormos)
- **Exponent**, slug `exponent`, won 5th Place in DeFi and Payments at Solana Renaissance in March 2024. It lets users fix, hedge, or trade DeFi yields. Its closest Arbitrum analogue is Pendle, so building generic yield stripping on Arbitrum would not be novel. [Exponent submission](https://colosseum.com/projects/explore/exponent)
- **Watt Protocol**, slug `watt-protocol`, won 5th Place in DeFi at Solana Radar in September 2024 and later appeared in the accelerator portfolio. It packages volatility-linked market arbitrage into user yield. It supports the thesis that users will buy financial exposure to a market mechanism, but it does not isolate AMM fees from LP inventory. [Watt Protocol submission](https://colosseum.com/projects/explore/watt-protocol)
- **attn.markets**, slug `attn.markets`, won 1st Place in its Cypherpunk track in September 2025. It tokenizes app and creator revenue for advances and yield products. It validates contract-enforced future cashflows, but is closer to revenue financing and founder capital formation, which the product brief rejects. [attn.markets submission](https://colosseum.com/projects/explore/attn.markets)
- **Fungible**, slug `fungible`, lets token communities grant holders perpetual trading-fee yield. It touches fee ownership but does not create dated, LP-specific fee claims or a fee-rate market. [Fungible submission](https://colosseum.com/projects/explore/fungible)

The Colosseum corpus search found no direct project whose product is physically backed, dated fee stripping for concentrated-liquidity positions. The accelerator search surfaced LP management, generic yield, and structured products, but no exact overlap. Based on the available corpus, this is a real gap rather than a renamed submission.

## 2. Archive insights

- Alliance's interest-duration taxonomy frames a financial yield by both its rate and its term. AMM fees currently have a floating realized rate but no native term market. FeeRate adds the missing duration and forward-price layer. [Alliance, Lending Protocol Taxonomy](https://alliance.xyz/essays/lending-protocol-taxonomy-part-1-interest-duration)
- Paradigm's `Everything Is A Perp` explains that a constant-product AMM position is economically related to volatility exposure. That means the fee stream is not arbitrary rewards. It is the compensation side of a measurable market-making risk. [Paradigm, Everything Is A Perp](https://www.paradigm.xyz/2024/03/everything-is-a-perp)
- Uniswap distributes swap fees only to active in-range liquidity. The cashflow is therefore pool-specific, range-specific, and path-dependent. A generic pool APR or generic yield token does not isolate the actual fee claim. [Uniswap LP fee mechanics](https://support.uniswap.org/hc/en-us/articles/20901935681677-What-is-a-liquidity-provider-LP-fee)
- Uniswap v4 exposes lifetime and uncollected fee accounting through `feeGrowthInside`, giving a deterministic basis for settlement. The first mainnet version should still use v3 because its ERC-721 custody and collection path is simpler. [Uniswap fee calculation](https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/calculate-fees)
- Bichuch and Feinstein's September 2025 paper independently proposes fixed-for-floating swaps on AMM fees and connects their price to implied volatility and correlation. The research prior proves that the object has rigorous financial meaning. It does not identify a live production market. [The Price of Liquidity](https://arxiv.org/abs/2509.23222)

## 3. Current landscape

### Generic yield trading

Pendle is live on Arbitrum and already splits supported yield-bearing assets into PT and YT. A generic `Pendle for LP yield` pitch is dead on arrival. FeeRate survives because a Uniswap v3 position is a range-specific NFT, fees arrive in two assets, and earnings depend on whether the position is active. The protocol standardizes and settles that exact cashflow rather than wrapping an ordinary ERC-4626 vault. [Pendle deployments](https://docs.pendle.finance/pendle-v2-dev/Deployments)

### Funding-rate markets

Boros is already deployed on Arbitrum and provides a serious market for funding rates. Funding-rate futures or another cash-and-carry terminal would collide with it. FeeRate trades AMM fee income, not perp funding. [Boros FAQ](https://docs.pendle.finance/boros-dev/FAQ)

### LP volatility and options

GammaSwap is live on Arbitrum and lets users borrow AMM liquidity for perpetual option exposure, hedge impermanent loss, and speculate on volatility. Panoptic and Stryke cover adjacent LP options. These products trade LP convexity and price risk. None gives a buyer a physically backed claim on only the next epoch's realized swap fees while returning the LP principal to the original owner. [GammaSwap documentation](https://docs.gammaswap.com/)

### LP management

Arrakis, Gamma, ICHI, and other LP managers automate range selection and rebalancing. MetEngine won a Colosseum DeFi prize with copy-LP automation. These are management products. FeeRate does not decide where to put liquidity. It makes the resulting fee cashflow separately ownable and tradable.

### Forward yield

Pye is the strongest mechanism inspiration. It forward-sells staking yield. FeeRate applies the future-cashflow pattern to AMM fees, but must solve non-fungible ranges, active-liquidity accounting, dual-token settlement, and time-standardized markets. Those differences are the protocol, not implementation trivia.

### Competition conclusion

As of 2026-09-19, web, Linkup, Colosseum, official documentation, and protocol searches found adjacent products but no close live equivalent on Arbitrum One. This is an inference from available data, not a claim that no unpublished or newly launched competitor exists.

## 4. Key insights

- The LP NFT currently bundles four exposures: token inventory, impermanent loss, active-range risk, and swap-fee cashflow. Users cannot own just the fee cashflow.
- LPs have floating business revenue but no simple way to lock it. A fee strip converts uncertain future income into cash today.
- A buyer can take pure exposure to DEX volume and active liquidity without buying both pool assets, managing a range, or absorbing the position's inventory risk.
- Positions with the same pool, fee tier, lower tick, upper tick, and epoch earn the same fees per unit of active liquidity. Their fee claims can therefore be normalized and made fungible.
- Physically backed strips solve the oracle problem. The escrow contract owns the NFT and distributes exactly what Uniswap's position manager returns.
- The physically backed product creates the transaction history needed to build fee indices, forward curves, and synthetic fixed-for-floating markets later.
- The initial buyer does not need an AMM. A sealed batch auction can clear a single weekly series without fragmenting liquidity across continuous pools.

## 5. Opportunities and gaps

### The immediate product

One canonical `WETH-USDC 0.05% / fixed range / seven-day` series on Uniswap v3 Arbitrum:

1. LP deposits an eligible Uniswap v3 NFT before the epoch cutoff.
2. The protocol collects all fees already earned so the new epoch starts at zero.
3. The protocol mints a principal receipt and fungible fee claims proportional to position liquidity.
4. The LP sells some or all fee claims in a batch auction for USDC.
5. During the epoch, the NFT remains locked and earns normal Uniswap fees.
6. At maturity, the settlement engine collects the exact token0 and token1 fees.
7. Fee-claim holders redeem pro rata for both assets.
8. The principal-receipt owner withdraws the original LP NFT with its inventory and price exposure intact.

### The company-scale protocol

- A series registry for canonical pool, range, and expiry combinations.
- Permissionless private series for custom LP positions and OTC buyers.
- Primary batch auctions for newly stripped fee claims.
- Secondary markets with time-aware pricing.
- Historical and implied fee-rate curves.
- Pool-level fee indices using deterministic fee-growth accounting.
- Fully collateralized fixed-for-floating fee swaps.
- Adapters for Uniswap v3, Uniswap v4, Camelot, PancakeSwap, and other concentrated-liquidity DEXs.
- SDKs for LP managers and wallets to add `lock next month's fees` as a primitive.

### Explicit exclusions

- no AI agent as the product;
- no automatic range manager;
- no yield aggregator;
- no generic PT/YT fork;
- no liquidity incentives or protocol token required for launch;
- no cross-chain settlement in the Arbitrum Open House build;
- no testnet-only proof.

## 6. Deep dive: FeeRate

### Market landscape

Arbitrum is already a high-volume DEX environment. On 2026-09-19, the DefiLlama DEX API reported approximately $6.61 billion of Arbitrum DEX volume over 30 days, with Uniswap v3 and v4 representing the largest named venues in the response. This creates real recurring fee cashflows on the target mainnet rather than requiring a new source of yield. [DefiLlama Arbitrum DEX data](https://defillama.com/dexs/chains/arbitrum)

Arbitrum also has the surrounding market structure needed for sophisticated rate products: Pendle for tokenized yield, Boros for funding rates, GMX for perpetual markets, and deep lending markets. FeeRate adds an unowned rate category instead of cloning an existing venue.

### The problem

For an LP, `fees` are displayed as an estimated APR but remain uncertain until swaps occur. The LP cannot:

- sell only next week's fee income;
- lock a fee rate without closing the position;
- raise cash against fee income while retaining inventory exposure;
- compare a market-implied fee curve across maturities;
- hedge fee compression caused by falling volume or rising active liquidity.

For a trader, taking a view that `WETH-USDC volume will rise` requires indirect bets through tokens, DEX equities, volatility products, or a capital-intensive LP position. There is no clean claim on realized AMM fees.

FeeRate makes that cashflow the product.

### Revenue model

V1 revenue should be cashflow-based and token-free:

- 30 basis points on primary fee-claim sale notional;
- 10 basis points on secondary trades;
- 2% of realized fees at settlement;
- later, 2 to 5 basis points on collateralized fee-swap notional;
- optional API and white-label revenue from LP managers after the market works directly.

The one-chain wedge alone is not a venture-scale ceiling. The eventual market spans fee cashflows from concentrated-liquidity DEXs across chains. Arbitrum One is the first market and the only deployment required for the Open House.

An honest revenue scenario:

- If $50 million of annual fee cashflow is stripped across supported markets,
- 30 basis points on primary notional contributes $150,000,
- a 2% settlement take contributes up to $1 million if the same figure represents realized distributed fees,
- secondary and synthetic fee markets add trading revenue only after genuine two-sided demand exists.

These figures are scenarios, not forecasts. Before building synthetic markets, the team must measure actual fee cashflow and clearing discounts for each series.

### Go-to-market friction

The cold start is not `find thousands of traders`. It is one bilateral trade:

- one real LP escrows an eligible position;
- one unrelated buyer quotes USDC for the next epoch's fees;
- both accept the economics without emissions;
- the trade settles on Arbitrum One.

Initial supply should come from passive LPs, DAO-owned liquidity, and small professional LP managers who already hold a position through an entire week. Initial buyers are volatility traders, DEX researchers, market makers, and yield funds that understand pool activity.

The hard friction is not wallet UX. It is convincing an LP to lock the NFT and give up uncertain fees for a fixed amount. The exact manual pre-build test is:

> Will an LP with at least $25,000 in a WETH-USDC position sell seven days of fees at a mutually agreed price, and will an unrelated buyer fund that purchase with at least $250 USDC?

If no such trade can be arranged after 15 qualified LP conversations and 10 buyer conversations, stop. Do not hide the failed market behind a polished frontend.

### Founder-market fit

This product requires a team comfortable with:

- Uniswap v3 tick and fee-growth accounting;
- Solidity custody and settlement security;
- auction and derivative market design;
- indexer reliability and historical fee analysis;
- direct sales to LP managers and market makers;
- explaining a complex instrument with a two-click user flow.

If the team wants a consumer app but does not want to speak with professional LPs or price a derivative manually, this is the wrong company. The product can become retail-facing, but the first market is won through market structure and liquidity relationships.

### Why crypto and why Arbitrum

This cannot be reproduced as a normal Web2 service because the fee source, custody, entitlement, sale, and settlement are all onchain:

- the LP NFT proves the fee-producing capital exists;
- escrow prevents double-selling the same future fees;
- the Uniswap position manager calculates the actual fees;
- claims can be transferred without changing the underlying LP position;
- settlement is atomic and independently verifiable.

Arbitrum One is the right first deployment because it combines significant DEX volume, low-cost settlement, sophisticated DeFi users, Uniswap and native DEX liquidity, and adjacent rate-trading products that have already educated the market. The product uses Arbitrum's existing economy rather than asking judges to believe liquidity will appear later.

### Protocol architecture

- `PositionEscrow`: holds eligible Uniswap v3 NFTs and prohibits liquidity changes during an epoch.
- `SeriesRegistry`: identifies a series by DEX, pool, fee tier, tick range, start, and maturity.
- `StripFactory`: zeroes prior fees and mints one principal receipt plus normalized fee claims.
- `FeeClaims`: ERC-1155 claims for each standardized series.
- `PrincipalReceipt`: transferable ERC-721 right to recover the LP NFT at maturity.
- `BatchAuction`: accepts buyer bids and clears the primary fee-claim sale at one price.
- `SettlementEngine`: collects token0 and token1 fees, charges the protocol share, and enables pro-rata redemption.
- `FeeIndexer`: presents realized fee curves, active-range time, historical epochs, and auction prices.
- `FeeSwapEngine`: later phase for fully collateralized fixed-for-floating positions settled against standardized fee indices.

### Mainnet-only Open House proof

The submission must show one complete economic cycle on Arbitrum One:

1. Create a small real WETH-USDC Uniswap v3 LP position in the canonical range.
2. Deposit the NFT into `PositionEscrow`.
3. Mint a short demo fee series and its principal receipt.
4. Sell the fee claim to a second wallet for real USDC through the batch auction.
5. Execute small real swaps through the target pool to create real LP fees.
6. Settle the epoch from the actual NFT fee balances.
7. Let the buyer claim both fee assets.
8. Let the principal owner recover the NFT.
9. Display the seller's fixed upfront proceeds, the buyer's realized return, and protocol revenue from mainnet transaction data.

The short demo epoch proves the mechanism. The product UI should show one-day, seven-day, and thirty-day series, with only the short evidence series activated for the live demo.

### Product surfaces

- **LP flow:** `Connect position` -> `Choose fee period` -> `See bids` -> `Lock fees now`.
- **Trader flow:** `Choose pool` -> `Buy future fees` -> `Track accrued fees` -> `Claim`.
- **Market page:** historical realized fee APR, time in range, current auction price, implied fee APR, open interest, and maturity.
- **Portfolio:** principal receipts, fee claims, upfront proceeds, accrued settlement assets, and realized PnL.

This should be a web application first. It requires position inspection, auction depth, charts, and wallet transaction review. A mobile companion can follow, but an Android-first build would reduce information density and slow the mainnet proof.

### Risk assessment

- **Out-of-range risk:** the buyer may receive no fees. The UI must show this as the core economic risk, not a footnote.
- **Position-lock risk:** the LP cannot rebalance the escrowed NFT during the epoch. Start with short terms and passive LPs.
- **Fragmentation:** arbitrary ranges create non-fungible markets. V1 supports one canonical range and epoch; custom positions use bilateral RFQs rather than public pools.
- **Adverse selection:** sophisticated LPs may sell before expected low-volume or out-of-range periods. Auctions and transparent history must price that information rather than promise fixed APY.
- **Dual-token settlement:** fees arrive in both pool assets. Do not silently swap one side. Let holders claim both unless they explicitly request a quoted conversion.
- **Contract custody:** a bug can lock or lose LP NFTs. Keep V1 immutable, narrow, and independently reviewed.
- **DEX upgrades and hooks:** v4 hooks can change fee behavior. Support v3 first and allow only audited adapters later.
- **Regulation:** fee claims and swaps can be treated as derivatives in some jurisdictions. Keep the protocol permissionless but obtain legal advice before operating a hosted consumer interface broadly.
- **Incumbent extension:** Pendle or a large LP manager could add fee stripping. The moat must become liquidity, standardized fee curves, settlement history, and integrations, not the wrapper contract alone.

### Direct competitor alert

No direct accelerator or live Arbitrum competitor appeared in the available searches. That does not remove the extension risk from Pendle, Panoptic, GammaSwap, or LP managers. Any newly discovered product that already has physically backed, range-specific, dated AMM fee claims with material liquidity should trigger an immediate re-evaluation.

## Rejected alternatives

### Rescue Lines

The research found a defensible design for committed pre-liquidation repo capital with transferable cure rights. It has strong demand evidence, but it remains loan-adjacent, requires users to migrate positions into a smart-account wrapper, and can still be dismissed as liquidation protection. Keep it as a separate thesis, not the Open House build.

### HouseEdge

Splitting GMX LP exposure into predictable base returns and trader-PnL risk is novel and Arbitrum-native. Exact decomposition of inventory return, fees, funding, and trader PnL is difficult, and the product may look like another structured GM vault. FeeRate has cleaner physical settlement.

### Protocol fee bonds

Contract-enforced protocol revenue bonds are deep, but `attn.markets` and FORWARDS already establish the direction, the product resembles founder financing, and the legal risk is severe.

### Exit Notes

Factoring queued redemption claims creates a real time-to-liquidity market, but Arbitrum's first-party supply of standardized asynchronous claims is weaker, RWA transfer restrictions are common, and final redemption can depend on an issuer.

### Timeboost and blockspace markets

Alkimiya and ETHGas already financialize blockspace. Arbitrum's ordering roadmap is moving from Timeboost toward priority gas auctions, making a Timeboost-specific company both narrow and exposed to protocol changes.

## Final validation gate

Do not start the full build until the team attempts the manual market.

Pass only if all of these occur:

- at least three Arbitrum LPs agree that selling a fixed epoch of fees is materially useful;
- at least two unrelated buyers give a real price for the same canonical series;
- at least one LP and one buyer commit to a small Arbitrum One transaction;
- the team can compute and independently reproduce fees for the selected NFT over historical blocks;
- the expected protocol fee is not larger than the value created for either side.

If that passes, FeeRate is the product.

The one-line pitch is:

> FeeRate turns AMM fees into a tradable rate. LPs lock future fee income; traders buy pure exposure to onchain volume.
