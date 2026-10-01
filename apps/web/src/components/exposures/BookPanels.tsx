"use client";

import Link from "next/link";
import { ConnectWalletButton, Empty, ProvenanceChip } from "@/components/home/kit";
import { Chip, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { formatExpiry, formatNumber, formatShare } from "@/lib/terminal/format";
import { NETTING_WINDOW_DAYS, assetBase, protectiveNotional } from "@/lib/exposures/book";
import type { ExposureBook } from "@/lib/exposures/types";
import type { ExecutionPosition } from "@/lib/internal-gateway/types";
import type { ReferenceQuote } from "@/lib/market-data/types";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { amountText } from "./ExposureTable";
import { AssetIcon } from "@/components/icons/AssetIcon";
import { MarketMark } from "@/components/portfolio/MarketMark";

/** Zero is the centre rule; long net extends right, short net extends left. */
function NetBar({ value, scale }: { value: number; scale: number }) {
  const width = scale === 0 ? 0 : Math.min(1, Math.abs(value) / scale) * 50;
  return (
    <span aria-hidden="true" className="relative block h-[10px] w-full min-w-[56px]">
      <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
      <span
        className={`absolute top-[2px] bottom-[2px] transition-[width] duration-300 ease-out ${
          value >= 0 ? "left-1/2 rounded-r-[2px] bg-dim/70" : "right-1/2 rounded-l-[2px] bg-dim/40"
        }`}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

export function NettingPanel({ book }: { book: ExposureBook }) {
  const scale = Math.max(1, ...book.assets.map((asset) => Math.abs(asset.net)));
  return (
    <Panel label="Netting by asset" delay={60}>
      <PanelHead
        title="Netting by asset"
        tools={<Chip tone="neutral" title="Opposite exposures offset when their dates fall within this window">{`${NETTING_WINDOW_DAYS}d window`}</Chip>}
      />
      {book.assets.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">Netting appears once the book holds exposures.</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="relative w-full min-w-[560px] border-collapse text-left">
            <caption className="sr-only">Gross, net, netted, hedged, and residual exposure per asset in USDC</caption>
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Asset</th>
                <th className={TH_NUM}>Loses on fall</th>
                <th className={TH_NUM}>Loses on rise</th>
                <th className={TH_NUM}>Net</th>
                <th className={`${TH} w-[16%]`}>
                  <span className="sr-only">Net direction</span>
                </th>
                <th className={TH_NUM}>Netted</th>
                <th className={TH_NUM}>Hedges</th>
                <th className={TH_NUM}>Residual</th>
              </tr>
            </thead>
            <tbody>
              {book.assets.map((asset) => (
                <tr key={asset.asset} className="h-9 border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50">
                  <td className="px-3">
                    <span className="flex items-center gap-1.5">
                      <AssetIcon symbol={asset.asset} size={14} />
                      <span className="font-mono text-xs text-ink">{asset.asset}</span>
                      <span className="tnum font-mono text-[10.5px] text-faint">{asset.count}</span>
                      {asset.excessHedge > 0 ? (
                        <Chip tone="brand" title={`${formatNumber(asset.excessHedge, 0)} USDC of protective positions has no residual exposure to cover`}>
                          Over-hedged
                        </Chip>
                      ) : null}
                    </span>
                  </td>
                  <td className="tnum px-3 text-right font-mono text-xs text-dim">{amountText(asset.long)}</td>
                  <td className="tnum px-3 text-right font-mono text-xs text-dim">{amountText(asset.short)}</td>
                  <td className="tnum px-3 text-right font-mono text-xs text-ink">{`${asset.net > 0 ? "+" : asset.net < 0 ? "-" : ""}${amountText(Math.abs(asset.net))}`}</td>
                  <td className="px-3">
                    <NetBar value={asset.net} scale={scale} />
                  </td>
                  <td className="tnum px-3 text-right font-mono text-xs text-dim">{amountText(asset.matched)}</td>
                  <td className="tnum px-3 text-right font-mono text-xs text-dim">{amountText(asset.hedgeAllocated)}</td>
                  <td className={`tnum px-3 text-right font-mono text-xs ${asset.residual > 0 ? "text-ink" : "text-faint"}`}>{amountText(asset.residual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

interface Bucket {
  key: string;
  label: string;
  amount: number;
  covered: number;
}

export function CoverageByMonth({ book }: { book: ExposureBook }) {
  const buckets = new Map<string, Bucket>();
  for (const view of book.views) {
    const key = view.record.exposureDateIso.slice(0, 7);
    const bucket = buckets.get(key) ?? { key, label: formatExpiry(`${key}-01`).slice(3), amount: 0, covered: 0 };
    bucket.amount += view.record.amount;
    bucket.covered += view.netted + view.protectedAmount;
    buckets.set(key, bucket);
  }
  const rows = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  const max = Math.max(1, ...rows.map((row) => row.amount));
  return (
    <Panel label="Coverage by month" delay={90}>
      <PanelHead title="Coverage by month" tools={<ProvenanceChip kind="ESTIMATED" title="Netting and position allocation are calculated here from your book and the connected account." />} />
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">Dated coverage appears once the book holds exposures.</p>
      ) : (
        <ul className="px-3 py-2">
          {rows.map((row) => {
            const share = row.amount > 0 ? Math.min(1, row.covered / row.amount) : 0;
            return (
              <li key={row.key} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3 py-1.5">
                <span className="tnum font-mono text-[11px] text-dim">{row.label}</span>
                <span className="relative block h-3 overflow-hidden rounded-[3px] bg-inset" style={{ width: `${Math.max(8, (row.amount / max) * 100)}%` }}>
                  <span className="absolute inset-y-0 left-0 rounded-[3px] bg-up/70 transition-[width] duration-300 ease-out" style={{ width: `${share * 100}%` }} />
                  <span className="absolute inset-0 rounded-[3px] border border-line-strong" />
                </span>
                <span className="tnum text-right font-mono text-[11px]">
                  <span className="text-ink">{amountText(row.amount)}</span>
                  <span className="ml-1.5 text-faint">{formatShare(share, 0)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function CoverageSources({
  connected,
  positions,
  markets,
  references,
  allocated,
}: {
  connected: boolean;
  positions: readonly ExecutionPosition[];
  markets: readonly PackageMarket[];
  /** Chainlink references keyed by underlying; positions are valued at their delta there. */
  references: Record<string, ReferenceQuote>;
  allocated: ReadonlyMap<string, number>;
}) {
  return (
    <Panel label="Protection from account positions" delay={120}>
      <PanelHead title="Account hedges" tools={<ProvenanceChip kind="OBSERVED" title="Positions read from the connected onchain account." />} />
      {!connected ? (
        <Empty title="No account connected" detail="Connect a wallet to count your open positions as protection against these exposures.">
          <ConnectWalletButton />
        </Empty>
      ) : positions.length === 0 ? (
        <Empty title="No positions yet" detail="Protect an exposure to open a position; it is matched back here by asset, side, and tenor.">
          <Link
            href="/hedges"
            className="focus-ring inline-flex h-11 items-center rounded-md border border-line-strong bg-raised px-3 text-xs text-ink transition-colors hover:border-brand-edge lg:h-8"
          >
            Open hedge builder
          </Link>
        </Empty>
      ) : (
        <ul>
          {positions.map((position) => {
            const market = markets.find((candidate) => candidate.id === position.marketId);
            if (!market) return null;
            const notional = protectiveNotional(position, market, references);
            const used = allocated.get(position.id) ?? 0;
            return (
              <li key={position.id} className="border-b border-line-soft px-3 py-2 last:border-b-0">
                <Link href={tradeHref(market)} className="focus-ring flex items-center justify-between gap-3 rounded-sm">
                  <MarketMark underlying={market.underlying} size={16} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">{packageLabel(market)}</span>
                    <span className="tnum block font-mono text-[11px] text-faint">{`${position.side} ${formatNumber(position.lots, 0)} lots / ${assetBase(market.underlying)} / ${formatExpiry(market.expiryIso.slice(0, 10))}`}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`tnum block font-mono text-xs ${notional === null ? "text-faint" : "text-ink"}`}>
                      {notional === null ? "No price" : amountText(notional)}
                    </span>
                    <span className="tnum block font-mono text-[11px] text-faint">
                      {notional === null ? "awaiting reference" : `${formatShare(notional > 0 ? used / notional : 0, 0)} allocated`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
