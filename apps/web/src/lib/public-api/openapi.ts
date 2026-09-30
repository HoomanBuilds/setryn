import { DEFAULT_RATE_LIMIT } from "./keys";
import { SIGNATURE_VERSION, TIMESTAMP_WINDOW_SECONDS } from "./replay";

/** OpenAPI 3.1 description of the v1 public API. Served at /api/v1/openapi.json. */

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const hex = (length?: number): Schema => ({ type: "string", pattern: length ? `^0x[0-9a-fA-F]{${length}}$` : "^0x[0-9a-fA-F]*$" });
const integerString: Schema = { type: "string", pattern: "^-?\\d+$" };
const dateTime: Schema = { type: "string", format: "date-time" };
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
});
const nullable = (schema: Schema): Schema => ({ oneOf: [schema, { type: "null" }] });
const dataOf = (schema: Schema): Schema => object({ data: schema });
const pageOf = (item: Schema): Schema =>
  object({
    data: { type: "array", items: item },
    page: object({ limit: { type: "integer" }, nextCursor: nullable({ type: "string" }), total: { type: "integer" } }),
  });

const errorResponses = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [
      String(code),
      {
        description: {
          400: "Invalid request",
          401: "Missing, invalid or revoked API key, bad signature, or stale timestamp",
          403: "Insufficient scope, signer not allowed, or console not local",
          404: "Not found",
          409: "Rejected by market, book or replay state",
          422: "Risk admission refused the order",
          429: "Rate limited. See Retry-After and RateLimit-* headers",
          503: "Deployment or chain RPC unavailable",
        }[code],
        content: { "application/json": { schema: ref("Error") } },
      },
    ]),
  );

const pagingParameters = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor from page.nextCursor." },
];
const accountFilter = [
  { name: "accountId", in: "query", schema: hex(64), description: "Collateral account id. Either accountId or signer is required." },
  { name: "signer", in: "query", schema: hex(40), description: "Order signer; resolves to the signer's primary account." },
];
const marketIdParameter = { name: "marketId", in: "path", required: true, schema: { type: "string" }, example: "BTC-YC-24DEC26" };
const readSecurity = [{ bearer: [] }];
const writeSecurity = [{ bearer: [], timestamp: [], nonce: [], signature: [] }];

const get = (summary: string, schema: Schema, extra: Schema = {}) => ({
  get: {
    summary,
    security: readSecurity,
    "x-setryn-scope": "read",
    responses: { 200: { description: "OK", content: { "application/json": { schema } } }, ...errorResponses(400, 401, 403, 404, 429, 503) },
    ...extra,
  },
});

const OPERATION_IDS: Record<string, string> = {
  "get /status": "getStatus",
  "get /markets": "listMarkets",
  "get /markets/{marketId}": "getMarket",
  "get /markets/{marketId}/book": "getBook",
  "get /markets/{marketId}/trades": "listTrades",
  "get /accounts/{accountId}": "getAccount",
  "get /accounts/{accountId}/positions": "listPositions",
  "get /fills": "listFills",
  "get /receipts": "listReceipts",
  "get /orders": "listOrders",
  "post /orders": "submitOrder",
  "post /orders/prepare": "prepareOrder",
  "get /orders/{orderHash}": "getOrder",
  "get /keys": "listKeys",
  "post /keys": "issueKey",
  "delete /keys/{keyId}": "revokeKey",
  "get /openapi.json": "getOpenApi",
};

/** Operation ids match the @setryn/sdk method names. */
function withOperationIds<T extends { paths: Record<string, Record<string, Record<string, unknown>>> }>(document: T): T {
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const id = OPERATION_IDS[`${method} ${path}`];
      if (id) operation.operationId = id;
    }
  }
  return document;
}

export function openApiDocument(serverUrl: string) {
  return withOperationIds({
    openapi: "3.1.0",
    info: {
      title: "Setryn Public API",
      version: "1.0.0",
      summary: "Versioned read and order-relay API over the Setryn contracts.",
      description: [
        "Every response is derived from the same contract state and events as the Setryn platform. The API never holds user keys and never sends transactions for a user: orders are prepared as EIP-712 typed data, signed locally, and relayed through the platform's risk admission path, which returns the exact transactions the signer sends.",
        "",
        "**Versioning.** The major version is in the path (`/api/v1`). Additive changes (new fields, endpoints, enum members announced in advance) ship within v1. Breaking changes ship as `/api/v2`, and v1 keeps serving for at least 90 days after v2 is announced, with a `Deprecation` and `Sunset` header during that window. Every response carries `Setryn-Api-Version` and `Setryn-Request-Id`.",
        "",
        "**Authentication.** `Authorization: Bearer stk_...`. Keys carry scopes `read` and `trade` and may be restricted to specific signer addresses.",
        "",
        `**Rate limits.** Per-key token bucket, default capacity ${DEFAULT_RATE_LIMIT.capacity} with ${DEFAULT_RATE_LIMIT.refillPerSecond} tokens/s refill. Every response carries RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset and RateLimit-Policy; a refused request gets 429 with Retry-After.`,
        "",
        `**Replay protection.** Every write (POST/DELETE) needs Setryn-Timestamp (unix seconds within ±${TIMESTAMP_WINDOW_SECONDS}s), a fresh Setryn-Nonce (16-128 chars of [A-Za-z0-9_-], single use per key) and Setryn-Signature: hex HMAC-SHA256 keyed with SHA-256(apiKey) (32 raw bytes) over \`${SIGNATURE_VERSION}\\nMETHOD\\npath?query\\ntimestamp\\nnonce\\nhex(SHA-256(body))\`.`,
        "",
        "**Errors.** Always `{ \"error\": { \"code\", \"message\" } }` with a stable code.",
        "",
        "**Service objectives (local devnet).** Reads answer from chain state at the current head block and are memoized per block. There is no availability commitment for the local devnet deployment.",
      ].join("\n"),
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    tags: [{ name: "Markets" }, { name: "Accounts" }, { name: "Orders" }, { name: "System" }, { name: "Keys" }],
    paths: {
      "/status": get("Chain, head block and deployment evidence summary", dataOf(ref("Status")), { tags: ["System"] }),
      "/markets": get("List markets", pageOf(ref("Market")), { tags: ["Markets"], parameters: pagingParameters }),
      "/markets/{marketId}": get("Get one market", dataOf(ref("Market")), { tags: ["Markets"], parameters: [marketIdParameter] }),
      "/markets/{marketId}/book": get(
        "Order book. The onchain market returns the live direct book; other markets return preview depth labelled source=PREVIEW_DEPTH and executable=false.",
        dataOf(ref("Book")),
        { tags: ["Markets"], parameters: [marketIdParameter] },
      ),
      "/markets/{marketId}/trades": get(
        "Trade tape, newest first. Onchain direct-book fills for the onchain market; a labelled preview tape otherwise.",
        pageOf(ref("Trade")),
        { tags: ["Markets"], parameters: [marketIdParameter, ...pagingParameters] },
      ),
      "/accounts/{accountId}": get("Collateral balance of an account", dataOf(ref("Account")), {
        tags: ["Accounts"],
        parameters: [{ name: "accountId", in: "path", required: true, schema: hex(64) }],
      }),
      "/accounts/{accountId}/positions": get("Live positions of an account", pageOf(ref("Position")), {
        tags: ["Accounts"],
        parameters: [{ name: "accountId", in: "path", required: true, schema: hex(64) }, ...pagingParameters],
      }),
      "/fills": get("Fills of an account, newest first", pageOf(ref("Fill")), { tags: ["Accounts"], parameters: [...accountFilter, ...pagingParameters] }),
      "/receipts": get("Execution receipts of an account, newest first", pageOf(ref("Receipt")), {
        tags: ["Accounts"],
        parameters: [...accountFilter, ...pagingParameters],
      }),
      "/orders": {
        ...get("Registered orders of an account or signer, newest first", pageOf(ref("Order")), {
          tags: ["Orders"],
          parameters: [
            ...accountFilter,
            { name: "state", in: "query", schema: { type: "string", enum: ["WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"] } },
            ...pagingParameters,
          ],
        }),
        post: {
          summary: "Relay a signed order to risk admission and get the transactions to send",
          description:
            "Verifies the EIP-712 signature, checks marketability, and runs the platform's risk admission for the order. Returns the transactions the signer must send in order. Requires scope `trade` and replay protection headers.",
          tags: ["Orders"],
          security: writeSecurity,
          "x-setryn-scope": "trade",
          requestBody: { required: true, content: { "application/json": { schema: ref("SubmitOrderRequest") } } },
          responses: {
            202: { description: "Risk reserved; send the returned transactions", content: { "application/json": { schema: dataOf(ref("SubmitOrderResult")) } } },
            ...errorResponses(400, 401, 403, 409, 422, 429, 503),
          },
        },
      },
      "/orders/prepare": {
        post: {
          summary: "Build an unsigned public order and its EIP-712 typed data",
          tags: ["Orders"],
          security: writeSecurity,
          "x-setryn-scope": "trade",
          requestBody: { required: true, content: { "application/json": { schema: ref("PrepareOrderRequest") } } },
          responses: {
            200: { description: "Unsigned order", content: { "application/json": { schema: dataOf(ref("PreparedOrder")) } } },
            ...errorResponses(400, 401, 403, 404, 409, 429, 503),
          },
        },
      },
      "/orders/{orderHash}": get("One registered order", dataOf(ref("Order")), {
        tags: ["Orders"],
        parameters: [{ name: "orderHash", in: "path", required: true, schema: hex(64) }],
      }),
      "/keys": {
        get: {
          summary: "List API keys with usage, rate-limit state and recent requests (local console only)",
          tags: ["Keys"],
          security: [],
          responses: { 200: { description: "OK", content: { "application/json": { schema: dataOf({ type: "array", items: ref("ApiKey") }) } } }, ...errorResponses(403) },
        },
        post: {
          summary: "Issue an API key (local console only). The key is returned once.",
          tags: ["Keys"],
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: ref("IssueKeyRequest") } } },
          responses: {
            201: { description: "Issued", content: { "application/json": { schema: dataOf(object({ key: { type: "string" }, record: ref("ApiKey") })) } } },
            ...errorResponses(400, 403, 409),
          },
        },
      },
      "/keys/{keyId}": {
        delete: {
          summary: "Revoke an API key (local console only)",
          tags: ["Keys"],
          security: [],
          parameters: [{ name: "keyId", in: "path", required: true, schema: { type: "string", pattern: "^[0-9a-f]{12}$" } }],
          responses: { 200: { description: "Revoked", content: { "application/json": { schema: dataOf(ref("ApiKey")) } } }, ...errorResponses(403, 404) },
        },
      },
      "/openapi.json": { get: { summary: "This document", tags: ["System"], security: [], responses: { 200: { description: "OpenAPI 3.1 document" } } } },
    },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", bearerFormat: "stk_test_<id>_<secret>" },
        timestamp: { type: "apiKey", in: "header", name: "Setryn-Timestamp" },
        nonce: { type: "apiKey", in: "header", name: "Setryn-Nonce" },
        signature: { type: "apiKey", in: "header", name: "Setryn-Signature" },
      },
      schemas: {
        Error: object({ error: object({ code: { type: "string" }, message: { type: "string" } }) }),
        Status: object({
          environment: { type: "string" },
          chainId: { type: "integer" },
          headBlock: integerString,
          headTime: dateTime,
          chainTime: dateTime,
          deployment: object({
            status: { type: "string" },
            sourceCommit: nullable({ type: "string" }),
            contracts: { type: "integer" },
            matching: { type: "integer" },
            state: { type: "string", enum: ["VERIFIED", "DEGRADED"] },
          }),
          settlement: object({ token: hex(40), assetId: hex(64), collateralSymbol: { type: "string" }, decimals: { type: "integer" } }),
          contracts: { type: "object", additionalProperties: hex(40) },
        }),
        Market: object({
          id: { type: "string" },
          name: { type: "string" },
          code: { type: "string" },
          underlying: { type: "string" },
          strategyKind: { type: "string" },
          strategyLabel: { type: "string" },
          priceUnit: { type: "string" },
          priceDecimals: { type: "integer" },
          tickSize: { type: "number" },
          tenorLabel: { type: "string" },
          expiry: { type: "string" },
          settlementClass: { type: "string" },
          settlementAsset: { type: "string" },
          fixingSource: { type: "string" },
          qualification: { type: "string", enum: ["QUALIFIED", "CONDITIONAL", "SUSPENDED"] },
          qualificationNote: { type: "string" },
          contractMultiplier: { type: "number" },
          collateralPerLot: { type: "number" },
          maxOrderLots: nullable({ type: "integer" }),
          execution: { type: "string", enum: ["ONCHAIN", "PREVIEW_ONLY"] },
          onchain: nullable(
            object({
              chainId: { type: "integer" },
              seriesId: hex(64),
              marketId: hex(64),
              orderState: hex(40),
              publicOrderBook: hex(40),
              tickSizeMinor: { type: "integer" },
              maxOrderLots: { type: "integer" },
              makerFeeRatePpm: { type: "integer" },
              takerFeeRatePpm: { type: "integer" },
            }),
          ),
          quote: object({
            source: { const: "PREVIEW_SNAPSHOT" },
            netPrice: { type: "number" },
            priorNetPrice: { type: "number" },
            bestBid: { type: "number" },
            bestAsk: { type: "number" },
          }),
          legs: { type: "array", items: object({ id: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, ratio: { type: "number" } }) },
        }),
        BookLevel: object({ price: { type: "number" }, lots: { type: "integer" }, priceTicks: integerString, orders: { type: "integer" } }, ["price", "lots"]),
        Book: object(
          {
            marketId: { type: "string" },
            source: { type: "string", enum: ["ONCHAIN_PUBLIC_BOOK", "PREVIEW_DEPTH"] },
            executable: { type: "boolean" },
            bookId: hex(64),
            chainTime: dateTime,
            bids: { type: "array", items: ref("BookLevel") },
            asks: { type: "array", items: ref("BookLevel") },
            note: { type: "string" },
          },
          ["marketId", "source", "executable", "bids", "asks"],
        ),
        Trade: object(
          {
            tradeId: { type: "string" },
            marketId: { type: "string" },
            price: { type: "number" },
            priceTicks: integerString,
            lots: { type: "integer" },
            aggressorSide: { type: "string", enum: ["BUY", "SELL"] },
            route: { type: "string", enum: ["DIRECT_BOOK"] },
            transactionHash: hex(64),
            time: dateTime,
            source: { type: "string", enum: ["ONCHAIN_FILL", "PREVIEW_TAPE"] },
          },
          ["tradeId", "marketId", "price", "lots", "aggressorSide", "time", "source"],
        ),
        Account: object({
          accountId: hex(64),
          exists: { type: "boolean" },
          collateralAsset: { type: "string" },
          collateralId: hex(64),
          postedUsd: { type: "number" },
          reservedUsd: { type: "number" },
          availableUsd: { type: "number" },
          postedMinor: integerString,
          reservedMinor: integerString,
          availableMinor: integerString,
        }),
        Position: object({
          positionId: hex(64),
          marketId: { type: "string" },
          side: { type: "string", enum: ["LONG", "SHORT"] },
          lots: { type: "integer" },
          entryPrice: { type: "number" },
          entryPriceTicks: integerString,
          collateralUsd: { type: "number" },
          state: { const: "ACTIVE" },
          openedByFillId: hex(64),
          transactionHash: hex(64),
          openedAt: dateTime,
        }),
        Fill: object({
          fillId: hex(64),
          orderHash: hex(64),
          role: { type: "string", enum: ["TAKER", "MAKER"] },
          marketId: { type: "string" },
          side: { type: "string", enum: ["LONG", "SHORT"] },
          route: { type: "string", enum: ["DIRECT_BOOK", "PRIVATE_RFQ"] },
          requestedLots: { type: "integer" },
          filledLots: { type: "integer" },
          cancelledLots: { type: "integer" },
          price: { type: "number" },
          priceTicks: integerString,
          feesUsd: { type: "number" },
          feesMinor: integerString,
          positionId: hex(64),
          positionLive: { type: "boolean" },
          outcome: { type: "string", enum: ["OPENED", "CLOSED"] },
          closedPositionId: nullable(hex(64)),
          transactionHash: hex(64),
          createdAt: dateTime,
        }),
        Receipt: object({
          receiptId: hex(64),
          fillId: hex(64),
          orderHash: hex(64),
          transactionHash: hex(64),
          marketId: { type: "string" },
          packageCode: { type: "string" },
          side: { type: "string", enum: ["LONG", "SHORT"] },
          route: { type: "string", enum: ["DIRECT_BOOK", "PRIVATE_RFQ"] },
          routeLabel: { type: "string" },
          lots: { type: "integer" },
          requestedLots: { type: "integer" },
          filledLots: { type: "integer" },
          cancelledLots: { type: "integer" },
          price: { type: "number" },
          feesUsd: { type: "number" },
          realizedPnlUsd: nullable({ type: "number" }),
          collateralReleasedUsd: nullable({ type: "number" }),
          guarantee: { type: "string" },
          evidence: { type: "string", enum: ["DEVNET", "TESTNET"] },
          createdAt: dateTime,
        }),
        Order: object({
          orderHash: hex(64),
          accountId: hex(64),
          signer: hex(40),
          marketId: { type: "string" },
          side: { type: "string", enum: ["LONG", "SHORT"] },
          lots: { type: "integer" },
          filledLots: { type: "integer" },
          remainingLots: { type: "integer" },
          limitPrice: { type: "number" },
          priceTicks: integerString,
          timeInForce: { type: "string", enum: ["GTC", "GTD", "IOC", "FOK"] },
          postOnly: { type: "boolean" },
          state: { type: "string", enum: ["WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"] },
          statusCode: { type: "integer", description: "Raw OrderState status enum (1 open, 2 partially filled, 3 filled, 4 cancelled, 5 expired)." },
          deadline: dateTime,
          maxFeeUsd: { type: "number" },
          collateralReservationUsd: { type: "number" },
          riskAdmissionId: nullable(hex(64)),
          fillIds: { type: "array", items: hex(64) },
          receiptIds: { type: "array", items: hex(64) },
          createdAt: dateTime,
        }),
        SerializedPublicOrder: {
          type: "object",
          description: "PublicOrder with uint128/int128/uint64/uint256 fields as decimal strings.",
          properties: {
            signer: hex(40),
            accountId: hex(64),
            policyId: hex(64),
            policyContextHash: hex(64),
            actionId: hex(64),
            targetKind: { const: 1 },
            seriesId: hex(64),
            packageId: hex(64),
            targetVersion: { type: "integer" },
            side: { type: "integer", enum: [1, 2] },
            lots: integerString,
            priceTicks: integerString,
            timeInForce: { type: "integer", enum: [1, 2, 3, 4] },
            deadline: integerString,
            executionModeId: hex(64),
            feeScheduleId: hex(64),
            feeScheduleVersion: { type: "integer" },
            maxFeeMinor: integerString,
            recipient: hex(40),
            permittedExecutor: hex(40),
            nonce: integerString,
            salt: hex(64),
            allowPartialFills: { type: "boolean" },
            minimumFillLots: integerString,
            remainderPolicy: { type: "integer", enum: [1, 2] },
            postOnly: { type: "boolean" },
            reduceOnly: { type: "boolean" },
          },
        },
        PrepareOrderRequest: object(
          {
            signer: hex(40),
            marketId: { type: "string" },
            side: { type: "string", enum: ["LONG", "SHORT"] },
            lots: { type: "integer", minimum: 1 },
            limitPrice: { type: "number" },
            timeInForce: { type: "string", enum: ["GTC", "GTD", "IOC", "FOK"], default: "GTC" },
            expiresAt: { ...dateTime, description: "Required for GTD. Capped at 240s after chain time." },
            postOnly: { type: "boolean", default: false },
            maxFeeUsd: { type: "number", minimum: 0, description: "Defaults to twice the taker fee on the full consideration." },
          },
          ["signer", "marketId", "side", "lots", "limitPrice"],
        ),
        TransactionRequest: object({
          step: { type: "string", enum: ["APPROVE_LOCK_OPERATOR", "BIND_RISK", "REGISTER_ORDER", "PLACE_ON_BOOK", "MATCH"] },
          description: { type: "string" },
          chainId: { type: "integer" },
          from: hex(40),
          to: hex(40),
          data: hex(),
          value: { const: "0" },
        }),
        PreparedOrder: object({
          orderHash: hex(64),
          accountId: hex(64),
          order: ref("SerializedPublicOrder"),
          typedData: object({
            domain: object({ name: { const: "Setryn" }, version: { const: "1" }, chainId: { type: "integer" }, verifyingContract: hex(40) }),
            types: object({ PublicOrder: { type: "array", items: object({ name: { type: "string" }, type: { type: "string" } }) } }),
            primaryType: { const: "PublicOrder" },
            message: ref("SerializedPublicOrder"),
          }),
          chainTime: dateTime,
          deadline: dateTime,
          submitWithinSeconds: { type: "integer" },
          preconditions: object({
            accountExists: { type: "boolean" },
            availableCollateralMinor: integerString,
            requiredCollateralMinor: integerString,
            sufficientCollateral: { type: "boolean" },
            lockOperatorsApproved: { type: "boolean" },
          }),
          requiredTransactions: { type: "array", items: ref("TransactionRequest") },
          next: { type: "string" },
        }),
        SubmitOrderRequest: object({ order: ref("SerializedPublicOrder"), signature: hex() }),
        SubmitOrderResult: object({
          orderHash: hex(64),
          accountId: hex(64),
          signer: hex(40),
          status: { const: "RISK_RESERVED" },
          riskAdmissionId: hex(64),
          riskReservationTransaction: nullable(hex(64)),
          validUntil: dateTime,
          transactions: { type: "array", items: ref("TransactionRequest") },
          next: { type: "string" },
        }),
        IssueKeyRequest: object(
          {
            name: { type: "string", minLength: 1, maxLength: 64 },
            scopes: { type: "array", items: { type: "string", enum: ["read", "trade"] } },
            signers: { type: "array", items: hex(40), maxItems: 10 },
            rateLimit: object({ capacity: { type: "integer", minimum: 1, maximum: 200 }, refillPerSecond: { type: "number", exclusiveMinimum: 0, maximum: 50 } }),
          },
          ["name"],
        ),
        ApiKey: object({
          id: { type: "string" },
          name: { type: "string" },
          prefix: { type: "string" },
          scopes: { type: "array", items: { type: "string", enum: ["read", "trade"] } },
          signers: { type: "array", items: hex(40) },
          rateLimit: object({ capacity: { type: "integer" }, refillPerSecond: { type: "number" }, remaining: { type: "integer" }, resetSeconds: { type: "integer" } }),
          createdAt: dateTime,
          lastUsedAt: nullable(dateTime),
          revokedAt: nullable(dateTime),
          status: { type: "string", enum: ["ACTIVE", "REVOKED"] },
          usage: object({ requests: { type: "integer" }, errors: { type: "integer" }, rateLimited: { type: "integer" }, replayRejected: { type: "integer" } }),
          recentRequests: {
            type: "array",
            items: object(
              { id: { type: "string" }, at: dateTime, method: { type: "string" }, path: { type: "string" }, status: { type: "integer" }, durationMs: { type: "integer" }, code: { type: "string" } },
              ["id", "at", "method", "path", "status", "durationMs"],
            ),
          },
        }),
      },
    },
  });
}
