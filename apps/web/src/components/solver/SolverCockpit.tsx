"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Route } from "lucide-react";
import { BUTTON_INK, BUTTON_QUIET, Chip, useWalletPrompt } from "@/components/activity/ledger-ui";
import { ProvenanceChip, countdownText, priceText, usd } from "@/components/auctions/board-kit";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Meter, Metric, Panel, PanelHead, deskMotion } from "@/components/strategies/desk/Desk";
import { auctionHouseOf } from "@/lib/auctions/reader";
import { describeActionError } from "@/lib/internal-gateway/action-errors";
import { useDeploymentRuntime, useOperatorStatus } from "@/lib/operations/hooks";
import { recoveryItems, requestStats, solverOpportunities } from "@/lib/solver/model";
import type { OpportunityState, RecoveryItem, SolverOpportunity } from "@/lib/solver/types";
import { formatLots } from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { AuctionsNote, CapacityPanel, HistoryPanel, RecoveryPanel, RoutePlanPanel, marketById } from "./SolverPanels";

const STATE_COPY: Record<OpportunityState, { label: string; tone: "up" | "neutral" | "muted" | "down" | "brand" }> = {
  OPEN: { label: "Open", tone: "up" },
  SELECTED: { label: "Selected", tone: "brand" },
  EXECUTED: { label: "Executed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  EXPIRED: { label: "Expired", tone: "muted" },
};

const GRID = "grid grid-cols-[minmax(180px,1.5fr)_76px_84px_56px_96px_96px_104px_84px] items-center gap-2";

function sideCopy(entry: SolverOpportunity): { label: string; className: string } {
  return entry.takerAction === "BUY"
    ? { label: `Buy ${formatLots(entry.lots)}`, className: "text-up" }
    : { label: `Sell ${formatLots(entry.lots)}`, className: "text-down" };
}

function OpportunityRow({
  entry,
  market,
  now,
  selected,
  onSelect,
  index,
}: {
  entry: SolverOpportunity;
  market: PackageMarket | null;
  now: number;
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const side = sideCopy(entry);
  const state = STATE_COPY[entry.state];
  const left = entry.deadline - now;
  const live = entry.state === "OPEN" || entry.state === "SELECTED";
  return (
    <li style={{ ["--i" as string]: index }} className={deskMotion.rise}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`focus-ring ${GRID} w-full border-b border-line px-3 py-2 text-left transition-colors duration-150 ${
          selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MarketMark underlying={market?.underlying} code={entry.marketId} size={16} />
          <span className="min-w-0">
            <span className="block truncate text-xs text-ink">{market ? packageLabel(market) : entry.marketId}</span>
            <span className="tnum block truncate font-mono text-[11px] text-faint">{`RFQ ${entry.id.slice(0, 10)}…`}</span>
          </span>
        </span>
        <span className={`tnum font-mono text-xs ${side.className}`}>{side.label}</span>
        <span className={`tnum font-mono text-xs ${live && left <= 10 ? "text-down" : live ? "text-ink" : "text-faint"}`}>
          {live ? countdownText(left) : "-"}
        </span>
        <span className="tnum text-right font-mono text-xs text-dim">{entry.quotes.length}</span>
        <span className="tnum text-right font-mono text-xs text-ink">{entry.bestQuote && market ? priceText(entry.bestQuote.packagePrice, market) : "-"}</span>
        <span className="tnum text-right font-mono text-xs text-dim">{entry.plan?.vwap != null && market ? priceText(entry.plan.vwap, market) : "No depth"}</span>
        <span className={`tnum text-right font-mono text-xs ${entry.improvementUsd === null ? "text-faint" : entry.improvementUsd >= 0 ? "text-up" : "text-down"}`}>
          {entry.improvementUsd === null ? "-" : `${usd(entry.improvementUsd, true)} USDC`}
        </span>
        <span className="flex justify-end">
          <Chip tone={state.tone}>{state.label}</Chip>
        </span>
      </button>
    </li>
  );
}

export function SolverCockpit() {
  const board = useMarketBoard();
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const runtime = useDeploymentRuntime();
  const operator = useOperatorStatus();
  const wallet = useWalletPrompt();
  const now = useChainNow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const opportunities = useMemo(() => solverOpportunities(snapshot, board.markets, board.snapshot, now), [board.markets, board.snapshot, now, snapshot]);
  const stats = useMemo(() => requestStats(opportunities), [opportunities]);
  const recovery = useMemo(() => recoveryItems(opportunities), [opportunities]);
  const selected = opportunities.find((entry) => entry.id === selectedId) ?? opportunities[0] ?? null;
  const selectedMarket = selected ? marketById(board.markets, selected.marketId) : null;
  const open = opportunities.filter((entry) => entry.state === "OPEN" || entry.state === "SELECTED");
  const bound = open.reduce((total, entry) => total + entry.collateralRequired, 0);
  const improvement = opportunities.reduce((total, entry) => total + (entry.state === "EXECUTED" && entry.improvementUsd !== null ? entry.improvementUsd : 0), 0);
  const auctionHouse = auctionHouseOf(runtime.data);

  const expire = async (item: RecoveryItem) => {
    if (busy) return;
    setBusy(item.id);
    setNotice(null);
    try {
      await gateway.cancelRfq(item.id);
      setNotice({ text: `Expired request ${item.id.slice(0, 10)}… and released its reserved collateral.`, ok: true });
    } catch (error) {
      setNotice({ text: describeActionError(error, { fallback: "The request could not be expired." }), ok: false });
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1" aria-label="Setryn solver desk">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Route size={16} aria-hidden="true" className="shrink-0 text-faint" />
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Solver desk</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">Private requests, firm quotes and the book behind them</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ProvenanceChip value="OBSERVED" title="Requests and quotes are read from the PrivateRfqBook for the connected account; book comparisons use the market-data feed." />
            <Chip tone={operator.data?.maker.available ? "up" : "muted"} dot>
              {operator.data?.maker.available ? "Designated maker quoting" : operator.data?.maker.available === false ? "No designated maker" : "Maker not reported"}
            </Chip>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lg:ml-auto">
            {wallet.connected ? null : (
              <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={`${BUTTON_INK} h-7`}>
                {wallet.connecting ? "Connecting..." : "Connect wallet"}
              </button>
            )}
            <Link href="/rfqs" className={`${BUTTON_QUIET} h-7`}>
              New request
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <section
        aria-label="Solver metrics"
        className={`${deskMotion.rise} grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 xl:grid-cols-8`}
        style={{ ["--rise-delay" as string]: "30ms" }}
      >
        <Metric className="bg-panel" label="Open requests" value={open.length} note={`${stats.total} in history`} />
        <Metric className="bg-panel" label="Quotes received" value={stats.quotesReceived} note={`${Math.round(stats.quoteRate * 100)}% of requests quoted`} />
        <Metric className="bg-panel" label="Executed" value={stats.executed} tone={stats.executed > 0 ? "up" : "neutral"} note={`${formatLots(stats.executedLots)} lots`} />
        <Metric className="bg-panel" label="Lapsed" value={stats.expired + stats.cancelled} note={`${stats.expired} expired / ${stats.cancelled} cancelled`} />
        <Metric
          className="bg-panel"
          label="Executed vs book"
          value={`${usd(improvement, true)} USDC`}
          tone={improvement > 0 ? "up" : improvement < 0 ? "down" : "neutral"}
          note="Best quote against today's book VWAP"
        />
        <Metric className="bg-panel" label="Bound by requests" value={`${usd(bound)} USDC`} note="Collateral the open orders need" />
        <Metric
          className="bg-panel"
          label="Available"
          value={wallet.connected ? `${usd(snapshot.account.available)} USDC` : "-"}
          tone={wallet.connected ? "up" : "dim"}
          note={wallet.connected ? `${usd(snapshot.account.posted)} posted` : "Connect a wallet"}
        >
          {wallet.connected && snapshot.account.posted > 0 ? (
            <Meter value={snapshot.account.available / snapshot.account.posted} tone="up" label="Available share of posted collateral" />
          ) : null}
        </Metric>
        <Metric className="bg-panel" label="Recovery" value={recovery.length} tone={recovery.length > 0 ? "brand" : "neutral"} note={recovery.length > 0 ? "lapsed requests to expire" : "nothing lapsed"} />
      </section>

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-1">
          <Panel label="Private requests" delay={20}>
            <PanelHead title="Private requests" tools={<span className="hidden text-[11px] text-faint sm:inline">Newest first, compared with the public book</span>} />
            {opportunities.length > 0 ? (
              <div className="scroll-thin overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className={`${GRID} border-b border-line px-3 py-1.5 text-[11px] text-faint`}>
                    <span>Request</span>
                    <span>Taker</span>
                    <span>Closes</span>
                    <span className="text-right">Quotes</span>
                    <span className="text-right">Best quote</span>
                    <span className="text-right">Book VWAP</span>
                    <span className="text-right" title="Best quote against taking the same size from the book, USDC">Vs book</span>
                    <span className="text-right">State</span>
                  </div>
                  <ul>
                    {opportunities.map((entry, index) => (
                      <OpportunityRow
                        key={entry.id}
                        entry={entry}
                        market={marketById(board.markets, entry.marketId)}
                        now={now}
                        selected={selected?.id === entry.id}
                        onSelect={() => setSelectedId(entry.id)}
                        index={index}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-xs text-faint">
                {wallet.connected ? "No private requests yet. Requests you send from the RFQ builder appear here with every quote they receive." : "Connect a wallet to read its private requests."}
              </p>
            )}
            {notice ? (
              <p role={notice.ok ? "status" : "alert"} className={`border-t border-line px-3 py-2 text-[11px] ${notice.ok ? "text-up" : "text-down"}`}>
                {notice.text}
              </p>
            ) : null}
          </Panel>

          <RoutePlanPanel opportunity={selected} market={selectedMarket} now={now} />
          <HistoryPanel stats={stats} />
        </div>

        <aside className="flex min-w-0 flex-col gap-1">
          <CapacityPanel account={wallet.connected ? snapshot.account : null} bound={bound} />
          <RecoveryPanel items={recovery} busy={busy} onExpire={expire} />
          <AuctionsNote listed={Boolean(auctionHouse)} />
        </aside>
      </div>
    </main>
  );
}
