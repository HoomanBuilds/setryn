import { createPublicClient, http, type AbiEvent, type Hex } from "viem";
import { atomicClearingAbi, orderStateAbi } from "@/lib/internal-gateway/protocol";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import type { PartnerDeployment } from "./partners";

/**
 * Partner revenue reconciliation. Fills are read from the deployment's chain (FillCleared, the same record the
 * platform's fills and receipts are rebuilt from); a fill side is attributed to a partner when the order's account is in the
 * partner's attributed accounts. Protocol fees are OBSERVED from the fill record; the partner share is MODELED as
 * `revShareBps` of the attributed side's net fee. No payout exists onchain, so every payout is unsettled.
 */
const getFill = atomicClearingAbi.find((item) => item.type === "function" && item.name === "getFill");
if (!getFill || getFill.type !== "function") throw new Error("atomicClearingAbi.getFill is missing");

const fillClearedEvent = {
  type: "event",
  name: "FillCleared",
  inputs: [
    { name: "fillId", type: "bytes32", indexed: true },
    { name: "record", type: "tuple", indexed: false, components: getFill.outputs[0].components },
    { name: "submitter", type: "address", indexed: true },
  ],
} as const satisfies AbiEvent;

export interface AttributedFill {
  fillId: string;
  partner: string;
  transactionHash: string;
  blockNumber: string;
  clearedAt: string;
  lots: number;
  priceTicks: string;
  role: "taker" | "maker" | "both";
  accountId: string;
  /** Net protocol fee (charge minus rebate) of the attributed side, USDC minor units (6 dp). */
  feeMinor: string;
  /** MODELED partner share, USDC minor units. */
  modeledShareMinor: string;
}

export interface PartnerRevenueRow {
  partner: string;
  name: string;
  revShareBps: number;
  fills: number;
  lots: number;
  feesMinor: string;
  modeledShareMinor: string;
  status: "UNSETTLED_MODELED";
}

export interface RevenueReport {
  available: boolean;
  reason: string | null;
  chainId: number | null;
  scannedToBlock: string | null;
  totalFills: number;
  rows: PartnerRevenueRow[];
  fills: AttributedFill[];
}

export async function buildRevenueReport(partners: readonly PartnerDeployment[]): Promise<RevenueReport> {
  let runtime;
  try {
    runtime = await readRuntime();
  } catch {
    return { available: false, reason: "The deployment runtime is not available.", chainId: null, scannedToBlock: null, totalFills: 0, rows: [], fills: [] };
  }
  const client = createPublicClient({ transport: http(runtime.rpcUrl) });
  let head: bigint;
  let logs;
  try {
    head = await client.getBlockNumber();
    logs = await client.getLogs({ address: runtime.atomicClearingEngine as Hex, event: fillClearedEvent, fromBlock: BigInt(runtime.deploymentBlock ?? 0), toBlock: head });
  } catch {
    return { available: false, reason: "The chain RPC is unreachable.", chainId: runtime.chainId, scannedToBlock: null, totalFills: 0, rows: [], fills: [] };
  }

  const owners = new Map<string, PartnerDeployment>();
  for (const partner of partners) for (const account of partner.attributedAccounts) owners.set(account.toLowerCase(), partner);
  const orderAccounts = new Map<string, string>();
  const accountOf = async (orderHash: Hex): Promise<string> => {
    const cached = orderAccounts.get(orderHash);
    if (cached) return cached;
    const record = await client.readContract({ address: runtime.orderState as Hex, abi: orderStateAbi, functionName: "getOrder", args: [orderHash] });
    const account = record.order.accountId.toLowerCase();
    orderAccounts.set(orderHash, account);
    return account;
  };

  const fills: AttributedFill[] = [];
  for (const log of logs) {
    const record = log.args.record;
    if (!record || !log.args.fillId) continue;
    const [takerAccount, makerAccount] = await Promise.all([accountOf(record.takerOrderHash), accountOf(record.makerOrderHash)]);
    const takerPartner = owners.get(takerAccount);
    const makerPartner = owners.get(makerAccount);
    const takerFee = record.takerFeeChargeMinor - record.takerFeeRebateMinor;
    const makerFee = record.makerFeeChargeMinor - record.makerFeeRebateMinor;
    const sides: { partner: PartnerDeployment; role: AttributedFill["role"]; account: string; fee: bigint }[] = [];
    if (takerPartner && makerPartner && takerPartner.code === makerPartner.code) {
      sides.push({ partner: takerPartner, role: "both", account: takerAccount, fee: takerFee + makerFee });
    } else {
      if (takerPartner) sides.push({ partner: takerPartner, role: "taker", account: takerAccount, fee: takerFee });
      if (makerPartner) sides.push({ partner: makerPartner, role: "maker", account: makerAccount, fee: makerFee });
    }
    for (const side of sides) {
      fills.push({
        fillId: log.args.fillId,
        partner: side.partner.code,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        clearedAt: new Date(Number(record.clearedAt) * 1_000).toISOString(),
        lots: Number(record.fillLots),
        priceTicks: record.executionPriceTicks.toString(),
        role: side.role,
        accountId: side.account,
        feeMinor: side.fee.toString(),
        modeledShareMinor: ((side.fee * BigInt(side.partner.revShareBps)) / BigInt(10_000)).toString(),
      });
    }
  }

  const rows = partners.map((partner): PartnerRevenueRow => {
    const own = fills.filter((fill) => fill.partner === partner.code);
    return {
      partner: partner.code,
      name: partner.name,
      revShareBps: partner.revShareBps,
      fills: own.length,
      lots: own.reduce((sum, fill) => sum + fill.lots, 0),
      feesMinor: own.reduce((sum, fill) => sum + BigInt(fill.feeMinor), BigInt(0)).toString(),
      modeledShareMinor: own.reduce((sum, fill) => sum + BigInt(fill.modeledShareMinor), BigInt(0)).toString(),
      status: "UNSETTLED_MODELED",
    };
  });
  return {
    available: true,
    reason: null,
    chainId: runtime.chainId,
    scannedToBlock: head.toString(),
    totalFills: logs.length,
    rows,
    fills: fills.reverse().slice(0, 200),
  };
}
