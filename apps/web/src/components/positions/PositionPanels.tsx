"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Download, FileSearch } from "lucide-react";
import { BUTTON_QUIET, CopyButton, formatUtcTime, middleTruncate } from "@/components/activity/ledger-ui";
import { toCsvCell } from "@/components/activity/activity-view";
import { DeskTabs, Meter, Panel, PanelHead, TH, TH_NUM, TabBody } from "@/components/strategies/desk/Desk";
import { ProvenanceChip } from "@/components/settlements/trust";
import { receiptHref, type LinkedFill, type PositionDossier } from "@/lib/positions/dossier";
import type { PositionMetrics } from "@/lib/positions/economics";
import { formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
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
                    <ProvenanceChip provenance="OBSERVED" source={`${fill.receipt.evidence.toLowerCase()} evidence`} compact />
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
  const reference = dossier.origin === "REFERENCE";
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
                  : `Local ${dossier.evidenceLabel.toLowerCase()} export of linked fills, not venue accounting`
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
            <Empty
              action={
                reference ? (
                  <Link href={tradeHref(market)} className={BUTTON_QUIET}>
                    Open the market
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                ) : undefined
              }
            >
              {reference
                ? "A reference record has no fills or receipts. Account positions list every fill here with its receipt and transaction reference."
                : "No fill is linked to this position in the current account snapshot. The position record itself is read from chain state."}
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
/* Legs                                                                */
/* ------------------------------------------------------------------ */

export function LegsPanel({
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
  const roles = new Map((dossier.reference?.legs ?? []).map((leg) => [leg.id, leg]));
  return (
    <Panel label="Package legs" className={className} delay={delay}>
      <PanelHead
        title="Package legs"
        tools={<span className="text-[11px] text-faint">{`${market.legs.length} legs, one package`}</span>}
      />
      <div className="overflow-x-auto">
        <table className="relative w-full min-w-[560px] border-collapse text-left">
          <caption className="sr-only">Legs of the package, with their reference observations.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Leg</th>
              <th scope="col" className={TH}>Side</th>
              <th scope="col" className={TH}>Venue</th>
              <th scope="col" className={TH_NUM}>Mark</th>
              <th scope="col" className={TH}>Source</th>
            </tr>
          </thead>
          <tbody>
            {market.legs.map((leg) => {
              const role = roles.get(leg.id);
              const decimals = leg.markUnit === "USD" ? (Math.abs(leg.mark) < 10 ? 4 : 2) : 1;
              return (
                <tr key={leg.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="block text-xs text-ink">{leg.instrument}</span>
                    <span className="block text-[11px] text-faint">{role?.lifecycleRole ?? leg.family.replace("_", " ").toLowerCase()}</span>
                  </td>
                  <td className="px-3 text-xs whitespace-nowrap text-dim">{`${leg.side === "BUY" ? "Buy" : "Sell"} ${formatNumber(leg.ratio, 2)}x`}</td>
                  <td className="px-3 text-xs whitespace-nowrap text-dim">{leg.venueClass === "NATIVE_BOOK" ? "Native book" : "Implied component"}</td>
                  <td className="tnum px-3 text-right font-mono text-xs whitespace-nowrap text-ink">
                    {`${formatNumber(leg.mark, decimals)} ${priceUnitSuffix(leg.markUnit)}`}
                  </td>
                  <td className="px-3">
                    <ProvenanceChip
                      provenance={leg.venueClass === "NATIVE_BOOK" ? "EXECUTABLE" : "OBSERVED"}
                      source={leg.venueClass === "NATIVE_BOOK" ? "Setryn package book" : "Qualified component observation"}
                      compact
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dossier.reference ? (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-faint lg:px-4">
          Legs close together from the package terminal. A direct single-leg close would break the package hedge and is not offered.
        </p>
      ) : null}
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
  className = "",
  delay = 0,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  metrics: PositionMetrics;
  className?: string;
  delay?: number;
}) {
  const derived = metrics.derivedProvenance;
  const unit = priceUnitSuffix(market.priceUnit);
  const distance =
    metrics.liquidationPrice === null || market.netPrice === 0
      ? null
      : Math.abs(market.netPrice - metrics.liquidationPrice) / Math.abs(market.netPrice);
  const crossing = Math.abs(market.netPrice - metrics.closeTouch) * metrics.perPoint;
  const residual = dossier.reference?.maxResidual ?? dossier.lots * market.residualPerLot;
  return (
    <Panel label="Position risk" className={className} delay={delay}>
      <PanelHead title="Risk" tools={<span className="text-[11px] text-faint">isolated package margin</span>} />
      <div className="px-3 py-2 lg:px-4">
        <div className="divide-y divide-line-soft">
          <TrustRow label="Position equity" note="collateral plus PnL" value={usd(metrics.equity)} provenance={derived} />
          <TrustRow label="Maintenance floor" value={usd(metrics.maintenance)} provenance={derived} />
          <div className="py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-faint">Buffer above maintenance</span>
              <span className="tnum font-mono text-xs text-ink">{`${usd(metrics.buffer)}, ${formatNumber(metrics.bufferShare * 100, 1)}%`}</span>
            </div>
            <Meter
              className="mt-2"
              value={metrics.bufferShare}
              limit={0.1}
              tone={metrics.bufferShare < 0.1 ? "down" : metrics.bufferShare < 0.2 ? "brand" : "up"}
              label="Buffer share of equity"
            />
          </div>
          <TrustRow
            label="Liquidation level"
            note={distance === null ? "buffer runs through zero" : `${formatNumber(distance * 100, 1)}% from the mark`}
            value={metrics.liquidationPrice === null ? "No quote level" : price(metrics.liquidationPrice, market)}
            provenance={derived}
          />
          <TrustRow
            label="Close cost at the touch"
            note={`mark to ${dossier.side === "LONG" ? "bid" : "ask"}, ${formatNumber(Math.abs(market.netPrice - metrics.closeTouch), market.priceDecimals)} ${unit}`}
            value={usd(crossing)}
            provenance="ESTIMATED"
          />
          <TrustRow label="Max terminal residual" value={usd(residual)} provenance={dossier.reference ? "MODELED" : "ESTIMATED"} />
          {dossier.origin === "ACCOUNT" ? (
            <TrustRow label="Fees paid" value={usd(dossier.fees, 2)} provenance="OBSERVED" source="Linked receipts" />
          ) : (
            <TrustRow label="Fees paid" value="Not recorded" tone="text-faint" note="reference records carry no fills" />
          )}
          <TrustRow label="Price PnL" value={signedUsd(metrics.pricePnl)} tone={toneOf(metrics.pricePnl)} provenance={derived} />
          <TrustRow label="Settlement guarantee" value={GUARANTEE_COPY[dossier.guarantee].label} />
        </div>
      </div>
      {dossier.reference ? (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-faint lg:px-4">{dossier.reference.healthDetail}</p>
      ) : null}
    </Panel>
  );
}
