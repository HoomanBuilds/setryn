# Network runtime and real market data

Status: in implementation (2026-10-01). This plan removes every simulated input from the user product. Once the
contracts are deployed to a network and that network's runtime file exists, the app trades, marks, charts, and settles
from chain state and real oracle data, with no code changes.

## 1. What was simulated

| Area | Before | After |
| --- | --- | --- |
| Market list | 16 hand-written catalog markets (`lib/terminal/markets.ts`) with fixture prices and expiries | Markets come from the deployment's runtime file, generated from a listing built on live Chainlink prices |
| Marks, charts, depth, tape | Deterministic synthetic stream (`PreviewMarketProvider`, `preview-*.ts`) | Onchain book, onchain fills, and Chainlink reference prices through one market-data feed |
| Series economics | One-day devnet series; the quoted "carry bp" price was unrelated to the payoff | Dated range forwards with real expiries; the quoted price is the forward level the payoff settles against |
| Settlement asset | Mintable devnet token (local), nothing for networks | Circle USDC on Arbitrum Sepolia and Arbitrum One; the mintable token remains on the local chain only |
| Fixing | Devnet adapter that accepts any evidence | Signed-observation adapter that verifies a threshold of authorized publisher signatures onchain; Chainlink historical rounds where the chain has the feed |
| Risk | Devnet adapter refusing public networks | `FullyCollateralizedRiskAdapter`: margin equals the bounded terminal liability, on every network |
| Trading sessions | One published day | A session calendar covering every listed expiry; session days are published ahead by the keeper (permissionless with a proof) |
| Runtime | `deployments/local/runtime.json` over a loopback RPC only | `deployments/<network>/runtime.json`, chosen by `SETRYN_NETWORK`, any RPC |
| Operator signing | Unlocked anvil account for everything | Local: anvil accounts. Networks: configured keys per role (operator, designated maker, oracle publisher) |
| Faucet | Mint route visible everywhere | Local only; networks deposit real USDC |

## 2. Product model on every network

Each market is a **cash-settled dated range forward** on one underlying's official fixing.

- Payoff to the long per lot: `lotSize × clamp(S_T − floor, 0, cap − floor)` in USDC, where `S_T` is the fixing at
  expiry. Between floor and cap the contract is delta-one on the underlying.
- Quoted price: the forward level `F` in USD. Onchain price ticks are `(F − floor) / tickPrice`, so consideration per lot
  is `lotSize × (F − floor)` and fees (bps of consideration) are a real share of the position's value.
- Collateral: the long pays the consideration at the fill; the short locks `lotSize × (cap − floor)` less what it
  receives. Both sides are fully collateralized; nobody can owe more than they locked.
- Strategy views stay as before but are computed, not stored: implied annualized carry `(F / S − 1) × 365 / days`
  (dated yield carry, funding carry), basis `F − S` (dated basis), forward points `(F − S) × 10⁴` (FX), where `S` is the
  live Chainlink reference. Funding-strip and term-financing comparisons appear only when a data source for them is
  configured; no fixture numbers.

Families and parameters (generator defaults; the listing file is the source of truth once written):

| Family | Feed key | Lot | Tick | Floor / cap (of reference) | Price decimals | Display kind |
| --- | --- | --- | --- | --- | --- | --- |
| BTC | Crypto.BTC/USD | 0.01 BTC | $1 | 50% / 150%, rounded to $1,000 | 0 | Dated yield carry |
| ETH | Crypto.ETH/USD | 0.1 ETH | $0.1 | 50% / 150%, rounded to $10 | 1 | Funding carry |
| ARB | Crypto.ARB/USD | 1,000 ARB | $0.0001 | 50% / 150%, rounded to $0.01 | 4 | Dated basis |
| EUR/USD | FX.EUR/USD | 10,000 EUR | 0.00001 | 80% / 120%, rounded to 0.01 | 5 | Deliverable forward |
| XAU/USD | Metal.XAU/USD | 1 oz | $0.1 | 70% / 130%, rounded to $10 | 1 | Deliverable forward |

`tickSizeMinor = lotSize × tickPrice × 10⁶`; `priceScale = 1 / tickPrice`; `priceOffset = floor`.

Expiries: the next three quarterly expiries (last Friday of Mar, Jun, Sep, Dec; Dec 25 moves to Dec 24) at
08:00 UTC that are at least 14 days after listing. Market keys keep the catalog style: `BTC-YC-24DEC26`,
`ETH-FC-26MAR27`, `ARB-BS-25JUN27`, `EURUSD-FW-24DEC26`, `XAUUSD-FW-26MAR27`.

Series schedule relative to expiry `E` (08:00 UTC): trading from listing to `E − 2h`; fixing window `E − 1h` to `E`;
evidence deadline `E + 1h`; corrections close `E + 2h`; holder election `E + 2h` to `E + 2h45m`; final resolution
`E + 3h`; settlement deadline `E + 3h30m`. Session days carry continuous trading `00:00–24:00 UTC` and a daily fixing
window `07:00–08:00 UTC`.

Reference prices: Chainlink aggregators on Arbitrum One, read-only (verified 2026-10-01):

| Feed | Aggregator proxy | Decimals |
| --- | --- | --- |
| BTC / USD | `0x6ce185860a4963106506C203335A2910413708e9` | 8 |
| ETH / USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | 8 |
| ARB / USD | `0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6` | 8 |
| EUR / USD | `0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84` | 8 |
| XAU / USD | `0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c` | 8 |

Network dependencies: Arbitrum Sepolia USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` (6 decimals); Arbitrum One
USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.

## 3. Files and schemas

### Listing: `deployments/<network>/markets.json` (schema 2)

Written by `scripts/generate-network-markets.mjs --network <local|arbitrum-sepolia|arbitrum-one>`; read by the
bootstrap. Integers are JSON numbers when they fit in 2⁵³, otherwise decimal strings.

```json
{
  "schemaVersion": 2,
  "network": "arbitrum-sepolia",
  "generatedAt": "2026-10-01T03:30:00Z",
  "listedAt": 1790830800,
  "fixingDecimals": 8,
  "reference": { "source": "chainlink", "chainId": 42161 },
  "families": [
    {
      "symbol": "BTC", "underlying": "BTC", "feedKey": "Crypto.BTC/USD", "assetClass": 1,
      "referenceFeed": "0x6ce185860a4963106506C203335A2910413708e9", "referencePriceE8": "8344924434331",
      "referenceAt": 1790825244, "strategyKind": "DATED_YIELD_CARRY"
    }
  ],
  "markets": [
    {
      "marketKey": "BTC-YC-24DEC26", "family": 0, "displayName": "BTC Dated Forward · 24 Dec 26",
      "expiryAt": 1798099200, "floorE8": "4200000000000", "capE8": "12500000000000",
      "lotSize": "0.01", "tickPrice": "1", "priceDecimals": 0, "priceScale": 1, "tickSizeMinor": 10000,
      "maxOrderLots": 100
    }
  ]
}
```

### Runtime: `deployments/<network>/runtime.json` (schema 11)

Schema 11 keeps every schema 9 and 10 field (so existing readers keep working) and adds:

- top level: `network` (`local`, `arbitrum-sepolia`, `arbitrum-one`), `listedAt`, `fixingAdapter`,
  `fixingAdapterKind` (`signed-observation` or `chainlink-historical`), `riskAdapter`, `oracleSigners` (address array),
  `oracleThreshold`, `sessionDaysPath` (relative path of the session-day proofs file), `referenceChainId`.
- per market, in addition to the schema 9 market fields: `underlying`, `feedKey`, `strategyKind`, `displayName`,
  `floor` and `cap` (decimal strings, USD), `lotSize` and `tickPrice` (decimal strings), `priceDecimals`,
  `priceOffset` (decimal string, equals `floor`), `referenceFeed` (Arbitrum One aggregator), `tradingStartsAt`,
  `lastTradingAt`, `expiryAt`, `fixingWindowOpen`, `fixingWindowClose`, `exerciseOpensAt`, `exerciseCutoffAt`,
  `finalResolutionAt`, `settlementDeadline` (unix seconds).

Price conversion everywhere: `ticks = round((price − priceOffset) × priceScale)`,
`price = priceOffset + ticks / priceScale`. A schema 9 or 10 runtime has no `priceOffset`, which reads as 0.

### Session days: `deployments/<network>/session-days.json`

Written by the bootstrap: the session id and version and, for every calendar day the session covers, the day, its
windows, the evidence hash, and the Merkle proof `TradingSessionPolicy.publishSessionDay` verifies. The keeper publishes
any missing day from today to today + 3; anyone can.

### Web catalog: `apps/web/src/lib/terminal/catalog.generated.json`

`apps/web/scripts/sync-market-catalog.mjs` projects the selected network's runtime markets into the static catalog the
web app imports synchronously (`MARKETS`). It runs before `dev` and `build`. It carries metadata only (ids, names,
underlying, expiry, floor, cap, lot, tick, decimals, kinds) plus the listing reference price; every live number comes
from the market-data feed.

## 4. Market-data feed (web)

One coherent feed so marks, quotes, books, routes, and charts never contradict each other.

- `GET /api/market-data` (server, `no-store`): for every runtime market, the onchain public book (best bid/ask and depth
  from the active series version's book), recent fills from the clearing engine's events, 24h change and volume, open
  interest, series status, and the Chainlink reference for each underlying, all read at one block. Cached in memory for
  2 s per server.
- `GET /api/market-data/candles?market=<key>&interval=<1m|5m|15m|1h|4h|1d>`: OHLC bars of the market's own modeled
  mark, before and after any trade, with its fills as markers, the lots traded per bar as volume, the Chainlink spot as
  a separate line, and the floor and cap.
- Mark: one versioned capped-forward model per expiry from the Chainlink spot, floor, cap, time to expiry and MODELED
  volatility, rate and carry (`markSource: MODEL`); see [the mark methodology](../specs/setryn-mark-methodology.md).
  Book prices and fills sit beside it and never replace it. Nothing else is invented: no fills means an empty tape, no
  orders means an empty book.
- Client: `components/market-data/MarketDataProvider.tsx` polls every 3 s and exposes
  `useMarketBoard()`, `useLiveMarket(id)`, `useMarketTrades(id)`, `useMarketCandles(id, interval)`, and
  `useReferencePrices()`. It replaces `PreviewMarketProvider`; the preview modules are deleted.

## 5. Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `SETRYN_NETWORK` / `NEXT_PUBLIC_SETRYN_NETWORK` | web | `local` (default), `arbitrum-sepolia`, `arbitrum-one` |
| `SETRYN_RUNTIME_PATH` | web, services | Overrides `deployments/<network>/runtime.json` |
| `SETRYN_RPC_URL` | web server | Network RPC; defaults to the loopback anvil or the public Arbitrum RPC |
| `NEXT_PUBLIC_SETRYN_RPC_URL` | browser | RPC the wallet and browser reads use; defaults to the runtime's `rpcUrl` |
| `SETRYN_REFERENCE_RPC_URL` | web server, operator | Arbitrum One RPC for Chainlink reference reads (read-only) |
| `SETRYN_OPERATOR_PRIVATE_KEY` | web server | Operator role on networks: risk admission, witness staging, keeper calls |
| `SETRYN_MAKER_PRIVATE_KEY` | web server | Optional designated maker on networks; without it no house quotes are posted |
| `SETRYN_ORACLE_SIGNER_KEY` | operator runtime | Publisher key for signed fixings (one of `oracleSigners`) |

Mainnet stays read-only: deployment scripts and the operator worker refuse Arbitrum One until it is explicitly
authorized.

## 6. Deploy, then point the app at it

1. `node scripts/generate-network-markets.mjs --network arbitrum-sepolia` (reads Chainlink on Arbitrum One).
2. Deploy the core with `DeploySetryn.s.sol` (environment `arbitrum-sepolia`).
3. Run `BootstrapSetrynMarkets.s.sol` with the deployed addresses; it writes `runtime.json` and `session-days.json`.
4. Set `SETRYN_NETWORK=arbitrum-sepolia` (and the keys above) and restart the web app; `sync-market-catalog` runs on
   start.
5. Run the operator worker (`--environment arbitrum-sepolia --sweep true`) on a schedule for session days, fixings, and
   settlement.
