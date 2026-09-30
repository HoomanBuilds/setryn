# @setryn/sdk

TypeScript client for the Setryn public API (v1). It covers market data, account projections, and non-custodial order
entry. ESM only, and viem is its only dependency.

Every response comes from the same contract state and events as the Setryn platform. The API never holds a private
key and never sends a transaction for you. Orders are prepared by the API, signed in your wallet, relayed to the
platform's risk admission, and then the transactions the API returns are sent from your wallet.

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
const book = await setryn.getBook(markets[0].id); // source: ONCHAIN_PUBLIC_BOOK
const preview = await setryn.getBook("ETH-FC-25SEP26"); // source: PREVIEW_DEPTH, executable: false

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
  marketId: "BTC-YC-24DEC26",
  side: "LONG",
  lots: 1,
  limitPrice: 613,
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
pnpm --filter @setryn/sdk example:order
```

## Versioning

The major version is in the path (`/api/v1`). Additive changes ship within v1. A breaking change ships as `/api/v2`,
and v1 keeps serving for at least 90 days after that, with `Deprecation` and `Sunset` headers. The OpenAPI 3.1 document
is at `/api/v1/openapi.json`, and its operation ids match the method names above.

## Current limits

- One market (`BTC-YC-24DEC26`) executes onchain on this deployment. The other markets serve labelled preview data.
- Only direct public-book orders go through the API. Private RFQ, cancellation of bound risk, and lifecycle actions
  (exits, rolls) are platform-only in v1.
- Delegated signers are not supported onchain. The order signer must own the collateral account. A key can be
  restricted to specific signer addresses.
