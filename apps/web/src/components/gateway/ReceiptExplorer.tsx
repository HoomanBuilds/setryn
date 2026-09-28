"use client";

import Link from "next/link";
import { CheckCircle2, FileSearch } from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { SectionLabel } from "@/components/terminal/primitives";
import { formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import { findMarket, tradeHref } from "@/lib/terminal/markets";

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
      <span className="text-xs text-faint">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

export function ReceiptExplorer({ receiptId }: { receiptId: string }) {
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const receipt = gateway.getReceipt(receiptId);
  const market = receipt ? findMarket(receipt.marketId) : null;

  if (!receipt || !market) {
    return (
      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-3 sm:p-5 lg:p-6">
        <section className="mx-auto max-w-3xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2 text-dim">
            <FileSearch size={17} aria-hidden="true" />
            <SectionLabel>Receipt unavailable</SectionLabel>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim">
            This receipt is not available in the current demo browser session. Local demo evidence is
            stored only in this browser and does not represent an onchain receipt.
          </p>
          <Link
            href="/trade/BTC-YC-24DEC26"
            className="focus-ring mt-5 inline-flex h-9 items-center rounded-md border border-line px-3 text-xs text-dim hover:border-line-strong hover:text-ink"
          >
            Return to trade
          </Link>
        </section>
      </main>
    );
  }

  const execution = snapshot.executions.find((entry) => entry.result.receipt.id === receipt.id);
  const unit = priceUnitSuffix(market.priceUnit);
  const outcome = execution?.result.outcome ?? "OPENED";
  const outcomeLabel = outcome === "CLOSED" ? "Closed" : outcome === "REDUCED" ? "Reduced" : "Opened";
  const rfqRequest =
    snapshot.rfqRequests.find(
      (entry) =>
        entry.state === "EXECUTED" &&
        entry.receiptId === receipt.id &&
        entry.selectedQuoteId != null &&
        entry.quotes.some((quote) => quote.id === entry.selectedQuoteId),
    ) ?? null;
  const selectedQuote =
    rfqRequest?.quotes.find((quote) => quote.id === rfqRequest.selectedQuoteId) ?? null;

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-3 sm:p-5 lg:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={17} aria-hidden="true" className="text-up" />
              <SectionLabel>Execution receipt</SectionLabel>
            </div>
            <h1 className="mt-2 font-mono text-xl text-ink">{receipt.id}</h1>
            <p className="mt-1 text-xs text-faint">{receipt.packageCode} · {snapshot.environment.label} · {receipt.evidence.toLowerCase()} evidence</p>
          </div>
          <Link
            href={tradeHref(market)}
            className="focus-ring flex h-9 items-center rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Back to package market
          </Link>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <SectionLabel>Completed package outcome</SectionLabel>
              <span className="text-xs text-up">{`${outcomeLabel} ${receipt.packageSide === "SHORT" ? "Short" : "Long"}`}</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4">
              <div className="p-3">
                <span className="text-xs text-faint">Lots</span>
                <strong className="mt-1 block font-mono text-sm font-medium text-ink">{formatLots(receipt.lots)}</strong>
              </div>
              <div className="p-3">
                <span className="text-xs text-faint">Fill price</span>
                <strong className="mt-1 block font-mono text-sm font-medium text-ink">{formatNumber(receipt.price, market.priceDecimals)} {unit}</strong>
              </div>
              <div className="p-3">
                <span className="text-xs text-faint">Fees</span>
                <strong className="mt-1 block font-mono text-sm font-medium text-ink">{formatUsd(receipt.fees, 2)}</strong>
              </div>
              <div className="p-3">
                <span className="text-xs text-faint">Guarantee</span>
                <strong className="mt-1 block text-sm font-medium text-ink">{receipt.guarantee}</strong>
              </div>
              <div className="p-3">
                <span className="text-xs text-faint">Collateral released</span>
                <strong className="mt-1 block font-mono text-sm font-medium text-ink">{receipt.collateralReleasedUsd != null ? formatUsd(receipt.collateralReleasedUsd, 2) : "Unavailable"}</strong>
              </div>
              <div className="p-3">
                <span className="text-xs text-faint">Realized PnL</span>
                <strong className="mt-1 block font-mono text-sm font-medium text-ink">{receipt.realizedPnlUsd != null ? formatUsd(receipt.realizedPnlUsd, 2) : "Unavailable"}</strong>
              </div>
            </div>
            <div className="border-t border-line px-3 py-2.5 text-xs leading-relaxed text-dim">
              {outcome === "CLOSED"
                ? "This exit closed the package position. The position was removed from active positions and pro-rata collateral was released in the local demo runtime. It is not an Arbitrum transaction, proof, or production audit record."
                : outcome === "REDUCED"
                  ? "This exit reduced the package position. Remaining lots stay active with pro-rata collateral in the local demo runtime. It is not an Arbitrum transaction, proof, or production audit record."
                  : "This completed outcome is generated by the local demo clearing runtime. It is useful for reviewing the user flow, but it is not an Arbitrum transaction, proof, or production audit record."}
            </div>
          </section>

          <aside className="border border-line bg-panel p-3">
            <SectionLabel>Evidence class</SectionLabel>
            <p className="mt-2 text-sm text-ink">Local demo</p>
            <p className="mt-1 text-xs leading-relaxed text-faint">
              Mainnet writes are disabled. The receipt remains available only in this browser session.
            </p>
          </aside>
        </div>

        {selectedQuote ? (
          <section className="mt-4 border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
              <SectionLabel>Private RFQ evidence</SectionLabel>
              <span className="text-xs text-faint">executed locally</span>
            </div>
            <EvidenceRow label="Solver" value={selectedQuote.solverLabel} />
            <EvidenceRow
              label="Package price"
              value={`${formatNumber(selectedQuote.packagePrice, market.priceDecimals)} ${unit}`}
            />
            <EvidenceRow label="Fee cap" value={formatUsd(selectedQuote.feeCap, 2)} />
            <EvidenceRow label="Capacity" value={formatLots(selectedQuote.capacityLots)} />
            <EvidenceRow
              label="Quote expires"
              value={new Date(selectedQuote.expiresAt).toLocaleString()}
            />
            <EvidenceRow label="Quote ID" value={selectedQuote.id} />
          </section>
        ) : null}

        <section className="mt-4 border border-line bg-panel">
          <div className="border-b border-line px-3 py-2.5">
            <SectionLabel>Verifiable fields</SectionLabel>
          </div>
          <EvidenceRow label="Outcome" value={`${outcomeLabel} ${receipt.packageSide === "SHORT" ? "Short" : "Long"}`} />
          <EvidenceRow label="Package side" value={receipt.packageSide} />
          <EvidenceRow label="Order hash" value={receipt.orderHash} />
          <EvidenceRow label="Fill ID" value={receipt.fillId} />
          <EvidenceRow label="Transaction reference" value={receipt.transactionHash} />
          <EvidenceRow label="Execution route" value={receipt.routeLabel} />
          <EvidenceRow label="Created" value={new Date(receipt.createdAt).toLocaleString()} />
          <EvidenceRow label="Timeline steps" value={execution ? `${execution.updates.length} recorded` : "Not retained"} />
        </section>
      </div>
    </main>
  );
}
