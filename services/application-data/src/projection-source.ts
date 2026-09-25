import type { ProjectionState } from "@setryn/indexer";
import type { AccountId, Bytes32, JsonObject, ProtocolEventDomain } from "@setryn/internal-schemas";

import type { IndexedViewSource } from "./ports.ts";
import type { EconomicView, Provenance, ReceiptView } from "./types.ts";

export interface ProjectionSnapshotSource {
  snapshot(): Promise<{
    readonly chainId: number;
    readonly blockNumber: bigint | null;
    readonly blockHash: Bytes32 | null;
    readonly observedAt: string;
    readonly state: ProjectionState;
  }>;
}

export class IndexedProjectionViewSource implements IndexedViewSource {
  readonly #source: ProjectionSnapshotSource;

  constructor(source: ProjectionSnapshotSource) {
    this.#source = source;
  }

  async loadIndexedView(accountId?: AccountId) {
    const snapshot = await this.#source.snapshot();
    const provenance: Provenance = {
      kind: "indexed-event",
      source: "setryn-indexer-projection",
      chainId: snapshot.chainId,
      blockNumber: snapshot.blockNumber,
      blockHash: snapshot.blockHash,
      observedAt: snapshot.observedAt,
    };
    if (!accountId) {
      return { account: null, indexerBlockNumber: snapshot.blockNumber, provenance: [provenance] };
    }
    const account = snapshot.state.accounts.get(`${snapshot.chainId}:${accountId}`);
    const collateral = [...snapshot.state.balances.values()]
      .filter((balance) => balance.chainId === snapshot.chainId && balance.accountId === accountId)
      .map((balance) => ({
        collateralId: balance.collateralId,
        total: balance.total,
        preTradeLocked: balance.preTradeLocked,
        terminalReserved: balance.terminalReserved,
        terminalClaimBacking: balance.terminalClaimBacking,
        available: availableCollateral(balance.total, balance.preTradeLocked, balance.terminalReserved, balance.terminalClaimBacking),
        updatedAtBlock: balance.updatedAtBlock,
      }));
    return {
      account: {
        accountId,
        controller: account?.controller ?? null,
        collateral,
        positions: economic(snapshot.state, snapshot.chainId, "positions", accountId),
        orders: transitions(snapshot.state, snapshot.chainId, "orders", accountId),
        lifecycle: transitions(snapshot.state, snapshot.chainId, "lifecycle", accountId),
        receipts: receipts(snapshot.state, snapshot.chainId, accountId),
      },
      indexerBlockNumber: snapshot.blockNumber,
      provenance: [provenance],
    };
  }
}

function economic(
  state: ProjectionState,
  chainId: number,
  domain: ProtocolEventDomain,
  accountId: AccountId,
): EconomicView[] {
  return [...state.economicSubjects.values()]
    .filter((subject) => subject.chainId === chainId && subject.domain === domain)
    .map((subject) => {
      const details = state.protocolSubjects.get(`${chainId}:${domain}:${subject.subjectId}`)?.latestPayload ?? {};
      return { subject, details };
    })
    .filter(({ details }) => belongsToAccount(details, accountId))
    .map(({ subject, details }) => ({
      id: subject.subjectId,
      status: subject.status,
      originalQuantity: subject.originalQuantity,
      remainingQuantity: subject.remainingQuantity,
      cumulativeAmount: subject.cumulativeAmount,
      sequence: subject.sequence,
      updatedAtBlock: subject.updatedAtBlock,
      details,
    }));
}

function transitions(
  state: ProjectionState,
  chainId: number,
  domain: ProtocolEventDomain,
  accountId: AccountId,
): EconomicView[] {
  return [...state.protocolSubjects.values()]
    .filter((subject) => subject.chainId === chainId && subject.domain === domain && belongsToAccount(subject.latestPayload, accountId))
    .map((subject) => ({
      id: subject.subjectId,
      status: stringValue(subject.latestPayload.status) ?? stringValue(subject.latestPayload.newStatus),
      originalQuantity: amountValue(subject.latestPayload.originalQuantity),
      remainingQuantity: amountValue(subject.latestPayload.remainingQuantity),
      cumulativeAmount: amountValue(subject.latestPayload.cumulativeAmount) ?? "0",
      sequence: subject.transitionCount,
      updatedAtBlock: subject.updatedAtBlock,
      details: subject.latestPayload,
    }));
}

function receipts(state: ProjectionState, chainId: number, accountId: AccountId): ReceiptView[] {
  return [...state.protocolSubjects.values()]
    .filter((subject) => subject.chainId === chainId && subject.domain === "receipts" && belongsToAccount(subject.latestPayload, accountId))
    .map((subject) => ({
      receiptId: subject.subjectId,
      status: stringValue(subject.latestPayload.status) ?? stringValue(subject.latestPayload.newStatus),
      sequence: subject.transitionCount,
      updatedAtBlock: subject.updatedAtBlock,
      details: subject.latestPayload,
    }));
}

function belongsToAccount(payload: JsonObject, accountId: AccountId): boolean {
  return ["accountId", "longAccountId", "shortAccountId", "payerAccountId", "receiverAccountId", "actorAccountId"]
    .some((key) => payload[key] === accountId);
}

function availableCollateral(total: string, ...reserved: string[]): string {
  const available = BigInt(total) - reserved.reduce((sum, value) => sum + BigInt(value), 0n);
  if (available < 0n) throw new Error("indexed collateral reservations exceed total collateral");
  return available.toString();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function amountValue(value: unknown): string | null {
  return typeof value === "string" && /^-?[0-9]+$/.test(value) ? value : null;
}
