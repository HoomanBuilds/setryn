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
  if (error.message === "RFQ_NOT_FOUND") return "The RFQ request is no longer available. Confirm the ticket again for a fresh quote.";
  if (error.message === "RFQ_NOT_OPEN") return "The RFQ request is no longer open. Confirm the ticket again for a fresh quote.";
  if (error.message === "RFQ_NOT_SELECTED") return "The RFQ request is no longer selected. Confirm the ticket again for a fresh quote.";
  if (error.message === "RFQ_QUOTE_NOT_FOUND") return "The selected RFQ quote is no longer available. Select another quote.";
  if (error.message === "RFQ_EXPIRED") return "The selected RFQ quote expired before execution. Select another quote.";
  if (error.message === "RFQ_REQUIRES_PRIVATE_DISCLOSURE") return "The selected route requires a private RFQ disclosure.";
  if (error.message === "RFQ_REQUIRES_SOLVER_ROUTE") return "The selected route requires the solver RFQ route.";
  if (error.message === "RFQ_CAPACITY_EXCEEDED") return "The selected RFQ quote no longer has capacity for this size. Select another quote.";
  if (error.message === "RFQ_RECEIPT_REQUIRED") return "The execution completed but the RFQ receipt was missing.";
  if (error.message === "RFQ_RECEIPT_NOT_FOUND") return "The execution completed but the RFQ receipt was not found.";
  if (error.message === "RFQ_RECEIPT_MARKET_MISMATCH") return "The execution completed but the receipt did not match the RFQ market.";
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
  const rfqParam = searchParams.get("rfq");

  const [vizTab, setVizTab] = useState<VizTab>("price");
  const [consoleTab, setConsoleTab] = useState<ConsoleTabId>("strategies");
  const [consoleScoped, setConsoleScoped] = useState(true);
  const [mobileTab, setMobileTab] = useState<MobileTab>("market");
  const [ticket, setTicket] = useState<TicketState>(() => initialTicket(market, handoff));
  const [stage, setStage] = useState<StageState>({ kind: "IDLE" });
  const [execution, setExecution] = useState<OrderExecutionProgress>({ status: "IDLE", updates: [] });
  const [rfqError, setRfqError] = useState<string | null>(null);
  const [loadedExecutionMarketId, setLoadedExecutionMarketId] = useState<string | null>(null);
  const [pricedMarketId, setPricedMarketId] = useState(market.id);
  const [appliedHandoffKey, setAppliedHandoffKey] = useState(handoff.key);
  const [appliedRfqKey, setAppliedRfqKey] = useState<string | null>(null);

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
    setAppliedRfqKey(null);
    setTicket(initialTicket(market, handoff));
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
    setLoadedExecutionMarketId(null);
    setConsoleScoped(true);
  } else if (appliedHandoffKey !== handoff.key) {
    setAppliedHandoffKey(handoff.key);
    setAppliedRfqKey(null);
    setTicket(initialTicket(market, handoff));
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
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

  useEffect(() => {
    gateway.reconcileRestingOrders(markets);
  }, [gateway, markets]);

  useEffect(() => {
    if (stage.kind !== "RESTING") return;
    const order = gatewaySnapshot.restingOrders.find(
      (candidate) => candidate.id === stage.orderId,
    );
    if (!order || order.state !== "FILLED") return;
    const record = gatewaySnapshot.executions.find(
      (candidate) => candidate.orderHash === order.orderHash,
    );
    if (!record) return;
    setExecution((current) => {
      if (current.status === "COMPLETED" && current.result?.receipt.id === record.result.receipt.id) {
        return current;
      }
      return {
        ...current,
        status: "COMPLETED",
        updates: record.updates,
        result: record.result,
        restingOrder: order,
      };
    });
    setStage((current) => {
      if (current.kind !== "RESTING" || current.orderId !== order.id) return current;
      return { kind: "COMPLETED", reference: current.reference, receiptId: record.result.receipt.id };
    });
    setConsoleTab("strategies");
    setConsoleScoped(true);
  }, [stage, gatewaySnapshot.restingOrders, gatewaySnapshot.executions]);

  useEffect(() => {
    if (rfqParam === null) return;
    const key = `${market.id}::${rfqParam}`;
    if (appliedRfqKey === key) return;
    const requestId = rfqParam.trim();
    const idle = (message: string) => {
      setAppliedRfqKey(key);
      setStage((current) =>
        current.kind === "RFQ" || current.kind === "RFQ_SELECTED" ? { kind: "IDLE" } : current,
      );
      setExecution((current) =>
        current.status === "IDLE" ? current : { status: "IDLE", updates: [] },
      );
      setRfqError(message);
    };
    if (
      requestId.length === 0 ||
      requestId.length > 128 ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(requestId)
    ) {
      idle("The RFQ link reference is malformed, so no local demo request was resumed.");
      return;
    }
    const request =
      gatewaySnapshot.rfqRequests.find((candidate) => candidate.id === requestId) ?? null;
    if (!request) {
      idle("The RFQ request is no longer available. Confirm the ticket again for a fresh quote.");
      return;
    }
    if (request.authorization.intent.marketId !== market.id) {
      idle("The RFQ request belongs to another market and cannot resume in this terminal.");
      return;
    }
    if (request.state === "CANCELLED") {
      idle("The RFQ request was cancelled. Confirm the ticket again for a fresh quote.");
      return;
    }
    if (request.state === "EXECUTED") {
      idle("The RFQ request already executed and cannot resume as an actionable quote.");
      return;
    }
    if (Date.parse(request.expiresAt) <= Date.now()) {
      idle("The RFQ request expired. Confirm the ticket again for a fresh quote.");
      return;
    }
    if (request.state === "SELECTED" && !request.selectedQuoteId) {
      idle("The selected RFQ quote is no longer available. Confirm the ticket again for a fresh quote.");
      return;
    }
    const intent = request.authorization.intent;
    const routeId = liveMarket.routes.some((candidate) => candidate.id === intent.routeId)
      ? intent.routeId
      : liveMarket.routes.some((candidate) => candidate.id === "SOLVER_RFQ")
        ? "SOLVER_RFQ"
        : null;
    setTicket({
      intent: intent.side,
      orderType: intent.orderType === "LIMIT" ? "LIMIT" : "MARKETABLE_LIMIT",
      lotsInput: String(intent.lots),
      limitInput: intent.limitPrice.toFixed(market.priceDecimals),
      tif: intent.timeInForce,
      privateRfq: true,
      routeId,
      closePositionId: intent.side === "EXIT" ? intent.closePositionId : null,
    });
    const reference = previewReference(market.id, intent.lots, intent.limitPrice);
    if (request.state === "SELECTED" && request.selectedQuoteId) {
      setStage({
        kind: "RFQ_SELECTED",
        reference,
        requestId: request.id,
        quoteId: request.selectedQuoteId,
      });
    } else {
      setStage({ kind: "RFQ", reference, requestId: request.id });
    }
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
    setAppliedRfqKey(key);
  }, [
    appliedRfqKey,
    gatewaySnapshot.rfqRequests,
    liveMarket.routes,
    market.id,
    market.priceDecimals,
    rfqParam,
  ]);

  const route = useMemo(
    () => liveMarket.routes.find((candidate) => candidate.id === ticket.routeId) ?? null,
    [liveMarket, ticket.routeId],
  );

  const rfqRequest = useMemo(() => {
    if (stage.kind !== "RFQ" && stage.kind !== "RFQ_SELECTED") return null;
    return gatewaySnapshot.rfqRequests.find((candidate) => candidate.id === stage.requestId) ?? null;
  }, [gatewaySnapshot.rfqRequests, stage]);

  const eligibleClosePositions = useMemo(
    () => gatewaySnapshot.positions.filter((position) => position.marketId === liveMarket.id),
    [gatewaySnapshot.positions, liveMarket.id],
  );

  const positionOverlays = useMemo(
    () =>
      gatewaySnapshot.positions
        .filter((position) => position.marketId === liveMarket.id)
        .map((position) => ({
          id: position.id,
          entryPrice: position.entryPrice,
          lots: position.lots,
          side: position.side,
        })),
    [gatewaySnapshot.positions, liveMarket.id],
  );

  const orderOverlays = useMemo(
    () =>
      gatewaySnapshot.restingOrders
        .filter((order) => order.marketId === liveMarket.id && order.state === "WORKING")
        .map((order) => ({
          id: order.id,
          limitPrice: order.limitPrice,
          lots: order.lots,
          side: order.side,
        })),
    [gatewaySnapshot.restingOrders, liveMarket.id],
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
      setRfqError(null);
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
      setRfqError(null);
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
    setRfqError(null);
    setStage({
      kind: "COMPILED",
      reference: previewReference(liveMarket.id, preview.lots, preview.limitPrice),
    });
  }, [effectiveHandoff.blockedReason, liveMarket.id, preview.lots, preview.limitPrice]);

  const onConfirm = useCallback(async () => {
    if (stage.kind !== "COMPILED" || !route) return;
    const reference = stage.reference;
    const shouldRest = preview.rests;
    try {
      setRfqError(null);
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
        orderType: ticket.orderType === "LIMIT" ? "LIMIT" : "MARKET",
        timeInForce: ticket.tif,
        feeCap: preview.totalFees,
        collateralRequired: isExit ? 0 : preview.totalCollateral,
        closePositionId: isExit ? ticket.closePositionId : null,
        recipient: signer ?? "",
        disclosure: ticket.privateRfq ? "PRIVATE_RFQ" : "PUBLIC",
        settlementGuarantee: preview.settlementGuarantee,
      });

      if (route.requiresPrivate && ticket.privateRfq) {
        const request = await gateway.requestRfq(authorization);
        setExecution({ status: "IDLE", updates: [] });
        setStage({ kind: "RFQ", reference, requestId: request.id });
        setRfqError(null);
        return;
      }

      if (shouldRest) {
        const restingOrder = await gateway.placeRestingOrder(authorization);
        setExecution({ status: "RESTING", updates: [], authorization, restingOrder });
        setStage({ kind: "RESTING", reference, orderId: restingOrder.id });
        setConsoleTab("orders");
        setConsoleScoped(true);
        return;
      }

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
    setRfqError(null);
  }, []);

  const cancelRestingOrderById = useCallback(
    (orderId: string) => gateway.cancelRestingOrder(orderId),
    [gateway],
  );

  const onCancelResting = useCallback(async () => {
    if (stage.kind !== "RESTING") return;
    const reference = stage.reference;
    const orderId = stage.orderId;
    try {
      await cancelRestingOrderById(orderId);
    } catch (error) {
      const message = executionError(error);
      setExecution((current) => ({ ...current, status: "FAILED", error: message }));
      setStage({ kind: "FAILED", reference, message });
      return;
    }
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
  }, [cancelRestingOrderById, stage]);

  const onCancelConsoleRestingOrder = useCallback(
    async (orderId: string) => {
      try {
        await cancelRestingOrderById(orderId);
      } catch {
        return;
      }
      if (stage.kind === "RESTING" && stage.orderId === orderId) {
        setStage({ kind: "IDLE" });
        setExecution({ status: "IDLE", updates: [] });
        setRfqError(null);
      }
    },
    [cancelRestingOrderById, stage],
  );

  const onSelectRfqQuote = useCallback(
    async (quoteId: string) => {
      if (stage.kind !== "RFQ") return;
      const reference = stage.reference;
      const requestId = stage.requestId;
      try {
        await gateway.selectRfqQuote(requestId, quoteId);
        setStage({ kind: "RFQ_SELECTED", reference, requestId, quoteId });
        setRfqError(null);
      } catch (error) {
        setRfqError(executionError(error));
      }
    },
    [gateway, stage],
  );

  const onCancelRfq = useCallback(async () => {
    if (stage.kind !== "RFQ" && stage.kind !== "RFQ_SELECTED") return;
    const requestId = stage.requestId;
    try {
      await gateway.cancelRfq(requestId);
    } catch (error) {
      setRfqError(executionError(error));
      return;
    }
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
  }, [gateway, stage]);

  const onExecuteRfqQuote = useCallback(async () => {
    if (stage.kind !== "RFQ_SELECTED") return;
    const reference = stage.reference;
    const requestId = stage.requestId;
    const quoteId = stage.quoteId;
    const currentRequest =
      gatewaySnapshot.rfqRequests.find((candidate) => candidate.id === requestId) ?? null;
    const currentQuote = currentRequest?.quotes.find((quote) => quote.id === quoteId) ?? null;
    if (!currentRequest) {
      setRfqError(executionError(new Error("RFQ_NOT_FOUND")));
      return;
    }
    if (!currentQuote) {
      setRfqError(executionError(new Error("RFQ_QUOTE_NOT_FOUND")));
      return;
    }
    if (currentRequest.state !== "SELECTED" || currentRequest.selectedQuoteId !== quoteId) {
      setRfqError(executionError(new Error("RFQ_NOT_OPEN")));
      return;
    }
    if (currentQuote.capacityLots < currentRequest.authorization.intent.lots) {
      setRfqError(executionError(new Error("RFQ_CAPACITY_EXCEEDED")));
      return;
    }
    if (
      Date.parse(currentRequest.expiresAt) <= Date.now() ||
      Date.parse(currentQuote.expiresAt) <= Date.now()
    ) {
      setRfqError(executionError(new Error("RFQ_EXPIRED")));
      return;
    }
    try {
      setStage({ kind: "EXECUTING", reference });
      setExecution((current) => ({ ...current, status: "AUTHORIZING" }));
      const baseIntent = currentRequest.authorization.intent;
      const authorization = await gateway.authorizeOrder({
        ...baseIntent,
        executionPrice: currentQuote.packagePrice,
        feeCap: currentQuote.feeCap,
      });
      setExecution({ status: "SUBMITTING", updates: [], authorization });
      const result = await gateway.submitAuthorizedOrder(authorization, (update) => {
        setExecution((current) => ({
          ...current,
          status: "SUBMITTING",
          updates: [...current.updates, update],
        }));
      });
      try {
        await gateway.completeRfq(requestId, result.receipt.id);
      } catch (completeError) {
        setRfqError(executionError(completeError));
      }
      setExecution((current) => ({ ...current, status: "COMPLETED", result }));
      setStage({ kind: "COMPLETED", reference, receiptId: result.receipt.id });
      setConsoleTab("strategies");
      setConsoleScoped(true);
    } catch (error) {
      setExecution({ status: "IDLE", updates: [] });
      setStage({ kind: "RFQ_SELECTED", reference, requestId, quoteId });
      setRfqError(executionError(error));
    }
  }, [gateway, gatewaySnapshot.rfqRequests, stage]);

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
              positionOverlays={positionOverlays}
              orderOverlays={orderOverlays}
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
          {stage.kind === "IDLE" && rfqError ? (
            <p
              role="alert"
              className="shrink-0 border-b border-line bg-down-soft px-4 py-2 text-xs leading-snug text-down"
            >
              {rfqError}
            </p>
          ) : null}
          <OrderTicket
            market={liveMarket}
            state={ticket}
            preview={preview}
            route={route}
            stage={stage}
            execution={execution}
            rfqRequest={rfqRequest}
            rfqError={rfqError}
            maxLots={maxLots}
            handoff={effectiveHandoff}
            closePositions={eligibleClosePositions}
            onChange={patchTicket}
            onStage={onStage}
            onConfirm={onConfirm}
            onSelectRfqQuote={onSelectRfqQuote}
            onExecuteRfqQuote={onExecuteRfqQuote}
            onCancelRfq={onCancelRfq}
            onCancelResting={onCancelResting}
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
            runtimeRestingOrders={gatewaySnapshot.restingOrders}
            runtimeExecutions={gatewaySnapshot.executions}
            onCancelRestingOrder={onCancelConsoleRestingOrder}
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
