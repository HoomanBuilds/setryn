import type { SettlementStage } from "./types";

export interface StageCopy {
  label: string;
  detail: string;
  /** Off the main path: a failure, fallback or recovery branch. */
  branch: boolean;
}

/** Copy for the dated settlement state machine. Success is only ever claimed at RECONCILED. */
export const STAGE_COPY: Record<SettlementStage, StageCopy> = {
  LIVE: { label: "Live", detail: "Open and tradable ahead of its fixing window.", branch: false },
  FIXING_WINDOW: { label: "Fixing window", detail: "Inside the observation window ahead of the print.", branch: false },
  FIXING_OBSERVED: { label: "Fixing observed", detail: "The committed fixing record is observed.", branch: false },
  FIXING_UNAVAILABLE: {
    label: "Fixing unavailable",
    detail: "The print passed without a committed record; the series fallback applies.",
    branch: true,
  },
  PAYOUT_COMPUTED: { label: "Payout computed", detail: "Payout calculated from the observed fixing.", branch: false },
  CHALLENGE_OR_FALLBACK: {
    label: "Challenge or fallback",
    detail: "A challenge or fallback path is running before settlement.",
    branch: true,
  },
  SETTLING: { label: "Settling", detail: "Settlement transaction submitted.", branch: false },
  INCLUDED: { label: "Included", detail: "Settlement included onchain.", branch: false },
  SUBMISSION_UNKNOWN: {
    label: "Submission unknown",
    detail: "Inclusion is not yet known; reconciled from chain state, never resubmitted blindly.",
    branch: true,
  },
  RECONCILING: { label: "Reconciling", detail: "Payout and receipt are checked against chain state.", branch: false },
  RECONCILED: { label: "Reconciled", detail: "Terminal: payout, receipt and account state agree.", branch: false },
  MANUAL_INTERVENTION: {
    label: "Manual intervention",
    detail: "Reconciliation needs an operator; the permissionless completion path stays open.",
    branch: true,
  },
};
