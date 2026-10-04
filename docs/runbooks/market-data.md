# Market data: AWS Postgres store and ingester

The platform prices every expiry with one mark ([methodology](../specs/setryn-mark-methodology.md)) computed from
observed inputs: Chainlink rounds and the deployment's fills. This runbook covers where those inputs are stored, the
worker that stores them, and how the web app reads them.

```
Arbitrum One (read-only)          deployment chain (Sepolia / devnet)
  Chainlink proxies                 AtomicClearingEngine, PositionEngine
        \                             /
         market-data ingester (AWS, long-running, no keys)
                       |
                   AWS RDS Postgres  (schema setryn, server-only)
                       |
                 web app (reads; falls back to chain on its own)
```

## What is stored

Migration `supabase/migrations/20261003000100_market_data.sql`:

| Table | Rows | Key |
| --- | --- | --- |
| `setryn.reference_rounds` | Every Chainlink round per feed: answer, decimals, times | chain, feed, proxy round id |
| `setryn.market_fills` | Every `FillCleared` of the deployment: price, lots, aggressor side, channel, accounts | scope, deployment key, fill id |
| `setryn.market_positions` | Latest quantity and open flag of every position | scope, deployment key, position id |
| `setryn.ingest_cursors` | Each stream's last block and hash, or its heartbeat | scope, stream |

Only observed facts are stored. Marks and candles are computed on read under the methodology version and parameter set
effective at each timestamp. Updating the live model does not rewrite historical marks. Every write is an idempotent
upsert keyed by chain identity, and a stream's rows commit together with its cursor.

The deployment key is the chain id plus the clearing, position and book addresses. A redeployment gets a new key and
starts its own history. Scope is the network name (`local`, `arbitrum-sepolia`); reference rounds and their cursors
use the scope `shared` because they come from Arbitrum One whatever the deployment.

## 1. AWS RDS Postgres

Use an encrypted PostgreSQL instance with TLS required and automated backups. Apply the provider-independent SQL
migrations with `psql`:

```bash
psql "$SETRYN_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261001000100_runtime_documents.sql
psql "$SETRYN_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261003000100_market_data.sql
```

The `setryn` schema is not exposed through PostgREST, and `anon` and `authenticated` have no grants. Only server code
with the database URL reads or writes it.

## 2. The ingester on AWS

It reads chains and writes Postgres, holds no private key and signs nothing. One `t4g.nano` or `t4g.micro` (or the host
that runs the operator timer) is enough. It needs Node 22 and the repository checked out at
`/home/ubuntu/setryn`, with `pnpm install --frozen-lockfile`.

```bash
sudo install -d -m 0750 -o ubuntu -g ubuntu /etc/setryn
sudo install -m 0600 -o ubuntu -g ubuntu deploy/systemd/market-data.env.example /etc/setryn/market-data.env
sudoedit /etc/setryn/market-data.env   # database URL, Sepolia RPC, Arbitrum One RPC

sudo cp deploy/systemd/setryn-market-data.service deploy/systemd/setryn-market-data-health.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now setryn-market-data.service setryn-market-data-health.timer
```

Each pass, every 15 seconds by default:

1. **Reference rounds.** For each feed, reads every round published since the newest stored one. It finishes an
   earlier aggregator phase through the proxy's `phaseAggregators` before starting the next. It then walks older rounds
   until the history reaches `SETRYN_INGEST_BACKFILL_DAYS`, and repairs any hole between stored rounds. A pass reads at
   most 5,000 rounds per feed, so a long backfill spreads over several passes and runs back to back until it is done.
2. **Fills and positions.** From the deployment's start block, or the cursor, up to `SETRYN_INGEST_CONFIRMATIONS`
   blocks behind the head. Logs are applied in ranges, and each range commits with the cursor. If the cursor's block
   hash no longer matches the chain (a reset or reorg), or the stream started at a different block, that deployment's
   rows are dropped and replayed from the start. Positions are a projection of every event, so they are rebuilt, never
   patched.

A restart, a crash or a second instance loses nothing: the streams resume from their cursors, and a duplicate instance
only repeats idempotent writes. Run one anyway.

One-off backfill or a single pass from a laptop:

```bash
SETRYN_DATABASE_URL=... SETRYN_RPC_URL=... SETRYN_REFERENCE_RPC_URL=... \
pnpm --filter @setryn/market-data-ingester ingest --environment arbitrum-sepolia --once --backfill-days 365 --max-rounds 50000
```

### Health

```bash
systemctl status setryn-market-data.service
journalctl -u setryn-market-data.service -n 50        # one JSON line per event
pnpm --filter @setryn/market-data-ingester ingest --environment arbitrum-sepolia --health --max-age-seconds 300
```

`--health` prints every expected stream's age and exits 1 when any is older than the limit. The timer runs it every
five minutes, so a stalled ingester shows as a failed `setryn-market-data-health.service`. Point a CloudWatch alarm at
that unit's failures, or at the journal's `"ok":false` lines.

## 3. The web app

Set `SETRYN_DATABASE_URL` on the host and Vercel. Keep the Vercel pool size at one because each serverless instance can
create its own database client. With it:

- **Cold starts.** A cold server instance loads the stored fills, open positions and cursor, checks that the cursor's
  block is still on its chain, and scans only the blocks after it. This fixes the partial trade history and open
  interest a fresh serverless instance used to show. The server logs `seeded N fills ... from the database at block B`.
- **Chart history** comes from the stored rounds. The candles response says so: `history.source` is `DATABASE`.
- **Past readings** (the 24h prior mark, the reading at expiry, the spot at each fill for the basis) come from the
  stored rounds.

Without the variable, or for 30 seconds after a database error, the app reads everything from chain as before.
History is then limited to what this server has read, and the response says `MEMORY`. The app never writes to the
store; the ingester is the only writer.

## Failure modes

| What fails | Effect | Recovery |
| --- | --- | --- |
| Ingester stopped | Stored history stops growing. The app still scans new blocks itself after the stored cursor. Health check fails after five minutes | Restart the service. It catches up from its cursors |
| Database unreachable | The app falls back to chain reads and memory history, retrying every 30 s | None needed |
| Arbitrum One RPC down | No new rounds. The header mark keeps the last reading. Bars after a feed's heartbeat plus an hour are drawn as gaps | Fix the RPC. Rounds are permanent, so the next pass fills the hole |
| Chainlink feed stale | Bars whose reading is older than the heartbeat plus an hour are gaps, never a carried price | None needed |
| Redeployment | New deployment key, new history. Old rows stay under the old key | None needed |
| Devnet reset (same addresses) | The cursor hash no longer matches, so the stream is dropped and replayed | Automatic |

## Changing the mark

Inputs (volatility, rate, carry, basis parameters) change by publishing a new parameter set in
`apps/web/src/lib/pricing/mark.ts` with a new id and effective date. A formula change bumps `MARK_METHODOLOGY_VERSION`.
The registry is append-only. Every mark selects the newest set effective at its own evaluation timestamp, so publishing
a set changes marks from that time forward and never repaints earlier candles. Keep the implementation of every
published methodology version available for deterministic reconstruction, and record each change in the methodology
document.
