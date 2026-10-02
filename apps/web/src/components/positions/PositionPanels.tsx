"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Download, FileSearch } from "lucide-react";
import { BUTTON_QUIET, CopyButton, formatUtcTime, middleTruncate } from "@/components/activity/ledger-ui";
import { toCsvCell } from "@/components/activity/activity-view";
import { DeskTabs, Meter, Panel, PanelHead, TH, TH_NUM, TabBody } from "@/components/strategies/desk/Desk";
import { ProvenanceChip } from "@/components/settlements/trust";
import { useReferencePrices } from "@/components/market-data/MarketDataProvider";
import type { LiveMarketData } from "@/lib/market-data/types";
import { impliedCarry, longPayoffPerLot } from "@/lib/portfolio/forward";
import { receiptHref, type LinkedFill, type PositionDossier } from "@/lib/positions/dossier";
import type { PositionMetrics } from "@/lib/positions/economics";
import { evidenceLabel, formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { lastTradedPrice, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { GUARANTEE_COPY } from "@/lib/terminal/economics";
import { TrustRow, price, signedUsd, toneOf, usd } from "./parts";

/* ------------------------------------------------------------------ */
/* Linked activity                                                     */
/* ------------------------------------------------------------------ */

type ActivityTab = "fills" | "orders" | "rfqs";

const KIND_LABEL: Record<LinkedFill["kind"], string> = { OPEN: "Open", REDUCE: "Reduce", CLOSE: "Close" };

function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <FileSearch size={16} aria-hidden="true" className="text-faint" />
      <p className="mt-2.5 max-w-sm text-xs leading-relaxed text-faint">{children}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

function HashCell({ value, label }: { value: string; label: string }) {
  if (!value) return <span className="text-faint">Not recorded</span>;
  return (
    <span className="inline-flex min-w-0 items-center">
      <span title={value} className="tnum truncate font-mono text-[11px] text-dim">
        {middleTruncate(value, 8, 4)}
      </span>
      <CopyButton value={value} label={label} size={11} className="h-5 w-5" />
    </span>
  );
}

function FillsTable({ fills, market }: { fills: LinkedFill[]; market: PackageMarket }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="relative w-full min-w-[680px] border-collapse text-left">
          <caption className="sr-only">Fills linked to this position, oldest first, with their receipts.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Time (UTC)</th>
              <th scope="col" className={TH}>Action</th>
              <th scope="col" className={TH_NUM}>Lots</th>
              <th scope="col" className={TH_NUM}>Price</th>
              <th scope="col" className={TH_NUM}>Fees</th>
              <th scope="col" className={TH}>Route</th>
              <th scope="col" className={TH}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {fills.map((fill) => (
              <tr key={fill.id} className="border-b border-line-soft transition-colors last:border-b-0 hover:bg-raised/50">
                <td className="tnum h-10 px-3 font-mono text-[11px] whitespace-nowrap text-dim">{formatUtcTime(fill.receipt.createdAt)}</td>
                <td className="px-3 text-xs">
                  <span className={fill.kind === "OPEN" ? "text-ink" : "text-dim"}>{KIND_LABEL[fill.kind]}</span>
                  {fill.matchedBy === "TERMS" ? (
                    <span className="ml-1.5 text-[10.5px] text-faint" title="Linked by market, size and price">
                      by terms
                    </span>
                  ) : null}
                </td>
                <td className="tnum px-3 text-right font-mono text-xs text-ink">{formatLots(fill.receipt.filledLots ?? fill.receipt.lots)}</td>
                <td className="tnum px-3 text-right font-mono text-xs text-ink">{price(fill.receipt.price, market, false)}</td>
                <td className="tnum px-3 text-right font-mono text-xs text-dim">{formatNumber(fill.receipt.fees, 2)}</td>
                <td className="max-w-[160px] truncate px-3 text-xs text-dim">{fill.receipt.routeLabel}</td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <Link href={receiptHref(fill.receipt.id)} className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-ink hover:text-brand">
                      Receipt
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </Link>
                    <HashCell value={fill.receipt.transactionHash} label="transaction reference" />
                    <ProvenanceChip provenance="OBSERVED" source={`${evidenceLabel(fill.receipt.evidence)} evidence`} compact />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {fills.map((fill) => (
          <li key={fill.id} className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink">{`${KIND_LABEL[fill.kind]} ${formatLots(fill.receipt.filledLots ?? fill.receipt.lots)} lots`}</span>
              <span className="tnum font-mono text-xs text-ink">{price(fill.receipt.price, market)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
              <span className="tnum font-mono">{formatUtcTime(fill.receipt.createdAt)}</span>
              <span className="truncate">{fill.receipt.routeLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Link href={receiptHref(fill.receipt.id)} className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-ink">
                Receipt
                <ArrowUpRight size={11} aria-hidden="true" />
              </Link>
              <ProvenanceChip provenance="OBSERVED" compact />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function OrdersTable({ dossier, market }: { dossier: PositionDossier; market: PackageMarket }) {
  return (
    <div className="overflow-x-auto">
      <table className="relative w-full min-w-[560px] border-collapse text-left">
        <caption className="sr-only">Close orders registered against this position.</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH}>Created (UTC)</th>
            <th scope="col" className={TH}>State</th>
            <th scope="col" className={TH_NUM}>Filled / lots</th>
            <th scope="col" className={TH_NUM}>Limit</th>
            <th scope="col" className={TH}>TIF</th>
            <th scope="col" className={TH}>Order</th>
          </tr>
        </thead>
        <tbody>
          {dossier.orders.map((order) => (
            <tr key={order.id} className="border-b border-line-soft last:border-b-0 hover:bg-raised/50">
              <td className="tnum h-10 px-3 font-mono text-[11px] whitespace-nowrap text-dim">{formatUtcTime(order.createdAt)}</td>
              <td className="px-3 text-xs text-ink">{order.state.replaceAll("_", " ").toLowerCase()}</td>
              <td className="tnum px-3 text-right font-mono text-xs text-ink">{`${formatLots(order.filledLots)} / ${formatLots(order.lots)}`}</td>
              <td className="tnum px-3 text-right font-mono text-xs text-ink">{price(order.limitPrice, market, false)}</td>
              <td className="px-3 font-mono text-[11px] text-dim">{order.timeInForce}</td>
              <td className="px-3">
                <HashCell value={order.orderHash} label="order hash" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RfqsTable({ dossier, market }: { dossier: PositionDossier; market: PackageMarket }) {
  return (
    <div className="overflow-x-auto">
      <table className="relative w-full min-w-[520px] border-collapse text-left">
        <caption className="sr-only">Private RFQs requested to close this position.</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH}>Created (UTC)</th>
            <th scope="col" className={TH}>State</th>
            <th scope="col" className={TH_NUM}>Lots</th>
            <th scope="col" className={TH_NUM}>Quotes</th>
            <th scope="col" className={TH}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {dossier.rfqs.map((request) => (
            <tr key={request.id} className="border-b border-line-soft last:border-b-0 hover:bg-raised/50">
              <td className="tnum h-10 px-3 font-mono text-[11px] whitespace-nowrap text-dim">{formatUtcTime(request.createdAt)}</td>
              <td className="px-3 text-xs text-ink">{request.state.toLowerCase()}</td>
              <td className="tnum px-3 text-right font-mono text-xs text-ink">{formatLots(request.authorization.intent.lots)}</td>
              <td className="tnum px-3 text-right font-mono text-xs text-dim">{request.quotes.length}</td>
              <td className="px-3 text-xs">
                {request.receiptId ? (
                  <Link href={receiptHref(request.receiptId)} className="focus-ring inline-flex items-center gap-1 rounded-sm text-ink hover:text-brand">
                    Receipt
                    <ArrowUpRight size={11} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link href={`${tradeHref(market)}?rfq=${encodeURIComponent(request.id)}`} className="focus-ring rounded-sm text-dim hover:text-ink">
                    Resume in terminal
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Local accounting export of the position's linked fills, one row per receipt. */
function exportFills(dossier: PositionDossier) {
  const header = [
    "position_id",
    "receipt_id",
    "fill_id",
    "created_at",
    "action",
    "market",
    "package_side",
    "lots",
    "price",
    "fees",
    "realized_pnl_usd",
    "collateral_released_usd",
    "route",
    "order_hash",
    "transaction_reference",
    "evidence",
  ];
  const lines = [header.join(",")];
  for (const fill of dossier.fills) {
    const receipt = fill.receipt;
    lines.push(
      [
        dossier.id,
        receipt.id,
        receipt.fillId,
        receipt.createdAt,
        fill.kind,
        receipt.marketId,
        receipt.packageSide,
        receipt.filledLots ?? receipt.lots,
        receipt.price,
        receipt.fees,
        receipt.realizedPnlUsd,
        receipt.collateralReleasedUsd,
        receipt.routeLabel,
        receipt.orderHash,
        receipt.transactionHash,
        receipt.evidence,
      ]
        .map(toCsvCell)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `setryn-position-${dossier.id.slice(0, 12)}-fills.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ActivityPanel({
  dossier,
  market,
  className = "",
  delay = 0,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  className?: string;
  delay?: number;
}) {
  const [tab, setTab] = useState<ActivityTab>("fills");
  return (
    <Panel label="Linked activity" className={className} delay={delay}>
      <PanelHead
        tabs={
          <DeskTabs
            idBase="position-activity"
            value={tab}
            onChange={(id) => setTab(id as ActivityTab)}
            items={[
              { id: "fills", label: "Fills and receipts", badge: dossier.fills.length },
              { id: "orders", label: "Close orders", badge: dossier.orders.length },
              { id: "rfqs", label: "Close RFQs", badge: dossier.rfqs.length },
            ]}
          />
        }
        tools={
          <>
            <Link href="/activity" className="hidden text-[11px] text-faint transition-colors hover:text-ink lg:inline">
              All activity
            </Link>
            <button
              type="button"
              onClick={() => exportFills(dossier)}
              disabled={dossier.fills.length === 0}
              title={
                dossier.fills.length === 0
                  ? "No linked fills to export"
                  : "Export of the linked fills and their receipts"
              }
              className={`${BUTTON_QUIET} h-7 px-2`}
            >
              <Download size={12} aria-hidden="true" />
              <span className="hidden sm:inline">CSV</span>
            </button>
          </>
        }
      />
      <TabBody idBase="position-activity" key={tab}>
        {tab === "fills" ? (
          dossier.fills.length > 0 ? (
            <FillsTable fills={dossier.fills} market={market} />
          ) : (
            <Empty>
              No fill is linked to this position in the current account snapshot. The position record itself is read from chain state.
            </Empty>
          )
        ) : null}
        {tab === "orders" ? (
          dossier.orders.length > 0 ? (
            <OrdersTable dossier={dossier} market={market} />
          ) : (
            <Empty>No resting close order is registered against this position.</Empty>
          )
        ) : null}
        {tab === "rfqs" ? (
          dossier.rfqs.length > 0 ? (
            <RfqsTable dossier={dossier} market={market} />
          ) : (
            <Empty>No private RFQ has been requested to close this position.</Empty>
          )
        ) : null}
      </TabBody>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Contract terms                                                      */
/* ------------------------------------------------------------------ */

export function TermsPanel({
  market,
  metrics,
  className = "",
  delay = 0,
}: {
  market: PackageMarket;
  metrics: PositionMetrics;
  className?: string;
  delay?: number;
}) {
  const reference = useReferencePrices()[market.underlying] ?? null;
  const terms = metrics.terms;
  const unit = priceUnitSuffix(market.priceUnit);
  const base = market.underlying.split("/")[0];
  const days = Math.max(0, metrics.msToFixing / 86_400_000);
  // Market-implied, from the last traded price: the modeled mark would only return the model's own carry input.
  const traded = lastTradedPrice(market);
  const carry = Number.isFinite(traded) && reference ? impliedCarry(traded, reference.price, days) : null;
  const maxPayoff = terms.cap === null ? null : longPayoffPerLot(terms.cap, terms);
  return (
    <Panel label="Contract terms" className={className} delay={delay}>
      <PanelHead title="Contract terms" tools={<span className="text-[11px] text-faint">cash-settled dated range forward</span>} />
      <div className="px-3 py-2 lg:px-4">
        <div className="divide-y divide-line-soft">
          <TrustRow label="Underlying" value={market.underlying} note={market.fixingSource} provenance="OBSERVED" source="Series listing" />
          <TrustRow label="Lot size" value={`${formatNumber(terms.lotSize, terms.lotSize < 1 ? 4 : 0)} ${base}`} provenance="OBSERVED" source="Series listing" />
          <TrustRow label="Tick" value={`${formatNumber(market.tickSize, market.priceDecimals)} ${unit}`} provenance="OBSERVED" source="Series listing" />
          <TrustRow
            label="Payoff floor / cap"
            value={terms.floor === null || terms.cap === null ? "Not published" : `${price(terms.floor, market, false)} / ${price(terms.cap, market, false)}`}
            tone={terms.floor === null ? "text-faint" : "text-ink"}
            provenance={terms.floor === null ? undefined : "OBSERVED"}
            source="Series listing"
          />
          <TrustRow
            label="Long payoff per lot"
            note="lot x clamp(fixing - floor, 0, cap - floor)"
            value={maxPayoff === null ? "Not bounded here" : `0 to ${usd(maxPayoff)}`}
          />
          <TrustRow label="Settlement" value={`Cash ${market.settlementAsset}`} note="at the fixing, no delivery" />
          <TrustRow
            label="Chainlink reference"
            value={reference ? price(reference.price, market) : "Not read"}
            tone={reference ? "text-ink" : "text-faint"}
            provenance={reference ? "OBSERVED" : undefined}
            source={reference ? `Chainlink ${market.underlying}, chain ${reference.chainId}` : undefined}
          />
          <TrustRow
            label="Implied carry"
            note="(last traded / reference - 1) x 365 / days, display only; — before a trade"
            value={carry === null ? "—" : `${carry >= 0 ? "+" : "-"}${formatNumber(Math.abs(carry) * 100, 2)}% a year`}
            tone={carry === null ? "text-faint" : "text-ink"}
            provenance={carry === null ? undefined : "ESTIMATED"}
          />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

export function RiskPanel({
  dossier,
  market,
  metrics,
  live,
  className = "",
  delay = 0,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  metrics: PositionMetrics;
  live: LiveMarketData | null;
  className?: string;
  delay?: number;
}) {
  const estimated = metrics.mark === null ? "MODELED" : "ESTIMATED";
  const unit = priceUnitSuffix(market.priceUnit);
  const base = market.underlying.split("/")[0];
  const crossing =
    metrics.mark === null || metrics.closeTouch === null
      ? null
      : Math.abs(metrics.mark - metrics.closeTouch) * Math.abs(metrics.perPoint);
  const share = dossier.collateral > 0 ? Math.min(1, metrics.atRisk / dossier.collateral) : 0;
  return (
    <Panel label="Position risk" className={className} delay={delay}>
      <PanelHead title="Risk" tools={<span className="text-[11px] text-faint">fully collateralized</span>} />
      <div className="px-3 py-2 lg:px-4">
        <div className="divide-y divide-line-soft">
          <TrustRow label="Collateral locked" note="bounded terminal liability" value={usd(dossier.collateral)} provenance="OBSERVED" source={dossier.sourceLabel} />
          <TrustRow label="Value at the mark" note="collateral plus price PnL" value={usd(metrics.equity)} provenance={estimated} />
          <div className="py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-faint">{`At risk to the ${dossier.side === "LONG" ? "floor" : "cap"}`}</span>
              <span className="tnum font-mono text-xs text-ink">{usd(metrics.atRisk)}</span>
            </div>
            <Meter
              className="mt-2"
              value={share}
              tone={share > 0.9 ? "brand" : "up"}
              label="Share of locked collateral still at risk"
            />
          </div>
          <TrustRow
            label={`Most gained at the ${dossier.side === "LONG" ? "cap" : "floor"}`}
            value={metrics.maxGain === null ? "Not published" : signedUsd(metrics.maxGain)}
            tone={metrics.maxGain === null ? "text-faint" : toneOf(metrics.maxGain)}
            provenance={metrics.maxGain === null ? undefined : "ESTIMATED"}
          />
          <TrustRow
            label="Exposure"
            note={metrics.deltaUnits === 0 && metrics.mark !== null ? "outside the range: no delta" : "delta-one inside the range"}
            value={`${metrics.deltaUnits >= 0 ? "+" : ""}${formatNumber(metrics.deltaUnits, Math.abs(metrics.deltaUnits) < 10 ? 2 : 0)} ${base}`}
            provenance={estimated}
          />
          <TrustRow
            label="Close cost at the touch"
            note={
              crossing === null || metrics.closeTouch === null || metrics.mark === null
                ? `no resting ${dossier.side === "LONG" ? "bid" : "ask"}`
                : `mark to ${dossier.side === "LONG" ? "bid" : "ask"}, ${formatNumber(Math.abs(metrics.mark - metrics.closeTouch), market.priceDecimals)} ${unit}`
            }
            value={crossing === null ? "—" : usd(crossing)}
            tone={crossing === null ? "text-faint" : "text-ink"}
            provenance={crossing === null ? undefined : "EXECUTABLE"}
          />
          <TrustRow
            label="Book depth to close"
            value={live ? `${formatNumber(live.book.filter((row) => row.side === (dossier.side === "LONG" ? "BID" : "ASK") && row.executable).reduce((total, row) => total + row.lots, 0), 0)} lots` : "—"}
            provenance={live ? "EXECUTABLE" : undefined}
            source="Onchain public book"
          />
          <TrustRow label="Fees paid" value={usd(dossier.fees, 2)} provenance="OBSERVED" source="Linked receipts" />
          <TrustRow
            label="Price PnL"
            value={metrics.mark === null ? "—" : signedUsd(metrics.pricePnl)}
            tone={metrics.mark === null ? "text-faint" : toneOf(metrics.pricePnl)}
            provenance={estimated}
          />
          <TrustRow label="Settlement guarantee" value={GUARANTEE_COPY[dossier.guarantee].label} />
        </div>
      </div>
    </Panel>
  );
}
