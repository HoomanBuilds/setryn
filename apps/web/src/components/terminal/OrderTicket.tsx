"use client";

import { Lock, Minus, Plus, TriangleAlert } from "lucide-react";
import { ROUTE_HINT_ID, RouteTable } from "@/components/terminal/RouteTable";
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
  StageState,
  TicketState,
  TimeInForce,
} from "@/lib/terminal/economics";
import { formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket, RouteQuote } from "@/lib/terminal/types";

const INTENTS: { value: Intent; label: string }[] = [
  { value: "ENTER", label: "Enter" },
  { value: "EXIT", label: "Exit" },
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
  maxLots,
  onChange,
  onStage,
  onConfirm,
  onReset,
}: {
  market: PackageMarket;
  state: TicketState;
  preview: EconomicsPreview;
  route: RouteQuote | null;
  stage: StageState;
  maxLots: number;
  onChange: (patch: Partial<TicketState>) => void;
  onStage: () => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const unit = priceUnitSuffix(market.priceUnit);
  const bestPrice = state.intent === "ENTER" ? market.bestAsk : market.bestBid;
  const invalid = preview.blockers.length > 0;
  const blocked = invalid || preview.routeMissing;

  const stepLimit = (direction: 1 | -1) => {
    const next = (Number.parseFloat(state.limitInput) || bestPrice) + direction * market.tickSize;
    onChange({ limitInput: next.toFixed(market.priceDecimals) });
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <div className="hidden h-9 shrink-0 items-center border-b border-line px-4 lg:flex">
        <SectionLabel>Order ticket</SectionLabel>
      </div>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 lg:px-4">
        <Segmented
          options={INTENTS}
          value={state.intent}
          onChange={(intent) => onChange({ intent })}
          label="Package intent"
          tone="direction"
        />

        <Segmented
          options={ORDER_TYPES}
          value={state.orderType}
          onChange={(orderType) => onChange({ orderType })}
          label="Order type"
          size="sm"
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
              title={`Largest quantity this workspace can collateralise on the selected route: ${maxLots} lots`}
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
              {`${state.intent === "ENTER" ? "best offer" : "best bid"} ${formatNumber(bestPrice, market.priceDecimals)}`}
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
          />
        </div>

        <CheckRow
          checked={state.privateRfq}
          onChange={(privateRfq) => onChange({ privateRfq })}
          label="Private RFQ"
          title={RFQ_TITLE}
          icon={<Lock size={13} aria-hidden="true" className="shrink-0 text-faint" />}
        />

        <RouteTable
          market={market}
          intent={state.intent}
          privateRfq={state.privateRfq}
          selectedId={state.routeId}
          onSelect={(routeId) => onChange({ routeId })}
        />

        <TicketEconomics market={market} preview={preview} route={route} />
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-line bg-panel px-3 pt-3 pb-3 lg:px-4">
        {invalid ? (
          <ul
            id={BLOCKER_LIST_ID}
            className="space-y-1.5 rounded-md border-l-2 border-down bg-down-soft px-3 py-2.5"
          >
            {preview.blockers.map((blocker) => (
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
          blocked={blocked}
          invalid={invalid}
          routeMissing={preview.routeMissing}
          onStage={onStage}
          onConfirm={onConfirm}
          onReset={onReset}
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
  blocked,
  invalid,
  routeMissing,
  onStage,
  onConfirm,
  onReset,
}: {
  market: PackageMarket;
  state: TicketState;
  preview: EconomicsPreview;
  route: RouteQuote | null;
  stage: StageState;
  blocked: boolean;
  invalid: boolean;
  routeMissing: boolean;
  onStage: () => void;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const unit = priceUnitSuffix(market.priceUnit);
  const verb = state.intent === "ENTER" ? "Enter" : "Exit";

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
        {routeMissing ? "Select a route to continue" : `${verb} ${market.name} ${market.tenorLabel}`}
      </button>
    );
  }

  if (stage.kind === "COMPILED") {
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
            value={`${verb}, ${state.orderType === "LIMIT" ? "limit" : "marketable"}, ${state.tif}`}
          />
          <PayloadRow label="Quantity" value={`${formatLots(preview.lots)} lots`} />
          <PayloadRow
            label="Limit"
            value={`${formatNumber(preview.limitPrice, market.priceDecimals)} ${unit}`}
          />
          <PayloadRow label="Route" value={route?.label ?? "none"} />
          <PayloadRow label="Collateral" value={formatUsd(preview.totalCollateral, 2)} />
          <PayloadRow label="Total fees" value={formatUsd(preview.totalFees, 2)} />
        </dl>
        <p className="px-3 pb-2 text-xs leading-snug text-dim">
          {state.privateRfq
            ? "Disclosure: private RFQ, visible only to invited solvers."
            : "Disclosure: public package book, visible on the aggregate tape."}
        </p>
        <p className="border-t border-line px-3 py-2 text-xs leading-snug text-down">
          Preview only. No wallet is connected, no signature is requested, and no transaction will
          reach Arbitrum Sepolia.
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
            Confirm preview
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "QUEUED") {
    return (
      <div className="rounded-md border border-line bg-raised px-3 py-3">
        <p className="text-sm text-ink">Running the local preview state machine</p>
        <ol className="mt-2 space-y-1 text-xs text-faint">
          <li>Compiled package payload</li>
          <li>Checked route capacity and collateral</li>
          <li className="text-ink">Resolving the preview clearing state</li>
        </ol>
        <div
          className="mt-2.5 h-[2px] w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Preview progress"
        >
          <span className="block h-full w-1/3 animate-pulse bg-brand" />
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-raised">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <SectionLabel>Preview record</SectionLabel>
        <span className="tnum font-mono text-xs text-dim">{stage.reference}</span>
      </div>
      <div className="px-3 py-2.5 text-xs leading-relaxed text-dim">
        <p>
          {`${verb} ${formatLots(preview.lots)} lots of ${market.code} at ${formatNumber(preview.effectivePrice, market.priceDecimals)} ${unit} would clear through ${route?.label.toLowerCase()} with a ${preview.settlementGuarantee.toLowerCase()} guarantee.`}
        </p>
        <p className="mt-2 text-down">
          This is a local scenario record. No protocol state changed, no collateral moved, and no
          receipt exists to verify.
        </p>
      </div>
      <div className="px-3 pt-1 pb-3">
        <button
          type="button"
          onClick={onReset}
          className="focus-ring h-11 w-full rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
        >
          Reset ticket
        </button>
      </div>
    </div>
  );
}
