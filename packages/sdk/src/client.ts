import type { Hex } from "viem";
import { SetrynApiError } from "./errors.ts";
import { signRequest } from "./signing.ts";
import type {
  Account,
  AccountFilter,
  Book,
  Fill,
  Market,
  Order,
  OrderState,
  Page,
  PreparedCancel,
  PageParams,
  Position,
  PrepareOrderInput,
  PreparedOrder,
  Receipt,
  SerializedPublicOrder,
  Status,
  SubmitOrderResult,
  Trade,
} from "./types.ts";

export interface SetrynClientOptions {
  /** A key issued in the /developers console: `stk_test_<id>_<secret>`. */
  apiKey: string;
  /** Origin of the Setryn deployment, e.g. `http://localhost:3100`. `/api/v1` is appended. */
  baseUrl: string;
  /** Custom fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Retries for rate-limited reads, honoring Retry-After. Writes are never retried. Default 2. */
  maxRateLimitRetries?: number;
  /** Per-request timeout in milliseconds. Default 30 000. */
  timeoutMs?: number;
}

type Query = Record<string, string | number | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Typed client for the Setryn v1 public API. Reads need a key with the `read` scope; order entry needs `trade`, and
 * every write is signed for replay protection automatically. The client never sees a private key: order signing
 * happens in your wallet through the helpers in `orders.ts`.
 */
export class SetrynClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRateLimitRetries: number;
  private readonly timeoutMs: number;

  constructor(options: SetrynClientOptions) {
    if (!/^stk_(test|live)_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/.test(options.apiKey)) {
      throw new TypeError("apiKey must be a Setryn key (stk_test_<id>_<secret>).");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // -- transport --------------------------------------------------------------------------------------------------

  private path(path: string, query?: Query): string {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined) search.set(name, String(value));
    const suffix = search.toString();
    return `/api/v1${path}${suffix ? `?${suffix}` : ""}`;
  }

  /** Low-level request. `path` is relative to /api/v1, e.g. `/markets`. */
  async request<T>(method: "GET" | "POST" | "DELETE", path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
    const pathWithQuery = this.path(path, options.query);
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const write = method !== "GET";
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" };
      if (write) {
        headers["Content-Type"] = "application/json";
        // A fresh timestamp and nonce per attempt: the server refuses a reused nonce.
        Object.assign(headers, await signRequest({ apiKey: this.apiKey, method, pathWithQuery, body }));
      }
      const response = await this.fetchImpl(`${this.baseUrl}${pathWithQuery}`, {
        method,
        headers,
        body: write ? body : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (response.ok) return parsed as T;
      const envelope = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      const retryAfter = Number(response.headers.get("retry-after"));
      const error = new SetrynApiError({
        status: response.status,
        code: envelope?.code ?? `HTTP_${response.status}`,
        message: envelope?.message ?? (text.slice(0, 200) || response.statusText),
        requestId: response.headers.get("setryn-request-id"),
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      });
      if (response.status === 429 && !write && attempt < this.maxRateLimitRetries) {
        await sleep((error.retryAfterSeconds ?? 1) * 1000);
        continue;
      }
      throw error;
    }
  }

  /**
   * Iterates every item of a paginated list.
   *
   *   for await (const fill of client.paginate((page) => client.listFills({ accountId }, page))) { ... }
   */
  async *paginate<T>(list: (page: PageParams) => Promise<Page<T>>, pageSize = 100): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const page = await list({ limit: pageSize, cursor });
      yield* page.data;
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);
  }

  // -- system -----------------------------------------------------------------------------------------------------

  async status(): Promise<Status> {
    return (await this.request<{ data: Status }>("GET", "/status")).data;
  }

  /** The OpenAPI 3.1 document of this deployment (no key needed, but sent anyway). */
  async openApi(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/openapi.json");
  }

  // -- markets ----------------------------------------------------------------------------------------------------

  listMarkets(params: PageParams & { execution?: Market["execution"] } = {}): Promise<Page<Market>> {
    return this.request<Page<Market>>("GET", "/markets", { query: { ...params } });
  }

  async getMarket(marketId: string): Promise<Market> {
    return (await this.request<{ data: Market }>("GET", `/markets/${encodeURIComponent(marketId)}`)).data;
  }

  /** Live onchain book for the onchain market; labelled preview depth (`executable: false`) for the others. */
  async getBook(marketId: string): Promise<Book> {
    return (await this.request<{ data: Book }>("GET", `/markets/${encodeURIComponent(marketId)}/book`)).data;
  }

  listTrades(marketId: string, params: PageParams = {}): Promise<Page<Trade>> {
    return this.request<Page<Trade>>("GET", `/markets/${encodeURIComponent(marketId)}/trades`, { query: { ...params } });
  }

  // -- accounts ---------------------------------------------------------------------------------------------------

  async getAccount(accountId: Hex): Promise<Account> {
    return (await this.request<{ data: Account }>("GET", `/accounts/${accountId}`)).data;
  }

  listPositions(accountId: Hex, params: PageParams = {}): Promise<Page<Position>> {
    return this.request<Page<Position>>("GET", `/accounts/${accountId}/positions`, { query: { ...params } });
  }

  listFills(filter: AccountFilter, params: PageParams = {}): Promise<Page<Fill>> {
    return this.request<Page<Fill>>("GET", "/fills", { query: { ...filter, ...params } });
  }

  listReceipts(filter: AccountFilter, params: PageParams = {}): Promise<Page<Receipt>> {
    return this.request<Page<Receipt>>("GET", "/receipts", { query: { ...filter, ...params } });
  }

  // -- orders -----------------------------------------------------------------------------------------------------

  listOrders(filter: AccountFilter & { state?: OrderState }, params: PageParams = {}): Promise<Page<Order>> {
    return this.request<Page<Order>>("GET", "/orders", { query: { ...filter, ...params } });
  }

  async getOrder(orderHash: Hex): Promise<Order> {
    return (await this.request<{ data: Order }>("GET", `/orders/${orderHash}`)).data;
  }

  /** Builds an unsigned order with chain-time deadlines. Sign `typedData` with the signer's wallet. Needs `trade`. */
  async prepareOrder(input: PrepareOrderInput): Promise<PreparedOrder> {
    return (await this.request<{ data: PreparedOrder }>("POST", "/orders/prepare", { body: input })).data;
  }

  /**
   * Relays a signed order to risk admission. Returns the transactions the signer must send, in order.
   * Needs `trade`.
   */
  async submitOrder(input: { order: SerializedPublicOrder; signature: Hex }): Promise<SubmitOrderResult> {
    return (await this.request<{ data: SubmitOrderResult }>("POST", "/orders", { body: input })).data;
  }

  /** Prepares the cancellation of a working order for its signer to execute. Needs `trade`. */
  async prepareCancel(orderHash: Hex): Promise<PreparedCancel> {
    return (await this.request<{ data: PreparedCancel }>("POST", `/orders/${orderHash}/cancel`, { body: {} })).data;
  }
}

