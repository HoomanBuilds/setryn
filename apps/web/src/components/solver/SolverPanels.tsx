"use client";

import { Chip } from "@/components/activity/ledger-ui";
import { Meter, Panel, PanelHead, Row, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import { ProvenanceChip, clockText, countdownText, priceText, signedPrice, usd } from "@/components/auctions/board-kit";
import { marketOf } from "@/lib/auctions/schedule";
import type { LiquidityProvenance } from "@/lib/auctions/types";
import type {
  CapacityLedger,
  RecoveryCase,
  RejectReason,
  RoutePlan,
  SolverOpportunity,
  SolverPerformance,
} from "@/lib/solver/types";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import { MARKETS, packageLabel } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

/* ------------------------------------------------------------------ */
/* Liquidity classes                                                   */
/* ------------------------------------------------------------------ */

export const CLASS_COPY: Partial<Record<LiquidityProvenance, { label: string; fill: string }>> = {
  DIRECT: { label: "Direct", fill: "bg-ink/80" },
  IMPLIED_IN: { label: "Implied", fill: "bg-ink/45" },
  SOLVER_FIRM: { label: "Solver firm", fill: "bg-brand/80" },
  INDICATIVE: { label: "Indicative", fill: "bg-off" },
};

/** Shape per class so provenance never depends on colour: square, outline, diamond, dash. */
export function ClassMark({ provenance }: { provenance: LiquidityProvenance }) {
  if (provenance === "DIRECT") {
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0 text-ink">
        <rect x="0.5" y="0.5" width="7" height="7" fill="currentColor" />
      </svg>
    );
  }
  if (provenance === "IMPLIED_IN" || provenance === "IMPLIED_OUT") {
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0 text-dim">
        <rect x="0.75" y="0.75" width="6.5" height="6.5" fill="none" stroke="currentColor" />
      </svg>
    );
  }
  if (provenance === "INDICATIVE") {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0 text-off">
        <path d="M0.5 4 H7.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0 text-brand">
      <path d="M4 0.4 L7.6 4 L4 7.6 L0.4 4 Z" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Route plan                                                          */
/* ------------------------------------------------------------------ */

function PlanFigures({ plan, market, opportunity }: { plan: RoutePlan; market: PackageMarket; opportunity: SolverOpportunity }) {
  const unit = market.priceUnit === "BP" ? "bp" : market.priceUnit === "PTS" ? "pts" : "USD";
  const room = opportunity.edgeUsd;
  return (
    <div className="grid content-start gap-0 border-line px-3 py-2 lg:border-r">
      <Row label="Hedge in market" value={`${plan.hedgeAction === "BUY" ? "Buy" : "Sell"} ${formatLots(plan.requestedLots)} lots`} />
      <Row
        label="Executable depth used"
        value={`${formatLots(plan.fillableLots)} / ${formatLots(plan.requestedLots)}`}
        tone={plan.fillableLots < plan.requestedLots ? "down" : "neutral"}
      />
      <Row label="Touch" value={`${priceText(plan.touch, market)} ${unit}`} />
      <Row label="Hedge VWAP" value={plan.vwap !== null ? `${priceText(plan.vwap, market)} ${unit}` : "—"} />
      <Row label="Worst level" value={plan.worst !== null ? `${priceText(plan.worst, market)} ${unit}` : "—"} />
      <Row label="Fees" value={`${usd(plan.feesUsd)} USDC`} title={`${signedPrice(plan.feePrice, market)} ${unit} per package`} />
      <Row
        label="Break-even price"
        value={plan.breakEven !== null ? `${priceText(plan.breakEven, market)} ${unit}` : "—"}
        tone="neutral"
        className="border-t border-line pt-1"
      />
      <Row
        label="Room vs screen"
        value={room !== null ? `${usd(room, true)} USDC` : "Depth short"}
        tone={room === null ? "dim" : room >= 0 ? "up" : "down"}
        title="Touch minus break-even for the full size. Negative means the route needs a premium over the screen price."
      />
      <Row label="Sequenced exposure" value={`${usd(plan.sequencedExposureUsd)} USDC`} title="Notional exposed between the first and last leg print on implied routes" />
      <Row label="Hedge collateral" value={`${usd(plan.collateralUsd)} USDC`} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ProvenanceChip value="ESTIMATED" title="Computed from the shared preview feed's executable book rows." />
        <span className="text-[10px] text-faint">Own quotes excluded, indicative depth excluded</span>
      </div>
    </div>
  );
}

function ClassMix({ plan }: { plan: RoutePlan }) {
  return (
    <div className="px-3 pt-2.5 pb-1">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-[2px]" role="img" aria-label="Route mix by liquidity class">
        {plan.byClass.map((entry) => (
          <span
            key={entry.provenance}
            className={`h-full ${CLASS_COPY[entry.provenance]?.fill ?? "bg-dim"} transition-[width] duration-300 ease-out`}
            style={{ width: `${entry.share * 100}%` }}
            title={`${CLASS_COPY[entry.provenance]?.label ?? entry.provenance}: ${formatLots(entry.lots)} lots`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
        {plan.byClass.map((entry) => (
          <span key={entry.provenance} className="flex items-center gap-1.5">
            <ClassMark provenance={entry.provenance} />
            {CLASS_COPY[entry.provenance]?.label ?? entry.provenance}
            <span className="tnum font-mono text-faint">{`${formatLots(entry.lots)} · ${Math.round(entry.share * 100)}%`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Ladder({ plan, market }: { plan: RoutePlan; market: PackageMarket }) {
  const maxLots = Math.max(1, ...plan.fills.map((fill) => fill.lots), ...plan.exclusions.map((entry) => entry.lots));
  const cumulative = plan.fills.reduce<number[]>((running, fill) => [...running, (running[running.length - 1] ?? 0) + fill.lots], []);
  return (
    <div role="region" tabIndex={0} aria-label="Route fill ladder" className="focus-ring scroll-thin overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-line">
            <th className={TH}>Source</th>
            <th className={TH_NUM}>Price</th>
            <th className={TH}>Size used</th>
            <th className={TH_NUM}>Cum.</th>
            <th className={TH}>Reservation</th>
            <th className={TH}>Invalidates when</th>
          </tr>
        </thead>
        <tbody>
          {plan.fills.map((fill, index) => {
            return (
              <tr key={`${fill.provenance}-${fill.price}-${index}`} className="border-b border-line/60 last:border-b-0">
                <td className="h-8 px-3">
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-dim">
                    <ClassMark provenance={fill.provenance} />
                    <span className="text-ink">{CLASS_COPY[fill.provenance]?.label}</span>
                    {fill.origin ? <span className="max-w-[160px] truncate text-[10px] text-faint" title={fill.origin}>{fill.origin}</span> : null}
                  </span>
                </td>
                <td className="tnum px-3 text-right font-mono text-ink">{priceText(fill.price, market)}</td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <span className="relative h-[5px] w-24 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span
                        className={`absolute inset-y-0 left-0 rounded-full ${CLASS_COPY[fill.provenance]?.fill ?? "bg-dim"}`}
                        style={{ width: `${(fill.lots / maxLots) * 100}%` }}
                      />
                    </span>
                    <span className="tnum font-mono text-ink">{formatLots(fill.lots)}</span>
                  </span>
                </td>
                <td className="tnum px-3 text-right font-mono text-dim">{formatLots(cumulative[index])}</td>
                <td className="px-3 text-[11px] whitespace-nowrap text-faint">
                  {fill.reservation === "NOT_REQUIRED" ? "Atomic at match" : "Reserve on commit"}
                </td>
                <td className="max-w-[220px] truncate px-3 text-[11px] text-faint" title={fill.invalidation}>
                  {fill.invalidation}
                </td>
              </tr>
            );
          })}
          {plan.exclusions.map((entry, index) => (
            <tr key={`excluded-${entry.price}-${index}`} className="border-b border-line/60 text-faint last:border-b-0">
              <td className="h-8 px-3">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <ClassMark provenance={entry.provenance} />
                  <span>{entry.reason === "SELF_MATCH" ? "Own quote" : "Indicative"}</span>
                </span>
              </td>
              <td className="tnum px-3 text-right font-mono line-through decoration-off">{priceText(entry.price, market)}</td>
              <td className="tnum px-3 font-mono">{formatLots(entry.lots)}</td>
              <td className="px-3 text-right">—</td>
              <td colSpan={2} className="px-3 text-[11px]">
                {entry.reason === "SELF_MATCH"
                  ? "Excluded: self-match protection, a solver cannot hedge into its own firm quote."
                  : "Excluded: indicative size never counts as executable depth."}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoutePlanPanel({ opportunity, liveMarket }: { opportunity: SolverOpportunity | null; liveMarket: PackageMarket | null }) {
  if (!opportunity || !liveMarket) {
    return (
      <Panel label="Route plan" delay={60}>
        <PanelHead title="Routes and implied liquidity" />
        <p className="px-3 py-10 text-center text-xs text-faint">Select an opportunity to plan its hedge route.</p>
      </Panel>
    );
  }
  const plan = opportunity.plan;
  return (
    <Panel label="Route plan" delay={60}>
      <PanelHead
        title="Routes and implied liquidity"
        tools={
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-faint">
            <span className="hidden truncate sm:inline">{`${packageLabel(liveMarket)} · ${opportunity.label}`}</span>
            <ProvenanceChip value="ESTIMATED" />
          </span>
        }
      />
      <div key={opportunity.id} className={`grid min-w-0 lg:grid-cols-[260px_minmax(0,1fr)] ${deskMotion.fade}`}>
        <PlanFigures plan={plan} market={liveMarket} opportunity={opportunity} />
        <div className="min-w-0">
          <ClassMix plan={plan} />
          <Ladder plan={plan} market={liveMarket} />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

const BUCKET_FILL: Record<CapacityLedger["buckets"][number]["id"], string> = {
  AVAILABLE: "bg-up/80",
  BOND_LOCKS: "bg-brand/80",
  ROUTE_RESERVATIONS: "bg-ink/70",
  WITHDRAWAL_DELAYED: "bg-dim/50",
  RECOVERY_RESERVE: "bg-off",
};

export function CapacityPanel({ ledger, epoch }: { ledger: CapacityLedger; epoch: number }) {
  return (
    <Panel label="Reserved capacity" delay={40}>
      <PanelHead title="Capacity" tools={<ProvenanceChip value="MODELED" />} />
      <div className="px-3 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-faint">Bonded capital</span>
          <span className="tnum font-mono text-sm text-ink">{`${usd(ledger.totalUsd)} USDC`}</span>
        </div>
        <div className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-[2px]" role="img" aria-label="Capacity by bucket">
          {ledger.buckets.map((bucket) => (
            <span
              key={bucket.id}
              className={`h-full ${BUCKET_FILL[bucket.id]} transition-[width] duration-300 ease-out`}
              style={{ width: `${(bucket.amountUsd / Math.max(1, ledger.totalUsd)) * 100}%`, minWidth: bucket.amountUsd > 0 ? 2 : 0 }}
              title={`${bucket.label}: ${usd(bucket.amountUsd)} USDC`}
            />
          ))}
        </div>
      </div>
      <ul className="px-3 py-2">
        {ledger.buckets.map((bucket) => (
          <li key={bucket.id} className="flex items-start justify-between gap-3 border-b border-line/60 py-2 last:border-b-0">
            <span className="flex min-w-0 items-start gap-2">
              <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-[2px] ${BUCKET_FILL[bucket.id]}`} />
              <span className="min-w-0">
                <span className="block text-xs text-ink">{bucket.label}</span>
                <span className="block truncate text-[11px] text-faint">{bucket.description}</span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className={`tnum font-mono text-xs ${bucket.id === "AVAILABLE" ? "text-up" : "text-ink"}`}>{usd(bucket.amountUsd)}</span>
              <span className="tnum font-mono text-[10px] text-off">{`${Math.round((bucket.amountUsd / Math.max(1, ledger.totalUsd)) * 100)}%`}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
        Locks and reservations
      </div>
      {ledger.bondLocks.length === 0 && ledger.reservations.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-faint">No bonds or route reservations held.</p>
      ) : (
        <ul className="px-3 pb-2">
          {ledger.reservations.map((entry) => (
            <li key={entry.reservation.reservationKey} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{entry.auction.label}</span>
                <span className="block text-[11px] text-faint">
                  {`Route reservation · ${formatLots(entry.reservation.quantity)} lots · ${entry.reservation.status.toLowerCase()}`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="tnum font-mono text-xs text-ink">{usd(entry.collateralUsd)}</span>
                <span className="tnum font-mono text-[10px] text-faint">
                  {entry.reservation.expiry > epoch ? `expires ${countdownText(entry.reservation.expiry - epoch)}` : "expired"}
                </span>
              </span>
            </li>
          ))}
          {ledger.bondLocks.map((lock) => (
            <li key={lock.bidId} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{lock.auction.label}</span>
                <span className="block truncate text-[11px] text-faint">{lock.detail}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="tnum font-mono text-xs text-ink">{usd(lock.amountUsd)}</span>
                <span className={`tnum font-mono text-[10px] ${lock.state === "RELEASE_DUE" ? "text-brand" : "text-faint"}`}>
                  {lock.state === "RELEASE_DUE"
                    ? "release due"
                    : lock.releasesAt > epoch
                      ? `until ${clockText(lock.releasesAt)}`
                      : "resolving"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

const RECOVERY_TONE: Record<RecoveryCase["state"], "brand" | "neutral" | "muted"> = {
  ACTIONABLE: "brand",
  WATCH: "neutral",
  RESOLVED: "muted",
};

export function RecoveryPanel({ cases, epoch }: { cases: RecoveryCase[]; epoch: number }) {
  const open = cases.filter((entry) => entry.state !== "RESOLVED").length;
  return (
    <Panel label="Recovery cases" delay={80}>
      <PanelHead
        title="Recovery"
        tools={
          <>
            <span className="tnum font-mono text-[11px] text-faint">{`${open} open`}</span>
            <ProvenanceChip value="MODELED" />
          </>
        }
      />
      {cases.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">No settlement, bond or reservation cases in the last 60 minutes.</p>
      ) : (
        <ul className="scroll-thin max-h-[360px] overflow-y-auto">
          {cases.map((entry) => (
            <li key={entry.id} className="border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-ink">{entry.title}</span>
                <Chip tone={RECOVERY_TONE[entry.state]} dot={entry.state !== "RESOLVED"}>
                  {entry.state === "ACTIONABLE" ? "Actionable" : entry.state === "WATCH" ? "Watch" : "Resolved"}
                </Chip>
              </div>
              <div className="tnum mt-0.5 flex items-center justify-between gap-2 font-mono text-[11px] text-faint">
                <span className="truncate">{entry.auction.label}</span>
                <span className="shrink-0">{`${usd(entry.amountUsd)} USDC`}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-faint">{entry.detail}</p>
              {entry.call ? (
                <p className="tnum mt-1.5 flex items-center justify-between gap-2 rounded-md border border-line bg-inset px-2 py-1 font-mono text-[10px] text-dim">
                  <span className="truncate" title="Permissionless completion path">{entry.call}</span>
                  <span className="shrink-0 text-faint">
                    {entry.callableAt !== null && entry.callableAt > epoch ? `in ${countdownText(entry.callableAt - epoch)}` : "callable now"}
                  </span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

const REJECT_COPY: Record<RejectReason, string> = {
  LOST_ON_PRICE: "Lost on price",
  LOST_ON_TIE_BREAK: "Lost on tie-break",
  SIZE_RULE: "Minimum fill not met",
  UNREVEALED: "Not revealed",
  NO_CLEAR: "Round did not clear",
};

const OUTCOME_COPY: Record<SolverPerformance["recent"][number]["outcome"], { label: string; className: string }> = {
  WON: { label: "Won", className: "text-up" },
  PENDING: { label: "Pending", className: "text-dim" },
  LOST_ON_PRICE: { label: "Price", className: "text-faint" },
  LOST_ON_TIE_BREAK: { label: "Tie-break", className: "text-faint" },
  SIZE_RULE: { label: "Min fill", className: "text-faint" },
  UNREVEALED: { label: "Unrevealed", className: "text-down" },
  NO_CLEAR: { label: "No clear", className: "text-faint" },
};

export function PerformancePanel({ performance }: { performance: SolverPerformance }) {
  const rejectTotal = Object.values(performance.rejects).reduce((sum, value) => sum + value, 0);
  const maxReject = Math.max(1, ...Object.values(performance.rejects));
  return (
    <Panel label="Performance" delay={100}>
      <PanelHead
        title="Performance"
        tools={
          <>
            <span className="text-[11px] text-faint">Last 60 min</span>
            <ProvenanceChip value="MODELED" />
          </>
        }
      />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="border-line px-3 py-2 lg:border-r">
          <Row label="Bids decided" value={formatNumber(performance.bids, 0)} />
          <Row label="Win rate" value={`${Math.round(performance.winRate * 100)}%`} title="Wins over revealed bids" />
          <Row label="Fill rate" value={`${Math.round(performance.fillRate * 100)}%`} title="Allocated lots over revealed bid lots" />
          <Row
            label="Edge captured"
            value={`${usd(performance.edgeUsd, true)} USDC`}
            tone={performance.edgeUsd >= 0 ? "up" : "down"}
            title="Allocation price versus the feed mark at commit open, for winning bids"
          />
          <Row label="Edge per win" value={`${usd(performance.edgePerWinUsd, true)} USDC`} />
          <Row label="Commit latency" value={`${Math.round(performance.responseSeconds)}s`} title="Mean seconds from commit open to own commitment" />
          <div className="mt-2 border-t border-line pt-2">
            <div className="flex items-baseline justify-between text-[11px] text-faint">
              <span>Rejects</span>
              <span className="tnum font-mono">{rejectTotal}</span>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {(Object.keys(REJECT_COPY) as RejectReason[]).map((reason) => (
                <li key={reason} className="grid grid-cols-[minmax(0,1fr)_90px_24px] items-center gap-2 text-[11px]">
                  <span className="truncate text-dim">{REJECT_COPY[reason]}</span>
                  <Meter value={performance.rejects[reason] / maxReject} tone={reason === "UNREVEALED" ? "down" : "dim"} label={REJECT_COPY[reason]} height="h-[3px]" />
                  <span className="tnum text-right font-mono text-ink">{performance.rejects[reason]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="min-w-0">
          <div role="region" tabIndex={0} aria-label="Route comparison" className="focus-ring scroll-thin overflow-x-auto">
            <table className="w-full min-w-[380px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th className={TH}>Market</th>
                  <th className={TH_NUM}>Bids</th>
                  <th className={TH_NUM}>Wins</th>
                  <th className={TH_NUM}>Fill</th>
                  <th className={TH_NUM}>Edge</th>
                </tr>
              </thead>
              <tbody>
                {performance.byMarket.map((row) => {
                  const market = MARKETS.find((candidate) => candidate.id === row.marketId);
                  return (
                    <tr key={row.marketId} className="border-b border-line/60 last:border-b-0">
                      <td className="h-8 max-w-[160px] truncate px-3 text-ink" title={row.marketId}>
                        {market ? packageLabel(market) : row.marketId}
                      </td>
                      <td className="tnum px-3 text-right font-mono text-dim">{row.bids}</td>
                      <td className="tnum px-3 text-right font-mono text-ink">{row.wins}</td>
                      <td className="tnum px-3 text-right font-mono text-dim">
                        {row.bidLots > 0 ? `${Math.round((row.allocatedLots / row.bidLots) * 100)}%` : "—"}
                      </td>
                      <td className={`tnum px-3 text-right font-mono ${row.edgeUsd >= 0 ? "text-up" : "text-down"}`}>{usd(row.edgeUsd, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-3 pt-2 pb-1 text-[11px] text-faint">Recent rounds</div>
          <ul className="flex flex-wrap gap-1 px-3 pb-3">
            {performance.recent.slice(0, 24).map((entry) => {
              const copy = OUTCOME_COPY[entry.outcome];
              return (
                <li
                  key={entry.auction.id}
                  title={`${entry.auction.label}: ${copy.label}${entry.edgeUsd !== null ? `, ${usd(entry.edgeUsd, true)} USDC edge` : ""}`}
                  className={`tnum rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] ${copy.className}`}
                >
                  {`${marketOf(entry.auction).code.split("-")[0]} ${copy.label}`}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
