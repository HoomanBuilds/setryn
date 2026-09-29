"use client";

import { Panel, PanelHead, deskMotion } from "@/components/strategies/desk/Desk";
import { SCENARIO_CLOCK_ISO, daysToExpiry, formatExpiry } from "@/lib/terminal/format";
import type { ExposureInput, HedgeCandidate } from "@/lib/hedges/types";

interface CashflowTimelineProps {
  exposure: ExposureInput;
  candidate: HedgeCandidate | null;
  horizonDays: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

function Cell({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2">
      <div className="truncate text-[11px] text-faint">{label}</div>
      <div className={`tnum mt-0.5 truncate font-mono text-xs ${tone}`} title={value}>
        {value}
      </div>
    </div>
  );
}

/** Keeps a marker label inside the track: left-aligned near T0, right-aligned near the end. */
function anchor(position: number): string {
  if (position < 12) return "translate-x-0";
  if (position > 88) return "-translate-x-full";
  return "-translate-x-1/2";
}

export function CashflowTimeline({ exposure, candidate, horizonDays }: CashflowTimelineProps) {
  const expiryDays = candidate ? daysToExpiry(candidate.market.expiryIso) : null;
  const gap = candidate ? candidate.tenorGapDays : null;
  // The track runs from the scenario clock to a little past the later of flow and fixing.
  const span = Math.max(horizonDays ?? 0, expiryDays ?? 0, 1) * 1.08;
  const toPos = (days: number) => Math.min(100, Math.max(0, (days / span) * 100));
  const flowPos = horizonDays === null ? null : toPos(horizonDays);
  const expiryPos = expiryDays === null ? null : toPos(expiryDays);

  const clockMs = Date.parse(SCENARIO_CLOCK_ISO);
  const ticks: { pos: number; label: string }[] = [];
  const start = new Date(clockMs);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const monthStep = span > 400 ? 3 : span > 200 ? 2 : 1;
  while ((cursor.getTime() - clockMs) / DAY_MS <= span) {
    const pos = toPos((cursor.getTime() - clockMs) / DAY_MS);
    const month = cursor.getUTCMonth();
    ticks.push({
      pos,
      label: month === 0 ? `${MONTHS[month]} ${String(cursor.getUTCFullYear()).slice(2)}` : MONTHS[month],
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + monthStep);
  }

  const gapLeft = flowPos !== null && expiryPos !== null ? Math.min(flowPos, expiryPos) : null;
  const gapWidth = flowPos !== null && expiryPos !== null ? Math.abs(flowPos - expiryPos) : 0;

  return (
    <Panel label="Cash-flow timeline" delay={40}>
      <PanelHead
        title="Cash-flow timeline"
        tools={
          <span className="tnum font-mono text-[11px] text-faint">
            {horizonDays === null ? "no date" : `${horizonDays}d horizon`}
          </span>
        }
      />

      <div className="px-4 pt-3 pb-2">
        <div className="relative h-[74px]">
          {/* Flow label sits above the track, fixing label below, so they never collide. */}
          {flowPos !== null ? (
            <div
              className={`${deskMotion.fade} absolute top-0 whitespace-nowrap transition-[left] duration-200 ease-out ${anchor(flowPos)}`}
              style={{ left: `${flowPos}%` }}
            >
              <span className="text-[10px] text-brand">Cash flow</span>
              <span className="tnum ml-1.5 font-mono text-[11px] text-ink">{exposure.exposureDateIso}</span>
            </div>
          ) : null}

          <div className="absolute inset-x-0 top-[33px] h-px bg-line-strong" aria-hidden="true" />
          <span className="absolute top-[29px] left-0 h-[9px] w-px bg-dim" aria-hidden="true" />

          {ticks.map((tick) => (
            <span key={`${tick.label}-${tick.pos}`} aria-hidden="true">
              <span className="absolute top-[30px] h-[7px] w-px bg-line-strong" style={{ left: `${tick.pos}%` }} />
              <span
                className="absolute top-[40px] -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-off"
                style={{ left: `${tick.pos}%` }}
              >
                {tick.label}
              </span>
            </span>
          ))}

          {gapLeft !== null && gapWidth > 0.2 ? (
            <span
              aria-hidden="true"
              className={`${deskMotion.hatch} absolute top-[28px] h-[11px] rounded-[2px] transition-all duration-200 ease-out`}
              style={{ left: `${gapLeft}%`, width: `${gapWidth}%` }}
            />
          ) : null}

          {flowPos !== null ? (
            <span
              aria-hidden="true"
              className="absolute top-[28px] h-[11px] w-[11px] -translate-x-1/2 rotate-45 rounded-[2px] border-2 border-brand bg-app transition-[left] duration-200 ease-out"
              style={{ left: `${flowPos}%` }}
            />
          ) : null}
          {expiryPos !== null ? (
            <span
              aria-hidden="true"
              className="absolute top-[29px] h-[9px] w-[9px] -translate-x-1/2 rounded-full border-2 border-up bg-app transition-[left] duration-200 ease-out"
              style={{ left: `${expiryPos}%` }}
            />
          ) : null}

          {expiryPos !== null && candidate ? (
            <div
              className={`${deskMotion.fade} absolute top-[56px] whitespace-nowrap transition-[left] duration-200 ease-out ${anchor(expiryPos)}`}
              style={{ left: `${expiryPos}%` }}
            >
              <span className="text-[10px] text-up">Fix / settle</span>
              <span className="tnum ml-1.5 font-mono text-[11px] text-ink">{formatExpiry(candidate.market.expiryIso)}</span>
            </div>
          ) : null}
          <span className="absolute top-[56px] left-0 font-mono text-[10px] text-faint">
            {`T0 ${SCENARIO_CLOCK_ISO.slice(0, 10)}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg border-t border-line bg-line sm:grid-cols-4">
        <Cell label="Scenario clock" value={SCENARIO_CLOCK_ISO.slice(0, 10)} tone="text-dim" />
        <Cell label="Cash flow" value={`${exposure.exposureDateIso || "-"} / ${exposure.direction.toLowerCase()}`} />
        <Cell label="Fixing" value={candidate ? candidate.market.fixingSource : "Select a package"} tone="text-dim" />
        <Cell
          label="Settlement"
          value={
            candidate
              ? `${candidate.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "Cash USDC"} / ${formatExpiry(candidate.market.expiryIso)}`
              : "-"
          }
          tone="text-dim"
        />
        <Cell
          label="Amount"
          value={`${exposure.amount > 0 ? exposure.amount.toLocaleString("en-US") : "-"} ${exposure.settlementAssetId}`}
        />
        <Cell label="Hedge horizon" value={horizonDays === null ? "-" : `${horizonDays} days`} />
        <Cell label="Package expiry" value={candidate ? formatExpiry(candidate.market.expiryIso) : "-"} />
        <Cell
          label="Tenor gap"
          value={gap === null ? "-" : `${gap} days`}
          tone={gap === null ? "text-dim" : gap === 0 ? "text-up" : gap > 30 ? "text-brand" : "text-ink"}
        />
      </div>
    </Panel>
  );
}
