"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Boxes, CalendarClock, Cpu, FileCheck2, KeyRound, LockKeyhole, Percent } from "lucide-react";
import { Flash, LiveDot, Meter, deskMotion } from "@/components/strategies/desk/Desk";
import type { MarketFeeSchedule } from "@/lib/market-data/types";
import { NETWORK_OPERATOR_LABEL, SERIES_EVENT_LABEL, type DeploymentEvidence, type OperatorStatus, type SeriesEvent } from "@/lib/operations/deployment";
import type { SeriesRow } from "@/lib/operations/model";
import type { DependencyHealth, EnvironmentWritePolicy, OperationalAlert } from "@/lib/operations/types";
import { formatNumber } from "@/lib/terminal/format";
import { countdown, type ViewId } from "./ops-model";

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
    <button type="button" onClick={onClick} className={`${className} focus-ring group transition-colors duration-150 hover:bg-raised`} style={style}>
      {body}
    </button>
  );
}

export function OpsTiles({
  status,
  evidence,
  dependencies,
  rows,
  nextEvent,
  alerts,
  fees,
  policy,
  now,
  onView,
}: {
  status: OperatorStatus | null;
  evidence: DeploymentEvidence | null;
  dependencies: DependencyHealth[];
  rows: SeriesRow[];
  nextEvent: SeriesEvent | null;
  alerts: OperationalAlert[];
  fees: MarketFeeSchedule | null;
  policy: EnvironmentWritePolicy;
  now: number;
  onView: (view: ViewId) => void;
}) {
  const healthy = dependencies.filter((item) => item.state === "HEALTHY").length;
  const degraded = dependencies.filter((item) => item.state !== "HEALTHY");
  const contractsOk = status ? status.contracts.filter((item) => item.healthy).length : 0;
  const matches = evidence ? evidence.contracts.filter((item) => item.state === "MATCHES").length : 0;
  const active = rows.filter((row) => row.status === "ACTIVE").length;
  const paused = rows.filter((row) => row.status === "PAUSED").length;
  const open = alerts.filter((alert) => alert.state === "OPEN");
  const critical = open.filter((alert) => alert.severity === "CRITICAL").length;
  const signersOk = status ? [status.operator.available, status.maker.available].filter((value) => value === true).length : 0;

  return (
    <section aria-label="Operational status" className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 2xl:grid-cols-8">
      <Tile
        delay={0}
        icon={<Cpu size={12} aria-hidden="true" />}
        label="Chain"
        value={
          status && status.blockNumber !== null ? (
            <span className="flex items-center gap-2">
              <LiveDot tone={status.healthy ? "up" : "down"} live={status.healthy === true} />
              <Flash value={status.blockNumber}>{`#${status.blockNumber.toLocaleString("en-US")}`}</Flash>
            </span>
          ) : status?.chainUnavailable ? (
            "Not answering"
          ) : (
            "Connecting"
          )
        }
        tone={status ? (status.healthy ? "text-ink" : "text-down") : "text-faint"}
        note={status?.network ? `${NETWORK_OPERATOR_LABEL[status.network]} / ${status.chainId ?? "-"} / ${contractsOk}/${status.contracts.length} contracts` : "Waiting for the operator status"}
        onClick={() => onView("OVERVIEW")}
      />
      <Tile
        delay={20}
        icon={<Boxes size={12} aria-hidden="true" />}
        label="Dependencies"
        value={`${healthy}/${dependencies.length}`}
        tone={degraded.length > 0 ? "text-brand" : "text-up"}
        note={degraded.length > 0 ? `${degraded.map((item) => item.label).join(", ")}` : "All healthy"}
        onClick={() => onView("OVERVIEW")}
      >
        <Meter value={dependencies.length > 0 ? healthy / dependencies.length : 0} tone={degraded.length > 0 ? "brand" : "up"} label="Healthy dependencies" />
      </Tile>
      <Tile
        delay={40}
        icon={<FileCheck2 size={12} aria-hidden="true" />}
        label="Code evidence"
        value={evidence ? `${matches}/${evidence.contracts.length}` : "-"}
        tone={evidence ? (matches === evidence.contracts.length ? "text-up" : "text-down") : "text-faint"}
        note={evidence ? "Live code hashes matching the manifest" : "No manifest for this network"}
        onClick={() => onView("CONTRACTS")}
      >
        {evidence && evidence.contracts.length > 0 ? (
          <Meter value={matches / evidence.contracts.length} tone={matches === evidence.contracts.length ? "up" : "down"} label="Matching code hashes" />
        ) : null}
      </Tile>
      <Tile
        delay={60}
        icon={<CalendarClock size={12} aria-hidden="true" />}
        label="Series"
        value={
          <>
            <span className="text-up">{active}</span>
            <span className="text-faint"> / {rows.length}</span>
          </>
        }
        note={paused > 0 ? `${paused} paused` : "Active / listed"}
        onClick={() => onView("SERIES")}
      />
      <Tile
        delay={80}
        icon={<CalendarClock size={12} aria-hidden="true" />}
        label="Next keeper event"
        value={nextEvent ? countdown(nextEvent.at - now) : "-"}
        tone={nextEvent && nextEvent.at - now < 86_400 ? "text-brand" : "text-ink"}
        note={nextEvent ? `${nextEvent.marketKey} ${SERIES_EVENT_LABEL[nextEvent.kind].toLowerCase()}` : "None scheduled"}
        onClick={() => onView("SCHEDULE")}
      />
      <Tile
        delay={100}
        icon={<KeyRound size={12} aria-hidden="true" />}
        label="Signers"
        value={status ? `${signersOk}/2` : "-"}
        tone={status?.operator.available === false ? "text-down" : signersOk === 2 ? "text-up" : "text-brand"}
        note={
          status
            ? `Operator ${status.operator.available ? "ready" : status.operator.available === false ? "missing" : "?"} / maker ${status.maker.available ? "ready" : status.maker.available === false ? "off" : "?"}`
            : "Not reported"
        }
        onClick={() => onView("POLICY")}
      />
      <Tile
        delay={120}
        icon={<Percent size={12} aria-hidden="true" />}
        label="Fee schedule"
        value={fees ? `${formatNumber(fees.makerFeeBps, 1)} / ${formatNumber(fees.takerFeeBps, 1)} bp` : "-"}
        tone={fees && !fees.active ? "text-down" : "text-ink"}
        note={fees ? `Maker / taker, v${fees.version}${fees.active ? "" : " inactive"}` : "Not read"}
        onClick={() => onView("POLICY")}
      />
      <Tile
        delay={140}
        icon={open.length > 0 ? <AlertTriangle size={12} aria-hidden="true" /> : <LockKeyhole size={12} aria-hidden="true" />}
        label="Alerts / boundary"
        value={
          <>
            <span className={critical > 0 ? "text-down" : open.length > 0 ? "text-brand" : "text-up"}>{open.length}</span>
            <span className="text-faint"> open</span>
          </>
        }
        note={policy.policyLabel}
        onClick={() => onView("ALERTS")}
      />
    </section>
  );
}
