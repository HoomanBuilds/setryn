"use client";

import { Lock, Minus, Plus, TriangleAlert } from "lucide-react";
import { ExecutionTimeline } from "@/components/gateway/ExecutionTimeline";
import { ROUTE_HINT_ID, RouteTable } from "@/components/terminal/RouteTable";
import { RfqQuotePanel } from "@/components/terminal/RfqQuotePanel";
import { TicketEconomics } from "@/components/terminal/TicketEconomics";
import {
  CheckRow,
  SectionLabel,
  Segmented,
} from "@/components/terminal/primitives";
import type {
  EconomicsPreview,
  Intent,
  OrderType,
  PackageSide,
  StageState,
  TicketState,
  TimeInForce,
} from "@/lib/terminal/economics";
import { bestReferencePrice, executableAction } from "@/lib/terminal/economics";
import { formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import type { HandoffContext } from "@/lib/terminal/handoff";
import type { PackageMarket, RouteQuote } from "@/lib/terminal/types";
import type {
  ExecutionPosition,
  OrderExecutionProgress,
  RfqRequest,
} from "@/lib/internal-gateway/types";

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

export function OrderTicket({
  market,
  state,
  preview,
  route,
  stage,
  execution,
  maxLots,
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
  const blockers = [
    ...preview.blockers,
    ...(externalBlock ? [externalBlock] : []),
    ...(amendmentCrosses
      ? ["Amendment price crosses. Discard amendment and submit a normal immediate order."]
      : []),
    ...(amendmentPrivateRoute
      ? ["Solver RFQ routes cannot rest as replacements. Select a public book route."]
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
    const next = (Number.parseFloat(state.limitInput) || bestPrice) + direction * market.tickSize;
    onChange({ limitInput: next.toFixed(market.priceDecimals) });
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <div className="hidden h-9 shrink-0 items-center border-b border-line px-4 lg:flex">
        <SectionLabel>Order ticket</SectionLabel>
      </div>

      <fieldset
        disabled={locked}
        aria-busy={locked}
        className={`scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-0 px-3 py-3 lg:px-4 ${locked ? "opacity-65" : ""}`}
      >
        {handoff.present ? (
          <div className="rounded-md border border-line bg-raised px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
                {handoff.sourceLabel ? `Handoff · ${handoff.sourceLabel}` : "Handoff"}
              </span>
              {handoff.direction || handoff.lots !== null ? (
                <span className="tnum font-mono text-[11px] text-dim">
                  {[handoff.direction, handoff.lots !== null ? `${handoff.lots} lots` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-dim">
              {handoff.draftId ? (
                <span className="tnum font-mono">{handoff.draftId}</span>
              ) : null}
              {handoff.lifecycleId ? (
                <span className="tnum font-mono">{handoff.lifecycleId}</span>
              ) : null}
              {handoff.exposureId ? (
                <span className="tnum font-mono">{handoff.exposureId}</span>
              ) : null}
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
        <Segmented
          options={INTENTS}
          value={state.intent}
          onChange={(intent) => onChange({ intent })}
          label="Package intent"
          tone="direction"
          disabled={isAmending}
        />

        {!isExit ? (
          <Segmented
            options={SIDES}
            value={state.side}
            onChange={(side) => onChange({ side })}
            label="Package side"
            size="sm"
            tone="direction"
            disabled={isAmending}
          />
        ) : null}

        {isExit ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor="ticket-close" className="text-xs text-dim">
                Close strategy
              </label>
              <span className="tnum font-mono text-xs text-off">
                {`${closePositions.length} active`}
              </span>
            </div>
            <select
              id="ticket-close"
              value={state.closePositionId ?? ""}
              disabled={isAmending}
              onChange={(event) =>
                onChange({ closePositionId: event.target.value || null })
              }
              className="focus-ring tnum h-9 w-full rounded-md border border-line bg-inset px-2 font-mono text-xs text-ink disabled:cursor-not-allowed disabled:opacity-65"
            >
              <option value="">Select a package position</option>
              {closePositions.map((position) => (
                <option key={position.id} value={position.id}>
                  {`${position.id} · ${position.side} · ${position.lots} lots · ${Math.round(position.collateral)} USDC`}
                </option>
              ))}
            </select>
            {selectedClose ? (
              <p className="mt-1 text-[11px] leading-snug text-dim">
                {`${selectedClose.side === "LONG" ? "Long" : "Short"} position · ${closeActionLabel} · ${selectedClose.lots} lots · ${formatUsd(selectedClose.collateral, 0)} collateral.`}
              </p>
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-faint">
                {closePositions.length === 0
                  ? "No active package positions for this market. Enter a package first."
                  : "Choose which active package this exit reduces. Quantity cannot exceed its lots."}
              </p>
            )}
          </div>
        ) : null}

        <Segmented
          options={ORDER_TYPES}
          value={state.orderType}
          onChange={(orderType) => onChange({ orderType })}
          label="Order type"
          size="sm"
          disabled={isAmending}
        />

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="ticket-lots" className="text-xs text-dim">
              Quantity
            </label>
            <span className="tnum font-mono text-xs text-off">
              {`1 lot = ${formatUsd(market.notionalPerLot, 0)}`}
            </span>
          </div>
          <div className={INPUT_SHELL}>
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
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {[10, 25, 50].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ lotsInput: String(value) })}
                className="focus-ring tnum h-9 rounded-md border border-line bg-raised font-mono text-xs text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-7"
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange({ lotsInput: String(maxLots) })}
              title={
                state.intent === "EXIT"
                  ? `Largest close quantity on the selected position and route: ${maxLots} lots`
                  : `Largest quantity this workspace can collateralise on the selected route: ${maxLots} lots`
              }
              className="focus-ring h-9 rounded-md border border-line bg-raised text-xs text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-7"
            >
              Max
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label
              htmlFor="ticket-limit"
              title={`One tick is ${formatNumber(market.tickSize, market.priceDecimals)} ${unit}. Selecting an executable book row sets this limit.`}
              className="text-xs text-dim"
            >
              Package-price limit
            </label>
            <button
              type="button"
              onClick={() => onChange({ limitInput: bestPrice.toFixed(market.priceDecimals) })}
              className="focus-ring tnum rounded-sm font-mono text-xs text-dim transition-colors hover:text-ink"
            >
              {`${bestLabel} ${formatNumber(bestPrice, market.priceDecimals)}`}
            </button>
          </div>
          <div className="flex gap-1.5">
            <Stepper label="Decrease limit by one tick" onClick={() => stepLimit(-1)}>
              <Minus size={14} aria-hidden="true" />
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
            <Stepper label="Increase limit by one tick" onClick={() => stepLimit(1)}>
              <Plus size={14} aria-hidden="true" />
            </Stepper>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs text-dim">Time in force</div>
          <Segmented
            options={TIFS}
            value={state.tif}
            onChange={(tif) => onChange({ tif })}
            label="Time in force"
            size="sm"
            disabled={isAmending}
          />
        </div>

        <CheckRow
          checked={state.privateRfq}
          onChange={(privateRfq) => onChange({ privateRfq })}
          label="Private RFQ"
          title={RFQ_TITLE}
          disabled={isAmending}
          icon={<Lock size={13} aria-hidden="true" className="shrink-0 text-faint" />}
        />

        <RouteTable
          market={market}
          action={preview.action}
          privateRfq={state.privateRfq}
          selectedId={state.routeId}
          onSelect={(routeId) => onChange({ routeId })}
          amendmentMode={isAmending}
        />

        <TicketEconomics market={market} preview={preview} route={route} intent={state.intent} />
      </fieldset>

      <div className="shrink-0 space-y-2.5 border-t border-line bg-panel px-3 pt-3 pb-3 lg:px-4">
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
          onStage={onStage}
          onConfirm={onConfirm}
          onCancelResting={onCancelResting}
          onReset={onReset}
          onSelectRfqQuote={onSelectRfqQuote}
          onExecuteRfqQuote={onExecuteRfqQuote}
          onCancelRfq={onCancelRfq}
        />
      </div>
    </section>
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
  onStage,
  onConfirm,
  onCancelResting,
  onReset,
  onSelectRfqQuote,
  onExecuteRfqQuote,
  onCancelRfq,
}: {
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
  const unit = priceUnitSuffix(market.priceUnit);
  const verb = state.intent === "ENTER" ? "Enter" : "Exit";
  const idleSide = preview.packageSide === "LONG" ? "Long" : "Short";

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

  if (stage.kind === "IDLE") {
    return (
      <button
        type="button"
        disabled={blocked}
        aria-describedby={invalid ? BLOCKER_LIST_ID : routeMissing ? ROUTE_HINT_ID : undefined}
        onClick={onStage}
        className={`focus-ring h-12 w-full rounded-md text-sm font-semibold transition-colors lg:h-10 ${
          blocked
            ? "cursor-not-allowed bg-raised text-dim"
            : "bg-brand text-app hover:brightness-105"
        }`}
      >
        {routeMissing ? "Select a route to continue" : `${verb} ${idleSide} ${market.name} ${market.tenorLabel}`}
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
          <PayloadRow label="Quantity" value={`${formatLots(preview.lots)} lots`} />
          {state.intent === "EXIT" ? (
            <PayloadRow label="Close position" value={state.closePositionId ?? "none"} />
          ) : null}
          <PayloadRow
            label="Limit"
            value={`${formatNumber(preview.limitPrice, market.priceDecimals)} ${unit}`}
          />
          <PayloadRow label="Route" value={route?.label ?? "none"} />
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
            This limit does not cross, so it will rest locally as a working order. No
            fill, receipt, or position is created.
          </p>
        ) : null}
        <p className="border-t border-line px-3 py-2 text-xs leading-snug text-faint">
          Local demo only. The next action simulates authorization and clearing in this browser.
          It cannot submit to Arbitrum Sepolia or mainnet.
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
                  ? "Authorize and rest demo"
                  : "Authorize and execute demo"}
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "RESTING") {
    return (
      <div className="space-y-2">
        <ExecutionTimeline progress={execution} />
        <button
          type="button"
          onClick={onCancelResting}
          className="focus-ring h-11 w-full rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
        >
          Cancel working order
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
