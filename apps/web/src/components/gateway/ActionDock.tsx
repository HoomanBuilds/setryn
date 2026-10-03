"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, CircleAlert, CircleSlash, LoaderCircle, X } from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { TxHash } from "@/components/gateway/TxHash";
import { describeProgress } from "@/lib/internal-gateway/action-progress";
import type { TrackedAction } from "@/lib/internal-gateway/types";

/** How long a finished action stays before it leaves on its own; a failure stays until dismissed. */
const LINGER_MS: Record<TrackedAction["status"], number | null> = {
  IN_PROGRESS: null,
  SUCCEEDED: 9_000,
  DECLINED: 5_000,
  FAILED: null,
};

const SHOWN = 3;

function StatusIcon({ status }: { status: TrackedAction["status"] }) {
  if (status === "IN_PROGRESS") return <LoaderCircle size={14} className="shrink-0 animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" />;
  if (status === "SUCCEEDED") return <Check size={14} className="shrink-0 text-up" aria-hidden="true" />;
  if (status === "DECLINED") return <CircleSlash size={14} className="shrink-0 text-faint" aria-hidden="true" />;
  return <CircleAlert size={14} className="shrink-0 text-down" aria-hidden="true" />;
}

function ActionCard({ action }: { action: TrackedAction }) {
  const gateway = useInternalGateway();
  const pathname = usePathname();
  // A link to the page the user is already on says nothing.
  const href = action.href && action.href.split("?")[0] !== pathname ? action.href : null;
  const linger = LINGER_MS[action.status];
  useEffect(() => {
    if (linger === null || action.finishedAt === null) return;
    const remaining = Math.max(0, action.finishedAt + linger - Date.now());
    const timer = window.setTimeout(() => gateway.dismissAction(action.id), remaining);
    return () => window.clearTimeout(timer);
  }, [action.finishedAt, action.id, gateway, linger]);

  const line =
    action.status === "IN_PROGRESS"
      ? action.progress
        ? describeProgress(action.progress)
        : "Preparing…"
      : (action.message ?? "");
  const tone =
    action.status === "FAILED" ? "border-down/40" : action.status === "SUCCEEDED" ? "border-up/30" : "border-line-strong";

  return (
    <li
      className={`chip-in pointer-events-auto rounded-md border ${tone} bg-raised/95 px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <StatusIcon status={action.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{action.title}</p>
          <p className={`mt-0.5 text-[11px] leading-snug ${action.status === "FAILED" ? "text-down" : "text-dim"}`}>{line}</p>
          {action.transactionHash || href ? (
            <div className="mt-1 flex min-w-0 items-center gap-3">
              {action.transactionHash ? <TxHash hash={action.transactionHash} /> : null}
              {href ? (
                <Link
                  href={href}
                  onClick={() => gateway.dismissAction(action.id)}
                  className="focus-ring shrink-0 rounded-sm text-[11px] text-brand underline-offset-2 hover:underline"
                >
                  {action.hrefLabel ?? "View"}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        {action.status !== "IN_PROGRESS" ? (
          <button
            type="button"
            onClick={() => gateway.dismissAction(action.id)}
            aria-label={`Dismiss ${action.title}`}
            className="focus-ring -mt-0.5 -mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:text-ink"
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Every wallet action's progress and outcome in one place, wherever it was started: a step and its transaction while
 * in flight, then what happened and where to look. It stays across navigation and after the panel that started the
 * action closes; successes leave on their own, failures stay until dismissed.
 */
export function ActionDock() {
  const snapshot = useGatewaySnapshot();
  const actions = snapshot.actions.slice(0, SHOWN);
  const live = actions[0];
  const announcement = live
    ? `${live.title}: ${live.status === "IN_PROGRESS" ? (live.progress ? describeProgress(live.progress) : "started") : (live.message ?? "")}`
    : "";
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-10 z-50 flex justify-end sm:inset-x-auto sm:right-4 sm:w-[360px]">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {actions.length > 0 ? (
        <ol aria-label="Recent actions" className="flex w-full flex-col-reverse gap-2">
          {actions.map((action) => (
            <ActionCard key={action.id} action={action} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}
