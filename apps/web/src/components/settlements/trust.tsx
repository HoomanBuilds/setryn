import type { ReactNode } from "react";
import type { PositionOrigin } from "@/lib/positions/dossier";
import type { ExceptionSeverity } from "@/lib/settlements/types";
import type { Provenance } from "@/lib/terminal/types";

/**
 * Data trust labels. Each class has its own glyph and word, so the four stay
 * distinguishable without colour: observed is solid, executable is a diamond,
 * estimated is half filled, modeled is hollow on a dashed edge.
 */

export const PROVENANCE_COPY: Record<Provenance, { label: string; short: string; definition: string }> = {
  OBSERVED: {
    label: "Observed",
    short: "Obs",
    definition: "Read from an identified chain event, venue, oracle or signed record.",
  },
  EXECUTABLE: {
    label: "Executable",
    short: "Exec",
    definition: "Backed by an active order, quote, auction rule or reserved commitment.",
  },
  ESTIMATED: {
    label: "Estimated",
    short: "Est",
    definition: "Calculated from current executable inputs. Not itself guaranteed.",
  },
  MODELED: {
    label: "Modeled",
    short: "Model",
    definition: "Produced by a schedule, scenario or model assumption. Not evidence.",
  },
};

const PROVENANCE_TONE: Record<Provenance, string> = {
  OBSERVED: "border-line-strong bg-raised text-dim",
  EXECUTABLE: "border-line-strong bg-raised text-ink",
  ESTIMATED: "border-line text-dim",
  MODELED: "border-dashed border-line-strong text-faint",
};

export function ProvenanceGlyph({ provenance, size = 7 }: { provenance: Provenance; size?: number }) {
  if (provenance === "OBSERVED") {
    return (
      <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
        <circle cx="4" cy="4" r="3.4" fill="currentColor" />
      </svg>
    );
  }
  if (provenance === "EXECUTABLE") {
    return (
      <svg width={size + 1} height={size + 1} viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
        <path d="M4 0.4 L7.6 4 L4 7.6 L0.4 4 Z" fill="currentColor" />
      </svg>
    );
  }
  if (provenance === "ESTIMATED") {
    return (
      <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
        <circle cx="4" cy="4" r="3.1" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M4 0.9 A3.1 3.1 0 0 1 4 7.1 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
      <circle cx="4" cy="4" r="3.1" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6 1.2" />
    </svg>
  );
}

export function ProvenanceChip({
  provenance,
  source,
  compact = false,
  className = "",
}: {
  provenance: Provenance;
  /** Where the value comes from; shown on inspection. */
  source?: string;
  compact?: boolean;
  className?: string;
}) {
  const copy = PROVENANCE_COPY[provenance];
  const title = `${copy.label}. ${copy.definition}${source ? ` Source: ${source}.` : ""}`;
  return (
    <span
      title={title}
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] border px-1.5 font-mono text-[10px] leading-none tracking-[0.05em] whitespace-nowrap uppercase ${PROVENANCE_TONE[provenance]} ${className}`}
    >
      <ProvenanceGlyph provenance={provenance} />
      {compact ? copy.short : copy.label}
      <span className="sr-only">{`: ${copy.definition}${source ? ` Source: ${source}.` : ""}`}</span>
    </span>
  );
}

export function OriginChip({ origin, className = "" }: { origin: PositionOrigin; className?: string }) {
  return (
    <span
      title="Held by the connected account. Read from chain state."
      data-origin={origin}
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] border border-brand-edge/60 bg-brand-soft px-1.5 font-mono text-[10px] leading-none tracking-[0.05em] text-brand uppercase ${className}`}
    >
      Account
    </span>
  );
}

const SEVERITY_COPY: Record<ExceptionSeverity, { label: string; tone: string }> = {
  CRITICAL: { label: "Critical", tone: "border-down/30 bg-down-soft text-down" },
  ACTION: { label: "Action", tone: "border-brand-edge/50 bg-brand-soft text-brand" },
  NOTICE: { label: "Notice", tone: "border-line text-dim" },
};

export function SeverityChip({ severity }: { severity: ExceptionSeverity }) {
  const copy = SEVERITY_COPY[severity];
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] border px-1.5 font-mono text-[10px] leading-none tracking-[0.05em] uppercase ${copy.tone}`}
    >
      {severity === "CRITICAL" ? <span aria-hidden="true">!</span> : null}
      {copy.label}
    </span>
  );
}

/** One line that names every trust class, for the foot of a panel. */
export function ProvenanceLegend({ className = "", children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-faint ${className}`}>
      {(Object.keys(PROVENANCE_COPY) as Provenance[]).map((provenance) => (
        <span key={provenance} className="inline-flex items-center gap-1.5" title={PROVENANCE_COPY[provenance].definition}>
          <span className="text-dim">
            <ProvenanceGlyph provenance={provenance} />
          </span>
          {PROVENANCE_COPY[provenance].label}
        </span>
      ))}
      {children}
    </div>
  );
}
