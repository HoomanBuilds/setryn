"use client";

import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { Chip } from "@/components/strategies/desk/Desk";
import { formatExpiry, formatNumber, formatShare } from "@/lib/terminal/format";
import { CERTAINTY_LABEL, PROTECTION_LABEL, TYPE_LABEL } from "@/lib/exposures/book";
import { hedgeBuilderHref } from "@/lib/exposures/records";
import type { ExposureView, HedgeLink, ProtectionState } from "@/lib/exposures/types";
import type { SizeUnit } from "@/lib/settings/preferences";
import { AssetIcon } from "@/components/icons/AssetIcon";

const STATE_TONE: Record<ProtectionState, string> = {
  UNHEDGED: "text-down",
  PARTIAL: "text-brand",
  PROTECTED: "text-up",
  NETTED: "text-dim",
};

export function amountText(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)}M`;
  if (Math.abs(value) >= 10_000) return `${formatNumber(value / 1_000, 1)}k`;
  return formatNumber(value, 0);
}

/** Netted share in a quiet tone, protected share in the up tone, residual as the empty track. */
export function CoverageBar({ view, className = "" }: { view: ExposureView; className?: string }) {
  const amount = view.record.amount || 1;
  const netted = Math.min(1, view.netted / amount);
  const protectedShare = Math.min(1 - netted, view.protectedAmount / amount);
  return (
    <span
      role="meter"
      aria-label={`Coverage ${formatShare(view.coverage, 0)}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(view.coverage * 100)}
      className={`flex h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}
    >
      <span className="h-full bg-dim/60 transition-[width] duration-300 ease-out" style={{ width: `${netted * 100}%` }} />
      <span className="h-full bg-up transition-[width] duration-300 ease-out" style={{ width: `${protectedShare * 100}%` }} />
    </span>
  );
}

function linkText(link: HedgeLink, unit: SizeUnit, notionalPerLot: number | undefined): string {
  if (unit === "LOTS" && notionalPerLot) return `${formatNumber(link.allocated / notionalPerLot, 1)} lots`;
  return `${amountText(link.allocated)} USDC`;
}

function HedgeCell({ view, unit, lotSize }: { view: ExposureView; unit: SizeUnit; lotSize: (marketId: string) => number | undefined }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {view.links.slice(0, 2).map((link) => (
        <Link
          key={`${link.positionId}-${link.marketId}`}
          href={link.href}
          title={`${link.label}, ${link.side.toLowerCase()} position ${link.positionId}. Tenor gap ${link.tenorGapDays}d.`}
          className="focus-ring inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-line bg-raised px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          <span className="tnum truncate font-mono">{link.marketId}</span>
          <span className="tnum shrink-0 font-mono text-faint">{linkText(link, unit, lotSize(link.marketId))}</span>
        </Link>
      ))}
      {view.links.length > 2 ? <span className="text-[11px] text-faint">{`+${view.links.length - 2} more`}</span> : null}
      {view.residual > 0 ? (
        <Link
          href={hedgeBuilderHref(view.record, view.residual)}
          className="focus-ring inline-flex h-11 items-center gap-1 rounded-md border border-line px-2.5 text-xs whitespace-nowrap text-dim transition-colors hover:border-brand-edge hover:text-ink lg:h-6 lg:px-2 lg:text-[11px]"
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {view.links.length > 0 || view.netted > 0 ? `Protect ${amountText(view.residual)}` : "Protect"}
        </Link>
      ) : null}
    </div>
  );
}

export function ExposureTable({
  views,
  unit,
  lotSize,
  onRemove,
}: {
  views: ExposureView[];
  unit: SizeUnit;
  lotSize: (marketId: string) => number | undefined;
  onRemove: (id: string) => void;
}) {
  const TH = "h-8 px-2.5 text-left align-middle text-[11px] font-normal whitespace-nowrap text-faint first:pl-3 last:pr-3";
  const TD = "px-2.5 py-2 align-middle first:pl-3 last:pr-3";
  return (
    <>
      <div className="scroll-thin hidden overflow-x-auto lg:block">
        <table className="relative w-full min-w-[880px] border-collapse text-left">
          <caption className="sr-only">Exposure book with netting, protection coverage, and linked hedge packages</caption>
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Exposure</th>
              <th className={TH}>Asset</th>
              <th className={`${TH} text-right`}>Amount USDC</th>
              <th className={TH}>Date</th>
              <th className={TH}>Status</th>
              <th className={`${TH} w-[190px]`}>Coverage</th>
              <th className={TH}>Hedge package</th>
              <th className={TH}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {views.map((view) => {
              const { record } = view;
              return (
                <tr key={record.id} className="row-in border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                  <td className={`${TD} max-w-[240px]`}>
                    <span className="block truncate text-xs text-ink" title={record.label}>
                      {record.label}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                      <span>{TYPE_LABEL[record.type]}</span>
                      <span aria-hidden="true" className="text-off">/</span>
                      <span className="tnum font-mono">{record.id}</span>
                    </span>
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-1.5 font-mono text-xs text-ink">
                      <AssetIcon symbol={record.referenceAssetId} size={14} />
                      {record.referenceAssetId}
                    </span>
                    <span
                      className="block text-[11px] whitespace-nowrap text-faint"
                      title={view.sign === 1 ? "Loses value if the asset falls" : "Loses value if the asset rises"}
                    >
                      {view.sign === 1 ? "Long, fall risk" : "Short, rise risk"}
                    </span>
                  </td>
                  <td className={`${TD} tnum text-right font-mono text-xs text-ink`}>{formatNumber(record.amount, 0)}</td>
                  <td className={TD}>
                    <span className="tnum block font-mono text-xs whitespace-nowrap text-dim">{formatExpiry(record.exposureDateIso)}</span>
                    <span className="tnum block font-mono text-[11px] text-faint">{view.horizonDays === null ? "-" : `${view.horizonDays}d`}</span>
                  </td>
                  <td className={TD}>
                    <Chip tone={record.certainty === "CONFIRMED" ? "dim" : "neutral"}>{CERTAINTY_LABEL[record.certainty]}</Chip>
                    <span className="mt-1 block truncate text-[11px] text-faint" title={record.batch ?? undefined}>
                      {record.source === "IMPORTED" ? "Imported" : "Entered here"}
                    </span>
                  </td>
                  <td className={TD}>
                    <span className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className={STATE_TONE[view.state]}>{PROTECTION_LABEL[view.state]}</span>
                      <span className="tnum font-mono text-dim">{formatShare(view.coverage, 0)}</span>
                    </span>
                    <CoverageBar view={view} className="mt-1" />
                    <span className="tnum mt-1 flex justify-between gap-2 font-mono text-[10.5px] text-faint">
                      <span title="Offset by opposite exposures">{`net ${amountText(view.netted)}`}</span>
                      <span title="Covered by connected-account positions">{`hedge ${amountText(view.protectedAmount)}`}</span>
                    </span>
                  </td>
                  <td className={TD}>
                    <HedgeCell view={view} unit={unit} lotSize={lotSize} />
                  </td>
                  <td className={`${TD} w-8`}>
                    <button
                      type="button"
                      onClick={() => onRemove(record.id)}
                      aria-label={`Remove ${record.label}`}
                      title="Remove from book"
                      className="focus-ring grid h-7 w-7 place-items-center rounded-md text-off transition-colors hover:bg-down-soft hover:text-down"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="lg:hidden">
        {views.map((view) => {
          const { record } = view;
          return (
            <li key={record.id} className="row-in flex flex-col gap-2 border-b border-line-soft px-3 py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink">{record.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    <span className="flex items-center gap-1">
                      <AssetIcon symbol={record.referenceAssetId} size={12} />
                      {`${record.referenceAssetId} ${TYPE_LABEL[record.type].toLowerCase()}`}
                    </span>
                    <Chip tone={record.certainty === "CONFIRMED" ? "dim" : "neutral"}>{CERTAINTY_LABEL[record.certainty]}</Chip>
                    {record.source === "IMPORTED" ? <Chip tone="neutral">Imported</Chip> : null}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(record.id)}
                  aria-label={`Remove ${record.label}`}
                  className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-md text-off transition-colors hover:bg-down-soft hover:text-down"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="min-w-0">
                  <span className="block text-[11px] text-faint">Amount</span>
                  <span className="tnum block truncate font-mono text-xs text-ink">{`${amountText(record.amount)} USDC`}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] text-faint">Date</span>
                  <span className="tnum block truncate font-mono text-xs text-dim">{formatExpiry(record.exposureDateIso)}</span>
                </span>
                <span className="min-w-0 text-right">
                  <span className="block text-[11px] text-faint">Coverage</span>
                  <span className={`tnum block font-mono text-xs ${STATE_TONE[view.state]}`}>{`${PROTECTION_LABEL[view.state]} ${formatShare(view.coverage, 0)}`}</span>
                </span>
              </div>
              <CoverageBar view={view} />
              <HedgeCell view={view} unit={unit} lotSize={lotSize} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
