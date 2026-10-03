import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { arbitrum } from "viem/chains";
import { REFERENCE_CHAIN_ID, REFERENCE_FEEDS } from "@setryn/market-data";
import type { ReferenceQuote } from "./types";

/*
 * Chainlink reference prices for the listed underlyings, read from the aggregators on Arbitrum One. Reads are eth_call
 * only. The feeds are the ones the listing generator strikes markets against (scripts/generate-network-markets.mjs).
 */

// One list of feeds for the app and the ingester (packages/market-data).
export { REFERENCE_CHAIN_ID, REFERENCE_FEEDS };

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const DECIMALS = 8;
const CACHE_MS = 5_000;

let client: PublicClient | null = null;
let cached: { at: number; quotes: Record<string, ReferenceQuote> } | null = null;
let inflight: Promise<Record<string, ReferenceQuote>> | null = null;

/** Arbitrum One RPC for reference reads; `SETRYN_REFERENCE_RPC_URL` overrides the public endpoint. */
export function referenceRpcUrl(): string {
  return process.env.SETRYN_REFERENCE_RPC_URL ?? "https://arb1.arbitrum.io/rpc";
}

export function referenceClient(): PublicClient {
  client ??= createPublicClient({ chain: arbitrum, transport: http(referenceRpcUrl(), { timeout: 8_000 }) }) as PublicClient;
  return client;
}

function toQuote(underlying: string, feed: Address, round: readonly [bigint, bigint, bigint, bigint, bigint]): ReferenceQuote | null {
  const [roundId, answer, , updatedAt] = round;
  if (answer <= BigInt(0) || updatedAt === BigInt(0)) return null;
  return {
    underlying,
    price: Number(answer) / 10 ** DECIMALS,
    updatedAt: Number(updatedAt),
    roundId: roundId.toString(),
    source: "chainlink",
    feed,
    chainId: REFERENCE_CHAIN_ID,
  };
}

/**
 * The latest reading of every requested underlying (all listed ones by default), cached for five seconds per server.
 * An underlying whose aggregator cannot be read is left out rather than filled with a stale or invented value.
 */
export async function readReferenceQuotes(underlyings: string[] = Object.keys(REFERENCE_FEEDS)): Promise<Record<string, ReferenceQuote>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return pick(cached.quotes, underlyings);
  inflight ??= (async () => {
    const entries = Object.entries(REFERENCE_FEEDS);
    const results = await referenceClient().multicall({
      contracts: entries.map(([, feed]) => ({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" }) as const),
      allowFailure: true,
    });
    const quotes: Record<string, ReferenceQuote> = {};
    results.forEach((result, index) => {
      if (result.status !== "success") return;
      const [underlying, feed] = entries[index];
      const quote = toQuote(underlying, feed, result.result as readonly [bigint, bigint, bigint, bigint, bigint]);
      if (quote) quotes[underlying] = quote;
    });
    cached = { at: Date.now(), quotes };
    return quotes;
  })().finally(() => {
    inflight = null;
  });
  return pick(await inflight, underlyings);
}

function pick(quotes: Record<string, ReferenceQuote>, underlyings: string[]): Record<string, ReferenceQuote> {
  return Object.fromEntries(underlyings.filter((key) => quotes[key]).map((key) => [key, quotes[key]]));
}

/**
 * The aggregator answer in force at `timestamp`: walks rounds back from the latest until one updated at or before it.
 * Used for reference history and for fixings. Returns null when no round in the last `maxRounds` qualifies.
 */
export async function referenceAt(underlying: string, timestamp: number, maxRounds = 400): Promise<ReferenceQuote | null> {
  const feed = REFERENCE_FEEDS[underlying];
  if (!feed) return null;
  const latest = await referenceClient().readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" });
  if (Number(latest[3]) <= timestamp) return toQuote(underlying, feed, latest);
  // Proxy round ids carry the phase in the high 16 bits; within one phase the aggregator round ids are consecutive.
  let roundId = latest[0];
  for (let step = 0; step < maxRounds; step += 1) {
    roundId -= BigInt(1);
    if ((roundId & BigInt("0xFFFFFFFFFFFFFFFF")) === BigInt(0)) return null;
    const round = await referenceClient()
      .readContract({ address: feed, abi: aggregatorAbi, functionName: "getRoundData", args: [roundId] })
      .catch(() => null);
    if (!round) return null;
    if (Number(round[3]) <= timestamp) return toQuote(underlying, feed, round);
  }
  return null;
}
