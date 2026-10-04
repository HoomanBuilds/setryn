import { readFile } from "node:fs/promises";

import { createPublicClient, fallback, http, type Address, type PublicClient } from "viem";
import { arbitrum } from "viem/chains";

import { deploymentKey, deploymentStartBlock, fillStream, REFERENCE_CHAIN_ID, REFERENCE_FEEDS, referenceStream } from "@setryn/market-data";
import { loadOperatorDeployment } from "@setryn/operator-runtime";
import { closeDatabase, databaseConfigured, readStreamCursors, SHARED_SCOPE } from "@setryn/persistence";

import { parseArguments, resolveIngestConfig } from "../config.ts";
import { ingestFills } from "../fills.ts";
import { ingestReferenceFeed } from "../reference.ts";

/**
 * Market-data ingester: keeps setryn.reference_rounds, market_fills, market_positions and ingest_cursors current.
 *
 *   node --experimental-strip-types services/market-data-ingester/src/bin/ingest.ts \
 *     [--environment local|arbitrum-sepolia] [--once] [--only reference|fills] [--interval-seconds 15] \
 *     [--backfill-days 30] [--max-rounds 5000] [--confirmations 3] [--chunk-blocks 9000] [--max-chunks 40]
 *   ... ingest.ts --health [--max-age-seconds 300]
 *
 * It runs passes until stopped (SIGTERM or SIGINT finish the current pass), each pass reading new Chainlink rounds,
 * backfilling older ones toward --backfill-days, repairing holes, and applying the deployment's new fills and position
 * changes. Every stream resumes from its database cursor, so a restart, a crash or a second instance loses nothing
 * (two instances only repeat idempotent writes). --health prints every cursor's age and exits 1 when any is older than
 * --max-age-seconds. Needs SETRYN_DATABASE_URL; reads SETRYN_RPC_URL (required for arbitrum-sepolia) and
 * SETRYN_REFERENCE_RPC_URL (default https://arb1.arbitrum.io/rpc). Writes nothing to any chain.
 */

const args = parseArguments(process.argv.slice(2));
const config = resolveIngestConfig(args);
if (!databaseConfigured()) throw new Error("SETRYN_DATABASE_URL is not configured");

function log(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : String(error);
}

if (args.get("health") === "true") {
  const maxAge = Number(args.get("max-age-seconds") ?? 300);
  const deployment = await loadOperatorDeployment({ runtimePath: config.runtimePath, manifestPath: config.manifestPath, expectedChainId: config.chainId });
  const fills = fillStream(
    deploymentKey({
      chainId: deployment.chainId,
      atomicClearingEngine: deployment.addresses.atomicClearingEngine,
      positionEngine: deployment.addresses.positionEngine,
      publicOrderBook: deployment.addresses.publicOrderBook,
    }),
  );
  const expected = [
    { scope: config.scope, stream: fills },
    ...Object.values(REFERENCE_FEEDS).map((feed) => ({ scope: SHARED_SCOPE, stream: referenceStream(REFERENCE_CHAIN_ID, feed) })),
  ];
  const cursors = [...(await readStreamCursors(config.scope)), ...(await readStreamCursors(SHARED_SCOPE))];
  const now = Math.floor(Date.now() / 1000);
  let healthy = true;
  for (const { scope, stream } of expected) {
    const cursor = cursors.find((candidate) => candidate.stream === stream);
    const age = cursor ? now - cursor.updatedAt : null;
    const ok = age !== null && age <= maxAge;
    healthy &&= ok;
    log({ event: "health", scope, stream, ok, ageSeconds: age, blockNumber: cursor?.blockNumber ?? null, payload: cursor?.payload ?? null });
  }
  await closeDatabase();
  process.exit(healthy ? 0 : 1);
}

const deployment = await loadOperatorDeployment({ runtimePath: config.runtimePath, manifestPath: config.manifestPath, expectedChainId: config.chainId });
// The same start block the web app scans from, so its open interest and the stored one agree.
const startBlock = BigInt(
  deploymentStartBlock(
    JSON.parse(await readFile(config.runtimePath, "utf8")) as { deploymentBlock?: unknown },
    JSON.parse(await readFile(config.manifestPath, "utf8")),
  ) ?? deployment.deploymentBlock,
);
const chainTransports = config.rpcUrls.map((url) => http(url, {
  timeout: 15_000,
  retryCount: 0,
  batch: config.rpcUrls.length === 1 ? { batchSize: 64, wait: 4 } : false,
}));
const chain = createPublicClient({
  transport: chainTransports.length === 1 ? chainTransports[0] : fallback(chainTransports, { rank: false, retryCount: 0 }),
}) as PublicClient;
const reference = createPublicClient({ chain: arbitrum, transport: http(config.referenceRpcUrl, { timeout: 15_000 }) }) as PublicClient;
const observedChainId = await chain.getChainId();
if (observedChainId !== deployment.chainId) throw new Error(`RPC is chain ${observedChainId}, the deployment is chain ${deployment.chainId}`);
const observedReference = await reference.getChainId();
if (observedReference !== REFERENCE_CHAIN_ID) throw new Error(`reference RPC is chain ${observedReference}, expected ${REFERENCE_CHAIN_ID}`);

const only = args.get("only");
if (only !== undefined && only !== "reference" && only !== "fills") throw new Error("--only must be reference or fills");
const once = args.get("once") === "true";
let stopping = false;
let wake: (() => void) | null = null;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
    log({ event: "stopping", signal });
  });
}

log({
  event: "start",
  environment: config.environment,
  scope: config.scope,
  chainId: deployment.chainId,
  startBlock: startBlock.toString(),
  markets: deployment.markets.length,
  feeds: Object.keys(REFERENCE_FEEDS),
  backfillDays: config.backfillDays,
  confirmations: config.confirmations,
});

async function pass(): Promise<boolean> {
  let busy = false;
  if (only !== "fills") {
    const backfillTo = Math.floor((Math.floor(Date.now() / 1000) - config.backfillDays * 86_400) / 86_400) * 86_400;
    for (const [underlying, feed] of Object.entries(REFERENCE_FEEDS)) {
      if (stopping) break;
      try {
        const result = await ingestReferenceFeed(reference, underlying, feed as Address, { backfillTo, maxRounds: config.maxRoundsPerFeed });
        busy ||= !result.backfilled || result.holes > 0;
        if (result.inserted > 0 || !result.backfilled || result.holes > 0) log({ event: "reference", ...result });
      } catch (error) {
        log({ event: "reference-error", underlying, error: message(error) });
      }
    }
  }
  if (only !== "reference" && !stopping) {
    try {
      const result = await ingestFills(chain, deployment, {
        scope: config.scope,
        startBlock,
        confirmations: config.confirmations,
        chunkBlocks: config.chunkBlocks,
        maxChunks: config.maxChunks,
      });
      busy ||= !result.caughtUp;
      if (result.fills > 0 || result.positions > 0 || result.reset || !result.caughtUp) log({ event: "fills", ...result });
    } catch (error) {
      log({ event: "fills-error", error: message(error) });
    }
  }
  return busy;
}

while (!stopping) {
  const busy = await pass();
  if (once || stopping) break;
  // A backlog (backfill, holes, a long block range) continues at once; otherwise wait for new data.
  if (!busy) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.intervalSeconds * 1_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  }
}
await closeDatabase();
log({ event: "stopped" });
