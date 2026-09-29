import type { ReactNode } from "react";
import type { PositionDossier } from "@/lib/positions/dossier";
import { formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket, Provenance } from "@/lib/terminal/types";
import { ProvenanceChip } from "@/components/settlements/trust";

export function price(value: number, market: PackageMarket, withUnit = true): string {
  const text = formatNumber(value, market.priceDecimals);
  return withUnit ? `${text} ${priceUnitSuffix(market.priceUnit)}` : text;
}

export function signedUsd(value: number, decimals = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), decimals)} USDC`;
}

export function usd(value: number, decimals = 0): string {
  return `${formatNumber(value, decimals)} USDC`;
}

export function toneOf(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-dim";
}

/** Chain identifiers are middle-truncated; readable record ids stay whole unless very long. */
export function shortId(id: string): string {
  const hex = id.startsWith("0x");
  if ((hex && id.length <= 18) || (!hex && id.length <= 32)) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export function SideTag({ side }: { side: PositionDossier["side"] }) {
  const long = side === "LONG";
  return (
    <span
      className={`inline-flex h-[20px] shrink-0 items-center rounded-[4px] px-1.5 font-mono text-[11px] leading-none font-medium tracking-[0.06em] uppercase ${
        long ? "bg-up-soft text-up" : "bg-down-soft text-down"
      }`}
    >
      {long ? "Long" : "Short"}
    </span>
  );
}

export type PhaseTone = "live" | "window" | "closed" | "attention";

export function PhaseTag({ label, tone }: { label: string; tone: PhaseTone }) {
  const dot =
    tone === "live" ? "bg-up" : tone === "window" || tone === "attention" ? "bg-brand" : "bg-off";
  const text = tone === "closed" ? "text-faint" : tone === "live" ? "text-dim" : "text-brand";
  return (
    <span className={`inline-flex h-[20px] shrink-0 items-center gap-1.5 rounded-[4px] border border-line px-1.5 text-[11px] ${text}`}>
      <span
        aria-hidden="true"
        className={`relative inline-block h-[6px] w-[6px] rounded-full ${dot} ${tone === "closed" ? "" : "live-dot"}`}
      />
      {label}
    </span>
  );
}

/** Dense label and value row with its trust class on the right. */
export function TrustRow({
  label,
  value,
  provenance,
  source,
  tone = "text-ink",
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  provenance?: Provenance;
  source?: string;
  tone?: string;
  note?: ReactNode;
}) {
  return (
    <div className="grid min-h-[30px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-[5px]">
      <span className="min-w-0">
        <span className="block truncate text-xs text-faint">{label}</span>
        {note ? <span className="block truncate text-[11px] text-off">{note}</span> : null}
      </span>
      <span className="flex shrink-0 items-center justify-end gap-2">
        <span className={`tnum text-right font-mono text-xs ${tone}`}>{value}</span>
        {provenance ? <ProvenanceChip provenance={provenance} source={source} compact /> : null}
      </span>
    </div>
  );
}

export function SubHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <h3 className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{children}</h3>
      {right ? <span className="flex shrink-0 items-center gap-1.5">{right}</span> : null}
    </div>
  );
}

export const LINK_QUIET =
  "focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-dim underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-ink/40";
