"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, FileCheck2, FileSearch, Lock } from "lucide-react";
import type { ActivityAttemptView } from "@/lib/activity/types";
import type { GatewaySnapshot, RestingPackageOrder } from "@/lib/internal-gateway/types";
import { formatLots, formatUsd } from "@/lib/terminal/format";
import {
  BUTTON_QUIET,
  Chip,
  Hash,
  formatCountdown,
  formatUtcFull,
  formatUtcTime,
  motion,
} from "./ledger-ui";
import {
  ORDER_STATE_LABEL,
  ORDER_STATE_TONE,
  RESULT_LABEL,
  RESULT_TONE,
  marketPrice,
  marketUnit,
  orderRouteLabel,
  outcomeLabel,
  receiptsForOrder,
  sideLabel,
} from "./activity-view";
import { StepTimeline, type TimelineStep } from "./StepTimeline";

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-[7px]" title={hint}>
      <span className="shrink-0 text-xs text-faint">{label}</span>
      <span className="flex min-w-0 justify-end text-right text-xs text-ink">{value}</span>
    </div>
  );
}

function Figure({ label, value, tone = "text-ink" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-faint">{label}</div>
      <div className={`tnum mt-0.5 truncate font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}

function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{children}</h3>
      {right ? <span className="text-[11px] text-faint">{right}</span> : null}
    </div>
  );
}

/** Data boundary and result handling notes, folded so they stay available without shouting. */
export function DataNotes() {
  return (
    <details className="group border-t border-line">
      <summary className="focus-ring flex h-9 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[11px] text-faint transition-colors hover:text-dim">
        About this data
        <ChevronDown size={13} aria-hidden="true" className="transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 px-4 pb-3 text-[11px] leading-relaxed text-faint">
        <p>
          <span className="text-dim">Data boundary. </span>
          Attempts currently come from the first-party browser runtime. An indexed contract projection can supply the
          same typed ledger rows later, with source, evidence, freshness, and result state preserved.
        </p>
        <ul className="space-y-1">
          <li>
            <span className="text-up">Complete</span> has terminal evidence.
          </li>
          <li>
            <span className="text-brand">Simulated</span> stays local and is never an explorer claim.
          </li>
          <li>
            <span className="text-dim">Unknown</span> remains visible until a reconciler resolves it.
          </li>
        </ul>
      </div>
    </details>
  );
}

export function EmptyDetail({ children }: { children: ReactNode }) {
  return (
    <div className={`flex min-h-[220px] flex-1 flex-col items-center justify-center px-6 text-center ${motion.fade}`}>
      <FileSearch size={18} aria-hidden="true" className="text-off" />
      <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-faint">{children}</p>
    </div>
  );
}

export function AttemptDetail({ attempt }: { attempt: ActivityAttemptView }) {
  const referenceLabel = attempt.result === "SIMULATED" ? "Runtime reference" : "Transaction reference";
  const side = sideLabel(attempt.packageSide);
  const partial = attempt.cancelledLots > 1e-9;
  const steps: TimelineStep[] = attempt.steps.map((step, index) => ({
    id: `${attempt.id}-${step.id}-${index}`,
    label: step.label,
    detail: step.detail,
    hash: step.transactionReference,
    hashLabel: "Runtime reference",
    meta: index === attempt.steps.length - 1 ? formatUtcTime(step.occurredAt) : String(index + 1).padStart(2, "0"),
    state: attempt.result === "FAILED" && index === attempt.steps.length - 1 ? "failed" : "done",
  }));

  return (
    <div key={attempt.id} className={`flex min-h-0 flex-1 flex-col ${motion.fade}`}>
      <div role="region" tabIndex={0} aria-label="Attempt detail" className="focus-ring scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2">
            <Chip tone={RESULT_TONE[attempt.result]} dot>
              {RESULT_LABEL[attempt.result]}
            </Chip>
            <Chip tone="muted">{`${attempt.source.toLowerCase()} source`}</Chip>
            <span className="ml-auto tnum font-mono text-[11px] text-faint" title={formatUtcFull(attempt.createdAt)}>
              {formatUtcTime(attempt.createdAt)}
            </span>
          </div>
          <h2 className="mt-2 truncate text-sm font-medium text-ink">{attempt.packageCode}</h2>
          <p className={`mt-0.5 text-xs ${attempt.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
            {`${outcomeLabel(attempt.outcome)} ${side} · ${attempt.environment}`}
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="tnum font-serif text-[30px] leading-8 text-ink">
              {marketPrice(attempt.marketId, attempt.price, false)}
            </span>
            <span className="text-xs text-faint">{marketUnit(attempt.marketId)}</span>
            <span className="ml-auto text-[11px] text-faint">fill price</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line-soft pt-2.5">
            <Figure label={partial ? "Filled" : "Lots"} value={formatLots(attempt.filledLots)} />
            <Figure
              label={partial ? "Cancelled" : "Requested"}
              value={partial ? formatLots(attempt.cancelledLots) : formatLots(attempt.requestedLots)}
              tone={partial ? "text-dim" : "text-ink"}
            />
            <Figure label="Fees" value={formatUsd(attempt.feeAmount, 2)} />
          </div>
        </div>

        <div className="divide-y divide-line-soft border-b border-line px-4 py-1">
          <Row label="Package side" value={attempt.packageSide} />
          <Row label="Order hash" value={<Hash value={attempt.orderHash} label="order hash" />} hint={attempt.orderHash} />
          <Row label="Route" value={<span className="truncate">{attempt.routeLabel}</span>} />
          <Row label="Guarantee" value={<span className="truncate">{attempt.guarantee}</span>} />
          <Row
            label="Evidence"
            value={<span className="truncate">{`${attempt.evidence.toLowerCase()} / ${attempt.freshness.label}`}</span>}
            hint={attempt.freshness.detail}
          />
        </div>

        {attempt.receipt ? (
          <div className="border-b border-line px-4 py-3">
            <SectionHead right={attempt.result === "SIMULATED" ? "not onchain" : "dev chain"}>{referenceLabel}</SectionHead>
            <Hash value={attempt.receipt.transactionReference} label={referenceLabel.toLowerCase()} head={14} tail={10} className="mt-1" />
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              {attempt.result === "SIMULATED"
                ? "This identifier belongs to a local simulation and is not an onchain transaction."
                : "This is the transaction reference emitted by the connected development chain."}
            </p>
            <Link href={attempt.receipt.href} className={`${BUTTON_QUIET} mt-2.5 h-9 w-full`}>
              <FileCheck2 size={13} aria-hidden="true" />
              Open execution receipt
            </Link>
          </div>
        ) : null}

        <div className="px-4 py-3">
          <SectionHead right={`${attempt.steps.length} recorded steps`}>Execution chronology</SectionHead>
          {steps.length === 0 ? (
            <p className="mt-2 text-xs text-faint">No runtime steps were retained for this attempt.</p>
          ) : (
            <StepTimeline steps={steps} className="mt-3" dense />
          )}
        </div>
      </div>
      <DataNotes />
    </div>
  );
}

export function OrderDetail({
  order,
  snapshot,
  now,
}: {
  order: RestingPackageOrder;
  snapshot: GatewaySnapshot;
  now: number;
}) {
  const receipts = receiptsForOrder(order, snapshot);
  const rfq = snapshot.rfqRequests.find(
    (request) => request.authorization.orderHash.toLowerCase() === order.orderHash.toLowerCase(),
  );
  const share = order.lots > 0 ? Math.min(1, order.filledLots / order.lots) : 0;
  const open = order.state === "WORKING" || order.state === "PARTIALLY_FILLED";
  const expiresMs = order.expiresAt ? Date.parse(order.expiresAt) : Number.NaN;
  const closedAt = order.cancelledAt ?? order.expiredAt ?? order.filledAt ?? order.replacedAt ?? null;

  return (
    <div key={order.id} className={`flex min-h-0 flex-1 flex-col ${motion.fade}`}>
      <div role="region" tabIndex={0} aria-label="Order detail" className="focus-ring scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2">
            <Chip tone={ORDER_STATE_TONE[order.state]} dot live={open}>
              {ORDER_STATE_LABEL[order.state]}
            </Chip>
            {rfq ? (
              <Chip tone="neutral" className="gap-1">
                <Lock size={10} aria-hidden="true" />
                Private RFQ
              </Chip>
            ) : null}
            <span className="ml-auto tnum font-mono text-[11px] text-faint" title={formatUtcFull(order.createdAt)}>
              {formatUtcTime(order.createdAt)}
            </span>
          </div>
          <h2 className="mt-2 truncate text-sm font-medium text-ink">{order.packageCode}</h2>
          <p className={`mt-0.5 text-xs ${order.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
            {`${order.side === "EXIT" ? "Exit" : "Enter"} ${sideLabel(order.packageSide)} · ${order.orderType === "MARKET" ? "Market" : "Limit"} ${order.timeInForce}`}
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="tnum font-serif text-[30px] leading-8 text-ink">
              {marketPrice(order.marketId, order.limitPrice, false)}
            </span>
            <span className="text-xs text-faint">{marketUnit(order.marketId)}</span>
            <span className="ml-auto text-[11px] text-faint">limit</span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-faint">Filled</span>
              <span className="tnum font-mono text-ink">{`${formatLots(order.filledLots)} of ${formatLots(order.lots)} lots`}</span>
            </div>
            <span className="relative mt-1.5 block h-1 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${share >= 1 ? "bg-up" : "bg-brand"} ${motion.progressFill}`}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
          </div>
        </div>

        <div className="divide-y divide-line-soft border-b border-line px-4 py-1">
          <Row label="Order hash" value={<Hash value={order.orderHash} label="order hash" />} hint={order.orderHash} />
          <Row label="Route" value={<span className="truncate">{orderRouteLabel(order, snapshot)}</span>} />
          <Row label="Remaining" value={<span className="tnum font-mono">{`${formatLots(order.remainingLots)} lots`}</span>} />
          <Row
            label="Expiry"
            value={
              <span className="tnum font-mono">
                {Number.isFinite(expiresMs)
                  ? expiresMs > now && open
                    ? `${formatCountdown(Math.ceil((expiresMs - now) / 1000))} left`
                    : formatUtcTime(order.expiresAt)
                  : "None"}
              </span>
            }
            hint={order.expiresAt ? formatUtcFull(order.expiresAt) : undefined}
          />
          <Row
            label="Collateral reserved"
            value={<span className="tnum font-mono">{formatUsd(order.remainingCollateralReservation, 2)}</span>}
            hint={`Reserved at authorization: ${formatUsd(order.collateralReservation, 2)}`}
          />
          <Row
            label="Fee cap"
            value={<span className="tnum font-mono">{formatUsd(order.feeCap, 2)}</span>}
          />
          {closedAt ? <Row label="Closed" value={<span className="tnum font-mono">{formatUtcTime(closedAt)}</span>} /> : null}
          {order.replacedByOrderId ? (
            <Row label="Replaced by" value={<Hash value={order.replacedByOrderId} label="replacement order" />} />
          ) : null}
        </div>

        <div className="px-4 py-3">
          <SectionHead right={`${receipts.length} linked`}>Receipts</SectionHead>
          {receipts.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-faint">
              {open ? "No fill yet. A receipt appears when this order executes." : "No fill, receipt, or position was created."}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {receipts.map((receiptId) => (
                <li key={receiptId}>
                  <Link
                    href={`/activity/receipts/${receiptId}`}
                    className="focus-ring flex h-9 items-center justify-between gap-2 rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
                  >
                    <span className="tnum truncate font-mono">{receiptId}</span>
                    <FileCheck2 size={13} aria-hidden="true" className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {rfq ? (
            <Link href="/rfqs" className={`${BUTTON_QUIET} mt-2.5 h-9 w-full`}>
              <Lock size={12} aria-hidden="true" />
              View private RFQ
            </Link>
          ) : null}
        </div>
      </div>
      <DataNotes />
    </div>
  );
}
