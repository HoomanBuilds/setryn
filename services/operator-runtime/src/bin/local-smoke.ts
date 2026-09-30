import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createTestClient, http, type Hex } from "viem";

import {
  accountCollateral,
  createChainExecutionPorts,
  ensureFreeCollateral,
  ensureTradingAccount,
  hashOrder,
  OperatorChainClient,
  requireMarket,
  reserveOrderRisk,
  resolveOperatorChainConfig,
  signOrder,
  transactionSummary,
  type OperatorMarket,
} from "../adapters/index.ts";
import {
  abis,
  deriveSeriesBookId,
  deterministicSalt,
  deterministicWord,
  enumName,
  fixingResolutionNames,
  fixingStatusNames,
  positionStatusNames,
  privateRfqRequestTypes,
  publicSeriesPolicy,
  rfqSelectionTypes,
  setrynDomain,
  zeroId,
  type PublicOrder,
} from "../adapters/protocol.ts";
import { readBookSide } from "../adapters/book.ts";
import { InternalOperatorRuntime } from "../runtime.ts";
import { InMemoryOperatorRuntimeStore } from "../store.ts";
import type { OperatorIntent, OperatorJob, RetryPolicy } from "../types.ts";

/**
 * Local-devnet smoke for the concrete operator ports across several catalog markets on different benchmarks, driven
 * through the runtime and the in-memory store. Per market: a maker quote cycle on the market's own book and grid, a
 * private RFQ answered by the solver and executed through the clearing handoff. Then, deployment-wide: keeper order
 * expiry and risk recovery, one coherent fixture fixing per benchmark relayed by the oracle port, fixing finalization,
 * and permissionless terminal settlement through keeper sweeps.
 *
 * It moves the chain clock, so it refuses anything but chain 31337 and, unless explicitly allowed, the shared devnet
 * RPC. Run it against a throwaway fork:
 *
 *   anvil --fork-url http://127.0.0.1:8545 --port 8547 --chain-id 31337
 *   LOCAL_RPC_URL=http://127.0.0.1:8547 node --experimental-strip-types services/operator-runtime/src/bin/local-smoke.ts
 *
 * Env: SETRYN_SMOKE_MARKETS (comma-separated catalog keys; default one market per benchmark),
 *      SETRYN_SMOKE_ALLOW_SHARED_ANVIL=1 to run against http://127.0.0.1:8545 anyway.
 */
const sharedRpcPort = "8545";
const defaultMarkets = ["BTC-YC-24DEC26", "ETH-FC-24DEC26", "ARB-BS-24DEC26", "EURUSD-FW-30DEC26", "XAUUSD-FW-30DEC26"];
const takerLots = 2n;

const config = resolveOperatorChainConfig("local");
const rpcPort = new URL(config.rpcUrl).port || "80";
if (rpcPort === sharedRpcPort && process.env.SETRYN_SMOKE_ALLOW_SHARED_ANVIL !== "1") {
  throw new Error(
    `local smoke moves the chain clock; refusing the shared devnet at ${config.rpcUrl}. Fork it `
      + "(anvil --fork-url http://127.0.0.1:8545 --port 8547 --chain-id 31337) and set LOCAL_RPC_URL=http://127.0.0.1:8547, "
      + "or set SETRYN_SMOKE_ALLOW_SHARED_ANVIL=1.",
  );
}
const client = await OperatorChainClient.create(config);
await client.assertWritable("local smoke");
if (client.expectedChainId !== 31337 || (await client.public.getChainId()) !== 31337) throw new Error("local smoke only runs on chain 31337");

const ports = createChainExecutionPorts(client);
const runtime = new InternalOperatorRuntime({ store: new InMemoryOperatorRuntimeStore(), executionPorts: ports });
const anvil = createTestClient({ mode: "anvil", chain: client.public.chain, transport: http(config.rpcUrl) });
const { deployment } = client;
const run = `smoke-${Date.now()}`;
const retry: RetryPolicy = { maxAttempts: 1, baseDelayMs: 1_000, maxDelayMs: 1_000 };
const dayStart = BigInt(deployment.day) * 86_400n;
const lastTradingAt = dayStart + 18n * 3600n;

// The catalog is the one reference feed: the maker quotes around each market's catalog mid on its catalog grid.
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const catalog = (await import(pathToFileURL(resolve(repositoryRoot, "apps/web/src/lib/terminal/markets.ts")).href)) as {
  readonly MARKETS: readonly CatalogMarket[];
};
interface CatalogMarket {
  readonly id: string;
  readonly underlying: string;
  readonly netPrice: number;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly tickSize: number;
  readonly priceDecimals: number;
}

const selected = (process.env.SETRYN_SMOKE_MARKETS?.split(",").map((key) => key.trim()).filter(Boolean) ?? defaultMarkets)
  .map((key) => requireMarket(deployment, key));
if (new Set(selected.map((market) => market.benchmarkId)).size < 3) throw new Error("the smoke needs at least three markets on different benchmarks");

const chainStart = await client.chainNow();
if (chainStart + 1_800n >= lastTradingAt) {
  throw new Error(`chain time ${chainStart} is too close to last trading ${lastTradingAt}; reset the devnet or fork an earlier state`);
}
console.log(`signer ${client.address}, ${deployment.markets.length} markets onchain, smoke markets: ${selected.map((market) => market.marketKey).join(", ")}`);

interface MarketRun {
  readonly market: OperatorMarket;
  readonly catalog: CatalogMarket;
  readonly grid: bigint;
  maker?: { bid: string | null; ask: string | null; admissions: Hex[]; status: string };
  rfq?: { rfqId: Hex; quoteId: Hex; priceTicks: bigint; positionId: Hex };
  error?: string;
}

const taker = client.withSigner({ kind: "anvil-development", addressIndex: 8 });
const takerAccount = await ensureTradingAccount(taker, { fundingMinor: 50_000_000_000n });
const takerNeed = selected.reduce((sum, market) => sum + takerLots * market.economics.maxLongDebitMinorPerLot, 0n);
await ensureFreeCollateral(taker, takerAccount.accountId, takerNeed, { faucet: true, headroomMinor: 10_000_000_000n });
const solverAccount = await ensureTradingAccount(client, { fundingMinor: 250_000_000_000n });

const runs: MarketRun[] = [];
for (const [index, market] of selected.entries()) {
  const reference = catalog.MARKETS.find((entry) => entry.id === market.marketKey);
  if (!reference) throw new Error(`${market.marketKey} is not in the catalog`);
  const grid = BigInt(Math.round(reference.tickSize * market.priceScale));
  const entry: MarketRun = { market, catalog: reference, grid };
  runs.push(entry);

  section(`${market.marketKey}: maker quote cycle`);
  const halfSpreadTicks = BigInt(Math.max(Number(grid), Math.round(((reference.bestAsk - reference.bestBid) / 2) * market.priceScale)));
  const makerIntent: OperatorIntent = {
    kind: "quote-cycle",
    domain: "maker",
    riskClass: "new-risk",
    environment: "local",
    idempotencyKey: `${run}:maker:${market.marketKey}`,
    requestedAt: new Date().toISOString(),
    marketId: market.marketId as never,
    makerKey: "devnet-mm",
    quoteRequest: {
      referencePrice: reference.netPrice.toFixed(reference.priceDecimals),
      gridTicks: grid.toString(),
      halfSpreadTicks: halfSpreadTicks.toString(),
      ttlSeconds: 240,
    },
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const maker = await execute(makerIntent);
  const makerDetails = maker.completion?.details as {
    posted?: { orderHash: Hex; admissionId: Hex; side: string; priceTicks: string; lots: string }[];
    kept?: { side: string; priceTicks: string }[];
    skipped?: { side: string; reason: string }[];
  } | undefined;
  const posted = makerDetails?.posted ?? [];
  const quoted = [...posted, ...(makerDetails?.kept ?? [])];
  entry.maker = {
    status: maker.status,
    bid: quoted.find((order) => order.side === "bid")?.priceTicks ?? null,
    ask: quoted.find((order) => order.side === "ask")?.priceTicks ?? null,
    admissions: posted.map((order) => order.admissionId),
  };
  report({
    status: maker.status,
    error: maker.retry.lastError,
    posted: posted.map((order) => `${order.side} ${order.lots} @ ${formatTicks(BigInt(order.priceTicks), market)} (${order.priceTicks} ticks)`),
    kept: (makerDetails?.kept ?? []).map((order) => `${order.side} @ ${formatTicks(BigInt(order.priceTicks), market)} (already resting)`),
    skipped: makerDetails?.skipped ?? [],
    book: await bookSnapshot(market),
  });
  if (index === 0) {
    const replay = runtime.enqueue({ intent: makerIntent, retryPolicy: retry, requestedBy: "local-smoke" });
    const portReplay = await ports.maker.executeQuoteCycle(makerIntent as never, {
      jobId: replay.job.id,
      environment: "local",
      workerId: "local-smoke",
      attempt: 2,
      idempotencyKey: makerIntent.idempotencyKey,
    });
    report({ runtimeReplayCreatedNewJob: replay.created, portReplayFlagged: portReplay.details.replayed === true });
  }

  section(`${market.marketKey}: private RFQ, solver quote and handoff execution`);
  try {
    const askTicks = BigInt(entry.maker.ask ?? String(BigInt(Math.round(reference.bestAsk * market.priceScale))));
    const rfq = await openTakerRfq(taker, takerAccount.accountId, market, askTicks + 4n * grid);
    const quote = await execute({
      kind: "solver-execution",
      domain: "solver",
      riskClass: "new-risk",
      environment: "local",
      idempotencyKey: `${run}:solver-quote:${market.marketKey}`,
      requestedAt: new Date().toISOString(),
      marketId: market.marketId as never,
      packageHash: zeroId as never,
      accountId: solverAccount.accountId as never,
      executionPlan: { action: "submit-quote", rfqId: rfq.rfqId, priceTicks: askTicks.toString(), ttlSeconds: 120 },
    });
    const quoteId = (quote.completion?.details as { quoteId?: Hex } | undefined)?.quoteId;
    if (!quoteId) throw new Error(`solver quote failed: ${quote.retry.lastError ?? quote.status}`);
    await selectQuote(taker, rfq.rfqId, quoteId, market.marketKey);
    const handoff = await execute({
      kind: "solver-execution",
      domain: "solver",
      riskClass: "new-risk",
      environment: "local",
      idempotencyKey: `${run}:solver-execute:${market.marketKey}`,
      requestedAt: new Date().toISOString(),
      marketId: market.marketId as never,
      packageHash: zeroId as never,
      accountId: rfq.takerAccountId as never,
      executionPlan: { action: "execute-handoff", rfqId: rfq.rfqId },
    });
    const positionId = (handoff.completion?.details as { positionId?: Hex } | undefined)?.positionId;
    if (!positionId) throw new Error(`RFQ handoff failed: ${handoff.retry.lastError ?? handoff.status}`);
    entry.rfq = { rfqId: rfq.rfqId, quoteId, priceTicks: askTicks, positionId };
    report({ rfqId: rfq.rfqId, quoteId, price: formatTicks(askTicks, market), lots: takerLots, positionId });
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    report({ error: entry.error });
  }
}

section("keeper sweep: expire lapsed maker quotes and recover their risk");
await advanceTo((await client.chainNow()) + 300n);
const expire = await keeperSweep(["expire-orders"]);
const admissions = runs.flatMap((entry) => entry.maker?.admissions ?? []).map((id) => ({ kind: "expire-risk-admission", id }));
const recovery = admissions.length > 0 ? await keeper("recover", zeroId, { actions: admissions }, "operational") : null;
report({
  expired: sweepActions(expire).filter((action) => action.outcome === "executed").length,
  books: Object.fromEntries(await Promise.all(runs.map(async (entry) => [entry.market.marketKey, await bookSnapshot(entry.market)] as const))),
  recoveredAdmissions: (recovery?.completion?.details as { actions?: { outcome: string }[] } | undefined)?.actions?.filter((action) => action.outcome === "executed").length ?? 0,
});

section("oracle relay: one fixture fixing per benchmark, inside the fixing window");
await advanceTo(dayStart + 19n * 3600n + 20n * 60n);
const relay = await execute({
  kind: "oracle-relay",
  domain: "oracle",
  riskClass: "operational",
  environment: "local",
  idempotencyKey: `${run}:oracle-fixtures`,
  requestedAt: new Date().toISOString(),
  feedKey: "devnet-fixtures",
  relayPayload: { fixtures: {} },
});
const relayDetails = relay.completion?.details as {
  benchmarks?: Record<string, { referenceMarketKey: string; forwardReference: string; referenceDecimals: number; offsetBps: number; value: string; decimals: number }>;
  results?: { marketKey: string; outcome: string; reason?: string }[];
} | undefined;
report({
  status: relay.status,
  error: relay.retry.lastError,
  benchmarks: Object.values(relayDetails?.benchmarks ?? {}).map((benchmark) =>
    `${benchmark.referenceMarketKey.split("-")[0]}: forward ${formatFixed(BigInt(benchmark.forwardReference), benchmark.referenceDecimals)} `
      + `${benchmark.offsetBps >= 0 ? "+" : ""}${benchmark.offsetBps}bps -> fixing ${formatFixed(BigInt(benchmark.value), benchmark.decimals)}`),
  series: countBy((relayDetails?.results ?? []).map((result) => result.outcome)),
  failures: (relayDetails?.results ?? []).filter((result) => result.outcome === "failed").map((result) => `${result.marketKey}: ${result.reason}`),
});
const beginFixing = await keeperSweep(["resolve-fixing"]);
report({ beginFixing: countBy(sweepActions(beginFixing).map((action) => `${action.action}:${action.outcome}`)) });

section("fixing finalization after the correction cutoff, then settlement");
// Finalization is open between the 22:00 correction cutoff and 23:00 final resolution. The devnet series use holder
// election; lots nobody elects lapse, and the permissionless terminal path completes every position.
await advanceTo(dayStart + 22n * 3600n + 10n * 60n);
const finalize = await keeperSweep(["resolve-fixing", "settle-positions"]);
report({ actions: countBy(sweepActions(finalize).map((action) => `${action.action}:${action.outcome}`)) });

section("terminal resolution after final resolution");
await advanceTo(dayStart + 23n * 3600n + 5n * 60n);
const terminal = await keeperSweep(["resolve-fixing", "settle-positions", "recover-positions"]);
report({ actions: countBy(sweepActions(terminal).map((action) => `${action.action}:${action.outcome}`)) });

section("per-market summary");
const rows = [];
for (const entry of runs) {
  const { market } = entry;
  const [fixing, fixingState] = await Promise.all([
    client.read("read final fixing", (reader) =>
      reader.readContract({ address: deployment.addresses.fixingEngine, abi: abis.fixingEngine, functionName: "getFinalizedFixing", args: [market.seriesId, 1, 0] }),
    ),
    client.read("read fixing status", (reader) =>
      reader.readContract({ address: deployment.addresses.fixingEngine, abi: abis.fixingEngine, functionName: "fixingStatus", args: [market.seriesId, 1, 0] }),
    ),
  ]);
  let positionState = "none";
  let settlement: Hex = zeroId;
  if (entry.rfq) {
    const positionId = entry.rfq.positionId;
    const [status, settlementId] = await Promise.all([
      client.read("read position status", (reader) =>
        reader.readContract({ address: deployment.addresses.positionEngine, abi: abis.positionEngine, functionName: "positionStatus", args: [positionId] }),
      ),
      client.read("read settlement", (reader) =>
        reader.readContract({ address: deployment.addresses.cashSettlementCoordinator, abi: abis.cashSettlementCoordinator, functionName: "settlementOf", args: [positionId] }),
      ),
    ]);
    positionState = enumName(positionStatusNames, status);
    settlement = settlementId;
  }
  rows.push({
    market: market.marketKey,
    maker: `${entry.maker?.bid ? formatTicks(BigInt(entry.maker.bid), market) : "-"} / ${entry.maker?.ask ? formatTicks(BigInt(entry.maker.ask), market) : "-"}`,
    rfqFill: entry.rfq ? `${takerLots} @ ${formatTicks(entry.rfq.priceTicks, market)}` : `failed: ${entry.error ?? "unknown"}`,
    fixing: `${enumName(fixingStatusNames, fixingState)} ${enumName(fixingResolutionNames, fixing.resolutionKind)} ${fixing.value === 0n ? "-" : formatFixed(fixing.value, fixing.decimals)}`,
    position: positionState,
    settlement: settlement === zeroId ? "none" : `${settlement.slice(0, 10)}...`,
  });
}
console.table(rows);
const takerBalance = await accountCollateral(taker, takerAccount.accountId);
report({ takerCollateral: { total: takerBalance.total, locked: takerBalance.locked, available: takerBalance.available } });

section("runtime health");
const health = runtime.healthSnapshot("local");
report({ state: health.state, jobs: health.jobs, alerts: health.activeAlerts.map((alert) => alert.message) });
const incomplete = runs.filter((entry) => !entry.rfq);
if (incomplete.length > 0) {
  console.error(`smoke incomplete for ${incomplete.map((entry) => entry.market.marketKey).join(", ")}`);
  process.exitCode = 1;
}

async function execute(intent: OperatorIntent): Promise<OperatorJob> {
  const { job } = runtime.enqueue({ intent, retryPolicy: retry, requestedBy: "local-smoke" });
  const result = await runtime.runNext("local", "local-smoke");
  if (result.state === "idle") throw new Error("runtime had no job to run");
  if (result.job.id !== job.id) throw new Error("runtime leased an unexpected job");
  if (result.state === "failed" || result.state === "retry-scheduled") console.log(`  ${intent.kind} -> ${result.state}: ${result.error}`);
  else console.log(`  ${intent.kind} -> ${result.state}`);
  return result.job;
}

async function keeper(workType: string, resourceId: Hex, work: Record<string, unknown>, riskClass: "terminal-resolution" | "operational") {
  return execute({
    kind: "keeper-work",
    domain: "keeper",
    riskClass,
    environment: "local",
    idempotencyKey: `${run}:keeper:${workType}:${Date.now()}`,
    requestedAt: new Date().toISOString(),
    resourceId: resourceId as never,
    workType,
    work: work as never,
  });
}

/** One deployment-wide keeper sweep over every market, as a worker would schedule it. */
async function keeperSweep(steps: readonly string[]) {
  const job = await keeper("sweep", zeroId, { steps: [...steps] }, "terminal-resolution");
  const markets = (job.completion?.details as { markets?: { marketKey: string; outcome: string; reason?: string }[] } | undefined)?.markets ?? [];
  for (const failed of markets.filter((market) => market.outcome === "failed")) console.log(`  sweep ${failed.marketKey} failed: ${failed.reason}`);
  return job;
}

function sweepActions(job: OperatorJob): { action: string; outcome: string; marketKey: string }[] {
  const markets = (job.completion?.details as { markets?: { marketKey: string; steps?: Record<string, { actions?: { action: string; outcome: string }[] }> }[] } | undefined)?.markets ?? [];
  return markets.flatMap((market) =>
    Object.values(market.steps ?? {}).flatMap((step) => (step.actions ?? []).map((action) => ({ ...action, marketKey: market.marketKey }))),
  );
}

/** Local only: pins the next block's timestamp and mines it, so pending-block deadlines see the new time. */
async function advanceTo(timestamp: bigint): Promise<void> {
  if ((await client.public.getChainId()) !== 31337) throw new Error("time travel is local only");
  await anvil.setNextBlockTimestamp({ timestamp });
  await anvil.mine({ blocks: 1 });
  console.log(`  chain time -> ${new Date(Number(timestamp) * 1000).toISOString()}`);
}

async function bookSnapshot(market: OperatorMarket) {
  const book = deriveSeriesBookId(deployment, market.seriesId);
  const [bids, asks] = await Promise.all([readBookSide(client, book, 1, 8), readBookSide(client, book, 2, 8)]);
  const level = (order: { priceTicks: bigint; remainingLots: bigint }) => `${formatTicks(order.priceTicks, market)}x${order.remainingLots}`;
  return { bids: bids.map(level), asks: asks.map(level) };
}

/** Plays the taker on one market: a risk-bound FOK buy order and a signed private RFQ opened for quotes. */
async function openTakerRfq(participant: OperatorChainClient, accountId: Hex, market: OperatorMarket, limitTicks: bigint) {
  const now = await participant.chainNow();
  const nonce = deterministicWord(`${run}:${market.marketKey}:taker-order`);
  const order: PublicOrder = {
    signer: participant.address,
    accountId,
    policyId: publicSeriesPolicy,
    policyContextHash: deterministicSalt(`${run}:${market.marketKey}:taker-policy-context`),
    actionId: deployment.ids.enterActionId,
    targetKind: 1,
    seriesId: market.seriesId,
    packageId: zeroId,
    targetVersion: 1,
    side: 1,
    lots: takerLots,
    priceTicks: limitTicks,
    timeInForce: 1,
    deadline: now + 240n,
    executionModeId: deployment.ids.privateRfqExecutionModeId,
    feeScheduleId: deployment.ids.feeScheduleId,
    feeScheduleVersion: 1,
    maxFeeMinor: 50_000_000n,
    recipient: participant.address,
    permittedExecutor: deployment.addresses.atomicClearingEngine,
    nonce,
    salt: deterministicSalt(`${run}:${market.marketKey}:taker-order-salt`),
    allowPartialFills: true,
    minimumFillLots: 1n,
    remainderPolicy: 1,
    postOnly: false,
    reduceOnly: false,
  };
  const orderHash = await hashOrder(participant, order);
  const signature = await signOrder(participant, order);
  const reservation = await reserveOrderRisk(client, order, orderHash);
  await participant.write("taker: bind order risk", {
    address: deployment.addresses.riskAdmissionBindingRegistry,
    abi: abis.riskAdmissionBindingRegistry,
    functionName: "bindOrderRisk",
    args: [order, reservation.admissionId],
  });
  await participant.write("taker: register order", {
    address: deployment.addresses.orderState,
    abi: abis.orderState,
    functionName: "registerSignedOrder",
    args: [order, signature],
  });
  const requestNonce = deterministicWord(`${run}:${market.marketKey}:rfq`);
  const request = {
    taker: participant.address,
    takerAccountId: accountId,
    takerOrderHash: orderHash,
    targetKind: 1,
    seriesId: market.seriesId,
    packageId: zeroId,
    targetVersion: 1,
    hasPackageLegCommitment: false,
    packageLegsHash: zeroId,
    sidePolicy: 1,
    lots: order.lots,
    allowPartialFills: order.allowPartialFills,
    minimumFillLots: order.minimumFillLots,
    remainderPolicy: order.remainderPolicy,
    feeScheduleId: deployment.ids.feeScheduleId,
    feeScheduleVersion: 1,
    maxFeeMinor: order.maxFeeMinor,
    riskDomainId: deployment.ids.riskDomainId,
    riskDomainVersion: 1,
    privacyModeId: deployment.ids.privateRfqPrivacyModeId,
    executionModeId: deployment.ids.privateRfqExecutionModeId,
    disclosurePolicyHash: deployment.ids.privateRfqDisclosurePolicyHash,
    eligibleMakerSetHash: deployment.ids.privateRfqEligibleMakerSetHash,
    deadline: order.deadline,
    permittedExecutor: deployment.addresses.atomicClearingEngine,
    nonce: requestNonce,
    salt: deterministicSalt(`${orderHash}:${requestNonce}:rfq`),
  } as const;
  const requestSignature = await participant.signTypedData("taker: sign RFQ", {
    domain: setrynDomain(deployment, deployment.addresses.privateRfqBook),
    types: privateRfqRequestTypes,
    primaryType: "PrivateRfqRequest",
    message: request,
  });
  const rfqId = await participant.read("hash RFQ", (reader) =>
    reader.readContract({ address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "hashRequest", args: [request] }),
  );
  await participant.write("taker: register RFQ", {
    address: deployment.addresses.privateRfqBook,
    abi: abis.privateRfqBook,
    functionName: "registerRequest",
    args: [request, [], requestSignature],
  });
  await participant.write("taker: open collection", {
    address: deployment.addresses.privateRfqBook,
    abi: abis.privateRfqBook,
    functionName: "openCollection",
    args: [rfqId],
  });
  console.log(`  taker opened RFQ ${rfqId} for ${takerLots} lots, limit ${formatTicks(limitTicks, market)}`);
  return { rfqId, takerAccountId: accountId };
}

/** The taker's side of selection: signed selection lock, capacity confirmation, authorization, and submission. */
async function selectQuote(participant: OperatorChainClient, rfqId: Hex, selectedQuoteId: Hex, label: string) {
  const now = await participant.chainNow();
  const nonce = deterministicWord(`${run}:${label}:selection`);
  const selectionMessage = {
    rfqId,
    quoteId: selectedQuoteId,
    taker: participant.address,
    executor: deployment.addresses.atomicClearingEngine,
    nonce,
    deadline: now + 90n,
    salt: deterministicSalt(`${rfqId}:${selectedQuoteId}:${nonce}`),
  } as const;
  const signature = await participant.signTypedData("taker: sign selection", {
    domain: setrynDomain(deployment, deployment.addresses.privateRfqBook),
    types: rfqSelectionTypes,
    primaryType: "RfqSelectionAuthorization",
    message: selectionMessage,
  });
  const book = deployment.addresses.privateRfqBook;
  await participant.write("taker: lock selection", { address: book, abi: abis.privateRfqBook, functionName: "lockSelection", args: [selectionMessage, signature] });
  await participant.write("taker: confirm capacity", { address: book, abi: abis.privateRfqBook, functionName: "confirmSelectedCapacity", args: [rfqId] });
  await participant.write("taker: authorize submission", { address: book, abi: abis.privateRfqBook, functionName: "authorizeSubmission", args: [rfqId] });
  await participant.write("taker: submit selection", {
    address: book,
    abi: abis.privateRfqBook,
    functionName: "submitSelectedRfq",
    args: [rfqId, deterministicSalt(`${rfqId}:submitted`)],
  });
  console.log(`  taker selected quote ${selectedQuoteId}`);
}

function formatTicks(ticks: bigint, market: OperatorMarket): string {
  return formatFixed(ticks, String(market.priceScale).length - 1);
}

function formatFixed(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = decimals > 0 ? `.${(magnitude % scale).toString().padStart(decimals, "0")}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function section(title: string): void {
  console.log(`\n== ${title}`);
}

function report(value: unknown): void {
  console.log(JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2));
}
