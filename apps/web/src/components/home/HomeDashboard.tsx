"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDownToLine, CandlestickChart } from "lucide-react";
import { ChainIcon, chainLabelOf } from "@/components/icons/AssetIcon";
import { useAlertInbox } from "@/components/alerts/useAlertInbox";
import { AlertLine } from "@/components/alerts/parts";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { usePortfolio } from "@/components/portfolio/usePortfolio";
import { Chip, Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { systemHealth } from "@/lib/alerts";
import { buildExposureBook } from "@/lib/exposures/book";
import { EMPTY_EXPOSURE_BOOK, EXPOSURE_BOOK_KEY, parseExposureBook } from "@/lib/exposures/records";
import type { ExposureRecord } from "@/lib/exposures/types";
import { useSizeUnit } from "@/lib/settings/preferences";
import { formatNumber, formatShare, priceUnitSuffix, evidenceLabel } from "@/lib/terminal/format";
import { DEFAULT_MARKET_ID, DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";
import { AccountSummary } from "./AccountSummary";
import { BUTTON_GHOST, BUTTON_PRIMARY, PageFrame, PageHeader, PanelLink, WalletBadge, useOperatorReading, useWallClock } from "./kit";
import { Opportunities } from "./Opportunities";
import { PendingActions } from "./PendingActions";
import { pendingActions } from "./pending";
import { QuickLinks, type QuickLink } from "./QuickLinks";
import { SystemHealthPanel } from "./SystemHealthPanel";

export function HomeDashboard() {
  const read = usePortfolio();
  const { snapshot, markets } = read;
  const nowSeconds = useChainNow();
  const board = useMarketBoard();
  const nowMs = useWallClock();
  const inbox = useAlertInbox();
  const [unit] = useSizeUnit();
  const { reading, recheck } = useOperatorReading();
  const [records] = usePersistentState<ExposureRecord[]>(EXPOSURE_BOOK_KEY, EMPTY_EXPOSURE_BOOK, parseExposureBook);

  const pending = useMemo(
    () => pendingActions(snapshot, markets, nowSeconds, nowMs),
    [snapshot, markets, nowSeconds, nowMs],
  );
  const health = useMemo(
    () => systemHealth(snapshot, reading, { status: board.status, snapshot: board.snapshot }),
    [snapshot, reading, board.status, board.snapshot],
  );
  const book = useMemo(
    () => buildExposureBook(records, snapshot.positions, markets, { references: board.references }),
    [records, snapshot.positions, markets, board.references],
  );

  const lead = markets.find((market) => market.id === DEFAULT_MARKET_ID) ?? markets[0];
  const activeRfqs = snapshot.rfqRequests.filter(
    (request) => (request.state === "OPEN" || request.state === "SELECTED") && Date.parse(request.expiresAt) > nowMs,
  );
  const quotedRfqs = activeRfqs.filter((request) => request.state === "SELECTED" || request.quotes.length > 0).length;
  const qualified = markets.filter((market) => market.qualification === "QUALIFIED").length;
  const links: QuickLink[] = [
    {
      id: "trade",
      label: "Trade",
      href: DEFAULT_TRADE_HREF,
      icon: "trade",
      stat: lead ? `${lead.code} ${formatNumber(lead.netPrice, lead.priceDecimals)} ${priceUnitSuffix(lead.priceUnit)}` : "-",
      note: `${markets.length} markets / ${qualified} qualified`,
    },
    {
      id: "protect",
      label: "Protect",
      href: "/protect/new",
      icon: "protect",
      stat: book.residual > 0 ? `${formatNumber(book.residual / 1000, 1)}k unhedged` : "Outcome-first hedge",
      note: "Lock, cap, or bound a dated flow",
    },
    { id: "strategies", label: "Strategies", href: "/strategies", icon: "strategies", stat: "Studio and templates", note: "Multi-leg packages and payoff" },
    {
      id: "rfqs",
      label: "RFQs",
      href: "/rfqs",
      icon: "rfqs",
      stat: activeRfqs.length > 0 ? `${activeRfqs.length} active / ${quotedRfqs} quoted` : "None active",
      note: "Private multi-maker quotes",
    },
    {
      id: "portfolio",
      label: "Portfolio",
      href: "/portfolio",
      icon: "portfolio",
      stat: `${snapshot.positions.length} ${snapshot.positions.length === 1 ? "package" : "packages"}`,
      note: "Positions, risk, and collateral",
    },
    {
      id: "exposures",
      label: "Exposures",
      href: "/exposures",
      icon: "exposures",
      stat: records.length > 0 ? `${formatShare(book.coverage, 0)} covered` : "No exposures yet",
      note: `${records.length} in this browser`,
    },
  ];

  const preview = inbox.alerts.slice(0, 5);

  return (
    <PageFrame label="Home">
      <PageHeader
        title="Home"
        subtitle="Account and system"
        chips={
          <>
            <Chip tone="neutral" title={`Chain ${snapshot.environment.chainId}`}>
              <ChainIcon size={12} />
              {`${chainLabelOf(snapshot.environment.chainId)} / ${evidenceLabel(snapshot.environment.evidence)} evidence`}
            </Chip>
            <Chip tone="down" title="No wallet, operator, or deployment action writes to Arbitrum One from this platform.">
              Mainnet writes off
            </Chip>
          </>
        }
        actions={
          <>
            <span className="hidden lg:inline-flex">
              <WalletBadge />
            </span>
            <Link href="/portfolio/collateral?transfer=deposit" className={BUTTON_GHOST}>
              <ArrowDownToLine size={13} aria-hidden="true" />
              Deposit
            </Link>
            <Link href={DEFAULT_TRADE_HREF} className={BUTTON_PRIMARY}>
              <CandlestickChart size={13} aria-hidden="true" />
              Trade
            </Link>
          </>
        }
      />

      {/* One column on phones and tablets, ordered for triage: account, shortcuts, actions, alerts, markets, health. */}
      <div className="flex min-w-0 flex-col gap-1 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-1">
          <div className="order-1 min-w-0 xl:order-none">
            <AccountSummary read={read} unit={unit} />
          </div>
          <div className="order-2 min-w-0 xl:order-none">
            <QuickLinks links={links} />
          </div>
          <div className="order-3 min-w-0 xl:order-none">
            <PendingActions items={pending.items} listedFixings={pending.listedFixings} />
          </div>
          <div className="order-5 min-w-0 xl:order-none">
            <Opportunities markets={markets} />
          </div>
        </div>
        <aside className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-1">
          <div className="order-4 min-w-0 xl:order-none">
            <Panel label="Alerts" delay={90}>
              <PanelHead
                title="Alerts"
                tools={
                  <span className="flex items-center gap-2">
                    {inbox.count > 0 ? <Chip tone="down" dot>{`${inbox.count} open`}</Chip> : <Chip tone="dim">Clear</Chip>}
                    <PanelLink href="/alerts">All</PanelLink>
                  </span>
                }
              />
              {preview.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-faint">No alerts. Rules watch the board and your account.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {preview.map((alert) => (
                    <li key={alert.id}>
                      <AlertLine alert={alert} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <div className="order-6 min-w-0 xl:order-none">
            <SystemHealthPanel rows={health} onRecheck={recheck} checking={reading.state === "PENDING"} />
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}
