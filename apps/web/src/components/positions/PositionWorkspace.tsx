"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { LIFECYCLE_STRATEGIES } from "@/lib/lifecycle/fixtures";
import { resolvePosition, type PositionDossier } from "@/lib/positions/dossier";
import { marketFor, positionMetrics } from "@/lib/positions/economics";
import { lifeProgress, positionTimeline } from "@/lib/positions/timeline";
import { settlementStage } from "@/lib/settlements/center";
import { STAGE_COPY } from "@/lib/settlements/stages";
import type { PackageMarket } from "@/lib/terminal/types";
import { LifecyclePanel } from "./LifecyclePanel";
import { MANAGE_ACTIONS, ManagePanel, type ManageAction } from "./ManagePanel";
import { PositionGate, PositionSkeleton } from "./PositionGate";
import { PositionHeader } from "./PositionHeader";
import { ActivityPanel, LegsPanel, RiskPanel } from "./PositionPanels";

function isAction(value: string | null): value is ManageAction {
  return value !== null && (MANAGE_ACTIONS as readonly string[]).includes(value);
}

function PositionView({
  dossier,
  market,
  markets,
  nowMs,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  markets: readonly PackageMarket[];
  nowMs: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("action");
  const action: ManageAction = isAction(requested) ? requested : "close";

  const onAction = (next: ManageAction) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "close") params.delete("action");
    else params.set("action", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const metrics = positionMetrics(dossier, market, nowMs);
  const steps = positionTimeline(dossier, market, metrics, nowMs);
  const progress = lifeProgress(dossier, metrics, nowMs);
  const stageLabel = dossier.phase === "CLOSED" ? "Closed" : STAGE_COPY[settlementStage(market, nowMs)].label;

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-1">
        <PositionHeader dossier={dossier} market={market} metrics={metrics} progress={progress} steps={steps} nowMs={nowMs} />
        {/* Each column is its own stack on desktop. Below that the wrappers dissolve so the panels
            interleave: actions first, then the lifecycle, then the supporting detail. */}
        <div className="flex flex-col gap-1 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-1">
            <LifecyclePanel steps={steps} stageLabel={stageLabel} className="order-2 lg:order-none" delay={60} />
            <ActivityPanel dossier={dossier} market={market} className="order-4 lg:order-none" delay={120} />
            <LegsPanel dossier={dossier} market={market} className="order-5 lg:order-none" delay={160} />
          </div>
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-1">
            <ManagePanel
              dossier={dossier}
              market={market}
              markets={markets}
              metrics={metrics}
              action={action}
              onAction={onAction}
              className="order-1 lg:order-none"
              delay={40}
            />
            {dossier.phase === "CLOSED" ? null : (
              <RiskPanel dossier={dossier} market={market} metrics={metrics} className="order-3 lg:order-none" delay={100} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * `/positions/[id]`: one position's complete lifecycle. The account read and
 * the marks come from the shared gateway snapshot and preview board, so the
 * figures here match the portfolio and the terminal tick for tick.
 */
export function PositionWorkspace({ positionId }: { positionId: string }) {
  const snapshot = useGatewaySnapshot();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const resolution = useMemo(
    () => resolvePosition(positionId, snapshot, markets, LIFECYCLE_STRATEGIES),
    [positionId, snapshot, markets],
  );

  if (resolution.status === "CONNECTING") return <PositionSkeleton />;
  if (resolution.status === "CONNECT") return <PositionGate kind="connect" positionId={positionId} />;
  if (resolution.status === "NOT_FOUND") return <PositionGate kind="missing" positionId={positionId} />;

  const market = marketFor(resolution.dossier.marketId, markets);
  if (!market) return <PositionGate kind="missing" positionId={positionId} />;
  return (
    <PositionView dossier={resolution.dossier} market={market} markets={markets} nowMs={previewEpochSeconds * 1000} />
  );
}
