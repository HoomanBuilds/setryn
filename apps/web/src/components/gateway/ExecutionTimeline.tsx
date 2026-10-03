"use client";

import Link from "next/link";
import { CircleAlert, FileCheck2, LoaderCircle } from "lucide-react";
import { SectionLabel } from "@/components/terminal/primitives";
import { StepTimeline, type TimelineStep } from "@/components/activity/StepTimeline";
import { motion } from "@/components/activity/ledger-ui";
import { formatLots } from "@/lib/terminal/format";
import type { OrderExecutionProgress, SubmissionStepId } from "@/lib/internal-gateway/types";

const BASE_STEPS: SubmissionStepId[] = [
  "AUTHORIZED",
  "SUBMITTED",
  "INCLUDED",
  "FILLED",
];

function stateLabel(status: OrderExecutionProgress["status"]): string {
  if (status === "CONNECTING") return "Connecting wallet";
  if (status === "AUTHORIZING") return "Authorizing package";
  if (status === "SUBMITTING") return "Clearing package";
  if (status === "RESTING") return "Resting on the book";
  if (status === "COMPLETED") return "Execution complete";
  if (status === "FAILED") return "Execution not completed";
  return "Awaiting authorization";
}

function pendingLabel(step: SubmissionStepId): string {
  const text = step.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Header({ status, tone, done, total }: { status: string; tone: string; done: number; total: number }) {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="relative border-b border-line">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <SectionLabel>Execution timeline</SectionLabel>
        <span className="flex items-center gap-2">
          <span className={`text-xs ${tone}`}>{status}</span>
          {total > 0 ? (
            <span className="tnum font-mono text-[11px] text-faint">{`${done}/${total}`}</span>
          ) : null}
        </span>
      </div>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-[-1px] h-px overflow-hidden">
        <span
          className={`absolute inset-0 ${tone === "text-down" ? "bg-down" : share >= 1 ? "bg-up" : "bg-brand"} ${motion.progressFill}`}
          style={{ transform: `scaleX(${share})` }}
        />
      </span>
    </div>
  );
}

export function ExecutionTimeline({ progress }: { progress: OrderExecutionProgress }) {
  if (progress.status === "RESTING") {
    const restingOrder = progress.restingOrder ?? null;
    const orderId = restingOrder?.id ?? progress.authorization?.orderHash ?? "";
    const partial = restingOrder?.state === "PARTIALLY_FILLED";
    const filled =
      restingOrder && typeof restingOrder.filledLots === "number" && Number.isFinite(restingOrder.filledLots)
        ? restingOrder.filledLots
        : null;
    const remaining =
      restingOrder && typeof restingOrder.remainingLots === "number" && Number.isFinite(restingOrder.remainingLots)
        ? restingOrder.remainingLots
        : null;
    const latestReceipt = restingOrder?.receiptId ?? null;
    const total = restingOrder?.lots ?? 0;
    return (
      <div className={`overflow-hidden rounded-md border border-line-strong bg-raised ${motion.fade}`}>
        <Header status={partial ? "Partially filled" : "Resting on the book"} tone="text-brand" done={0} total={0} />
        <div className="px-3 py-2.5 text-xs leading-snug text-dim">
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-brand text-brand ${motion.live}`} />
            <span className="min-w-0">{`Resting order ${orderId} is working on the book.`}</span>
          </p>
          {partial && filled !== null && remaining !== null ? (
            <>
              <p className="mt-1 text-dim">{`${formatLots(filled)} of ${formatLots(restingOrder?.lots ?? 0)} lots filled. ${formatLots(remaining)} lots working${latestReceipt ? `. Latest receipt ${latestReceipt}` : ""}.`}</p>
              <span aria-hidden="true" className="relative mt-2 block h-[3px] overflow-hidden rounded-full bg-line-strong">
                <span
                  className={`absolute inset-y-0 left-0 rounded-full bg-brand ${motion.progressFill}`}
                  style={{ width: `${total > 0 ? Math.round((filled / total) * 100) : 0}%` }}
                />
              </span>
            </>
          ) : (
            <p className="mt-1 text-faint">No fill, receipt, or position has been created.</p>
          )}
          {orderId ? (
            <p className="tnum mt-1.5 truncate font-mono text-[11px] text-ink" title={orderId}>
              {orderId}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const updateByStep = new Map(progress.updates.map((update) => [update.step, update]));
  const active = progress.status === "CONNECTING" || progress.status === "AUTHORIZING" || progress.status === "SUBMITTING";
  const positionUpdate = progress.updates.find(
    (update) =>
      update.step === "POSITION_CLOSED" ||
      update.step === "POSITION_UPDATED" ||
      update.step === "POSITION_CREATED",
  );
  const positionStep: SubmissionStepId = positionUpdate?.step ?? "POSITION_CREATED";
  const remainderUpdate = updateByStep.get("IOC_CANCELLED");
  const steps: SubmissionStepId[] = [
    ...BASE_STEPS,
    ...(remainderUpdate ? ["IOC_CANCELLED" as const] : []),
    positionStep,
    "RECEIPT_READY",
  ];
  const firstPending = active ? steps.findIndex((step) => !updateByStep.has(step)) : -1;
  const timeline: TimelineStep[] = steps.map((step, index) => {
    const update = updateByStep.get(step);
    return {
      id: step,
      label: update?.label ?? pendingLabel(step),
      detail: update?.detail,
      hash: update?.transactionHash,
      hashLabel: "Transaction reference",
      hashKind: "transaction",
      state: update ? "done" : index === firstPending ? "active" : "pending",
    };
  });
  const done = steps.filter((step) => updateByStep.has(step)).length;
  const failed = progress.status === "FAILED";

  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
      <Header
        status={stateLabel(progress.status)}
        tone={failed ? "text-down" : progress.status === "COMPLETED" ? "text-up" : "text-dim"}
        done={done}
        total={failed ? 0 : steps.length}
      />

      {progress.status === "AUTHORIZING" || progress.status === "CONNECTING" ? (
        <div className={`flex items-start gap-2 border-b border-line px-3 py-2.5 text-xs leading-snug text-dim ${motion.fade}`}>
          <LoaderCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin text-brand" />
          <span>
            {progress.status === "CONNECTING"
              ? "Preparing the wallet session."
              : "Binding the selected package, route, limit, and collateral cap to one signed authorization."}
          </span>
        </div>
      ) : null}

      {failed ? (
        <div className={`flex items-start gap-2 px-3 py-2.5 text-xs leading-snug text-down ${motion.fade}`}>
          <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{progress.error}</span>
        </div>
      ) : (
        <StepTimeline steps={timeline} dense className="px-3 py-2.5" />
      )}

      {progress.result ? (
        <div className={`border-t border-line px-3 py-2.5 ${motion.fade}`}>
          <Link
            href={`/activity/receipts/${progress.result.receipt.id}`}
            className="focus-ring flex h-9 items-center justify-center gap-1.5 rounded-md border border-line text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            <FileCheck2 size={13} aria-hidden="true" />
            Verify execution receipt
          </Link>
        </div>
      ) : null}
    </div>
  );
}
