import { createPublicClient, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import { runtimeMarketBySeries } from "@/lib/internal-gateway/runtime-markets";
import { serverReadTransport } from "@/lib/internal-gateway/rpc-transport";
import {
  ZERO_BYTES32,
  decodeAuctionKind,
  decodeAuctionPriceRule,
  decodeAuctionStatus,
  decodeAuctionTargetKind,
  decodeAuctionTieBreakRule,
  decodeBidStatus,
  decodeBondOutcome,
  decodeNoBidTreatment,
  decodeSide,
  safeInteger,
  type AuctionClearingResult,
  type AuctionRecord,
  type AuctionVersion,
  type BidRecord,
  type BidView,
  type Bytes32,
  type SolverRouteRecord,
} from "./types";

/*
 * Reads sealed auctions from the deployment's SealedAuctionHouse: every AuctionScheduled event from the deployment block,
 * each version's stored definition and status, its committed bids and, once cleared, its clearing result. Enums decode
 * through the explicit tables in types.ts. A runtime without an auction house has no auctions; nothing is generated.
 */

const auctionAbi = parseAbi([
  "struct AuctionDefinition { bytes32 namespaceId; bytes32 auctionKey; bytes32 initiatorOrderHash; bytes32 initiatorAccountId; uint128 initiatorMaximumFeeMinor; bytes32 executionModeId; uint8 kind; uint8 targetKind; bytes32 seriesId; bytes32 packageId; uint32 targetVersion; bool hasPackageLegCommitment; bytes32 packageLegsHash; uint8 auctionSide; bytes32 settlementAssetId; uint32 settlementAssetVersion; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 eligibilityPolicyHash; bytes32 capacityPolicyHash; bytes32 bondPolicyHash; bytes32 allocationPolicyHash; bytes32 guaranteeClassId; uint8 priceRule; uint8 tieBreakRule; uint8 noBidTreatment; uint8 unrevealedBondOutcome; uint8 losingBondOutcome; uint8 settlementFailureBondOutcome; uint128 totalLots; uint128 lotStep; uint16 maximumBids; uint64 commitOpensAt; uint64 commitClosesAt; uint64 revealClosesAt; uint64 clearDeadline; uint64 settlementDeadline; uint64 bondExpiry; bytes32 bondAssetId; uint32 bondBindingVersion; uint128 requiredBondAmount; bytes32 slashRecipientAccountId; uint128 maximumKeeperRewardMinor; bytes32 qualificationEvidenceHash; }",
  "struct AuctionVersion { AuctionDefinition definition; bytes32 definitionHash; bytes32 versionHash; uint32 version; uint8 status; uint32 commitmentCount; uint32 revealCount; bytes32 clearingResultHash; }",
  "struct BidCommitAuthorization { bytes32 auctionId; uint32 auctionVersion; address bidder; bytes32 bidderAccountId; uint256 nonce; bytes32 sealedBidHash; bytes32 eligibilityProofHash; uint64 deadline; bytes32 salt; }",
  "struct SealedBid { bytes32 auctionId; uint32 auctionVersion; address bidder; bytes32 bidderAccountId; bytes32 bidderOrderHash; uint256 nonce; uint8 side; uint128 lots; bool allowPartialAllocation; uint128 minimumFillLots; int128 priceTicks; uint128 maximumFeeMinor; bytes32 solverRouteId; bytes32 capacityEvidenceHash; bytes32 revealSalt; }",
  "struct BidRecord { BidCommitAuthorization authorization; SealedBid bid; bytes32 routeId; bytes32 bondLockId; uint8 status; uint128 allocatedLots; int128 allocationPriceTicks; }",
  "struct AuctionClearingResult { bytes32 auctionId; uint32 auctionVersion; bytes32 winningRouteBidId; int128 uniformPriceTicks; uint128 totalAllocatedLots; uint16 winnerCount; bytes32 allocationsHash; bytes32 resultHash; }",
  "struct SolverRoute { bytes32 auctionId; uint32 auctionVersion; address solver; bytes32 solverAccountId; bytes32 routeId; bytes32 packageLegsHash; bytes32 actionGraphHash; uint16 legCount; uint16 actionCount; int128 packageOutcomeTicks; uint128 maximumFeeMinor; bytes32 capacityLockId; bytes32 capacityCollateralId; uint128 capacityAmount; bytes32 capacityEvidenceHash; uint64 expiry; bytes32 guaranteeClassId; bytes32 salt; }",
  "struct SolverRouteRecord { SolverRoute route; bytes32 routeHash; bool revealed; }",
  "function getRoute(bytes32 routeId) view returns (SolverRouteRecord)",
  "function getAuction(bytes32 auctionId, uint32 version) view returns (AuctionVersion)",
  "function getBid(bytes32 bidId) view returns (BidRecord)",
  "function getClearingResult(bytes32 auctionId, uint32 version) view returns (AuctionClearingResult)",
  "event AuctionScheduled(bytes32 indexed auctionId, uint32 indexed version, bytes32 indexed versionHash, bytes32 definitionHash, bytes32 packageLegsHash, uint64 commitOpensAt, uint64 commitClosesAt, uint64 revealClosesAt)",
  "event BidCommitted(bytes32 indexed auctionId, uint32 indexed version, bytes32 indexed bidId, bytes32 sealedBidHash, bytes32 bondLockId)",
]);

type RawVersion = {
  definition: Record<string, unknown>;
  definitionHash: Hex;
  versionHash: Hex;
  version: number;
  status: number;
  commitmentCount: number;
  revealCount: number;
  clearingResultHash: Hex;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The auction house the runtime lists, under either field name, or null. */
export function auctionHouseOf(runtime: SetrynRuntime | null): Address | null {
  if (!runtime) return null;
  const record = runtime as unknown as Record<string, unknown>;
  const candidate = record.sealedAuctionHouse ?? record.auctionHouse;
  return typeof candidate === "string" && ADDRESS_PATTERN.test(candidate) ? (candidate as Address) : null;
}

function int(value: unknown, field: string): number {
  return safeInteger(typeof value === "bigint" || typeof value === "number" ? value : Number.NaN, field);
}

function decodeVersion(raw: RawVersion): AuctionVersion {
  const d = raw.definition;
  return {
    definition: {
      namespaceId: d.namespaceId as Bytes32,
      auctionKey: d.auctionKey as Bytes32,
      initiatorOrderHash: d.initiatorOrderHash as Bytes32,
      initiatorAccountId: d.initiatorAccountId as Bytes32,
      initiatorMaximumFeeMinor: int(d.initiatorMaximumFeeMinor, "initiatorMaximumFeeMinor"),
      executionModeId: d.executionModeId as Bytes32,
      kind: decodeAuctionKind(int(d.kind, "kind")),
      targetKind: decodeAuctionTargetKind(int(d.targetKind, "targetKind")),
      seriesId: d.seriesId as Bytes32,
      packageId: d.packageId as Bytes32,
      targetVersion: int(d.targetVersion, "targetVersion"),
      hasPackageLegCommitment: d.hasPackageLegCommitment === true,
      packageLegsHash: d.packageLegsHash as Bytes32,
      auctionSide: decodeSide(int(d.auctionSide, "auctionSide")),
      settlementAssetId: d.settlementAssetId as Bytes32,
      settlementAssetVersion: int(d.settlementAssetVersion, "settlementAssetVersion"),
      riskDomainId: d.riskDomainId as Bytes32,
      riskDomainVersion: int(d.riskDomainVersion, "riskDomainVersion"),
      feeScheduleId: d.feeScheduleId as Bytes32,
      feeScheduleVersion: int(d.feeScheduleVersion, "feeScheduleVersion"),
      eligibilityPolicyHash: d.eligibilityPolicyHash as Bytes32,
      capacityPolicyHash: d.capacityPolicyHash as Bytes32,
      bondPolicyHash: d.bondPolicyHash as Bytes32,
      allocationPolicyHash: d.allocationPolicyHash as Bytes32,
      guaranteeClassId: d.guaranteeClassId as Bytes32,
      priceRule: decodeAuctionPriceRule(int(d.priceRule, "priceRule")),
      tieBreakRule: decodeAuctionTieBreakRule(int(d.tieBreakRule, "tieBreakRule")),
      noBidTreatment: decodeNoBidTreatment(int(d.noBidTreatment, "noBidTreatment")),
      unrevealedBondOutcome: decodeBondOutcome(int(d.unrevealedBondOutcome, "unrevealedBondOutcome")),
      losingBondOutcome: decodeBondOutcome(int(d.losingBondOutcome, "losingBondOutcome")),
      settlementFailureBondOutcome: decodeBondOutcome(int(d.settlementFailureBondOutcome, "settlementFailureBondOutcome")),
      totalLots: int(d.totalLots, "totalLots"),
      lotStep: int(d.lotStep, "lotStep"),
      maximumBids: int(d.maximumBids, "maximumBids"),
      commitOpensAt: int(d.commitOpensAt, "commitOpensAt"),
      commitClosesAt: int(d.commitClosesAt, "commitClosesAt"),
      revealClosesAt: int(d.revealClosesAt, "revealClosesAt"),
      clearDeadline: int(d.clearDeadline, "clearDeadline"),
      settlementDeadline: int(d.settlementDeadline, "settlementDeadline"),
      bondExpiry: int(d.bondExpiry, "bondExpiry"),
      bondAssetId: d.bondAssetId as Bytes32,
      bondBindingVersion: int(d.bondBindingVersion, "bondBindingVersion"),
      requiredBondAmount: int(d.requiredBondAmount, "requiredBondAmount"),
      slashRecipientAccountId: d.slashRecipientAccountId as Bytes32,
      maximumKeeperRewardMinor: int(d.maximumKeeperRewardMinor, "maximumKeeperRewardMinor"),
      qualificationEvidenceHash: d.qualificationEvidenceHash as Bytes32,
    },
    definitionHash: raw.definitionHash as Bytes32,
    versionHash: raw.versionHash as Bytes32,
    version: int(raw.version, "version"),
    status: decodeAuctionStatus(int(raw.status, "status")),
    commitmentCount: int(raw.commitmentCount, "commitmentCount"),
    revealCount: int(raw.revealCount, "revealCount"),
    clearingResultHash: raw.clearingResultHash as Bytes32,
  };
}

function decodeBid(raw: {
  authorization: Record<string, unknown>;
  bid: Record<string, unknown>;
  routeId: Hex;
  bondLockId: Hex;
  status: number;
  allocatedLots: bigint;
  allocationPriceTicks: bigint;
}): BidRecord {
  const a = raw.authorization;
  const b = raw.bid;
  // Until reveal the house stores a zeroed SealedBid; it reads as null so sealed contents never pass for a price.
  const sealed = b.auctionId === ZERO_BYTES32;
  return {
    authorization: {
      auctionId: a.auctionId as Bytes32,
      auctionVersion: int(a.auctionVersion, "auctionVersion"),
      bidder: a.bidder as `0x${string}`,
      bidderAccountId: a.bidderAccountId as Bytes32,
      nonce: String(a.nonce),
      sealedBidHash: a.sealedBidHash as Bytes32,
      eligibilityProofHash: a.eligibilityProofHash as Bytes32,
      deadline: int(a.deadline, "deadline"),
      salt: a.salt as Bytes32,
    },
    bid: sealed
      ? null
      : {
          auctionId: b.auctionId as Bytes32,
          auctionVersion: int(b.auctionVersion, "auctionVersion"),
          bidder: b.bidder as `0x${string}`,
          bidderAccountId: b.bidderAccountId as Bytes32,
          bidderOrderHash: b.bidderOrderHash as Bytes32,
          nonce: String(b.nonce),
          side: decodeSide(int(b.side, "side")),
          lots: int(b.lots, "lots"),
          allowPartialAllocation: b.allowPartialAllocation === true,
          minimumFillLots: int(b.minimumFillLots, "minimumFillLots"),
          priceTicks: int(b.priceTicks, "priceTicks"),
          maximumFeeMinor: int(b.maximumFeeMinor, "maximumFeeMinor"),
          solverRouteId: b.solverRouteId as Bytes32,
          capacityEvidenceHash: b.capacityEvidenceHash as Bytes32,
          revealSalt: b.revealSalt as Bytes32,
        },
    routeId: raw.routeId as Bytes32,
    bondLockId: raw.bondLockId as Bytes32,
    status: decodeBidStatus(int(raw.status, "bidStatus")),
    allocatedLots: int(raw.allocatedLots, "allocatedLots"),
    allocationPriceTicks: int(raw.allocationPriceTicks, "allocationPriceTicks"),
  };
}

async function readRoute(client: PublicClient, house: Address, routeId: Bytes32): Promise<SolverRouteRecord | null> {
  try {
    const raw = (await client.readContract({ address: house, abi: auctionAbi, functionName: "getRoute", args: [routeId] })) as unknown as {
      route: Record<string, unknown>;
      routeHash: Hex;
      revealed: boolean;
    };
    const r = raw.route;
    return {
      route: {
        auctionId: r.auctionId as Bytes32,
        auctionVersion: int(r.auctionVersion, "auctionVersion"),
        solver: r.solver as `0x${string}`,
        solverAccountId: r.solverAccountId as Bytes32,
        routeId: r.routeId as Bytes32,
        packageLegsHash: r.packageLegsHash as Bytes32,
        actionGraphHash: r.actionGraphHash as Bytes32,
        legCount: int(r.legCount, "legCount"),
        actionCount: int(r.actionCount, "actionCount"),
        packageOutcomeTicks: int(r.packageOutcomeTicks, "packageOutcomeTicks"),
        maximumFeeMinor: int(r.maximumFeeMinor, "maximumFeeMinor"),
        capacityLockId: r.capacityLockId as Bytes32,
        capacityCollateralId: r.capacityCollateralId as Bytes32,
        capacityAmount: int(r.capacityAmount, "capacityAmount"),
        capacityEvidenceHash: r.capacityEvidenceHash as Bytes32,
        expiry: int(r.expiry, "expiry"),
        guaranteeClassId: r.guaranteeClassId as Bytes32,
        salt: r.salt as Bytes32,
      },
      routeHash: raw.routeHash as Bytes32,
      revealed: raw.revealed === true,
    };
  } catch {
    return null;
  }
}

const CLEARED = new Set(["CLEARED", "SETTLED", "FAILED"]);
const clients = new Map<string, PublicClient>();

function clientFor(rpcUrl: string, chainId: number): PublicClient {
  const key = `${chainId}:${rpcUrl}`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ transport: serverReadTransport(rpcUrl, chainId, { batch: true, timeout: 8_000 }) }) as PublicClient;
    clients.set(key, client);
  }
  return client;
}

/** Every auction version the house has scheduled, newest first. */
export async function readAuctions(runtime: SetrynRuntime, house: Address): Promise<AuctionRecord[]> {
  const client = clientFor(runtime.rpcUrl, runtime.chainId);
  const fromBlock = BigInt(runtime.deploymentBlock ?? 0);
  const [scheduled, commitments] = await Promise.all([
    client.getContractEvents({ address: house, abi: auctionAbi, eventName: "AuctionScheduled", fromBlock, toBlock: "latest" }),
    client.getContractEvents({ address: house, abi: auctionAbi, eventName: "BidCommitted", fromBlock, toBlock: "latest" }),
  ]);
  const records = await Promise.all(
    scheduled.map(async (log): Promise<AuctionRecord | null> => {
      const auctionId = log.args.auctionId;
      const version = log.args.version;
      if (!auctionId || version === undefined) return null;
      const raw = (await client.readContract({ address: house, abi: auctionAbi, functionName: "getAuction", args: [auctionId, version] })) as unknown as RawVersion;
      const decoded = decodeVersion(raw);
      const bidLogs = commitments.filter((entry) => entry.args.auctionId?.toLowerCase() === auctionId.toLowerCase() && entry.args.version === version);
      const bids: BidView[] = await Promise.all(
        bidLogs
          .filter((entry) => entry.args.bidId)
          .map(async (entry) => {
            const bid = await client.readContract({ address: house, abi: auctionAbi, functionName: "getBid", args: [entry.args.bidId as Hex] });
            const record = decodeBid(bid as unknown as Parameters<typeof decodeBid>[0]);
            const route = record.routeId !== ZERO_BYTES32 ? await readRoute(client, house, record.routeId) : null;
            return {
              id: entry.args.bidId as Bytes32,
              record,
              route,
              committedBlock: Number(entry.blockNumber ?? BigInt(0)),
              transactionHash: entry.transactionHash ?? "",
            };
          }),
      );
      let result: AuctionClearingResult | null = null;
      if (CLEARED.has(decoded.status) && decoded.clearingResultHash !== ZERO_BYTES32) {
        const raw = (await client.readContract({ address: house, abi: auctionAbi, functionName: "getClearingResult", args: [auctionId, version] })) as unknown as Record<string, unknown>;
        result = {
          auctionId: raw.auctionId as Bytes32,
          auctionVersion: int(raw.auctionVersion, "auctionVersion"),
          winningRouteBidId: raw.winningRouteBidId as Bytes32,
          uniformPriceTicks: int(raw.uniformPriceTicks, "uniformPriceTicks"),
          totalAllocatedLots: int(raw.totalAllocatedLots, "totalAllocatedLots"),
          winnerCount: int(raw.winnerCount, "winnerCount"),
          allocationsHash: raw.allocationsHash as Bytes32,
          resultHash: raw.resultHash as Bytes32,
        };
      }
      const market = decoded.definition.targetKind === "SERIES" ? runtimeMarketBySeries(runtime, decoded.definition.seriesId) : null;
      return {
        id: auctionId as Bytes32,
        version: decoded,
        marketId: market?.marketKey ?? null,
        bids,
        result,
        scheduledBlock: Number(log.blockNumber ?? BigInt(0)),
        transactionHash: log.transactionHash ?? "",
      };
    }),
  );
  return records
    .filter((record): record is AuctionRecord => record !== null)
    .sort((left, right) => right.version.definition.commitOpensAt - left.version.definition.commitOpensAt);
}

export const LIVE_STATUSES = new Set(["SCHEDULED", "COMMIT_OPEN", "REVEAL_OPEN", "READY_TO_CLEAR", "CLEARED"]);
