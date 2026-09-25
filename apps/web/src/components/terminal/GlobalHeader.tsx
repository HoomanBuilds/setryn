"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Wallet, X } from "lucide-react";
import { DataRow, SectionLabel, StatusDot } from "@/components/terminal/primitives";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { formatCompactUsd } from "@/lib/terminal/format";
import { DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";

interface NavItem {
  id: string;
  label: string;
  /** Route prefix that owns this item. Absent while the slice is unbuilt. */
  prefix?: string;
  href?: string;
}

const NAV: NavItem[] = [
  { id: "trade", label: "Trade", prefix: "/trade", href: DEFAULT_TRADE_HREF },
  { id: "markets", label: "Markets", prefix: "/markets", href: "/markets" },
  { id: "portfolio", label: "Portfolio", prefix: "/portfolio", href: "/portfolio" },
  { id: "activity", label: "Activity" },
];

const UNAVAILABLE_HINT = "Activity is not built in this preview.";
const NAV_HINT_ID = "nav-unavailable-hint";

function isActive(item: NavItem, pathname: string): boolean {
  if (!item.prefix) return false;
  return pathname === item.prefix || pathname.startsWith(`${item.prefix}/`);
}

/** Trade keeps the market already on screen, so the tab never jumps markets. */
function hrefFor(item: NavItem, pathname: string): string {
  if (!item.href) return "";
  if (item.id === "trade" && isActive(item, pathname)) return pathname;
  return item.href;
}

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <path d="M2 13.5 L9 3 L16 13.5" stroke="var(--color-brand)" strokeWidth="1.6" fill="none" />
      <path d="M5.4 10 L12.6 10" stroke="var(--color-brand)" strokeWidth="1.6" />
    </svg>
  );
}

function EnvironmentChip({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-sm bg-raised px-2 py-1 text-xs whitespace-nowrap text-dim ${className}`}
    >
      <StatusDot ok />
      {label}
    </span>
  );
}

export function GlobalHeader() {
  const pathname = usePathname();
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collateralKind, setCollateralKind] = useState<"DEPOSIT" | "WITHDRAW">("DEPOSIT");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [collateralPending, setCollateralPending] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  const shortAddress = snapshot.wallet.address
    ? `${snapshot.wallet.address.slice(0, 6)}...${snapshot.wallet.address.slice(-4)}`
    : null;

  const connect = async () => {
    setAccountMessage(null);
    try {
      await gateway.connectWallet();
    } catch {
      setAccountMessage("Wallet connection was not completed. Try again from your wallet.");
    }
  };

  const submitCollateral = async () => {
    const amount = Number.parseFloat(collateralAmount);
    setCollateralPending(true);
    setAccountMessage(null);
    try {
      const result = await gateway.submitCollateralIntent({
        kind: collateralKind,
        accountId: snapshot.account.id,
        asset: snapshot.account.collateralAsset,
        amount,
        recipient: snapshot.wallet.address ?? "",
      });
      setCollateralAmount("");
      setAccountMessage(`${result.kind === "DEPOSIT" ? "Deposited" : "Withdrew"} ${result.amount.toLocaleString()} USDC in the demo runtime.`);
    } catch (error) {
      setAccountMessage(
        error instanceof Error && error.message === "CONNECT_WALLET"
          ? "Connect a wallet before creating a collateral intent."
          : error instanceof Error && error.message === "INSUFFICIENT_AVAILABLE_COLLATERAL"
            ? "That withdrawal exceeds available collateral."
            : "Enter a valid collateral amount and try again.",
      );
    } finally {
      setCollateralPending(false);
    }
  };

  return (
    <header className="relative z-40 shrink-0 border-b border-line bg-panel">
      <span id={NAV_HINT_ID} className="sr-only">
        {UNAVAILABLE_HINT}
      </span>

      <div className="flex h-12 items-center gap-2 px-2 sm:px-3 lg:gap-3 lg:px-4">
        <button
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-raised hover:text-ink md:hidden"
        >
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>

        <span className="flex shrink-0 items-center gap-2">
          <Mark />
          <span className="text-sm font-semibold tracking-[0.12em] text-ink lg:text-base lg:tracking-[0.14em]">
            SETRYN
          </span>
        </span>

        <nav aria-label="Primary" className="ml-3 hidden items-center md:flex">
          {NAV.map((item) => {
            const active = isActive(item, pathname);
            const underline = (
              <span
                aria-hidden="true"
                className={`absolute inset-x-2 bottom-0 h-[2px] ${active ? "bg-brand" : "bg-transparent"}`}
              />
            );

            if (!item.href) {
              return (
                <span
                  key={item.id}
                  tabIndex={0}
                  role="link"
                  aria-disabled="true"
                  aria-describedby={NAV_HINT_ID}
                  title={UNAVAILABLE_HINT}
                  className="focus-ring relative flex h-12 cursor-default items-center px-3 text-sm text-off transition-colors hover:text-faint"
                >
                  {item.label}
                  {underline}
                </span>
              );
            }

            return (
              <Link
                key={item.id}
                href={hrefFor(item, pathname)}
                aria-current={active ? "page" : undefined}
                className={`focus-ring relative flex h-12 items-center px-3 text-sm transition-colors ${
                  active ? "text-ink" : "text-dim hover:text-ink"
                }`}
              >
                {item.label}
                {underline}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 lg:gap-3">
          <EnvironmentChip label={snapshot.environment.label} className="hidden md:flex" />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              aria-expanded={accountOpen}
              aria-label={`Account, ${snapshot.account.label}`}
              className="focus-ring flex h-11 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9 lg:gap-2 lg:px-2.5"
            >
              <Wallet size={15} aria-hidden="true" className="shrink-0" />
              <span className="hidden min-[360px]:inline">{shortAddress ?? "Connect"}</span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={`shrink-0 transition-transform ${accountOpen ? "rotate-180" : ""}`}
              />
            </button>

            {accountOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close account panel"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setAccountOpen(false)}
                />
                <div className="absolute top-full right-0 z-50 mt-2 w-[min(320px,calc(100vw-16px))] rounded-lg border border-line-strong bg-panel p-3 shadow-[0_24px_48px_rgba(0,0,0,0.55)]">
                  <div className="flex items-baseline justify-between gap-3">
                    <SectionLabel>Account</SectionLabel>
                    <span className="text-xs text-faint">{snapshot.account.label}</span>
                  </div>
                  {snapshot.wallet.status !== "CONNECTED" ? (
                    <button
                      type="button"
                      disabled={snapshot.wallet.status === "CONNECTING"}
                      onClick={connect}
                      className="focus-ring mt-3 h-9 w-full rounded-md bg-brand text-xs font-semibold text-app disabled:opacity-60"
                    >
                      {snapshot.wallet.status === "CONNECTING" ? "Connecting..." : "Connect wallet"}
                    </button>
                  ) : (
                    <p className="mt-2 font-mono text-xs text-dim">{shortAddress}</p>
                  )}

                  <div className="mt-3 divide-y divide-line border-t border-line">
                    <DataRow label="Equity" value={formatCompactUsd(snapshot.account.equity)} />
                    <DataRow
                      label="Eligible collateral"
                      value={formatCompactUsd(snapshot.account.eligible)}
                    />
                    <DataRow label="Available" value={formatCompactUsd(snapshot.account.available)} />
                    <DataRow label="Reserved" value={formatCompactUsd(snapshot.account.reserved)} />
                    <DataRow label="Risk domain" value={snapshot.account.riskDomain} tone="muted" />
                  </div>

                  <div className="mt-3 border-t border-line pt-3">
                    <div className="grid grid-cols-2 gap-1 rounded-md bg-inset p-1">
                      {(["DEPOSIT", "WITHDRAW"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setCollateralKind(kind)}
                          className={`focus-ring h-8 rounded text-xs ${collateralKind === kind ? "bg-raised text-ink" : "text-faint"}`}
                        >
                          {kind === "DEPOSIT" ? "Deposit" : "Withdraw"}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <label className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-line bg-inset px-2">
                        <span className="sr-only">Collateral amount</span>
                        <input
                          inputMode="decimal"
                          value={collateralAmount}
                          onChange={(event) => setCollateralAmount(event.target.value)}
                          placeholder="0.00"
                          className="min-w-0 flex-1 bg-transparent text-right font-mono text-xs text-ink outline-none"
                        />
                        <span className="ml-2 text-xs text-faint">USDC</span>
                      </label>
                      <button
                        type="button"
                        disabled={collateralPending}
                        onClick={submitCollateral}
                        className="focus-ring h-9 rounded-md border border-line px-3 text-xs text-dim hover:border-line-strong hover:text-ink disabled:opacity-60"
                      >
                        {collateralPending ? "Pending" : "Submit"}
                      </button>
                    </div>
                    {accountMessage ? <p className="mt-2 text-xs leading-snug text-dim">{accountMessage}</p> : null}
                  </div>

                  <Link
                    href="/portfolio"
                    onClick={() => setAccountOpen(false)}
                    className="focus-ring mt-3 flex h-11 items-center justify-between rounded-md border border-line px-2.5 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
                  >
                    Open portfolio
                    <ChevronDown size={13} aria-hidden="true" className="-rotate-90 shrink-0" />
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 cursor-default bg-black/50 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 top-full z-50 border-b border-line-strong bg-panel p-2 shadow-[0_24px_48px_rgba(0,0,0,0.55)] md:hidden">
            <div className="mb-1 border-b border-line px-1 pb-2">
              <SectionLabel>Navigate</SectionLabel>
            </div>

            <nav aria-label="Primary">
              {NAV.map((item) => {
                const active = isActive(item, pathname);

                if (!item.href) {
                  return (
                    <span
                      key={item.id}
                      tabIndex={0}
                      role="link"
                      aria-disabled="true"
                      aria-describedby={NAV_HINT_ID}
                      title={UNAVAILABLE_HINT}
                      className="focus-ring flex h-11 w-full cursor-default items-center rounded-md px-3 text-sm text-off"
                    >
                      {item.label}
                    </span>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={hrefFor(item, pathname)}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={`focus-ring flex h-11 w-full items-center justify-between rounded-md px-3 text-sm transition-colors ${
                      active ? "bg-raised text-ink" : "text-dim"
                    }`}
                  >
                    {item.label}
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="h-[6px] w-[6px] shrink-0 rounded-full bg-brand"
                      />
                    ) : null}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-1 pt-2.5">
              <span className="text-xs text-faint">Environment</span>
              <EnvironmentChip label={snapshot.environment.label} />
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
