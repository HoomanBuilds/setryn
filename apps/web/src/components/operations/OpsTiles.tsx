"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  Cpu,
  Database,
  LifeBuoy,
  ListOrdered,
  LockKeyhole,
  Power,
} from "lucide-react";
import { Flash, LiveDot, Meter, deskMotion } from "@/components/strategies/desk/Desk";
import type { EnvironmentWritePolicy, OperationsSnapshot } from "@/lib/operations/types";
import type { DevnetStatus, ViewId } from "./ops-model";

function Tile({
  icon,
  label,
  value,
  note,
  tone = "text-ink",
  children,
  onClick,
  delay,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  note: ReactNode;
  tone?: string;
  children?: ReactNode;
  onClick?: () => void;
  delay: number;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] text-faint">
        <span className="text-off">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className={`tnum mt-1 block truncate font-mono text-[17px] leading-6 ${tone}`}>{value}</span>
      <span className="mt-0.5 block truncate text-[11px] text-off">{note}</span>
      {children ? <span className="mt-2 block">{children}</span> : null}
    </>
  );
  const className = `${deskMotion.rise} flex min-w-0 flex-col justify-start bg-panel px-3 py-2.5 text-left`;
  const style = { ["--rise-delay" as string]: `${delay}ms` };
  if (!onClick) {
    return (
      <div className={className} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} focus-ring group transition-colors duration-150 hover:bg-raised`}
      style={style}
    >
      {body}
    </button>
  );
}

export function OpsTiles({
  snapshot,
  status,
  policy,
  onView,
}: {
  snapshot: OperationsSnapshot;
  status: DevnetStatus | null;
  policy: EnvironmentWritePolicy;
  onView: (view: ViewId) => void;
}) {
  const healthyDeps = snapshot.dependencies.filter((item) => item.state === "HEALTHY").length;
  const degraded = snapshot.dependencies.filter((item) => item.state !== "HEALTHY");
  const worstStream = [...snapshot.indexerStreams].sort(
    (a, b) => b.lagBlocks / b.allowedLagBlocks - a.lagBlocks / a.allowedLagBlocks,
  )[0];
  const queued = snapshot.jobQueues.reduce((sum, queue) => sum + queue.queued, 0);
  const leased = snapshot.jobQueues.reduce((sum, queue) => sum + queue.leased, 0);
  const delayed = snapshot.jobQueues.reduce((sum, queue) => sum + queue.delayed, 0);
  const queueTotal = Math.max(1, queued + leased + delayed);
  const openAlerts = snapshot.alerts.filter((alert) => alert.state === "OPEN").length;
  const ackAlerts = snapshot.alerts.filter((alert) => alert.state === "ACKNOWLEDGED").length;
  const openCases = snapshot.recoveryCases.filter((item) => item.state !== "RESOLVED");
  const armed = snapshot.killSwitches.filter((item) => item.state === "ARMED").length;
  const contractsHealthy = status ? status.contracts.filter((item) => item.healthy).length : 0;
  const block = status ? Number(status.blockNumber) : null;

  return (
    <section
      aria-label="Operational status"
      className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 2xl:grid-cols-8"
    >
      <Tile
        delay={0}
        icon={<Cpu size={12} aria-hidden="true" />}
        label="Runtime"
        value={
          status ? (
            <span className="flex items-center gap-2">
              <LiveDot tone={status.healthy ? "up" : "down"} live={status.healthy} />
              <Flash value={block ?? 0}>{`#${status.blockNumber}`}</Flash>
            </span>
          ) : (
            "Connecting"
          )
        }
        tone={status ? (status.healthy ? "text-ink" : "text-down") : "text-faint"}
        note={status ? `Local ${status.chainId} / ${contractsHealthy}/${status.contracts.length} contracts / live RPC` : "Waiting for local runtime"}
      />
      <Tile
        delay={20}
        icon={<Boxes size={12} aria-hidden="true" />}
        label="Dependencies"
        value={`${healthyDeps}/${snapshot.dependencies.length}`}
        tone={degraded.length > 0 ? "text-brand" : "text-up"}
        note={degraded.length > 0 ? `${degraded.map((item) => item.label).join(", ")} degraded` : "All healthy"}
        onClick={() => onView("OVERVIEW")}
      >
        <Meter value={healthyDeps / snapshot.dependencies.length} tone={degraded.length > 0 ? "brand" : "up"} label="Healthy dependencies" />
      </Tile>
      <Tile
        delay={40}
        icon={<Database size={12} aria-hidden="true" />}
        label="Worst indexer lag"
        value={worstStream ? `${worstStream.lagBlocks} / ${worstStream.allowedLagBlocks} blk` : "-"}
        tone={worstStream && worstStream.lagBlocks > worstStream.allowedLagBlocks ? "text-down" : "text-ink"}
        note={worstStream ? worstStream.label : "No streams"}
        onClick={() => onView("OVERVIEW")}
      >
        {worstStream ? (
          <Meter
            value={worstStream.lagBlocks / (Math.max(worstStream.lagBlocks, worstStream.allowedLagBlocks) * 1.2)}
            limit={worstStream.allowedLagBlocks / (Math.max(worstStream.lagBlocks, worstStream.allowedLagBlocks) * 1.2)}
            tone={worstStream.lagBlocks > worstStream.allowedLagBlocks ? "down" : "up"}
            label="Worst indexer lag against allowance"
          />
        ) : null}
      </Tile>
      <Tile
        delay={60}
        icon={<ListOrdered size={12} aria-hidden="true" />}
        label="Job queues"
        value={
          <>
            {queued}
            <span className="text-faint"> / </span>
            <span className="text-up">{leased}</span>
            <span className="text-faint"> / </span>
            <span className={delayed > 0 ? "text-brand" : "text-dim"}>{delayed}</span>
          </>
        }
        note="Queued / leased / delayed"
        onClick={() => onView("QUEUES")}
      >
        <span className="flex h-1 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          <span className="bg-dim/70" style={{ flexGrow: queued / queueTotal, flexBasis: 0 }} />
          <span className="bg-up" style={{ flexGrow: leased / queueTotal, flexBasis: 0 }} />
          <span className="bg-brand" style={{ flexGrow: delayed / queueTotal, flexBasis: 0 }} />
        </span>
      </Tile>
      <Tile
        delay={80}
        icon={<AlertTriangle size={12} aria-hidden="true" />}
        label="Alerts"
        value={
          <>
            <span className={openAlerts > 0 ? "text-down" : "text-dim"}>{openAlerts}</span>
            <span className="text-faint"> open / </span>
            <span className={ackAlerts > 0 ? "text-brand" : "text-dim"}>{ackAlerts}</span>
            <span className="text-faint"> ack</span>
          </>
        }
        note={`${snapshot.alerts.length} in window`}
        onClick={() => onView("ALERTS")}
      />
      <Tile
        delay={100}
        icon={<LifeBuoy size={12} aria-hidden="true" />}
        label="Recovery cases"
        value={`${openCases.length} active`}
        tone={openCases.some((item) => item.newRiskBlocked) ? "text-brand" : "text-ink"}
        note={openCases[0] ? `${openCases[0].id} deadline ${openCases[0].deadline}` : "None open"}
        onClick={() => onView("RECOVERY")}
      />
      <Tile
        delay={120}
        icon={<Power size={12} aria-hidden="true" />}
        label="Kill switches"
        value={`${armed}/${snapshot.killSwitches.length} armed`}
        tone={armed === snapshot.killSwitches.length ? "text-up" : "text-down"}
        note={armed === snapshot.killSwitches.length ? "New risk admitted" : "Staged stop in effect"}
        onClick={() => onView("POLICY")}
      />
      <Tile
        delay={140}
        icon={<LockKeyhole size={12} aria-hidden="true" />}
        label="Write boundary"
        value={policy.writesAllowed ? "Testnet only" : "Writes off"}
        tone={policy.writesAllowed ? "text-brand" : "text-down"}
        note={policy.policyLabel}
        onClick={() => onView("POLICY")}
      />
    </section>
  );
}
