import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import type { ExecutionPosition, GatewaySnapshot, OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot } from "@/lib/market-data/types";
import { runtimeMarket, seriesSchedule } from "@/lib/operations/deployment";
import { SCHEDULE_SOURCE_LABEL } from "@/lib/settlements/calendar";
import { collateralPerLot, deltaPerLot, liveQuote, longResultPerLot, rangeTerms, type LiveQuote, type RangeTerms } from "@/lib/strategies/range";
import { formatNumber } from "@/lib/terminal/format";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import type {
  LifecycleBoundary,
  LifecycleConstraint,
  LifecycleHealth,
  LifecycleLeg,
  LifecycleProposal,
  LifecycleStrategy,
} from "./types";

export interface LifecycleInput {
  snapshot: GatewaySnapshot;
  markets: readonly PackageMarket[];
  feed: MarketDataSnapshot | null;
  runtime: SetrynRuntime | null;
  /** Platform clock, unix seconds. */
  now: number;
}

const CLOSED_PHASES = new Set(["SETTLED", "LAPSED", "CLOSED"]);

function usdc(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value < 0 ? "-" : ""}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2 })} USDC`;
}

function signedUsdc(value: number): string {
  return `${value > 0 ? "+" : ""}${usdc(value)}`;
}

function seconds(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function receiptFor(snapshot: GatewaySnapshot, position: ExecutionPosition): string | null {
  const opening = snapshot.executions.find((execution) => execution.result.position?.id === position.id)?.result.receipt;
  if (opening) return opening.id;
  const match = snapshot.receipts.find(
    (receipt) => receipt.marketId === position.marketId && receipt.price === position.entryPrice && receipt.packageSide === position.side,
  );
  return match?.id ?? null;
}

function boundaryState(open: number, close: number | null, now: number): LifecycleBoundary["state"] {
  if (now < open) return "UPCOMING";
  if (close !== null && now < close) return "WINDOW_OPEN";
  return "PASSED";
}

/** The position's terminal schedule: the chain's own when the lifecycle has been read, else the runtime's series schedule. */
function boundaries(
  position: ExecutionPosition,
  market: PackageMarket,
  lifecycle: OnchainPositionLifecycle | null,
  runtime: SetrynRuntime | null,
  now: number,
): LifecycleBoundary[] {
  const out: LifecycleBoundary[] = [];
  const add = (kind: LifecycleBoundary["kind"], label: string, open: number | null, close: number | null, source: string) => {
    if (open === null) return;
    out.push({ id: `${position.id}-${kind}`, kind, label, at: open, state: boundaryState(open, close, now), source });
  };
  if (lifecycle) {
    const schedule = lifecycle.schedule;
    const source = "Series terms onchain";
    add("TRADING", "Last trading", seconds(schedule.lastTradingAt), null, source);
    add("FIXING", "Fixing window", seconds(schedule.fixingWindowOpen), seconds(schedule.fixingWindowClose), source);
    add("ELECTION", "Holder election", seconds(schedule.exerciseOpensAt), seconds(schedule.exerciseCutoffAt), source);
    add("CORRECTION", "Corrections close", seconds(schedule.correctionCutoffAt), null, source);
    add("RESOLUTION", "Final resolution", seconds(schedule.finalResolutionAt), null, source);
    add("SETTLEMENT", "Settlement deadline", seconds(schedule.settlementDeadline), null, source);
    return out;
  }
  const schedule = seriesSchedule(market, runtimeMarket(runtime, market.id));
  const source = SCHEDULE_SOURCE_LABEL[schedule.source];
  add("TRADING", "Last trading", schedule.lastTradingAt ?? null, null, source);
  add("FIXING", "Fixing window", schedule.fixingWindowOpen ?? null, schedule.fixingWindowClose ?? schedule.expiryAt ?? null, source);
  add("ELECTION", "Holder election", schedule.exerciseOpensAt ?? null, schedule.exerciseCutoffAt ?? null, source);
  add("RESOLUTION", "Final resolution", schedule.finalResolutionAt ?? null, null, source);
  add("SETTLEMENT", "Settlement deadline", schedule.settlementDeadline ?? null, null, source);
  return out.sort((left, right) => left.at - right.at);
}

function legsFor(market: PackageMarket, quote: LiveQuote): LifecycleLeg[] {
  return market.legs.map((leg) => {
    const forward = leg.family === "FORWARD";
    const mark = forward ? quote.mark : (quote.reference?.price ?? null);
    return {
      id: leg.id,
      instrument: leg.instrument,
      role: forward ? "The contract you hold" : "Reference for strategy views",
      side: leg.side,
      ratio: leg.ratio,
      mark,
      markLabel: mark === null ? "No reading" : formatNumber(mark, forward ? market.priceDecimals : Math.max(2, market.priceDecimals)),
      source: forward ? (quote.markSource === "MID" ? "Public book mid" : quote.markSource === "LAST" ? "Last onchain fill" : quote.markSource === "REFERENCE" ? "Reference, no book or fills" : "No mark") : "Chainlink aggregator",
      provenance: forward ? (quote.markSource === "MID" || quote.markSource === "LAST" ? "EXECUTABLE" : "REFERENCE") : "OBSERVED",
      dependency: forward
        ? "Settles in cash at the expiry fixing; exits close the whole position on the public book or by private request."
        : "Not held and not settled. It prices the carry, basis and forward-point views only.",
    };
  });
}

function sideSign(side: "LONG" | "SHORT"): number {
  return side === "LONG" ? 1 : -1;
}

function proposalsFor(
  position: ExecutionPosition,
  market: PackageMarket,
  terms: RangeTerms | null,
  quote: LiveQuote,
  markets: readonly PackageMarket[],
  feed: MarketDataSnapshot | null,
  tradingOpen: boolean,
  lastTradingLabel: string,
): LifecycleProposal[] {
  const lotSize = terms?.lotSize ?? market.contractMultiplier;
  const exitTouch = position.side === "LONG" ? quote.bid : quote.ask;
  const seriesOk = quote.seriesStatus === "ACTIVE" || quote.seriesStatus === "UNKNOWN";
  const common: LifecycleConstraint[] = [
    {
      label: "Trading open",
      state: tradingOpen ? "SATISFIED" : "BLOCKED",
      detail: tradingOpen ? `Orders match until ${lastTradingLabel}.` : "Trading has closed; the position completes at the fixing.",
    },
    {
      label: "Series active",
      state: seriesOk ? "SATISFIED" : "BLOCKED",
      detail: seriesOk ? "The series registry admits new orders." : `The series is ${quote.seriesStatus.toLowerCase()}; terminal completion stays available.`,
    },
  ];
  const sign = sideSign(position.side);
  const proposals: LifecycleProposal[] = [];

  const exitResult = exitTouch !== null ? sign * position.lots * lotSize * (exitTouch - position.entryPrice) : null;
  proposals.push({
    id: `${position.id}-exit`,
    kind: "EXIT",
    label: `Exit all ${position.lots} lots`,
    actionLabel: "Open exit in trade",
    targetMarketId: market.id,
    direction: position.side,
    intent: "EXIT",
    requestedLots: position.lots,
    summary: "Closes the whole position against the opposite side of the book. The exit is all-or-none, so it fills in full or not at all.",
    quoteRequirement:
      exitTouch !== null
        ? `The best ${position.side === "LONG" ? "bid" : "offer"} is ${formatNumber(exitTouch, market.priceDecimals)}; the terminal re-prices at signing.`
        : `No ${position.side === "LONG" ? "bid" : "offer"} rests on the book; an exit needs a counterparty or a private request.`,
    impacts: [
      { label: "Lots", before: String(position.lots), after: "0", tone: "up" },
      { label: "Collateral", before: usdc(position.collateral), after: "Released", tone: "up" },
      {
        label: "Result at touch",
        before: exitTouch !== null ? formatNumber(exitTouch, market.priceDecimals) : "No touch",
        after: exitResult !== null ? signedUsdc(exitResult) : "-",
        tone: exitResult === null ? "default" : exitResult >= 0 ? "up" : "down",
      },
      { label: "Exposure", before: `${position.side.toLowerCase()} ${position.lots} lots`, after: "Flat" },
    ],
    constraints: [
      ...common,
      {
        label: `Opposite ${position.side === "LONG" ? "bid" : "offer"}`,
        state: exitTouch !== null ? "SATISFIED" : "REQUIRES_QUOTE",
        detail: exitTouch !== null ? "A resting order can take the exit." : "Nothing rests on that side right now.",
      },
      { label: "Full-size exit", state: "SATISFIED", detail: "Exits close the whole position in one fill-or-kill order." },
    ],
  });

  const offsetTouch = position.side === "LONG" ? quote.bid : quote.ask;
  const offsetDirection = position.side === "LONG" ? "SHORT" : "LONG";
  const offsetCollateral = terms && offsetTouch !== null ? position.lots * collateralPerLot(terms, offsetTouch, offsetDirection) : null;
  proposals.push({
    id: `${position.id}-offset`,
    kind: "OFFSET",
    label: `Offset with ${position.lots} ${offsetDirection.toLowerCase()} lots`,
    actionLabel: "Open offset in trade",
    targetMarketId: market.id,
    direction: offsetDirection,
    intent: "ENTER",
    requestedLots: position.lots,
    summary:
      "Opens an opposite position of the same size. The two net to a fixed result at the fixing; both stay open and collateralized until settlement.",
    quoteRequirement:
      offsetTouch !== null
        ? `Locks the result at the ${position.side === "LONG" ? "bid" : "offer"} ${formatNumber(offsetTouch, market.priceDecimals)} before fees.`
        : "No opposite order rests on the book right now.",
    impacts: [
      { label: "Net lots", before: `${sign > 0 ? "+" : "-"}${position.lots}`, after: "0", tone: "up" },
      { label: "Locked result", before: "Open", after: exitResult !== null ? signedUsdc(exitResult) : "-", tone: exitResult === null ? "default" : exitResult >= 0 ? "up" : "down" },
      { label: "Added collateral", before: usdc(position.collateral), after: offsetCollateral !== null ? `+${usdc(offsetCollateral)}` : "-", tone: "brand" },
      { label: "Settles", before: "At fixing", after: "At fixing" },
    ],
    constraints: [
      ...common,
      {
        label: "Opposite touch",
        state: offsetTouch !== null ? "SATISFIED" : "REQUIRES_QUOTE",
        detail: offsetTouch !== null ? "A resting order can take the offset." : "Nothing rests on that side right now.",
      },
    ],
  });

  const later = markets
    .filter((candidate) => candidate.underlying === market.underlying && candidate.expiryAt > market.expiryAt)
    .sort((left, right) => left.expiryAt - right.expiryAt)[0];
  if (later) {
    const target = liveQuote(feed, later);
    const targetTerms = rangeTerms(later);
    const entryLevel = position.side === "LONG" ? target.ask : target.bid;
    const rollCost = exitTouch !== null && entryLevel !== null ? sign * position.lots * lotSize * (entryLevel - exitTouch) : null;
    const targetCollateral = targetTerms && entryLevel !== null ? position.lots * collateralPerLot(targetTerms, entryLevel, position.side) : null;
    const targetOk = target.seriesStatus === "ACTIVE" || target.seriesStatus === "UNKNOWN";
    proposals.push({
      id: `${position.id}-roll`,
      kind: "ROLL",
      label: `Roll to ${later.id}`,
      actionLabel: `Open ${later.id} in trade`,
      targetMarketId: later.id,
      direction: position.side,
      intent: "ENTER",
      requestedLots: position.lots,
      summary: `Exit this series and enter ${packageLabel(later)} for the same lots. Two orders, each signed separately; nothing is atomic across them.`,
      quoteRequirement:
        entryLevel !== null
          ? `${later.id} ${position.side === "LONG" ? "offer" : "bid"} ${formatNumber(entryLevel, later.priceDecimals)}; exit this series first from the Exit action.`
          : `No ${position.side === "LONG" ? "offer" : "bid"} rests on ${later.id} yet.`,
      impacts: [
        { label: "Expiry", before: market.expiryIso, after: later.expiryIso, tone: "brand" },
        {
          label: "Forward level",
          before: exitTouch !== null ? formatNumber(exitTouch, market.priceDecimals) : "No touch",
          after: entryLevel !== null ? formatNumber(entryLevel, later.priceDecimals) : "No touch",
        },
        { label: "Roll spread", before: "-", after: rollCost !== null ? signedUsdc(-rollCost) : "-", tone: rollCost === null ? "default" : rollCost <= 0 ? "up" : "down" },
        { label: "Collateral", before: usdc(position.collateral), after: targetCollateral !== null ? usdc(targetCollateral) : "-" },
      ],
      constraints: [
        ...common,
        {
          label: `${later.id} open`,
          state: targetOk ? (entryLevel !== null ? "SATISFIED" : "REQUIRES_QUOTE") : "BLOCKED",
          detail: !targetOk
            ? `${later.id} is ${target.seriesStatus.toLowerCase()}.`
            : entryLevel !== null
              ? "The later series has resting liquidity on the entry side."
              : "No resting liquidity on the entry side of the later series.",
        },
        { label: "Two separate orders", state: "REQUIRES_QUOTE", detail: "The exit and the new entry fill independently; size and price can differ between them." },
      ],
    });
  }
  return proposals;
}

function healthFor(
  lifecycle: OnchainPositionLifecycle | null,
  quote: LiveQuote,
  lastTrading: number | null,
  now: number,
): { health: LifecycleHealth; detail: string } {
  if (lifecycle && CLOSED_PHASES.has(lifecycle.phase)) {
    return { health: "CLOSED", detail: "The position reached its terminal outcome; nothing more is due." };
  }
  if (lifecycle && (lifecycle.phase === "FIXED_AWAITING_ELECTION" || lifecycle.phase === "CLAIM_AVAILABLE" || lifecycle.phase === "EXERCISED")) {
    return { health: "ATTENTION", detail: "A terminal action is open for this position. The lifecycle panel names it and why." };
  }
  if (lifecycle?.phase === "AWAITING_FIXING") {
    return { health: "WINDOW_OPEN", detail: "The fixing window is open or passed and the final fixing is not on the position yet." };
  }
  if (quote.seriesStatus === "PAUSED") {
    return { health: "ATTENTION", detail: "The series is paused: no new orders match. Terminal completion stays permissionless." };
  }
  if (lastTrading !== null && lastTrading - now <= 86_400) {
    return {
      health: "WINDOW_OPEN",
      detail: lastTrading > now ? "Trading closes within a day. Exit, offset or roll before then, or hold to the fixing." : "Trading has closed; the position completes at the fixing.",
    };
  }
  return { health: "HEALTHY", detail: "Fully collateralized: the most this side can lose is reserved, so there is no liquidation." };
}

/** One lifecycle entry per position the account holds, then every position it held that the chain still reports. */
export function lifecycleStrategies(input: LifecycleInput): LifecycleStrategy[] {
  const { snapshot, markets, feed, runtime, now } = input;
  const byId = new Map(markets.map((market) => [market.id, market]));
  const held = new Set(snapshot.positions.map((position) => position.id.toLowerCase()));
  const closed: ExecutionPosition[] = Object.values(snapshot.lifecycles)
    .filter((view) => !held.has(view.positionId.toLowerCase()))
    .map((view) => ({
      id: view.positionId,
      marketId: view.marketId,
      side: view.side,
      lots: view.lots,
      entryPrice: view.entryPrice,
      collateral: view.collateralReservedUsd,
      state: "ACTIVE",
      createdAt: new Date(view.observedAtSeconds * 1000).toISOString(),
    }));

  const out: LifecycleStrategy[] = [];
  for (const position of [...snapshot.positions, ...closed]) {
    const market = byId.get(position.marketId);
    if (!market) continue;
    const lifecycle = snapshot.lifecycles[position.id.toLowerCase()] ?? null;
    const terms = rangeTerms(market, runtimeMarket(runtime, market.id));
    const quote = liveQuote(feed, market);
    const sign = sideSign(position.side);
    const lotSize = terms?.lotSize ?? market.contractMultiplier;
    const reference = quote.reference?.price ?? null;
    const markPnl = quote.mark !== null ? sign * position.lots * lotSize * (quote.mark - position.entryPrice) : null;
    const resultAt = (fixing: number | null) => (terms && fixing !== null ? sign * position.lots * longResultPerLot(terms, fixing, position.entryPrice) : null);
    const schedule = boundaries(position, market, lifecycle, runtime, now);
    const lastTrading = schedule.find((boundary) => boundary.kind === "TRADING")?.at ?? null;
    const tradingOpen = lastTrading === null || now < lastTrading;
    const { health, detail } = healthFor(lifecycle, quote, lastTrading, now);
    out.push({
      id: position.id,
      position,
      market,
      terms,
      label: `${packageLabel(market)} ${position.id.slice(-4).toUpperCase()}`,
      side: position.side,
      lots: position.lots,
      entryPrice: position.entryPrice,
      mark: quote.mark,
      markSource: quote.markSource,
      seriesStatus: quote.seriesStatus,
      reference,
      markPnl,
      pnlAtReference: resultAt(reference),
      pnlAtCap: terms ? resultAt(terms.cap) : null,
      pnlAtFloor: terms ? resultAt(terms.floor) : null,
      delta: terms && reference !== null ? sign * position.lots * deltaPerLot(terms, reference) : null,
      collateral: lifecycle ? lifecycle.collateralReservedUsd : position.collateral,
      receiptId: receiptFor(snapshot, position),
      createdAt: position.createdAt,
      lifecycle,
      health,
      healthDetail: detail,
      boundaries: schedule,
      legs: legsFor(market, quote),
      proposals:
        health === "CLOSED"
          ? []
          : proposalsFor(
              position,
              market,
              terms,
              quote,
              markets,
              feed,
              tradingOpen,
              lastTrading !== null ? `${new Date(lastTrading * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "expiry",
            ),
    });
  }
  return out;
}

/** The trade terminal with the proposal's market, direction and lots prefilled. */
export function proposalHref(strategy: LifecycleStrategy, proposal: LifecycleProposal, markets: readonly PackageMarket[]): string {
  const market = markets.find((candidate) => candidate.id === proposal.targetMarketId) ?? strategy.market;
  const params = new URLSearchParams({
    source: "lifecycle",
    lifecycle: strategy.id,
    intent: proposal.intent === "EXIT" ? "exit" : proposal.kind.toLowerCase(),
    direction: proposal.direction.toLowerCase(),
    lots: String(proposal.requestedLots),
  });
  return `${tradeHref(market)}?${params.toString()}`;
}
