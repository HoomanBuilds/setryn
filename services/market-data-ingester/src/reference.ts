import type { Address, PublicClient } from "viem";

import {
  aggregatorProxyAbi,
  aggregatorRoundOf,
  PHASE_SIZE,
  phaseLastRound,
  phaseOf,
  readLatestRound,
  readRoundRange,
  REFERENCE_CHAIN_ID,
  referenceStream,
  type ChainlinkRound,
} from "@setryn/market-data";
import { referenceRoundBounds, referenceRoundHoles, upsertReferenceRounds, type ReferenceRoundRecord } from "@setryn/persistence";

/*
 * Chainlink rounds of one reference feed into setryn.reference_rounds. Each pass reads, in order: everything published
 * since the newest stored round (finishing an earlier phase before starting the next), older rounds until the stored
 * history reaches the backfill target or the feed's first phase, and any holes left between stored rounds. A pass reads
 * at most `maxRounds`, so a long backfill spreads over several passes; rounds are final once published, so every write
 * is an idempotent insert and a pass can stop anywhere.
 */

const ONE = BigInt(1);
const BACKWARD_BATCH = 500;
const HOLE_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const lastHoleScans = new Map<string, number>();

export interface ReferencePassOptions {
  /** Unix seconds the stored history should reach back to. */
  backfillTo: number;
  /** Most rounds read for this feed in one pass. */
  maxRounds: number;
}

export interface ReferencePassResult {
  underlying: string;
  feed: string;
  latestRound: string;
  latestAt: number;
  read: number;
  inserted: number;
  oldestAt: number | null;
  /** The stored history reaches the backfill target, or the feed has nothing older. */
  backfilled: boolean;
  holes: number;
}

const decimalsCache = new Map<string, number>();

async function feedDecimals(client: PublicClient, feed: Address): Promise<number> {
  const key = feed.toLowerCase();
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;
  const decimals = Number(await client.readContract({ address: feed, abi: aggregatorProxyAbi, functionName: "decimals" }));
  decimalsCache.set(key, decimals);
  return decimals;
}

function bigMin(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function bigMax(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function record(underlying: string, feed: Address, decimals: number, round: ChainlinkRound): ReferenceRoundRecord {
  return {
    chainId: REFERENCE_CHAIN_ID,
    feed: feed.toLowerCase(),
    underlying,
    roundId: round.roundId,
    answer: round.answer,
    decimals,
    startedAt: round.startedAt,
    updatedAt: round.updatedAt,
    answeredInRound: round.answeredInRound,
  };
}

export async function ingestReferenceFeed(
  client: PublicClient,
  underlying: string,
  feed: Address,
  options: ReferencePassOptions,
): Promise<ReferencePassResult> {
  const decimals = await feedDecimals(client, feed);
  const latest = await readLatestRound(client, feed);
  if (!latest) throw new Error(`REFERENCE_LATEST_UNREADABLE:${underlying}`);
  const bounds = await referenceRoundBounds(REFERENCE_CHAIN_ID, feed);
  let budget = options.maxRounds;
  let read = 1;
  let holeRisk = false;
  const collected: ChainlinkRound[] = !bounds.newest || bounds.newest.roundId < latest.roundId ? [latest] : [];

  // Forward: every round since the newest stored one. An earlier phase is read to its last round before the next phase
  // starts at its first; a pass that runs out of budget leaves a hole that the next pass repairs.
  if (bounds.newest && bounds.newest.roundId < latest.roundId) {
    const latestPhase = phaseOf(latest.roundId);
    let next = bounds.newest.roundId + ONE;
    while (budget > 0 && next < latest.roundId) {
      const phase = phaseOf(next);
      const phaseEnd = phase === latestPhase ? latest.roundId - ONE : ((await phaseLastRound(client, feed, phase)) ?? next - ONE);
      if (phaseEnd >= next) {
        const to = bigMin(phaseEnd, next + BigInt(budget) - ONE);
        const rounds = await readRoundRange(client, feed, to, next);
        collected.push(...rounds);
        const count = Number(to - next + ONE);
        holeRisk ||= rounds.length !== count;
        budget -= count;
        read += count;
        next = to + ONE;
        if (to < phaseEnd) break;
      }
      next = BigInt(phase + 1) * PHASE_SIZE + ONE;
    }
  }

  // Backward: older rounds until the history reaches the target or the feed's first phase.
  let oldestRound = bounds.oldest?.roundId ?? latest.roundId;
  let oldestAt = bounds.oldest?.updatedAt ?? latest.updatedAt;
  let exhausted = false;
  while (budget > 0 && oldestAt > options.backfillTo) {
    let from: bigint;
    if (aggregatorRoundOf(oldestRound) > ONE) {
      from = oldestRound - ONE;
    } else {
      const previous = await phaseLastRound(client, feed, phaseOf(oldestRound) - 1);
      if (previous === null) {
        exhausted = true;
        break;
      }
      from = previous;
    }
    const phaseStart = BigInt(phaseOf(from)) * PHASE_SIZE + ONE;
    const to = bigMax(phaseStart, from - BigInt(Math.min(budget, BACKWARD_BATCH)) + ONE);
    const rounds = await readRoundRange(client, feed, from, to);
    const count = Number(from - to + ONE);
    holeRisk ||= rounds.length !== count;
    budget -= count;
    read += count;
    if (rounds.length === 0) break;
    collected.push(...rounds);
    oldestRound = to;
    oldestAt = Math.min(oldestAt, ...rounds.map((round) => round.updatedAt));
  }

  const stream = referenceStream(REFERENCE_CHAIN_ID, feed);
  const heartbeat = (holes: number) => ({
    stream,
    payload: {
      underlying,
      latestRound: latest.roundId.toString(),
      latestAt: latest.updatedAt,
      oldestAt,
      backfillTo: options.backfillTo,
      backfilled: exhausted || oldestAt <= options.backfillTo,
      holes,
    },
  });
  let inserted = collected.length > 0
    ? await upsertReferenceRounds(collected.map((round) => record(underlying, feed, decimals, round)))
    : 0;

  // A full history-wide hole scan is expensive. Run it while backfilling, after an incomplete RPC range, at startup,
  // and periodically thereafter. Normal forward ingestion is consecutive and transactional.
  const feedKey = feed.toLowerCase();
  const now = Date.now();
  const shouldScanHoles =
    oldestAt > options.backfillTo || holeRisk || now - (lastHoleScans.get(feedKey) ?? 0) >= HOLE_SCAN_INTERVAL_MS;
  const holes = shouldScanHoles ? await referenceRoundHoles(REFERENCE_CHAIN_ID, feed, 20) : [];
  if (shouldScanHoles) lastHoleScans.set(feedKey, now);
  const repaired: ChainlinkRound[] = [];
  for (const hole of holes) {
    if (budget <= 0) break;
    const base = BigInt(hole.phaseId) * PHASE_SIZE;
    const from = base + hole.beforeRound - ONE;
    const to = bigMax(base + hole.afterRound + ONE, from - BigInt(budget) + ONE);
    if (from < to) continue;
    repaired.push(...(await readRoundRange(client, feed, from, to)));
    const count = Number(from - to + ONE);
    budget -= count;
    read += count;
  }
  if (repaired.length > 0) {
    inserted += await upsertReferenceRounds(repaired.map((round) => record(underlying, feed, decimals, round)));
  }
  const remaining = repaired.length > 0 ? (await referenceRoundHoles(REFERENCE_CHAIN_ID, feed, 1_000)).length : holes.length;
  await upsertReferenceRounds([], heartbeat(remaining));

  return {
    underlying,
    feed: feed.toLowerCase(),
    latestRound: latest.roundId.toString(),
    latestAt: latest.updatedAt,
    read,
    inserted,
    oldestAt,
    backfilled: exhausted || oldestAt <= options.backfillTo,
    holes: remaining,
  };
}
