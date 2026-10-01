"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Wallet } from "lucide-react";
import { ChainIcon, chainLabelOf } from "@/components/icons/AssetIcon";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { Chip, deskMotion } from "@/components/strategies/desk/Desk";
import { usePreviewTick } from "@/components/terminal/PreviewMarketProvider";
import type { AlertProvenance, DevnetProbe, DevnetReading } from "@/lib/alerts";

/*
 * Page frame and small parts shared by Home, Exposures, Alerts, and Settings. They sit on the desk kit so these
 * pages read like the maker, strategy, and operations desks.
 */

export function PageFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <main
      aria-label={label}
      className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1 pb-safe lg:pb-1 [&>*]:shrink-0"
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  subtitle,
  chips,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
      <div className="flex flex-col gap-2 px-3 py-2.5 lg:min-h-[52px] lg:flex-row lg:items-center lg:gap-4 lg:py-2">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="shrink-0 font-serif text-[24px] leading-7 text-ink">{title}</h1>
          {subtitle ? <span className="hidden truncate text-xs text-faint sm:inline">{subtitle}</span> : null}
        </div>
        {chips ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div> : null}
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{actions}</div> : null}
      </div>
      {children ? <div className="border-t border-line">{children}</div> : null}
    </header>
  );
}

const PROVENANCE_COPY: Record<AlertProvenance, { label: string; title: string; tone: "neutral" | "dim" }> = {
  OBSERVED: { label: "Observed", title: "Read from an identified feed, chain event, or signed record.", tone: "dim" },
  EXECUTABLE: { label: "Executable", title: "Backed by an active order, firm quote, or reserved commitment.", tone: "dim" },
  ESTIMATED: { label: "Estimated", title: "Calculated from current inputs; not itself guaranteed.", tone: "neutral" },
  MODELED: { label: "Modeled", title: "Produced by a scenario, forecast, or model assumption.", tone: "neutral" },
  RECORDED_FIXTURE: {
    label: "Recorded fixture",
    title: "Recorded operator runtime evidence. Not a live reading.",
    tone: "neutral",
  },
};

/** Data trust label from the spec: distinguishable by its text, not only its colour. */
export function ProvenanceChip({ kind, title }: { kind: AlertProvenance; title?: string }) {
  const copy = PROVENANCE_COPY[kind];
  return (
    <Chip tone={copy.tone} title={title ?? copy.title}>
      {copy.label}
    </Chip>
  );
}

export const BUTTON_PRIMARY =
  "focus-ring inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-ink px-3.5 text-[13px] font-medium text-app transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:h-8 lg:text-xs";
export const BUTTON_SECONDARY =
  "focus-ring inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-[13px] text-ink transition-colors duration-150 hover:border-brand-edge disabled:cursor-not-allowed disabled:opacity-50 lg:h-8 lg:text-xs";
export const BUTTON_GHOST =
  "focus-ring inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-dim transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 lg:h-8 lg:text-xs";
export const BUTTON_SMALL =
  "focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-line px-2.5 text-xs text-dim transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 lg:h-7 lg:text-[11px]";

/** Connect control that reflects the gateway's wallet state; a rejected request never leaves it locked. */
export function ConnectWalletButton({ className = BUTTON_PRIMARY, label = "Connect wallet" }: { className?: string; label?: string }) {
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const [error, setError] = useState<string | null>(null);
  const status = snapshot.wallet.status;
  const connect = async () => {
    setError(null);
    try {
      await gateway.connectWallet();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message === "WALLET_UNAVAILABLE"
          ? "The wallet prompt could not open."
          : message === "RUNTIME_UNAVAILABLE"
            ? "The local runtime is not reachable."
            : "Wallet connection was not completed.",
      );
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={connect} disabled={status === "CONNECTING"} className={className}>
        <Wallet size={14} aria-hidden="true" />
        {status === "CONNECTING" ? "Connecting..." : status === "WRONG_NETWORK" ? "Switch network" : label}
      </button>
      {error ? (
        <span role="status" className="text-[11px] text-down">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function WalletBadge() {
  const snapshot = useGatewaySnapshot();
  const address = snapshot.wallet.address;
  if (snapshot.wallet.status !== "CONNECTED" || !address) return <ConnectWalletButton />;
  return (
    <span
      className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-xs text-dim"
      title={`Connected on ${chainLabelOf(snapshot.wallet.chainId ?? snapshot.environment.chainId)}`}
    >
      <span aria-hidden="true" className="live-dot h-1.5 w-1.5 rounded-full bg-up text-up" />
      <ChainIcon size={14} />
      <span className="tnum font-mono">{`${address.slice(0, 6)}...${address.slice(-4)}`}</span>
    </span>
  );
}

/**
 * Wall clock for wall-clock deadlines (RFQ and quote expiry), refreshed on the shared preview tick, so these pages
 * add no timer of their own.
 */
export function useWallClock(): number {
  const { tick } = usePreviewTick();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    return () => window.cancelAnimationFrame(frame);
  }, [tick]);
  return now;
}

/** One probe of the local runtime on mount, plus an explicit recheck. No polling. */
export function useDevnetReading(): { reading: DevnetReading; recheck: () => void } {
  const [reading, setReading] = useState<DevnetReading>({ state: "PENDING" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/internal/devnet/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("DEVNET_STATUS_UNAVAILABLE");
        const probe = (await response.json()) as DevnetProbe;
        setReading({ state: "OK", probe });
      })
      .catch(() => {
        if (!controller.signal.aborted) setReading({ state: "UNREACHABLE", checkedAt: Date.now() });
      });
    return () => controller.abort();
  }, [attempt]);
  const recheck = useCallback(() => {
    setReading({ state: "PENDING" });
    setAttempt((value) => value + 1);
  }, []);
  return { reading, recheck };
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs text-dim transition-colors hover:text-ink"
    >
      {children}
      <ArrowUpRight size={12} aria-hidden="true" />
    </Link>
  );
}

/** Quiet empty state with an optional next step, in the blotter rhythm. */
export function Empty({ title, detail, children }: { title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`${deskMotion.fade} flex flex-col items-center justify-center gap-2 px-4 py-8 text-center`}>
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full border border-line-strong">
        <span className="h-2.5 w-2.5 rounded-[3px] border border-faint" />
      </span>
      <p className="text-[13px] text-dim">{title}</p>
      {detail ? <p className="max-w-[340px] text-xs leading-relaxed text-faint">{detail}</p> : null}
      {children ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export type StateTone = "up" | "brand" | "down" | "dim";

const DOT: Record<StateTone, string> = {
  up: "bg-up text-up",
  brand: "bg-brand text-brand",
  down: "bg-down text-down",
  dim: "bg-off text-off",
};

export function StateDot({ tone, live = false }: { tone: StateTone; live?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${DOT[tone]} ${live ? "live-dot" : ""}`}
    />
  );
}
