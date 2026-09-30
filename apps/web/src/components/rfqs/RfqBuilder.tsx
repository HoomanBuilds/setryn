"use client";

import { Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  Circle,
  CircleAlert,
  CornerDownRight,
  Lock,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { SourceMark } from "@/components/terminal/primitives";
import {
  BUTTON_INK,
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  Chip,
  EnvironmentChip,
  Panel,
  PanelHeader,
  PanelTitle,
  motion,
  useNow,
} from "@/components/activity/ledger-ui";
import { StepTimeline, type TimelineStep } from "@/components/activity/StepTimeline";
import { ProvenanceChip } from "@/components/auctions/board-kit";
import { Flash, Row, Stepper } from "@/components/strategies/desk/Desk";
import { PARTICIPANTS } from "@/lib/solver/roster";
import { GUARANTEE_COPY, RECOVERY_COPY, SLIPPAGE_PRESETS_BPS, routePrice } from "@/lib/terminal/economics";
import { formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import { parseHandoff } from "@/lib/terminal/handoff";
import { MARKETS, packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { RfqStages } from "./RfqStages";
import {
  AUTHORIZATION_LIFETIME_SECONDS,
  DEVNET_MAX_LOTS,
  WINDOW_OPTIONS,
  blockingChecks,
  deriveOrder,
  initialDraft,
  preflight,
  type BuilderDraft,
  type CheckFix,
  type CheckState,
  type DerivedOrder,
  type PreflightCheck,
} from "./builder-model";
import { gatewayErrorCode, gatewayErrorCopy } from "./rfq-errors";

type Phase = "IDLE" | "CONNECTING" | "AUTHORIZING" | "REQUESTING" | "OPENING";

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

interface SegmentOption<T extends string | number> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex min-w-0 rounded-md border border-line bg-inset p-0.5 ${className}`}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={String(option.id)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={`focus-ring inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-3 text-xs whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-faint hover:text-dim"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-dim">{label}</span>
        {hint ? <span className="min-w-0 truncate text-right text-[11px] text-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function OptionCard({
  selected,
  onSelect,
  title,
  detail,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`focus-ring flex min-w-0 flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors duration-150 ${
        selected ? "border-brand-edge bg-brand-soft/40" : "border-line hover:border-line-strong"
      }`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-ink">
          <span
            aria-hidden="true"
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
              selected ? "border-brand" : "border-line-strong"
            }`}
          >
            {selected ? <span className="h-1.5 w-1.5 rounded-full bg-brand" /> : null}
          </span>
          {title}
        </span>
        {badge}
      </span>
      <span className="pl-5.5 text-[11px] leading-snug text-faint">{detail}</span>
    </button>
  );
}

function unit(market: PackageMarket): string {
  return priceUnitSuffix(market.priceUnit);
}

function price(value: number, market: PackageMarket): string {
  return formatNumber(value, market.priceDecimals);
}

function signed(value: number, market: PackageMarket): string {
  const rounded = Number(value.toFixed(market.priceDecimals));
  return `${rounded > 0 ? "+" : rounded < 0 ? "-" : "±"}${formatNumber(Math.abs(rounded), market.priceDecimals)}`;
}

/* ------------------------------------------------------------------ */
/* Package picker                                                      */
/* ------------------------------------------------------------------ */

const UNDERLYINGS = ["ALL", ...Array.from(new Set(MARKETS.map((market) => market.underlying)))];

function PackagePicker({
  markets,
  selectedId,
  onchainMarketId,
  onSelect,
}: {
  markets: PackageMarket[];
  selectedId: string;
  onchainMarketId: string | null;
  onSelect: (marketId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [underlying, setUnderlying] = useState("ALL");
  const needle = query.trim().toLowerCase();
  const visible = markets.filter(
    (market) =>
      (underlying === "ALL" || market.underlying === underlying) &&
      (!needle || `${market.name} ${market.code} ${market.tenorLabel}`.toLowerCase().includes(needle)),
  );
  return (
    <div className="grid gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-inset px-2 transition-colors focus-within:border-line-strong">
          <Search size={13} aria-hidden="true" className="shrink-0 text-faint" />
          <span className="sr-only">Search package markets</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Package, code, tenor"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-off"
          />
        </label>
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {UNDERLYINGS.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setUnderlying(entry)}
              aria-pressed={underlying === entry}
              className={`focus-ring h-7 shrink-0 rounded-md border px-2 text-[11px] transition-colors ${
                underlying === entry ? "border-line-strong bg-raised text-ink" : "border-line text-faint hover:text-dim"
              }`}
            >
              {entry === "ALL" ? "All" : entry}
            </button>
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-label="Package market" className="scroll-thin max-h-[264px] overflow-y-auto rounded-md border border-line">
        {visible.length === 0 ? <p className="px-3 py-6 text-center text-xs text-faint">No package matches.</p> : null}
        {visible.map((market) => {
          const selected = market.id === selectedId;
          const route = market.routes.find((candidate) => candidate.id === "SOLVER_RFQ") ?? null;
          const onchain = market.id === onchainMarketId;
          return (
            <button
              key={market.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(market.id)}
              className={`focus-ring grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-left transition-colors duration-150 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_84px_120px_150px] ${
                selected ? "bg-raised/80 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{packageLabel(market)}</span>
                <span className="tnum block truncate font-mono text-[10px] text-faint">{market.code}</span>
              </span>
              <span className="tnum text-right font-mono text-xs text-ink">
                <Flash value={market.netPrice}>{price(market.netPrice, market)}</Flash>
                <span className="ml-1 text-[10px] text-faint">{unit(market)}</span>
              </span>
              <span className="tnum hidden text-right font-mono text-[11px] text-dim sm:block">
                {route ? (
                  <span className="inline-flex items-center gap-1.5">
                    <SourceMark source="SOLVER_FIRM" />
                    {`${price(route.exitPrice, market)} / ${price(route.enterPrice, market)}`}
                  </span>
                ) : (
                  <span className="text-faint">No solver route</span>
                )}
              </span>
              <span className="col-span-2 flex flex-wrap items-center gap-1 sm:col-span-1 sm:justify-end">
                <Chip tone={onchain ? "up" : "muted"} dot>
                  {onchain ? "Onchain" : "Preview"}
                </Chip>
                {market.qualification !== "QUALIFIED" ? (
                  <Chip tone={market.qualification === "SUSPENDED" ? "down" : "neutral"}>
                    {market.qualification === "SUSPENDED" ? "Suspended" : "Conditional"}
                  </Chip>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PackageSummary({ market }: { market: PackageMarket }) {
  return (
    <div className={`grid gap-2 rounded-md border border-line bg-inset px-3 py-2.5 ${motion.fade}`} key={market.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-ink">{market.strategyLabel}</span>
        <span className="tnum font-mono text-[11px] text-faint">{`Expires ${market.expiryIso} · ${market.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "Cash"} ${market.settlementAsset}`}</span>
      </div>
      <ul className="grid gap-1">
        {market.legs.map((leg) => (
          <li key={leg.id} className="grid grid-cols-[40px_22px_minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
            <span className={leg.side === "BUY" ? "text-up" : "text-down"}>{leg.side === "BUY" ? "Buy" : "Sell"}</span>
            <span className="tnum font-mono text-faint">{`${leg.ratio}x`}</span>
            <span className="truncate text-dim">{leg.instrument}</span>
            <span className="tnum font-mono text-faint">{`${formatNumber(leg.mark, leg.markUnit === "USD" ? 2 : 1)} ${leg.markUnit === "BP" ? "bp" : leg.markUnit === "PTS" ? "pts" : "USD"}`}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-snug text-faint">{`Fixing: ${market.fixingSource}.`}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pre-flight                                                          */
/* ------------------------------------------------------------------ */

const CHECK_ICON: Record<CheckState, ReactNode> = {
  pass: <Check size={11} strokeWidth={2.5} aria-hidden="true" className="text-up" />,
  warn: <TriangleAlert size={11} aria-hidden="true" className="text-brand" />,
  block: <CircleAlert size={11} aria-hidden="true" className="text-down" />,
  pending: <Circle size={10} aria-hidden="true" className="text-faint" />,
};

const CHECK_LABEL: Record<CheckState, string> = { pass: "Passed", warn: "Warning", block: "Blocking", pending: "Pending" };

function Checklist({ checks, onFix }: { checks: PreflightCheck[]; onFix: (fix: CheckFix) => void }) {
  return (
    <ul className="divide-y divide-line">
      {checks.map((check) => (
        <li key={check.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 py-2">
          <span
            className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full ${
              check.state === "pass" ? "bg-up-soft" : check.state === "block" ? "bg-down-soft" : check.state === "warn" ? "bg-brand-soft" : "border border-dashed border-line-strong"
            }`}
            title={CHECK_LABEL[check.state]}
          >
            {CHECK_ICON[check.state]}
            <span className="sr-only">{CHECK_LABEL[check.state]}</span>
          </span>
          <span className="min-w-0">
            <span className={`block text-xs ${check.state === "block" ? "text-ink" : check.state === "pending" ? "text-faint" : "text-ink"}`}>
              {check.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-faint">{check.detail}</span>
            {check.fix && check.fix.kind !== "CONNECT" ? (
              check.fix.kind === "LINK" ? (
                <Link href={check.fix.href} className="mt-1 inline-flex items-center gap-1 text-[11px] text-dim underline decoration-line-strong underline-offset-2 hover:text-ink">
                  {check.fix.label}
                  <ArrowUpRight size={10} aria-hidden="true" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onFix(check.fix!)}
                  className="focus-ring mt-1 inline-flex items-center rounded-sm text-[11px] text-dim underline decoration-line-strong underline-offset-2 hover:text-ink"
                >
                  {check.fix.kind === "INVITATION"
                    ? "Use the qualified maker set"
                    : check.fix.kind === "DISCLOSURE"
                      ? "Stay anonymous"
                      : check.fix.kind === "PARTIAL"
                        ? "Allow partial fills"
                        : check.fix.label}
                </button>
              )
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Economics                                                           */
/* ------------------------------------------------------------------ */

function Economics({
  order,
  draft,
  available,
  connected,
}: {
  order: DerivedOrder;
  draft: BuilderDraft;
  available: number;
  connected: boolean;
}) {
  const { market, preview, route, action, limit, expectedPrice } = order;
  const isExit = draft.intent === "EXIT";
  const headroom = action === "BUY" ? limit - expectedPrice : expectedPrice - limit;
  const bound = (isExit ? 0 : preview.totalCollateral) + preview.totalFees;
  const alternatives = market.routes.filter((candidate) => candidate.id !== "SOLVER_RFQ");
  const solverFee = preview.counterpartyFee;
  return (
    <Panel className={motion.mount} label="Live economics">
      <PanelHeader right={<ProvenanceChip value="ESTIMATED" title="Calculated from the shared preview feed and the terminal's fee and collateral rules. Makers quote their own prices." />}>
        <PanelTitle>Economics</PanelTitle>
      </PanelHeader>
      <div className="grid grid-cols-2 gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] text-faint">Expected quote</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="tnum font-serif text-[26px] leading-8 text-ink">
              <Flash value={expectedPrice}>{price(expectedPrice, market)}</Flash>
            </span>
            <span className="text-xs text-faint">{unit(market)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-faint">{route ? "Solver firm row, preview feed" : "Touch, no solver route"}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-[11px] text-faint">Your limit</div>
          <div className="tnum mt-0.5 font-serif text-[26px] leading-8 text-ink">{limit > 0 ? price(limit, market) : "—"}</div>
          <div className={`tnum mt-0.5 font-mono text-[11px] ${headroom >= 0 ? "text-dim" : "text-down"}`}>
            {limit > 0 ? `${signed(headroom, market)} ${unit(market)} headroom` : "Enter a limit"}
          </div>
        </div>
      </div>
      <div className="px-4 py-2">
        <Row label="Direction" value={`${action === "BUY" ? "Buy" : "Sell"} ${formatLots(preview.requestedLots)} lots`} tone={action === "BUY" ? "up" : "down"} />
        <Row label="Notional" value={formatUsd(preview.notional, 0)} />
        <Row label="Package value at limit" value={limit > 0 ? formatUsd(limit * market.contractMultiplier * preview.requestedLots, 2) : "—"} />
        <Row label="Protocol fee" value={formatUsd(preview.protocolFee, 2)} />
        <Row label={preview.counterpartyFeeLabel} value={formatUsd(solverFee, 2)} />
        <Row label="Fee cap signed" value={formatUsd(preview.totalFees, 2)} />
        <Row label="Collateral bound" value={isExit ? "None, exit" : formatUsd(preview.totalCollateral, 2)} />
        <Row label="Total reserved" value={formatUsd(bound, 2)} tone="neutral" className="border-t border-line pt-1" />
        <Row
          label="Available collateral"
          value={connected ? formatUsd(available, 2) : "Connect to check"}
          tone={connected ? (available >= bound ? "up" : "down") : "dim"}
        />
        <Row
          label="Settlement guarantee"
          value={route ? GUARANTEE_COPY[route.guarantee].label : "—"}
          title={route ? GUARANTEE_COPY[route.guarantee].detail : undefined}
        />
      </div>
      {alternatives.length > 0 ? (
        <div className="border-t border-line px-4 py-2.5">
          <div className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Same size on public routes</div>
          <ul className="mt-1.5 grid gap-1.5">
            {alternatives.map((candidate) => {
              const alternativePrice = routePrice(candidate, action);
              const diff = action === "BUY" ? alternativePrice - expectedPrice : expectedPrice - alternativePrice;
              const dollars = diff * market.contractMultiplier * preview.requestedLots;
              const short = candidate.availableLots < preview.requestedLots;
              return (
                <li key={candidate.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5 text-dim">
                    <SourceMark source={candidate.source} />
                    <span className="truncate">{candidate.label}</span>
                  </span>
                  <span className="tnum text-right font-mono text-ink">{`${price(alternativePrice, market)} ${unit(market)}`}</span>
                  <span className="col-span-2 flex justify-between text-faint">
                    <span>{short ? `Only ${candidate.availableLots} lots executable` : GUARANTEE_COPY[candidate.guarantee].label}</span>
                    <span className={`tnum font-mono ${dollars > 0 ? "text-up" : dollars < 0 ? "text-down" : ""}`}>
                      {route ? `${dollars >= 0 ? "RFQ saves" : "RFQ costs"} ${formatUsd(Math.abs(dollars), 2)}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {route ? (
        <p className="border-t border-line px-4 py-2.5 text-[11px] leading-snug text-faint">
          {`Recovery: ${RECOVERY_COPY[route.guarantee].unknownPath}`}
        </p>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export function RfqBuilder() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center bg-app text-xs text-faint">Loading RFQ builder</div>}>
      <BuilderContent />
    </Suspense>
  );
}

function BuilderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const { markets } = usePreviewBoard();
  const nowMs = useNow();
  const handoff = useMemo(() => parseHandoff(searchParams), [searchParams]);
  const marketParam = searchParams.get("market");
  const limitParam = searchParams.get("limit");
  const paramKey = `${handoff.key}|${marketParam ?? ""}|${limitParam ?? ""}`;

  const [draft, setDraft] = useState<BuilderDraft>(() => initialDraft(handoff, marketParam, limitParam));
  const [appliedKey, setAppliedKey] = useState(paramKey);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const inFlight = useRef(false);

  /* A new handoff link reseeds the draft in the same render, never from an effect. */
  if (appliedKey !== paramKey) {
    setAppliedKey(paramKey);
    setDraft(initialDraft(handoff, marketParam, limitParam));
    setError(null);
  }

  const liveMarket = markets.find((market) => market.id === draft.marketId) ?? markets[0];
  const order = deriveOrder(draft, liveMarket, snapshot.positions, nowMs);
  const onchainMarketId = snapshot.publicBookMarketId;
  const checks = preflight(draft, order, snapshot, onchainMarketId);
  const blockers = blockingChecks(checks);
  const walletBlocked = blockers.some((check) => check.id === "wallet");
  const otherBlockers = blockers.filter((check) => check.id !== "wallet");
  const connected = snapshot.wallet.status === "CONNECTED";
  const busy = phase !== "IDLE";
  const positions = snapshot.positions.filter((position) => position.marketId === liveMarket.id);
  const { market, preview, action } = order;

  const patch = (next: Partial<BuilderDraft>) => {
    if (busy) return;
    setError(null);
    setDraft((current) => {
      const merged = { ...current, ...next };
      if (merged.intent === "EXIT") {
        merged.fillPolicy = "ALL_OR_NONE";
        merged.windowSeconds = AUTHORIZATION_LIFETIME_SECONDS;
      }
      if (merged.fillPolicy === "ALL_OR_NONE") merged.windowSeconds = AUTHORIZATION_LIFETIME_SECONDS;
      if (next.marketId !== undefined && next.marketId !== current.marketId) {
        merged.closePositionId = null;
        merged.fixedLimit = "";
        merged.limitMode = "TRACK";
      }
      return merged;
    });
  };

  const applyFix = (fix: CheckFix) => {
    if (fix.kind === "MARKET") patch({ marketId: fix.marketId });
    else if (fix.kind === "LOTS") patch({ lots: fix.lots });
    else if (fix.kind === "INVITATION") patch({ invitation: "QUALIFIED_SET" });
    else if (fix.kind === "DISCLOSURE") patch({ disclosure: "ANONYMOUS" });
    else if (fix.kind === "PARTIAL") patch({ fillPolicy: "PARTIAL" });
  };

  const submit = async () => {
    if (inFlight.current) return;
    if (otherBlockers.length > 0) return;
    inFlight.current = true;
    setError(null);
    try {
      if (gateway.getSnapshot().wallet.status !== "CONNECTED") {
        setPhase("CONNECTING");
        await gateway.connectWallet();
      }
      /* Re-derive against the feed at signing time so the authorization matches what is on screen now. */
      setPhase("AUTHORIZING");
      const current = gateway.getSnapshot();
      const signingOrder = deriveOrder(draft, liveMarket, current.positions, Date.now());
      const signingBlock = blockingChecks(preflight(draft, signingOrder, current, current.publicBookMarketId))[0];
      const route = signingOrder.route;
      if (signingBlock || !route) {
        setError({
          message: signingBlock ? `${signingBlock.label}. ${signingBlock.detail}` : "This market has no solver route.",
          code: `PREFLIGHT_${signingBlock?.id.toUpperCase() ?? "ROUTE"}`,
        });
        setPhase("IDLE");
        return;
      }
      const isExit = draft.intent === "EXIT";
      const authorization = await gateway.authorizeOrder({
        accountId: current.account.id,
        marketId: signingOrder.market.id,
        packageCode: signingOrder.market.code,
        routeId: route.id,
        routeLabel: route.label,
        side: draft.intent,
        packageSide: signingOrder.packageSide,
        lots: signingOrder.preview.requestedLots,
        fillLots: signingOrder.preview.fillLots,
        limitPrice: signingOrder.preview.limitPrice,
        executionPrice: signingOrder.preview.effectivePrice,
        contractMultiplier: signingOrder.market.contractMultiplier,
        orderType: signingOrder.ticket.orderType === "LIMIT" ? "LIMIT" : "MARKET",
        timeInForce: signingOrder.ticket.tif,
        expiresAt: signingOrder.ticket.expiresAt,
        feeCap: signingOrder.preview.totalFees,
        collateralRequired: isExit ? 0 : signingOrder.preview.totalCollateral,
        closePositionId: isExit ? draft.closePositionId : null,
        replacesOrderId: null,
        recipient: current.wallet.address ?? "",
        disclosure: "PRIVATE_RFQ",
        settlementGuarantee: signingOrder.preview.settlementGuarantee,
      });
      setPhase("REQUESTING");
      const request = await gateway.requestRfq(authorization);
      setPhase("OPENING");
      router.push(`/rfqs/${request.id}`);
    } catch (caught) {
      setError({ message: gatewayErrorCopy(caught), code: gatewayErrorCode(caught) });
      setPhase("IDLE");
    } finally {
      inFlight.current = false;
    }
  };

  const actionWord = action === "BUY" ? "buy" : "sell";
  const primaryLabel =
    phase === "CONNECTING"
      ? "Connecting wallet..."
      : phase === "AUTHORIZING"
        ? "Signing order authorization..."
        : phase === "REQUESTING"
          ? "Committing private request..."
          : phase === "OPENING"
            ? "Opening competition..."
            : walletBlocked && otherBlockers.length === 0
              ? "Connect wallet to request quotes"
              : `Request firm quotes to ${actionWord} ${formatLots(preview.requestedLots)} lots`;
  const primaryDisabled = busy || otherBlockers.length > 0;

  const progress: TimelineStep[] = [
    {
      id: "connect",
      label: "Wallet connected",
      state: phase === "CONNECTING" ? "active" : connected ? "done" : "pending",
    },
    {
      id: "authorize",
      label: "Order authorization signed",
      state: phase === "AUTHORIZING" ? "active" : phase === "REQUESTING" || phase === "OPENING" ? "done" : "pending",
      detail: "Package order signed, risk admission reserved and bound onchain.",
    },
    {
      id: "request",
      label: "Private request committed",
      state: phase === "REQUESTING" ? "active" : phase === "OPENING" ? "done" : "pending",
      detail: "Order registered, request signed, committed and opened for quotes.",
    },
    {
      id: "compete",
      label: "Quote competition",
      state: phase === "OPENING" ? "active" : "pending",
      detail: "Makers answer privately with firm, capacity-backed quotes.",
    },
  ];

  const orderValid = !checks.some((check) => ["route", "size", "fill", "order", "position", "qualification"].includes(check.id) && check.state === "block");
  const inviteValid = draft.invitation === "QUALIFIED_SET" && draft.disclosure === "ANONYMOUS";
  const handoffShown = handoff.present || marketParam !== null;
  const directedMakers = PARTICIPANTS.filter((participantEntry) => participantEntry.source === "MODELED");

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1 pb-24 lg:pb-1">
      <div className="flex min-h-full flex-col gap-1">
        <Panel as="div" className={motion.mount}>
          <div className="flex flex-col gap-3 px-4 pt-3.5 pb-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
                <Lock size={11} aria-hidden="true" />
                Private RFQ
              </div>
              <h1 className="mt-1 font-serif text-[26px] leading-[30px] font-normal tracking-[-0.01em] text-ink">New RFQ</h1>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">
                Ask qualified makers for firm, capacity-backed quotes on one package without showing the order on the public book.
                Quotes compete privately; you select one and it clears atomically.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <EnvironmentChip />
              <Link href="/rfqs" className={BUTTON_QUIET}>
                RFQ ledger
              </Link>
              <Link href="/rfqs/sample" className={BUTTON_QUIET}>
                See a walkthrough
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="border-t border-line px-4 py-2">
            <RfqStages
              states={{
                BUILD: orderValid ? "done" : "current",
                INVITE: orderValid ? (inviteValid ? "done" : "current") : "upcoming",
                COMPETE: "upcoming",
              }}
            />
          </div>
        </Panel>

        {handoffShown ? (
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-brand-edge/40 bg-brand-soft/30 px-3 py-2 text-xs ${motion.fade}`}>
            <CornerDownRight size={13} aria-hidden="true" className="shrink-0 text-brand" />
            <Chip tone="brand">{handoff.sourceLabel ? `Handoff / ${handoff.sourceLabel}` : "Handoff"}</Chip>
            <span className="tnum font-mono text-ink">
              {[marketParam, handoff.direction?.toLowerCase(), handoff.lots !== null ? `${handoff.lots} lots` : null, handoff.intent === "EXIT" ? "exit" : null]
                .filter(Boolean)
                .join(" / ")}
            </span>
            {handoff.blockedReason ? <span className="text-down">{handoff.blockedReason}</span> : null}
            <span className="text-[11px] text-faint lg:ml-auto">Prefilled from the link. Nothing is signed until you request quotes.</span>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-1 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col gap-1">
            <Panel className={motion.mount} label="Package">
              <PanelHeader right={<span className="tnum font-mono text-[11px] text-faint">{`${markets.length} packages`}</span>}>
                <PanelTitle>1. Package</PanelTitle>
              </PanelHeader>
              <div className="grid gap-3 px-4 py-3">
                <PackagePicker
                  markets={markets}
                  selectedId={draft.marketId}
                  onchainMarketId={onchainMarketId}
                  onSelect={(marketId) => patch({ marketId })}
                />
                <PackageSummary market={market} />
              </div>
            </Panel>

            <Panel className={motion.mount} label="Order">
              <PanelHeader right={<span className="text-[11px] text-faint">{`Tick ${market.tickSize} ${unit(market)}`}</span>}>
                <PanelTitle>2. Order</PanelTitle>
              </PanelHeader>
              <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
                <Field label="Intent">
                  <Segmented
                    label="Intent"
                    value={draft.intent}
                    onChange={(intent) => patch({ intent, closePositionId: intent === "EXIT" ? (positions[0]?.id ?? null) : null })}
                    options={[
                      { id: "ENTER", label: "Enter" },
                      {
                        id: "EXIT",
                        label: "Exit",
                        disabled: positions.length === 0 && draft.intent !== "EXIT",
                        title: positions.length === 0 ? "No active position in this market to exit" : undefined,
                      },
                    ]}
                  />
                </Field>
                {draft.intent === "EXIT" ? (
                  <Field label="Position to close" hint={positions.length === 0 ? "none active" : `${positions.length} active`}>
                    <select
                      value={draft.closePositionId ?? ""}
                      onChange={(event) => patch({ closePositionId: event.target.value || null })}
                      className="focus-ring h-8 rounded-md border border-line bg-inset px-2 text-xs text-ink"
                    >
                      <option value="">Select a position</option>
                      {positions.map((position) => (
                        <option key={position.id} value={position.id}>
                          {`${position.side === "LONG" ? "Long" : "Short"} ${position.lots} lots @ ${price(position.entryPrice, market)}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Direction" hint={`${action === "BUY" ? "You buy" : "You sell"} the package`}>
                    <Segmented
                      label="Direction"
                      value={draft.side}
                      onChange={(side) => patch({ side })}
                      options={[
                        { id: "LONG", label: <span className={draft.side === "LONG" ? "text-up" : ""}>Long, buy</span> },
                        { id: "SHORT", label: <span className={draft.side === "SHORT" ? "text-down" : ""}>Short, sell</span> },
                      ]}
                    />
                  </Field>
                )}
                <Field
                  label="Size"
                  hint={market.id === onchainMarketId ? `Runtime authorizes 1 to ${DEVNET_MAX_LOTS} lots` : `${formatUsd(market.notionalPerLot, 0)} per lot`}
                >
                  <div className="flex gap-2">
                    <Stepper
                      value={draft.lots}
                      onChange={(lots) => patch({ lots: Math.max(1, Math.round(lots)) })}
                      min={1}
                      max={1000}
                      step={1}
                      label="Lots"
                      suffix="lots"
                      disabled={draft.intent === "EXIT"}
                      className="min-w-0 flex-1"
                    />
                    {[1, 5, 10].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => patch({ lots: preset })}
                        disabled={draft.intent === "EXIT"}
                        aria-pressed={draft.lots === preset}
                        className={`focus-ring h-8 shrink-0 rounded-md border px-2.5 font-mono text-xs transition-colors disabled:opacity-40 ${
                          draft.lots === preset ? "border-line-strong bg-raised text-ink" : "border-line text-faint hover:text-dim"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Limit" hint={draft.limitMode === "TRACK" ? "Follows the solver price plus tolerance" : "Fixed worst price"}>
                  <Segmented
                    label="Limit mode"
                    value={draft.limitMode}
                    onChange={(limitMode) =>
                      patch({ limitMode, fixedLimit: limitMode === "FIXED" && !draft.fixedLimit ? order.limit.toFixed(market.priceDecimals) : draft.fixedLimit })
                    }
                    options={[
                      { id: "TRACK", label: "Track solver price" },
                      { id: "FIXED", label: "Fixed limit" },
                    ]}
                  />
                </Field>
                <div className="md:col-span-2">
                  {draft.limitMode === "TRACK" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-faint">Tolerance</span>
                      {SLIPPAGE_PRESETS_BPS.map((bps) => (
                        <button
                          key={bps}
                          type="button"
                          onClick={() => patch({ slippageBps: bps })}
                          aria-pressed={draft.slippageBps === bps}
                          className={`focus-ring h-7 rounded-md border px-2 font-mono text-[11px] transition-colors ${
                            draft.slippageBps === bps ? "border-line-strong bg-raised text-ink" : "border-line text-faint hover:text-dim"
                          }`}
                        >
                          {`${bps / 100}%`}
                        </button>
                      ))}
                      <span className="tnum ml-auto font-mono text-xs text-ink">
                        {`Limit ${price(order.limit, market)} ${unit(market)}`}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Stepper
                        value={Number.parseFloat(draft.fixedLimit) || 0}
                        onChange={(value) => patch({ fixedLimit: value.toFixed(market.priceDecimals) })}
                        min={0}
                        max={100_000}
                        step={market.tickSize}
                        decimals={market.priceDecimals}
                        label="Limit price"
                        suffix={unit(market)}
                        className="w-48"
                      />
                      <button type="button" onClick={() => patch({ fixedLimit: order.expectedPrice.toFixed(market.priceDecimals) })} className={`${BUTTON_QUIET} h-7 px-2 text-[11px]`}>
                        Solver price
                      </button>
                      <button type="button" onClick={() => patch({ fixedLimit: market.netPrice.toFixed(market.priceDecimals) })} className={`${BUTTON_QUIET} h-7 px-2 text-[11px]`}>
                        Mark
                      </button>
                    </div>
                  )}
                  <div className="tnum mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
                    <span>
                      {"Solver "}
                      <span className="text-dim">
                        <Flash value={order.expectedPrice}>{price(order.expectedPrice, market)}</Flash>
                      </span>
                    </span>
                    <span>
                      {`Touch ${action === "BUY" ? "ask" : "bid"} `}
                      <span className="text-dim">{price(action === "BUY" ? market.bestAsk : market.bestBid, market)}</span>
                    </span>
                    <span>
                      {"Mark "}
                      <span className="text-dim">
                        <Flash value={market.netPrice}>{price(market.netPrice, market)}</Flash>
                      </span>
                    </span>
                    <span className="font-sans">Preview feed</span>
                  </div>
                </div>
                <Field label="Firmness requirement" hint="Every quote must be firm and capacity-backed">
                  <Segmented
                    label="Firmness requirement"
                    value={draft.fillPolicy}
                    onChange={(fillPolicy) => patch({ fillPolicy })}
                    options={[
                      { id: "ALL_OR_NONE", label: "Full size, all or none" },
                      {
                        id: "PARTIAL",
                        label: "Partial from 1 lot",
                        disabled: draft.intent === "EXIT",
                        title: draft.intent === "EXIT" ? "Exits close the whole position at once" : undefined,
                      },
                    ]}
                  />
                </Field>
                <Field
                  label="Quote window"
                  hint={`Request closes ${draft.windowSeconds / 60} min after it is committed`}
                >
                  <Segmented
                    label="Quote window"
                    value={draft.windowSeconds}
                    onChange={(windowSeconds) => patch({ windowSeconds })}
                    options={WINDOW_OPTIONS.map((seconds) => ({
                      id: seconds,
                      label: `${seconds / 60} min`,
                      disabled: seconds < AUTHORIZATION_LIFETIME_SECONDS && draft.fillPolicy === "ALL_OR_NONE",
                      title:
                        seconds < AUTHORIZATION_LIFETIME_SECONDS && draft.fillPolicy === "ALL_OR_NONE"
                          ? "All-or-none requests use the full four-minute authorization. Shorter windows sign a GTD order, which allows partial fills."
                          : undefined,
                    }))}
                  />
                </Field>
              </div>
            </Panel>

            <Panel className={motion.mount} label="Invite and disclosure">
              <PanelHeader>
                <PanelTitle>3. Invite and disclosure</PanelTitle>
              </PanelHeader>
              <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
                <div role="radiogroup" aria-label="Maker invitation" className="grid content-start gap-1.5">
                  <span className="text-xs text-dim">Maker invitation</span>
                  <OptionCard
                    selected={draft.invitation === "QUALIFIED_SET"}
                    onSelect={() => patch({ invitation: "QUALIFIED_SET" })}
                    title="All qualified makers"
                    detail="The runtime's committed eligible-maker set. On this local devnet it holds one maker, Setryn Devnet MM."
                    badge={<Chip tone="up">Registered</Chip>}
                  />
                  <OptionCard
                    selected={draft.invitation === "DIRECTED"}
                    onSelect={() => patch({ invitation: "DIRECTED" })}
                    title="A chosen set"
                    detail="Invite only the makers you pick. Needs its own eligible-maker commitment."
                    badge={<Chip tone="muted">Not registered</Chip>}
                  />
                  {draft.invitation === "DIRECTED" ? (
                    <div className={`mt-1 rounded-md border border-line ${motion.fade}`}>
                      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5">
                        <span className="text-[11px] text-faint">{`${draft.directed.length} selected`}</span>
                        <ProvenanceChip value="MODELED" title="Maker roster modeled from the market fixtures; not a registered maker set." />
                      </div>
                      <ul className="scroll-thin max-h-44 overflow-y-auto">
                        {directedMakers.map((maker) => {
                          const checked = draft.directed.includes(maker.id);
                          return (
                            <li key={maker.id}>
                              <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-raised/40">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    patch({
                                      directed: checked ? draft.directed.filter((id) => id !== maker.id) : [...draft.directed, maker.id],
                                    })
                                  }
                                  className="accent-[var(--color-brand)]"
                                />
                                <span className="min-w-0 flex-1 truncate text-ink">{maker.label}</span>
                                <span className="shrink-0 text-[10px] text-faint">{maker.kind === "SOLVER" ? "Solver" : "Maker"}</span>
                                {maker.qualification === "CONDITIONAL" ? <span className="shrink-0 text-[10px] text-brand">Conditional</span> : null}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="grid content-start gap-1.5">
                  <div role="radiogroup" aria-label="Disclosure" className="grid gap-1.5">
                    <span className="text-xs text-dim">Disclosure to makers</span>
                    <OptionCard
                      selected={draft.disclosure === "ANONYMOUS"}
                      onSelect={() => patch({ disclosure: "ANONYMOUS" })}
                      title="Anonymous"
                      detail="Blind qualified policy. Makers see the package, side, size, fee cap and deadline, not who is asking."
                      badge={<Chip tone="up">Registered</Chip>}
                    />
                    <OptionCard
                      selected={draft.disclosure === "NAMED"}
                      onSelect={() => patch({ disclosure: "NAMED" })}
                      title="Named"
                      detail="Disclose your account to invited makers for relationship pricing."
                      badge={<Chip tone="muted">Not registered</Chip>}
                    />
                  </div>
                  <div className="mt-1 rounded-md border border-line bg-inset px-3 py-2 text-[11px] leading-snug text-faint">
                    <span className="flex items-center gap-1.5 text-dim">
                      <ShieldCheck size={12} aria-hidden="true" />
                      What becomes public
                    </span>
                    <span className="mt-1 block">
                      The signed order, including its limit, registers in OrderState and the request commits to PrivateRfqBook. Local devnet
                      state is readable by anyone with node access. Fills show on the public tape without request contents.
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <aside className="flex min-w-0 flex-col gap-1">
            <Panel className={motion.mount} label="Request">
              <PanelHeader
                right={
                  <span className={`tnum font-mono text-[11px] ${blockers.length > 0 ? "text-down" : "text-up"}`}>
                    {blockers.length > 0 ? `${blockers.length} blocking` : "Ready to request"}
                  </span>
                }
              >
                <PanelTitle>Pre-flight</PanelTitle>
              </PanelHeader>
              <div className="hidden space-y-2 border-b border-line px-4 py-3 lg:block">
                <div className="tnum flex items-baseline justify-between gap-3 font-mono text-xs">
                  <span className={action === "BUY" ? "text-up" : "text-down"}>
                    {`${action === "BUY" ? "Buy" : "Sell"} ${formatLots(preview.requestedLots)} ${market.code}`}
                  </span>
                  <span className="text-ink">{order.limit > 0 ? `limit ${price(order.limit, market)} ${unit(market)}` : "no limit"}</span>
                </div>
                <div className="tnum flex items-baseline justify-between gap-3 font-mono text-[11px] text-faint">
                  <span>{`fee cap ${formatUsd(preview.totalFees, 2)}`}</span>
                  <span>{`reserve ${formatUsd((draft.intent === "EXIT" ? 0 : preview.totalCollateral) + preview.totalFees, 2)}`}</span>
                </div>
                <PrimaryAction
                  label={primaryLabel}
                  disabled={primaryDisabled}
                  ink={walletBlocked && otherBlockers.length === 0 && !busy}
                  onClick={() => void submit()}
                />
                <ActionNotes
                  busy={busy}
                  progress={progress}
                  error={error}
                  blockers={otherBlockers}
                  market={market}
                  tradeLink={`${tradeHref(market)}?${new URLSearchParams({ source: "rfqs", direction: draft.side.toLowerCase(), lots: String(draft.lots) }).toString()}`}
                />
              </div>
              <div className="px-4 py-1">
                <Checklist checks={checks} onFix={applyFix} />
              </div>
            </Panel>

            <Economics order={order} draft={draft} available={snapshot.account.available} connected={connected} />
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-panel/95 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur lg:hidden">
        <div className="tnum mb-1.5 flex items-center justify-between gap-2 font-mono text-[11px] text-faint">
          <span className="truncate">{`${action === "BUY" ? "Buy" : "Sell"} ${formatLots(preview.requestedLots)} ${market.code}`}</span>
          <span>{`limit ${price(order.limit, market)} · fee cap ${formatUsd(preview.totalFees, 0)}`}</span>
        </div>
        <PrimaryAction
          label={primaryLabel}
          disabled={primaryDisabled}
          ink={walletBlocked && otherBlockers.length === 0 && !busy}
          onClick={() => void submit()}
        />
        {error ? <p className="mt-1.5 text-[11px] text-down">{error.message}</p> : otherBlockers.length > 0 ? (
          <p className="mt-1.5 truncate text-[11px] text-faint">{`${otherBlockers.length} pre-flight check${otherBlockers.length === 1 ? "" : "s"} blocking: ${otherBlockers[0].label}`}</p>
        ) : null}
      </div>
    </main>
  );
}

function PrimaryAction({ label, disabled, ink, onClick }: { label: string; disabled: boolean; ink: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${disabled ? BUTTON_QUIET : ink ? BUTTON_INK : BUTTON_PRIMARY} h-10 w-full text-[13px]`}
    >
      {label}
    </button>
  );
}

function ActionNotes({
  busy,
  progress,
  error,
  blockers,
  market,
  tradeLink,
}: {
  busy: boolean;
  progress: TimelineStep[];
  error: { message: string; code: string } | null;
  blockers: PreflightCheck[];
  market: PackageMarket;
  tradeLink: string;
}) {
  return (
    <>
      {busy ? <StepTimeline steps={progress} dense className="pt-1" /> : null}
      {error ? (
        <div className="rounded-md border border-down/30 bg-down-soft px-3 py-2 text-xs text-down" role="alert">
          <p>{error.message}</p>
          <details className="mt-1 text-[11px] text-faint">
            <summary className="cursor-pointer select-none hover:text-dim">Diagnostic</summary>
            <p className="tnum mt-1 font-mono break-all">{error.code}</p>
          </details>
        </div>
      ) : null}
      {!busy && blockers.length > 0 ? (
        <p className="text-[11px] leading-snug text-faint">{`Resolve ${blockers.length} blocking check${blockers.length === 1 ? "" : "s"} above to request quotes.`}</p>
      ) : null}
      {!busy ? (
        <p className="text-[11px] leading-snug text-faint">
          {"Your wallet signs the order authorization, then the private request. Nothing is claimed at signature; the competition opens once the request is committed. Prefer the full ticket? "}
          <Link href={tradeLink} className="text-dim underline decoration-line-strong underline-offset-2 hover:text-ink">
            {`Open ${market.code} in the terminal`}
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
