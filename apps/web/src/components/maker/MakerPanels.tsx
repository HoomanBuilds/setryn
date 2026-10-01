"use client";

import { useState } from "react";
import { ShieldAlert, SlidersHorizontal } from "lucide-react";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Chip, LiveDot, Meter, Panel, PanelHead, RangeField, Row, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import { useChainNow } from "@/components/market-data/MarketDataProvider";
import type { GatewayAccount, OnchainMarket, WalletStatus } from "@/lib/internal-gateway/types";
import type { MarketFeedStatus } from "@/lib/market-data/types";
import { onTick } from "@/lib/maker/model";
import type { MakerMarket, QuoteDraft, WorkingQuote } from "@/lib/maker/types";
import type { OperatorStatus, Resource } from "@/lib/operations/deployment";
import { MARK_SOURCE_LABEL, collateralPerLot, considerationPerLot, deltaPerLot } from "@/lib/strategies/range";
import { formatLots, formatNumber, formatUtcStamp } from "@/lib/terminal/format";
import { signedNumber, signedUsd, usd, usdCompact } from "./format";

const INPUT =
  "focus-ring tnum h-8 w-full rounded-md border border-line bg-panel px-2 font-mono text-xs text-ink transition-colors hover:border-line-strong disabled:opacity-50";

/* ------------------------------------------------------------------ */
/* Quote composer                                                      */
/* ------------------------------------------------------------------ */

export function QuoteComposer({
  entry,
  fees,
  connected,
  working,
  onSubmit,
}: {
  entry: MakerMarket;
  fees: OnchainMarket | null;
  connected: boolean;
  working: boolean;
  onSubmit: (draft: QuoteDraft) => void;
}) {
  const { market, quote, terms } = entry;
  const decimals = market.priceDecimals;
  const tick = market.tickSize > 0 ? market.tickSize : 10 ** -decimals;
  const maxLots = fees?.maxOrderLots ?? market.maxOrderLots ?? 1;
  const [spreadTicks, setSpreadTicks] = useState(4);
  const [skewTicks, setSkewTicks] = useState(0);
  const [lotsInput, setLotsInput] = useState("1");
  const [bidOn, setBidOn] = useState(true);
  const [askOn, setAskOn] = useState(true);
  const [bidInput, setBidInput] = useState<string | null>(null);
  const [askInput, setAskInput] = useState<string | null>(null);

  const center = quote.mark;
  const modelBid = center !== null ? onTick(center - (spreadTicks / 2) * tick + skewTicks * tick, market) : null;
  const modelAsk = center !== null ? onTick(center + (spreadTicks / 2) * tick + skewTicks * tick, market) : null;
  const parsed = (input: string | null, fallback: number | null) => {
    if (input === null) return fallback;
    const value = Number(input);
    return input.trim() !== "" && Number.isFinite(value) ? value : null;
  };
  const bid = bidOn ? parsed(bidInput, modelBid) : null;
  const ask = askOn ? parsed(askInput, modelAsk) : null;
  const lots = Number(lotsInput);

  const blockers: string[] = [];
  if (!Number.isInteger(lots) || lots < 1 || lots > maxLots) blockers.push(`Lots must be a whole number from 1 to ${maxLots}.`);
  if (!bidOn && !askOn) blockers.push("Choose at least one side.");
  if (bidOn && bid === null) blockers.push(center === null ? "No mark yet: enter a bid price." : "Enter a valid bid price.");
  if (askOn && ask === null) blockers.push(center === null ? "No mark yet: enter an ask price." : "Enter a valid ask price.");
  if (bid !== null && ask !== null && bid >= ask) blockers.push("The bid must be below the ask.");
  if (terms) {
    for (const [label, price] of [["Bid", bid], ["Ask", ask]] as const) {
      if (price !== null && (price <= terms.floor || price >= terms.cap)) {
        blockers.push(`${label} must sit inside the range ${formatNumber(terms.floor, decimals)} to ${formatNumber(terms.cap, decimals)}.`);
      }
    }
  }
  if (quote.seriesStatus !== "ACTIVE" && quote.seriesStatus !== "UNKNOWN") blockers.push(`The series is ${quote.seriesStatus.toLowerCase()}.`);
  if (fees && !fees.tradable) blockers.push("The market is moving to a new fee schedule; nothing can clear right now.");
  const crossesBid = ask !== null && quote.bid !== null && ask <= quote.bid;
  const crossesAsk = bid !== null && quote.ask !== null && bid >= quote.ask;

  const makerBps = fees?.makerFeeBps ?? null;
  const consideration = (price: number | null) => (price === null ? 0 : terms ? considerationPerLot(terms, price) : price * market.contractMultiplier);
  const notional = Number.isFinite(lots) && lots > 0 ? lots * (consideration(bid) + consideration(ask)) : 0;
  const makerFee = makerBps !== null ? (notional * makerBps) / 10_000 + (fees?.makerFlatFeeUsd ?? 0) * ((bid !== null ? 1 : 0) + (ask !== null ? 1 : 0)) : null;
  const longCollateral = bid !== null && terms ? lots * collateralPerLot(terms, bid, "LONG") : null;
  const shortCollateral = ask !== null && terms ? lots * collateralPerLot(terms, ask, "SHORT") : null;

  const reset = () => {
    setBidInput(null);
    setAskInput(null);
  };

  return (
    <Panel label="Quote composer" delay={60}>
      <PanelHead
        title="Quote composer"
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">Post-only, signed by your wallet</span>
            <SlidersHorizontal size={14} className="text-faint" aria-hidden="true" />
          </>
        }
      />
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-inset px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] text-faint">Centre</p>
            <p className="tnum mt-0.5 font-mono text-[13px] text-ink">
              {center !== null ? formatNumber(center, decimals) : "No mark"}
              <span className="ml-1.5 font-sans text-[11px] text-faint">{MARK_SOURCE_LABEL[quote.markSource].toLowerCase()}</span>
            </p>
          </div>
          {bidInput !== null || askInput !== null ? (
            <button type="button" onClick={reset} className="focus-ring h-7 rounded-md border border-line px-2 text-[11px] text-dim hover:text-ink">
              Reset to centre
            </button>
          ) : null}
        </div>

        <RangeField
          label="Width"
          value={spreadTicks}
          min={1}
          max={60}
          step={1}
          onChange={(next) => {
            setSpreadTicks(next);
            reset();
          }}
          ariaLabel="Quote width in ticks"
          readout={`${spreadTicks} ticks / ${formatNumber(spreadTicks * tick, decimals)}`}
          minLabel="1 tick"
          maxLabel="60 ticks"
          disabled={center === null}
        />
        <RangeField
          label="Skew"
          value={skewTicks}
          min={-30}
          max={30}
          step={1}
          origin={0}
          onChange={(next) => {
            setSkewTicks(next);
            reset();
          }}
          ariaLabel="Quote skew in ticks"
          readout={`${signedNumber(skewTicks)} ticks`}
          minLabel="Lean to sell"
          maxLabel="Lean to buy"
          disabled={center === null}
        />

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
          <label className="flex items-center gap-1.5 text-xs text-up">
            <input type="checkbox" checked={bidOn} onChange={(event) => setBidOn(event.target.checked)} className="accent-current" />
            Bid
          </label>
          <input
            value={bidInput ?? (modelBid !== null ? String(modelBid) : "")}
            onChange={(event) => setBidInput(event.target.value)}
            inputMode="decimal"
            disabled={!bidOn}
            className={INPUT}
            aria-label="Bid price"
            placeholder="Price"
          />
          <label className="flex items-center gap-1.5 text-xs text-down">
            <input type="checkbox" checked={askOn} onChange={(event) => setAskOn(event.target.checked)} className="accent-current" />
            Ask
          </label>
          <input
            value={askInput ?? (modelAsk !== null ? String(modelAsk) : "")}
            onChange={(event) => setAskInput(event.target.value)}
            inputMode="decimal"
            disabled={!askOn}
            className={INPUT}
            aria-label="Ask price"
            placeholder="Price"
          />
          <span className="text-xs text-dim">Lots</span>
          <input value={lotsInput} onChange={(event) => setLotsInput(event.target.value)} inputMode="numeric" className={INPUT} aria-label="Lots per side" />
        </div>

        <div className="divide-y divide-line-soft border-y border-line-soft">
          <Row label="Consideration bound" value={notional > 0 ? usd(notional) : "-"} tone="dim" />
          <Row label={`Maker fee${makerBps !== null ? ` at ${formatNumber(makerBps, 2)} bp` : ""}`} value={makerFee !== null ? usd(makerFee) : "-"} tone="dim" />
          <Row label="Collateral if bid fills" value={longCollateral !== null ? usd(longCollateral) : "-"} tone="dim" />
          <Row label="Collateral if ask fills" value={shortCollateral !== null ? usd(shortCollateral) : "-"} tone="dim" />
        </div>

        {crossesBid || crossesAsk ? (
          <p className="text-[11px] leading-snug text-brand">
            {`The ${crossesAsk ? "bid" : "ask"} reaches the opposite touch, so the post-only order would be refused.`}
          </p>
        ) : null}
        {blockers.length > 0 ? <p className="text-[11px] leading-snug text-down">{blockers[0]}</p> : null}

        <button
          type="button"
          onClick={() => onSubmit({ bid, ask, lots })}
          disabled={working || (connected && blockers.length > 0)}
          className="focus-ring flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-brand px-3 text-xs font-semibold text-app transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {working ? "Working" : !connected ? "Connect wallet to quote" : bidOn && askOn ? "Sign and post both sides" : "Sign and post"}
        </button>
        <p className="text-[11px] leading-snug text-faint">
          Each side is a post-only order on the public book with a short signed deadline; re-post to keep quoting.
          Collateral is reserved when a quote fills.
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Market terms                                                        */
/* ------------------------------------------------------------------ */

export function MarketTerms({
  entry,
  fees,
  expiryAt,
}: {
  entry: MakerMarket;
  fees: OnchainMarket | null;
  expiryAt: number | null;
}) {
  const { market, quote, terms } = entry;
  const decimals = market.priceDecimals;
  const level = quote.mark ?? quote.reference?.price ?? null;
  return (
    <Panel label="Market terms" delay={100}>
      <PanelHead
        title="Market terms"
        tools={
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <MarketMark underlying={market.underlying} size={13} />
            {market.id}
          </span>
        }
      />
      <div className="divide-y divide-line-soft px-3 py-1">
        <Row label="Range" value={terms ? `${formatNumber(terms.floor, decimals)} to ${formatNumber(terms.cap, decimals)}` : "Not published"} />
        <Row label="Lot" value={terms ? `${formatNumber(terms.lotSize, terms.lotSize < 1 ? 4 : 0)} ${market.underlying.split("/")[0]}` : "-"} />
        <Row label="Tick" value={formatNumber(market.tickSize, decimals)} />
        <Row label="Max order" value={`${fees?.maxOrderLots ?? market.maxOrderLots ?? "-"} lots`} />
        <Row label="Delta per lot at reference" value={terms && quote.reference ? `${formatNumber(deltaPerLot(terms, quote.reference.price), 4)} ${market.underlying.split("/")[0]}` : "-"} tone="dim" />
        <Row label="Long collateral per lot" value={terms && level !== null ? usd(collateralPerLot(terms, level, "LONG")) : fees ? usd(fees.longCollateralPerLot) : "-"} tone="dim" />
        <Row label="Short collateral per lot" value={terms && level !== null ? usd(collateralPerLot(terms, level, "SHORT")) : fees ? usd(fees.shortCollateralPerLot) : "-"} tone="dim" />
        <Row label="Maker / taker fee" value={fees ? `${formatNumber(fees.makerFeeBps, 2)} / ${formatNumber(fees.takerFeeBps, 2)} bp` : "-"} />
        <Row label="Open interest" value={quote.openInterestLots !== null ? `${formatLots(quote.openInterestLots)} lots` : "-"} tone="dim" />
        <Row label="24h volume" value={`${formatLots(quote.volume24hLots)} lots`} tone="dim" />
        <Row
          label="Series"
          value={quote.seriesStatus === "UNKNOWN" ? "Not read" : quote.seriesStatus.toLowerCase()}
          tone={quote.seriesStatus === "ACTIVE" ? "up" : quote.seriesStatus === "UNKNOWN" ? "dim" : "down"}
        />
        <Row label="Expiry" value={expiryAt !== null ? `${formatUtcStamp(expiryAt)} UTC` : "-"} />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Quote stops                                                         */
/* ------------------------------------------------------------------ */

export function QuoteStops({
  markets,
  quotes,
  working,
  onCancel,
}: {
  markets: MakerMarket[];
  quotes: WorkingQuote[];
  working: boolean;
  onCancel: (quotes: WorkingQuote[], scope: string) => void;
}) {
  const quoted = markets.filter((entry) => entry.working.length > 0);
  return (
    <Panel label="Quote stops" delay={140}>
      <PanelHead
        title="Quote stops"
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">Cancels your working quotes</span>
            <ShieldAlert size={14} className="text-faint" aria-hidden="true" />
          </>
        }
      />
      <ul className="divide-y divide-line-soft">
        <li className={`flex items-center justify-between gap-3 px-3 py-2.5 ${quotes.length > 0 ? "" : "opacity-60"}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LiveDot tone={quotes.length > 0 ? "up" : "dim"} live={quotes.length > 0} />
              <span className="text-xs text-ink">All quoting</span>
            </div>
            <p className="mt-0.5 pl-3.5 text-[11px] text-faint">{`${quotes.length} working across ${quoted.length} markets`}</p>
          </div>
          <button
            type="button"
            disabled={working || quotes.length === 0}
            onClick={() => onCancel(quotes, "all markets")}
            className="focus-ring h-7 rounded-md border border-down/40 px-2 text-[11px] font-medium text-down transition-colors hover:bg-down-soft disabled:cursor-not-allowed disabled:opacity-45"
          >
            Cancel all
          </button>
        </li>
        {quoted.map((entry) => (
          <li key={entry.market.id} className={`${deskMotion.fade} flex items-center justify-between gap-3 px-3 py-2.5`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MarketMark underlying={entry.market.underlying} size={14} />
                <span className="truncate text-xs text-ink">{entry.market.id}</span>
              </div>
              <p className="tnum mt-0.5 truncate pl-5 font-mono text-[11px] text-faint">
                {`${entry.working.length} quotes / ${formatLots(entry.bidLots)} bid / ${formatLots(entry.askLots)} ask`}
              </p>
            </div>
            <button
              type="button"
              disabled={working}
              onClick={() => onCancel(entry.working, entry.market.id)}
              className="focus-ring h-7 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-down/50 hover:text-down disabled:cursor-not-allowed disabled:opacity-45"
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-faint">
        Each cancellation is a wallet transaction. It stops new fills only; positions and collateral already committed are
        unaffected.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Desk health                                                         */
/* ------------------------------------------------------------------ */

type Tone = "up" | "brand" | "down" | "dim";

function HealthRow({ label, detail, state, tone, value }: { label: string; detail: string; state: string; tone: Tone; value?: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-panel px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <LiveDot tone={tone} live={tone === "up"} />
          <span className="truncate text-xs text-ink">{label}</span>
        </div>
        <span className="mt-0.5 block truncate pl-3.5 text-[11px] text-faint">{detail}</span>
      </div>
      <div className="text-right">
        <span className={`block text-[11px] ${tone === "up" ? "text-up" : tone === "brand" ? "text-brand" : tone === "down" ? "text-down" : "text-dim"}`}>{state}</span>
        {value ? <span className="tnum block font-mono text-[10px] text-off">{value}</span> : null}
      </div>
    </li>
  );
}

function signerState(available: boolean | null): { state: string; tone: Tone } {
  if (available === true) return { state: "Configured", tone: "up" };
  if (available === false) return { state: "Not configured", tone: "brand" };
  return { state: "Not reported", tone: "dim" };
}

export function DeskHealth({
  feedStatus,
  feedAsOf,
  walletStatus,
  operator,
  chainOffsetMs,
}: {
  feedStatus: MarketFeedStatus;
  feedAsOf: number;
  walletStatus: WalletStatus;
  operator: Resource<OperatorStatus>;
  chainOffsetMs: number;
}) {
  const now = useChainNow();
  const age = feedAsOf > 0 ? Math.max(0, now - feedAsOf) : null;
  const status = operator.data;
  const opSigner = signerState(status ? status.operator.available : null);
  const makerSigner = signerState(status ? status.maker.available : null);
  return (
    <Panel label="Desk health" delay={180}>
      <PanelHead title="Desk health" tools={<span className="text-[11px] text-faint">Read now, not a guarantee</span>} />
      <ul className="grid gap-px bg-line-soft sm:grid-cols-2">
        <HealthRow
          label="Market data feed"
          detail="Onchain book, fills and Chainlink references"
          state={feedStatus === "LIVE" ? "Live" : feedStatus === "LOADING" ? "Loading" : feedStatus === "STALE" ? "Stale" : "Unavailable"}
          tone={feedStatus === "LIVE" ? "up" : feedStatus === "LOADING" ? "dim" : "down"}
          value={age !== null ? `block ${age}s old` : undefined}
        />
        <HealthRow
          label="Wallet session"
          detail="Signs quotes and cancellations"
          state={walletStatus === "CONNECTED" ? "Connected" : walletStatus === "CONNECTING" ? "Connecting" : walletStatus === "WRONG_NETWORK" ? "Wrong network" : "Disconnected"}
          tone={walletStatus === "CONNECTED" ? "up" : walletStatus === "WRONG_NETWORK" ? "down" : "dim"}
          value={`clock offset ${Math.round(chainOffsetMs / 1000)}s`}
        />
        <HealthRow
          label="Operator signer"
          detail={status?.operator.address ?? (operator.error ? "Operator status unavailable" : "Risk admission and keeper calls")}
          state={operator.error && !status ? "Unavailable" : opSigner.state}
          tone={operator.error && !status ? "down" : opSigner.tone}
        />
        <HealthRow
          label="Designated maker"
          detail={status?.maker.address ?? "Answers private requests on this network"}
          state={operator.error && !status ? "Unavailable" : makerSigner.state}
          tone={operator.error && !status ? "down" : makerSigner.tone}
        />
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export function Inventory({
  markets,
  selected,
  onSelect,
}: {
  markets: MakerMarket[];
  selected: string;
  onSelect: (marketId: string) => void;
}) {
  const held = markets.filter((entry) => entry.inventory !== null);
  return (
    <Panel label="Inventory" delay={140} className="min-w-0">
      <PanelHead title="Inventory" tools={<Chip tone="up">Your positions</Chip>} />
      {held.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-faint">No positions yet. Filled quotes open positions here.</p>
      ) : (
        <div role="region" tabIndex={0} aria-label="Inventory by market" className="focus-ring scroll-thin overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Market</th>
                <th scope="col" className={TH_NUM}>Net lots</th>
                <th scope="col" className={TH_NUM}>Avg entry</th>
                <th scope="col" className={TH_NUM}>Mark P&amp;L</th>
                <th scope="col" className={TH_NUM}>Delta</th>
                <th scope="col" className={TH_NUM}>Collateral</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {held.map((entry) => {
                const inventory = entry.inventory!;
                const active = entry.market.id === selected;
                const multiplier = entry.terms?.lotSize ?? entry.market.contractMultiplier;
                const pnl =
                  entry.quote.mark !== null
                    ? inventory.positions.reduce(
                        (total, position) =>
                          total + (position.side === "LONG" ? 1 : -1) * position.lots * multiplier * (entry.quote.mark! - position.entryPrice),
                        0,
                      )
                    : null;
                const spot = entry.quote.reference?.price ?? null;
                const delta = entry.terms && spot !== null ? inventory.netLots * deltaPerLot(entry.terms, spot) : null;
                return (
                  <tr
                    key={entry.market.id}
                    onClick={() => onSelect(entry.market.id)}
                    className={`cursor-pointer transition-colors duration-150 ${active ? "bg-raised" : "hover:bg-raised/40"}`}
                  >
                    <td className="h-11 px-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <MarketMark underlying={entry.market.underlying} size={16} />
                        <span className="min-w-0">
                          <span className={`block truncate text-xs ${active ? "text-ink" : "text-dim"}`}>{entry.market.id}</span>
                          <span className="block truncate text-[11px] text-faint">{`${formatLots(inventory.longLots)} long / ${formatLots(inventory.shortLots)} short`}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`tnum px-3 text-right font-mono ${inventory.netLots > 0 ? "text-up" : inventory.netLots < 0 ? "text-down" : "text-dim"}`}>
                      {signedNumber(inventory.netLots)}
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">
                      {inventory.averageEntry !== null ? formatNumber(inventory.averageEntry, entry.market.priceDecimals) : "-"}
                    </td>
                    <td className={`tnum px-3 text-right font-mono ${pnl === null ? "text-faint" : pnl >= 0 ? "text-up" : "text-down"}`}>
                      {pnl === null ? "No mark" : signedUsd(pnl)}
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">
                      {delta === null ? "-" : `${signedNumber(delta, delta !== 0 && Math.abs(delta) < 10 ? 3 : 0)} ${entry.market.underlying.split("/")[0]}`}
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">{usdCompact(inventory.collateral)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Capital                                                             */
/* ------------------------------------------------------------------ */

export function CapitalPlane({ account, quoteReservations }: { account: GatewayAccount | null; quoteReservations: number }) {
  if (!account) {
    return (
      <Panel label="Capital" delay={180} className="min-w-0">
        <PanelHead title="Capital" />
        <p className="px-3 py-8 text-center text-xs text-faint">Connect a wallet to read its collateral account.</p>
      </Panel>
    );
  }
  const available = Math.max(0, account.available);
  const reserved = Math.max(0, account.reserved);
  const total = Math.max(1, available + reserved);
  const buckets = [
    { id: "available", label: "Available", amount: available, description: "Free for new reservations and withdrawals", fill: "bg-up" },
    { id: "reserved", label: "Reserved", amount: reserved, description: "Locked against positions and fills", fill: "bg-ink/70" },
  ];
  return (
    <Panel label="Capital" delay={180} className="min-w-0">
      <PanelHead
        title="Capital"
        tools={
          <>
            <span className="tnum font-mono text-[11px] text-dim">{usd(account.posted)}</span>
            <Chip>{account.collateralAsset}</Chip>
          </>
        }
      />
      <div className="px-3 pt-3 pb-2">
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          {buckets.map((bucket) => (
            <span key={bucket.id} className={`h-full transition-[flex-grow] duration-200 ease-out ${bucket.fill}`} style={{ flexGrow: bucket.amount, flexBasis: 0 }} />
          ))}
        </div>
      </div>
      <ul className="divide-y divide-line-soft">
        {buckets.map((bucket) => (
          <li key={bucket.id} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2.5 px-3 py-2">
            <span aria-hidden="true" className={`mt-1 h-2 w-2 rounded-[2px] ${bucket.fill}`} />
            <span className="min-w-0">
              <span className="block truncate text-xs text-ink">{bucket.label}</span>
              <span className="block truncate text-[11px] text-faint">{bucket.description}</span>
            </span>
            <span className="text-right">
              <span className={`tnum block font-mono text-xs ${bucket.id === "available" ? "text-up" : "text-dim"}`}>{usd(bucket.amount)}</span>
              <span className="tnum block font-mono text-[10px] text-off">{`${Math.round((bucket.amount / total) * 100)}%`}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-3 py-1">
        <Row label="Equity" value={usd(account.equity)} />
        <Row label="Working quote reservations" value={usd(quoteReservations)} tone="dim" />
      </div>
      <div className="px-3 pb-2">
        <Meter value={reserved / total} tone={reserved / total > 0.8 ? "down" : "brand"} label="Reserved share of posted collateral" height="h-[3px]" />
      </div>
    </Panel>
  );
}
