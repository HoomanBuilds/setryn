"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { BUTTON_SECONDARY, Empty, PageFrame, PageHeader, ProvenanceChip, WalletBadge } from "@/components/home/kit";
import { rangeTerms } from "@/lib/portfolio/forward";
import { Chip, DeskTabs, Meter, Panel, PanelHead, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { buildExposureBook } from "@/lib/exposures/book";
import {
  EMPTY_EXPOSURE_BOOK,
  EXPOSURE_BOOK_KEY,
  hedgeBuilderHref,
  mergeExposures,
  parseExposureBook,
} from "@/lib/exposures/records";
import type { ExposureRecord, ExposureView } from "@/lib/exposures/types";
import { useSizeUnit } from "@/lib/settings/preferences";
import { formatExpiry, formatNumber, formatShare } from "@/lib/terminal/format";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";
import { CoverageByMonth, CoverageSources, NettingPanel } from "./BookPanels";
import { ExposureIntake } from "./ExposureIntake";
import { ExposureTable, amountText } from "./ExposureTable";

type Filter = "ALL" | "IMPORTED" | "FORECAST" | "CONFIRMED" | "NETTED" | "PROTECTED" | "UNHEDGED";

const FILTERS: { id: Filter; label: string; match: (view: ExposureView) => boolean }[] = [
  { id: "ALL", label: "All", match: () => true },
  { id: "IMPORTED", label: "Imported", match: (view) => view.record.source === "IMPORTED" },
  { id: "FORECAST", label: "Forecast", match: (view) => view.record.certainty === "FORECAST" },
  { id: "CONFIRMED", label: "Confirmed", match: (view) => view.record.certainty === "CONFIRMED" },
  { id: "NETTED", label: "Netted", match: (view) => view.netted > 0 },
  { id: "PROTECTED", label: "Protected", match: (view) => view.protectedAmount > 0 },
  { id: "UNHEDGED", label: "Unhedged", match: (view) => view.residual > 0 },
];

function Tile({ label, value, note, children }: { label: string; value: string; note: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-panel px-3 py-2.5">
      <span className="truncate text-[11px] text-faint">{label}</span>
      <span className="tnum mt-1 truncate font-mono text-[17px] leading-6 text-ink">{value}</span>
      <span className="mt-0.5 truncate text-[11px] text-off">{note}</span>
      {children ? <span className="mt-2 block">{children}</span> : null}
    </div>
  );
}

export function ExposuresWorkspace() {
  const snapshot = useGatewaySnapshot();
  const { markets, references } = useMarketBoard();
  /* Coverage reads day counts only, so the clock is sampled per minute. */
  const minute = Math.floor(useChainNow() / 60);
  const [records, setRecords] = usePersistentState<ExposureRecord[]>(EXPOSURE_BOOK_KEY, EMPTY_EXPOSURE_BOOK, parseExposureBook);
  const [unit] = useSizeUnit();
  const [filter, setFilter] = useState<Filter>("ALL");
  const connected = snapshot.wallet.status === "CONNECTED";

  const book = useMemo(
    () => buildExposureBook(records, snapshot.positions, markets, { references, nowMs: minute * 60_000 }),
    [records, snapshot.positions, markets, references, minute],
  );
  const views = useMemo(
    () => [...book.views].sort((a, b) => a.record.exposureDateIso.localeCompare(b.record.exposureDateIso)),
    [book.views],
  );
  const visible = views.filter(FILTERS.find((item) => item.id === filter)?.match ?? (() => true));
  const ids = useMemo(() => new Set(records.map((record) => record.id)), [records]);
  const allocated = useMemo(() => {
    const map = new Map<string, number>();
    for (const view of book.views) for (const link of view.links) map.set(link.positionId, (map.get(link.positionId) ?? 0) + link.allocated);
    return map;
  }, [book.views]);
  /* USD value of one lot at the Chainlink reference (else the live mark), for showing hedges in lots. */
  const lotSize = (marketId: string) => {
    const market = markets.find((candidate) => candidate.id === marketId);
    if (!market) return undefined;
    const level = references[market.underlying]?.price ?? market.netPrice;
    const value = rangeTerms(market).lotSize * level;
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };

  const addRecord = (record: ExposureRecord) => setRecords((current) => mergeExposures(current, [record]).book);
  const importRecords = (rows: ExposureRecord[]) => {
    const result = mergeExposures(records, rows);
    setRecords(result.book);
    return { added: result.added, duplicates: result.duplicates };
  };
  const tabs = FILTERS.map((item) => ({ id: item.id, label: item.label, badge: views.filter(item.match).length }));
  const next = book.nextUnprotected;

  return (
    <PageFrame label="Exposures">
      <PageHeader
        title="Exposures"
        subtitle="Imported, forecast, confirmed, netted, and protected"
        chips={
          <>
            <Chip tone="neutral">{`${records.length} ${records.length === 1 ? "exposure" : "exposures"}`}</Chip>
            <Chip tone="neutral" title="The exposure book lives in this browser. Coverage reads the connected onchain account.">
              Book in this browser
            </Chip>
            <Chip tone="neutral" title={`Chain ${snapshot.environment.chainId}`}>{`${snapshot.environment.label} account`}</Chip>
          </>
        }
        actions={
          <>
            {next ? (
              <Link href={hedgeBuilderHref(next.record, next.residual)} className={BUTTON_SECONDARY}>
                <ShieldCheck size={13} aria-hidden="true" />
                {`Protect next ${amountText(next.residual)}`}
              </Link>
            ) : null}
            <WalletBadge />
          </>
        }
      >
        <DeskTabs idBase="exposure-filter" items={tabs} value={filter} onChange={(id) => setFilter(id as Filter)} className="h-10" />
      </PageHeader>

      <section
        aria-label="Exposure totals"
        className={`${deskMotion.rise} grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 xl:grid-cols-6`}
      >
        <Tile label="Gross exposure" value={`${amountText(book.gross)} USDC`} note={`${records.length} dated cash flows`} />
        <Tile label="Netted" value={`${amountText(book.netted)} USDC`} note="offset inside the netting window" />
        <Tile label="Protected by positions" value={`${amountText(book.protectedAmount)} USDC`} note={connected ? `${snapshot.positions.length} account position${snapshot.positions.length === 1 ? "" : "s"}` : "connect to count positions"} />
        <Tile label="Unhedged residual" value={`${amountText(book.residual)} USDC`} note={book.residual > 0 ? "neither netted nor protected" : "fully covered"} />
        <Tile label="Coverage" value={formatShare(book.coverage, 1)} note="(netted + protected) / gross">
          <Meter value={book.coverage} tone={book.coverage >= 0.98 ? "up" : "brand"} label="Book coverage" />
        </Tile>
        <Tile
          label="Next unhedged"
          value={next ? formatExpiry(next.record.exposureDateIso) : "-"}
          note={next ? `${amountText(next.residual)} ${next.record.referenceAssetId} / ${next.horizonDays ?? "-"}d` : "nothing open"}
        />
      </section>

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-1">
          <Panel label="Exposure book" delay={30}>
            <PanelHead
              title="Exposure book"
              tools={
                <span className="flex items-center gap-1.5">
                  <ProvenanceChip kind="ESTIMATED" title="Netting and coverage are calculated from your book and the connected account's positions." />
                  <span className="tnum hidden font-mono text-[11px] text-faint sm:inline">{`${visible.length} shown`}</span>
                </span>
              }
            />
            <TabBody key={filter} idBase="exposure-filter">
              {records.length === 0 ? (
                <Empty
                  title="No exposures yet"
                  detail="Add a dated receivable, payable, holding, or unlock, or import rows from a treasury export. Netting and coverage update as you add them."
                />
              ) : visible.length === 0 ? (
                <Empty title="Nothing in this view" detail="Choose another filter above." />
              ) : (
                <ExposureTable
                  views={visible}
                  unit={unit}
                  lotSize={lotSize}
                  onRemove={(id) => setRecords((current) => current.filter((record) => record.id !== id))}
                />
              )}
            </TabBody>
            {records.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-faint">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-dim/60" />
                  Netted by an opposite exposure
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-up" />
                  Protected by an account position
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-line" />
                  Residual
                </span>
                <span className="ml-auto tnum font-mono">{`${formatNumber(book.gross, 0)} USDC gross`}</span>
              </div>
            ) : null}
          </Panel>

          <div className="grid min-w-0 gap-1 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <NettingPanel book={book} />
            <CoverageByMonth book={book} />
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-1">
          <ExposureIntake existingIds={ids} onAdd={addRecord} onImport={importRecords} />
          <CoverageSources
            connected={connected}
            positions={snapshot.positions}
            markets={markets}
            references={references}
            allocated={allocated}
          />
        </aside>
      </div>
    </PageFrame>
  );
}
