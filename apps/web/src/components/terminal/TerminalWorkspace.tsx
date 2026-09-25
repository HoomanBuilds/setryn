"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { AnalysisPanel, type VizTab } from "@/components/terminal/AnalysisPanel";
import { ConsolePanel } from "@/components/terminal/ConsolePanel";
import { ContractSpec, MarketHeader, MarketStatGrid } from "@/components/terminal/MarketHeader";
import { OrderBookPanel } from "@/components/terminal/OrderBookPanel";
import { OrderTicket } from "@/components/terminal/OrderTicket";
import { Disclosure, Tabs } from "@/components/terminal/primitives";
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
import type { OrderExecutionProgress } from "@/lib/internal-gateway/types";

type MobileTab = "market" | "book" | "order" | "positions";

const MOBILE_TABS = [
  { id: "market", label: "Market" },
  { id: "book", label: "Book" },
  { id: "order", label: "Ticket" },
  { id: "positions", label: "Positions" },
];

function executionError(error: unknown): string {
  if (!(error instanceof Error)) return "The demo runtime could not complete this package order.";
  if (error.message === "CONNECT_WALLET") return "Connect a wallet before authorizing this package.";
  if (error.message === "INSUFFICIENT_AVAILABLE_COLLATERAL") {
    return "Available collateral no longer covers this package and its fee cap.";
  }
  if (error.message === "AUTHORIZATION_EXPIRED") return "The authorization expired before submission. Review and try again.";
  if (error.message === "SIGNER_MISMATCH") return "The active wallet does not match the package authorization.";
  if (error.message === "MAINNET_WRITE_DISABLED") return "Mainnet writes are disabled by the Setryn demo runtime.";
  return "The demo runtime did not reach a final package outcome. No completion is claimed.";
}

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
  const gateway = useInternalGateway();
  const gatewaySnapshot = useGatewaySnapshot();

  const [vizTab, setVizTab] = useState<VizTab>("price");
  const [consoleTab, setConsoleTab] = useState<ConsoleTabId>("strategies");
  const [consoleScoped, setConsoleScoped] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("market");
  const [ticket, setTicket] = useState<TicketState>(() => initialTicket(market));
  const [stage, setStage] = useState<StageState>({ kind: "IDLE" });
  const [execution, setExecution] = useState<OrderExecutionProgress>({ status: "IDLE", updates: [] });
  const [loadedExecutionMarketId, setLoadedExecutionMarketId] = useState<string | null>(null);
  const [stream, setStream] = useState(() => initialPreviewStream(market.id));
  const [pricedMarketId, setPricedMarketId] = useState(market.id);

  /* A route change repoints the ticket during the same render, so a limit price
     from the previous market is never painted under the new one. View
     preferences are not market state and survive the switch. */
  if (pricedMarketId !== market.id) {
    setPricedMarketId(market.id);
    setTicket(initialTicket(market));
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setLoadedExecutionMarketId(null);
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

  useEffect(() => {
    if (loadedExecutionMarketId === market.id) return;
    const latest = gatewaySnapshot.executions.find(
      (candidate) => candidate.result.position.marketId === market.id,
    );
    if (latest) {
      setExecution({ status: "COMPLETED", updates: latest.updates, result: latest.result });
      setStage({ kind: "COMPLETED", reference: latest.id, receiptId: latest.result.receipt.id });
    }
    setLoadedExecutionMarketId(market.id);
  }, [gatewaySnapshot.executions, loadedExecutionMarketId, market.id]);

  const activeStream =
    stream.marketId === market.id ? stream : initialPreviewStream(market.id);
  const liveMarket = useMemo(
    () => derivePreviewMarket(market, activeStream),
    [market, activeStream],
  );
  const previewEpochSeconds =
    Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 1_000) + activeStream.tick;

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
    const feePerLot =
      (liveMarket.notionalPerLot * ((route?.protocolFeeBps ?? 2.5) + (route?.counterpartyFeeBps ?? 0))) /
      10_000;
    const byCollateral = Math.floor(
      gatewaySnapshot.account.available / (liveMarket.collateralPerLot * multiple + feePerLot),
    );
    const byCapacity = route ? route.availableLots : liveMarket.firmDepthLots;
    return Math.max(1, Math.min(byCollateral, byCapacity));
  }, [gatewaySnapshot.account.available, liveMarket, route]);

  const selectMarket = useCallback((next: PackageMarket) => router.push(tradeHref(next)), [router]);

  const patchTicket = useCallback(
    (patch: Partial<TicketState>) => {
      setStage({ kind: "IDLE" });
      setExecution({ status: "IDLE", updates: [] });
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

  const onConfirm = useCallback(async () => {
    if (stage.kind !== "COMPILED" || !route) return;
    const reference = stage.reference;
    try {
      if (gateway.getSnapshot().wallet.status !== "CONNECTED") {
        setStage({ kind: "EXECUTING", reference });
        setExecution({ status: "CONNECTING", updates: [] });
        await gateway.connectWallet();
      }

      setStage({ kind: "EXECUTING", reference });
      setExecution((current) => ({ ...current, status: "AUTHORIZING" }));
      const account = gateway.getSnapshot().account;
      const signer = gateway.getSnapshot().wallet.address;
      const authorization = await gateway.authorizeOrder({
        accountId: account.id,
        marketId: liveMarket.id,
        packageCode: liveMarket.code,
        routeId: route.id,
        routeLabel: route.label,
        side: ticket.intent,
        lots: preview.lots,
        limitPrice: preview.limitPrice,
        executionPrice: preview.effectivePrice,
        timeInForce: ticket.tif,
        feeCap: preview.totalFees,
        collateralRequired: preview.totalCollateral,
        recipient: signer ?? "",
        disclosure: ticket.privateRfq ? "PRIVATE_RFQ" : "PUBLIC",
        settlementGuarantee: preview.settlementGuarantee,
      });

      setExecution({ status: "SUBMITTING", updates: [], authorization });
      const result = await gateway.submitAuthorizedOrder(authorization, (update) => {
        setExecution((current) => ({
          ...current,
          status: "SUBMITTING",
          updates: [...current.updates, update],
        }));
      });
      setExecution((current) => ({ ...current, status: "COMPLETED", result }));
      setStage({ kind: "COMPLETED", reference, receiptId: result.receipt.id });
      setConsoleTab("strategies");
      setConsoleScoped(true);
    } catch (error) {
      const message = executionError(error);
      setExecution((current) => ({ ...current, status: "FAILED", error: message }));
      setStage({ kind: "FAILED", reference, message });
    }
  }, [gateway, liveMarket, preview, route, stage, ticket]);

  const onReset = useCallback(() => {
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
  }, []);

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
            execution={execution}
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
            runtimePositions={gatewaySnapshot.positions}
            runtimeReceipts={gatewaySnapshot.receipts}
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
