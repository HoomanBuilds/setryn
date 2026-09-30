import { createTestClient, http, type Hex } from "viem";

import {
  createChainExecutionPorts,
  ensureTradingAccount,
  hashOrder,
  OperatorChainClient,
  reserveOrderRisk,
  resolveOperatorChainConfig,
  signOrder,
  transactionSummary,
} from "../adapters/index.ts";
import {
  abis,
  deriveSeriesBookId,
  deterministicSalt,
  deterministicWord,
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
 * Local-devnet smoke for the concrete operator ports, driven through the runtime and the in-memory store:
 * maker quote cycle (and its idempotent replay), a private RFQ answered and executed by the solver port, keeper order
 * expiry and risk recovery, the oracle relay inside the fixing window, and fixing resolution plus permissionless
 * terminal settlement after final resolution. It moves anvil time forward, so it refuses anything but chain 31337.
 *
 *   node --experimental-strip-types services/operator-runtime/src/bin/local-smoke.ts
 */
const config = resolveOperatorChainConfig("local");
const client = await OperatorChainClient.create(config);
await client.assertWritable("local smoke");
if (client.expectedChainId !== 31337 || (await client.public.getChainId()) !== 31337) throw new Error("local smoke only runs on chain 31337");

const ports = createChainExecutionPorts(client);
const runtime = new InternalOperatorRuntime({ store: new InMemoryOperatorRuntimeStore(), executionPorts: ports });
const anvil = createTestClient({ mode: "anvil", chain: client.public.chain, transport: http(config.rpcUrl) });
const { deployment } = client;
const run = `smoke-${Date.now()}`;
const retry: RetryPolicy = { maxAttempts: 1, baseDelayMs: 1_000, maxDelayMs: 1_000 };
const summary: Record<string, unknown> = { signer: client.address, chainId: deployment.chainId, seriesId: deployment.ids.seriesId };
const dayStart = BigInt(deployment.day) * 86_400n;

section("maker quote cycle");
const makerIntent: OperatorIntent = {
  kind: "quote-cycle",
  domain: "maker",
  riskClass: "new-risk",
  environment: "local",
  idempotencyKey: `${run}:maker`,
  requestedAt: new Date().toISOString(),
  marketId: deployment.ids.marketId as never,
  makerKey: "devnet-mm",
  quoteRequest: { referencePriceTicks: 6120, halfSpreadTicks: 10, lots: 10, ttlSeconds: 240 },
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};
const maker = await execute(makerIntent);
const makerDetails = maker.completion?.details as { posted?: { orderHash: Hex; admissionId: Hex; side: string; priceTicks: string }[] } | undefined;
const replay = runtime.enqueue({ intent: makerIntent, retryPolicy: retry, requestedBy: "local-smoke" });
const portReplay = await ports.maker.executeQuoteCycle(makerIntent as never, {
  jobId: replay.job.id,
  environment: "local",
  workerId: "local-smoke",
  attempt: 2,
  idempotencyKey: makerIntent.idempotencyKey,
});
summary.maker = {
  status: maker.status,
  posted: makerDetails?.posted?.map((order) => ({ side: order.side, priceTicks: order.priceTicks, orderHash: order.orderHash })),
  transactions: (maker.completion?.details as { transactions?: unknown }).transactions,
  runtimeReplayCreatedNewJob: replay.created,
  portReplayFlagged: portReplay.details.replayed === true,
  portReplayTransactions: portReplay.details.transactionCount,
};
report(summary.maker);

section("private RFQ: solver quote and handoff execution");
const taker = client.withSigner({ kind: "anvil-development", addressIndex: 8 });
const rfq = await openTakerRfq(taker);
const quote = await execute({
  kind: "solver-execution",
  domain: "solver",
  riskClass: "new-risk",
  environment: "local",
  idempotencyKey: `${run}:solver-quote`,
  requestedAt: new Date().toISOString(),
  marketId: deployment.ids.marketId as never,
  packageHash: zeroId as never,
  accountId: (await ensureTradingAccount(client, { fundingMinor: null })).accountId as never,
  executionPlan: { action: "submit-quote", rfqId: rfq.rfqId, priceTicks: 6125, ttlSeconds: 120 },
});
const quoteId = (quote.completion?.details as { quoteId?: Hex } | undefined)?.quoteId;
if (!quoteId) throw new Error(`solver quote failed: ${quote.retry.lastError ?? quote.status}`);
const selection = await selectQuote(taker, rfq.rfqId, quoteId);
const handoff = await execute({
  kind: "solver-execution",
  domain: "solver",
  riskClass: "new-risk",
  environment: "local",
  idempotencyKey: `${run}:solver-execute`,
  requestedAt: new Date().toISOString(),
  marketId: deployment.ids.marketId as never,
  packageHash: zeroId as never,
  accountId: rfq.takerAccountId as never,
  executionPlan: { action: "execute-handoff", rfqId: rfq.rfqId },
});
const positionId = (handoff.completion?.details as { positionId?: Hex } | undefined)?.positionId;
if (!positionId) throw new Error(`RFQ handoff failed: ${handoff.retry.lastError ?? handoff.status}`);
summary.solver = {
  rfqId: rfq.rfqId,
  takerTransactions: [...rfq.transactions, ...selection],
  quote: quote.completion?.details,
  handoff: handoff.completion?.details,
};
report(summary.solver);

section("keeper expire-orders after the maker quotes lapse");
const bookId = deriveSeriesBookId(deployment, deployment.ids.seriesId);
const before = await bookSnapshot(bookId);
await advanceTo((await client.chainNow()) + 300n);
const expire = await keeper("expire-orders", {}, "terminal-resolution");
const after = await bookSnapshot(bookId);
const admissions = (makerDetails?.posted ?? []).map((order) => ({ kind: "expire-risk-admission", id: order.admissionId }));
const recovery = await keeper("recover", { actions: admissions }, "operational");
summary.keeperExpireOrders = { bookBefore: before, bookAfter: after, result: expire.completion?.details, recoverAdmissions: recovery.completion?.details };
report(summary.keeperExpireOrders);

section("oracle relay inside the fixing window");
await advanceTo(dayStart + 19n * 3600n + 20n * 60n);
const relay = await execute({
  kind: "oracle-relay",
  domain: "oracle",
  riskClass: "operational",
  environment: "local",
  idempotencyKey: `${run}:oracle`,
  requestedAt: new Date().toISOString(),
  feedKey: "Crypto.BTC/USD",
  marketId: deployment.ids.marketId as never,
  relayPayload: { observations: [{ value: "10125000000000", providerSequence: 1 }] },
});
const beginFixing = await keeper("resolve-fixing", {}, "terminal-resolution");
summary.oracleRelay = {
  status: relay.status,
  details: relay.completion?.details ?? null,
  error: relay.retry.lastError,
  resolveFixingInWindow: beginFixing.completion?.details,
};
report(summary.oracleRelay);

section("fixing finalization after the correction cutoff and normal settlement");
// Finalization is only open between the 22:00 correction cutoff and 23:00 final resolution. The devnet series uses
// holder election, so a finalized fixing reopens the position for exercise and unelected lots lapse at final
// resolution through the permissionless terminal path.
await advanceTo(dayStart + 22n * 3600n + 10n * 60n);
const resolved = await keeper("resolve-fixing", {}, "terminal-resolution");
const settled = await keeper("settle-positions", {}, "terminal-resolution");
await advanceTo(dayStart + 23n * 3600n + 5n * 60n);
const recovered = await keeper("recover", { positionIds: [positionId] }, "terminal-resolution");
summary.terminal = { positionId, resolveFixing: resolved.completion?.details, settle: settled.completion?.details, recover: recovered.completion?.details };
report(summary.terminal);

section("runtime health");
const health = runtime.healthSnapshot("local");
report({ state: health.state, jobs: health.jobs, alerts: health.activeAlerts.map((alert) => alert.message) });

async function execute(intent: OperatorIntent): Promise<OperatorJob> {
  const { job } = runtime.enqueue({ intent, retryPolicy: retry, requestedBy: "local-smoke" });
  const result = await runtime.runNext("local", "local-smoke");
  if (result.state === "idle") throw new Error("runtime had no job to run");
  if (result.job.id !== job.id) throw new Error("runtime leased an unexpected job");
  if (result.state === "failed" || result.state === "retry-scheduled") console.log(`  ${intent.kind} -> ${result.state}: ${result.error}`);
  else console.log(`  ${intent.kind} -> ${result.state}`);
  return result.job;
}

async function keeper(workType: string, work: Record<string, unknown>, riskClass: "terminal-resolution" | "operational") {
  return execute({
    kind: "keeper-work",
    domain: "keeper",
    riskClass,
    environment: "local",
    idempotencyKey: `${run}:keeper:${workType}:${Date.now()}`,
    requestedAt: new Date().toISOString(),
    resourceId: deployment.ids.seriesId as never,
    workType,
    work: work as never,
  });
}

/** Local only: pins the next block's timestamp and mines it, so pending-block deadlines see the new time. */
async function advanceTo(timestamp: bigint): Promise<void> {
  if ((await client.public.getChainId()) !== 31337) throw new Error("time travel is local only");
  await anvil.setNextBlockTimestamp({ timestamp });
  await anvil.mine({ blocks: 1 });
  console.log(`  chain time -> ${new Date(Number(timestamp) * 1000).toISOString()}`);
}

async function bookSnapshot(book: Hex) {
  const [bids, asks] = await Promise.all([readBookSide(client, book, 1), readBookSide(client, book, 2)]);
  return { bids: bids.map((order) => `${order.priceTicks}x${order.remainingLots}`), asks: asks.map((order) => `${order.priceTicks}x${order.remainingLots}`) };
}

/** Plays the taker: a funded account, a risk-bound FOK buy order, and a signed private RFQ opened for quotes. */
async function openTakerRfq(participant: OperatorChainClient) {
  const account = await ensureTradingAccount(participant, { fundingMinor: 50_000_000_000n });
  const transactions = [...account.transactions];
  const now = await participant.chainNow();
  const nonce = deterministicWord(`${run}:taker-order`);
  const order: PublicOrder = {
    signer: participant.address,
    accountId: account.accountId,
    policyId: publicSeriesPolicy,
    policyContextHash: deterministicSalt(`${run}:taker-policy-context`),
    actionId: deployment.ids.enterActionId,
    targetKind: 1,
    seriesId: deployment.ids.seriesId,
    packageId: zeroId,
    targetVersion: 1,
    side: 1,
    lots: 2n,
    priceTicks: 6200n,
    timeInForce: 1,
    deadline: now + 240n,
    executionModeId: deployment.ids.privateRfqExecutionModeId,
    feeScheduleId: deployment.ids.feeScheduleId,
    feeScheduleVersion: 1,
    maxFeeMinor: 50_000_000n,
    recipient: participant.address,
    permittedExecutor: deployment.addresses.atomicClearingEngine,
    nonce,
    salt: deterministicSalt(`${run}:taker-order-salt`),
    allowPartialFills: true,
    minimumFillLots: 1n,
    remainderPolicy: 1,
    postOnly: false,
    reduceOnly: false,
  };
  const orderHash = await hashOrder(participant, order);
  const signature = await signOrder(participant, order);
  const reservation = await reserveOrderRisk(client, order, orderHash);
  if (reservation.transaction) transactions.push(reservation.transaction);
  transactions.push(transactionSummary(await participant.write("taker: bind order risk", {
    address: deployment.addresses.riskAdmissionBindingRegistry,
    abi: abis.riskAdmissionBindingRegistry,
    functionName: "bindOrderRisk",
    args: [order, reservation.admissionId],
  })));
  transactions.push(transactionSummary(await participant.write("taker: register order", {
    address: deployment.addresses.orderState,
    abi: abis.orderState,
    functionName: "registerSignedOrder",
    args: [order, signature],
  })));
  const requestNonce = deterministicWord(`${run}:rfq`);
  const request = {
    taker: participant.address,
    takerAccountId: account.accountId,
    takerOrderHash: orderHash,
    targetKind: 1,
    seriesId: deployment.ids.seriesId,
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
  transactions.push(transactionSummary(await participant.write("taker: register RFQ", {
    address: deployment.addresses.privateRfqBook,
    abi: abis.privateRfqBook,
    functionName: "registerRequest",
    args: [request, [], requestSignature],
  })));
  transactions.push(transactionSummary(await participant.write("taker: open collection", {
    address: deployment.addresses.privateRfqBook,
    abi: abis.privateRfqBook,
    functionName: "openCollection",
    args: [rfqId],
  })));
  console.log(`  taker ${participant.address} opened RFQ ${rfqId}`);
  return { rfqId, takerAccountId: account.accountId, transactions: transactions.map((transaction) => ({ label: transaction.label, hash: transaction.hash })) };
}

/** The taker's side of selection: signed selection lock, capacity confirmation, authorization, and submission. */
async function selectQuote(participant: OperatorChainClient, rfqId: Hex, selectedQuoteId: Hex) {
  const now = await participant.chainNow();
  const nonce = deterministicWord(`${run}:selection`);
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
  const steps = [
    await participant.write("taker: lock selection", { address: book, abi: abis.privateRfqBook, functionName: "lockSelection", args: [selectionMessage, signature] }),
    await participant.write("taker: confirm capacity", { address: book, abi: abis.privateRfqBook, functionName: "confirmSelectedCapacity", args: [rfqId] }),
    await participant.write("taker: authorize submission", { address: book, abi: abis.privateRfqBook, functionName: "authorizeSubmission", args: [rfqId] }),
    await participant.write("taker: submit selection", {
      address: book,
      abi: abis.privateRfqBook,
      functionName: "submitSelectedRfq",
      args: [rfqId, deterministicSalt(`${rfqId}:submitted`)],
    }),
  ];
  console.log(`  taker selected quote ${selectedQuoteId}`);
  return steps.map((step) => ({ label: step.label, hash: step.hash }));
}

function section(title: string): void {
  console.log(`\n== ${title}`);
}

function report(value: unknown): void {
  console.log(JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2));
}
