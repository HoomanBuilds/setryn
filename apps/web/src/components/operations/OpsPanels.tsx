"use client";

import { useMemo } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { ChainIcon } from "@/components/icons/AssetIcon";
import { Chip, Flash, LiveDot, Panel, PanelHead, Row, deskMotion } from "@/components/strategies/desk/Desk";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import type { MarketFeeSchedule } from "@/lib/market-data/types";
import {
  NETWORK_OPERATOR_LABEL,
  SERIES_EVENT_LABEL,
  SERIES_PHASE_LABEL,
  seriesEvents,
  type DeploymentEvidence,
  type OperatorStatus,
  type Resource,
  type SignerStatus,
} from "@/lib/operations/deployment";
import type { SeriesRow } from "@/lib/operations/model";
import type { DependencyHealth, EnvironmentWritePolicy, EvidenceKind, OperationalAlert, OperationsJournalEntry } from "@/lib/operations/types";
import { formatNumber } from "@/lib/terminal/format";
import { Evidence } from "./OpsTables";
import { TONE_TEXT, shortHex, stateLabel, stateTone, utc, type Detail, type Tone } from "./ops-model";

export function PolicyBoundary({ policy }: { policy: EnvironmentWritePolicy }) {
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
          This console reads. Keeper calls, fixings and settlement run from the operator worker or any caller; new-risk
          controls never block terminal completion, unwind, collateral release or evidence publication.
        </p>
      </div>
    </Panel>
  );
}

export function WritePolicies({ policies, active }: { policies: EnvironmentWritePolicy[]; active: string | null }) {
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
                {policy.environment === active ? <Chip tone="up">Connected</Chip> : null}
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

export function RuntimeStatus({
  status,
  runtime,
  evidence,
}: {
  status: Resource<OperatorStatus>;
  runtime: SetrynRuntime | null;
  evidence: DeploymentEvidence | null;
}) {
  const data = status.data;
  const network = data?.network ?? null;
  return (
    <Panel label="Connected runtime" delay={20}>
      <PanelHead
        title="Runtime"
        tools={
          data && data.blockNumber !== null ? (
            <span className="flex items-center gap-2 text-[11px] text-faint">
              <LiveDot tone={data.healthy ? "up" : "down"} live={data.healthy === true} />
              <span className="tnum font-mono">
                block <Flash value={data.blockNumber}>{data.blockNumber.toLocaleString("en-US")}</Flash>
              </span>
              <Chip tone={data.healthy ? "up" : "down"}>{data.healthy ? "Live RPC" : "Degraded"}</Chip>
            </span>
          ) : (
            <span className="text-[11px] text-faint">{status.loading ? "connecting" : status.error ? "not answering" : "-"}</span>
          )
        }
      />
      {data || runtime ? (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Network</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink">
                <ChainIcon size={14} />
                {network ? NETWORK_OPERATOR_LABEL[network] : "Unknown"}
              </p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Chain</p>
              <p className="tnum mt-0.5 font-mono text-[13px] text-ink">{data?.chainId ?? runtime?.chainId ?? "-"}</p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Runtime schema</p>
              <p className="tnum mt-0.5 font-mono text-[13px] text-ink">{data?.runtimeSchema ?? runtime?.schemaVersion ?? "-"}</p>
            </div>
            <div className="bg-panel px-3 py-2">
              <p className="text-[11px] text-faint">Checked</p>
              <p className="tnum mt-0.5 font-mono text-[13px] text-ink">{data?.checkedAt ? `${data.checkedAt.slice(11, 19)} UTC` : "-"}</p>
            </div>
          </div>
          {data && data.contracts.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 px-3 py-2.5" aria-label="Core contracts">
              {data.contracts.map((contract) => (
                <li
                  key={contract.address}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-inset px-2 py-1 transition-colors duration-150 hover:border-line-strong"
                  title={contract.address}
                >
                  <LiveDot tone={contract.healthy ? "up" : "down"} />
                  <span className="truncate text-[11px] text-dim">{contract.label}</span>
                  <span className="tnum shrink-0 font-mono text-[10px] text-off">{shortHex(contract.address)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-x-6 border-t border-line px-3 py-1.5 sm:grid-cols-2">
            <Row label="Listed markets" value={runtime ? runtime.markets.length : "-"} />
            <Row label="Listed at" value={runtime?.listedAt ? utc(runtime.listedAt) : "-"} tone="dim" />
            <Row label="Deployment block" value={runtime?.deploymentBlock !== undefined ? runtime.deploymentBlock.toLocaleString("en-US") : "-"} tone="dim" />
            <Row label="Source commit" value={evidence?.sourceCommit ? evidence.sourceCommit.slice(0, 12) : "-"} tone="dim" />
            <Row
              label="Compiler"
              value={evidence?.compiler ? `${evidence.compiler.version.split("+")[0]} / ${evidence.compiler.evmVersion}${evidence.compiler.viaIR ? " / IR" : ""}` : "-"}
              tone="dim"
            />
            <Row label="Evidence status" value={evidence?.status ?? "-"} tone="dim" />
          </div>
        </>
      ) : (
        <div className="px-3 py-4 text-xs text-dim">
          {status.loading ? "Reading the deployment runtime." : "The deployment runtime is not available on this server."}
        </div>
      )}
    </Panel>
  );
}

function signerTone(signer: SignerStatus): Tone {
  if (signer.available === true) return "up";
  if (signer.available === false) return "brand";
  return "dim";
}

export function SignerPanel({ status, runtime }: { status: Resource<OperatorStatus>; runtime: SetrynRuntime | null }) {
  const data = status.data;
  const rows: { id: string; label: string; role: string; signer: SignerStatus | null }[] = [
    { id: "operator", label: "Operator", role: "Risk admission, RFQ handoff, witness staging, keeper calls", signer: data?.operator ?? null },
    { id: "maker", label: "Designated maker", role: "House quotes on the books and private requests (optional)", signer: data?.maker ?? null },
  ];
  return (
    <Panel label="Platform signers" delay={60}>
      <PanelHead title="Platform signers" tools={<KeyRound size={14} aria-hidden="true" className="text-faint" />} />
      <ul className="divide-y divide-line-soft">
        {rows.map((row) => {
          const tone = row.signer ? signerTone(row.signer) : "dim";
          return (
            <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <LiveDot tone={tone} live={tone === "up"} />
                  <span className="text-[13px] text-ink">{row.label}</span>
                </span>
                <span className="mt-0.5 block pl-3.5 text-[11px] leading-snug text-faint">{row.role}</span>
                {row.signer?.address ? <span className="tnum mt-0.5 block pl-3.5 font-mono text-[10px] text-off">{row.signer.address}</span> : null}
                {row.signer?.available === false && row.signer.reason ? (
                  <span className="mt-0.5 block pl-3.5 text-[10px] text-brand">{row.signer.reason}</span>
                ) : null}
              </span>
              <span className={`text-[11px] ${TONE_TEXT[tone]}`}>
                {!row.signer || row.signer.available === null ? "Not reported" : row.signer.available ? "Configured" : "Not configured"}
              </span>
            </li>
          );
        })}
        <li className="px-3 py-2.5">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-ink">Oracle publishers</span>
            <span className="tnum font-mono text-[11px] text-dim">
              {runtime?.oracleSigners ? `${runtime.oracleThreshold ?? "?"} of ${runtime.oracleSigners.length}` : "Not published"}
            </span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-faint">
            {runtime?.fixingAdapterKind === "chainlink-historical"
              ? "Fixings read the Chainlink round at expiry onchain."
              : runtime?.fixingAdapterKind === "signed-observation"
                ? "Fixings verify a threshold of authorized publisher signatures onchain."
                : "This runtime does not name its fixing adapter."}
          </span>
          {runtime?.oracleSigners?.map((signer) => (
            <span key={signer} className="tnum mt-0.5 block font-mono text-[10px] text-off">{signer}</span>
          ))}
        </li>
      </ul>
    </Panel>
  );
}

export function FeePanel({ fees, feeChanges }: { fees: MarketFeeSchedule | null; feeChanges: string | null }) {
  return (
    <Panel label="Fee schedule" delay={80}>
      <PanelHead
        title="Fee schedule"
        tools={fees ? <Chip tone={fees.active ? "up" : "down"}>{fees.active ? `v${fees.version} active` : `v${fees.version} inactive`}</Chip> : null}
      />
      {fees ? (
        <div className="divide-y divide-line-soft px-3 py-1">
          <Row label="Maker" value={`${formatNumber(fees.makerFeeBps, 2)} bp${fees.makerFlatFeeUsd > 0 ? ` + ${formatNumber(fees.makerFlatFeeUsd, 2)} USDC` : ""}`} />
          <Row label="Taker" value={`${formatNumber(fees.takerFeeBps, 2)} bp${fees.takerFlatFeeUsd > 0 ? ` + ${formatNumber(fees.takerFlatFeeUsd, 2)} USDC` : ""}`} />
          <Row label="Charged on" value="Fill consideration" tone="dim" />
          <Row label="Source" value={fees.source === "CHAIN" ? "Fee registry" : "Runtime fallback"} tone={fees.source === "CHAIN" ? "dim" : "brand"} />
          <Row
            label="Changes by"
            value={feeChanges === "LOCAL_OPERATOR" ? "Operator roles" : feeChanges === "GOVERNANCE_TIMELOCK" ? "Governance timelock" : "-"}
            tone="dim"
          />
        </div>
      ) : (
        <p className="px-3 py-5 text-xs text-faint">The fee schedule has not been read.</p>
      )}
    </Panel>
  );
}

export function DetailPane({
  detail,
  dependencies,
  rows,
  alerts,
  evidence,
  now,
}: {
  detail: Detail | null;
  dependencies: DependencyHealth[];
  rows: SeriesRow[];
  alerts: OperationalAlert[];
  evidence: DeploymentEvidence | null;
  now: number;
}) {
  const content = useMemo(() => {
    if (!detail) return null;
    if (detail.kind === "DEPENDENCY") {
      const item = dependencies.find((entry) => entry.id === detail.id);
      return item
        ? {
            label: item.label,
            title: item.service,
            tone: stateTone(item.state),
            state: stateLabel(item.state),
            lines: [
              ["Checkpoint", item.checkpoint],
              ["Freshness", `${item.freshness.ageLabel} / ${item.freshness.thresholdLabel}`],
            ],
            detail: item.detail,
          }
        : null;
    }
    if (detail.kind === "SERIES") {
      const row = rows.find((entry) => entry.marketKey === detail.id);
      return row
        ? {
            label: row.marketKey,
            title: `${row.name} / ${row.strategyLabel}`,
            tone: stateTone(row.phase),
            state: SERIES_PHASE_LABEL[row.phase],
            lines: [
              ["Registry status", row.status === "UNKNOWN" ? "Not read" : stateLabel(row.status)],
              ["Series id", shortHex(row.seriesId, 10, 6)],
              ["Lot / max order", `${row.lotSize ?? "-"} / ${row.maxOrderLots ?? "-"} lots`],
              ...seriesEvents(row.schedule).map((event) => [
                SERIES_EVENT_LABEL[event.kind],
                `${utc(event.at)}${event.at < now ? " (passed)" : ""}`,
              ]),
            ],
            detail: "Schedule instants come from the runtime's series schedule; registry status, versions, book and open interest from the market-data feed.",
          }
        : null;
    }
    if (detail.kind === "ALERT") {
      const item = alerts.find((entry) => entry.id === detail.id);
      return item
        ? {
            label: item.id,
            title: item.title,
            tone: stateTone(item.severity),
            state: stateLabel(item.severity),
            lines: [
              ["State", stateLabel(item.state)],
              ["Source", item.source],
              ["Raised", item.openedAt],
              ...(item.acknowledgedAt ? [["Acknowledged", item.acknowledgedAt]] : []),
              ["Reading", `${item.freshness.ageLabel} / ${item.freshness.thresholdLabel}`],
            ],
            detail: `${item.detail} Alerts clear on their own once the check passes.`,
          }
        : null;
    }
    const contract = evidence?.contracts.find((entry) => entry.address?.toLowerCase() === detail.id.toLowerCase()) ?? null;
    return {
      label: contract?.name ?? "Contract",
      title: detail.id,
      tone: contract ? (contract.state === "MATCHES" ? ("up" as const) : ("down" as const)) : ("dim" as const),
      state: contract ? stateLabel(contract.state) : "Not in manifest",
      lines: contract
        ? [
            ["Kind", contract.kind],
            ["Recorded hash", shortHex(contract.expectedHash, 12, 8)],
            ["Live hash", shortHex(contract.liveHash, 12, 8)],
          ]
        : [],
      detail: contract
        ? "The live runtime code is hashed and compared with the hash recorded when the contract was deployed."
        : "The deployment manifest does not record this address, so no code hash is checked.",
    };
  }, [alerts, dependencies, detail, evidence, now, rows]);

  return (
    <Panel label="Inspection" delay={80}>
      <PanelHead title="Inspection" tools={<ShieldCheck size={14} aria-hidden="true" className="text-faint" />} />
      {content ? (
        <div key={`${detail?.kind}-${detail?.id}`} className={`${deskMotion.fade} px-3 py-3`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">{content.label}</p>
              <p className="mt-0.5 truncate text-[11px] leading-snug text-faint">{content.title}</p>
            </div>
            <span className={`shrink-0 text-xs ${TONE_TEXT[content.tone]}`}>{content.state}</span>
          </div>
          {content.lines.length > 0 ? (
            <div className="mt-2 border-t border-line-soft pt-1">
              {content.lines.map(([label, value]) => (
                <Row key={label} label={label} value={<span className="whitespace-normal">{value}</span>} tone="dim" />
              ))}
            </div>
          ) : null}
          <p className="mt-2 border-t border-line-soft pt-2 text-xs leading-relaxed text-dim">{content.detail}</p>
        </div>
      ) : (
        <div className="px-3 py-5 text-xs leading-relaxed text-faint">
          Select a dependency, series, contract or alert to inspect what was read and when.
        </div>
      )}
    </Panel>
  );
}

const EVIDENCE_DOT: Record<EvidenceKind, string> = {
  OBSERVED: "border-ink/70 bg-panel",
  SCHEDULED: "border-brand bg-panel",
  DERIVED: "border-faint bg-panel",
};

function actionTone(action: string): string {
  const lowered = action.toLowerCase();
  if (lowered.includes("activated")) return "bg-up";
  if (lowered.includes("registered")) return "bg-brand";
  return "bg-dim";
}

/** Fee schedule changes read from the registry's events, newest first. */
export function Journal({
  entries,
  error,
  title = "Fee schedule changes",
  limit = 6,
  delay = 120,
}: {
  entries: OperationsJournalEntry[];
  error?: string | null;
  title?: string;
  limit?: number;
  delay?: number;
}) {
  return (
    <Panel label={title} delay={delay}>
      <PanelHead title={title} tools={<span className="text-[11px] text-faint">Registry events, newest first</span>} />
      {entries.length === 0 ? (
        <p className="px-3 py-5 text-xs text-faint">{error ? "The fee registry history could not be read." : "No fee schedule changes recorded onchain."}</p>
      ) : (
        <ol className="relative px-3 py-2">
          <span aria-hidden="true" className="absolute top-4 bottom-4 left-[91.5px] w-px bg-line" />
          {entries.slice(0, limit).map((entry) => (
            <li key={entry.id} className={`${deskMotion.fade} relative grid grid-cols-[64px_16px_minmax(0,1fr)] gap-x-2 py-1.5`}>
              <span className="tnum pt-0.5 text-right font-mono text-[10px] leading-4 text-faint" title={entry.at}>
                {entry.at.slice(5, 16)}
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
                <span className="mt-0.5 block font-mono text-[10px] text-off">{`${entry.actor}${entry.transactionHash ? ` / ${shortHex(entry.transactionHash, 10, 6)}` : ""}`}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
