-- Market data the platform computes every mark, chart and statistic from. Only observed facts are stored, keyed by their
-- chain identity, so every write is an idempotent upsert and any table can be rebuilt from chain: Chainlink rounds,
-- clearing fills, the position quantities behind open interest, and each ingest stream's cursor. Derived values (marks,
-- candles) are computed on read under a versioned methodology and are never stored. The market-data ingester
-- (services/market-data) is the only writer; the web app reads. Server-only: nothing here is exposed through PostgREST.

create schema if not exists setryn;

-- Chainlink aggregator rounds, read from the feed's proxy. round_id is the proxy round id: phase_id in the high 16 bits
-- and the phase aggregator's own round in the low 64, consecutive within a phase.
create table if not exists setryn.reference_rounds (
  chain_id integer not null check (chain_id > 0),
  feed text not null check (feed ~ '^0x[0-9a-f]{40}$'),
  round_id numeric(30, 0) not null check (round_id > 0),
  phase_id integer not null check (phase_id > 0),
  aggregator_round numeric(20, 0) not null check (aggregator_round > 0),
  underlying text not null check (underlying ~ '^[A-Z0-9/]{1,24}$'),
  answer numeric(78, 0) not null,
  decimals smallint not null check (decimals between 0 and 36),
  started_at bigint not null check (started_at >= 0),
  updated_at bigint not null check (updated_at > 0),
  answered_in_round numeric(30, 0) not null,
  price double precision generated always as ((answer / power(10::numeric, decimals))::double precision) stored,
  ingested_at timestamptz not null default now(),
  primary key (chain_id, feed, round_id),
  check (round_id = phase_id::numeric * 18446744073709551616 + aggregator_round)
);

create index if not exists reference_rounds_feed_time on setryn.reference_rounds (chain_id, feed, updated_at, round_id);

-- Fills cleared by the deployment's AtomicClearingEngine (FillCleared), one row per fill. deployment_key names the
-- contract set the fill belongs to (chain id and the clearing, position and book addresses), so a redeployment starts a
-- new history instead of mixing two.
create table if not exists setryn.market_fills (
  scope text not null check (scope ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  deployment_key text not null check (deployment_key ~ '^[0-9]+(:0x[0-9a-f]{40}){3}$'),
  fill_id text not null check (fill_id ~ '^0x[0-9a-f]{64}$'),
  chain_id integer not null check (chain_id > 0),
  market_key text not null check (market_key ~ '^[A-Za-z0-9._-]{1,64}$'),
  series_id text not null check (series_id ~ '^0x[0-9a-f]{64}$'),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  cleared_at bigint not null check (cleared_at > 0),
  price double precision not null,
  price_ticks numeric(78, 0) not null,
  lots numeric(39, 0) not null check (lots > 0),
  -- The aggressor: a buy lifted an offer. side_inferred marks a side taken from the tick rule because neither order
  -- was public.
  side text not null check (side in ('BUY', 'SELL')),
  side_inferred boolean not null,
  channel text not null check (channel in ('BOOK', 'RFQ', 'AUCTION', 'UNSPECIFIED')),
  taker_order_hash text not null check (taker_order_hash ~ '^0x[0-9a-f]{64}$'),
  maker_order_hash text not null check (maker_order_hash ~ '^0x[0-9a-f]{64}$'),
  buyer_account_id text not null check (buyer_account_id ~ '^0x[0-9a-f]{64}$'),
  seller_account_id text not null check (seller_account_id ~ '^0x[0-9a-f]{64}$'),
  ingested_at timestamptz not null default now(),
  primary key (scope, deployment_key, fill_id)
);

create index if not exists market_fills_market_time on setryn.market_fills (scope, deployment_key, market_key, cleared_at);
create index if not exists market_fills_block on setryn.market_fills (scope, deployment_key, block_number);

-- Position quantities from the PositionEngine (PositionCreated, PositionQuantityChanged, PositionStatusChanged): the
-- projection open interest is summed from.
create table if not exists setryn.market_positions (
  scope text not null check (scope ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  deployment_key text not null check (deployment_key ~ '^[0-9]+(:0x[0-9a-f]{40}){3}$'),
  position_id text not null check (position_id ~ '^0x[0-9a-f]{64}$'),
  series_id text not null check (series_id ~ '^0x[0-9a-f]{64}$'),
  remaining_lots numeric(39, 0) not null check (remaining_lots >= 0),
  open boolean not null,
  updated_block bigint not null check (updated_block >= 0),
  primary key (scope, deployment_key, position_id)
);

create index if not exists market_positions_series on setryn.market_positions (scope, deployment_key, series_id) where open;

-- Where each ingest stream has read up to. A chain stream records the last applied block and its hash, so a reorg or a
-- reset chain is detected on the next run; a reference stream records its heartbeat. A stream's rows and its cursor are
-- written in one transaction, so a cursor never runs ahead of the data.
create table if not exists setryn.ingest_cursors (
  scope text not null check (scope ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  stream text not null check (stream ~ '^[a-z0-9][a-z0-9.:_-]{0,255}$'),
  block_number bigint,
  block_hash text check (block_hash is null or block_hash ~ '^0x[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (scope, stream)
);

revoke all on setryn.reference_rounds, setryn.market_fills, setryn.market_positions, setryn.ingest_cursors
  from public, anon, authenticated;
grant usage on schema setryn to postgres;
grant select, insert, update, delete on setryn.reference_rounds, setryn.market_fills, setryn.market_positions,
  setryn.ingest_cursors to postgres;

comment on table setryn.reference_rounds is 'Chainlink aggregator rounds per feed; the observed input of every mark.';
comment on table setryn.market_fills is 'Clearing fills per deployment; markers, volume and the mark basis read these.';
comment on table setryn.market_positions is 'Position quantities per deployment; open interest is summed from these.';
comment on table setryn.ingest_cursors is 'Progress and heartbeat of each market-data ingest stream.';
