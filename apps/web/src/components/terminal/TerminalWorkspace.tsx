"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DEFAULT_SLIPPAGE_BPS,
  defaultGtdExpiry,
  executableAction,
  isPackageSide,
  previewReference,
  protectedPrice,
  routePrice,
  SLIPPAGE_PRESETS_BPS,
  type Intent,
  type PackageSide,
  type StageState,
  type TicketState,
} from "@/lib/terminal/economics";
import { parseHandoff, type HandoffContext } from "@/lib/terminal/handoff";
import { tradeHref } from "@/lib/terminal/markets";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";
import type { BookRow, ConsoleTabId, PackageMarket } from "@/lib/terminal/types";
import type { OrderExecutionProgress } from "@/lib/internal-gateway/types";
import { platformNow } from "@/lib/terminal/clock";
import { useConfirmationPrefs, useDisclosurePrefs } from "@/lib/settings/preferences";

type MobileTab = "market" | "book" | "order" | "positions";

const MOBILE_TABS = [
  { id: "market", label: "Market" },
  { id: "book", label: "Book" },
  { id: "order", label: "Ticket" },
  { id: "positions", label: "Positions" },
];

function executionError(error: unknown): string {
  if (!(error instanceof Error)) return "The trading runtime could not complete this package order.";
  if (error.message === "CONNECT_WALLET") return "Connect a wallet before authorizing this package.";
  // Wallet and transport failures surface through viem with EIP-1193 and JSON-RPC codes in the cause chain.
  const codes: unknown[] = [];
  for (let cause: unknown = error; cause && typeof cause === "object" && codes.length < 8; cause = (cause as { cause?: unknown }).cause) {
    codes.push((cause as { code?: unknown }).code);
  }
  if (codes.includes(4001) || /user (rejected|denied)/i.test(error.message)) {
    return "The request was rejected in your wallet. Nothing was signed or submitted.";
  }
  if (codes.includes(-32603) || /rpc unavailable|fetch failed|failed to fetch|http request failed|timed out/i.test(error.message)) {
    return "The chain RPC did not respond, so nothing was submitted. Check the connection and try again.";
  }
  if (error.message === "INSUFFICIENT_AVAILABLE_COLLATERAL") {
    return "Available collateral plus released collateral no longer covers the fee cap.";
  }
  if (error.message === "AUTHORIZATION_EXPIRED") return "The authorization expired before submission. Review and try again.";
  if (error.message === "SIGNER_MISMATCH") return "The active wallet does not match the package authorization.";
  if (error.message === "MAINNET_WRITE_DISABLED") return "Mainnet writes are disabled by the current Setryn environment.";
  if (error.message === "CLOSE_POSITION_REQUIRED") return "Select an active package position to close.";
  if (error.message === "CLOSE_POSITION_FORBIDDEN_FOR_ENTRY") return "Entry orders cannot reference a position to close.";
  if (error.message === "POSITION_NOT_FOUND") return "The selected position is no longer active in this account.";
  if (error.message === "POSITION_MARKET_MISMATCH") return "The selected position does not belong to this market.";
  if (error.message === "INVALID_CLOSE_LOTS") return "Enter a close quantity above zero.";
  if (error.message === "CLOSE_LOTS_EXCEEDS_POSITION") return "Quantity exceeds the selected package lots. Reduce quantity to close within the active package.";
  if (error.message === "EXIT_REQUIRES_ZERO_COLLATERAL") return "Exits require no new collateral. Review the ticket and try again.";
  if (error.message === "FULL_POSITION_EXIT_REQUIRED") return "Select the complete open quantity for this lifecycle exit.";
  if (error.message === "EXIT_REQUIRES_FOK") return "Lifecycle exits require fill-or-kill execution.";
  if (error.message === "POST_ONLY_WOULD_CROSS") return "The book moved and this post-only order would take liquidity, so it was cancelled without a fill. Reprice behind the touch.";
  if (error.message === "RESTING_ORDER_WOULD_CROSS") return "The book moved and this limit now crosses, so it was cancelled without a fill. Resubmit to execute against the book.";
  if (error.message === "EXIT_REQUIRES_DEVNET_MAKER") return "The close must use the qualified devnet maker that owns the original counterparty position.";
  if (error.message === "EXIT_QUANTITY_MISMATCH") return "The close fill does not exactly offset the original position. Both positions remain visible for recovery.";
  if (error.message === "EXIT_PARTICIPANT_MISMATCH") return "The close fill changed the counterparty set and cannot use the direct unwind path.";
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
  if (error.message === "INVALID_PACKAGE_SIDE") {
    return "The package side is invalid. Select Long or Short and try again.";
  }
  if (error.message === "PACKAGE_SIDE_MISMATCH") {
    return "The ticket side does not match the selected position side. Reselect the position.";
  }
  if (error.message === "INVALID_LOTS") return "Enter a package quantity above zero.";
  if (error.message === "INVALID_FILL_LOTS") return "The expected fill quantity is invalid. Review the ticket and try again.";
  if (error.message === "FILL_EXCEEDS_REQUESTED") return "The fill quantity cannot exceed the requested quantity.";
  if (error.message === "FILL_MUST_EQUAL_REQUESTED") return "Only IOC orders may partially fill. Use IOC or reduce to the available route capacity.";
  if (error.message === "IOC_PARTIAL_REQUIRES_MARKETABLE") return "Only a marketable IOC can partially fill. Adjust the limit to cross or reduce to route capacity.";
  if (error.message === "REPLACEMENT_ORDER_NOT_FOUND") {
    return "The order to replace is no longer available.";
  }
  if (error.message === "REPLACEMENT_ORDER_NOT_WORKING") {
    return "The order to replace is no longer working. Amendment discarded.";
  }
  if (error.message === "REPLACEMENT_MISMATCH") {
    return "Amendment must keep account, market, package, intent, side, and close position.";
  }
  if (error.message === "REPLACEMENT_REQUIRES_LIMIT_GTC") {
    return "Amendment requires a limit GTC or GTD order.";
  }
  if (error.message === "REPLACEMENT_TIF_MISMATCH") {
    return "Amendment must keep the same time in force.";
  }
  if (error.message === "REPLACEMENT_ID_MISMATCH") {
    return "Replacement reference does not match the selected order.";
  }
  if (error.message === "GTD_EXPIRY_REQUIRED") {
    return "Select a GTD expiry in the future within 30 days.";
  }
  if (error.message === "GTD_EXPIRY_PAST") {
    return "GTD expiry must be in the future.";
  }
  if (error.message === "GTD_EXPIRY_TOO_FAR") {
    return "GTD expiry cannot exceed 30 days.";
  }
  if (error.message === "GTD_REQUIRES_LIMIT") {
    return "GTD requires a limit order.";
  }
  if (error.message === "EXPIRY_FORBIDDEN") {
    return "Only GTD orders carry an expiry.";
  }
  if (error.message === "INVALID_TIME_IN_FORCE") {
    return "The time in force is invalid.";
  }
  if (error.message === "REPLACE_FLOW_REQUIRED") {
    return "Replacement orders require the amend flow.";
  }
  if (error.message === "RESTING_ORDER_NOT_FOUND") {
    return "The working order is no longer available.";
  }
  if (error.message === "RESTING_ORDER_NOT_WORKING") {
    return "The working order is no longer working.";
  }
  if (error.message === "NO_ONCHAIN_LIQUIDITY") return "No executable public-book liquidity is available at this price.";
  if (error.message === "ORDER_NOT_MARKETABLE") return "The limit does not cross the best public-book price.";
  if (error.message === "FOK_NOT_FILLED") return "The public book cannot fill the complete FOK quantity.";
  if (error.message === "MAKER_RISK_ADMISSION_MISSING") return "The best maker quote no longer has valid risk capacity.";
  if (error.message === "MAKER_ORDER_EXPIRED") {
    return "The best resting maker order expired before it could be matched. No fill was created; try again.";
  }
  if (error.message === "MATCH_FAILED") return "The public-book match reverted before a fill was created.";
  if (error.message === "CLEARING_EVIDENCE_MISSING") return "The clearing transaction completed without the required fill evidence.";
  if (error.message === "REMAINDER_PLACEMENT_FAILED") {
    return "The matched quantity cleared, but the remaining quantity could not be placed on the public book.";
  }
  if (error.message === "UNSUPPORTED_ONCHAIN_MARKET") {
    return "This market is a preview and is not activated in the current onchain environment.";
  }
  return "The trading runtime did not reach a final package outcome. No completion is claimed.";
}

const SLIPPAGE_KEY = "setryn:ticket-slippage-bps";
const ONCHAIN_ROUTE_IDS = new Set(["DIRECT_BOOK", "SOLVER_RFQ"]);

function parseSlippage(value: unknown): number | undefined {
  return typeof value === "number" && (SLIPPAGE_PRESETS_BPS as readonly number[]).includes(value) ? value : undefined;
}

function initialTicket(market: PackageMarket, handoff?: HandoffContext): TicketState {
  const intent = handoff?.intent ?? "ENTER";
  const side: PackageSide = handoff?.direction ?? "LONG";
  const action = executableAction(intent, side);
  return {
    intent,
    side,
    orderType: "MARKETABLE_LIMIT",
    lotsInput: handoff?.lots != null ? String(handoff.lots) : "10",
    limitInput: bestReferencePrice(market, action).toFixed(market.priceDecimals),
    // A lifecycle exit is fill-or-kill, the same rule the ticket applies when switching to Exit.
    tif: intent === "EXIT" ? "FOK" : "GTC",
    expiresAt: null,
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
  const [rawTicket, setTicket] = useState<TicketState>(() => initialTicket(market, handoff));
  const [slippageBps, setSlippageBps] = usePersistentState(SLIPPAGE_KEY, DEFAULT_SLIPPAGE_BPS, parseSlippage);
  const [stage, setStage] = useState<StageState>({ kind: "IDLE" });
  const [execution, setExecution] = useState<OrderExecutionProgress>({ status: "IDLE", updates: [] });
  const [rfqError, setRfqError] = useState<string | null>(null);
  const [loadedExecutionMarketId, setLoadedExecutionMarketId] = useState<string | null>(null);
  const [pricedMarketId, setPricedMarketId] = useState(market.id);
  const [appliedHandoffKey, setAppliedHandoffKey] = useState(handoff.key);
  const [appliedRfqKey, setAppliedRfqKey] = useState<string | null>(null);
  const [amendmentOrderId, setAmendmentOrderId] = useState<string | null>(null);
  const [amendmentError, setAmendmentError] = useState<string | null>(null);
  const replacementInFlightRef = useRef<string | null>(null);
  // Settings: whether orders and RFQ quote selections get a review step, and where a new ticket routes first.
  const [confirmations] = useConfirmationPrefs();
  const [disclosure] = useDisclosurePrefs();
  const autoConfirmRef = useRef(false);
  const autoExecuteQuoteRef = useRef(false);
  const ticketTouchedRef = useRef(false);

  /* Shared coherent preview feed: one tick drives every market, so the
     terminal never owns a page-local interval or stream. */
  const { liveMarket, previewEpochSeconds } = usePreviewMarket(market.id);
  const { markets } = usePreviewBoard();

  /* A market order carries a protection price derived from the live route and the slippage tolerance, so it
     tracks the feed every tick. A limit order keeps the price the trader entered. */
  const ticket = useMemo<TicketState>(() => {
    if (rawTicket.orderType !== "MARKETABLE_LIMIT") return rawTicket;
    const action = executableAction(rawTicket.intent, rawTicket.side);
    const liveRoute = liveMarket.routes.find((candidate) => candidate.id === rawTicket.routeId) ?? null;
    const reference = liveRoute ? routePrice(liveRoute, action) : bestReferencePrice(liveMarket, action);
    return {
      ...rawTicket,
      limitInput: protectedPrice(reference, action, slippageBps, liveMarket).toFixed(liveMarket.priceDecimals),
    };
  }, [liveMarket, rawTicket, slippageBps]);

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
    setAmendmentOrderId(null);
    setAmendmentError(null);
    setLoadedExecutionMarketId(null);
    setConsoleScoped(true);
  } else if (appliedHandoffKey !== handoff.key) {
    setAppliedHandoffKey(handoff.key);
    setAppliedRfqKey(null);
    setTicket(initialTicket(market, handoff));
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
    setAmendmentOrderId(null);
    setAmendmentError(null);
    setLoadedExecutionMarketId(null);
  }

  useEffect(() => {
    if (loadedExecutionMarketId === market.id) return;
    const latest = gatewaySnapshot.executions.find(
      (candidate) => candidate.result.receipt.marketId === market.id,
    );
    if (latest) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles local workflow state with the gateway snapshot, an external store
      setExecution({ status: "COMPLETED", updates: latest.updates, result: latest.result });
      setStage({ kind: "COMPLETED", reference: latest.id, receiptId: latest.result.receipt.id });
    }
    setLoadedExecutionMarketId(market.id);
  }, [gatewaySnapshot.executions, loadedExecutionMarketId, market.id]);

  useEffect(() => {
    gateway.reconcileRestingOrders(markets);
  }, [gateway, markets]);

  useEffect(() => {
    if (!amendmentOrderId) return;
    if (replacementInFlightRef.current === amendmentOrderId) return;
    const target = gatewaySnapshot.restingOrders.find(
      (candidate) => candidate.id === amendmentOrderId,
    );
    if (target && (target.state === "WORKING" || target.state === "PARTIALLY_FILLED")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles local workflow state with the gateway snapshot, an external store
    setAmendmentOrderId(null);
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
    setAmendmentError("The amended order is no longer working. Amendment discarded.");
  }, [amendmentOrderId, gatewaySnapshot.restingOrders]);

  useEffect(() => {
    if (stage.kind !== "RESTING") return;
    const order = gatewaySnapshot.restingOrders.find(
      (candidate) => candidate.id === stage.orderId,
    );
    if (!order) return;
    if (order.state === "PARTIALLY_FILLED") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles local workflow state with the gateway snapshot, an external store
      setExecution((current) => {
        if (current.restingOrder?.id === order.id && current.restingOrder?.state === order.state) {
          const currentFilled =
            (current.restingOrder as { filledLots?: unknown }).filledLots ?? null;
          if (currentFilled === order.filledLots) return current;
        }
        return { ...current, restingOrder: order };
      });
      return;
    }
    if (
      order.state === "CANCELLED" ||
      order.state === "EXPIRED" ||
      order.state === "REPLACED"
    ) {
      setStage({ kind: "IDLE" });
      setExecution({ status: "IDLE", updates: [] });
      return;
    }
    if (order.state !== "FILLED") return;
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
      idle("The RFQ link reference is malformed, so no request was resumed.");
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
    if (Date.parse(request.expiresAt) <= platformNow()) {
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles local workflow state with the gateway snapshot, an external store
    setTicket({
      intent: intent.side,
      side: isPackageSide(intent.packageSide) ? intent.packageSide : "LONG",
      orderType: intent.orderType === "LIMIT" ? "LIMIT" : "MARKETABLE_LIMIT",
      lotsInput: String(intent.lots),
      limitInput: intent.limitPrice.toFixed(market.priceDecimals),
      tif: intent.timeInForce,
      expiresAt: null,
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

  /* The onchain-activated market settles on its deployed series, so the ticket prices collateral, fees, and order
     size from the chain rather than from the preview definition; charts and books keep the shared preview feed. */
  const onchainMarket = gatewaySnapshot.publicBookMarketId === liveMarket.id;
  const onchainEconomics = onchainMarket ? gatewaySnapshot.publicBookEconomics : null;
  const ticketMarket = useMemo<PackageMarket>(() => {
    if (!onchainEconomics) return liveMarket;
    return {
      ...liveMarket,
      contractMultiplier: onchainEconomics.considerationPerPriceUnit,
      collateralPerLot: Math.max(onchainEconomics.longCollateralPerLot, onchainEconomics.shortCollateralPerLot),
      feeOnConsideration: true,
      maxOrderLots: onchainEconomics.maxOrderLots,
      // Only the public book and the private solver RFQ execute onchain; preview routes would misstate the fill.
      routes: liveMarket.routes.filter((candidate) => ONCHAIN_ROUTE_IDS.has(candidate.id)).map((candidate) => ({
        ...candidate,
        protocolFeeBps: onchainEconomics.takerFeeBps,
        counterpartyFeeBps: 0,
        collateralMultiple: 1,
      })),
    };
  }, [liveMarket, onchainEconomics]);

  const route = useMemo(
    () => ticketMarket.routes.find((candidate) => candidate.id === ticket.routeId) ?? null,
    [ticketMarket, ticket.routeId],
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
        .filter(
          (order) =>
            order.marketId === liveMarket.id &&
            (order.state === "WORKING" || order.state === "PARTIALLY_FILLED"),
        )
        .map((order) => ({
          id: order.id,
          limitPrice: order.limitPrice,
          lots:
            typeof order.remainingLots === "number" && Number.isFinite(order.remainingLots)
              ? order.remainingLots
              : order.lots,
          side: order.side,
          packageSide: order.packageSide,
        })),
    [gatewaySnapshot.restingOrders, liveMarket.id],
  );

  /* The onchain-activated market shows the public book read from the chain. Preview markets keep their preview
     direct depth so the ladder reads like a market, marked indicative because nothing there rests onchain. */
  const directBookOrders = useMemo<BookRow[]>(
    () =>
      onchainMarket
        ? gatewaySnapshot.publicBookOrders
        : liveMarket.book
            .filter((row) => row.source === "DIRECT")
            .map((row) => ({
              ...row,
              firmness: "INDICATIVE" as const,
              origin: "Preview book; this market is not activated onchain",
            })),
    [gatewaySnapshot.publicBookOrders, liveMarket.book, onchainMarket],
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
    return `Lifecycle handoff ${handoff.lifecycleId} is not an active position for the connected account.`;
  }, [gatewaySnapshot.positions, handoff.intent, handoff.lifecycleId, handoff.present, liveMarket.id]);

  const effectiveHandoff = useMemo<HandoffContext>(
    () => ({
      ...handoff,
      blockedReason: handoff.blockedReason ?? lifecycleCloseBlocker,
    }),
    [handoff, lifecycleCloseBlocker],
  );

  const preview = useMemo(
    () => buildPreview(ticketMarket, ticket, route, selectedClosePosition),
    [ticketMarket, ticket, route, selectedClosePosition],
  );

  const amendmentOrder = amendmentOrderId
    ? (gatewaySnapshot.restingOrders.find((candidate) => candidate.id === amendmentOrderId) ?? null)
    : null;

  const maxLots = useMemo(() => {
    const byCapacity = route ? route.availableLots : liveMarket.firmDepthLots;
    const iocUncapped = ticket.tif === "IOC";
    if (ticket.intent === "EXIT") {
      if (!selectedClosePosition) return 1;
      if (iocUncapped) return Math.max(1, selectedClosePosition.lots);
      return Math.max(1, Math.min(selectedClosePosition.lots, byCapacity));
    }
    const multiple = route?.collateralMultiple ?? 1;
    const feeBasePerLot = ticketMarket.feeOnConsideration
      ? Math.abs(route ? routePrice(route, executableAction(ticket.intent, ticket.side)) : ticketMarket.netPrice) *
        ticketMarket.contractMultiplier
      : ticketMarket.notionalPerLot;
    const feePerLot =
      (feeBasePerLot * ((route?.protocolFeeBps ?? 2.5) + (route?.counterpartyFeeBps ?? 0))) / 10_000;
    const creditedAvailable =
      amendmentOrder && amendmentOrder.side === "ENTER"
        ? gatewaySnapshot.account.available +
          (typeof amendmentOrder.remainingCollateralReservation === "number" &&
          Number.isFinite(amendmentOrder.remainingCollateralReservation)
            ? amendmentOrder.remainingCollateralReservation
            : amendmentOrder.collateralReservation)
        : gatewaySnapshot.account.available;
    const byCollateral = Math.min(
      Math.floor(creditedAvailable / (ticketMarket.collateralPerLot * multiple + feePerLot)),
      ticketMarket.maxOrderLots ?? Number.POSITIVE_INFINITY,
    );
    if (iocUncapped) return Math.max(1, byCollateral);
    return Math.max(1, Math.min(byCollateral, byCapacity));
  }, [amendmentOrder, gatewaySnapshot.account.available, liveMarket.firmDepthLots, ticketMarket, route, selectedClosePosition, ticket.intent, ticket.side, ticket.tif]);

  const selectMarket = useCallback((next: PackageMarket) => router.push(tradeHref(next)), [router]);

  const patchTicket = useCallback(
    (patch: Partial<TicketState>) => {
      ticketTouchedRef.current = true;
      setStage({ kind: "IDLE" });
      setExecution({ status: "IDLE", updates: [] });
      setRfqError(null);
      setAmendmentError(null);
      const amending = amendmentOrderId != null;
      const positionsNow = gatewaySnapshot.positions;
      setTicket((current) => {
        let safePatch: Partial<TicketState> = patch;
        if (amending) {
          safePatch = {
            ...(patch.lotsInput !== undefined ? { lotsInput: patch.lotsInput } : null),
            ...(patch.limitInput !== undefined ? { limitInput: patch.limitInput } : null),
            ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : null),
          };
          if (patch.routeId !== undefined) {
            const candidate =
              liveMarket.routes.find((route) => route.id === patch.routeId) ?? null;
            if (!candidate?.requiresPrivate) {
              safePatch = { ...safePatch, routeId: patch.routeId };
            }
          }
        }
        const next = { ...current, ...safePatch };
        // Post-only only means something for a resting limit on the public book.
        if (next.orderType !== "LIMIT" || (next.tif !== "GTC" && next.tif !== "GTD") || next.privateRfq) {
          next.postOnly = false;
        }
        if (safePatch.intent === "EXIT") {
          next.tif = "FOK";
          next.expiresAt = null;
        }
        if (next.tif !== "GTD") {
          next.expiresAt = null;
        } else if (
          next.expiresAt == null ||
          !Number.isFinite(Date.parse(next.expiresAt))
        ) {
          next.expiresAt = defaultGtdExpiry();
        }
        if (!amending && safePatch.privateRfq === false && current.routeId === "SOLVER_RFQ") {
          next.routeId = null;
        }
        if (next.intent === "ENTER") {
          next.closePositionId = null;
        }
        if (next.intent === "EXIT" && next.closePositionId) {
          const matched = positionsNow.find((position) => position.id === next.closePositionId);
          if (matched && isPackageSide(matched.side)) {
            next.side = matched.side;
          }
          // A lifecycle exit closes the whole position, so choosing one fills in its full size.
          if (matched && patch.lotsInput === undefined && next.closePositionId !== current.closePositionId) {
            next.lotsInput = String(matched.lots);
          }
        }
        if (safePatch.side !== undefined && !isPackageSide(safePatch.side)) {
          next.side = current.side;
        }
        /* Changing entry direction, intent, close position, or route reprices
           onto what that route can execute, without touching other inputs. */
        const reprice =
          safePatch.routeId !== undefined ||
          safePatch.intent !== undefined ||
          safePatch.side !== undefined ||
          safePatch.closePositionId !== undefined ||
          next.routeId !== current.routeId ||
          next.intent !== current.intent ||
          next.side !== current.side ||
          next.closePositionId !== current.closePositionId;
        if (reprice) {
          const nextRoute =
            liveMarket.routes.find((candidate) => candidate.id === next.routeId) ?? null;
          const action = executableAction(next.intent, next.side);
          next.limitInput = (
            nextRoute ? routePrice(nextRoute, action) : bestReferencePrice(liveMarket, action)
          ).toFixed(liveMarket.priceDecimals);
        }
        return next;
      });
    },
    [amendmentOrderId, gatewaySnapshot.positions, liveMarket],
  );

  const selectBookRow = useCallback(
    (row: BookRow) => {
      setStage({ kind: "IDLE" });
      setRfqError(null);
      setAmendmentError(null);
      const amending = amendmentOrderId != null;
      setTicket((current) => {
        if (current.intent === "ENTER" && !amending) {
          return {
            ...current,
            side: row.side === "ASK" ? ("LONG" as PackageSide) : ("SHORT" as PackageSide),
            limitInput: row.price.toFixed(liveMarket.priceDecimals),
          };
        }
        return {
          ...current,
          limitInput: row.price.toFixed(liveMarket.priceDecimals),
        };
      });
    },
    [amendmentOrderId, liveMarket.priceDecimals],
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
    // With order confirmations off, the review sheet is skipped and the wallet prompt follows directly.
    autoConfirmRef.current = !confirmations.orders;
    setStage({
      kind: "COMPILED",
      reference: previewReference(liveMarket.id, preview.requestedLots, preview.limitPrice),
    });
  }, [confirmations.orders, effectiveHandoff.blockedReason, liveMarket.id, preview.requestedLots, preview.limitPrice]);

  const onConfirm = useCallback(async () => {
    if (stage.kind !== "COMPILED" || !route) return;
    const reference = stage.reference;
    const shouldRest = preview.rests;
    const replacingId = amendmentOrderId;
    if (replacingId && route.requiresPrivate) {
      const message = "Solver RFQ routes cannot rest as replacements. Select a public book route.";
      setExecution((current) => ({ ...current, status: "FAILED", error: message }));
      setStage({ kind: "FAILED", reference, message });
      return;
    }
    if (replacingId) {
      replacementInFlightRef.current = replacingId;
    }
    try {
      setRfqError(null);
      setAmendmentError(null);
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
      const packageSide: PackageSide = isExit
        ? (selectedClosePosition?.side ?? ticket.side)
        : ticket.side;
      const authorization = await gateway.authorizeOrder({
        accountId: account.id,
        marketId: liveMarket.id,
        packageCode: liveMarket.code,
        routeId: route.id,
        routeLabel: route.label,
        side: ticket.intent,
        packageSide,
        lots: preview.requestedLots,
        fillLots: preview.fillLots,
        limitPrice: preview.limitPrice,
        executionPrice: preview.effectivePrice,
        contractMultiplier: ticketMarket.contractMultiplier,
        orderType: ticket.orderType === "LIMIT" ? "LIMIT" : "MARKET",
        timeInForce: ticket.tif,
        expiresAt: ticket.expiresAt,
        feeCap: preview.totalFees,
        collateralRequired: isExit ? 0 : preview.totalCollateral,
        closePositionId: isExit ? ticket.closePositionId : null,
        replacesOrderId: replacingId,
        recipient: signer ?? "",
        disclosure: ticket.privateRfq ? "PRIVATE_RFQ" : "PUBLIC",
        settlementGuarantee: preview.settlementGuarantee,
        postOnly: ticket.postOnly === true,
      });

      if (replacingId) {
        const replacement = await gateway.replaceRestingOrder(replacingId, authorization);
        setAmendmentOrderId(null);
        setAmendmentError(null);
        setExecution({ status: "RESTING", updates: [], authorization, restingOrder: replacement });
        setStage({ kind: "RESTING", reference, orderId: replacement.id });
        setConsoleTab("orders");
        setConsoleScoped(true);
        replacementInFlightRef.current = null;
        return;
      }

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
      // The gateway records every step, including the position and receipt steps it finishes after streaming.
      const recorded = gateway.getSnapshot().executions.find((candidate) => candidate.result.receipt.id === result.receipt.id);
      setExecution((current) => ({ ...current, status: "COMPLETED", result, updates: recorded?.updates ?? current.updates }));
      setStage({ kind: "COMPLETED", reference, receiptId: result.receipt.id });
      setConsoleTab("strategies");
      setConsoleScoped(true);
    } catch (error) {
      const message = executionError(error);
      if (
        replacingId &&
        error instanceof Error &&
        (error.message === "REPLACEMENT_ORDER_NOT_FOUND" ||
          error.message === "REPLACEMENT_ORDER_NOT_WORKING")
      ) {
        setAmendmentOrderId(null);
        setAmendmentError("The amended order is no longer working. Amendment discarded.");
      }
      setExecution((current) => ({ ...current, status: "FAILED", error: message }));
      setStage({ kind: "FAILED", reference, message });
    } finally {
      if (replacingId) {
        replacementInFlightRef.current = null;
      }
    }
  }, [amendmentOrderId, gateway, liveMarket, preview, route, selectedClosePosition, stage, ticket, ticketMarket.contractMultiplier]);

  useEffect(() => {
    if (ticket.intent !== "EXIT") return;
    if (!selectedClosePosition) return;
    if (ticket.side === selectedClosePosition.side) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles local workflow state with the gateway snapshot, an external store
    setTicket((current) => {
      if (current.intent !== "EXIT") return current;
      if (current.closePositionId !== selectedClosePosition.id) return current;
      if (current.side === selectedClosePosition.side) return current;
      const action = executableAction("EXIT", selectedClosePosition.side);
      const currentRoute =
        liveMarket.routes.find((candidate) => candidate.id === current.routeId) ?? null;
      return {
        ...current,
        side: selectedClosePosition.side,
        limitInput: (
          currentRoute ? routePrice(currentRoute, action) : bestReferencePrice(liveMarket, action)
        ).toFixed(liveMarket.priceDecimals),
      };
    });
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
  }, [liveMarket, selectedClosePosition, ticket.closePositionId, ticket.intent, ticket.side]);

  const onReset = useCallback(() => {
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
    setAmendmentError(null);
  }, []);

  const onDiscardAmendment = useCallback(() => {
    setAmendmentOrderId(null);
    setAmendmentError(null);
    setStage({ kind: "IDLE" });
    setExecution({ status: "IDLE", updates: [] });
    setRfqError(null);
  }, []);

  const onAmendConsoleRestingOrder = useCallback(
    (orderId: string, proposedPrice?: number) => {
      const target = gatewaySnapshot.restingOrders.find((candidate) => candidate.id === orderId);
      if (
        !target ||
        (target.state !== "WORKING" && target.state !== "PARTIALLY_FILLED") ||
        target.marketId !== liveMarket.id
      )
        return;
      if (target.timeInForce !== "GTC" && target.timeInForce !== "GTD") return;
      const targetRoute = liveMarket.routes.find((candidate) => candidate.id === target.routeId) ?? null;
      const initialRouteId = targetRoute && !targetRoute.requiresPrivate ? targetRoute.id : null;
      const amendmentLots =
        typeof target.remainingLots === "number" && Number.isFinite(target.remainingLots)
          ? target.remainingLots
          : target.lots;
      setTicket({
        intent: target.side,
        side: isPackageSide(target.packageSide) ? target.packageSide : "LONG",
        orderType: "LIMIT",
        lotsInput: String(amendmentLots),
        limitInput: (proposedPrice ?? target.limitPrice).toFixed(liveMarket.priceDecimals),
        tif: target.timeInForce,
        expiresAt: target.timeInForce === "GTD" ? target.expiresAt : null,
        privateRfq: target.disclosure === "PRIVATE_RFQ",
        routeId: initialRouteId,
        closePositionId: target.side === "EXIT" ? target.closePositionId : null,
      });
      setAmendmentOrderId(target.id);
      setAmendmentError(null);
      setStage({ kind: "IDLE" });
      setExecution({ status: "IDLE", updates: [] });
      setRfqError(null);
      setConsoleTab("orders");
      setMobileTab("order");
    },
    [gatewaySnapshot.restingOrders, liveMarket],
  );

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
        // With quote-selection confirmations off, selecting a quote executes it.
        autoExecuteQuoteRef.current = !confirmations.rfqSelection;
        setStage({ kind: "RFQ_SELECTED", reference, requestId, quoteId });
        setRfqError(null);
      } catch (error) {
        setRfqError(executionError(error));
      }
    },
    [confirmations.rfqSelection, gateway, stage],
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
      Date.parse(currentRequest.expiresAt) <= platformNow() ||
      Date.parse(currentQuote.expiresAt) <= platformNow()
    ) {
      setRfqError(executionError(new Error("RFQ_EXPIRED")));
      return;
    }
    try {
      setStage({ kind: "EXECUTING", reference });
      setExecution({
        status: "SUBMITTING",
        updates: [],
        authorization: currentRequest.authorization,
      });
      const result = await gateway.executeSelectedRfq(requestId, (update) => {
        setExecution((current) => ({
          ...current,
          status: "SUBMITTING",
          updates: [...current.updates, update],
        }));
      });
      // The gateway records every step, including the position and receipt steps it finishes after streaming.
      const recorded = gateway.getSnapshot().executions.find((candidate) => candidate.result.receipt.id === result.receipt.id);
      setExecution((current) => ({ ...current, status: "COMPLETED", result, updates: recorded?.updates ?? current.updates }));
      setStage({ kind: "COMPLETED", reference, receiptId: result.receipt.id });
      setConsoleTab("strategies");
      setConsoleScoped(true);
    } catch (error) {
      setExecution({ status: "IDLE", updates: [] });
      setStage({ kind: "RFQ_SELECTED", reference, requestId, quoteId });
      setRfqError(executionError(error));
    }
  }, [gateway, gatewaySnapshot.rfqRequests, stage]);

  /* Confirmation preferences that are off turn the review step into a pass-through: the stage change that would show
     the review runs the next step immediately, with the stage state that step expects. */
  useEffect(() => {
    if (stage.kind === "COMPILED" && autoConfirmRef.current) {
      autoConfirmRef.current = false;
      void onConfirm();
    }
    if (stage.kind === "RFQ_SELECTED" && autoExecuteQuoteRef.current) {
      autoExecuteQuoteRef.current = false;
      void onExecuteRfqQuote();
    }
  }, [onConfirm, onExecuteRfqQuote, stage]);

  /* A viewer who defaults to private RFQ starts untouched tickets on the solver route when the market offers one. */
  useEffect(() => {
    if (disclosure.route !== "PRIVATE_RFQ" || ticketTouchedRef.current || handoff.present) return;
    if (!liveMarket.routes.some((candidate) => candidate.id === "SOLVER_RFQ")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- applies a stored viewer preference once it is readable after hydration
    setTicket((current) =>
      current.privateRfq ? current : { ...current, privateRfq: true, routeId: "SOLVER_RFQ", postOnly: false },
    );
  }, [disclosure.route, handoff.present, liveMarket.routes]);

  const show = (tab: MobileTab) => (mobileTab === tab ? "flex" : "hidden");
  const activePrice = Number.parseFloat(ticket.limitInput);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-app">
      <MarketHeader market={liveMarket} onSelectMarket={selectMarket} onchain={onchainMarket} />

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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_300px_344px] lg:grid-rows-[minmax(0,1fr)_minmax(220px,31%)] lg:gap-1 lg:p-1">
        <div
          id="mobile-panel-market"
          role="tabpanel"
          aria-labelledby="mobile-tab-market"
          className={`${show("market")} scroll-thin min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-panel lg:col-start-1 lg:row-start-1 lg:flex lg:overflow-hidden lg:rounded-lg lg:border lg:border-line`}
        >
          <div className="flex min-h-[280px] flex-1 flex-col lg:min-h-0">
            <AnalysisPanel
              market={liveMarket}
              baseMarket={market}
              tab={vizTab}
              onTab={setVizTab}
              lots={Math.max(1, preview.fillLots)}
              previewEpochSeconds={previewEpochSeconds}
              positionOverlays={positionOverlays}
              orderOverlays={orderOverlays}
              onAmendOrderPrice={onAmendConsoleRestingOrder}
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
          className={`${show("book")} min-h-0 min-w-0 flex-1 flex-col lg:col-start-2 lg:row-start-1 lg:flex lg:overflow-hidden lg:rounded-lg lg:border lg:border-line`}
        >
          <OrderBookPanel
            market={liveMarket}
            directOrders={directBookOrders}
            activePrice={activePrice}
            onSelectRow={selectBookRow}
          />
        </div>

        <div
          id="mobile-panel-order"
          role="tabpanel"
          aria-labelledby="mobile-tab-order"
          className={`${show("order")} min-h-0 min-w-0 flex-1 flex-col lg:col-start-3 lg:row-start-1 lg:row-end-3 lg:flex lg:overflow-hidden lg:rounded-lg lg:border lg:border-line`}
        >
          {stage.kind === "IDLE" && rfqError ? (
            <p
              role="alert"
              className="shrink-0 border-b border-line bg-down-soft px-4 py-2 text-xs leading-snug text-down"
            >
              {rfqError}
            </p>
          ) : null}
          {stage.kind === "IDLE" && !rfqError && amendmentError ? (
            <p
              role="alert"
              className="shrink-0 border-b border-line bg-down-soft px-4 py-2 text-xs leading-snug text-down"
            >
              {amendmentError}
            </p>
          ) : null}
          <OrderTicket
            market={ticketMarket}
            state={ticket}
            preview={preview}
            route={route}
            stage={stage}
            execution={execution}
            rfqRequest={rfqRequest}
            rfqError={rfqError}
            maxLots={maxLots}
            slippageBps={slippageBps}
            onSlippage={setSlippageBps}
            wallet={{
              connected: gatewaySnapshot.wallet.status === "CONNECTED",
              available: gatewaySnapshot.account.available,
              asset: gatewaySnapshot.account.collateralAsset,
              equity: gatewaySnapshot.account.equity,
              posted: gatewaySnapshot.account.posted,
              reserved: gatewaySnapshot.account.reserved,
              riskDomain: gatewaySnapshot.account.label,
            }}
            onConnect={() => {
              void gateway.connectWallet().catch(() => undefined);
            }}
            handoff={effectiveHandoff}
            closePositions={eligibleClosePositions}
            amendment={amendmentOrderId ? { orderId: amendmentOrderId } : null}
            onChange={patchTicket}
            onStage={onStage}
            onConfirm={onConfirm}
            onSelectRfqQuote={onSelectRfqQuote}
            onExecuteRfqQuote={onExecuteRfqQuote}
            onCancelRfq={onCancelRfq}
            onCancelResting={onCancelResting}
            onReset={onReset}
            onDiscardAmendment={onDiscardAmendment}
          />
        </div>

        <div
          id="mobile-panel-positions"
          role="tabpanel"
          aria-labelledby="mobile-tab-positions"
          className={`${show("positions")} min-h-0 min-w-0 flex-1 flex-col lg:col-start-1 lg:col-end-3 lg:row-start-2 lg:flex lg:overflow-hidden lg:rounded-lg lg:border lg:border-line`}
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
            onAmendRestingOrder={onAmendConsoleRestingOrder}
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
              Open position
            </button>
            <button
              type="button"
              onClick={() => openTicket("EXIT")}
              className="focus-ring h-12 rounded-md bg-down text-sm font-semibold text-app"
            >
              Close position
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
