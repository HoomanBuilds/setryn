"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Chip } from "@/components/activity/ledger-ui";
import { ProvenanceChip, countdownText, priceText, usd } from "@/components/auctions/board-kit";
import { CollateralMark, MarketMark } from "@/components/portfolio/MarketMark";
import { Meter, Panel, PanelHead, Row, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import type { GatewayAccount } from "@/lib/internal-gateway/types";
import type { RecoveryItem, RequestStats, SolverOpportunity } from "@/lib/solver/types";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

/* ------------------------------------------------------------------ */
/* Route plan and quote competition                                    */
/* ------------------------------------------------------------------ */

export function RoutePlanPanel({ opportunity, market, now }: { opportunity: SolverOpportunity | null; market: PackageMarket | null; now: number }) {
  if (!opportunity || !market) {
    return (
      <Panel label="Book comparison" delay={60}>
        <PanelHead title="Book comparison" />
        <p className="px-3 py-8 text-center text-xs text-faint">Select a request to compare its quotes with the public book.</p>
      </Panel>
    );
  }
  const plan = opportunity.plan;
  const maxLots = Math.max(1, ...(plan?.fills.map((fill) => fill.lots) ?? [1]));
  const quotes = [...opportunity.quotes].sort((left, right) =>
    opportunity.takerAction === "BUY" ? left.packagePrice - right.packagePrice : right.packagePrice - left.packagePrice,
  );
  const lotSize = Number.isFinite(market.lotSize) && market.lotSize > 0 ? market.lotSize : market.contractMultiplier;
  return (
    <Panel label="Book comparison" delay={60}>
      <PanelHead
        title="Book comparison"
        tools={
          <span className="flex items-center gap-2">
            <span className="hidden text-[11px] text-faint sm:inline">{`${opportunity.takerAction === "BUY" ? "Lifting offers" : "Hitting bids"} for ${formatLots(opportunity.lots)} lots`}</span>
            <ProvenanceChip value="ESTIMATED" title="Walked over the public book at the feed's block; your own resting orders are left out." />
          </span>
        }
      />
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="grid content-start gap-0 border-line px-3 py-2 lg:border-r">
          {plan ? (
            <>
              <Row label="Book depth used" value={`${formatLots(plan.fillableLots)} / ${formatLots(plan.requestedLots)}`} tone={plan.fillableLots < plan.requestedLots ? "down" : "neutral"} />
              <Row label="Touch" value={plan.touch !== null ? priceText(plan.touch, market) : "Empty side"} />
              <Row label="Book VWAP" value={plan.vwap !== null ? priceText(plan.vwap, market) : "-"} />
              <Row label="Worst level" value={plan.worst !== null ? priceText(plan.worst, market) : "-"} />
              <Row label="Taker fees" value={`${usd(plan.feesUsd)} USDC`} />
              <Row label="All-in on the book" value={plan.breakEven !== null ? priceText(plan.breakEven, market) : "Depth short"} className="border-t border-line pt-1" />
              <Row label="Request limit" value={priceText(opportunity.limitPrice, market)} tone="dim" />
              {plan.excludedOwnLots > 0 ? <Row label="Own lots left out" value={formatLots(plan.excludedOwnLots)} tone="dim" /> : null}
            </>
          ) : (
            <p className="py-4 text-xs text-faint">This request names a market the catalog does not list.</p>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex h-8 items-center justify-between border-b border-line px-3 text-[11px] text-faint">
            <span>Book levels taken</span>
            <span>{plan ? `${plan.fills.length} orders` : ""}</span>
          </div>
          {plan && plan.fills.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {plan.fills.slice(0, 8).map((fill) => (
                <li key={`${fill.orderId}-${fill.price}`} className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-3 px-3 py-1.5">
                  <span className={`tnum font-mono text-xs ${opportunity.takerAction === "BUY" ? "text-down" : "text-up"}`}>{priceText(fill.price, market)}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <span className="block h-full rounded-full bg-ink/70" style={{ width: `${(fill.lots / maxLots) * 100}%` }} />
                  </span>
                  <span className="tnum text-right font-mono text-xs text-dim">{formatLots(fill.lots)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-xs text-faint">No resting orders on that side of the book.</p>
          )}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="flex h-8 items-center justify-between px-3 text-[11px] text-faint">
          <span>Firm quotes on this request</span>
          <span>{`${quotes.length} received`}</span>
        </div>
        {quotes.length === 0 ? (
          <p className="border-t border-line-soft px-3 py-5 text-center text-xs text-faint">No quotes yet.</p>
        ) : (
          <table className="w-full border-collapse border-t border-line-soft text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Quote</th>
                <th scope="col" className={TH_NUM}>Price</th>
                <th scope="col" className={TH_NUM}>Capacity</th>
                <th scope="col" className={TH_NUM}>Vs book</th>
                <th scope="col" className={TH_NUM}>Valid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {quotes.map((quote) => {
                const vsBook =
                  plan && plan.vwap !== null && plan.fillableLots >= opportunity.lots
                    ? (opportunity.takerAction === "BUY" ? plan.vwap - quote.packagePrice : quote.packagePrice - plan.vwap) * opportunity.lots * lotSize
                    : null;
                const left = Date.parse(quote.expiresAt) / 1000 - now;
                const selected = opportunity.request.selectedQuoteId === quote.id;
                return (
                  <tr key={quote.id} className={selected ? "bg-brand-soft/40" : ""}>
                    <td className="h-9 px-3">
                      <span className="text-ink">{quote.solverLabel}</span>
                      {selected ? <span className="ml-2 text-[10px] text-brand">selected</span> : null}
                      <span className="block font-mono text-[10px] text-faint">{`${quote.id.slice(0, 10)}…`}</span>
                    </td>
                    <td className="tnum px-3 text-right font-mono text-ink">{priceText(quote.packagePrice, market)}</td>
                    <td className="tnum px-3 text-right font-mono text-dim">{formatLots(quote.capacityLots)}</td>
                    <td className={`tnum px-3 text-right font-mono ${vsBook === null ? "text-faint" : vsBook >= 0 ? "text-up" : "text-down"}`}>
                      {vsBook === null ? "No full book" : `${usd(vsBook, true)} USDC`}
                    </td>
                    <td className={`tnum px-3 text-right font-mono ${left <= 0 ? "text-faint" : left < 10 ? "text-down" : "text-dim"}`}>
                      {left <= 0 ? "Expired" : countdownText(left)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function HistoryPanel({ stats }: { stats: RequestStats }) {
  return (
    <Panel label="Request history" delay={100}>
      <PanelHead title="Request history" tools={<span className="text-[11px] text-faint">Read from the PrivateRfqBook</span>} />
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {[
          ["Requests", String(stats.total), `${stats.open} open`],
          ["Quoted", `${Math.round(stats.quoteRate * 100)}%`, `${stats.quotesReceived} quotes received`],
          ["Executed", `${Math.round(stats.executionRate * 100)}%`, `${formatLots(stats.executedLots)} lots`],
          ["Lapsed", String(stats.expired + stats.cancelled), `${stats.cancelled} cancelled`],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-panel px-3 py-2">
            <div className="text-[11px] text-faint">{label}</div>
            <div className="tnum mt-0.5 font-mono text-[15px] text-ink">{value}</div>
            <div className="text-[11px] text-off">{note}</div>
          </div>
        ))}
      </div>
      {stats.byMarket.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">No private requests from this account yet.</p>
      ) : (
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Market</th>
              <th scope="col" className={TH_NUM}>Requests</th>
              <th scope="col" className={TH_NUM}>Quoted</th>
              <th scope="col" className={`${TH} w-[140px]`}>Executed</th>
              <th scope="col" className={TH_NUM}>Lots</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {stats.byMarket.map((row) => (
              <tr key={row.marketId}>
                <td className="h-9 px-3">
                  <span className="flex items-center gap-2">
                    <MarketMark code={row.marketId} size={14} />
                    <span className="font-mono text-[12px] text-ink">{row.marketId}</span>
                  </span>
                </td>
                <td className="tnum px-3 text-right font-mono text-dim">{row.requests}</td>
                <td className="tnum px-3 text-right font-mono text-dim">{row.quoted}</td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <Meter value={row.requests > 0 ? row.executed / row.requests : 0} tone="up" label={`${row.marketId} execution rate`} height="h-[3px]" className="flex-1" />
                    <span className="tnum font-mono text-dim">{row.executed}</span>
                  </span>
                </td>
                <td className="tnum px-3 text-right font-mono text-dim">{`${formatLots(row.executedLots)} / ${formatLots(row.lots)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

export function CapacityPanel({ account, bound }: { account: GatewayAccount | null; bound: number }) {
  if (!account) {
    return (
      <Panel label="Capacity" delay={40}>
        <PanelHead title="Capacity" />
        <p className="px-3 py-8 text-center text-xs text-faint">Connect a wallet to read its collateral.</p>
      </Panel>
    );
  }
  const total = Math.max(1, account.available + account.reserved);
  return (
    <Panel label="Capacity" delay={40}>
      <PanelHead
        title="Capacity"
        tools={
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <CollateralMark size={13} />
            {account.collateralAsset}
          </span>
        }
      />
      <div className="px-3 pt-3 pb-1">
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span className="h-full bg-up" style={{ flexGrow: Math.max(0, account.available), flexBasis: 0 }} />
          <span className="h-full bg-ink/70" style={{ flexGrow: Math.max(0, account.reserved), flexBasis: 0 }} />
        </div>
      </div>
      <div className="px-3 pb-2">
        <Row label="Posted" value={`${usd(account.posted)} USDC`} />
        <Row label="Available" value={`${usd(account.available)} USDC`} tone="up" />
        <Row label="Reserved" value={`${usd(account.reserved)} USDC`} title={`${Math.round((account.reserved / total) * 100)}% of posted`} />
        <Row label="Bound by open requests" value={`${usd(bound)} USDC`} tone={bound > account.available ? "down" : "dim"} className="border-t border-line pt-1" />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

export function RecoveryPanel({
  items,
  busy,
  onExpire,
}: {
  items: RecoveryItem[];
  busy: string | null;
  onExpire: (item: RecoveryItem) => void;
}) {
  return (
    <Panel label="Recovery" delay={80}>
      <PanelHead title="Recovery" tools={<span className="text-[11px] text-faint">Permissionless</span>} />
      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">No lapsed requests hold state.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {items.map((item) => (
            <li key={item.id} className={`${deskMotion.fade} px-3 py-2.5`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block text-xs text-ink">{item.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-faint">{item.detail}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-off">{`${item.call} / ${item.id.slice(0, 10)}…`}</span>
                </span>
                <Chip tone={item.kind === "SELECTION_EXPIRED" ? "brand" : "muted"}>{item.kind === "SELECTION_EXPIRED" ? "Locked" : "Lapsed"}</Chip>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => onExpire(item)}
                className="focus-ring mt-2 inline-flex h-7 items-center rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-45"
              >
                {busy === item.id ? "Expiring" : "Expire request"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Auctions                                                            */
/* ------------------------------------------------------------------ */

export function AuctionsNote({ listed }: { listed: boolean }) {
  return (
    <Panel label="Sealed auctions" delay={120}>
      <PanelHead title="Sealed auctions" />
      <div className="px-3 py-3 text-xs leading-relaxed text-dim">
        {listed
          ? "The runtime lists a sealed auction house; its rounds are on the auction board."
          : "This network's runtime lists no sealed auction house, so no auctions are scheduled."}
        <Link href="/auctions" className="mt-2 flex items-center gap-1 text-dim hover:text-ink">
          Auction board
          <ArrowUpRight size={11} aria-hidden="true" />
        </Link>
      </div>
    </Panel>
  );
}

export function marketById(markets: readonly PackageMarket[], id: string): PackageMarket | null {
  return markets.find((market) => market.id === id) ?? null;
}

export function priceOrDash(value: number | null, market: PackageMarket | null): string {
  if (value === null || !market) return "-";
  return formatNumber(value, market.priceDecimals);
}
