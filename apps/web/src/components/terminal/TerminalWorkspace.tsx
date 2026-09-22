"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisPanel, type VizTab } from "@/components/terminal/AnalysisPanel";
import { ConsolePanel } from "@/components/terminal/ConsolePanel";
import { GlobalHeader } from "@/components/terminal/GlobalHeader";
import {
  ContractSpec,
  MarketHeader,
  MarketStatGrid,
} from "@/components/terminal/MarketHeader";
import { OrderBookPanel } from "@/components/terminal/OrderBookPanel";
import { OrderTicket } from "@/components/terminal/OrderTicket";
import { StatusStrip } from "@/components/terminal/StatusStrip";
import { Disclosure, Tabs } from "@/components/terminal/primitives";
import { ACCOUNT } from "@/lib/terminal/account";
import {
  bestReferencePrice,
  buildPreview,
  previewReference,
  routePrice,
  type Intent,
  type StageState,
  type TicketState,
} from "@/lib/terminal/economics";
import { DEFAULT_MARKET_ID, findMarket } from "@/lib/terminal/markets";
import type { BookRow, ConsoleTabId, PackageMarket } from "@/lib/terminal/types";

type MobileTab = "market" | "book" | "order" | "positions";

const MOBILE_TABS = [
  { id: "market", label: "Market" },
  { id: "book", label: "Book" },
  { id: "order", label: "Ticket" },
  { id: "positions", label: "Positions" },
];

function initialTicket(market: PackageMarket): TicketState {
  return {
    intent: "ENTER",
    orderType: "MARKETABLE_LIMIT",
    lotsInput: "10",
    limitInput: market.bestAsk.toFixed(market.priceDecimals),
    tif: "GTC",
    privateRfq: false,
    routeId: null,
  };
}

export function TerminalWorkspace() {
  const [marketId, setMarketId] = useState(DEFAULT_MARKET_ID);
  const market = findMarket(marketId);

  const [vizTab, setVizTab] = useState<VizTab>("price");
  const [consoleTab, setConsoleTab] = useState<ConsoleTabId>("strategies");
  const [consoleScoped, setConsoleScoped] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("market");
  const [ticket, setTicket] = useState<TicketState>(() =>
    initialTicket(findMarket(DEFAULT_MARKET_ID)),
  );
  const [stage, setStage] = useState<StageState>({ kind: "IDLE" });
  const [snapshotOffset, setSnapshotOffset] = useState(0);

  /** Preview snapshots age visibly, then roll over, so freshness is never presented as live. */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSnapshotOffset((offset) => (market.snapshotAgeSeconds + offset >= 12 ? 0 : offset + 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [market.snapshotAgeSeconds]);

  useEffect(() => {
    if (stage.kind !== "QUEUED") return;
    const reference = stage.reference;
    const timer = window.setTimeout(() => setStage({ kind: "SETTLED_PREVIEW", reference }), 1_400);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const route = useMemo(
    () => market.routes.find((candidate) => candidate.id === ticket.routeId) ?? null,
    [market, ticket.routeId],
  );

  const preview = useMemo(() => buildPreview(market, ticket, route), [market, ticket, route]);

  const maxLots = useMemo(() => {
    const multiple = route?.collateralMultiple ?? 1;
    const byCollateral = Math.floor(ACCOUNT.available / (market.collateralPerLot * multiple));
    const byCapacity = route ? route.availableLots : market.firmDepthLots;
    return Math.max(1, Math.min(byCollateral, byCapacity));
  }, [market, route]);

  const selectMarket = useCallback((next: PackageMarket) => {
    setMarketId(next.id);
    setTicket(initialTicket(next));
    setStage({ kind: "IDLE" });
    setSnapshotOffset(0);
    setConsoleScoped(true);
  }, []);

  const patchTicket = useCallback(
    (patch: Partial<TicketState>) => {
      setStage({ kind: "IDLE" });
      setTicket((current) => {
        const next = { ...current, ...patch };
        if (patch.privateRfq === false && current.routeId === "SOLVER_RFQ") {
          next.routeId = null;
        }
        /* Picking a route or flipping intent reprices the ticket onto what that
           route can actually execute, so a fresh selection is never born invalid. */
        const reprice =
          patch.routeId !== undefined ||
          next.routeId !== current.routeId ||
          next.intent !== current.intent;
        if (reprice) {
          const nextRoute =
            market.routes.find((candidate) => candidate.id === next.routeId) ?? null;
          next.limitInput = (
            nextRoute
              ? routePrice(nextRoute, next.intent)
              : bestReferencePrice(market, next.intent)
          ).toFixed(market.priceDecimals);
        }
        return next;
      });
    },
    [market],
  );

  const selectBookRow = useCallback(
    (row: BookRow) => {
      setStage({ kind: "IDLE" });
      setTicket((current) => ({
        ...current,
        intent: row.side === "ASK" ? "ENTER" : "EXIT",
        limitInput: row.price.toFixed(market.priceDecimals),
      }));
    },
    [market.priceDecimals],
  );

  const openTicket = useCallback(
    (intent: Intent) => {
      patchTicket({ intent });
      setMobileTab("order");
    },
    [patchTicket],
  );

  const onStage = useCallback(() => {
    setStage({
      kind: "COMPILED",
      reference: previewReference(market.id, preview.lots, preview.limitPrice),
    });
  }, [market.id, preview.lots, preview.limitPrice]);

  const onConfirm = useCallback(() => {
    setStage((current) =>
      current.kind === "COMPILED" ? { kind: "QUEUED", reference: current.reference } : current,
    );
  }, []);

  const onReset = useCallback(() => setStage({ kind: "IDLE" }), []);

  const show = (tab: MobileTab) => (mobileTab === tab ? "flex" : "hidden");
  const snapshotAge = market.snapshotAgeSeconds + snapshotOffset;
  const activePrice = Number.parseFloat(ticket.limitInput);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-app">
      <GlobalHeader />
      <StatusStrip />
      <MarketHeader market={market} onSelectMarket={selectMarket} />

      <nav
        aria-label="Workspace sections"
        className="shrink-0 border-b border-line bg-panel lg:hidden"
      >
        <Tabs
          items={MOBILE_TABS}
          value={mobileTab}
          onChange={(id) => setMobileTab(id as MobileTab)}
          idBase="mobile"
          grow
        />
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_312px_368px] lg:grid-rows-[minmax(0,1fr)_minmax(196px,28%)]">
        <div
          id="mobile-panel-market"
          role="tabpanel"
          aria-labelledby="mobile-tab-market"
          className={`${show("market")} scroll-thin min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-panel lg:col-start-1 lg:row-start-1 lg:flex lg:overflow-hidden`}
        >
          <div className="flex min-h-[280px] flex-1 flex-col lg:min-h-0">
            <AnalysisPanel
              market={market}
              tab={vizTab}
              onTab={setVizTab}
              lots={Math.max(1, preview.lots)}
              snapshotAge={snapshotAge}
            />
          </div>
          <div className="shrink-0 px-3 lg:hidden">
            <Disclosure summary="Market stats and contract">
              <div className="space-y-4">
                <MarketStatGrid market={market} />
                <ContractSpec market={market} />
              </div>
            </Disclosure>
          </div>
        </div>

        <div
          id="mobile-panel-book"
          role="tabpanel"
          aria-labelledby="mobile-tab-book"
          className={`${show("book")} min-h-0 min-w-0 flex-1 flex-col border-line lg:col-start-2 lg:row-start-1 lg:row-end-3 lg:flex lg:border-l`}
        >
          <OrderBookPanel market={market} activePrice={activePrice} onSelectRow={selectBookRow} />
        </div>

        <div
          id="mobile-panel-order"
          role="tabpanel"
          aria-labelledby="mobile-tab-order"
          className={`${show("order")} min-h-0 min-w-0 flex-1 flex-col border-line lg:col-start-3 lg:row-start-1 lg:row-end-3 lg:flex lg:border-l`}
        >
          <OrderTicket
            market={market}
            state={ticket}
            preview={preview}
            route={route}
            stage={stage}
            maxLots={maxLots}
            onChange={patchTicket}
            onStage={onStage}
            onConfirm={onConfirm}
            onReset={onReset}
          />
        </div>

        <div
          id="mobile-panel-positions"
          role="tabpanel"
          aria-labelledby="mobile-tab-positions"
          className={`${show("positions")} min-h-0 min-w-0 flex-1 flex-col lg:col-start-1 lg:col-end-2 lg:row-start-2 lg:flex`}
        >
          <ConsolePanel
            market={market}
            tab={consoleTab}
            onTab={setConsoleTab}
            scoped={consoleScoped}
            onScopedChange={setConsoleScoped}
          />
        </div>
      </main>

      {mobileTab === "order" ? null : (
        <div className="pb-safe shrink-0 border-t border-line bg-panel px-3 pt-2.5 lg:hidden">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openTicket("ENTER")}
              className="focus-ring h-12 rounded-md bg-up text-sm font-semibold text-app"
            >
              Enter package
            </button>
            <button
              type="button"
              onClick={() => openTicket("EXIT")}
              className="focus-ring h-12 rounded-md bg-down text-sm font-semibold text-app"
            >
              Exit package
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
