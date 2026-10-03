import type {
  LifecycleActionKey,
  LifecycleActionState,
  OnchainPositionLifecycle,
  PositionLifecyclePhase,
} from "@/lib/internal-gateway/types";

/*
 * What a holder can do at each point of a dated position's terminal lifecycle, from the onchain lifecycle read and the
 * chain clock. Every unavailable action names the condition that has to change, so a disabled button is never a guess.
 * The gateway still simulates each call before signing, so a contract rejection surfaces with its own reason.
 */

export interface LifecycleActionView extends LifecycleActionState {
  key: LifecycleActionKey;
  label: string;
  /** One-line description of what the action does onchain. */
  effect: string;
}

export type LifecycleTone = "live" | "window" | "closed" | "attention";

export const PHASE_COPY: Record<PositionLifecyclePhase, { label: string; tone: LifecycleTone; detail: string }> = {
  LIVE: { label: "Live", tone: "live", detail: "Trading is open. The fixing window has not started." },
  AWAITING_FIXING: {
    label: "Awaiting fixing",
    tone: "window",
    detail: "The fixing window is open or passed and no final fixing has been accepted onto the position.",
  },
  FIXED_AWAITING_ELECTION: {
    label: "Fixed, awaiting election",
    tone: "attention",
    detail: "The final fixing is on the position. The long holder elects before the exercise cutoff or the lots lapse.",
  },
  EXERCISED: {
    label: "Exercised",
    tone: "attention",
    detail: "The holder exercised against the final fixing. The settlement record is not written yet.",
  },
  SETTLED: { label: "Settled", tone: "closed", detail: "The cash settlement coordinator recorded the terminal transfer." },
  LAPSED: { label: "Lapsed", tone: "closed", detail: "Unelected lots lapsed with no transfer and both reservations were released." },
  CLAIM_AVAILABLE: {
    label: "Claim available",
    tone: "attention",
    detail: "A terminal claim is open for this account. Claim it to move the amount into the account.",
  },
  CLOSED: { label: "Closed", tone: "closed", detail: "The position was unwound or replaced before its terminal outcome." },
};

/** Chain timestamps are shown in UTC with the day, since the terminal schedule crosses the trading day. */
export function chainTimeLabel(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${day} ${date.toISOString().slice(11, 16)} UTC`;
}

function clockLabel(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

function seconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

const TERMINAL_STATUSES = new Set(["Settled", "Lapsed", "TerminalClaim", "ClosedByUnwind", "Replaced", "CancelledByDisruption", "Abandoned"]);
const CLOSED_PHASES = new Set<PositionLifecyclePhase>(["CLOSED"]);

function unavailable(reason: string): LifecycleActionState {
  return { available: false, reason };
}

const AVAILABLE: LifecycleActionState = { available: true, reason: null };

function exerciseState(view: OnchainPositionLifecycle, now: number): LifecycleActionState {
  const { schedule, fixing } = view;
  if (view.exercisePolicy !== "HOLDER_ELECTION") return unavailable("This series settles automatically; there is no holder election.");
  if (view.settlement || TERMINAL_STATUSES.has(view.status) || view.remainingLots === 0) {
    return unavailable(view.exercisedLots > 0 ? "Already exercised." : "No lots remain to elect on this position.");
  }
  if (!view.holdsElection) {
    return unavailable("Only the long holder elects. This account is short and takes the holder's election outcome.");
  }
  const opens = seconds(schedule.exerciseOpensAt);
  const cutoff = seconds(schedule.exerciseCutoffAt);
  const corrections = seconds(schedule.correctionCutoffAt);
  if (now > cutoff) {
    return unavailable(
      `Election closed at ${clockLabel(schedule.exerciseCutoffAt)}. Unelected lots lapse with no transfer; any account can Finalize the lapse.`,
    );
  }
  if (!fixing.acceptedOnPosition) {
    if (cutoff < corrections) {
      return unavailable(
        `Election opens after the final fixing is accepted onto the position, which happens only after corrections close at ${clockLabel(schedule.correctionCutoffAt)}. This series' election window closes earlier, at ${clockLabel(schedule.exerciseCutoffAt)}.`,
      );
    }
    if (fixing.status === "PENDING") {
      return unavailable(
        now < seconds(schedule.fixingWindowOpen)
          ? `Election opens after the final fixing at ${clockLabel(schedule.correctionCutoffAt)}. The fixing window opens ${clockLabel(schedule.fixingWindowOpen)}.`
          : `Election opens after the final fixing at ${clockLabel(schedule.correctionCutoffAt)}. No fixing evidence has been submitted yet.`,
      );
    }
    if (fixing.status === "DISPUTED") return unavailable("The fixing is disputed; election waits for its resolution.");
    if (now < corrections) {
      return unavailable(`Election opens after the final fixing at ${clockLabel(schedule.correctionCutoffAt)}, when corrections close.`);
    }
  }
  if (now < opens) return unavailable(`Election opens ${clockLabel(schedule.exerciseOpensAt)}.`);
  return AVAILABLE;
}

function settleState(view: OnchainPositionLifecycle, now: number): LifecycleActionState {
  const { schedule, fixing, settlement } = view;
  if (settlement) {
    return unavailable(
      settlement.mode === "LAPSED"
        ? `Lapsed ${chainTimeLabel(settlement.finalizedAt)} with no transfer.`
        : `Settled ${chainTimeLabel(settlement.finalizedAt)}.`,
    );
  }
  if (CLOSED_PHASES.has(view.phase)) return unavailable("The position was unwound; there is nothing to settle.");
  if (view.status === "Lapsed") return unavailable("The lots lapsed; Finalize records the lapse.");
  const final = seconds(schedule.finalResolutionAt);
  if (now >= final) return unavailable(`Normal settlement closed at final resolution, ${clockLabel(schedule.finalResolutionAt)}. Use Finalize.`);
  if (view.exercisePolicy === "HOLDER_ELECTION" && view.exercisedLots === 0 && view.status !== "SettlementReady") {
    return unavailable(
      view.holdsElection
        ? `Settle opens once the holder exercises in the election window, ${clockLabel(schedule.exerciseOpensAt).slice(0, 5)}–${clockLabel(schedule.exerciseCutoffAt)}.`
        : `Waiting for the long holder's election. Unelected lots lapse after ${clockLabel(schedule.exerciseCutoffAt)} through Finalize.`,
    );
  }
  if (fixing.status === "PENDING") return unavailable("No fixing evidence has been submitted for this series yet.");
  if (fixing.status === "DISPUTED") return unavailable("The fixing is disputed; settlement waits for its resolution.");
  if (fixing.status === "PROPOSED" && now < seconds(schedule.correctionCutoffAt)) {
    return unavailable(`Settlement opens when corrections close at ${clockLabel(schedule.correctionCutoffAt)}.`);
  }
  return AVAILABLE;
}

function claimState(view: OnchainPositionLifecycle, releasable: number): LifecycleActionState & { label: string } {
  const settlement = view.settlement;
  if (!settlement) {
    return { ...unavailable("Claims and released collateral appear once Settle or Finalize writes the settlement record."), label: "Claim" };
  }
  const claim = settlement.claim;
  if (claim && claim.receivable) {
    return claim.status === "ACTIVE"
      ? { ...AVAILABLE, label: "Claim" }
      : { ...unavailable("The terminal claim is already paid."), label: "Claim" };
  }
  if (claim && !claim.receivable && claim.status === "ACTIVE") {
    return { ...unavailable("This account owes the open claim; the receiver or any keeper completes it."), label: "Claim" };
  }
  // Done once this position's release was withdrawn, so free collateral the account holds for other reasons is not offered.
  if (view.releaseWithdrawnUsd > 0 && releasedCollateral(view) - view.releaseWithdrawnUsd < 0.01) {
    return { ...unavailable(`Withdrew the ${view.releaseWithdrawnUsd.toFixed(2)} USDC this settlement released to the wallet.`), label: "Withdrawn" };
  }
  return releasable > 0
    ? { ...AVAILABLE, label: "Withdraw" }
    : { ...unavailable("The collateral this settlement released is no longer available to withdraw."), label: "Withdraw" };
}

function finalizeState(view: OnchainPositionLifecycle, now: number): LifecycleActionState {
  const { schedule, settlement } = view;
  if (settlement) return unavailable(`Completed ${chainTimeLabel(settlement.finalizedAt)}.`);
  if (CLOSED_PHASES.has(view.phase)) return unavailable("The position was unwound; there is nothing to finalize.");
  if (view.status === "Lapsed") return AVAILABLE;
  const final = seconds(schedule.finalResolutionAt);
  // Holder election: once the cutoff passes without an election, any account lapses the unelected lots and records it.
  const electionLapse =
    view.exercisePolicy === "HOLDER_ELECTION" && (view.status === "Live" || view.status === "Fixing") && now > seconds(schedule.exerciseCutoffAt);
  if (electionLapse && now < final) return AVAILABLE;
  if (now < final) {
    return unavailable(`Final resolution is ${chainTimeLabel(schedule.finalResolutionAt)}. After it any account can complete the position.`);
  }
  return AVAILABLE;
}

/** Collateral a completed settlement returned to this account: its released reservation plus any transfer it received. */
function releasedCollateral(view: OnchainPositionLifecycle): number {
  if (!view.settlement) return 0;
  return view.settlement.releasedUsd + Math.max(0, view.settlement.transferUsd);
}

/**
 * Collateral a completed settlement returned to this account that is still to withdraw: what it released less what was
 * already withdrawn for this position, capped at the account's available balance.
 */
export function releasableCollateral(view: OnchainPositionLifecycle, available: number): number {
  const outstanding = releasedCollateral(view) - view.releaseWithdrawnUsd;
  return Math.max(0, Math.floor(Math.min(available, outstanding) * 100) / 100);
}

export function lifecycleActions(view: OnchainPositionLifecycle, nowMs: number, availableCollateral: number): LifecycleActionView[] {
  const now = Math.floor(nowMs / 1000);
  const claim = claimState(view, releasableCollateral(view, availableCollateral));
  return [
    {
      key: "EXERCISE",
      label: "Exercise",
      effect:
        view.projectedPayoffUsd !== null && view.projectedPayoffUsd < 0
          ? `At this fixing exercising pays ${Math.abs(view.projectedPayoffUsd).toFixed(2)} USDC out of this account; letting the lots lapse pays nothing.`
          : view.fixing.acceptedOnPosition
            ? "Elect the remaining lots against the final fixing."
            : "Accept the final fixing onto the position through the settlement coordinator, then elect the remaining lots.",
      ...exerciseState(view, now),
    },
    { key: "SETTLE", label: "Settle", effect: "Write the normal settlement record and pay the fixed transfer.", ...settleState(view, now) },
    {
      key: "CLAIM",
      label: claim.label,
      effect: claim.label === "Claim" ? "Pay the open terminal claim into this account." : "Withdraw the released collateral to the wallet.",
      available: claim.available,
      reason: claim.reason,
    },
    {
      key: "FINALIZE",
      label: "Finalize",
      effect: "Complete the position through the permissionless terminal path; unelected lots lapse.",
      ...finalizeState(view, now),
    },
  ];
}

/** The next dated boundary on the position's terminal schedule, for a compact countdown. */
export function nextBoundary(view: OnchainPositionLifecycle, nowMs: number): { label: string; at: string } | null {
  if (view.settlement || CLOSED_PHASES.has(view.phase)) return null;
  const { schedule } = view;
  const boundaries: { label: string; at: string }[] = [
    { label: "Last trade", at: schedule.lastTradingAt },
    { label: "Fixing window opens", at: schedule.fixingWindowOpen },
    { label: "Election opens", at: schedule.exerciseOpensAt },
    { label: "Election closes", at: schedule.exerciseCutoffAt },
    { label: "Corrections close", at: schedule.correctionCutoffAt },
    { label: "Final resolution", at: schedule.finalResolutionAt },
  ];
  return boundaries.find((boundary) => Date.parse(boundary.at) > nowMs) ?? null;
}
