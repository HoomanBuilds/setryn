"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnalysisPanel, type VizTab } from "@/components/terminal/AnalysisPanel";
import { ConsolePanel } from "@/components/terminal/ConsolePanel";
import { ContractSpec, MarketHeader, MarketStatGrid } from "@/components/terminal/MarketHeader";
import { OrderBookPanel } from "@/components/terminal/OrderBookPanel";
import { OrderTicket } from "@/components/terminal/OrderTicket";
import { Disclosure, Tabs } from "@/components/terminal/primitives";
import { COLLATERAL_TOTALS } from "@/lib/terminal/account";
import {
  bestReferencePrice,
  buildPreview,
  previewReference,
  routePrice,
  type Intent,
  type StageState,
  type TicketState,
} from "@/lib/terminal/economics";
import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import {
  advancePreviewStream,
  derivePreviewMarket,
  initialPreviewStream,
} from "@/lib/terminal/preview-market";
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

/** The route owns the selected market. Nothing here mirrors it into state. */
export function TerminalWorkspace({ market }: { market: PackageMarket }) {
  const router = useRouter();

  const [vizTab, setVizTab] = useState<VizTab>("price");
  const [consoleTab, setConsoleTab] = useState<ConsoleTabId>("strategies");
  const [consoleScoped, setConsoleScoped] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("market");
  const [ticket, setTicket] = useState<TicketState>(() => initialTicket(market));
  const [stage, setStage] = useState<StageState>({ kind: "IDLE" });
  const [stream, setStream] = useState(() => initialPreviewStream(market.id));
  const [pricedMarketId, setPricedMarketId] = useState(market.id);

  /* A route change repoints the ticket during the same render, so a limit price
     from the previous market is never painted under the new one. View
     preferences are not market state and survive the switch. */
  if (pricedMarketId !== market.id) {
    setPricedMarketId(market.id);
    setTicket(initialTicket(market));
    setStage({ kind: "IDLE" });
    setStream(initialPreviewStream(market.id));
    setConsoleScoped(true);
  }

  useEffect(() => {
    setStream(initialPreviewStream(market.id));
    const timer = window.setInterval(() => {
      setStream((current) => advancePreviewStream(market.id, current));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [market.id]);

  const activeStream =
    stream.marketId === market.id ? stream : initialPreviewStream(market.id);
  const liveMarket = useMemo(
    () => derivePreviewMarket(market, activeStream),
    [market, activeStream],
  );
  const previewEpochSeconds =
    Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 1_000) + activeStream.tick;

  useEffect(() => {
    if (stage.kind !== "QUEUED") return;
    const reference = stage.reference;
    const timer = window.setTimeout(() => setStage({ kind: "SETTLED_PREVIEW", reference }), 1_400);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const route = useMemo(
    () => liveMarket.routes.find((candidate) => candidate.id === ticket.routeId) ?? null,
    [liveMarket, ticket.routeId],
  );

  const preview = useMemo(
    () => buildPreview(liveMarket, ticket, route),
    [liveMarket, ticket, route],
  );

  const maxLots = useMemo(() => {
    const multiple = route?.collateralMultiple ?? 1;
    const byCollateral = Math.floor(
      COLLATERAL_TOTALS.available / (liveMarket.collateralPerLot * multiple),
    );
    const byCapacity = route ? route.availableLots : liveMarket.firmDepthLots;
    return Math.max(1, Math.min(byCollateral, byCapacity));
  }, [liveMarket, route]);

  const selectMarket = useCallback((next: PackageMarket) => router.push(tradeHref(next)), [router]);

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
            liveMarket.routes.find((candidate) => candidate.id === next.routeId) ?? null;
          next.limitInput = (
            nextRoute
              ? routePrice(nextRoute, next.intent)
              : bestReferencePrice(liveMarket, next.intent)
          ).toFixed(liveMarket.priceDecimals);
        }
        return next;
      });
    },
    [liveMarket],
  );

  const selectBookRow = useCallback(
    (row: BookRow) => {
      setStage({ kind: "IDLE" });
      setTicket((current) => ({
        ...current,
        intent: row.side === "ASK" ? "ENTER" : "EXIT",
        limitInput: row.price.toFixed(liveMarket.priceDecimals),
      }));
    },
    [liveMarket.priceDecimals],
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
      reference: previewReference(liveMarket.id, preview.lots, preview.limitPrice),
    });
  }, [liveMarket.id, preview.lots, preview.limitPrice]);

  const onConfirm = useCallback(() => {
    setStage((current) =>
      current.kind === "COMPILED" ? { kind: "QUEUED", reference: current.reference } : current,
    );
  }, []);

  const onReset = useCallback(() => setStage({ kind: "IDLE" }), []);

  const show = (tab: MobileTab) => (mobileTab === tab ? "flex" : "hidden");
  const activePrice = Number.parseFloat(ticket.limitInput);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-app">
      <MarketHeader market={liveMarket} onSelectMarket={selectMarket} />

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
              market={liveMarket}
              baseMarket={market}
              tab={vizTab}
              onTab={setVizTab}
              lots={Math.max(1, preview.lots)}
              previewEpochSeconds={previewEpochSeconds}
            />
          </div>
          <div className="shrink-0 px-3 lg:hidden">
            <Disclosure summary="Market stats and contract">
              <div className="space-y-4">
                <MarketStatGrid market={liveMarket} />
                <ContractSpec market={liveMarket} />
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
          <OrderBookPanel
            market={liveMarket}
            activePrice={activePrice}
            onSelectRow={selectBookRow}
          />
        </div>

        <div
          id="mobile-panel-order"
          role="tabpanel"
          aria-labelledby="mobile-tab-order"
          className={`${show("order")} min-h-0 min-w-0 flex-1 flex-col border-line lg:col-start-3 lg:row-start-1 lg:row-end-3 lg:flex lg:border-l`}
        >
          <OrderTicket
            market={liveMarket}
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
            market={liveMarket}
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
