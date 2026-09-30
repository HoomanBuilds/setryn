"use client";

import { Chip, Meter, Metric, Panel, PanelHead, compact, signTone } from "@/components/strategies/desk/Desk";
import { valueAt } from "@/components/strategies/desk/PayoffPlot";
import { formatNumber, formatShare, priceUnitSuffix } from "@/lib/terminal/format";
import type { HedgeCandidate } from "@/lib/hedges/types";
import type { HedgeCurves } from "./HedgePayoff";
import { MarketMark } from "@/components/portfolio/MarketMark";

function offsetAt(curves: HedgeCurves, move: number): number | null {
  const bare = valueAt(curves.unhedged, move);
  if (bare === 0) return null;
  return 1 - Math.abs(valueAt(curves.net, move)) / Math.abs(bare);
}

export function HedgeSummary({ candidate, curves }: { candidate: HedgeCandidate | null; curves: HedgeCurves | null }) {
  if (!candidate || !curves) {
    return (
      <Panel label="Hedge summary" delay={120}>
        <PanelHead title="Hedge summary" />
        <p className="px-3 py-8 text-center text-xs text-faint">No candidate selected.</p>
      </Panel>
    );
  }

  const offsets = [offsetAt(curves, -10), offsetAt(curves, 10)].filter((value): value is number => value !== null);
  const offset = offsets.length > 0 ? offsets.reduce((sum, value) => sum + value, 0) / offsets.length : null;
  const worstNet = Math.min(...curves.net.map((point) => point.y));
  const worstBare = Math.min(...curves.unhedged.map((point) => point.y));
  const tenorFit = candidate.horizonDays > 0 ? Math.max(0, 1 - candidate.tenorGapDays / candidate.horizonDays) : 0;

  return (
    <Panel label="Hedge summary" delay={120}>
      <PanelHead
        title="Hedge summary"
        tools={
          <span className="tnum flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <MarketMark underlying={candidate.market.underlying} size={13} />
            {`#${candidate.rank} ${candidate.market.code}`}
          </span>
        }
      />
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-faint">Executable price</span>
          <Chip tone="up">Executable</Chip>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="tnum font-mono text-[26px] leading-8 text-ink">
            {formatNumber(candidate.executablePrice, candidate.market.priceDecimals)}
          </span>
          <span className="text-sm text-faint">{priceUnitSuffix(candidate.market.priceUnit)}</span>
          <span className={`ml-auto text-xs ${candidate.packageDirection === "LONG" ? "text-up" : "text-down"}`}>
            {`${candidate.packageDirection === "LONG" ? "Long" : "Short"} ${candidate.lots} lots`}
          </span>
        </div>
      </div>

      <div className="space-y-2.5 border-t border-line-soft px-3 py-2.5">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
            <span className="text-faint">Notional coverage</span>
            <span className="tnum font-mono text-dim">{formatShare(candidate.coverageRatio, 0)}</span>
          </div>
          <Meter
            value={candidate.coverageRatio / 1.5}
            limit={1 / 1.5}
            tone={candidate.coverageRatio >= 1 ? "up" : "brand"}
            label="Notional coverage against the exposure, tick at 100 percent"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
            <span className="text-faint">Tenor fit</span>
            <span className="tnum font-mono text-dim">{`${candidate.tenorGapDays}d gap / ${candidate.horizonDays}d`}</span>
          </div>
          <Meter value={tenorFit} tone={tenorFit > 0.9 ? "up" : "brand"} label="Tenor fit between cash flow and package expiry" />
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line border-t border-line [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-line">
        <Metric
          label="Offset at ±10%"
          value={offset === null ? "-" : formatShare(Math.max(-9.99, offset), 0)}
          tone={offset === null ? "dim" : offset > 0.5 ? "up" : offset > 0 ? "brand" : "down"}
          note="Share of move neutralised"
        />
        <Metric label="Carry at 0%" value={compact(valueAt(curves.net, 0), true)} tone={signTone(valueAt(curves.net, 0))} note="Net, unchanged reference" />
        <Metric label="Worst hedged" value={compact(worstNet, true)} tone={signTone(worstNet)} note="Across modeled range" />
        <Metric label="Worst unhedged" value={compact(worstBare, true)} tone={signTone(worstBare)} note="Bare cash-flow move" />
        <Metric label="Est. collateral" value={compact(candidate.collateralEstimate)} note="Modeled, USDC" />
        <Metric label="Residual" value={compact(candidate.residualEstimate)} note="Modeled, USDC" />
      </div>
    </Panel>
  );
}
