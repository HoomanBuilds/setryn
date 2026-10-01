import type { ActiveFeeSchedule, FeeActionName, FeeModelName, RegistryStatusName } from "@/lib/internal-gateway/fee-schedule";

/*
 * The treasury projection the /treasury page renders, built server-side from chain reads and events by
 * lib/treasury/revenue.ts. Amounts travel as decimal strings of settlement minor units (six decimals) so nothing is
 * rounded in transport; the page converts for display.
 */

/** FeeLedgerEntryKind, canonicalized explicitly from the Solidity enum. */
export const FEE_LEDGER_KIND = { 1: "CHARGE_DEBIT", 2: "CHARGE_CREDIT", 3: "BUDGET_DEBIT", 4: "REBATE_CREDIT" } as const;
export type FeeLedgerKindName = (typeof FEE_LEDGER_KIND)[keyof typeof FEE_LEDGER_KIND];

export const FEE_LEDGER_KIND_LABELS: Record<FeeLedgerKindName, string> = {
  CHARGE_DEBIT: "Charge (payer debit)",
  CHARGE_CREDIT: "Charge (recipient credit)",
  BUDGET_DEBIT: "Rebate budget debit",
  REBATE_CREDIT: "Rebate credit",
};

/** ClearingChannelKind, canonicalized explicitly; fee actions outside clearing are classed by their consumer. */
export const CLEARING_CHANNEL = { 1: "PUBLIC_BOOK", 2: "PRIVATE_RFQ", 3: "SEALED_AUCTION" } as const;
export type RevenueChannel = (typeof CLEARING_CHANNEL)[keyof typeof CLEARING_CHANNEL] | "SETTLEMENT" | "OTHER";

export const REVENUE_CHANNEL_LABELS: Record<RevenueChannel, string> = {
  PUBLIC_BOOK: "Public book",
  PRIVATE_RFQ: "Private RFQ",
  SEALED_AUCTION: "Sealed auction",
  SETTLEMENT: "Settlement",
  OTHER: "Other",
};

export interface TreasuryLedgerEntry {
  consumptionId: string;
  transactionHash: string;
  blockNumber: string;
  time: string | null;
  kind: FeeLedgerKindName;
  action: FeeActionName | "UNRECOGNIZED";
  actionId: string;
  accountId: string;
  /** Signed, in minor units: debits negative, credits positive. */
  amountMinor: string;
  feeScheduleVersion: number | null;
  /** The fill that paid the fee, when the fee action came from clearing. */
  fillId: string | null;
  channel: RevenueChannel;
  /** Catalog market id, or null when the fee action names no market this deployment lists. */
  marketKey: string | null;
  notionalMinor: string | null;
  chargeRatePpm: number | null;
}

export interface RevenueBucket {
  key: string;
  label: string;
  /** Sum of charge credits (revenue) in this bucket, in minor units. */
  revenueMinor: string;
  /** Fee actions (maker or taker legs) that credited revenue here. */
  actions: number;
}

export interface KindBucket {
  kind: FeeLedgerKindName;
  label: string;
  entries: number;
  /** Signed sum in minor units. */
  amountMinor: string;
}

export interface FeeScheduleHistoryEntry {
  version: number;
  status: RegistryStatusName;
  feeModel: FeeModelName;
  makerFeeRatePpm: number | null;
  takerFeeRatePpm: number | null;
  makerFlatFeeMinor: number | null;
  takerFlatFeeMinor: number | null;
  maxChargeRatePpm: number;
  witnessInstalled: boolean;
  registeredAt: string | null;
  registeredTransaction: string | null;
  /** Every time the active pointer moved onto this version. */
  activatedAt: string[];
  revenueMinor: string;
  actions: number;
}

export interface FeeScheduleEvent {
  kind: "REGISTERED" | "STATUS_CHANGED" | "ACTIVE_VERSION_CHANGED";
  version: number;
  detail: string;
  operator: string | null;
  time: string | null;
  transactionHash: string;
}

export interface TreasuryProjection {
  chainId: number;
  headBlock: string;
  checkedAt: string;
  settlementAsset: "USDC";
  account: {
    accountId: string;
    exists: boolean;
    /** The address CollateralVault lets withdraw: the account's controller. */
    controller: string | null;
    pendingController: string | null;
    /** The controller the deployment recorded, when it recorded one; it should equal `controller`. */
    configuredController: string | null;
    controllerSource: "RUNTIME" | "VAULT";
    postedMinor: string;
    lockedMinor: string;
    availableMinor: string;
  };
  feeSchedule: {
    feeScheduleId: string;
    registry: string;
    active: ActiveFeeSchedule;
    history: FeeScheduleHistoryEntry[];
    events: FeeScheduleEvent[];
  };
  /**
   * How the fee schedule can change on this network: the operator's own update on the local chain, or the governance
   * timelock everywhere else.
   */
  feeControl: {
    mode: "OPERATOR" | "GOVERNANCE_TIMELOCK";
    operator: string;
    reason: string;
  };
  revenue: {
    totals: {
      grossChargedMinor: string;
      revenueMinor: string;
      treasuryRevenueMinor: string;
      rebatesPaidMinor: string;
      netTreasuryMinor: string;
      feeActions: number;
      fills: number;
      entries: number;
    };
    byMarket: RevenueBucket[];
    byChannel: RevenueBucket[];
    byAction: RevenueBucket[];
    byRecipient: RevenueBucket[];
    byKind: KindBucket[];
    /** Ledger entries whose kind or action falls outside the canonical tables; shown, never counted. */
    unrecognized: number;
    entries: TreasuryLedgerEntry[];
    entriesTruncated: boolean;
  };
}
