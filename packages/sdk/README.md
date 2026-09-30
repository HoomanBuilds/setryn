# @setryn/sdk

TypeScript client for the Setryn public API (v1). It covers market data, account projections, non-custodial order
entry, position exits, and private firm RFQ. ESM only, and viem is its only dependency.

Every response comes from the same contract state and events as the Setryn platform. The API never holds a private
key and never sends a transaction for you. Orders and RFQs are prepared by the API, signed in your wallet, relayed to
the platform's risk admission, and then the transactions the API returns are sent from your wallet.

## Markets

Every market the deployment registers onchain reports `execution: "ONCHAIN"` with its own `onchain` block: `seriesId`,
`marketId`, `bookId`, `tickSizeMinor`, `priceScale`, `maxOrderLots`, `maxLongDebitMinorPerLot` /
`maxShortDebitMinorPerLot`, and the fee rates. On the local devnet that is all 16 catalog markets (BTC yield curves,
ETH funding carries, ARB basis, EURUSD and XAUUSD forwards). Any other catalog market is `PREVIEW_ONLY`: it serves
labelled preview data and cannot be traded.

- **Price grid.** Onchain prices are integer ticks: `priceTicks = price x onchain.priceScale` (for example a scale of 10
  quotes in steps of 0.1, a scale of 100 in steps of 0.01). A `limitPrice` off the grid is refused with
  `INVALID_REQUEST`.
- **Size and collateral.** `lots` runs from 1 to `maxOrderLots`. Risk admission reserves `lots x maxLongDebitMinorPerLot`
  (LONG) or `lots x maxShortDebitMinorPerLot` (SHORT); `collateralPerLot` is the larger of the two in USD.
- **Consideration.** `contractMultiplier` is the settlement value of one price unit per lot
  (`tickSizeMinor x priceScale / 1e6`).
- **Books and tapes.** `getBook(id)` and `listTrades(id)` read that market's own series book and fills. Orders, fills,
  positions and receipts carry the catalog `marketId` resolved from the series they trade on.

## Install

```sh
# inside this workspace
pnpm add @setryn/sdk --filter <your-package>

# standalone build
pnpm --filter @setryn/sdk build   # emits dist/ (ESM + .d.ts)
```

Create a key in the platform at **/developers** (local devnet console). The key is shown once. Choose the `read` scope
for data, or `trade` to prepare and relay orders.

## Read market and account data

```ts
import { SetrynClient, SetrynApiError } from "@setryn/sdk";

const setryn = new SetrynClient({
  apiKey: process.env.SETRYN_API_KEY!, // stk_test_<id>_<secret>
  baseUrl: "http://localhost:3100",
});

const status = await setryn.status();
console.log(status.chainId, status.headBlock, status.deployment.state);

const { data: markets } = await setryn.listMarkets({ execution: "ONCHAIN" });
const book = await setryn.getBook("XAUUSD-FW-29JUN27"); // source: ONCHAIN_PUBLIC_BOOK, that market's own series book
console.log(book.priceScale, book.asks[0]?.price, book.asks[0]?.priceTicks);

// Pagination: one page at a time, or every item.
const page = await setryn.listFills({ signer: "0x…" }, { limit: 20 });
for await (const receipt of setryn.paginate((cursor) => setryn.listReceipts({ signer: "0x…" }, cursor))) {
  console.log(receipt.receiptId, receipt.price, receipt.realizedPnlUsd);
}

try {
  await setryn.getOrder("0x…");
} catch (error) {
  if (error instanceof SetrynApiError) console.log(error.status, error.code, error.requestId);
}
```

| Method | Endpoint | Scope |
| --- | --- | --- |
| `status()` | `GET /status` | read |
| `listMarkets(params)` / `getMarket(id)` | `GET /markets`, `GET /markets/{id}` | read |
| `getBook(id)` | `GET /markets/{id}/book` | read |
| `listTrades(id, params)` | `GET /markets/{id}/trades` | read |
| `getAccount(accountId)` | `GET /accounts/{accountId}` | read |
| `listPositions(accountId, params)` | `GET /accounts/{accountId}/positions` | read |
| `listOrders(filter, params)` / `getOrder(hash)` | `GET /orders`, `GET /orders/{hash}` | read |
| `listFills(filter, params)` | `GET /fills` | read |
| `listReceipts(filter, params)` | `GET /receipts` | read |
| `prepareOrder(input)` | `POST /orders/prepare` | trade |
| `submitOrder({ order, signature })` | `POST /orders` | trade |
| `prepareCancel(hash)` | `POST /orders/{hash}/cancel` | trade |
| `prepareExit({ signer, positionIds })` | `POST /positions/exit/prepare` | trade |
| `submitExit(signedExit)` | `POST /positions/exit` | trade |
| `listRfqs(filter, params)` / `getRfq(rfqId)` | `GET /rfqs`, `GET /rfqs/{rfqId}` | read |
| `listRfqQuotes(rfqId, params)` | `GET /rfqs/{rfqId}/quotes` | read |
| `prepareRfq(input)` | `POST /rfqs/prepare` | trade |
| `submitRfq({ order, orderSignature, request, requestSignature })` | `POST /rfqs` | trade |
| `solicitRfqQuotes(rfqId)` | `POST /rfqs/{rfqId}/quotes` | trade |
| `prepareRfqAcceptance(rfqId, quoteId)` | `POST /rfqs/{rfqId}/accept/prepare` | trade |
| `acceptRfqQuote(rfqId, { selection, signature })` | `POST /rfqs/{rfqId}/accept` | trade |
| `settleRfq(rfqId)` | `POST /rfqs/{rfqId}/settle` | trade |
| `prepareRfqCancel(rfqId)` | `POST /rfqs/{rfqId}/cancel` | trade |
| `openApi()` | `GET /openapi.json` | none |

`filter` is `{ accountId }` or `{ signer }`. A signer resolves to its primary collateral account.

## Place an order (your wallet signs and sends)

```ts
import { SetrynClient, placeOrder } from "@setryn/sdk";
import { createPublicClient, createWalletClient, http } from "viem";

const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

const result = await placeOrder(setryn, wallet, publicClient, {
  signer: account.address,
  marketId: "ETH-FC-25SEP26", // any market with execution "ONCHAIN"
  side: "LONG",
  lots: 1,
  limitPrice: 439.6, // on the market's grid (priceScale 10 here)
  timeInForce: "IOC", // IOC/FOK match now; GTC/GTD rest on the book
});
console.log(result.submitted.orderHash, result.transactionHashes);
```

`placeOrder` runs these steps, and you can also call each one yourself:

1. `client.prepareOrder(input)` returns the canonical `PublicOrder`, its EIP-712 `typedData` with a deadline set on
   the chain clock (at most 240 s ahead), `preconditions` (collateral and lock operator approvals), and any
   `requiredTransactions`, such as one-time lock operator approvals.
2. `signPreparedOrder(wallet, prepared)` checks the typed data against the fixed `PublicOrder` layout, the wallet's
   chain, and the signer, then signs locally.
3. `client.submitOrder({ order, signature })` verifies the signature and checks marketability. It then runs the
   platform's portfolio risk admission and returns `transactions`: `BIND_RISK`, `REGISTER_ORDER`, and then either
   `PLACE_ON_BOOK` (resting) or `MATCH` (IOC/FOK).
4. `sendOrderTransactions(wallet, publicClient, transactions)` sends them in order and waits for each receipt.

## Exit a position (your wallet signs and sends)

A position closes the same way it does in the Setryn terminal: open the opposite position with an opposite-side
order (for example an IOC through `placeOrder`), then run a full lifecycle exit of the pair. Both positions close
and their collateral locks are released.

```ts
import { exitPosition } from "@setryn/sdk";

const result = await exitPosition(setryn, wallet, publicClient, { positionIds: [openPositionId, closePositionId] });
console.log(result.submitted.actionId, result.transactionHashes); // AUTHORIZE_LIFECYCLE, EXECUTE_LIFECYCLE
```

1. `client.prepareExit({ signer, positionIds })` checks that the two positions are between the signer's account and
   one counterparty, on opposite sides, with equal lots and no package provenance. It returns the kind-4
   `LifecycleAction`, its `inputs` and `replacements`, the counterparty's `consent` and `consentSignature` (the devnet
   maker on the local devnet), and the `SetrynLifecycleActionV1` `typedData`. Refusals use `EXIT_NOT_ELIGIBLE`.
2. `signPreparedExit(wallet, prepared)` checks the layout, chain and actor, then signs locally.
3. `client.submitExit({ action, inputs, replacements, consent, consentSignature, actorSignature })` re-derives the
   action id, verifies both signatures, simulates authorization, and returns `AUTHORIZE_LIFECYCLE` and
   `EXECUTE_LIFECYCLE`, which `sendOrderTransactions` sends in order.

## Private RFQ (your wallet signs and sends)

A private RFQ asks eligible solvers for firm, capacity-backed quotes and clears the selected one atomically onchain
through the private execution channel. RFQ fills settle like any other fill (route `PRIVATE_RFQ` on fills and
receipts) but stay off the public tape.

```ts
import { executeRfq } from "@setryn/sdk";

const market = await setryn.getMarket("EURUSD-FW-30DEC26");
const result = await executeRfq(setryn, wallet, publicClient, {
  marketId: market.id,
  side: "LONG",
  lots: 1,
  limitPrice: market.quote.bestAsk, // the worst price you accept
});
console.log(result.quote.price, result.settlement.fillId, result.rfq.state); // SETTLED
```

`executeRfq` runs these steps, and you can also call each one yourself:

1. `client.prepareRfq(input)` builds the taker `PublicOrder` on the market's series with the private RFQ execution
   mode, and the `PrivateRfqRequest` bound to it (`rfqId` is its hash). `timeInForce` defaults to `IOC`; `FOK` is
   refused because the RFQ book only accepts a no-partial-fill request whose remainder stays open.
2. `signPublicOrder(wallet, prepared.orderTypedData, prepared.order)` and `signPreparedRfqRequest(wallet, prepared)`
   check the layouts, chain and signer, then sign locally.
3. `client.submitRfq({ order, orderSignature, request, requestSignature })` verifies both signatures, checks that the
   request is exactly the one derived from the order, runs risk admission, and returns `BIND_RISK`, `REGISTER_ORDER`,
   `REGISTER_RFQ` and `OPEN_RFQ` (plus any missing lock operator approvals).
4. `client.solicitRfqQuotes(rfqId)` invites solvers to quote the collecting RFQ. On the local devnet the seeded solver
   (`Setryn Devnet MM`) quotes through the platform's devnet solver route, exactly as the terminal does. Each quote
   reports `price`, `state` and `withinLimit` (at or inside your signed limit).
5. `client.prepareRfqAcceptance(rfqId, quoteId)` returns the `RfqSelectionAuthorization` typed data for a `RESERVED`
   quote inside your limit; `signPreparedRfqAcceptance(wallet, prepared)` signs it.
6. `client.acceptRfqQuote(rfqId, { selection, signature })` verifies and simulates the selection and returns
   `LOCK_SELECTION`, `CONFIRM_CAPACITY`, `AUTHORIZE_SUBMISSION` and `SUBMIT_RFQ`.
7. `client.settleRfq(rfqId)` hands the submitted RFQ to its permitted executor, which clears it through
   `clearSeriesWithHandoff` and returns the fill, position, price and fees.

Pass `{ selectQuote }` to choose a quote yourself. An RFQ you do not accept can be cancelled (or expired after its
deadline) with `cancelRfq(client, wallet, publicClient, rfqId)`, which also releases the taker order's reserved
collateral.

The public layer cannot bypass qualification, collateral, risk admission, execution, or settlement. Preview-only
markets are refused with `MARKET_NOT_ONCHAIN`, a resting order that would cross is refused with `WOULD_CROSS`, and
insufficient collateral fails risk admission with `RISK_RESERVATION_FAILED`.

## Authentication, rate limits, replay protection

- **Auth.** `Authorization: Bearer stk_…` is sent by the client.
- **Rate limits.** Each key has a token bucket (default 20 burst, 2/s). Every response carries `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset`, and `RateLimit-Policy`. On `429` the client retries reads up to
  `maxRateLimitRetries` times (default 2), honoring `Retry-After`. Writes are never retried automatically.
- **Replay protection.** The client signs every write:
  - `Setryn-Timestamp` is unix seconds and must be within ±60 s of server time.
  - `Setryn-Nonce` is 16 to 128 characters of `[A-Za-z0-9_-]` and can be used only once per key.
  - `Setryn-Signature` is `hex(HMAC-SHA256(SHA-256(apiKey), canonical))`, where

    ```
    canonical = "SETRYN-HMAC-SHA256-V1\n" + METHOD + "\n" + path?query + "\n" + timestamp + "\n" + nonce + "\n" + hex(SHA-256(body))
    ```

  `signRequest()` is exported if you sign requests yourself.
- **Errors.** Every error has the shape `{ "error": { "code", "message" } }`. `SetrynApiError` exposes `status`,
  `code`, `requestId` (from `Setryn-Request-Id`), and `retryAfterSeconds`.

## Examples

```sh
export SETRYN_API_KEY=stk_test_...
export SETRYN_BASE_URL=http://localhost:3100

pnpm --filter @setryn/sdk example:read     # status, catalog, onchain book and tape, preview depth

# Local devnet only (refuses any chain but 31337): mints test sUSD if needed, seeds the devnet maker, places an IOC.
export SETRYN_DEVNET_PRIVATE_KEY=0x...      # a local anvil account key, never a real key
SETRYN_MARKET_ID=XAUUSD-FW-29JUN27 pnpm --filter @setryn/sdk example:order

# Local devnet only: a full private RFQ (request, solver quote, selection, atomic settlement).
SETRYN_MARKET_ID=EURUSD-FW-30DEC26 SETRYN_SIDE=LONG pnpm --filter @setryn/sdk example:rfq
```

## Versioning

The major version is in the path (`/api/v1`). Additive changes ship within v1. A breaking change ships as `/api/v2`,
and v1 keeps serving for at least 90 days after that, with `Deprecation` and `Sunset` headers. The OpenAPI 3.1 document
is at `/api/v1/openapi.json`, and its operation ids match the method names above.

## Current limits

- Markets execute onchain only when the deployment registers them; on the local devnet that is every catalog market.
- Direct public-book orders, private RFQs on a single series, and full exits of an offsetting pair go through the API.
  Package RFQs and other lifecycle actions (partial exits, rolls, package compression) are platform-only in v1.
- Solver quoting (`solicitRfqQuotes`) and RFQ handoff execution (`settleRfq`) are served by the devnet solver and
  operator on the local devnet only; elsewhere they return `SOLVER_UNAVAILABLE`. Exit counterparty consent is likewise
  available only from the devnet maker on the local devnet.
- Delegated signers are not supported onchain. The order signer must own the collateral account. A key can be
  restricted to specific signer addresses.
