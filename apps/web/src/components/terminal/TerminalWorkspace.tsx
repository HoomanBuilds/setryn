"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard, usePreviewMarket } from "@/components/terminal/PreviewMarketProvider";
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
import { parseHandoff, type HandoffContext } from "@/lib/terminal/handoff";
import { LIFECYCLE_STRATEGIES } from "@/lib/lifecycle/fixtures";
import { tradeHref } from "@/lib/terminal/markets";
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
    return "Available collateral plus released collateral no longer covers the fee cap.";
  }
  if (error.message === "AUTHORIZATION_EXPIRED") return "The authorization expired before submission. Review and try again.";
  if (error.message === "SIGNER_MISMATCH") return "The active wallet does not match the package authorization.";
  if (error.message === "MAINNET_WRITE_DISABLED") return "Mainnet writes are disabled by the Setryn demo runtime.";
  if (error.message === "CLOSE_POSITION_REQUIRED") return "Select an active package position to close.";
  if (error.message === "CLOSE_POSITION_FORBIDDEN_FOR_ENTRY") return "Entry orders cannot reference a position to close.";
  if (error.message === "POSITION_NOT_FOUND") return "The selected position is no longer active in this demo session.";
  if (error.message === "POSITION_MARKET_MISMATCH") return "The selected position does not belong to this market.";
  if (error.message === "INVALID_CLOSE_LOTS") return "Enter a close quantity above zero.";
  if (error.message === "CLOSE_LOTS_EXCEEDS_POSITION") return "Quantity exceeds the selected package lots. Reduce quantity to close within the active package.";
  if (error.message === "EXIT_REQUIRES_ZERO_COLLATERAL") return "Exits require no new collateral. Review the ticket and try again.";
  if (error.message === "INVALID_CONTRACT_MULTIPLIER") {
    return "The package multiplier is invalid and no package outcome was recorded.";
  }
  return "The demo runtime did not reach a final package outcome. No completion is claimed.";
}

function initialTicket(market: PackageMarket, handoff?: HandoffContext): TicketState {
  const intent = handoff?.intent ?? "ENTER";
  return {
    intent,
    orderType: "MARKETABLE_LIMIT",
    lotsInput: handoff?.lots != null ? String(handoff.lots) : "10",
    limitInput: (intent === "EXIT" ? market.bestBid : market.bestAsk).toFixed(
      market.priceDecimals,
    ),
    tif: "GTC",
    privateRfq: false,
    routeId: null,
    closePositionId:
      intent === "EXIT" && handoff?.lifecycleId ? handoff.lifecycleId : null,
  };
}

export function TerminalWorkspace({ market }: { market: PackageMarket }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center bg-app text-xs text-faint">
          Loading terminal
        </div>
      }
    >
      <WorkspaceContent market={market} />
    </Suspense>
  );
}

/** The route owns the selected market. Nothing here mirrors it into state. */
function WorkspaceContent({ market }: { market: PackageMarket }) {
  const router = useRouter();
  const gateway = useInternalGateway();
  const gatewaySnapshot = useGatewaySnapshot();
  const searchParams = useSearchParams();
  const handoff = useMemo(() => parseHandoff(searchParams), [searchParams]);

  const [vizTab, setVizTab] = useState<VizTab>("price");
  const [consoleTab, setConsoleTab] = useState<ConsoleTabId>("strategies");
  const [consoleScoped, setConsoleScoped] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("market");
  const [ticket, setTicket] = useState<TicketState>(() => initialTicket(market, handoff));
  const [stage, setStage] = useState<StageState>({ kind: "IDLE" });
  const [execution, setExecution] = useState<OrderExecutionProgress>({ status: "IDLE", updates: [] });
  const [loadedExecutionMarketId, setLoadedExecutionMarketId] = useState<string | null>(null);
  const [pricedMarketId, setPricedMarketId] = useState(market.id);
  const [appliedHandoffKey, setAppliedHandoffKey] = useState(handoff.key);

  /* Shared coherent preview feed: one tick drives every market, so the
     terminal never owns a page-local interval or stream. */
  const { liveMarket, previewEpochSeconds } = usePreviewMarket(market.id);
  const { markets } = usePreviewBoard();

  /* A route change repoints the ticket during the same render, so a limit price
     from the previous market is never painted under the new one. View
     preferences are not market state and survive the switch. */
  if (pricedMarketId !== market.id) {
    setPricedMarketId(market.id);
    setAppliedHandoffKey(handoff.key);
    setTicket(initialTicket(market, handoff));
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setLoadedExecutionMarketId(null);
    setConsoleScoped(true);
  } else if (appliedHandoffKey !== handoff.key) {
    setAppliedHandoffKey(handoff.key);
    setTicket(initialTicket(market, handoff));
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setLoadedExecutionMarketId(null);
  }

  useEffect(() => {
    if (loadedExecutionMarketId === market.id) return;
    const latest = gatewaySnapshot.executions.find(
      (candidate) => candidate.result.receipt.marketId === market.id,
    );
    if (latest) {
      setExecution({ status: "COMPLETED", updates: latest.updates, result: latest.result });
      setStage({ kind: "COMPLETED", reference: latest.id, receiptId: latest.result.receipt.id });
    }
    setLoadedExecutionMarketId(market.id);
  }, [gatewaySnapshot.executions, loadedExecutionMarketId, market.id]);

  const route = useMemo(
    () => liveMarket.routes.find((candidate) => candidate.id === ticket.routeId) ?? null,
    [liveMarket, ticket.routeId],
  );

  const eligibleClosePositions = useMemo(
    () => gatewaySnapshot.positions.filter((position) => position.marketId === liveMarket.id),
    [gatewaySnapshot.positions, liveMarket.id],
  );

  const selectedClosePosition = useMemo(
    () =>
      ticket.intent === "EXIT" && ticket.closePositionId
        ? (eligibleClosePositions.find((position) => position.id === ticket.closePositionId) ?? null)
        : null,
    [eligibleClosePositions, ticket.closePositionId, ticket.intent],
  );

  const lifecycleCloseBlocker = useMemo(() => {
    if (!handoff.present || handoff.intent !== "EXIT" || !handoff.lifecycleId) return null;
    const matched = gatewaySnapshot.positions.find(
      (position) => position.id === handoff.lifecycleId,
    );
    if (matched) {
      if (matched.marketId !== liveMarket.id) {
        return `Lifecycle handoff ${handoff.lifecycleId} belongs to another market and cannot close a ${liveMarket.id} package.`;
      }
      return null;
    }
    const isStaticExample = LIFECYCLE_STRATEGIES.some(
      (strategy) => strategy.id === handoff.lifecycleId,
    );
    if (isStaticExample) {
      return `Lifecycle handoff ${handoff.lifecycleId} refers to a static example, not an active demo position. Open a runtime position first.`;
    }
    return `Lifecycle handoff ${handoff.lifecycleId} refers to an unavailable runtime position. It may be closed or from another session.`;
  }, [gatewaySnapshot.positions, handoff.intent, handoff.lifecycleId, handoff.present, liveMarket.id]);

  const effectiveHandoff = useMemo<HandoffContext>(
    () => ({
      ...handoff,
      blockedReason: handoff.blockedReason ?? lifecycleCloseBlocker,
    }),
    [handoff, lifecycleCloseBlocker],
  );

  const preview = useMemo(
    () => buildPreview(liveMarket, ticket, route, selectedClosePosition),
    [liveMarket, ticket, route, selectedClosePosition],
  );

  const maxLots = useMemo(() => {
    const byCapacity = route ? route.availableLots : liveMarket.firmDepthLots;
    if (ticket.intent === "EXIT") {
      if (!selectedClosePosition) return 1;
      return Math.max(1, Math.min(selectedClosePosition.lots, byCapacity));
    }
    const multiple = route?.collateralMultiple ?? 1;
    const feePerLot =
      (liveMarket.notionalPerLot * ((route?.protocolFeeBps ?? 2.5) + (route?.counterpartyFeeBps ?? 0))) /
      10_000;
    const byCollateral = Math.floor(
      gatewaySnapshot.account.available / (liveMarket.collateralPerLot * multiple + feePerLot),
    );
    return Math.max(1, Math.min(byCollateral, byCapacity));
  }, [gatewaySnapshot.account.available, liveMarket, route, selectedClosePosition, ticket.intent]);

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
        if (next.intent === "ENTER") {
          next.closePositionId = null;
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
        closePositionId: row.side === "ASK" ? null : current.closePositionId,
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
    if (effectiveHandoff.blockedReason !== null) return;
    setStage({
      kind: "COMPILED",
      reference: previewReference(liveMarket.id, preview.lots, preview.limitPrice),
    });
  }, [effectiveHandoff.blockedReason, liveMarket.id, preview.lots, preview.limitPrice]);

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
      const isExit = ticket.intent === "EXIT";
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
        contractMultiplier: liveMarket.contractMultiplier,
        timeInForce: ticket.tif,
        feeCap: preview.totalFees,
        collateralRequired: isExit ? 0 : preview.totalCollateral,
        closePositionId: isExit ? ticket.closePositionId : null,
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
            handoff={effectiveHandoff}
            closePositions={eligibleClosePositions}
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
            markets={markets}
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
