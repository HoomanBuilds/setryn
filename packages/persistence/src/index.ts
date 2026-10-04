import postgres, { type Sql } from "postgres";

export interface DocumentMutation<T, R> {
  readonly next?: T;
  readonly result: R;
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CLIENT = Symbol.for("setryn.persistence.client");

interface ClientHolder {
  [CLIENT]?: { url: string; sql: Sql };
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.SETRYN_DATABASE_URL?.trim());
}

export function databaseScope(): string {
  const raw = (
    process.env.SETRYN_NETWORK ??
    process.env.NEXT_PUBLIC_SETRYN_NETWORK ??
    process.env.SETRYN_DEPLOYMENT_ENVIRONMENT ??
    "local"
  ).trim().toLowerCase();
  if (!NAME.test(raw)) throw new Error(`invalid Setryn database scope ${raw}`);
  return raw;
}

function database(): Sql {
  const url = process.env.SETRYN_DATABASE_URL?.trim();
  if (!url) throw new Error("SETRYN_DATABASE_URL is not configured");
  const holder = globalThis as typeof globalThis & ClientHolder;
  if (holder[CLIENT]?.url === url) return holder[CLIENT].sql;
  const parsed = new URL(url);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  const sql = postgres(url, {
    max: positiveInteger(process.env.SETRYN_DATABASE_POOL_SIZE, 4),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: local ? false : "require",
    onnotice: () => undefined,
  });
  holder[CLIENT] = { url, sql };
  return sql;
}

export async function closeDatabase(): Promise<void> {
  const holder = globalThis as typeof globalThis & ClientHolder;
  if (!holder[CLIENT]) return;
  await holder[CLIENT].sql.end({ timeout: 5 });
  delete holder[CLIENT];
}

export async function readDocument<T>(collection: string, documentKey: string, fallback: T): Promise<T> {
  validateNames(collection, documentKey);
  const scope = databaseScope();
  const rows = await database()<[{ payload: T }?]>`
    select payload
    from setryn.runtime_documents
    where scope = ${scope} and collection = ${collection} and document_key = ${documentKey}
  `;
  return rows[0]?.payload ?? clone(fallback);
}

export async function updateDocument<T, R>(
  collection: string,
  documentKey: string,
  fallback: T,
  mutate: (current: T) => DocumentMutation<T, R>,
): Promise<R> {
  validateNames(collection, documentKey);
  const scope = databaseScope();
  const result = await database().begin(async (transaction) => {
    await transaction`
      insert into setryn.runtime_documents (scope, collection, document_key, payload)
      values (${scope}, ${collection}, ${documentKey}, ${transaction.json(fallback as never)})
      on conflict (scope, collection, document_key) do nothing
    `;
    const rows = await transaction<[{ payload: T }]>`
      select payload
      from setryn.runtime_documents
      where scope = ${scope} and collection = ${collection} and document_key = ${documentKey}
      for update
    `;
    const outcome = mutate(clone(rows[0].payload));
    if (outcome.next !== undefined) {
      await transaction`
        update setryn.runtime_documents
        set payload = ${transaction.json(outcome.next as never)}, revision = revision + 1, updated_at = now()
        where scope = ${scope} and collection = ${collection} and document_key = ${documentKey}
      `;
    }
    return outcome.result;
  });
  return result as R;
}

/** Thrown by `withAdvisoryLock` when another holder kept the lock past the timeout. */
export class AdvisoryLockTimeoutError extends Error {
  constructor(name: string) {
    super(`ADVISORY_LOCK_TIMEOUT:${name}`);
    this.name = "AdvisoryLockTimeoutError";
  }
}

/**
 * Runs `work` while holding a transaction-scoped Postgres advisory lock named for this scope, so one critical section
 * runs at a time across every server instance sharing the database. The lock needs no table; it is released when the
 * transaction ends, including when `work` throws or the connection drops. Waiting longer than `timeoutMs` throws
 * AdvisoryLockTimeoutError. `idleTimeoutMs` can bound a lock held by work that is suspended outside Postgres.
 */
export async function withAdvisoryLock<T>(
  name: string,
  work: () => Promise<T>,
  timeoutMs = 25_000,
  idleTimeoutMs?: number,
): Promise<T> {
  if (!NAME.test(name)) throw new Error(`invalid Setryn advisory lock name ${name}`);
  const key = `${databaseScope()}:${name}`;
  const timeout = `${Math.max(1, Math.round(timeoutMs))}ms`;
  const idleTimeout = idleTimeoutMs === undefined ? null : `${Math.max(1, Math.round(idleTimeoutMs))}ms`;
  let acquired = false;
  try {
    const result = await database().begin(async (transaction) => {
      await transaction`select set_config('lock_timeout', ${timeout}, true)`;
      if (idleTimeout !== null) {
        await transaction`select set_config('idle_in_transaction_session_timeout', ${idleTimeout}, true)`;
      }
      await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      acquired = true;
      return { value: await work() };
    });
    return (result as { value: T }).value;
  } catch (error) {
    // 55P03 is lock_not_available: lock_timeout elapsed before the advisory lock was granted.
    if (!acquired && (error as { code?: string } | null)?.code === "55P03") throw new AdvisoryLockTimeoutError(name);
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Market data (supabase/migrations/20261003000100_market_data.sql)                                                    */
/* ------------------------------------------------------------------------------------------------------------------ */

/*
 * Observed facts only: Chainlink rounds, clearing fills, position quantities, and each ingest stream's cursor. Writes are
 * idempotent upserts keyed by chain identity, and a stream's rows and its cursor commit in one transaction. The
 * market-data ingester (services/market-data) writes; the web app reads.
 */

const PHASE_SIZE = BigInt("18446744073709551616");
const HEX_ADDRESS = /^0x[0-9a-f]{40}$/;
const STREAM = /^[a-z0-9][a-z0-9.:_-]{0,255}$/;
/** Reference rounds are network-independent (they are read from Arbitrum One), so their cursors share one scope. */
export const SHARED_SCOPE = "shared";

export interface ReferenceRoundRecord {
  chainId: number;
  /** Proxy address, lowercase. */
  feed: string;
  underlying: string;
  /** Proxy round id: phase in the high 16 bits, the phase aggregator's round in the low 64. */
  roundId: bigint;
  answer: bigint;
  decimals: number;
  startedAt: number;
  updatedAt: number;
  answeredInRound: bigint;
}

export interface StoredRound {
  roundId: bigint;
  price: number;
  updatedAt: number;
}

/** Rounds of one feed in one time bucket: first, last, highest and lowest reading, each with its time. */
export interface ReferenceBucket {
  time: number;
  open: number;
  openAt: number;
  high: number;
  highAt: number;
  low: number;
  lowAt: number;
  close: number;
  closeAt: number;
  rounds: number;
}

/** Consecutive stored rounds of one phase whose aggregator round ids are not consecutive: rounds never ingested. */
export interface ReferenceHole {
  phaseId: number;
  afterRound: bigint;
  beforeRound: bigint;
  /** updatedAt of the rounds on either side: the readings in force over the hole are unknown. */
  from: number;
  to: number;
}

export interface MarketFillRecord {
  fillId: string;
  chainId: number;
  marketKey: string;
  seriesId: string;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  clearedAt: number;
  price: number;
  priceTicks: bigint;
  lots: bigint;
  side: "BUY" | "SELL";
  sideInferred: boolean;
  channel: "BOOK" | "RFQ" | "AUCTION" | "UNSPECIFIED";
  takerOrderHash: string;
  makerOrderHash: string;
  buyerAccountId: string;
  sellerAccountId: string;
}

export interface MarketPositionRecord {
  positionId: string;
  seriesId: string;
  remainingLots: bigint;
  open: boolean;
  updatedBlock: number;
}

export interface StreamCursor {
  stream: string;
  blockNumber: number | null;
  blockHash: string | null;
  payload: Record<string, unknown>;
  updatedAt: number;
}

/** Stores rounds (an existing round is never rewritten: a round's answer is final) and, with it, the stream's cursor. */
export async function upsertReferenceRounds(
  rounds: readonly ReferenceRoundRecord[],
  cursor?: { stream: string; payload: Record<string, unknown> },
): Promise<number> {
  const rows = rounds.map((round) => {
    const feed = round.feed.toLowerCase();
    if (!HEX_ADDRESS.test(feed)) throw new Error(`invalid feed ${round.feed}`);
    return {
      chain_id: round.chainId,
      feed,
      round_id: round.roundId.toString(),
      phase_id: Number(round.roundId / PHASE_SIZE),
      aggregator_round: (round.roundId % PHASE_SIZE).toString(),
      underlying: round.underlying,
      answer: round.answer.toString(),
      decimals: round.decimals,
      started_at: round.startedAt,
      updated_at: round.updatedAt,
      answered_in_round: round.answeredInRound.toString(),
    };
  });
  return database().begin(async (transaction) => {
    let inserted = 0;
    for (let index = 0; index < rows.length; index += 1_000) {
      const result = await transaction`
        insert into setryn.reference_rounds ${transaction(rows.slice(index, index + 1_000))}
        on conflict (chain_id, feed, round_id) do nothing
      `;
      inserted += result.count;
    }
    if (cursor) await writeCursor(transaction, SHARED_SCOPE, cursor.stream, null, null, cursor.payload);
    return inserted;
  }) as Promise<number>;
}

/** The newest and oldest stored round of a feed, and how many are stored. */
export async function referenceRoundBounds(
  chainId: number,
  feed: string,
): Promise<{ newest: StoredRound | null; oldest: StoredRound | null }> {
  const sql = database();
  const key = feed.toLowerCase();
  const [newest, oldest] = await Promise.all([
    sql<{ round_id: string; price: number; updated_at: string }[]>`
      select round_id, price, updated_at from setryn.reference_rounds
      where chain_id = ${chainId} and feed = ${key} order by round_id desc limit 1`,
    sql<{ round_id: string; price: number; updated_at: string }[]>`
      select round_id, price, updated_at from setryn.reference_rounds
      where chain_id = ${chainId} and feed = ${key} order by round_id asc limit 1`,
  ]);
  const round = (row: { round_id: string; price: number; updated_at: string } | undefined): StoredRound | null =>
    row ? { roundId: BigInt(row.round_id), price: row.price, updatedAt: Number(row.updated_at) } : null;
  return { newest: round(newest[0]), oldest: round(oldest[0]) };
}

/** Holes in a feed's stored rounds, oldest first. A bounded query includes both readings around the requested window. */
export async function referenceRoundHoles(
  chainId: number,
  feed: string,
  limit = 100,
  window?: { since: number; until: number },
): Promise<ReferenceHole[]> {
  const sql = database();
  const key = feed.toLowerCase();
  const rows = window
    ? await sql<
        { phase_id: number; aggregator_round: string; next_round: string; updated_at: string; next_updated_at: string }[]
      >`
        with windowed as (
          select phase_id, aggregator_round, round_id, updated_at
          from setryn.reference_rounds
          where chain_id = ${chainId} and feed = ${key}
            and updated_at >= ${window.since} and updated_at <= ${window.until}
          union all
          select * from (
            select phase_id, aggregator_round, round_id, updated_at
            from setryn.reference_rounds
            where chain_id = ${chainId} and feed = ${key} and updated_at < ${window.since}
            order by updated_at desc, round_id desc limit 1
          ) previous
          union all
          select * from (
            select phase_id, aggregator_round, round_id, updated_at
            from setryn.reference_rounds
            where chain_id = ${chainId} and feed = ${key} and updated_at > ${window.until}
            order by updated_at, round_id limit 1
          ) following
        )
        select phase_id, aggregator_round, next_round, updated_at, next_updated_at from (
          select phase_id, aggregator_round, updated_at,
            lead(aggregator_round) over (partition by phase_id order by aggregator_round) as next_round,
            lead(updated_at) over (partition by phase_id order by aggregator_round) as next_updated_at
          from windowed
        ) rounds
        where next_round is not null and next_round <> aggregator_round + 1
          and next_updated_at > ${window.since} and updated_at < ${window.until}
        order by updated_at
        limit ${limit}
      `
    : await sql<
        { phase_id: number; aggregator_round: string; next_round: string; updated_at: string; next_updated_at: string }[]
      >`
        select phase_id, aggregator_round, next_round, updated_at, next_updated_at from (
          select phase_id, aggregator_round, updated_at,
            lead(aggregator_round) over (partition by phase_id order by aggregator_round) as next_round,
            lead(updated_at) over (partition by phase_id order by aggregator_round) as next_updated_at
          from setryn.reference_rounds
          where chain_id = ${chainId} and feed = ${key}
        ) rounds
        where next_round is not null and next_round <> aggregator_round + 1
        order by updated_at
        limit ${limit}
      `;
  return rows.map((row) => ({
    phaseId: row.phase_id,
    afterRound: BigInt(row.aggregator_round),
    beforeRound: BigInt(row.next_round),
    from: Number(row.updated_at),
    to: Number(row.next_updated_at),
  }));
}

/**
 * A feed's rounds in `(since, until]` bucketed into `step`-second bars aligned to `anchor`, plus the reading in force at
 * `since` (the last round at or before it), which opens the first bar.
 */
export async function referenceBuckets(input: {
  chainId: number;
  feed: string;
  since: number;
  until: number;
  step: number;
  anchor?: number;
}): Promise<{ carry: StoredRound | null; buckets: ReferenceBucket[]; earliest: number | null }> {
  const sql = database();
  const feed = input.feed.toLowerCase();
  const anchor = input.anchor ?? 0;
  const [carry, buckets, earliest] = await Promise.all([
    sql<{ round_id: string; price: number; updated_at: string }[]>`
      select round_id, price, updated_at from setryn.reference_rounds
      where chain_id = ${input.chainId} and feed = ${feed} and updated_at <= ${input.since}
      order by updated_at desc, round_id desc limit 1`,
    sql<
      {
        bucket: string;
        rounds: string;
        open: number;
        open_at: string;
        close: number;
        close_at: string;
        high: number;
        high_at: string;
        low: number;
        low_at: string;
      }[]
    >`
      select bucket, count(*) as rounds,
        (array_agg(price order by updated_at, round_id))[1] as open,
        min(updated_at) as open_at,
        (array_agg(price order by updated_at desc, round_id desc))[1] as close,
        max(updated_at) as close_at,
        (array_agg(price order by price desc, updated_at))[1] as high,
        (array_agg(updated_at order by price desc, updated_at))[1] as high_at,
        (array_agg(price order by price asc, updated_at))[1] as low,
        (array_agg(updated_at order by price asc, updated_at))[1] as low_at
      from (
        select price, updated_at, round_id,
          floor((updated_at - ${anchor})::numeric / ${input.step}) * ${input.step} + ${anchor} as bucket
        from setryn.reference_rounds
        where chain_id = ${input.chainId} and feed = ${feed} and updated_at > ${input.since} and updated_at <= ${input.until}
      ) rounds
      group by bucket
      order by bucket`,
    sql<{ updated_at: string }[]>`
      select updated_at from setryn.reference_rounds
      where chain_id = ${input.chainId} and feed = ${feed} order by updated_at asc limit 1`,
  ]);
  return {
    carry: carry[0] ? { roundId: BigInt(carry[0].round_id), price: carry[0].price, updatedAt: Number(carry[0].updated_at) } : null,
    buckets: buckets.map((row) => ({
      time: Number(row.bucket),
      open: row.open,
      openAt: Number(row.open_at),
      high: row.high,
      highAt: Number(row.high_at),
      low: row.low,
      lowAt: Number(row.low_at),
      close: row.close,
      closeAt: Number(row.close_at),
      rounds: Number(row.rounds),
    })),
    earliest: earliest[0] ? Number(earliest[0].updated_at) : null,
  };
}

/** The reading in force at each requested time per feed: the last round at or before it. Unknown pairs are absent. */
export async function referenceSpotsAt(
  chainId: number,
  requests: readonly { feed: string; at: number }[],
): Promise<Map<string, StoredRound>> {
  const result = new Map<string, StoredRound>();
  if (requests.length === 0) return result;
  const feeds = requests.map((request) => request.feed.toLowerCase());
  const times = requests.map((request) => Math.floor(request.at));
  const rows = await database()<{ feed: string; at: string; round_id: string; price: number; updated_at: string }[]>`
    select q.feed, q.at, r.round_id, r.price, r.updated_at
    from unnest(${feeds}::text[], ${times}::bigint[]) as q(feed, at)
    cross join lateral (
      select round_id, price, updated_at from setryn.reference_rounds
      where chain_id = ${chainId} and feed = q.feed and updated_at <= q.at
      order by updated_at desc, round_id desc limit 1
    ) r
  `;
  for (const row of rows) {
    result.set(`${row.feed}:${row.at}`, { roundId: BigInt(row.round_id), price: row.price, updatedAt: Number(row.updated_at) });
  }
  return result;
}

/**
 * Applies one block range of a deployment's chain stream: its fills (a fill is final once stored), the latest state of
 * every position it touched, and the stream's cursor, in one transaction.
 */
export async function commitChainBatch(input: {
  scope?: string;
  deploymentKey: string;
  stream: string;
  fills: readonly MarketFillRecord[];
  positions: readonly MarketPositionRecord[];
  cursor: { blockNumber: number; blockHash: string; payload?: Record<string, unknown> };
}): Promise<void> {
  const scope = input.scope ?? databaseScope();
  const fills = input.fills.map((fill) => ({
    scope,
    deployment_key: input.deploymentKey,
    fill_id: fill.fillId.toLowerCase(),
    chain_id: fill.chainId,
    market_key: fill.marketKey,
    series_id: fill.seriesId.toLowerCase(),
    block_number: fill.blockNumber,
    block_hash: fill.blockHash.toLowerCase(),
    tx_hash: fill.txHash.toLowerCase(),
    log_index: fill.logIndex,
    cleared_at: fill.clearedAt,
    price: fill.price,
    price_ticks: fill.priceTicks.toString(),
    lots: fill.lots.toString(),
    side: fill.side,
    side_inferred: fill.sideInferred,
    channel: fill.channel,
    taker_order_hash: fill.takerOrderHash.toLowerCase(),
    maker_order_hash: fill.makerOrderHash.toLowerCase(),
    buyer_account_id: fill.buyerAccountId.toLowerCase(),
    seller_account_id: fill.sellerAccountId.toLowerCase(),
  }));
  const positions = input.positions.map((position) => ({
    scope,
    deployment_key: input.deploymentKey,
    position_id: position.positionId.toLowerCase(),
    series_id: position.seriesId.toLowerCase(),
    remaining_lots: position.remainingLots.toString(),
    open: position.open,
    updated_block: position.updatedBlock,
  }));
  await database().begin(async (transaction) => {
    for (let index = 0; index < fills.length; index += 500) {
      await transaction`
        insert into setryn.market_fills ${transaction(fills.slice(index, index + 500))}
        on conflict (scope, deployment_key, fill_id) do nothing
      `;
    }
    for (let index = 0; index < positions.length; index += 500) {
      await transaction`
        insert into setryn.market_positions ${transaction(positions.slice(index, index + 500))}
        on conflict (scope, deployment_key, position_id) do update
        set series_id = excluded.series_id, remaining_lots = excluded.remaining_lots, open = excluded.open,
          updated_block = excluded.updated_block
        where setryn.market_positions.updated_block <= excluded.updated_block
      `;
    }
    await writeCursor(transaction, scope, input.stream, input.cursor.blockNumber, input.cursor.blockHash.toLowerCase(), input.cursor.payload ?? {});
  });
}

/**
 * Drops everything a deployment's chain stream has stored, and its cursor, so the next run replays it from the start.
 * Used when the chain was reset or reorganized below the cursor: positions are a projection of every event since the
 * deployment, so they are rebuilt rather than patched.
 */
export async function resetChainStream(input: { scope?: string; deploymentKey: string; stream: string }): Promise<void> {
  const scope = input.scope ?? databaseScope();
  await database().begin(async (transaction) => {
    await transaction`delete from setryn.market_fills where scope = ${scope} and deployment_key = ${input.deploymentKey}`;
    await transaction`delete from setryn.market_positions where scope = ${scope} and deployment_key = ${input.deploymentKey}`;
    await transaction`delete from setryn.ingest_cursors where scope = ${scope} and stream = ${input.stream}`;
  });
}

export async function readStreamCursor(stream: string, scope: string = databaseScope()): Promise<StreamCursor | null> {
  if (!STREAM.test(stream)) throw new Error(`invalid Setryn ingest stream ${stream}`);
  const rows = await database()<
    { stream: string; block_number: string | null; block_hash: string | null; payload: Record<string, unknown>; updated_at: Date }[]
  >`select stream, block_number, block_hash, payload, updated_at from setryn.ingest_cursors where scope = ${scope} and stream = ${stream}`;
  return rows[0] ? cursorOf(rows[0]) : null;
}

/** Every stream's cursor in a scope, for health checks. */
export async function readStreamCursors(scope: string = databaseScope()): Promise<StreamCursor[]> {
  const rows = await database()<
    { stream: string; block_number: string | null; block_hash: string | null; payload: Record<string, unknown>; updated_at: Date }[]
  >`select stream, block_number, block_hash, payload, updated_at from setryn.ingest_cursors where scope = ${scope} order by stream`;
  return rows.map(cursorOf);
}

/** A deployment's fills, oldest first: every market's latest `limitPerMarket`, optionally one market and a time window. */
export async function readMarketFills(input: {
  scope?: string;
  deploymentKey: string;
  marketKey?: string;
  since?: number;
  until?: number;
  throughBlock?: number;
  limitPerMarket: number;
}): Promise<MarketFillRecord[]> {
  const scope = input.scope ?? databaseScope();
  const sql = database();
  const rows = await sql<
    {
      fill_id: string;
      chain_id: number;
      market_key: string;
      series_id: string;
      block_number: string;
      block_hash: string;
      tx_hash: string;
      log_index: number;
      cleared_at: string;
      price: number;
      price_ticks: string;
      lots: string;
      side: "BUY" | "SELL";
      side_inferred: boolean;
      channel: MarketFillRecord["channel"];
      taker_order_hash: string;
      maker_order_hash: string;
      buyer_account_id: string;
      seller_account_id: string;
    }[]
  >`
    select * from (
      select fills.*, row_number() over (partition by market_key order by cleared_at desc, block_number desc, log_index desc) as recency
      from setryn.market_fills fills
      where scope = ${scope} and deployment_key = ${input.deploymentKey}
        ${input.marketKey === undefined ? sql`` : sql`and market_key = ${input.marketKey}`}
        ${input.since === undefined ? sql`` : sql`and cleared_at >= ${input.since}`}
        ${input.until === undefined ? sql`` : sql`and cleared_at <= ${input.until}`}
        ${input.throughBlock === undefined ? sql`` : sql`and block_number <= ${input.throughBlock}`}
    ) ranked
    where recency <= ${input.limitPerMarket}
    order by cleared_at, block_number, log_index
  `;
  return rows.map((row) => ({
    fillId: row.fill_id,
    chainId: row.chain_id,
    marketKey: row.market_key,
    seriesId: row.series_id,
    blockNumber: Number(row.block_number),
    blockHash: row.block_hash,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    clearedAt: Number(row.cleared_at),
    price: row.price,
    priceTicks: BigInt(row.price_ticks),
    lots: BigInt(row.lots),
    side: row.side,
    sideInferred: row.side_inferred,
    channel: row.channel,
    takerOrderHash: row.taker_order_hash,
    makerOrderHash: row.maker_order_hash,
    buyerAccountId: row.buyer_account_id,
    sellerAccountId: row.seller_account_id,
  }));
}

/** A deployment's open positions: the ones that still count toward open interest. */
export async function readOpenPositions(input: { scope?: string; deploymentKey: string }): Promise<MarketPositionRecord[]> {
  const scope = input.scope ?? databaseScope();
  const rows = await database()<{ position_id: string; series_id: string; remaining_lots: string; open: boolean; updated_block: string }[]>`
    select position_id, series_id, remaining_lots, open, updated_block from setryn.market_positions
    where scope = ${scope} and deployment_key = ${input.deploymentKey} and open
  `;
  return rows.map((row) => ({
    positionId: row.position_id,
    seriesId: row.series_id,
    remainingLots: BigInt(row.remaining_lots),
    open: row.open,
    updatedBlock: Number(row.updated_block),
  }));
}

async function writeCursor(
  sql: Sql | postgres.TransactionSql,
  scope: string,
  stream: string,
  blockNumber: number | null,
  blockHash: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!NAME.test(scope)) throw new Error(`invalid Setryn database scope ${scope}`);
  if (!STREAM.test(stream)) throw new Error(`invalid Setryn ingest stream ${stream}`);
  await sql`
    insert into setryn.ingest_cursors (scope, stream, block_number, block_hash, payload, updated_at)
    values (${scope}, ${stream}, ${blockNumber}, ${blockHash}, ${sql.json(payload as never)}, now())
    on conflict (scope, stream) do update
    set block_number = excluded.block_number, block_hash = excluded.block_hash, payload = excluded.payload, updated_at = now()
    where setryn.ingest_cursors.block_number is distinct from excluded.block_number
      or setryn.ingest_cursors.block_hash is distinct from excluded.block_hash
      or setryn.ingest_cursors.payload is distinct from excluded.payload
      or setryn.ingest_cursors.updated_at < now() - interval '60 seconds'
  `;
}

function cursorOf(row: {
  stream: string;
  block_number: string | null;
  block_hash: string | null;
  payload: Record<string, unknown>;
  updated_at: Date;
}): StreamCursor {
  return {
    stream: row.stream,
    blockNumber: row.block_number === null ? null : Number(row.block_number),
    blockHash: row.block_hash,
    payload: row.payload ?? {},
    updatedAt: Math.floor(new Date(row.updated_at).getTime() / 1000),
  };
}

function validateNames(collection: string, documentKey: string): void {
  if (!NAME.test(collection)) throw new Error(`invalid Setryn database collection ${collection}`);
  if (!KEY.test(documentKey)) throw new Error(`invalid Setryn database document key ${documentKey}`);
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("SETRYN_DATABASE_POOL_SIZE must be an integer from 1 to 50");
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
