import type { ExecutionPosition, GatewaySnapshot } from "@/lib/internal-gateway/types";
import { findMarket, packageLabel } from "@/lib/terminal/markets";
import type { LegFamily } from "@/lib/terminal/types";
import type { LifecycleLeg, LifecycleProposal, LifecycleStrategy } from "./types";

function roleForFamily(family: LegFamily): string {
  if (family === "FORWARD") return "Dated price leg";
  if (family === "FUNDING") return "Funding capture leg";
  if (family === "FINANCING") return "Financing leg";
  if (family === "SPOT_REF") return "Spot reference leg";
  return "Basis reference leg";
}

function receiptForPosition(snapshot: GatewaySnapshot, position: ExecutionPosition) {
  const opening = snapshot.executions.find(
    (execution) =>
      execution.result.outcome === "OPENED" && execution.result.position?.id === position.id,
  )?.result.receipt;
  if (opening) return opening;
  const viaExecution = snapshot.executions.find(
    (execution) => execution.result.position?.id === position.id,
  )?.result.receipt;
  if (viaExecution) return viaExecution;
  const viaClose = snapshot.executions.find(
    (execution) => execution.result.closedPositionId === position.id,
  )?.result.receipt;
  if (viaClose) return viaClose;
  return (
    snapshot.receipts.find(
      (candidate) =>
        candidate.marketId === position.marketId &&
        candidate.lots === position.lots &&
        candidate.price === position.entryPrice,
    ) ?? null
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function runtimeLifecycleStrategies(snapshot: GatewaySnapshot): readonly LifecycleStrategy[] {
  const environmentLabel = snapshot.environment.label;
  const evidenceLabel = snapshot.environment.evidence;

  return snapshot.positions.filter((position) => findMarket(position.marketId).id === position.marketId).map((position) => {
    const market = findMarket(position.marketId);
    const receipt = receiptForPosition(snapshot, position);
    const direction = position.side === "LONG" ? 1 : -1;
    const markPrice = market.netPrice;
    const entryPrice = position.entryPrice;
    const fees = receipt?.fees ?? 0;
    const pricePnl = (markPrice - entryPrice) * position.lots * market.contractMultiplier * direction;
    const equity = position.collateral + pricePnl - fees;
    const maintenance = position.collateral * 0.75;
    const buffer = equity - maintenance;
    const liquidationDistance = equity <= 0 ? 0 : round1(Math.max(0, (buffer / equity) * 100));
    const closeCost =
      fees > 0 ? Math.round(fees) : Math.max(1, Math.round(position.lots * market.collateralPerLot * 0.008));
    const timeToUnwindSeconds = Math.min(180, 28 + position.lots * 2);
    const maxResidual = Math.round(position.lots * market.residualPerLot * 100) / 100;
    const shortId = position.id.slice(-4).toUpperCase();
    const fixingId = `${position.id}-fixing`;
    const expiryId = `${position.id}-expiry`;

    const legs: LifecycleLeg[] = market.legs.map((source) => ({
      ...source,
      lifecycleRole: roleForFamily(source.family),
      dependency: "Closes only as part of the complete package from the trade terminal.",
      nextBoundaryId: fixingId,
      observation: {
        provenance: source.venueClass === "NATIVE_BOOK" ? "EXECUTABLE" : "OBSERVED",
        ageSeconds: market.snapshotAgeSeconds,
        source: `${environmentLabel} / ${evidenceLabel} evidence`,
      },
    }));

    const exitProposal: LifecycleProposal = {
      id: `${position.id}-exit`,
      kind: "EXIT",
      label: `Exit ${position.lots} lots as a complete package`,
      actionLabel: "Open package exit",
      route: "TRADE",
      requestedLots: position.lots,
      summary:
        "Opens the trade terminal for a complete package exit. A fresh quote and authorization are still required; no outcome is claimed from this view.",
      quoteRequirement: `Requires a fresh package quote for ${position.lots} lots. The handoff bound is a requested bound only and is reset by the fresh quote.`,
      maxCloseCost: closeCost,
      estimatedTimeToUnwindSeconds: timeToUnwindSeconds,
      impacts: [
        { label: "Lots", before: String(position.lots), after: "0", tone: "up" },
        {
          label: "Collateral",
          before: `${Math.round(position.collateral).toLocaleString("en-US")} USDC`,
          after: "0 USDC",
          tone: "up",
        },
        {
          label: "Package mark",
          before: `${markPrice.toFixed(market.priceDecimals)}`,
          after: "Quoted at handoff",
        },
        {
          label: "Max residual",
          before: `${Math.round(maxResidual).toLocaleString("en-US")} USDC`,
          after: "0 USDC",
          tone: "up",
        },
      ],
      constraints: [
        {
          label: "Complete package",
          state: "SATISFIED",
          detail: "All legs close together from the trade terminal.",
        },
        {
          label: "Fresh package quote",
          state: "REQUIRES_QUOTE",
          detail: "Price and close-cost bound are set only by a new quote.",
        },
        {
          label: "Requested close-cost bound",
          state: "REQUIRES_QUOTE",
          detail: "The handoff bound is a request only. The fresh route quote sets the fee cap.",
        },
      ],
    };

    const proposals: LifecycleProposal[] = [exitProposal];
    if (position.lots > 1) {
      const reduce = Math.floor(position.lots / 2);
      const remaining = position.lots - reduce;
      const collateralAfter = Math.round((position.collateral * remaining) / position.lots);
      const residualAfter = Math.round(remaining * market.residualPerLot * 100) / 100;
      proposals.unshift({
        id: `${position.id}-derisk`,
        kind: "DE_RISK",
        label: `Reduce package exposure by ${reduce} lots`,
        actionLabel: "Open package reduction",
        route: "TRADE",
        requestedLots: reduce,
        summary:
          "Opens the trade terminal for a partial package reduction. The hedge ratio on remaining lots is preserved in the request; no outcome is claimed from this view.",
        quoteRequirement: `Requires a fresh package quote for ${reduce} lots. The handoff bound is a requested bound only and is reset by the fresh quote.`,
        maxCloseCost: Math.max(1, Math.round((closeCost * reduce) / position.lots)),
        estimatedTimeToUnwindSeconds: Math.min(180, 22 + reduce * 2),
        impacts: [
          { label: "Lots", before: String(position.lots), after: String(remaining), tone: "up" },
          {
            label: "Collateral",
            before: `${Math.round(position.collateral).toLocaleString("en-US")} USDC`,
            after: `${collateralAfter.toLocaleString("en-US")} USDC`,
            tone: "up",
          },
          {
            label: "Max residual",
            before: `${Math.round(maxResidual).toLocaleString("en-US")} USDC`,
            after: `${Math.round(residualAfter).toLocaleString("en-US")} USDC`,
            tone: "up",
          },
          { label: "Package mark", before: `${markPrice.toFixed(market.priceDecimals)}`, after: "Quoted at handoff" },
        ],
        constraints: [
          {
            label: "Package ratio",
            state: "SATISFIED",
            detail: "All legs reduce pro rata in the trade request.",
          },
          {
            label: "Fresh package quote",
            state: "REQUIRES_QUOTE",
            detail: "Capacity and price are confirmed only at handoff.",
          },
        ],
      });
    }

    return {
      id: position.id,
      market,
      label: `${packageLabel(market)} ${shortId}`,
      origin: "RUNTIME",
      environmentLabel,
      evidenceLabel,
      receiptId: receipt?.id ?? null,
      createdAt: position.createdAt,
      side: position.side,
      lots: position.lots,
      health: liquidationDistance < 10 ? "ATTENTION" : "HEALTHY",
      healthDetail: `Runtime position from ${environmentLabel} (${evidenceLabel} evidence). Mark and collateral are shown for monitoring; no further outcome is claimed.`,
      entryPrice,
      markPrice,
      closeCost,
      timeToUnwindSeconds,
      collateral: position.collateral,
      liquidationDistance,
      maxResidual,
      settlementClass:
        market.settlementClass === "CASH_USDC_NDF"
          ? `Cash USDC NDF at ${market.fixingSource}`
          : `Cash USDC at ${market.fixingSource}`,
      guarantee: market.routes[0]?.guarantee ?? "LEG_SEQUENCED",
      recoveryClass: "Local runtime completion only",
      observation: {
        provenance: "EXECUTABLE",
        ageSeconds: 0,
        source: `${environmentLabel} clearing simulation / ${evidenceLabel} evidence`,
        asOfLabel: "current browser session",
      },
      boundaries: [
        {
          id: fixingId,
          kind: "FIXING",
          label: "Cash settlement fixing",
          dueLabel: market.expiryIso,
          timing: market.expiryIso,
          state: "UPCOMING",
          source: market.fixingSource,
        },
        {
          id: expiryId,
          kind: "EXPIRY",
          label: "Series expiry",
          dueLabel: market.expiryIso,
          timing: `after ${market.expiryIso} fixing`,
          state: "UPCOMING",
          source: `${environmentLabel} position record`,
        },
      ],
      legs,
      proposals,
    };
  });
}

export const lifecycleStrategiesFromGateway = runtimeLifecycleStrategies;
