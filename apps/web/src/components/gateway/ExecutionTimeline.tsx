"use client";

import Link from "next/link";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { SectionLabel } from "@/components/terminal/primitives";
import { formatLots } from "@/lib/terminal/format";
import type { OrderExecutionProgress, SubmissionStepId } from "@/lib/internal-gateway/types";

const BASE_STEPS: SubmissionStepId[] = [
  "AUTHORIZED",
  "SUBMITTED",
  "INCLUDED",
  "FILLED",
];

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function stateLabel(status: OrderExecutionProgress["status"]): string {
  if (status === "CONNECTING") return "Connecting wallet";
  if (status === "AUTHORIZING") return "Authorizing package";
  if (status === "SUBMITTING") return "Clearing package";
  if (status === "RESTING") return "Working locally";
  if (status === "COMPLETED") return "Execution complete";
  if (status === "FAILED") return "Execution not completed";
  return "Awaiting authorization";
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
    return (
      <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <SectionLabel>Execution timeline</SectionLabel>
          <span className="text-xs text-dim">{partial ? "Partially filled" : "Working locally"}</span>
        </div>
        <div className="px-3 py-2.5 text-xs leading-snug text-dim">
          <p>{`Resting order ${orderId} is working locally.`}</p>
          {partial && filled !== null && remaining !== null ? (
            <p className="mt-1 text-dim">{`${formatLots(filled)} of ${formatLots(restingOrder?.lots ?? 0)} lots filled. ${formatLots(remaining)} lots working${latestReceipt ? `. Latest receipt ${latestReceipt}` : ""}.`}</p>
          ) : (
            <p className="mt-1 text-faint">No fill, receipt, or position. Local demo only.</p>
          )}
          {orderId ? (
            <p className="tnum mt-1 font-mono text-ink">{orderId}</p>
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

  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <SectionLabel>Execution timeline</SectionLabel>
        <span className={`text-xs ${progress.status === "FAILED" ? "text-down" : "text-dim"}`}>
          {stateLabel(progress.status)}
        </span>
      </div>

      {progress.status === "AUTHORIZING" || progress.status === "CONNECTING" ? (
        <div className="flex items-start gap-2 px-3 py-2.5 text-xs leading-snug text-dim">
          <LoaderCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin text-brand" />
          <span>
            {progress.status === "CONNECTING"
              ? "Preparing the local wallet session for this test environment."
              : "Binding the selected package, route, limit, and collateral cap to one demo authorization."}
          </span>
        </div>
      ) : null}

      {progress.status === "FAILED" ? (
        <div className="flex items-start gap-2 px-3 py-2.5 text-xs leading-snug text-down">
          <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{progress.error}</span>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {steps.map((step) => {
            const update = updateByStep.get(step);
            const pending = active && !update;
            return (
              <li key={step} className="flex gap-2 px-3 py-2">
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-line-strong">
                  {update ? (
                    <Check size={10} aria-hidden="true" className="text-up" />
                  ) : pending ? (
                    <LoaderCircle size={10} aria-hidden="true" className="animate-spin text-brand" />
                  ) : null}
                </span>
                <span className="min-w-0 text-xs leading-snug">
                  <span className={update ? "text-ink" : "text-faint"}>{update?.label ?? step.toLowerCase().replace(/_/g, " ")}</span>
                  {update ? <span className="block text-faint">{update.detail}</span> : null}
                  {update?.transactionHash ? (
                    <span className="mt-0.5 block font-mono text-faint">{shortHash(update.transactionHash)}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {progress.result ? (
        <div className="border-t border-line px-3 py-2.5">
          <Link
            href={`/activity/receipts/${progress.result.receipt.id}`}
            className="focus-ring flex h-9 items-center justify-center rounded-md border border-line text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Verify execution receipt
          </Link>
        </div>
      ) : null}
    </div>
  );
}
