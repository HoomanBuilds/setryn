"use client";

import { useMemo } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Chip, Flash, LiveDot, Panel, PanelHead, Row, deskMotion } from "@/components/strategies/desk/Desk";
import type {
  EvidenceKind,
  OperationsJournalEntry,
  OperationsSnapshot,
} from "@/lib/operations/types";
import { Evidence } from "./OpsTables";
import { TONE_TEXT, stateLabel, stateTone, type Detail, type DevnetStatus } from "./ops-model";
import { ChainIcon } from "@/components/icons/AssetIcon";
import { evidenceLabel } from "@/lib/terminal/format";

export function PolicyBoundary({ policy }: { policy: OperationsSnapshot["writePolicies"][number] }) {
  return (
    <Panel label="Environment write boundary" delay={40}>
      <PanelHead title="Write boundary" tools={<Evidence value={policy.evidence} />} />
      <div className="px-3 py-3">
        <div className="flex items-start gap-2.5">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border ${
              policy.writesAllowed ? "border-brand-edge/50 bg-brand-soft text-brand" : "border-down/30 bg-down-soft text-down"
            }`}
          >
            <LockKeyhole size={14} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] text-ink">{policy.label}</p>
            <p className={`mt-0.5 text-xs ${policy.writesAllowed ? "text-brand" : "text-down"}`}>{policy.policyLabel}</p>
          </div>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-dim">{policy.detail}</p>
        <p className="mt-2.5 border-t border-line-soft pt-2 text-[11px] leading-relaxed text-faint">
          This screen is a browser fixture. It never invokes an operator runtime, wallet, RPC write, or mainnet deployment action.
        </p>
      </div>
    </Panel>
  );
}

export function WritePolicies({ policies, active }: { policies: OperationsSnapshot["writePolicies"]; active: string }) {
  return (
    <Panel label="Environment write policies" delay={80}>
      <PanelHead title="Environment write policies" />
      <ul className="divide-y divide-line-soft">
        {policies.map((policy) => (
          <li
            key={policy.environment}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5 ${policy.environment === active ? "bg-raised/60" : ""}`}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <LockKeyhole size={12} aria-hidden="true" className={policy.writesAllowed ? "text-brand" : "text-down"} />
                <span className="text-[13px] text-ink">{policy.label}</span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-faint">{policy.detail}</span>
            </span>
            <Chip tone={policy.writesAllowed ? "brand" : "down"}>{policy.policyLabel}</Chip>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function RuntimeStatus({ status }: { status: DevnetStatus | null }) {
  return (
    <Panel label="Connected runtime" delay={20}>
      <PanelHead
        title="Runtime"
        tools={
          status ? (
            <span className="flex items-center gap-2 text-[11px] text-faint">
              <LiveDot tone={status.healthy ? "up" : "down"} live />
              <span className="tnum font-mono">
                block <Flash value={Number(status.blockNumber)}>{status.blockNumber}</Flash>
              </span>
              <Chip tone="up">Live RPC</Chip>
            </span>
          ) : (
            <span className="text-[11px] text-faint">connecting</span>
          )
        }
      />
      {status ? (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Runtime</p>
              <p className={`mt-0.5 text-[13px] ${status.healthy ? "text-up" : "text-down"}`}>{status.healthy ? "Healthy" : "Degraded"}</p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Chain</p>
              <p className="tnum mt-0.5 flex items-center gap-1.5 font-mono text-[13px] text-ink">
                <ChainIcon size={14} />
                {`Local ${status.chainId}`}
              </p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Contracts</p>
              <p className="tnum mt-0.5 font-mono text-[13px] text-ink">
                {`${status.contracts.filter((item) => item.healthy).length}/${status.contracts.length}`}
              </p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Checked</p>
              <p className="tnum mt-0.5 font-mono text-[13px] text-ink">{status.checkedAt.slice(11, 19)} UTC</p>
            </div>
          </div>
          <ul className="flex flex-wrap gap-1.5 px-3 py-2.5" aria-label="Deployed contracts">
            {status.contracts.map((contract) => (
              <li
                key={contract.address}
                className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-inset px-2 py-1 transition-colors duration-150 hover:border-line-strong"
                title={contract.address}
              >
                <LiveDot tone={contract.healthy ? "up" : "down"} />
                <span className="truncate text-[11px] text-dim">{contract.label}</span>
                <span className="tnum shrink-0 font-mono text-[10px] text-off">
                  {`${contract.address.slice(0, 6)}…${contract.address.slice(-4)}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="px-3 py-4 text-xs text-dim">Waiting for the local protocol runtime.</div>
      )}
    </Panel>
  );
}

export function DetailPane({ snapshot, detail }: { snapshot: OperationsSnapshot; detail: Detail | null }) {
  const content = useMemo(() => {
    if (!detail) return null;
    if (detail.kind === "DEPENDENCY") {
      const item = snapshot.dependencies.find((entry) => entry.id === detail.id);
      return item
        ? {
            label: item.label,
            title: item.service,
            tone: stateTone(item.state),
            state: stateLabel(item.state),
            lines: [
              ["Checkpoint", item.checkpoint],
              ["Freshness", `${item.freshness.ageLabel} / ${item.freshness.thresholdLabel}`],
              ["Evidence", evidenceLabel(item.evidence)],
            ],
            detail: item.detail,
          }
        : null;
    }
    if (detail.kind === "QUEUE") {
      const item = snapshot.jobQueues.find((entry) => entry.id === detail.id);
      return item
        ? {
            label: item.label,
            title: stateLabel(item.runner),
            tone: stateTone(item.state),
            state: stateLabel(item.state),
            lines: [
              ["Queued / leased / delayed", `${item.queued} / ${item.leased} / ${item.delayed}`],
              ["Last completion", item.lastCompletion],
              ["Next checkpoint", item.nextCheckpoint],
              ["Evidence", evidenceLabel(item.evidence)],
            ],
            detail: item.detail,
          }
        : null;
    }
    if (detail.kind === "RECOVERY") {
      const item = snapshot.recoveryCases.find((entry) => entry.id === detail.id);
      return item
        ? {
            label: item.id,
            title: item.packageCode,
            tone: stateTone(item.state),
            state: stateLabel(item.state),
            lines: [
              ["Risk boundary", item.riskBoundary],
              ["Residual", item.residual],
              ["Deadline", item.deadline],
              ["Authority", item.writeAuthority],
            ],
            detail: item.events.map((event) => `${event.at}: ${event.label}. ${event.detail}`).join(" "),
          }
        : null;
    }
    if (detail.kind === "ALERT") {
      const item = snapshot.alerts.find((entry) => entry.id === detail.id);
      return item
        ? {
            label: item.id,
            title: item.title,
            tone: stateTone(item.state),
            state: stateLabel(item.state),
            lines: [
              ["Severity", stateLabel(item.severity)],
              ["Source", item.source],
              ["Opened", item.openedAt],
              ...(item.acknowledgedAt ? [["Acknowledged", item.acknowledgedAt]] : []),
              ...(item.resolvedAt ? [["Resolved", item.resolvedAt]] : []),
              ["Evidence", evidenceLabel(item.evidence)],
            ],
            detail: item.detail,
          }
        : null;
    }
    const item = snapshot.killSwitches.find((entry) => entry.id === detail.id);
    return item
      ? {
          label: item.label,
          title: stateLabel(item.scope),
          tone: stateTone(item.state),
          state: stateLabel(item.state),
          lines: [
            ["Changed", item.changedAt],
            ["Actor", item.actor],
            ["Evidence", evidenceLabel(item.evidence)],
          ],
          detail: `${item.stops}. Terminal resolution remains permitted: ${item.permits}.`,
        }
      : null;
  }, [detail, snapshot]);

  return (
    <Panel label="Inspection" delay={80}>
      <PanelHead title="Inspection" tools={<ShieldCheck size={14} aria-hidden="true" className="text-faint" />} />
      {content ? (
        <div key={`${detail?.kind}-${detail?.id}`} className={`${deskMotion.fade} px-3 py-3`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">{content.label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-faint">{content.title}</p>
            </div>
            <span className={`shrink-0 text-xs ${TONE_TEXT[content.tone]}`}>{content.state}</span>
          </div>
          <div className="mt-2 border-t border-line-soft pt-1">
            {content.lines.map(([label, value]) => (
              <Row key={label} label={label} value={<span className="whitespace-normal">{value}</span>} tone="dim" />
            ))}
          </div>
          <p className="mt-2 border-t border-line-soft pt-2 text-xs leading-relaxed text-dim">{content.detail}</p>
        </div>
      ) : (
        <div className="px-3 py-5 text-xs leading-relaxed text-faint">
          Select a dependency, queue, recovery case, alert, or policy scope to inspect its evidence and operating boundary.
        </div>
      )}
    </Panel>
  );
}

const EVIDENCE_DOT: Record<EvidenceKind, string> = {
  RECORDED: "border-ink/70 bg-panel",
  FIXTURE: "border-faint bg-panel",
  MODELED: "border-brand bg-panel",
};

function actionTone(action: string): string {
  const lowered = action.toLowerCase();
  if (lowered.includes("stop") || lowered.includes("opened")) return "bg-down";
  if (lowered.includes("resolved") || lowered.includes("re-armed")) return "bg-up";
  if (lowered.includes("queued") || lowered.includes("acknowledged")) return "bg-brand";
  return "bg-dim";
}

/** Incident timeline: newest first, one rail, a node per journal entry. */
export function Journal({
  entries,
  title = "Operational journal",
  limit = 6,
  delay = 120,
}: {
  entries: OperationsJournalEntry[];
  title?: string;
  limit?: number;
  delay?: number;
}) {
  return (
    <Panel label={title} delay={delay}>
      <PanelHead title={title} tools={<span className="text-[11px] text-faint">Most recent first</span>} />
      {entries.length === 0 ? (
        <p className="px-3 py-5 text-xs text-faint">No journal entries in this scope.</p>
      ) : (
        <ol className="relative px-3 py-2">
          <span aria-hidden="true" className="absolute top-4 bottom-4 left-[91.5px] w-px bg-line" />
          {entries.slice(0, limit).map((entry) => (
            <li key={entry.id} className={`${deskMotion.fade} relative grid grid-cols-[64px_16px_minmax(0,1fr)] gap-x-2 py-1.5`}>
              <span className="tnum pt-0.5 text-right font-mono text-[10px] leading-4 text-faint" title={entry.at}>
                {/\d{2}:\d{2}/.test(entry.at) ? entry.at.replace(" UTC", "") : "local"}
              </span>
              <span className="relative flex justify-center pt-1">
                <span className={`relative z-[1] h-2.5 w-2.5 rounded-full border-2 ${EVIDENCE_DOT[entry.evidence]}`}>
                  <span className={`absolute inset-[1px] rounded-full ${actionTone(entry.action)}`} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-ink">
                  {entry.action} <span className="font-mono text-faint">{entry.subject}</span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-dim">{entry.detail}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-off">{`${entry.actor} / ${evidenceLabel(entry.evidence)}`}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
