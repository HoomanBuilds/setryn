import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Configuration of the market-data ingester. It only reads chains: the deployment's chain for fills and positions, and
 * Arbitrum One for Chainlink rounds (eth_call only). It holds no key and signs nothing.
 */

export type IngestEnvironment = "local" | "arbitrum-sepolia";

export const INGEST_CHAIN_IDS: Readonly<Record<IngestEnvironment, number>> = { local: 31337, "arbitrum-sepolia": 421614 };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface IngestConfig {
  environment: IngestEnvironment;
  /** Database scope of the deployment's rows: the network name, as the web app's SETRYN_NETWORK. */
  scope: string;
  chainId: number;
  rpcUrl: string;
  referenceRpcUrl: string;
  runtimePath: string;
  manifestPath: string;
  confirmations: number;
  chunkBlocks: number;
  maxChunks: number;
  intervalSeconds: number;
  backfillDays: number;
  maxRoundsPerFeed: number;
}

function integer(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

export function resolveIngestConfig(
  args: ReadonlyMap<string, string>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): IngestConfig {
  const environment = (args.get("environment") ?? env.SETRYN_NETWORK ?? "local").trim();
  if (environment === "arbitrum-one") throw new Error("Arbitrum One has no Setryn deployment to ingest; its Chainlink rounds are read as the reference");
  if (environment !== "local" && environment !== "arbitrum-sepolia") throw new Error(`unknown environment ${environment}`);
  const local = environment === "local";

  const rpcUrl = (env.SETRYN_RPC_URL?.trim() || (local ? env.LOCAL_RPC_URL?.trim() || "http://127.0.0.1:8545" : "")).trim();
  if (!rpcUrl) throw new Error("SETRYN_RPC_URL is required for arbitrum-sepolia");
  const parsed = new URL(rpcUrl);
  if (local && (parsed.protocol !== "http:" || !LOOPBACK.has(parsed.hostname))) throw new Error("the local RPC must be a loopback http URL");
  if (!local && parsed.protocol !== "https:") throw new Error("SETRYN_RPC_URL must be an https URL");

  const referenceRpcUrl = env.SETRYN_REFERENCE_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
  if (new URL(referenceRpcUrl).protocol !== "https:") throw new Error("SETRYN_REFERENCE_RPC_URL must be an https URL");

  const runtimePath = resolve(env.SETRYN_RUNTIME_PATH?.trim() || resolve(repositoryRoot, `deployments/${environment}/runtime.json`));
  const manifestPath = resolve(env.SETRYN_MANIFEST_PATH?.trim() || resolve(runtimePath, "..", "manifest.json"));

  return {
    environment,
    scope: environment,
    chainId: INGEST_CHAIN_IDS[environment],
    rpcUrl,
    referenceRpcUrl,
    runtimePath,
    manifestPath,
    confirmations: integer(args.get("confirmations") ?? env.SETRYN_INGEST_CONFIRMATIONS, local ? 0 : 3, 0, 1_000, "confirmations"),
    chunkBlocks: integer(args.get("chunk-blocks") ?? env.SETRYN_LOG_CHUNK_BLOCKS, local ? 200_000 : 9_000, 1, 1_000_000, "chunk blocks"),
    maxChunks: integer(args.get("max-chunks"), 40, 1, 10_000, "max chunks"),
    intervalSeconds: integer(args.get("interval-seconds") ?? env.SETRYN_INGEST_INTERVAL_SECONDS, 15, 1, 3_600, "interval seconds"),
    backfillDays: integer(args.get("backfill-days") ?? env.SETRYN_INGEST_BACKFILL_DAYS, 30, 0, 3_650, "backfill days"),
    maxRoundsPerFeed: integer(args.get("max-rounds") ?? env.SETRYN_INGEST_MAX_ROUNDS, 5_000, 1, 1_000_000, "max rounds"),
  };
}

export function parseArguments(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument ${item}`);
    const name = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args.set(name, "true");
    else {
      args.set(name, next);
      index += 1;
    }
  }
  return args;
}
