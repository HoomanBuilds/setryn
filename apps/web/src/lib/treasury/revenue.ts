import { createPublicClient, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import {
  FEE_ACTION_LABELS,
  feeActionName,
  feeScheduleRegistryAbi,
  fundedFeeEngineAbi,
  readActiveFeeSchedule,
  readFeeScheduleVersion,
  registryStatusName,
  resolveFeeScheduleRegistry,
  type FeeScheduleVersionView,
} from "@/lib/internal-gateway/fee-schedule";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import { runtimeMarketBySeries } from "@/lib/internal-gateway/runtime-markets";
import { MARKETS } from "@/lib/terminal/markets";
import {
  CLEARING_CHANNEL,
  FEE_LEDGER_KIND,
  FEE_LEDGER_KIND_LABELS,
  REVENUE_CHANNEL_LABELS,
  type FeeLedgerKindName,
  type FeeScheduleEvent,
  type FeeScheduleHistoryEntry,
  type KindBucket,
  type RevenueBucket,
  type RevenueChannel,
  type TreasuryLedgerEntry,
  type TreasuryProjection,
} from "./types";

/*
 * Server-side treasury projection. Revenue is rebuilt from FundedFeeEngine's own ledger events, never from a decoder's
 * guess: every FeeLedgerEntryRecorded names its consumption, kind, action, account and signed amount, and conserves
 * within its consumption. FeeActionConsumed ties a consumption to its parent action (the fill id for clearing fees),
 * its fee schedule version and its consumer, and the clearing engine's FillCleared names the fill's series and channel.
 * Kinds and channels are canonicalized through explicit tables; an entry of an unknown kind is counted as unrecognized
 * and kept out of every total.
 */

const ENTRY_LIMIT = 2_000;
const CACHE_KEY = Symbol.for("setryn.treasury.ledger");
const BLOCK_TIME_KEY = Symbol.for("setryn.treasury.block-times");

const clearingEventsAbi = parseAbi([
  "struct FillRecord { bytes32 fillId; bytes32 takerOrderHash; bytes32 makerOrderHash; bytes32 targetId; bytes32 witnessHash; bytes32 executionModeId; bytes32 channelConsumptionId; bytes32 routeCommitment; address channelSource; uint8 channelKind; bytes32 settlementAssetId; bytes32 buyerAccountId; bytes32 sellerAccountId; bytes32 makerFeeResultHash; bytes32 takerFeeResultHash; uint32 targetVersion; uint32 settlementAssetVersion; uint64 clearedAt; uint128 fillLots; uint128 takerCumulativeLots; uint128 makerCumulativeLots; int128 executionPriceTicks; int256 considerationMinor; uint128 makerFeeChargeMinor; uint128 makerFeeRebateMinor; uint128 takerFeeChargeMinor; uint128 takerFeeRebateMinor; uint16 positionCount; bool isPackage; }",
  "event FillCleared(bytes32 indexed fillId, FillRecord record, address indexed submitter)",
]);

const vaultReadAbi = parseAbi([
  "function accountExists(bytes32 accountId) view returns (bool)",
  "function getAccount(bytes32 accountId) view returns (address controller, address pendingController)",
  "function deriveCollateralId(bytes32 assetId, uint32 bindingVersion) view returns (bytes32)",
  "function balanceOf(bytes32 accountId, bytes32 collateralId) view returns (uint128 total, uint128 locked, uint128 available)",
]);

const clients = new Map<string, PublicClient>();
function clientFor(rpcUrl: string): PublicClient {
  let client = clients.get(rpcUrl);
  if (!client) {
    client = createPublicClient({ transport: http(rpcUrl, { batch: true }) }) as PublicClient;
    clients.set(rpcUrl, client);
  }
  return client;
}

function blockTimes(): Map<string, number> {
  const holder = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  holder[BLOCK_TIME_KEY] ??= new Map();
  return holder[BLOCK_TIME_KEY];
}

async function timestamps(client: PublicClient, rpcUrl: string, blocks: readonly bigint[]): Promise<Map<bigint, string>> {
  const known = blockTimes();
  const out = new Map<bigint, string>();
  const missing = [...new Set(blocks)].filter((block) => !known.has(`${rpcUrl}:${block}`));
  // Bounded fan-out: a long history is read in slices rather than as one burst.
  for (let index = 0; index < missing.length; index += 64) {
    const slice = missing.slice(index, index + 64);
    const read = await Promise.all(slice.map((blockNumber) => client.getBlock({ blockNumber }).catch(() => null)));
    read.forEach((block, position) => {
      if (block) known.set(`${rpcUrl}:${slice[position]}`, Number(block.timestamp));
    });
  }
  for (const block of blocks) {
    const seconds = known.get(`${rpcUrl}:${block}`);
    if (seconds !== undefined) out.set(block, new Date(seconds * 1000).toISOString());
  }
  return out;
}

function kindName(value: number): FeeLedgerKindName | null {
  return FEE_LEDGER_KIND[value as keyof typeof FEE_LEDGER_KIND] ?? null;
}

function channelName(value: number): RevenueChannel | null {
  return CLEARING_CHANNEL[value as keyof typeof CLEARING_CHANNEL] ?? null;
}

function marketLabel(marketKey: string): string {
  const catalog = MARKETS.find((market) => market.id === marketKey);
  return catalog ? `${marketKey} · ${catalog.name}` : marketKey;
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

class Buckets {
  readonly #map = new Map<string, { label: string; revenue: bigint; actions: Set<string> }>();
  add(key: string, label: string, amount: bigint, consumptionId: string): void {
    const bucket = this.#map.get(key) ?? { label, revenue: BigInt(0), actions: new Set<string>() };
    bucket.revenue += amount;
    bucket.actions.add(consumptionId);
    this.#map.set(key, bucket);
  }
  list(): RevenueBucket[] {
    return [...this.#map.entries()]
      .map(([key, bucket]) => ({ key, label: bucket.label, revenueMinor: bucket.revenue.toString(), actions: bucket.actions.size }))
      .sort((left, right) => (BigInt(right.revenueMinor) > BigInt(left.revenueMinor) ? 1 : BigInt(right.revenueMinor) < BigInt(left.revenueMinor) ? -1 : 0));
  }
}

async function readAccount(client: PublicClient, setryn: SetrynRuntime): Promise<TreasuryProjection["account"]> {
  const accountId = setryn.feeRecipientAccountId;
  const [exists, collateralId] = await Promise.all([
    client.readContract({ address: setryn.collateralVault, abi: vaultReadAbi, functionName: "accountExists", args: [accountId] }),
    client.readContract({ address: setryn.collateralVault, abi: vaultReadAbi, functionName: "deriveCollateralId", args: [setryn.settlementAssetId, 1] }),
  ]);
  const [account, balance] = exists
    ? await Promise.all([
        client.readContract({ address: setryn.collateralVault, abi: vaultReadAbi, functionName: "getAccount", args: [accountId] }),
        client.readContract({ address: setryn.collateralVault, abi: vaultReadAbi, functionName: "balanceOf", args: [accountId, collateralId] }),
      ])
    : [null, null];
  const zero = "0x0000000000000000000000000000000000000000";
  const controller = account && account[0] !== zero ? account[0] : null;
  const pending = account && account[1] !== zero ? account[1] : null;
  return {
    accountId,
    exists,
    controller,
    pendingController: pending,
    configuredController: setryn.treasuryController ?? null,
    controllerSource: setryn.treasuryController ? "RUNTIME" : "VAULT",
    postedMinor: (balance?.[0] ?? BigInt(0)).toString(),
    lockedMinor: (balance?.[1] ?? BigInt(0)).toString(),
    availableMinor: (balance?.[2] ?? BigInt(0)).toString(),
  };
}

async function feeControl(client: PublicClient, setryn: SetrynRuntime, registry: Address): Promise<TreasuryProjection["feeControl"]> {
  const operator = setryn.operator;
  const governance = {
    mode: "GOVERNANCE_TIMELOCK" as const,
    operator,
    reason: "Fee schedule versions are registered and activated through the governance timelock on this network.",
  };
  // Only the local chain lets the operator change fees directly; every network goes through governance.
  const chainId = await client.getChainId().catch(() => null);
  if ((setryn.network !== undefined && setryn.network !== "local") || setryn.chainId !== 31337 || chainId !== 31337) return governance;
  try {
    const [qualifierRole, statusRole] = await Promise.all([
      client.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "FEE_SCHEDULE_QUALIFIER_ROLE" }),
      client.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "FEE_SCHEDULE_STATUS_MANAGER_ROLE" }),
    ]);
    const [qualifies, manages] = await Promise.all([
      client.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "hasRole", args: [qualifierRole, operator] }),
      client.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "hasRole", args: [statusRole, operator] }),
    ]);
    if (qualifies && manages) {
      return { mode: "OPERATOR", operator, reason: "The operator holds the fee schedule qualifier and status roles on this network." };
    }
  } catch {
    return governance;
  }
  return governance;
}

/** Fees one trading account paid, net of rebates, rebuilt from the fee ledger. */
interface AccountFees {
  charged: bigint;
  rebated: bigint;
  actions: Set<string>;
  fills: Set<string>;
}

interface LedgerBuild {
  projection: TreasuryProjection;
  /** Keyed by lowercase account id. */
  accounts: Map<string, AccountFees>;
}

async function buildProjection(client: PublicClient, setryn: SetrynRuntime, headBlock: bigint): Promise<LedgerBuild> {
  const registry = await resolveFeeScheduleRegistry(client, setryn);
  const range = { fromBlock: BigInt(setryn.deploymentBlock ?? 0), toBlock: headBlock } as const;
  const [account, active, control, ledgerLogs, consumedLogs, fillLogs, registeredLogs, statusLogs, activeLogs] = await Promise.all([
    readAccount(client, setryn),
    readActiveFeeSchedule(setryn, { client, maxAgeMs: 0 }),
    feeControl(client, setryn, registry),
    client.getContractEvents({ address: setryn.fundedFeeEngine, abi: fundedFeeEngineAbi, eventName: "FeeLedgerEntryRecorded", ...range }),
    client.getContractEvents({ address: setryn.fundedFeeEngine, abi: fundedFeeEngineAbi, eventName: "FeeActionConsumed", ...range }),
    client.getContractEvents({ address: setryn.atomicClearingEngine, abi: clearingEventsAbi, eventName: "FillCleared", ...range }),
    client.getContractEvents({ address: registry, abi: feeScheduleRegistryAbi, eventName: "FeeScheduleRegistered", args: { feeScheduleId: setryn.feeScheduleId }, ...range }),
    client.getContractEvents({ address: registry, abi: feeScheduleRegistryAbi, eventName: "FeeScheduleStatusChanged", args: { feeScheduleId: setryn.feeScheduleId }, ...range }),
    client.getContractEvents({ address: registry, abi: feeScheduleRegistryAbi, eventName: "FeeScheduleActiveVersionChanged", args: { feeScheduleId: setryn.feeScheduleId }, ...range }),
  ]);

  const fills = new Map<string, { seriesId: Hex; channel: RevenueChannel | null; isPackage: boolean }>();
  for (const log of fillLogs) {
    const record = log.args.record;
    if (!record) continue;
    fills.set(record.fillId.toLowerCase(), { seriesId: record.targetId, channel: channelName(Number(record.channelKind)), isPackage: record.isPackage });
  }
  const consumptions = new Map<string, { parentActionId: Hex; version: number; consumer: Address; notional: bigint; rate: number }>();
  for (const log of consumedLogs) {
    const { consumptionId, parentActionId, feeScheduleVersion, consumer, notionalMinor, computation } = log.args;
    if (!consumptionId || !parentActionId || feeScheduleVersion == null || !consumer) continue;
    consumptions.set(consumptionId.toLowerCase(), {
      parentActionId,
      version: Number(feeScheduleVersion),
      consumer,
      notional: notionalMinor ?? BigInt(0),
      rate: Number(computation?.chargeRatePpm ?? 0),
    });
  }

  const times = await timestamps(
    client,
    setryn.rpcUrl,
    [...ledgerLogs, ...registeredLogs, ...statusLogs, ...activeLogs].map((log) => log.blockNumber).filter((block): block is bigint => block != null),
  );

  const byMarket = new Buckets();
  const byChannel = new Buckets();
  const byAction = new Buckets();
  const byRecipient = new Buckets();
  const kinds = new Map<FeeLedgerKindName, { entries: number; amount: bigint }>();
  const revenueByVersion = new Map<number, { revenue: bigint; actions: Set<string> }>();
  const feeFills = new Set<string>();
  const entries: TreasuryLedgerEntry[] = [];
  let unrecognized = 0;
  let grossCharged = BigInt(0);
  let revenue = BigInt(0);
  let treasuryRevenue = BigInt(0);
  let rebatesPaid = BigInt(0);
  let treasuryBudgetDebits = BigInt(0);
  const treasuryAccount = setryn.feeRecipientAccountId.toLowerCase();
  const consumptionIds = new Set<string>();
  const accounts = new Map<string, AccountFees>();
  const accountFees = (accountId: string): AccountFees => {
    const key = accountId.toLowerCase();
    let entry = accounts.get(key);
    if (!entry) {
      entry = { charged: BigInt(0), rebated: BigInt(0), actions: new Set(), fills: new Set() };
      accounts.set(key, entry);
    }
    return entry;
  };

  for (const log of ledgerLogs) {
    const { consumptionId, kind: rawKind, actionId, accountId, amountMinor } = log.args;
    if (!consumptionId || rawKind == null || !actionId || !accountId || amountMinor == null || !log.transactionHash || log.blockNumber == null) continue;
    const kind = kindName(Number(rawKind));
    if (!kind) {
      unrecognized += 1;
      continue;
    }
    const consumption = consumptions.get(consumptionId.toLowerCase()) ?? null;
    const fill = consumption ? (fills.get(consumption.parentActionId.toLowerCase()) ?? null) : null;
    const channel: RevenueChannel = fill?.channel
      ?? (consumption && setryn.cashSettlementCoordinator && consumption.consumer.toLowerCase() === setryn.cashSettlementCoordinator.toLowerCase()
        ? "SETTLEMENT"
        : "OTHER");
    const market = fill && !fill.isPackage ? runtimeMarketBySeries(setryn, fill.seriesId) : null;
    const action = feeActionName(actionId);
    consumptionIds.add(consumptionId.toLowerCase());
    if (fill && consumption) feeFills.add(consumption.parentActionId.toLowerCase());

    const kindTotals = kinds.get(kind) ?? { entries: 0, amount: BigInt(0) };
    kindTotals.entries += 1;
    kindTotals.amount += amountMinor;
    kinds.set(kind, kindTotals);

    if (kind === "CHARGE_DEBIT") {
      grossCharged += -amountMinor;
      const payer = accountFees(accountId);
      payer.charged += -amountMinor;
      payer.actions.add(consumptionId.toLowerCase());
      if (fill && consumption) payer.fills.add(consumption.parentActionId.toLowerCase());
    }
    if (kind === "REBATE_CREDIT") {
      rebatesPaid += amountMinor;
      accountFees(accountId).rebated += amountMinor;
    }
    if (kind === "BUDGET_DEBIT" && accountId.toLowerCase() === treasuryAccount) treasuryBudgetDebits += -amountMinor;
    if (kind === "CHARGE_CREDIT") {
      revenue += amountMinor;
      if (accountId.toLowerCase() === treasuryAccount) treasuryRevenue += amountMinor;
      byMarket.add(market?.marketKey ?? "UNATTRIBUTED", market ? marketLabel(market.marketKey) : "No listed market", amountMinor, consumptionId);
      byChannel.add(channel, REVENUE_CHANNEL_LABELS[channel], amountMinor, consumptionId);
      byAction.add(action ?? actionId, action ? FEE_ACTION_LABELS[action] : `Unrecognized action ${shortId(actionId)}`, amountMinor, consumptionId);
      byRecipient.add(
        accountId.toLowerCase(),
        accountId.toLowerCase() === treasuryAccount ? "Protocol fee account" : `Account ${shortId(accountId)}`,
        amountMinor,
        consumptionId,
      );
      if (consumption) {
        const bucket = revenueByVersion.get(consumption.version) ?? { revenue: BigInt(0), actions: new Set<string>() };
        bucket.revenue += amountMinor;
        bucket.actions.add(consumptionId.toLowerCase());
        revenueByVersion.set(consumption.version, bucket);
      }
    }
    entries.push({
      consumptionId,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      time: times.get(log.blockNumber) ?? null,
      kind,
      action: action ?? "UNRECOGNIZED",
      actionId,
      accountId,
      amountMinor: amountMinor.toString(),
      feeScheduleVersion: consumption?.version ?? null,
      fillId: fill && consumption ? consumption.parentActionId : null,
      channel,
      marketKey: market?.marketKey ?? null,
      notionalMinor: consumption ? consumption.notional.toString() : null,
      chargeRatePpm: consumption ? consumption.rate : null,
    });
  }
  entries.reverse();

  // Fee schedule history: one row per registered version, with its rates from the installed witness.
  const versionNumbers = [...new Set(registeredLogs.map((log) => Number(log.args.version ?? 0)).filter((version) => version > 0))].sort((a, b) => a - b);
  if (versionNumbers.length === 0 && active.source === "CHAIN") versionNumbers.push(...Array.from({ length: active.latestVersion }, (_, index) => index + 1));
  const views = await Promise.all(versionNumbers.map((version) => readFeeScheduleVersion(client, setryn, version, registry).catch(() => null)));
  const history: FeeScheduleHistoryEntry[] = views
    .filter((view): view is FeeScheduleVersionView => view !== null)
    .map((view) => {
      const registered = registeredLogs.find((log) => Number(log.args.version) === view.version);
      const activations = activeLogs
        .filter((log) => Number(log.args.newVersion) === view.version && log.blockNumber != null)
        .map((log) => times.get(log.blockNumber as bigint) ?? null)
        .filter((time): time is string => time !== null);
      const earned = revenueByVersion.get(view.version);
      return {
        version: view.version,
        status: view.status,
        feeModel: view.feeModel,
        makerFeeRatePpm: view.maker?.chargeRatePpm ?? null,
        takerFeeRatePpm: view.taker?.chargeRatePpm ?? null,
        makerFlatFeeMinor: view.maker?.flatChargeMinor ?? null,
        takerFlatFeeMinor: view.taker?.flatChargeMinor ?? null,
        maxChargeRatePpm: view.maxChargeRatePpm,
        witnessInstalled: view.witnessInstalled,
        registeredAt: registered?.blockNumber != null ? (times.get(registered.blockNumber) ?? null) : null,
        registeredTransaction: registered?.transactionHash ?? null,
        activatedAt: activations,
        revenueMinor: (earned?.revenue ?? BigInt(0)).toString(),
        actions: earned?.actions.size ?? 0,
      };
    })
    .reverse();

  const events: FeeScheduleEvent[] = [
    ...registeredLogs.map((log) => ({
      kind: "REGISTERED" as const,
      version: Number(log.args.version),
      detail: `Version ${Number(log.args.version)} registered (${registryStatusName(Number(log.args.initialStatus ?? 0)).toLowerCase()})`,
      operator: log.args.operator ?? null,
      block: log.blockNumber,
      index: log.logIndex ?? 0,
      transactionHash: log.transactionHash,
    })),
    ...statusLogs.map((log) => ({
      kind: "STATUS_CHANGED" as const,
      version: Number(log.args.version),
      detail: `Version ${Number(log.args.version)}: ${registryStatusName(Number(log.args.previousStatus ?? 0)).toLowerCase()} to ${registryStatusName(Number(log.args.newStatus ?? 0)).toLowerCase()}`,
      operator: log.args.operator ?? null,
      block: log.blockNumber,
      index: log.logIndex ?? 0,
      transactionHash: log.transactionHash,
    })),
    ...activeLogs.map((log) => ({
      kind: "ACTIVE_VERSION_CHANGED" as const,
      version: Number(log.args.newVersion),
      detail:
        Number(log.args.newVersion) === 0
          ? `Active version ${Number(log.args.previousVersion)} cleared`
          : `Active version ${Number(log.args.previousVersion) || "none"} to ${Number(log.args.newVersion)}`,
      operator: log.args.operator ?? null,
      block: log.blockNumber,
      index: log.logIndex ?? 0,
      transactionHash: log.transactionHash,
    })),
  ]
    .filter((event) => event.block != null && event.transactionHash != null)
    .sort((left, right) => (left.block === right.block ? right.index - left.index : (right.block as bigint) > (left.block as bigint) ? 1 : -1))
    .map((event) => ({
      kind: event.kind,
      version: event.version,
      detail: event.detail,
      operator: event.operator,
      time: times.get(event.block as bigint) ?? null,
      transactionHash: event.transactionHash as string,
    }));

  const byKind: KindBucket[] = (Object.values(FEE_LEDGER_KIND) as FeeLedgerKindName[]).map((kind) => ({
    kind,
    label: FEE_LEDGER_KIND_LABELS[kind],
    entries: kinds.get(kind)?.entries ?? 0,
    amountMinor: (kinds.get(kind)?.amount ?? BigInt(0)).toString(),
  }));

  const projection: TreasuryProjection = {
    chainId: setryn.chainId,
    headBlock: headBlock.toString(),
    checkedAt: new Date().toISOString(),
    settlementAsset: "USDC",
    account,
    feeSchedule: { feeScheduleId: setryn.feeScheduleId, registry, active, history, events },
    feeControl: control,
    revenue: {
      totals: {
        grossChargedMinor: grossCharged.toString(),
        revenueMinor: revenue.toString(),
        treasuryRevenueMinor: treasuryRevenue.toString(),
        rebatesPaidMinor: rebatesPaid.toString(),
        netTreasuryMinor: (treasuryRevenue - treasuryBudgetDebits).toString(),
        feeActions: consumptionIds.size,
        fills: feeFills.size,
        entries: entries.length,
      },
      byMarket: byMarket.list(),
      byChannel: byChannel.list(),
      byAction: byAction.list(),
      byRecipient: byRecipient.list(),
      byKind,
      unrecognized,
      entries: entries.slice(0, ENTRY_LIMIT),
      entriesTruncated: entries.length > ENTRY_LIMIT,
    },
  };
  return { projection, accounts };
}

/** The ledger build at the chain head, memoized per head block so polling viewers share one scan. */
async function readLedger(setryn: SetrynRuntime): Promise<LedgerBuild & { headBlock: bigint }> {
  const client = clientFor(setryn.rpcUrl);
  const headBlock = await client.getBlockNumber({ cacheTime: 0 });
  const holder = globalThis as unknown as Record<symbol, { key: string; value: Promise<LedgerBuild> } | undefined>;
  const key = `${setryn.fundedFeeEngine}:${setryn.feeScheduleId}:${headBlock}`;
  const hit = holder[CACHE_KEY];
  if (hit && hit.key === key) return { ...(await hit.value), headBlock };
  const value = buildProjection(client, setryn, headBlock).catch((error: unknown) => {
    if (holder[CACHE_KEY]?.value === value) holder[CACHE_KEY] = undefined;
    throw error;
  });
  holder[CACHE_KEY] = { key, value };
  return { ...(await value), headBlock };
}

/** The treasury projection at the chain head. */
export async function readTreasury(setryn: SetrynRuntime): Promise<TreasuryProjection> {
  return (await readLedger(setryn)).projection;
}

/* ------------------------------------------------------------------ */
/* Partner fee share                                                   */
/* ------------------------------------------------------------------ */

/** The partner terms the accrual needs; a partner deployment (lib/webhooks/partners.ts) satisfies it. */
export interface PartnerShareTerms {
  code: string;
  name: string;
  /** Share of the attributed accounts' net protocol fees, in basis points. */
  revShareBps: number;
  /** bytes32 trading account ids attributed to the partner. */
  attributedAccounts: readonly string[];
}

export interface PartnerAccrualRow {
  partner: string;
  name: string;
  revShareBps: number;
  attributedAccounts: number;
  /** Fee actions the attributed accounts paid (maker or taker legs). */
  feeActions: number;
  fills: number;
  /** Charges debited from the attributed accounts minus rebates credited to them, USDC minor units. */
  netFeesMinor: string;
  /** netFees x revShareBps / 10,000, rounded down, USDC minor units. */
  accruedMinor: string;
  /** No partner payout exists onchain yet, so nothing has been paid. */
  paidMinor: "0";
  status: "ACCRUED_UNPAID";
}

export interface PartnerAccrualReport {
  chainId: number;
  headBlock: string;
  checkedAt: string;
  /** Every figure is rebuilt from FundedFeeEngine ledger entries; nothing is modeled. */
  basis: "FUNDED_FEE_ENGINE_LEDGER";
  rows: PartnerAccrualRow[];
  totals: { netFeesMinor: string; accruedMinor: string; paidMinor: "0" };
}

/**
 * Fees attributed to each partner from the fee ledger: every charge debited from, and rebate credited to, an account the
 * partner attributes, times the partner's share. The share accrues and stays unpaid: no payout contract exists yet.
 */
export async function readPartnerAccruals(setryn: SetrynRuntime, partners: readonly PartnerShareTerms[]): Promise<PartnerAccrualReport> {
  const { accounts, headBlock } = await readLedger(setryn);
  let totalFees = BigInt(0);
  let totalAccrued = BigInt(0);
  const rows = partners.map((partner): PartnerAccrualRow => {
    let charged = BigInt(0);
    let rebated = BigInt(0);
    const actions = new Set<string>();
    const fills = new Set<string>();
    const attributed = new Set(partner.attributedAccounts.map((account) => account.toLowerCase()));
    for (const account of attributed) {
      const fees = accounts.get(account);
      if (!fees) continue;
      charged += fees.charged;
      rebated += fees.rebated;
      fees.actions.forEach((id) => actions.add(id));
      fees.fills.forEach((id) => fills.add(id));
    }
    const net = charged > rebated ? charged - rebated : BigInt(0);
    const bps = Number.isInteger(partner.revShareBps) && partner.revShareBps > 0 ? BigInt(partner.revShareBps) : BigInt(0);
    const accrued = (net * bps) / BigInt(10_000);
    totalFees += net;
    totalAccrued += accrued;
    return {
      partner: partner.code,
      name: partner.name,
      revShareBps: partner.revShareBps,
      attributedAccounts: attributed.size,
      feeActions: actions.size,
      fills: fills.size,
      netFeesMinor: net.toString(),
      accruedMinor: accrued.toString(),
      paidMinor: "0",
      status: "ACCRUED_UNPAID",
    };
  });
  return {
    chainId: setryn.chainId,
    headBlock: headBlock.toString(),
    checkedAt: new Date().toISOString(),
    basis: "FUNDED_FEE_ENGINE_LEDGER",
    rows,
    totals: { netFeesMinor: totalFees.toString(), accruedMinor: totalAccrued.toString(), paidMinor: "0" },
  };
}
