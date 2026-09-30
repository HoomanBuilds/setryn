import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createEnvironmentExecutionPorts } from "../adapters/index.ts";
import { InternalOperatorRuntime, type OperatorRunResult } from "../runtime.ts";
import { InMemoryOperatorRuntimeStore } from "../store.ts";
import type { OperatorEnvironment, OperatorJobRequest } from "../types.ts";

/**
 * Operator worker: builds the runtime with the in-memory store and the concrete chain ports for one environment,
 * enqueues the job requests in a JSON file, and drains them (waiting for scheduled retries up to --max-wait-ms).
 *
 *   node --experimental-strip-types services/operator-runtime/src/bin/operator-worker.ts \
 *     --environment local --jobs jobs.json [--worker-id worker-1] [--max-wait-ms 60000]
 *
 * Arbitrum Sepolia requires SETRYN_SEPOLIA_RPC_URL, SETRYN_SEPOLIA_RUNTIME_PATH, SETRYN_SEPOLIA_MANIFEST_PATH, and
 * SETRYN_SEPOLIA_OPERATOR_KEY. Arbitrum One is refused before any client is created.
 */
const args = parseArguments(process.argv.slice(2));
const environment = (args.get("environment") ?? process.env.SETRYN_OPERATOR_ENVIRONMENT ?? "local") as OperatorEnvironment;
if (!["local", "arbitrum-sepolia", "arbitrum-one"].includes(environment)) throw new TypeError(`unknown environment ${environment}`);
const jobsPath = args.get("jobs");
if (!jobsPath) throw new TypeError("--jobs <file> is required");
const workerId = args.get("worker-id") ?? `operator-worker-${process.pid}`;
const maxWaitMs = Number(args.get("max-wait-ms") ?? 60_000);

const requests = JSON.parse(await readFile(resolve(process.cwd(), jobsPath), "utf8")) as OperatorJobRequest[];
if (!Array.isArray(requests)) throw new TypeError("the jobs file must hold an array of operator job requests");

const ports = await createEnvironmentExecutionPorts(environment);
const runtime = new InternalOperatorRuntime({ store: new InMemoryOperatorRuntimeStore(), executionPorts: ports });
runtime.reportDependency({
  environment,
  dependency: "rpc",
  state: "healthy",
  observedAt: new Date().toISOString(),
  detail: `chain ${ports.client.expectedChainId}, signer ${ports.client.address}`,
});

for (const request of requests) {
  if (request.intent.environment !== environment) {
    throw new TypeError(`job ${request.intent.idempotencyKey} targets ${request.intent.environment}, not ${environment}`);
  }
  const { job, created } = runtime.enqueue(request);
  log({ event: "enqueued", jobId: job.id, kind: job.intent.kind, status: job.status, created });
}

const deadline = Date.now() + maxWaitMs;
for (;;) {
  const result = await runtime.runNext(environment, workerId);
  if (result.state !== "idle") {
    log(summarize(result));
    continue;
  }
  const pending = runtime.snapshot().jobs
    .filter((job) => job.status === "retry-scheduled" && job.retry.nextAttemptAt !== null)
    .map((job) => Date.parse(job.retry.nextAttemptAt!));
  if (pending.length === 0) break;
  const wakeAt = Math.min(...pending);
  if (wakeAt > deadline) break;
  await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(0, wakeAt - Date.now()) + 10));
}

log({ event: "health", health: runtime.healthSnapshot(environment) });

function summarize(result: Exclude<OperatorRunResult, { readonly state: "idle" }>) {
  const base = { event: "ran", state: result.state, jobId: result.job.id, kind: result.job.intent.kind, status: result.job.status };
  switch (result.state) {
    case "completed":
      return { ...base, details: result.job.completion?.details ?? null };
    case "submitted":
      return { ...base, reference: result.job.submission?.reference ?? null };
    case "blocked":
      return { ...base, reason: result.reason };
    case "retry-scheduled":
    case "failed":
      return { ...base, error: result.error };
  }
}

function log(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseArguments(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) throw new TypeError(`unexpected argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new TypeError(`${flag} needs a value`);
    parsed.set(flag.slice(2), value);
    index += 1;
  }
  return parsed;
}
