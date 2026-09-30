"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, CircleAlert, CircleCheck, Clock3, LoaderCircle } from "lucide-react";
import { BUTTON_INK, BUTTON_QUIET, CopyButton, middleTruncate } from "@/components/activity/ledger-ui";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { PhaseTag, SideTag, TrustRow, signedUsd, toneOf, usd } from "@/components/positions/parts";
import { useConfirmStep } from "@/components/terminal/confirm-step";
import { positionHref, receiptHref } from "@/lib/positions/dossier";
import { formatCountdownMs } from "@/lib/settlements/calendar";
import { useConfirmationPrefs } from "@/lib/settings/preferences";
import type { LifecycleActionKey, OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import { platformNow } from "@/lib/terminal/clock";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import { PHASE_COPY, chainTimeLabel, lifecycleActions, nextBoundary, type LifecycleActionView } from "./election";

/** Chain time, re-read every second so windows open and close on screen without a refresh. */
function useChainNow(initialMs: number): number {
  const [now, setNow] = useState(initialMs);
  useEffect(() => {
    const tick = () => setNow(platformNow());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function clock(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)}`;
}

function fixingValue(view: OnchainPositionLifecycle): string {
  const { fixing } = view;
  if (fixing.resolution === "TERMINAL_DISRUPTION") return "None, terminal fallback";
  if (fixing.value === null) return fixing.status === "PENDING" ? "Not yet submitted" : "Unavailable";
  const value = formatNumber(fixing.value, 2);
  if (fixing.status === "FINALIZED") return `${value} final`;
  return `${value} ${fixing.status === "DISPUTED" ? "disputed" : "proposed"}`;
}

const CONFIRM_COPY: Record<LifecycleActionKey, string> = {
  EXERCISE: "Confirm exercise",
  SETTLE: "Confirm settlement",
  CLAIM: "Confirm",
  FINALIZE: "Confirm finalize",
};

interface Outcome {
  tone: "ok" | "error";
  text: string;
  transactionHash?: string;
}

/**
 * A held position's terminal lifecycle, read from chain: the onchain state, the fixing, the election window and the
 * projected payoff at the fixing, with the four actions a holder or any keeper can take. Every action is signed by the
 * connected wallet through the gateway and shows exactly why it is unavailable when it is.
 */
export function TerminalLifecycle({
  view,
  compact = false,
  showLink = false,
}: {
  view: OnchainPositionLifecycle;
  compact?: boolean;
  showLink?: boolean;
}) {
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const [confirmations] = useConfirmationPrefs();
  const orderStep = useConfirmStep(confirmations.orders);
  const collateralStep = useConfirmStep(confirmations.collateral, 6_000);
  const nowMs = useChainNow(view.observedAtSeconds * 1000);
  const [pending, setPending] = useState<LifecycleActionKey | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const phase = PHASE_COPY[view.phase];
  const actions = lifecycleActions(view, nowMs, snapshot.account.available);
  const boundary = nextBoundary(view, nowMs);
  const { schedule, settlement } = view;
  const settledReceipt = settlement?.id ?? view.exerciseTransactionHash;

  const run = (action: LifecycleActionView) => {
    const step = action.key === "CLAIM" ? collateralStep : orderStep;
    step.run(action.key, () => {
      setPending(action.key);
      setOutcome(null);
      gateway
        .runLifecycleAction(view.positionId, action.key)
        .then((result) => setOutcome({ tone: "ok", text: result.detail, transactionHash: result.transactionHash }))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message.split("\n")[0] : "The action failed.";
          setOutcome({
            tone: "error",
            text: /User rejected|4001/.test(message) ? "The wallet declined the signature. Nothing was sent." : message,
          });
        })
        .finally(() => setPending(null));
    });
  };

  return (
    <div className="flex flex-col gap-3" data-lifecycle-position={view.positionId}>
      <div className="rounded-md border border-line bg-inset px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {showLink ? <SideTag side={view.side} /> : null}
            <PhaseTag label={phase.label} tone={phase.tone} />
            <span className="truncate font-mono text-[11px] text-faint">{`${view.status} · ${view.exerciseState}`}</span>
          </span>
          {boundary ? (
            <span className="tnum inline-flex items-center gap-1 font-mono text-[11px] text-dim" title={chainTimeLabel(boundary.at)}>
              <Clock3 size={11} aria-hidden="true" />
              {`${boundary.label} in ${formatCountdownMs(Date.parse(boundary.at) - nowMs)}`}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-faint">{phase.detail}</p>
        {showLink ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
            <span className="tnum font-mono text-dim">{`${view.marketId} · ${formatLots(view.lots)} lots at ${formatNumber(view.entryPrice, 2)}`}</span>
            <Link href={positionHref(view.positionId)} className="focus-ring inline-flex items-center gap-1 rounded-sm text-dim underline decoration-line-strong underline-offset-[3px] hover:text-ink">
              {middleTruncate(view.positionId, 8, 6)}
              <ArrowUpRight size={11} aria-hidden="true" />
            </Link>
          </p>
        ) : null}
      </div>

      <div className="divide-y divide-line-soft">
        <TrustRow
          label="Final fixing"
          note={
            view.fixing.acceptedOnPosition
              ? "accepted onto the position"
              : view.settlement || view.fixing.status === "PENDING" || view.fixing.resolution === "TERMINAL_DISRUPTION"
                ? undefined
                : "not yet on the position"
          }
          value={fixingValue(view)}
          tone={view.fixing.value === null ? "text-faint" : "text-ink"}
          provenance={view.fixing.value === null ? undefined : "OBSERVED"}
          source="Fixing engine"
        />
        <TrustRow
          label="Election window"
          note={view.exercisePolicy === "HOLDER_ELECTION" ? "holder election" : "automatic exercise"}
          value={`${clock(schedule.exerciseOpensAt)}–${clock(schedule.exerciseCutoffAt)} UTC`}
          provenance="OBSERVED"
          source="Series terms onchain"
        />
        {compact ? null : (
          <>
            <TrustRow label="Fixing window" value={`${clock(schedule.fixingWindowOpen)}–${clock(schedule.fixingWindowClose)} UTC`} />
            <TrustRow label="Corrections close" value={chainTimeLabel(schedule.correctionCutoffAt)} />
          </>
        )}
        <TrustRow label="Final resolution" value={chainTimeLabel(schedule.finalResolutionAt)} note="terminal fallback" />
        <TrustRow
          label={settlement ? "Terminal transfer" : "Payoff at the fixing"}
          note={settlement ? undefined : view.remainingLots > 0 ? `${formatLots(view.remainingLots)} lots, this account's side` : undefined}
          value={settlement ? signedUsd(settlement.transferUsd, 2) : view.projectedPayoffUsd === null ? "Needs a fixing" : signedUsd(view.projectedPayoffUsd, 2)}
          tone={settlement ? toneOf(settlement.transferUsd) : view.projectedPayoffUsd === null ? "text-faint" : toneOf(view.projectedPayoffUsd)}
          provenance={settlement ? "OBSERVED" : view.projectedPayoffUsd === null ? undefined : "ESTIMATED"}
          source={settlement ? "Settlement record" : "Payoff module at the fixing"}
        />
        <TrustRow
          label={settlement || view.exercisedLots > 0 ? "Realized PnL" : "Projected PnL"}
          note="with the opening consideration"
          value={view.projectedPnlUsd === null ? "Needs a fixing" : signedUsd(view.projectedPnlUsd, 2)}
          tone={view.projectedPnlUsd === null ? "text-faint" : toneOf(view.projectedPnlUsd)}
          provenance={view.projectedPnlUsd === null ? undefined : settlement || view.exercisedLots > 0 ? "OBSERVED" : "ESTIMATED"}
        />
        {settlement ? (
          <>
            <TrustRow label="Collateral released" value={usd(settlement.releasedUsd, 2)} provenance="OBSERVED" source="Settlement record" />
            {settlement.claim ? (
              <TrustRow
                label="Terminal claim"
                note={settlement.claim.receivable ? "payable to this account" : "owed by this account"}
                value={`${usd(settlement.claim.amountUsd, 2)} ${settlement.claim.status === "ACTIVE" ? "open" : "paid"}`}
                provenance="OBSERVED"
              />
            ) : null}
          </>
        ) : view.collateralReservedUsd > 0 ? (
          <TrustRow label="Collateral reserved" value={usd(view.collateralReservedUsd, 2)} provenance="OBSERVED" source="Terminal reservation" />
        ) : null}
      </div>

      <ul className="flex flex-col gap-2" aria-label="Terminal lifecycle actions">
        {actions.map((action) => {
          const step = action.key === "CLAIM" ? collateralStep : orderStep;
          const armed = step.armed === action.key;
          const busy = pending === action.key;
          return (
            <li key={action.key} className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3">
              <button
                type="button"
                disabled={!action.available || pending !== null}
                aria-describedby={`${view.positionId}-${action.key}-why`}
                onClick={() => run(action)}
                className={`${action.available ? BUTTON_INK : BUTTON_QUIET} h-8 w-full`}
              >
                {busy ? <LoaderCircle size={12} aria-hidden="true" className="animate-spin" /> : null}
                {busy ? "Signing" : armed ? CONFIRM_COPY[action.key] : action.label}
              </button>
              <p id={`${view.positionId}-${action.key}-why`} className="pt-1.5 text-[11px] leading-snug text-faint">
                {action.available ? (armed ? "Press again to sign and send." : action.effect) : action.reason}
              </p>
            </li>
          );
        })}
      </ul>

      {outcome ? (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug ${
            outcome.tone === "ok" ? "border-line text-dim" : "border-down/40 text-down"
          }`}
        >
          {outcome.tone === "ok" ? (
            <CircleCheck size={13} aria-hidden="true" className="mt-[1px] shrink-0" />
          ) : (
            <CircleAlert size={13} aria-hidden="true" className="mt-[1px] shrink-0" />
          )}
          <span className="min-w-0">
            {outcome.text}
            {outcome.transactionHash ? (
              <span className="mt-0.5 flex items-center text-[11px] text-faint">
                <span className="mr-1">tx</span>
                <span title={outcome.transactionHash} className="tnum truncate font-mono text-dim">
                  {middleTruncate(outcome.transactionHash, 8, 6)}
                </span>
                <CopyButton value={outcome.transactionHash} label="transaction reference" size={11} className="h-5 w-5" />
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {settledReceipt && (settlement || view.exercisedLots > 0) ? (
        <Link href={receiptHref(settledReceipt)} className={`${BUTTON_QUIET} h-8`}>
          Settlement receipt
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
