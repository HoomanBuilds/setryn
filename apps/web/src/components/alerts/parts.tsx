"use client";

import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { CATEGORY_LABEL, SEVERITY_LABEL, type Alert, type AlertSeverity, type AlertStatus } from "@/lib/alerts";

export const SEVERITY_TEXT: Record<AlertSeverity, string> = {
  CRITICAL: "text-down",
  WARNING: "text-brand",
  NOTICE: "text-dim",
};

const SEVERITY_ICON = {
  CRITICAL: AlertOctagon,
  WARNING: AlertTriangle,
  NOTICE: Info,
} as const;

export function SeverityIcon({ severity, size = 14 }: { severity: AlertSeverity; size?: number }) {
  const Icon = SEVERITY_ICON[severity];
  return <Icon size={size} aria-label={SEVERITY_LABEL[severity]} className={`shrink-0 ${SEVERITY_TEXT[severity]}`} />;
}

const STATUS_COPY: Record<AlertStatus, { label: string; tone: string; dot: string }> = {
  OPEN: { label: "Open", tone: "text-ink", dot: "bg-down" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "text-dim", dot: "bg-brand" },
  RESOLVED: { label: "Resolved", tone: "text-faint", dot: "bg-off" },
};

export function StatusTag({ status }: { status: AlertStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${copy.tone}`}>
      <span aria-hidden="true" className={`h-[5px] w-[5px] shrink-0 rounded-full ${copy.dot}`} />
      {copy.label}
    </span>
  );
}

/** Compact alert line for previews: the home page and the notification menu. */
export function AlertLine({ alert }: { alert: Alert }) {
  const body = (
    <>
      <span className="mt-0.5">
        <SeverityIcon severity={alert.severity} size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs ${alert.status === "RESOLVED" ? "text-faint" : "text-ink"}`}>{alert.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
          <span className="shrink-0">{CATEGORY_LABEL[alert.category]}</span>
          <span aria-hidden="true" className="text-off">/</span>
          <span className="truncate">{alert.provenance === "RECORDED_FIXTURE" ? "Recorded fixture" : alert.source}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="tnum font-mono text-[11px] text-faint">{alert.timeLabel.replace(" UTC", "")}</span>
        <StatusTag status={alert.status} />
      </span>
    </>
  );
  const className = "flex min-h-[48px] items-start gap-2.5 px-3 py-2 transition-colors duration-150";
  return alert.href ? (
    <Link href={alert.href} className={`focus-ring ${className} hover:bg-raised/60`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
