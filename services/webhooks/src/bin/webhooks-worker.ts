import { ChainReader, loadLocalChainConfig, missingWebhookSourceCoverage } from "../chain.ts";
import { DEFAULT_RETRY_POLICY } from "../delivery.ts";
import { WebhookStore } from "../store.ts";
import { WebhookWorker } from "../worker.ts";
import { closeDatabase } from "@setryn/persistence";

/**
 * Webhooks worker: polls the local devnet for confirmed protocol logs, derives webhook events, and delivers them with
 * signed, retried POSTs. Read-only against the chain; refuses any RPC that is not loopback and any chain but 31337.
 *
 *   node --experimental-strip-types services/webhooks/src/bin/webhooks-worker.ts \
 *     [--confirmations 0] [--poll-ms 2000] [--max-attempts 8] [--backoff-base-ms 30000] [--backoff-max-ms 21600000]
 *     [--start-block 0] [--run-for-ms <n>] [--once]
 *
 * Env: LOCAL_RPC_URL (default http://127.0.0.1:8545), SETRYN_RUNTIME_PATH, SETRYN_WEBHOOKS_DIR (default .setryn/webhooks).
 */
const args = parseArguments(process.argv.slice(2));
const number = (name: string, fallback: number) => {
  const raw = args.get(name) ?? process.env[`SETRYN_WEBHOOK_${name.toUpperCase().replaceAll("-", "_")}`];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`--${name} must be a non-negative number`);
  return parsed;
};

const missing = missingWebhookSourceCoverage();
if (missing.length > 0) throw new Error(`webhook source coverage is incomplete: ${missing.join(", ")}`);

const config = await loadLocalChainConfig();
const chain = new ChainReader(config);
await chain.verifyChain();
const store = new WebhookStore();
const pollMs = number("poll-ms", 2_000);
const worker = new WebhookWorker(store, chain, {
  confirmations: number("confirmations", 0),
  startBlock: BigInt(number("start-block", 0)),
  retry: {
    ...DEFAULT_RETRY_POLICY,
    maxAttempts: Math.max(1, Math.floor(number("max-attempts", DEFAULT_RETRY_POLICY.maxAttempts))),
    baseDelayMs: number("backoff-base-ms", DEFAULT_RETRY_POLICY.baseDelayMs),
    maxDelayMs: number("backoff-max-ms", DEFAULT_RETRY_POLICY.maxDelayMs),
  },
});
worker.options.log({
  event: "worker-started",
  chainId: config.chainId,
  rpcUrl: config.rpcUrl,
  store: store.directory,
  contracts: config.contracts.map((contract) => `${contract.name}@${contract.address}`),
  confirmations: worker.options.confirmations,
  retry: worker.options.retry,
});

const once = args.has("once");
const runFor = args.has("run-for-ms") ? number("run-for-ms", 0) : null;
const stopAt = runFor === null ? Number.POSITIVE_INFINITY : Date.now() + runFor;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  try {
    // Drain the confirmed backlog before delivering, one bounded range per iteration.
    for (;;) {
      const result = await worker.pollChainOnce();
      if (!result.scanned || result.scanned[1] >= (await chain.head()) - BigInt(worker.options.confirmations)) break;
    }
    await worker.deliverDueOnce();
  } catch (error) {
    worker.options.log({ event: "worker-error", error: error instanceof Error ? error.message : String(error) });
  }
  if (once || Date.now() >= stopAt) break;
  const due = await worker.nextDueAt();
  const wait = Math.max(50, Math.min(pollMs, due === null ? pollMs : due - Date.now()));
  await new Promise((resolveWait) => setTimeout(resolveWait, wait));
}
worker.options.log({ event: "worker-stopped" });
await closeDatabase();

function parseArguments(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new TypeError(`unexpected argument ${key}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) parsed.set(key.slice(2), "true");
    else {
      parsed.set(key.slice(2), next);
      index += 1;
    }
  }
  return parsed;
}
