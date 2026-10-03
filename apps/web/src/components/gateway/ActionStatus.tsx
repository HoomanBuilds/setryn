"use client";

import { LoaderCircle } from "lucide-react";
import { TxHash } from "@/components/gateway/TxHash";
import { describeProgress, type ActionProgress } from "@/lib/internal-gateway/action-progress";

/** A button's label while an action runs: whose turn it is, the wallet's or the chain's. */
export function pendingLabel(progress: ActionProgress | null, fallback = "Preparing…"): string {
  if (!progress) return fallback;
  const step = progress.total > 1 ? ` (${progress.step}/${progress.total})` : "";
  return progress.phase === "SIGN" ? `Confirm in wallet${step}…` : `Confirming${step}…`;
}

/** The step in flight under a form: "Step 2 of 3 · Approve USDC · confirm in your wallet", and its transaction. */
export function ActionProgressNote({ progress, className = "" }: { progress: ActionProgress | null; className?: string }) {
  if (!progress) return null;
  return (
    <div role="status" className={`flex min-w-0 flex-col gap-0.5 text-[11px] text-dim ${className}`}>
      <span className="flex items-center gap-1.5">
        <LoaderCircle size={11} className="shrink-0 animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" />
        <span>{describeProgress(progress)}</span>
      </span>
      {progress.transactionHash ? <TxHash hash={progress.transactionHash} className="pl-[17px]" /> : null}
    </div>
  );
}

export interface ActionOutcomeState {
  ok: boolean;
  text: string;
  transactionHash?: string | null;
}

/** What an action ended with, next to the form that started it: success or the failure sentence, and the transaction. */
export function ActionOutcome({ outcome, className = "" }: { outcome: ActionOutcomeState | null; className?: string }) {
  if (!outcome) return null;
  return (
    <div role={outcome.ok ? "status" : "alert"} className={`flex min-w-0 flex-col gap-0.5 text-xs ${outcome.ok ? "text-up" : "text-down"} ${className}`}>
      <span>{outcome.text}</span>
      {outcome.transactionHash ? <TxHash hash={outcome.transactionHash} /> : null}
    </div>
  );
}
