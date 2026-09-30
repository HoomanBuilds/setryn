"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  FileCheck2,
  Lock,
  SearchX,
  ShieldCheck,
  TriangleAlert,
  Trophy,
} from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import {
  BUTTON_INK,
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  Chip,
  CopyButton,
  Kpi,
  KpiStrip,
  Panel,
  PanelHeader,
  PanelTitle,
  TtlBar,
  formatCountdown,
  formatUtcFull,
  formatUtcTime,
  middleTruncate,
  motion,
  useNow,
  useWalletPrompt,
} from "@/components/activity/ledger-ui";
import { StepTimeline, type TimelineStep } from "@/components/activity/StepTimeline";
import { ProvenanceChip } from "@/components/auctions/board-kit";
import { Flash } from "@/components/strategies/desk/Desk";
import type { SubmissionUpdate } from "@/lib/internal-gateway/types";
import { formatLots, formatUsd } from "@/lib/terminal/format";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { StatusChip } from "./RfqBlotter";
import { RfqStages, type RfqStageId, type RfqStageState } from "./RfqStages";
import { gatewayErrorCode, gatewayErrorCopy } from "./rfq-errors";
import { SAMPLE_REQUEST_ID, sampleRequest } from "./rfq-sample";
import {
  EXCLUSION_COPY,
  priceText,
  quoteCompetition,
  rfqView,
  signedPriceText,
  unitText,
  type CompetingQuote,
  type QuoteCompetition,
  type RfqView,
} from "./rfq-view";
import { MarketMark } from "@/components/portfolio/MarketMark";

type Busy = null | { kind: "SELECT"; quoteId: string } | { kind: "EXECUTE" } | { kind: "CANCEL" };

interface ActionError {
  message: string;
  code: string;
}

/* ------------------------------------------------------------------ */
/* Missing request                                                     */
/* ------------------------------------------------------------------ */

function MissingRequest({ requestId }: { requestId: string }) {
  const wallet = useWalletPrompt();
  return (
    <main className="scroll-thin flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-app px-4 py-10">
      <div className={`w-full max-w-[460px] rounded-lg border border-line bg-panel px-5 py-6 text-center ${motion.mount}`}>
        {wallet.connected ? (
          <SearchX size={20} aria-hidden="true" className="mx-auto text-faint" />
        ) : (
          <Lock size={20} aria-hidden="true" className="mx-auto text-faint" />
        )}
        <p className="mt-3 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
          {wallet.connected ? "Request not found" : "Private request"}
        </p>
        <h1 className="mt-1 font-serif text-[22px] leading-7 text-ink">
          {wallet.connected ? "No RFQ with this ID for your account" : "Connect to load this request"}
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          {wallet.connected
            ? "Private requests are read from the local chain for the connected taker only. This ID does not match any of them."
            : "Private requests are read from the local chain for the connected taker only, so the quote competition loads after you connect."}
        </p>
        <p className="mx-auto mt-3 flex max-w-full items-center justify-center gap-1 rounded-md border border-line bg-inset px-2 py-1">
          <span className="tnum truncate font-mono text-[11px] text-faint" title={requestId}>
            {middleTruncate(requestId, 14, 8)}
          </span>
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {wallet.connected ? null : (
            <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={BUTTON_INK}>
              {wallet.connecting ? "Connecting..." : "Connect wallet"}
            </button>
          )}
          <Link href="/rfqs" className={BUTTON_QUIET}>
            RFQ ledger
          </Link>
          <Link href="/rfqs/new" className={BUTTON_QUIET}>
            New RFQ
          </Link>
        </div>
        {wallet.error ? <p className="mt-2 text-xs text-down">{wallet.error}</p> : null}
        <p className="mt-4 text-[11px] text-faint">
          Want to see how a competition reads first?{" "}
          <Link href={`/rfqs/${SAMPLE_REQUEST_ID}`} className="text-dim underline decoration-line-strong underline-offset-2 hover:text-ink">
            Open the modeled walkthrough
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Quote board                                                         */
/* ------------------------------------------------------------------ */

const BOARD_GRID =
  "grid grid-cols-[26px_minmax(150px,1.3fr)_104px_86px_86px_minmax(120px,1fr)_minmax(130px,1fr)_84px_minmax(110px,0.9fr)_16px] items-center gap-3";

function QuoteDetails({ entry, view, market }: { entry: CompetingQuote; view: RfqView; market: PackageMarket | null }) {
  const intent = view.request.authorization.intent;
  const lots = intent.lots;
  const value = entry.quote.packagePrice * intent.contractMultiplier * lots;
  return (
    <div className={`grid grid-cols-2 gap-x-6 gap-y-2 border-b border-line bg-inset/60 px-4 py-3 text-xs sm:grid-cols-4 ${motion.fade}`}>
      <div>
        <div className="text-[11px] text-faint">Package value at quote</div>
        <div className="tnum mt-0.5 font-mono text-ink">{formatUsd(value, 2)}</div>
      </div>
      <div>
        <div className="text-[11px] text-faint">Fee cap</div>
        <div className="tnum mt-0.5 font-mono text-ink">{formatUsd(entry.quote.feeCap, 2)}</div>
      </div>
      <div>
        <div className="text-[11px] text-faint">Collateral bound</div>
        <div className="tnum mt-0.5 font-mono text-ink">
          {intent.collateralRequired > 0 ? formatUsd(intent.collateralRequired, 2) : "Not bound"}
        </div>
      </div>
      <div>
        <div className="text-[11px] text-faint">Capacity evidence</div>
        <div className="mt-0.5 text-dim">
          {entry.quote.provenance === "DEVNET_MAKER" ? "Reserved onchain with the quote" : "Seeded firm quote"}
        </div>
      </div>
      <div className="col-span-2">
        <div className="text-[11px] text-faint">Settlement class</div>
        <div className="mt-0.5 text-dim">{entry.quote.settlementGuarantee}</div>
      </div>
      <div className="col-span-2">
        <div className="text-[11px] text-faint">Eligibility</div>
        <div className={`mt-0.5 ${entry.exclusion ? "text-down" : "text-dim"}`}>
          {entry.exclusion
            ? entry.exclusion === "CAPACITY"
              ? `Excluded: capacity ${formatLots(entry.quote.capacityLots)} lots is below the ${formatLots(lots)} lots requested. Execution requires full capacity.`
              : entry.exclusion === "CLASS"
                ? "Excluded from automatic ranking: its settlement class differs from the other quotes. Compare it as a tradeoff."
                : "Excluded: the quote expired before selection."
            : `Eligible. ${market ? `${signedPriceText(entry.improvement, market)} ${unitText(market)} against your limit.` : ""}`}
        </div>
      </div>
    </div>
  );
}

function QuoteBoard({
  view,
  competition,
  market,
  liveMark,
  now,
  canSelect,
  busy,
  onSelect,
}: {
  view: RfqView;
  competition: QuoteCompetition;
  market: PackageMarket | null;
  liveMark: number | null;
  now: number;
  canSelect: boolean;
  busy: Busy;
  onSelect: (quoteId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const lots = view.request.authorization.intent.lots;
  /* Ranked quotes first, then everything excluded from automatic ranking, each with its reason. */
  const ordered = [...competition.eligible, ...competition.quotes.filter((entry) => entry.exclusion !== null)];
  const firstExcluded = competition.eligible.length;
  if (competition.quotes.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-ink">{view.active ? "Waiting for maker quotes" : "No firm quotes were recorded"}</p>
        <p className="mt-1 text-xs text-faint">
          {view.active
            ? "Invited makers answer privately with signed, capacity-backed quotes. They appear here as they commit."
            : "The request closed before any maker committed a quote."}
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <div className="min-w-[1000px]">
          <div className={`${BOARD_GRID} border-b border-line px-3 py-1.5 text-[11px] text-faint`}>
            <span>#</span>
            <span>Maker</span>
            <span className="text-right">{view.action === "BUY" ? "Ask" : "Bid"}</span>
            <span className="text-right">vs limit</span>
            <span className="text-right">vs mark</span>
            <span>Capacity vs size</span>
            <span>Settlement</span>
            <span className="text-right">Fee cap</span>
            <span>Expires</span>
            <span />
          </div>
          <ul>
            {ordered.map((entry, index) => {
              const isWinner = competition.winner?.quote.id === entry.quote.id;
              const open = expanded === entry.quote.id;
              const vsMark = liveMark !== null ? entry.quote.packagePrice - liveMark : null;
              const improvementTone = entry.improvement > 0 ? "text-up" : entry.improvement < 0 ? "text-down" : "text-faint";
              return (
                <Fragment key={entry.quote.id}>
                  {index === firstExcluded && index > 0 ? (
                    <li className="border-b border-line bg-inset/60 px-3 py-1 text-[10px] font-medium tracking-[0.06em] text-faint uppercase">
                      Not ranked against the winner
                    </li>
                  ) : null}
                  <li
                    style={{ ["--i" as string]: index }}
                    className={`${motion.stagger} border-b border-line ${
                      entry.isSelected ? "bg-up-soft/30" : isWinner ? "bg-brand-soft/40" : entry.exclusion ? "opacity-80" : ""
                    }`}
                  >
                    <div className={`${BOARD_GRID} px-3 py-2`}>
                      <span
                        className={`tnum flex h-5 w-5 items-center justify-center rounded-sm font-mono text-[11px] ${
                          isWinner ? "bg-brand text-app" : entry.exclusion ? "border border-dashed border-line-strong text-faint" : "bg-raised text-dim"
                        }`}
                        aria-label={entry.exclusion ? "Excluded from ranking" : `Rank ${index + 1}`}
                      >
                        {entry.exclusion ? "–" : competition.eligible.indexOf(entry) + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs text-ink">{entry.quote.solverLabel}</span>
                          {entry.isSelected ? <Chip tone="up">Selected</Chip> : isWinner ? <Chip tone="brand">Wins</Chip> : null}
                        </span>
                        <span className="block truncate text-[10px] text-faint">
                          {entry.exclusion ? EXCLUSION_COPY[entry.exclusion] : entry.quote.provenance === "DEVNET_MAKER" ? "Setryn maker, firm" : "Firm, capacity-backed"}
                        </span>
                      </span>
                      <span className="tnum text-right font-mono text-sm text-ink">{priceText(entry.quote.packagePrice, market, false)}</span>
                      <span className={`tnum text-right font-mono text-xs ${improvementTone}`}>{signedPriceText(entry.improvement, market)}</span>
                      <span className="tnum text-right font-mono text-xs text-dim">
                        {vsMark !== null && market ? <Flash value={vsMark}>{signedPriceText(vsMark, market)}</Flash> : "—"}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="relative h-[4px] min-w-10 flex-1 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-full ${entry.coverage >= 1 ? "bg-ink/70" : "bg-down/70"}`}
                            style={{ width: `${Math.round(entry.coverage * 100)}%` }}
                          />
                        </span>
                        <span className={`tnum shrink-0 font-mono text-[11px] ${entry.quote.capacityLots < lots ? "text-down" : "text-dim"}`}>
                          {`${formatLots(entry.quote.capacityLots)}/${formatLots(lots)}`}
                        </span>
                      </span>
                      <span className="truncate text-[11px] text-dim" title={entry.quote.settlementGuarantee}>
                        {entry.quote.settlementGuarantee}
                      </span>
                      <span className="tnum text-right font-mono text-xs text-dim">{formatUsd(entry.quote.feeCap, 2).replace(" USDC", "")}</span>
                      <span className="min-w-0">
                        {view.active ? (
                          <TtlBar startMs={view.createdMs} endMs={entry.expiresMs} now={now} />
                        ) : (
                          <span className="text-[11px] text-faint">{entry.expired ? "Expired" : "Closed"}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : entry.quote.id)}
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} quote detail for ${entry.quote.solverLabel}`}
                        className="focus-ring flex h-5 w-5 items-center justify-center rounded-sm text-faint hover:text-ink"
                      >
                        <ChevronDown size={13} aria-hidden="true" className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                    {canSelect && !entry.exclusion && !isWinner ? (
                      <div className="-mt-1 flex justify-end px-3 pb-2">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => onSelect(entry.quote.id)}
                          className={`${BUTTON_QUIET} h-6 px-2 text-[11px]`}
                        >
                          {busy?.kind === "SELECT" && busy.quoteId === entry.quote.id ? "Selecting..." : "Select instead"}
                        </button>
                      </div>
                    ) : null}
                    {open ? <QuoteDetails entry={entry} view={view} market={market} /> : null}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      </div>
      <ul className="md:hidden">
        {ordered.map((entry) => {
          const isWinner = competition.winner?.quote.id === entry.quote.id;
          return (
            <li key={entry.quote.id} className={`border-b border-line px-3 py-2.5 ${isWinner ? "bg-brand-soft/40" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] text-ink">{entry.quote.solverLabel}</span>
                  {entry.isSelected ? <Chip tone="up">Selected</Chip> : isWinner ? <Chip tone="brand">Wins</Chip> : null}
                </span>
                <span className="tnum font-mono text-sm text-ink">{priceText(entry.quote.packagePrice, market)}</span>
              </div>
              <div className="tnum mt-1 flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className={entry.exclusion ? "text-down" : "text-faint"}>
                  {entry.exclusion ? EXCLUSION_COPY[entry.exclusion] : `${formatLots(entry.quote.capacityLots)} lots capacity`}
                </span>
                <span className={entry.improvement > 0 ? "text-up" : entry.improvement < 0 ? "text-down" : "text-faint"}>
                  {`${signedPriceText(entry.improvement, market)} vs limit`}
                </span>
              </div>
              {view.active ? <TtlBar startMs={view.createdMs} endMs={entry.expiresMs} now={now} className="mt-1.5" /> : null}
              {canSelect && !entry.exclusion && !isWinner ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onSelect(entry.quote.id)}
                  className={`${BUTTON_QUIET} mt-2 h-8 w-full`}
                >
                  Select instead
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Why it wins                                                         */
/* ------------------------------------------------------------------ */

function WinningRule({ view, competition, market }: { view: RfqView; competition: QuoteCompetition; market: PackageMarket | null }) {
  const intent = view.request.authorization.intent;
  const winner = competition.winner;
  const runnerUp = competition.runnerUp;
  const unit = unitText(market);
  const sideWord = view.action === "BUY" ? "lowest ask" : "highest bid";
  let reason: string;
  if (!winner) {
    reason =
      competition.quotes.length === 0
        ? "No quote has arrived yet. The winner will be the best price for your side among quotes that can fill the full size in the same settlement class."
        : "No quote is eligible to win: every quote is expired, below the requested size, or in a different settlement class.";
  } else if (!runnerUp) {
    reason = `${winner.quote.solverLabel} is the only eligible quote, so it wins without price competition. Nothing here claims a better price was available.`;
  } else {
    const priceGap = Math.abs(winner.quote.packagePrice - runnerUp.quote.packagePrice);
    if (priceGap > 0) {
      const dollars = priceGap * intent.contractMultiplier * intent.lots;
      reason = `${winner.quote.solverLabel} has the ${sideWord}, ${priceText(priceGap, market, false)} ${unit} better than ${runnerUp.quote.solverLabel}, worth ${formatUsd(dollars, 2)} on ${formatLots(intent.lots)} lots.`;
    } else if (winner.quote.feeCap !== runnerUp.quote.feeCap) {
      reason = `${winner.quote.solverLabel} ties ${runnerUp.quote.solverLabel} on price and wins the tie-break with a lower fee cap (${formatUsd(winner.quote.feeCap, 2)} against ${formatUsd(runnerUp.quote.feeCap, 2)}).`;
    } else {
      reason = `${winner.quote.solverLabel} ties ${runnerUp.quote.solverLabel} on price and fee cap and wins on larger capacity.`;
    }
  }
  return (
    <Panel className={motion.mount} label="Winning rule">
      <PanelHeader right={<span className="text-[11px] text-faint">{`${competition.eligible.length} eligible of ${competition.quotes.length}`}</span>}>
        <PanelTitle icon={<Trophy size={14} aria-hidden="true" />}>Why this quote wins</PanelTitle>
      </PanelHeader>
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-ink">{reason}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {`Ranked by the ${sideWord} for your side, then lower fee cap, then larger capacity. Automatic ranking only compares quotes in the same settlement class${competition.primaryClass ? ` (${competition.primaryClass.toLowerCase()})` : ""} that can fill all ${formatLots(intent.lots)} lots before they expire.`}
          </p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Tradeoffs</div>
          {competition.tradeoffs.length === 0 ? (
            <p className="text-xs text-faint">No excluded quote beats the winner on price.</p>
          ) : (
            competition.tradeoffs.map((entry) => (
              <div key={entry.quote.id} className="rounded-md border border-line bg-inset px-2.5 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink">{entry.quote.solverLabel}</span>
                  <span className="tnum font-mono text-up">{`${signedPriceText(entry.versusWinner ?? 0, market)} ${unit} better`}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-faint">
                  {entry.exclusion === "CAPACITY"
                    ? `Covers only ${formatLots(entry.quote.capacityLots)} of ${formatLots(intent.lots)} lots. This execution path needs one quote for the full size.`
                    : `Settles as "${entry.quote.settlementGuarantee}", a different execution risk from the winner, so it is not ranked against it.`}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function rfqTimeline(
  view: RfqView,
  busy: Busy,
  updates: SubmissionUpdate[],
  modeled: boolean,
): TimelineStep[] {
  const request = view.request;
  const state = request.state;
  const selected = state === "SELECTED" || state === "EXECUTED";
  const executed = state === "EXECUTED";
  const closedEarly = view.status === "CANCELLED" || view.status === "EXPIRED";
  const has = (step: SubmissionUpdate["step"]) => updates.find((update) => update.step === step) ?? null;
  const included = has("INCLUDED");
  const filled = has("FILLED");
  const position = has("POSITION_CREATED") ?? has("POSITION_CLOSED");
  const receipt = has("RECEIPT_READY");
  const executing = busy?.kind === "EXECUTE";
  const selecting = busy?.kind === "SELECT";
  const selectedQuote = view.selected;
  return [
    {
      id: "draft",
      label: "Order signed",
      state: modeled ? "pending" : "done",
      meta: formatUtcTime(request.createdAt),
      detail: modeled ? "Modeled: nothing was signed." : `${request.authorization.intent.timeInForce} package order authorization, risk admission bound.`,
      hash: modeled ? undefined : request.authorization.orderHash,
      hashLabel: "Order hash",
    },
    {
      id: "commit",
      label: "Request committed privately",
      state: modeled ? "pending" : "done",
      detail: "Blind qualified disclosure. The eligible maker set is committed with the request.",
      hash: modeled ? undefined : request.id,
      hashLabel: "RFQ ID",
    },
    {
      id: "collect",
      label: closedEarly ? (view.status === "CANCELLED" ? "Cancelled before selection" : "Window closed without selection") : "Collecting quotes",
      state: closedEarly && !selected ? "failed" : selected ? "done" : view.active ? "active" : "pending",
      meta: `${request.quotes.length} firm`,
      detail: `${view.makers} maker${view.makers === 1 ? "" : "s"} answered. Window ${view.active ? `closes ${formatUtcTime(request.expiresAt)}` : `closed ${formatUtcTime(request.expiresAt)}`}.`,
    },
    {
      id: "select",
      label: selectedQuote ? `Quote selected: ${selectedQuote.solverLabel}` : "Quote selected",
      state: selected ? "done" : selecting ? "active" : "pending",
      detail: selectedQuote
        ? `${priceText(selectedQuote.packagePrice, view.market)}. Selection authorization signed and locked.`
        : "You sign a selection authorization that locks one quote.",
    },
    {
      id: "capacity",
      label: "Capacity reserved",
      state: selected ? "done" : "pending",
      detail: "The maker's capacity is confirmed and reserved for this request.",
    },
    {
      id: "submitted",
      label: "Submitted to private clearing",
      state: selected ? "done" : "pending",
      detail: "Submission is authorized and handed to the private execution channel.",
    },
    {
      id: "included",
      label: "Included and cleared",
      state: executed || filled ? "done" : executing ? "active" : "pending",
      detail: filled ? filled.detail : included ? included.detail : "Atomic clearing through the clearing engine.",
      hash: (filled ?? included)?.transactionHash,
      hashLabel: "Transaction",
    },
    {
      id: "position",
      label: request.authorization.intent.side === "EXIT" ? "Position closed" : "Position created",
      state: executed || position ? "done" : "pending",
      detail: position ? position.detail : "The filled package becomes an active position.",
    },
    {
      id: "receipt",
      label: "Receipt ready",
      state: request.receiptId || receipt ? "done" : "pending",
      detail: receipt ? receipt.detail : request.receiptId ? `Fill ${middleTruncate(request.receiptId, 10, 6)} is verifiable onchain.` : "Winning rule, execution and evidence.",
    },
  ];
}

function stageStates(view: RfqView, busy: Busy): Partial<Record<RfqStageId, RfqStageState>> {
  const state = view.request.state;
  if (state === "EXECUTED") {
    return { BUILD: "done", INVITE: "done", COMPETE: "done", PREFLIGHT: "done", CLEAR: "done", RECEIPT: "current" };
  }
  if (view.status === "CANCELLED" || view.status === "EXPIRED") {
    return { BUILD: "done", INVITE: "done", COMPETE: "failed" };
  }
  if (state === "SELECTED") {
    return { BUILD: "done", INVITE: "done", COMPETE: "done", PREFLIGHT: "done", CLEAR: "current" };
  }
  return {
    BUILD: "done",
    INVITE: "done",
    COMPETE: busy?.kind === "SELECT" ? "done" : "current",
    PREFLIGHT: busy?.kind === "SELECT" ? "current" : "upcoming",
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function Term({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0 py-1.5" title={title}>
      <dt className="truncate text-[11px] text-faint">{label}</dt>
      <dd className="tnum mt-0.5 truncate font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}

function newRequestHref(view: RfqView): string {
  const intent = view.request.authorization.intent;
  const params = new URLSearchParams({
    market: intent.marketId,
    direction: intent.packageSide.toLowerCase(),
    lots: String(intent.lots),
    source: "rfqs",
  });
  return `/rfqs/new?${params.toString()}`;
}

export function RfqCompetition({ requestId }: { requestId: string }) {
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const wallet = useWalletPrompt();
  const wallNow = useNow();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const modeled = requestId === SAMPLE_REQUEST_ID;
  const sample = useMemo(() => (modeled ? sampleRequest(previewEpochSeconds) : null), [modeled, previewEpochSeconds]);
  const request = sample ?? snapshot.rfqRequests.find((candidate) => candidate.id === requestId) ?? null;
  const now = modeled ? previewEpochSeconds * 1000 : wallNow;

  const [busy, setBusy] = useState<Busy>(null);
  const [updates, setUpdates] = useState<SubmissionUpdate[]>([]);
  const [error, setError] = useState<ActionError | null>(null);

  if (!request) return <MissingRequest requestId={requestId} />;

  const view = rfqView(request, now);
  const competition = quoteCompetition(view);
  const intent = request.authorization.intent;
  const market = view.market;
  const liveMarket = markets.find((candidate) => candidate.id === intent.marketId) ?? null;
  const liveMark = liveMarket?.netPrice ?? null;
  const unit = unitText(market);
  const execution = snapshot.executions.find((record) => record.orderHash === request.authorization.orderHash) ?? null;
  const shownUpdates = updates.length > 0 ? updates : (execution?.updates ?? []);
  const secondsLeft = Math.max(0, Math.ceil((view.expiresMs - now) / 1000));
  const winner = competition.winner;
  const selectedQuote = view.selected;
  const canSelect = !modeled && wallet.connected && request.state === "OPEN" && view.active;
  const actionWord = view.action === "BUY" ? "Buy" : "Sell";

  const fail = (caught: unknown) => setError({ message: gatewayErrorCopy(caught), code: gatewayErrorCode(caught) });

  const select = async (quoteId: string) => {
    if (busy || modeled) return;
    const quote = request.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote) return fail(new Error("RFQ_QUOTE_NOT_FOUND"));
    if (Date.parse(quote.expiresAt) <= now || !view.active) return fail(new Error("RFQ_EXPIRED"));
    if (quote.capacityLots < intent.lots) return fail(new Error("RFQ_CAPACITY_EXCEEDED"));
    setBusy({ kind: "SELECT", quoteId });
    setError(null);
    try {
      await gateway.selectRfqQuote(request.id, quoteId);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const execute = async () => {
    if (busy || modeled || request.state !== "SELECTED" || !selectedQuote) return;
    if (selectedQuote.capacityLots < intent.lots) return fail(new Error("RFQ_CAPACITY_EXCEEDED"));
    if (Date.parse(request.expiresAt) <= now || Date.parse(selectedQuote.expiresAt) <= now) return fail(new Error("RFQ_EXPIRED"));
    setBusy({ kind: "EXECUTE" });
    setError(null);
    setUpdates([]);
    try {
      await gateway.executeSelectedRfq(request.id, (update) => setUpdates((current) => [...current, update]));
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (busy || modeled) return;
    setBusy({ kind: "CANCEL" });
    setError(null);
    try {
      await gateway.cancelRfq(request.id);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const headline = selectedQuote ?? winner?.quote ?? null;
  const headlineImprovement = headline
    ? view.action === "BUY"
      ? intent.limitPrice - headline.packagePrice
      : headline.packagePrice - intent.limitPrice
    : null;
  const headlineVsMark = headline && liveMark !== null ? headline.packagePrice - liveMark : null;

  /* Primary action copy and availability derive from wallet, request, quote and capacity state. */
  let primary: { label: string; disabled: boolean; reason: string | null; onClick: (() => void) | null };
  if (modeled) {
    primary = { label: "Select winning quote", disabled: true, reason: "Modeled walkthrough: there is nothing onchain to select.", onClick: null };
  } else if (!wallet.connected) {
    primary = {
      label: wallet.connecting ? "Connecting..." : "Connect wallet",
      disabled: wallet.connecting,
      reason: "Selecting and executing need the taker wallet that signed the request.",
      onClick: wallet.connect,
    };
  } else if (request.state === "EXECUTED") {
    primary = { label: "Executed", disabled: true, reason: null, onClick: null };
  } else if (request.state === "SELECTED") {
    const expired = !view.active || (selectedQuote ? Date.parse(selectedQuote.expiresAt) <= now : true);
    primary = {
      label:
        busy?.kind === "EXECUTE"
          ? "Clearing..."
          : `${actionWord} ${formatLots(intent.lots)} lots at ${selectedQuote ? priceText(selectedQuote.packagePrice, market) : "selected price"}`,
      disabled: busy !== null || expired || !selectedQuote || selectedQuote.capacityLots < intent.lots,
      reason: expired ? "The selected quote or request expired before execution." : null,
      onClick: () => void execute(),
    };
  } else if (!view.active) {
    primary = { label: "Request closed", disabled: true, reason: "This request can no longer be selected. Build a fresh request.", onClick: null };
  } else if (!winner) {
    primary = { label: "Waiting for an eligible quote", disabled: true, reason: "No quote can fill the full size in the ranked settlement class yet.", onClick: null };
  } else {
    primary = {
      label: busy?.kind === "SELECT" ? "Locking selection..." : `Select ${winner.quote.solverLabel} at ${priceText(winner.quote.packagePrice, market)}`,
      disabled: busy !== null,
      reason: null,
      onClick: () => void select(winner.quote.id),
    };
  }

  const cancellable = !modeled && wallet.connected && (request.state === "OPEN" || (request.state === "SELECTED" && !view.active));

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="flex min-h-full flex-col gap-1">
        <Panel as="div" className={motion.mount}>
          <div className="flex flex-col gap-3 px-4 pt-3 pb-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
                <Link href="/rfqs" className="inline-flex items-center gap-1 hover:text-ink">
                  <ArrowLeft size={11} aria-hidden="true" />
                  Private RFQs
                </Link>
                <span className="text-off">/</span>
                <span className="tnum font-mono normal-case tracking-normal">{modeled ? "walkthrough" : middleTruncate(request.id, 8, 6)}</span>
                {modeled ? null : <CopyButton value={request.id} label="RFQ request ID" />}
              </div>
              <h1 className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-serif text-[26px] leading-[30px] text-ink">
                <MarketMark underlying={market?.underlying} code={intent.packageCode} size={26} />
                {market ? packageLabel(market) : intent.packageCode}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusChip view={view} />
                <Chip tone="neutral" className="gap-1">
                  <Lock size={10} aria-hidden="true" />
                  Private, blind qualified
                </Chip>
                {modeled ? (
                  <ProvenanceChip
                    value="MODELED"
                    title="A walkthrough built from the shared index feed. It implements the production request type but nothing was signed or committed."
                  />
                ) : (
                  <ProvenanceChip value="OBSERVED" title="Read from the PrivateRfqBook on the local chain for the connected taker." />
                )}
                <span className={`text-xs ${view.action === "BUY" ? "text-up" : "text-down"}`}>
                  {`${view.intentLabel} ${view.sideLabel.toLowerCase()} · ${actionWord} ${formatLots(intent.lots)} lots · limit ${priceText(intent.limitPrice, market)}`}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1 lg:items-end">
              <span className="text-[11px] text-faint">Request window</span>
              <span
                className={`tnum font-serif text-[30px] leading-8 ${
                  !view.active ? "text-faint" : secondsLeft <= 15 ? "text-down" : "text-ink"
                }`}
              >
                {request.state === "EXECUTED" ? "Filled" : view.status === "CANCELLED" ? "Closed" : view.expired ? "0s" : formatCountdown(secondsLeft)}
              </span>
              {view.active ? (
                <TtlBar startMs={view.createdMs} endMs={view.expiresMs} now={now} showLabel={false} className="w-44" />
              ) : null}
            </div>
          </div>
          <div className="border-t border-line px-4 py-2">
            <RfqStages states={stageStates(view, busy)} />
          </div>
          <KpiStrip>
            <Kpi
              label={selectedQuote ? "Selected quote" : "Winning quote"}
              value={headline ? `${priceText(headline.packagePrice, market, false)} ${unit}` : "—"}
              tone={headline ? "text-ink" : "text-faint"}
              sub={headline ? headline.solverLabel : "no eligible quote"}
            />
            <Kpi
              label="vs your limit"
              value={headlineImprovement !== null ? signedPriceText(headlineImprovement, market) : "—"}
              tone={headlineImprovement === null ? "text-faint" : headlineImprovement >= 0 ? "text-up" : "text-down"}
              sub="positive is better for you"
            />
            <Kpi
              label="vs live mark"
              value={headlineVsMark !== null ? signedPriceText(headlineVsMark, market) : "—"}
              sub={liveMark !== null ? `mark ${priceText(liveMark, market)}, index feed` : "no live mark"}
            />
            <Kpi label="Eligible quotes" value={`${competition.eligible.length} / ${request.quotes.length}`} sub={`${view.makers} makers answered`} />
            <Kpi
              label="Package value"
              value={headline ? formatUsd(headline.packagePrice * intent.contractMultiplier * intent.lots, 0) : "—"}
              sub={`fee cap ${formatUsd(intent.feeCap, 2)}`}
            />
          </KpiStrip>
        </Panel>

        {modeled ? (
          <div className={`flex items-start gap-2 rounded-lg border border-brand-edge/40 bg-brand-soft/30 px-3 py-2 text-xs text-dim ${motion.fade}`}>
            <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
            <span>
              Modeled walkthrough. Makers and quotes are generated from the shared index feed so the ranking rule can be seen with
              several responses. Nothing is signed, committed or executable, and the walkthrough restarts each window.{" "}
              <Link href="/rfqs/new" className="text-ink underline decoration-line-strong underline-offset-2">
                Build a real request
              </Link>
              .
            </span>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-1 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-1">
            <Panel className={motion.mount} label="Quote competition">
              <PanelHeader
                right={
                  <span className="tnum font-mono text-[11px] text-faint">
                    {`${request.quotes.length} firm · ${view.makers} maker${view.makers === 1 ? "" : "s"}`}
                  </span>
                }
              >
                <PanelTitle>Quote competition</PanelTitle>
                <span className="hidden text-[11px] text-faint sm:inline">
                  {view.action === "BUY" ? "Lowest ask first" : "Highest bid first"}, prices in {unit}
                </span>
              </PanelHeader>
              <QuoteBoard
                view={view}
                competition={competition}
                market={market}
                liveMark={liveMark}
                now={now}
                canSelect={canSelect}
                busy={busy}
                onSelect={(quoteId) => void select(quoteId)}
              />
            </Panel>

            <WinningRule view={view} competition={competition} market={market} />

            <Panel className={motion.mount} label="Request terms">
              <PanelHeader right={modeled ? <ProvenanceChip value="MODELED" /> : <ProvenanceChip value="OBSERVED" />}>
                <PanelTitle>Request terms and evidence</PanelTitle>
              </PanelHeader>
              <dl className="grid grid-cols-2 gap-x-4 px-4 py-2 sm:grid-cols-3 xl:grid-cols-4">
                <Term label="Size" value={`${formatLots(intent.lots)} lots`} />
                <Term label="Limit" value={priceText(intent.limitPrice, market)} />
                <Term
                  label="Fill requirement"
                  value={intent.timeInForce === "FOK" ? "All or none" : "Partial from 1 lot"}
                  title={`Time in force ${intent.timeInForce}`}
                />
                <Term label="Route" value={intent.routeLabel} title={intent.routeLabel} />
                <Term label="Fee cap" value={formatUsd(intent.feeCap, 2)} />
                <Term label="Collateral bound" value={intent.collateralRequired > 0 ? formatUsd(intent.collateralRequired, 2) : "Not bound"} />
                <Term label="Guarantee" value={intent.settlementGuarantee} />
                <Term label="Created" value={formatUtcTime(request.createdAt)} title={formatUtcFull(request.createdAt)} />
                <Term label="Deadline" value={formatUtcTime(request.expiresAt)} title={formatUtcFull(request.expiresAt)} />
                {modeled ? null : (
                  <>
                    <Term label="Order hash" value={middleTruncate(request.authorization.orderHash, 10, 6)} title={request.authorization.orderHash} />
                    <Term label="Signer" value={middleTruncate(request.authorization.signer, 8, 6)} title={request.authorization.signer} />
                    <Term
                      label="Risk admission"
                      value={middleTruncate(request.authorization.riskAdmissionId, 10, 6)}
                      title={request.authorization.riskAdmissionId}
                    />
                  </>
                )}
              </dl>
              {market ? null : (
                <p className="flex items-start gap-2 border-t border-line px-4 py-2.5 text-xs text-faint">
                  <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-dim" />
                  Market definition unavailable in this session, so prices show without a unit.
                </p>
              )}
            </Panel>
          </div>

          <aside className="flex min-w-0 flex-col gap-1">
            <Panel className={motion.mount} label="Actions">
              <PanelHeader>
                <PanelTitle>Actions</PanelTitle>
              </PanelHeader>
              <div className="space-y-2 px-4 py-3">
                {request.state === "EXECUTED" && request.receiptId ? (
                  <Link href={`/activity/receipts/${request.receiptId}`} className={`${BUTTON_PRIMARY} h-10 w-full`}>
                    <FileCheck2 size={14} aria-hidden="true" />
                    Open execution receipt
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={primary.onClick ?? undefined}
                    disabled={primary.disabled || !primary.onClick}
                    className={`${
                      primary.disabled || !primary.onClick ? BUTTON_QUIET : !wallet.connected && !modeled ? BUTTON_INK : BUTTON_PRIMARY
                    } h-10 w-full text-[13px]`}
                  >
                    {primary.label}
                  </button>
                )}
                {primary.reason ? <p className="text-[11px] leading-snug text-faint">{primary.reason}</p> : null}
                {request.state === "OPEN" && view.active && !modeled && wallet.connected ? (
                  <p className="text-[11px] leading-snug text-faint">
                    Selecting signs one selection authorization, then locks the quote, reserves the maker&apos;s capacity and submits it to
                    private clearing. Success shows only when clearing completes.
                  </p>
                ) : null}
                {request.state === "SELECTED" && !modeled ? (
                  <p className="text-[11px] leading-snug text-faint">
                    The selected quote stays locked until the request deadline. Execution clears atomically; nothing is claimed at signature.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  {cancellable ? (
                    <button type="button" onClick={() => void cancel()} disabled={busy !== null} className={`${BUTTON_QUIET} flex-1`}>
                      {busy?.kind === "CANCEL" ? "Cancelling..." : request.state === "SELECTED" ? "Expire request" : "Cancel request"}
                    </button>
                  ) : null}
                  {view.active && market && !modeled && request.state !== "EXECUTED" ? (
                    <Link href={`${tradeHref(market)}?rfq=${encodeURIComponent(request.id)}`} className={`${BUTTON_QUIET} flex-1`}>
                      Open in terminal
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </Link>
                  ) : null}
                  {!view.active && request.state !== "EXECUTED" ? (
                    <Link href={newRequestHref(view)} className={`${BUTTON_QUIET} flex-1`}>
                      Request again
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
                {error ? (
                  <div className="rounded-md border border-down/30 bg-down-soft px-3 py-2 text-xs text-down" role="alert">
                    <p>{error.message}</p>
                    <details className="mt-1 text-[11px] text-faint">
                      <summary className="cursor-pointer select-none hover:text-dim">Diagnostic</summary>
                      <p className="tnum mt-1 font-mono break-all">{error.code}</p>
                    </details>
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel className={motion.mount} label="Clearing timeline">
              <PanelHeader>
                <PanelTitle>Clearing timeline</PanelTitle>
              </PanelHeader>
              <StepTimeline steps={rfqTimeline(view, busy, shownUpdates, modeled)} dense className="px-4 py-3" />
            </Panel>

            <Panel className={motion.mount} label="Disclosure">
              <PanelHeader>
                <PanelTitle icon={<ShieldCheck size={14} aria-hidden="true" />}>Disclosure</PanelTitle>
              </PanelHeader>
              <dl className="space-y-2 px-4 py-3 text-xs">
                <div>
                  <dt className="text-[11px] text-faint">Shown to invited makers</dt>
                  <dd className="mt-0.5 text-dim">Package, side, size, fee cap and deadline.</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">Not shown by the request</dt>
                  <dd className="mt-0.5 text-dim">Your identity and limit. Other makers never see a competitor&apos;s quote.</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">Committed onchain</dt>
                  <dd className="mt-0.5 text-dim">
                    The signed order, including its limit, in OrderState; the request commitment in PrivateRfqBook. Chain state is
                    readable by anyone with node access.
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">Revealed after execution</dt>
                  <dd className="mt-0.5 text-dim">Fill price, size and receipt. The public tape never carries request contents.</dd>
                </div>
              </dl>
            </Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}
