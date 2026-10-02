"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Lock, Minus, Plus, TriangleAlert } from "lucide-react";
import { ExecutionTimeline } from "@/components/gateway/ExecutionTimeline";
import { AssetAmount, ChainBadge, chainKeyOf, chainLabelOf } from "@/components/icons/AssetIcon";
import { ROUTE_HINT_ID, RouteTable } from "@/components/terminal/RouteTable";
import { RfqQuotePanel } from "@/components/terminal/RfqQuotePanel";
import { TicketEconomics } from "@/components/terminal/TicketEconomics";
import { CheckRow, DataRow, SectionLabel, SourceMark } from "@/components/terminal/primitives";
import type {
  EconomicsPreview,
  Intent,
  OrderType,
  PackageSide,
  StageState,
  TicketState,
  TimeInForce,
} from "@/lib/terminal/economics";
import {
  bestReferencePrice,
  defaultGtdExpiry,
  executableAction,
  GTD_MAX_MS,
  routePrice,
  SLIPPAGE_PRESETS_BPS,
} from "@/lib/terminal/economics";
import { formatLotCount, formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import type { HandoffContext } from "@/lib/terminal/handoff";
import type { PackageMarket, RouteQuote } from "@/lib/terminal/types";
import type {
  ExecutionPosition,
  OrderExecutionProgress,
  RfqRequest,
} from "@/lib/internal-gateway/types";
import { platformNow } from "@/lib/terminal/clock";
import { useConfirmationPrefs } from "@/lib/settings/preferences";
import { useConfirmStep } from "@/components/terminal/confirm-step";

const INTENTS: { value: Intent; label: string }[] = [
  { value: "ENTER", label: "Enter" },
  { value: "EXIT", label: "Exit" },
];

const SIDES: { value: PackageSide; label: string }[] = [
  { value: "LONG", label: "Long" },
  { value: "SHORT", label: "Short" },
];

/** Definitions live on the control itself so the ticket keeps values, not prose. */
const ORDER_TYPES: { value: OrderType; label: string; title: string }[] = [
  {
    value: "MARKETABLE_LIMIT",
    label: "Marketable limit",
    title:
      "Marketable limit: crosses the selected route immediately, with your limit as the worst accepted price.",
  },
  {
    value: "LIMIT",
    label: "Limit",
    title: "Limit: rests at your package-price limit and never pays worse than it.",
  },
];

const TIFS: { value: TimeInForce; label: string; title: string }[] = [
  {
    value: "GTC",
    label: "GTC",
    title: "Good till cancelled: rests in the package book until it fills or you cancel it.",
  },
  {
    value: "GTD",
    label: "GTD",
    title: "Good till date: rests until the expiry, then expires without a fill.",
  },
  {
    value: "IOC",
    label: "IOC",
    title:
      "Immediate or cancel: clears whatever the route can fill right now and cancels the rest.",
  },
  {
    value: "FOK",
    label: "FOK",
    title: "Fill or kill: clears the full quantity in one match or executes nothing at all.",
  },
];

const GTD_PRESETS: { label: string; minutes: number }[] = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "1d", minutes: 1440 },
];

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(raw: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

const RFQ_TITLE =
  "Private RFQ: discloses the package only to invited solvers. Unlocks the solver route and keeps size off the public tape.";

const BLOCKER_LIST_ID = "ticket-blockers";

const INPUT_SHELL =
  "flex h-11 items-center gap-2 rounded-md border border-line bg-inset px-3 transition-colors focus-within:border-brand-edge lg:h-9";
const INPUT =
  "tnum min-w-0 flex-1 bg-transparent text-right font-mono text-ink outline-none lg:text-sm";

function Stepper({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="focus-ring flex h-11 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9 lg:w-8"
    >
      {children}
    </button>
  );
}

export interface TicketWallet {
  connected: boolean;
  available: number;
  asset: string;
  equity?: number;
  posted?: number;
  reserved?: number;
  riskDomain?: string;
  /** Chain the wallet is on, or the environment's chain before a wallet connects. */
  chainId?: number | null;
}

export function OrderTicket({
  market,
  state,
  preview,
  route,
  stage,
  execution,
  maxLots,
  slippageBps,
  onSlippage,
  wallet,
  onConnect,
  handoff,
  closePositions,
  rfqRequest,
  rfqError,
  amendment,
  onChange,
  onStage,
  onConfirm,
  onCancelResting,
  onReset,
  onSelectRfqQuote,
  onExecuteRfqQuote,
  onCancelRfq,
  onDiscardAmendment,
}: {
  market: PackageMarket;
  state: TicketState;
  preview: EconomicsPreview;
  route: RouteQuote | null;
  stage: StageState;
  execution: OrderExecutionProgress;
  maxLots: number;
  slippageBps: number;
  onSlippage: (bps: number) => void;
  wallet: TicketWallet;
  onConnect: () => void;
  handoff: HandoffContext;
  closePositions: ExecutionPosition[];
  rfqRequest?: RfqRequest | null;
  rfqError?: string | null;
  amendment?: { orderId: string } | null;
  onChange: (patch: Partial<TicketState>) => void;
  onStage: () => void;
  onConfirm: () => void;
  onCancelResting: () => void;
  onReset: () => void;
  onSelectRfqQuote?: (quoteId: string) => void;
  onExecuteRfqQuote?: () => void;
  onCancelRfq?: () => void;
  onDiscardAmendment?: () => void;
}) {
  const unit = priceUnitSuffix(market.priceUnit);
  const action = preview.action;
  const bestPrice = bestReferencePrice(market, action);
  const bestLabel = action === "BUY" ? "best offer" : "best bid";
  const externalBlock = handoff.blockedReason;
  const isAmending = amendment != null;
  const amendmentCrosses = isAmending && preview.marketable;
  const amendmentPrivateRoute = isAmending && (route?.requiresPrivate ?? false);
  const rfqGtdBlocked = (route?.requiresPrivate ?? false) && state.tif === "GTD";
  const enterIocCollateralBlocker =
    state.intent === "ENTER" && state.tif === "IOC" && preview.requestedLots - maxLots > 1e-9
      ? [
          `Collateral supports at most ${maxLots} requested lots in this workspace. Reduce quantity to continue.`,
        ]
      : [];
  const blockers = [
    ...preview.blockers,
    ...enterIocCollateralBlocker,
    ...(externalBlock ? [externalBlock] : []),
    ...(amendmentCrosses
      ? ["Amendment price crosses. Discard amendment and submit a normal immediate order."]
      : []),
    ...(amendmentPrivateRoute
      ? ["Solver RFQ routes cannot rest as replacements. Select a public book route."]
      : []),
    ...(rfqGtdBlocked
      ? [
          "Private RFQ has its own quote and request expiry, so GTD does not apply. Select GTC, IOC, or FOK to request firm quotes.",
        ]
      : []),
  ];
  const invalid = blockers.length > 0;
  const blocked = invalid || preview.routeMissing;
  const locked = execution.status === "CONNECTING" || execution.status === "AUTHORIZING" || execution.status === "SUBMITTING" || stage.kind === "RESTING" || execution.status === "RESTING" || stage.kind === "RFQ" || stage.kind === "RFQ_SELECTED";
  const isExit = state.intent === "EXIT";
  const selectedClose = isExit
    ? (closePositions.find((position) => position.id === state.closePositionId) ?? null)
    : null;
  const closeAction = selectedClose ? executableAction("EXIT", selectedClose.side) : null;
  const closeActionLabel = closeAction === "BUY" ? "Buy to close" : closeAction === "SELL" ? "Sell to close" : null;
  const guaranteeLabel =
    handoff.guarantee === "PACKAGE_ATOMIC"
      ? "package atomic"
      : handoff.guarantee === "SOLVER_BONDED"
        ? "solver bonded"
        : handoff.guarantee === "LEG_SEQUENCED"
          ? "leg sequenced"
          : null;

  const stepLimit = (direction: 1 | -1) => {
    const typed = Number.parseFloat(state.limitInput);
    const base = Number.isFinite(typed) && typed > 0 ? typed : Number.isFinite(bestPrice) ? bestPrice : market.netPrice;
    if (!Number.isFinite(base)) return;
    onChange({ limitInput: (base + direction * market.tickSize).toFixed(market.priceDecimals) });
  };

  // A full exit closes only against a firm maker quote: the router fills it and closes both positions in one
  // transaction, so no other route can leave the trader holding the position and its offset.
  const usableRoutes = market.routes.filter(
    (candidate) =>
      (isAmending ? !candidate.requiresPrivate : !candidate.requiresPrivate || state.privateRfq) &&
      (state.intent !== "EXIT" || candidate.id === "FIRM_QUOTE"),
  );
  // The best priced route wins; a route with no price (an empty side, an RFQ before quotes) only wins by default.
  const bestRoute = usableRoutes.length
    ? usableRoutes.reduce((winner, candidate) => {
        const price = routePrice(candidate, action);
        const winning = routePrice(winner, action);
        if (!Number.isFinite(price)) return winner;
        if (!Number.isFinite(winning)) return candidate;
        return action === "BUY" ? (price < winning ? candidate : winner) : price > winning ? candidate : winner;
      })
    : null;
  const bestRouteId = bestRoute?.id ?? null;
  // Wall clock for the GTD picker bounds, refreshed when GTD is chosen rather than read during render.
  const [gtdClockMs, setGtdClockMs] = useState(() => platformNow());
  // Smart default: the best executable route is preselected and stays editable in the route selector. Until the
  // trader picks a route in this market the ticket keeps following the best one, so liquidity that arrives after the
  // first render (the onchain market's routes, the maker stream's firm quotes) is not hidden behind an empty book.
  // A route that is no longer offered is replaced the same way.
  const [routePickedFor, setRoutePickedFor] = useState<string | null>(null);
  const followBest = routePickedFor !== market.id && !state.privateRfq;
  const routeOffered = state.routeId !== null && usableRoutes.some((candidate) => candidate.id === state.routeId);
  useEffect(() => {
    if (!bestRouteId || locked || isAmending) return;
    if (!routeOffered || (followBest && state.routeId !== bestRouteId)) onChange({ routeId: bestRouteId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOffered, bestRouteId, locked, isAmending, followBest, state.routeId]);
  const requestedLots = Number.parseFloat(state.lotsInput) || 0;
  // Without a connected account there is no collateral to size against, so the share controls stay inert.
  const sizingKnown = wallet.connected || state.intent === "EXIT";
  const sizePercent =
    sizingKnown && maxLots > 0 ? Math.min(100, Math.max(0, Math.round((requestedLots / maxLots) * 100))) : 0;
  const midPrice = (market.bestBid + market.bestAsk) / 2;

  return (
    <section id="order-ticket" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel" aria-label="Order ticket">
      <div className="flex h-10 shrink-0 items-stretch border-b border-line px-1">
        {ORDER_TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={state.orderType === option.value}
            disabled={locked || isAmending}
            onClick={() => onChange({ orderType: option.value })}
            className={`focus-ring relative px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
              state.orderType === option.value ? "text-ink" : "text-faint hover:text-dim"
            }`}
          >
            {option.value === "MARKETABLE_LIMIT" ? "Market" : "Limit"}
            {state.orderType === option.value ? (
              <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" />
            ) : null}
          </button>
        ))}
        <span className="flex-1" />
        <div role="radiogroup" aria-label="Package intent" className="my-2 mr-2 flex rounded-md bg-inset p-0.5">
          {INTENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={state.intent === option.value}
              disabled={locked || isAmending}
              onClick={() => onChange({ intent: option.value })}
              className={`focus-ring rounded-[5px] px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
                state.intent === option.value ? "bg-raised text-ink" : "text-faint hover:text-dim"
              }`}
            >
              {option.value === "ENTER" ? "Open" : "Close"}
            </button>
          ))}
        </div>
      </div>

      {/* The form, its action, and the account summary share one scroll area. The action sits right under the
          form and sticks to the bottom only when the form is taller than the panel. */}
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
        <fieldset
          disabled={locked}
          aria-busy={locked}
          className={`flex shrink-0 flex-col gap-3 border-0 px-3 pt-3 pb-1 ${locked ? "opacity-65" : ""}`}
        >
          {handoff.present ? (
            <div className="rounded-md border border-line bg-raised px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
                  {handoff.sourceLabel ? `Handoff · ${handoff.sourceLabel}` : "Handoff"}
                </span>
                {handoff.direction || handoff.lots !== null ? (
                  <span className="tnum font-mono text-[11px] text-dim">
                    {[handoff.direction, handoff.lots !== null ? formatLotCount(handoff.lots) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-dim">
                {handoff.draftId ? <span className="tnum font-mono">{handoff.draftId}</span> : null}
                {handoff.lifecycleId ? <span className="tnum font-mono">{handoff.lifecycleId}</span> : null}
                {handoff.exposureId ? <span className="tnum font-mono">{handoff.exposureId}</span> : null}
                {handoff.legId ? <span className="tnum font-mono">{handoff.legId}</span> : null}
                {handoff.maxCloseCost !== null ? (
                  <span className="tnum font-mono">requested bound {formatUsd(handoff.maxCloseCost, 0)}</span>
                ) : null}
                {guaranteeLabel ? <span>{guaranteeLabel}</span> : null}
                {handoff.studioMode ? <span>{handoff.studioMode}</span> : null}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-faint">
                Read-only context. Select a route to continue; no quote is claimed.
              </div>
            </div>
          ) : null}
          {amendment ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2">
              <span className="tnum min-w-0 truncate font-mono text-[11px] text-dim">
                {`Amend ${amendment.orderId}. Cancel and replace. Queue resets.`}
              </span>
              <button
                type="button"
                onClick={() => onDiscardAmendment?.()}
                className="focus-ring shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:text-ink"
              >
                Discard
              </button>
            </div>
          ) : null}

          {!isExit ? (
            <div role="radiogroup" aria-label="Package side" className="grid grid-cols-2 gap-1 rounded-md bg-inset p-1">
              {SIDES.map((option) => {
                const selected = state.side === option.value;
                const long = option.value === "LONG";
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={isAmending}
                    onClick={() => onChange({ side: option.value })}
                    className={`focus-ring h-9 rounded-[5px] text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                      selected
                        ? long
                          ? "bg-up text-app"
                          : "bg-down text-app"
                        : "text-faint hover:text-dim"
                    }`}
                  >
                    {long ? "Long / Buy" : "Short / Sell"}
                  </button>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label htmlFor="ticket-close" className="text-xs text-dim">
                  Position to close
                </label>
                <span className="tnum font-mono text-xs text-off">{`${closePositions.length} open`}</span>
              </div>
              <select
                id="ticket-close"
                value={state.closePositionId ?? ""}
                disabled={isAmending}
                onChange={(event) => onChange({ closePositionId: event.target.value || null })}
                className="focus-ring tnum h-9 w-full rounded-md border border-line bg-inset px-2 font-mono text-xs text-ink disabled:cursor-not-allowed disabled:opacity-65"
              >
                <option value="">Select a package position</option>
                {closePositions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {`${position.id} · ${position.side} · ${position.lots} lots · ${Math.round(position.collateral)} USDC`}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-snug text-faint">
                {selectedClose
                  ? `${selectedClose.side === "LONG" ? "Long" : "Short"} · ${closeActionLabel} · ${selectedClose.lots} lots · ${formatUsd(selectedClose.collateral, 0)} collateral`
                  : closePositions.length === 0
                    ? "No open package positions in this market."
                    : "Quantity cannot exceed the selected position."}
              </p>
            </div>
          )}

          <dl className="space-y-1 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-faint">Available to trade</dt>
              <dd className="tnum font-mono text-dim">
                {wallet.connected ? <AssetAmount value={formatNumber(wallet.available, 2)} symbol={wallet.asset} /> : "–"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-faint">{isExit ? "Max close size" : "Max size"}</dt>
              <dd className="tnum font-mono text-dim">{wallet.connected || isExit ? formatLotCount(maxLots) : "–"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-faint">Contract</dt>
              <dd className="tnum font-mono text-dim">
                {market.feeOnConsideration
                  ? `1 lot = ${formatUsd(market.contractMultiplier, 2)} per ${priceUnitSuffix(market.priceUnit)}`
                  : `1 lot = ${formatUsd(market.notionalPerLot, 0)}`}
              </dd>
            </div>
          </dl>

          <div>
            <div className={INPUT_SHELL}>
              <label htmlFor="ticket-lots" className="shrink-0 text-xs text-faint">
                Size
              </label>
              <input
                id="ticket-lots"
                inputMode="decimal"
                autoComplete="off"
                value={state.lotsInput}
                onChange={(event) => onChange({ lotsInput: event.target.value })}
                className={INPUT}
              />
              <span className="shrink-0 text-xs text-faint">lots</span>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sizePercent}
                disabled={!sizingKnown}
                aria-label="Size as a share of the maximum"
                onChange={(event) =>
                  onChange({
                    lotsInput: String(Math.max(0, Math.floor((maxLots * Number(event.target.value)) / 100))),
                  })
                }
                className="size-slider min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ ["--fill" as string]: `${sizePercent}%` }}
              />
              <span className="tnum w-10 shrink-0 text-right font-mono text-xs text-dim">
                {sizingKnown ? `${sizePercent}%` : "–"}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  key={percent}
                  type="button"
                  disabled={!sizingKnown}
                  title={sizingKnown ? `${percent}% of ${formatLotCount(maxLots)}` : "Connect a wallet to size from available collateral"}
                  onClick={() => onChange({ lotsInput: String(Math.max(0, Math.floor((maxLots * percent) / 100))) })}
                  className="focus-ring tnum h-7 rounded-sm bg-inset font-mono text-[11px] text-faint transition-colors enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {percent === 100 ? "Max" : `${percent}%`}
                </button>
              ))}
            </div>
          </div>

          {state.orderType === "LIMIT" ? (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label
                  htmlFor="ticket-limit"
                  title={`${state.orderType === "LIMIT" ? "Resting limit" : "Worst accepted package price"}. One tick is ${formatNumber(market.tickSize, market.priceDecimals)} ${unit}. Selecting an executable book row sets this price.`}
                  className="text-xs text-dim"
                >
                  {state.orderType === "LIMIT" ? `Limit price (${unit})` : `Worst price (${unit})`}
                </label>
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={!Number.isFinite(midPrice)}
                    title={Number.isFinite(midPrice) ? undefined : "The book needs a bid and an offer for a mid"}
                    onClick={() => onChange({ limitInput: midPrice.toFixed(market.priceDecimals) })}
                    className="focus-ring rounded-sm bg-inset px-1.5 text-[11px] text-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-faint"
                  >
                    Mid
                  </button>
                  <button
                    type="button"
                    disabled={!Number.isFinite(bestPrice)}
                    title={Number.isFinite(bestPrice) ? `${bestLabel} ${formatNumber(bestPrice, market.priceDecimals)}` : `No ${bestLabel} on the book`}
                    onClick={() => onChange({ limitInput: bestPrice.toFixed(market.priceDecimals) })}
                    className="focus-ring rounded-sm bg-inset px-1.5 text-[11px] text-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-faint"
                  >
                    {action === "BUY" ? "Ask" : "Bid"}
                  </button>
                </span>
              </div>
              <div className="flex gap-1">
                <Stepper label="Decrease price by one tick" onClick={() => stepLimit(-1)}>
                  <Minus size={13} aria-hidden="true" />
                </Stepper>
                <div className={`${INPUT_SHELL} min-w-0 flex-1`}>
                  <input
                    id="ticket-limit"
                    inputMode="decimal"
                    autoComplete="off"
                    value={state.limitInput}
                    onChange={(event) => onChange({ limitInput: event.target.value })}
                    className={INPUT}
                  />
                  <span className="shrink-0 text-xs text-faint">{unit}</span>
                </div>
                <Stepper label="Increase price by one tick" onClick={() => stepLimit(1)}>
                  <Plus size={13} aria-hidden="true" />
                </Stepper>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                  className="text-xs text-dim"
                  title="How far the fill may move against the live route before the order stops. The worst price follows the feed every tick."
                >
                  Slippage tolerance
                </span>
                <span role="group" aria-label="Slippage tolerance" className="flex gap-1">
                  {SLIPPAGE_PRESETS_BPS.map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      aria-pressed={slippageBps === bps}
                      onClick={() => onSlippage(bps)}
                      className={`focus-ring tnum h-6 rounded-sm px-1.5 font-mono text-[11px] transition-colors ${
                        slippageBps === bps ? "bg-raised text-ink" : "bg-inset text-faint hover:text-ink"
                      }`}
                    >
                      {`${(bps / 100).toFixed(bps < 100 ? 1 : 0)}%`}
                    </button>
                  ))}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 rounded-md bg-inset px-3 py-2">
                <span className="text-xs text-faint">{`Worst price (${unit})`}</span>
                <span className="tnum font-mono text-sm text-ink">
                  {formatNumber(Number.parseFloat(state.limitInput) || 0, market.priceDecimals)}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-dim" title="How long the order may rest or wait for a fill.">
              Time in force
            </span>
            <div role="radiogroup" aria-label="Time in force" className="flex rounded-md bg-inset p-0.5">
              {TIFS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  title={option.title}
                  aria-checked={state.tif === option.value}
                  disabled={isAmending}
                  onClick={() => {
                    if (option.value === "GTD") setGtdClockMs(platformNow());
                    onChange(
                      option.value === "GTD"
                        ? {
                            tif: option.value,
                            expiresAt:
                              state.expiresAt &&
                              Number.isFinite(Date.parse(state.expiresAt)) &&
                              Date.parse(state.expiresAt) > platformNow()
                                ? state.expiresAt
                                : defaultGtdExpiry(),
                          }
                        : { tif: option.value, expiresAt: null },
                    );
                  }}
                  className={`focus-ring h-6 rounded-[5px] px-2 font-mono text-[11px] transition-colors disabled:cursor-not-allowed ${
                    state.tif === option.value ? "bg-raised text-ink" : "text-faint hover:text-dim"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {state.tif === "GTD" ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-4 gap-1">
                {GTD_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      onChange({ expiresAt: new Date(platformNow() + preset.minutes * 60 * 1000).toISOString() })
                    }
                    className="focus-ring tnum h-7 rounded-sm bg-inset font-mono text-[11px] text-faint transition-colors hover:text-ink"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className={INPUT_SHELL}>
                <label htmlFor="ticket-expiry" className="sr-only">
                  GTD expiry
                </label>
                <input
                  id="ticket-expiry"
                  type="datetime-local"
                  aria-label="GTD expiry"
                  min={toLocalInputValue(new Date(gtdClockMs).toISOString())}
                  max={toLocalInputValue(new Date(gtdClockMs + GTD_MAX_MS).toISOString())}
                  value={toLocalInputValue(state.expiresAt)}
                  onChange={(event) => onChange({ expiresAt: fromLocalInputValue(event.target.value) })}
                  className="tnum min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none"
                />
              </div>
            </div>
          ) : null}

          {state.orderType === "LIMIT" ? (
            <CheckRow
              checked={state.postOnly === true}
              onChange={(postOnly) => onChange({ postOnly })}
              label="Post only"
              title="Rest on the book as a maker. The order is rejected instead of taking liquidity."
              disabled={isAmending || state.privateRfq || (state.tif !== "GTC" && state.tif !== "GTD")}
            />
          ) : null}

          <CheckRow
            checked={state.privateRfq}
            onChange={(privateRfq) => onChange({ privateRfq })}
            label="Private RFQ to solvers"
            title={RFQ_TITLE}
            disabled={isAmending}
            icon={<Lock size={13} aria-hidden="true" className="shrink-0 text-faint" />}
          />

          <RouteSelector
            market={market}
            action={action}
            route={route}
            bestRoute={bestRoute}
            privateRfq={state.privateRfq}
            selectedId={state.routeId}
            onSelect={(routeId) => {
              setRoutePickedFor(market.id);
              onChange({ routeId });
            }}
            amendmentMode={isAmending}
          />

          <TicketEconomics market={market} preview={preview} route={route} intent={state.intent} />
        </fieldset>

        <div className="sticky bottom-0 z-10 shrink-0 space-y-2.5 bg-panel px-3 pt-2 pb-3">
          {invalid ? (
            <ul
              id={BLOCKER_LIST_ID}
              className="space-y-1.5 rounded-md border-l-2 border-down bg-down-soft px-3 py-2.5"
            >
              {blockers.map((blocker) => (
                <li key={blocker} className="flex gap-2 text-xs leading-snug text-down">
                  <TriangleAlert size={13} aria-hidden="true" className="mt-[2px] shrink-0" />
                  <span>{blocker}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <StageArea
            market={market}
            state={state}
            preview={preview}
            route={route}
            stage={stage}
            execution={execution}
            blocked={blocked}
            invalid={invalid}
            routeMissing={preview.routeMissing}
            rfqRequest={rfqRequest ?? null}
            rfqError={rfqError ?? null}
            amendment={amendment ?? null}
            walletConnected={wallet.connected}
            onConnect={onConnect}
            onStage={onStage}
            onConfirm={onConfirm}
            onCancelResting={onCancelResting}
            onReset={onReset}
            onSelectRfqQuote={onSelectRfqQuote}
            onExecuteRfqQuote={onExecuteRfqQuote}
            onCancelRfq={onCancelRfq}
          />
        </div>

        <AccountSummary wallet={wallet} />
      </div>
    </section>
  );
}

function AccountSummary({ wallet }: { wallet: TicketWallet }) {
  const value = (amount: number | undefined) =>
    wallet.connected && amount !== undefined ? (
      <AssetAmount value={formatNumber(amount, 2)} symbol={wallet.asset} />
    ) : (
      "–"
    );
  return (
    <div className="mt-auto shrink-0 border-t border-line px-3 pt-2.5 pb-3" aria-label="Account">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Account</span>
        <span className="truncate text-[11px] text-off">
          {wallet.connected ? (wallet.riskDomain ?? "Connected") : "Not connected"}
        </span>
      </div>
      <DataRow dense label="Equity" value={value(wallet.equity)} />
      <DataRow dense label="Posted collateral" value={value(wallet.posted)} />
      <DataRow dense label="Reserved by orders" value={value(wallet.reserved)} />
      <DataRow dense label="Available to trade" value={value(wallet.available)} />
      {wallet.chainId !== undefined ? (
        <DataRow
          dense
          label="Network"
          tone="muted"
          value={
            <ChainBadge
              chain={chainKeyOf(wallet.chainId)}
              label={chainLabelOf(wallet.chainId)}
              size={12}
              className="font-sans"
            />
          }
        />
      ) : null}
    </div>
  );
}

function RouteSelector({
  market,
  action,
  route,
  bestRoute,
  privateRfq,
  selectedId,
  onSelect,
  amendmentMode,
}: {
  market: PackageMarket;
  action: "BUY" | "SELL";
  route: RouteQuote | null;
  bestRoute: RouteQuote | null;
  privateRfq: boolean;
  selectedId: string | null;
  onSelect: (routeId: string) => void;
  amendmentMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = route ?? bestRoute;
  const expanded = open || !shown;
  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((value) => !value)}
        className="focus-ring flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs text-faint">Route</span>
        {shown ? (
          <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-xs text-ink">
            <SourceMark source={shown.source} />
            <span className="truncate">{shown.label}</span>
            {!route ? <span className="shrink-0 rounded-sm bg-inset px-1 text-[10px] text-faint">best</span> : null}
            <span className="tnum shrink-0 font-mono text-dim">
              {formatNumber(routePrice(shown, action), market.priceDecimals)}
            </span>
          </span>
        ) : (
          <span className="flex-1 text-right text-xs text-faint">No route available</span>
        )}
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`shrink-0 text-faint transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="border-t border-line pt-2">
          <RouteTable
            market={market}
            action={action}
            privateRfq={privateRfq}
            selectedId={selectedId}
            onSelect={(routeId) => {
              onSelect(routeId);
              setOpen(false);
            }}
            amendmentMode={amendmentMode}
          />
        </div>
      ) : null}
    </div>
  );
}

function PayloadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="tnum truncate font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}

function StageArea({
  market,
  state,
  preview,
  route,
  stage,
  execution,
  blocked,
  invalid,
  routeMissing,
  rfqRequest,
  rfqError,
  amendment,
  walletConnected,
  onConnect,
  onStage,
  onConfirm,
  onCancelResting,
  onReset,
  onSelectRfqQuote,
  onExecuteRfqQuote,
  onCancelRfq,
}: {
  walletConnected: boolean;
  onConnect: () => void;
  market: PackageMarket;
  state: TicketState;
  preview: EconomicsPreview;
  route: RouteQuote | null;
  stage: StageState;
  execution: OrderExecutionProgress;
  blocked: boolean;
  invalid: boolean;
  routeMissing: boolean;
  rfqRequest?: RfqRequest | null;
  rfqError?: string | null;
  amendment?: { orderId: string } | null;
  onStage: () => void;
  onConfirm: () => void;
  onCancelResting: () => void;
  onReset: () => void;
  onSelectRfqQuote?: (quoteId: string) => void;
  onExecuteRfqQuote?: () => void;
  onCancelRfq?: () => void;
}) {
  const [confirmations] = useConfirmationPrefs();
  const cancelStep = useConfirmStep(confirmations.cancels);
  const unit = priceUnitSuffix(market.priceUnit);
  const verb = state.intent === "ENTER" ? "Enter" : "Exit";
  const idleSide = preview.packageSide === "LONG" ? "Long" : "Short";
  const idleTone =
    state.intent === "ENTER"
      ? preview.packageSide === "LONG"
        ? "bg-up text-app hover:brightness-110"
        : "bg-down text-app hover:brightness-110"
      : preview.action === "BUY"
        ? "bg-up text-app hover:brightness-110"
        : "bg-down text-app hover:brightness-110";

  if (stage.kind === "RFQ" || stage.kind === "RFQ_SELECTED") {
    return (
      <RfqQuotePanel
        market={market}
        rfqRequest={rfqRequest ?? null}
        rfqError={rfqError ?? null}
        onSelectRfqQuote={onSelectRfqQuote}
        onExecuteRfqQuote={onExecuteRfqQuote}
        onCancelRfq={onCancelRfq}
      />
    );
  }

  if (stage.kind === "IDLE" && !walletConnected) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="focus-ring h-12 w-full rounded-md bg-ink text-sm font-semibold text-app transition-[filter] hover:brightness-90 lg:h-10"
      >
        Connect wallet
      </button>
    );
  }

  if (stage.kind === "IDLE") {
    return (
      <button
        type="button"
        disabled={blocked}
        aria-describedby={invalid ? BLOCKER_LIST_ID : routeMissing ? ROUTE_HINT_ID : undefined}
        onClick={onStage}
        className={`focus-ring h-12 w-full rounded-md text-sm font-semibold transition-[filter,colors] lg:h-10 ${
          blocked ? "cursor-not-allowed bg-raised text-dim" : idleTone
        }`}
      >
        {routeMissing
          ? "Select a route to continue"
          : state.intent === "ENTER"
            ? `${verb} ${idleSide} · ${formatLotCount(preview.requestedLots)}`
            : `Close ${formatLotCount(preview.requestedLots)}`}
      </button>
    );
  }

  if (stage.kind === "COMPILED") {
    const requiresRfq = amendment ? false : (route?.requiresPrivate ?? false) && state.privateRfq;
    const sideLabel = preview.packageSide === "LONG" ? "Long" : "Short";
    const actionLabel = preview.action === "BUY" ? "Buy" : "Sell";
    return (
      <div className="overflow-hidden rounded-md border border-line-strong bg-raised pb-1">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <SectionLabel>Compiled payload</SectionLabel>
          <span className="tnum font-mono text-xs text-dim">{stage.reference}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2.5">
          <PayloadRow label="Package" value={market.code} />
          <PayloadRow label="Legs" value={`${market.legs.length}, one net price`} />
          <PayloadRow
            label="Intent"
            value={`${verb} ${sideLabel.toLowerCase()}, ${state.orderType === "LIMIT" ? "limit" : "marketable"}, ${state.tif}`}
          />
          <PayloadRow label="Package side" value={`${sideLabel} · ${actionLabel}`} />
          <PayloadRow label="Requested" value={formatLotCount(preview.requestedLots)} />
          {preview.cancelledLots > 1e-9 ? (
            <>
              <PayloadRow label="Expected fill" value={formatLotCount(preview.fillLots)} />
              <PayloadRow label="IOC remainder" value={`${formatLots(preview.cancelledLots)} lots cancelled`} />
            </>
          ) : null}
          {state.intent === "EXIT" ? (
            <PayloadRow label="Close position" value={state.closePositionId ?? "none"} />
          ) : null}
          <PayloadRow
            label="Limit"
            value={`${formatNumber(preview.limitPrice, market.priceDecimals)} ${unit}`}
          />
          <PayloadRow label="Route" value={route?.label ?? "none"} />
          {state.tif === "GTD" && state.expiresAt ? (
            <PayloadRow
              label="Expiry"
              value={new Date(state.expiresAt).toLocaleString()}
            />
          ) : null}
          {amendment ? <PayloadRow label="Replaced order" value={amendment.orderId} /> : null}
          {amendment ? <PayloadRow label="Queue priority" value="Resets on replacement" /> : null}
          <PayloadRow
            label={state.intent === "EXIT" ? "New collateral" : "Collateral"}
            value={state.intent === "EXIT" ? "No new collateral" : formatUsd(preview.totalCollateral, 2)}
          />
          <PayloadRow label="Total fees" value={formatUsd(preview.totalFees, 2)} />
        </dl>
        <p className="px-3 pb-2 text-xs leading-snug text-dim">
          {state.privateRfq
            ? "Disclosure: private RFQ, visible only to invited solvers."
            : "Disclosure: public package book, visible on the aggregate tape."}
        </p>
        {preview.rests ? (
          <p className="px-3 pb-2 text-xs leading-snug text-dim">
            This limit does not cross, so it will rest on the book as a working order. No
            fill, receipt, or position is created.
          </p>
        ) : null}
        <p className="border-t border-line px-3 py-2 text-xs leading-snug text-faint">
          The next action signs and submits to the local production-parity chain. It never submits
          to Arbitrum Sepolia or mainnet.
        </p>
        <div className="grid grid-cols-2 gap-2 px-3 py-2">
          <button
            type="button"
            onClick={onReset}
            className="focus-ring h-11 rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="focus-ring h-11 rounded-md bg-brand text-sm font-semibold text-app transition-colors hover:brightness-105 lg:h-9"
          >
            {amendment
              ? "Authorize replacement"
              : requiresRfq
                ? "Request firm quotes"
                : preview.rests
                  ? "Authorize and place"
                  : "Authorize and execute"}
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "RESTING") {
    const armed = cancelStep.armed === "working-order";
    return (
      <div className="space-y-2">
        <ExecutionTimeline progress={execution} />
        <button
          type="button"
          onClick={() => cancelStep.run("working-order", onCancelResting)}
          className={`focus-ring h-11 w-full rounded-md border text-sm transition-colors lg:h-9 ${
            armed ? "border-down/60 bg-down-soft text-down" : "border-line text-dim hover:border-line-strong hover:text-ink"
          }`}
        >
          {armed ? "Confirm cancel" : "Cancel working order"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ExecutionTimeline progress={execution} />
      {stage.kind === "COMPLETED" || stage.kind === "FAILED" ? (
        <button
          type="button"
          onClick={onReset}
          className="focus-ring h-11 w-full rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
        >
          New package order
        </button>
      ) : null}
    </div>
  );
}
