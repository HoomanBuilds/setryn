"use client";

import { useEffect, useMemo, useState } from "react";
import { ChainIcon, chainLabelOf } from "@/components/icons/AssetIcon";
import { Chip, LiveDot, Metric, Panel, PanelHead, TH } from "@/components/strategies/desk/Desk";
import { formatNumber } from "@/lib/terminal/format";

type CodeState = "MATCHES" | "MISMATCH" | "MISSING";

interface DeploymentStatus {
  environment: string;
  manifestChainId: number;
  chainId: number;
  status: string;
  generatedAt: string | null;
  sourceCommit: string | null;
  compiler: { version: string; evmVersion: string; optimizer: { enabled: boolean; runs: number }; viaIR?: boolean; bytecodeHashMode: string };
  blockNumber: string;
  headTime: string;
  chainTime: string;
  checkedAt: string;
  contracts: { name: string; kind: "library" | "core" | "protocol"; address: string; expectedHash: string | null; liveHash: string | null; state: CodeState }[];
}

type Reading =
  | { kind: "LOADING" }
  | { kind: "UNAVAILABLE"; reason: string; checkedAt: string }
  | { kind: "READY"; status: DeploymentStatus };

const POLL_MS = 15_000;
const KIND_LABEL = { library: "Linked library", core: "Core registry", protocol: "Protocol" } as const;
const STATE_COPY: Record<CodeState, { label: string; tone: "up" | "down" }> = {
  MATCHES: { label: "Code matches", tone: "up" },
  MISMATCH: { label: "Hash differs", tone: "down" },
  MISSING: { label: "No code", tone: "down" },
};

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "none";
}

function utc(value: string): string {
  const date = new Date(value);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function useDeploymentStatus(): Reading {
  const [reading, setReading] = useState<Reading>({ kind: "LOADING" });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/internal/deployment", { cache: "no-store" });
        const body = (await response.json()) as DeploymentStatus | { error: string };
        if (cancelled) return;
        if (!response.ok || "error" in body) {
          setReading({
            kind: "UNAVAILABLE",
            reason: "error" in body && body.error === "EVIDENCE_MISSING" ? "No deployment evidence is recorded yet." : "The chain RPC did not respond.",
            checkedAt: new Date().toISOString(),
          });
          return;
        }
        setReading({ kind: "READY", status: body });
      } catch {
        if (!cancelled) setReading({ kind: "UNAVAILABLE", reason: "The status service did not respond.", checkedAt: new Date().toISOString() });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return reading;
}

export function StatusBoard() {
  const reading = useDeploymentStatus();
  const [filter, setFilter] = useState<"ALL" | "ISSUES">("ALL");
  const status = reading.kind === "READY" ? reading.status : null;
  const counts = useMemo(() => {
    const contracts = status?.contracts ?? [];
    return {
      total: contracts.length,
      matching: contracts.filter((contract) => contract.state === "MATCHES").length,
      libraries: contracts.filter((contract) => contract.kind === "library").length,
    };
  }, [status]);
  const chainMatches = status ? status.chainId === status.manifestChainId : false;
  const operational = status !== null && chainMatches && counts.matching === counts.total && counts.total > 0;
  const headline = reading.kind === "LOADING" ? "Checking" : operational ? "Operational" : reading.kind === "UNAVAILABLE" ? "Unavailable" : "Degraded";
  const visible = (status?.contracts ?? []).filter((contract) => filter === "ALL" || contract.state !== "MATCHES");

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="flex min-h-full flex-col gap-1">
        <Panel label="System status">
          <div className="flex flex-col gap-3 px-4 pt-4 pb-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="font-serif text-2xl text-ink">System status</h1>
              <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-dim">
                Every deployed contract and linked library is read from the chain and its runtime code hash is compared with the hash recorded when it was deployed.
              </p>
            </div>
            <div className="flex items-center gap-2" role="status" aria-live="polite">
              <LiveDot tone={operational ? "up" : reading.kind === "LOADING" ? "dim" : "down"} live={operational} />
              <span className={`text-sm font-medium ${operational ? "text-up" : reading.kind === "LOADING" ? "text-dim" : "text-down"}`}>{headline}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="Environment" value={status?.environment ?? "–"} note={status ? `evidence ${status.status}` : undefined} />
            <Metric
              label="Chain"
              value={
                status ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ChainIcon size={15} />
                    {String(status.chainId)}
                  </span>
                ) : (
                  "–"
                )
              }
              tone={status && !chainMatches ? "down" : "neutral"}
              note={
                status
                  ? chainMatches
                    ? `${chainLabelOf(status.chainId)}, matches evidence`
                    : `evidence says ${status.manifestChainId}`
                  : undefined
              }
            />
            <Metric label="Head block" value={status ? formatNumber(Number(status.blockNumber), 0) : "–"} note={status ? utc(status.headTime) : undefined} />
            <Metric label="Chain time" value={status ? utc(status.chainTime).slice(11) : "–"} note={status ? utc(status.chainTime).slice(0, 10) : undefined} />
            <Metric
              label="Code checks"
              value={status ? `${counts.matching} / ${counts.total}` : "–"}
              tone={status ? (counts.matching === counts.total ? "up" : "down") : "neutral"}
              note={status ? `${counts.libraries} linked libraries` : undefined}
            />
            <Metric
              label="Last checked"
              value={reading.kind === "READY" ? utc(reading.status.checkedAt).slice(11) : reading.kind === "UNAVAILABLE" ? utc(reading.checkedAt).slice(11) : "–"}
              note={`every ${POLL_MS / 1000}s`}
            />
          </div>
          {reading.kind === "UNAVAILABLE" ? (
            <p className="border-t border-line px-4 py-3 text-xs text-down">{reading.reason}</p>
          ) : null}
        </Panel>

        <div className="grid min-h-[480px] flex-1 gap-1 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel label="Deployed contracts" delay={60} className="min-h-0">
            <PanelHead
              title="Deployed contracts"
              tools={
                <div role="radiogroup" aria-label="Contract filter" className="flex rounded-md bg-inset p-0.5">
                  {(["ALL", "ISSUES"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={filter === option}
                      onClick={() => setFilter(option)}
                      className={`focus-ring h-6 rounded-[5px] px-2 text-[11px] transition-colors ${filter === option ? "bg-raised text-ink" : "text-faint hover:text-dim"}`}
                    >
                      {option === "ALL" ? "All" : "Issues"}
                    </button>
                  ))}
                </div>
              }
            />
            <div role="region" tabIndex={0} aria-label="Contract code checks" className="focus-ring scroll-thin min-h-[320px] flex-1 overflow-auto">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <caption className="sr-only">Runtime code hash of each deployed contract compared with its deployment evidence</caption>
                <thead className="sticky top-0 z-[1] bg-panel">
                  <tr className="border-b border-line">
                    <th className={TH}>Contract</th>
                    <th className={TH}>Kind</th>
                    <th className={TH}>Address</th>
                    <th className={TH}>Runtime code hash</th>
                    <th className={TH}>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-faint">
                        {status ? "Every contract matches its deployment evidence." : "Waiting for the deployment evidence."}
                      </td>
                    </tr>
                  ) : (
                    visible.map((contract) => (
                      <tr key={`${contract.kind}-${contract.name}-${contract.address}`} className="border-b border-line-soft">
                        <td className="px-3 py-2 text-ink">{contract.name}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-dim">{KIND_LABEL[contract.kind]}</td>
                        <td className="tnum px-3 py-2 font-mono text-[11px] text-dim" title={contract.address}>
                          {`${contract.address.slice(0, 8)}…${contract.address.slice(-6)}`}
                        </td>
                        <td className="tnum px-3 py-2 font-mono text-[11px] text-faint" title={contract.liveHash ?? undefined}>
                          {shortHash(contract.liveHash)}
                        </td>
                        <td className="px-3 py-2">
                          <Chip tone={STATE_COPY[contract.state].tone} dot title={`Recorded ${contract.expectedHash ?? "none"}`}>
                            {STATE_COPY[contract.state].label}
                          </Chip>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex min-h-0 flex-col gap-1">
            <Panel label="Build evidence" delay={100}>
              <PanelHead title="Build evidence" />
              <dl className="divide-y divide-line-soft text-xs">
                {[
                  ["Source commit", status?.sourceCommit ? status.sourceCommit.slice(0, 12) : "–"],
                  ["Evidence generated", status?.generatedAt ? utc(status.generatedAt) : "–"],
                  ["Compiler", status ? `solc ${status.compiler.version}` : "–"],
                  ["EVM", status?.compiler.evmVersion ?? "–"],
                  ["Pipeline", status ? (status.compiler.viaIR ? "via-IR" : "legacy") : "–"],
                  ["Optimizer runs", status ? (status.compiler.optimizer.enabled ? String(status.compiler.optimizer.runs) : "off") : "–"],
                  ["Metadata hash", status?.compiler.bytecodeHashMode ?? "–"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className="text-faint">{label}</dt>
                    <dd className="tnum truncate font-mono text-dim">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel label="What this checks" delay={140}>
              <PanelHead title="What this checks" />
              <ul className="space-y-2 px-3 py-3 text-xs leading-relaxed text-dim">
                <li>The RPC answers with the chain ID recorded in the deployment evidence.</li>
                <li>Every contract and linked library has code, and its keccak-256 runtime hash equals the recorded hash.</li>
                <li>Chain time comes from the pending block, which is the clock order deadlines and countdowns use.</li>
                <li>Explorer verification recompiles with the same profile shown under build evidence.</li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}
