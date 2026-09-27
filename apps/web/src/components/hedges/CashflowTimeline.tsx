"use client";

import { daysToExpiry, formatExpiry } from "@/lib/terminal/format";
import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import type { ExposureInput, HedgeCandidate } from "@/lib/hedges/types";

interface CashflowTimelineProps {
  exposure: ExposureInput;
  candidate: HedgeCandidate | null;
  horizonDays: number | null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="truncate text-xs text-faint">{label}</div>
      <div className="tnum mt-0.5 truncate font-mono text-xs text-ink">{value}</div>
    </div>
  );
}

export function CashflowTimeline({ exposure, candidate, horizonDays }: CashflowTimelineProps) {
  const expiryDays = candidate ? daysToExpiry(candidate.market.expiryIso) : null;
  const gap = candidate ? candidate.tenorGapDays : null;
  // Timeline spans scenario clock -> max(exposure, expiry). Positions are fractions of that span.
  const span = Math.max(horizonDays ?? 0, expiryDays ?? 0, 1);
  const exposurePos = horizonDays === null ? 0 : Math.min(100, Math.max(0, (horizonDays / span) * 100));
  const expiryPos =
    expiryDays === null ? null : Math.min(100, Math.max(0, (expiryDays / span) * 100));

  return (
    <section aria-label="Cash-flow timeline" className="border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
          Cash-flow timeline
        </span>
        <span className="tnum font-mono text-xs text-off">
          {horizonDays === null ? "no date" : `${horizonDays}d horizon`}
        </span>
      </div>

      <div className="px-3 pt-3">
        <div className="relative h-10 border-b border-line">
          <span className="absolute bottom-2 left-0 h-3 w-px bg-line-strong" aria-hidden="true" />
          <span className="absolute bottom-2 left-0 translate-y-5 text-xs text-off">T0</span>
          <span
            className="absolute bottom-2 h-3 w-[2px] bg-brand"
            style={{ left: `${exposurePos}%` }}
            aria-hidden="true"
          />
          <span
            className="absolute bottom-2 translate-x-[-50%] translate-y-5 font-mono text-xs text-dim"
            style={{ left: `${exposurePos}%` }}
          >
            flow
          </span>
          {expiryPos !== null ? (
            <>
              <span
                className="absolute bottom-2 h-3 w-px bg-up"
                style={{ left: `${expiryPos}%` }}
                aria-hidden="true"
              />
              <span
                className="absolute bottom-2 translate-x-[-50%] translate-y-5 font-mono text-xs text-faint"
                style={{ left: `${expiryPos}%` }}
              >
                fix/settle
              </span>
            </>
          ) : null}
        </div>

        <dl className="mt-7 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line py-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-faint">Scenario clock</dt>
            <dd className="tnum mt-0.5 font-mono text-dim">{SCENARIO_CLOCK_ISO.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="text-faint">Cash flow</dt>
            <dd className="tnum mt-0.5 font-mono text-ink">
              {exposure.exposureDateIso || "—"} · {exposure.direction.toLowerCase()}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Fixing</dt>
            <dd className="mt-0.5 truncate text-dim">
              {candidate ? candidate.market.fixingSource : "Select a package"}
            </dd>
          </div>
          <div>
            <dt className="text-faint">Settlement</dt>
            <dd className="tnum mt-0.5 font-mono text-dim">
              {candidate
                ? `${candidate.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "Cash USDC"} · ${formatExpiry(candidate.market.expiryIso)}`
                : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-4">
        <Stat
          label="Amount"
          value={`${exposure.amount > 0 ? exposure.amount.toLocaleString("en-US") : "—"} ${exposure.settlementAssetId}`}
        />
        <Stat
          label="Hedge horizon"
          value={horizonDays === null ? "—" : `${horizonDays} days`}
        />
        <Stat
          label="Package expiry"
          value={candidate ? formatExpiry(candidate.market.expiryIso) : "—"}
        />
        <Stat
          label="Tenor gap"
          value={gap === null ? "—" : `${gap} days`}
        />
      </div>
    </section>
  );
}
