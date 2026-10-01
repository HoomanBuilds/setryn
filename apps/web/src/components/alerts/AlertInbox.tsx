"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, RotateCcw } from "lucide-react";
import { Chip, deskMotion } from "@/components/strategies/desk/Desk";
import { Empty, ProvenanceChip } from "@/components/home/kit";
import { CATEGORY_LABEL, SEVERITY_LABEL, describeRule, type Alert, type AlertRule } from "@/lib/alerts";
import type { PackageMarket } from "@/lib/terminal/types";
import { SEVERITY_TEXT, SeverityIcon, StatusTag } from "./parts";

const ACTION =
  "focus-ring inline-flex h-11 items-center justify-center gap-1 rounded-md border border-line px-3 text-xs text-dim transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-ink lg:h-7 lg:px-2 lg:text-[11px]";

const GRID = "lg:grid lg:grid-cols-[20px_minmax(0,1fr)_96px_132px_212px] lg:items-center lg:gap-3";

export function AlertInbox({
  alerts,
  rules,
  markets,
  onAcknowledge,
  onResolve,
  onReopen,
  emptyTitle,
}: {
  alerts: Alert[];
  rules: readonly AlertRule[];
  markets: readonly PackageMarket[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onReopen: (id: string) => void;
  emptyTitle: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (alerts.length === 0) {
    return (
      <Empty
        title={emptyTitle}
        detail="Rules on the right watch live market data and your account. Wallet and settlement alerts appear as they are raised onchain."
      />
    );
  }

  return (
    <div role="table" aria-label="Alert inbox" className="min-w-0">
      <div role="row" className={`hidden h-8 border-b border-line px-3 text-[11px] text-faint ${GRID}`}>
        <span role="columnheader" aria-label="Severity" />
        <span role="columnheader">Alert</span>
        <span role="columnheader" className="text-right">
          Value
        </span>
        <span role="columnheader">Status / raised UTC</span>
        <span role="columnheader" className="text-right">
          Actions
        </span>
      </div>
      <ul role="rowgroup">
        {alerts.map((alert) => {
          const open = expanded === alert.id;
          const rule = alert.ruleId ? rules.find((candidate) => candidate.id === alert.ruleId) : undefined;
          return (
            <li key={alert.id} role="row" className={`row-in border-b border-line-soft last:border-b-0 ${open ? "bg-raised/40" : ""}`}>
              <div className={`flex flex-col gap-2 px-3 py-2.5 lg:py-2 ${GRID}`}>
                <span className="hidden lg:block" role="cell">
                  <SeverityIcon severity={alert.severity} />
                </span>
                <div role="cell" className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : alert.id)}
                    className="focus-ring group flex w-full min-w-0 items-start gap-2 rounded-sm text-left"
                  >
                    <span className="mt-0.5 lg:hidden">
                      <SeverityIcon severity={alert.severity} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[13px] leading-5 lg:truncate ${alert.status === "RESOLVED" ? "text-dim" : "text-ink"}`}
                      >
                        {alert.title}
                      </span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-faint">
                        <span className={SEVERITY_TEXT[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</span>
                        <span aria-hidden="true" className="text-off">
                          /
                        </span>
                        <span>{CATEGORY_LABEL[alert.category]}</span>
                        <span aria-hidden="true" className="text-off">
                          /
                        </span>
                        <span className="truncate">{alert.source}</span>
                        <ProvenanceChip kind={alert.provenance} />
                        {alert.ruleId ? <Chip tone="neutral">Rule</Chip> : null}
                        {!alert.active && alert.status !== "RESOLVED" ? (
                          <Chip tone="neutral" title="The raising condition no longer holds. Resolve it once reviewed.">
                            Cleared
                          </Chip>
                        ) : null}
                      </span>
                    </span>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`mt-1 shrink-0 text-faint transition-transform duration-200 group-hover:text-dim ${open ? "rotate-180" : ""}`}
                    />
                  </button>
                </div>
                <span role="cell" className="flex items-baseline justify-between gap-3 lg:block lg:text-right">
                  <span className="text-[11px] text-faint lg:hidden">Value</span>
                  <span className="tnum truncate font-mono text-xs text-dim">{alert.value ?? "-"}</span>
                </span>
                <span role="cell" className="flex items-baseline justify-between gap-3 lg:flex-col lg:items-start lg:gap-0.5">
                  <StatusTag status={alert.status} />
                  <span className="tnum font-mono text-[11px] whitespace-nowrap text-faint">{alert.timeLabel.replace(" UTC", "")}</span>
                </span>
                <span role="cell" className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:justify-end">
                  {alert.status === "OPEN" ? (
                    <button type="button" onClick={() => onAcknowledge(alert.id)} className={ACTION}>
                      Acknowledge
                    </button>
                  ) : null}
                  {alert.status !== "RESOLVED" ? (
                    <button type="button" onClick={() => onResolve(alert.id)} className={ACTION}>
                      <Check size={12} aria-hidden="true" />
                      Resolve
                    </button>
                  ) : (
                    <button type="button" onClick={() => onReopen(alert.id)} className={ACTION}>
                      <RotateCcw size={12} aria-hidden="true" />
                      Reopen
                    </button>
                  )}
                  {alert.href ? (
                    <Link href={alert.href} aria-label={alert.actionLabel ?? "Open"} title={alert.actionLabel ?? undefined} className={`${ACTION} lg:w-7 lg:px-0`}>
                      <ArrowUpRight size={13} aria-hidden="true" />
                      <span className="lg:hidden">{alert.actionLabel}</span>
                    </Link>
                  ) : null}
                </span>
              </div>
              {open ? (
                <div className={`${deskMotion.slideDown} grid gap-3 border-t border-line-soft px-3 py-3 lg:grid-cols-[20px_minmax(0,1fr)_minmax(0,320px)] lg:gap-x-3`}>
                  <span className="hidden lg:block" />
                  <p className="text-xs leading-relaxed text-dim">{alert.detail}</p>
                  <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
                    <dt className="text-faint">Source</dt>
                    <dd className="truncate text-dim">{alert.source}</dd>
                    <dt className="text-faint">Evidence</dt>
                    <dd>
                      <ProvenanceChip kind={alert.provenance} />
                    </dd>
                    {rule ? (
                      <>
                        <dt className="text-faint">Rule</dt>
                        <dd className="text-dim">{describeRule(rule, markets)}</dd>
                      </>
                    ) : null}
                    <dt className="text-faint">Condition</dt>
                    <dd className="text-dim">{alert.active ? "Holding now" : "Cleared since it was raised"}</dd>
                    <dt className="text-faint">Alert id</dt>
                    <dd className="tnum truncate font-mono text-dim">{alert.id}</dd>
                  </dl>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
