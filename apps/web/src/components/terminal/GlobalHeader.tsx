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
  prefix: string;
  href: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const PRIMARY_NAV: NavItem[] = [
  { id: "trade", label: "Trade", prefix: "/trade", href: DEFAULT_TRADE_HREF },
  { id: "markets", label: "Markets", prefix: "/markets", href: "/markets" },
  { id: "portfolio", label: "Portfolio", prefix: "/portfolio", href: "/portfolio" },
];

const NAV_GROUPS: NavGroup[] = [
  {
    id: "build",
    label: "Build",
    items: [
      { id: "strategies", label: "Strategies", prefix: "/strategies", href: "/strategies" },
      { id: "hedges", label: "Hedges", prefix: "/hedges", href: "/hedges" },
    ],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { id: "activity", label: "Activity", prefix: "/activity", href: "/activity" },
      { id: "lifecycle", label: "Lifecycle", prefix: "/lifecycle", href: "/lifecycle" },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { id: "maker", label: "Maker", prefix: "/maker", href: "/maker" },
      { id: "operations", label: "Operations", prefix: "/operations", href: "/operations" },
    ],
  },
];

const MOBILE_NAV: NavGroup[] = [
  { id: "trade", label: "Trade", items: PRIMARY_NAV.slice(0, 2) },
  { id: "manage", label: "Manage", items: [PRIMARY_NAV[2], ...NAV_GROUPS[1].items] },
  NAV_GROUPS[0],
  NAV_GROUPS[2],
];

function isActive(item: NavItem, pathname: string): boolean {
  return pathname === item.prefix || pathname.startsWith(`${item.prefix}/`);
}

/** Trade keeps the market already on screen, so the tab never jumps markets. */
function hrefFor(item: NavItem, pathname: string): string {
  if (item.id === "trade" && isActive(item, pathname)) return pathname;
  return item.href;
}

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => isActive(item, pathname));
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
      title="Development simulation. Mainnet writes are disabled."
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);
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

  const closeNavigation = () => {
    setMenuOpen(false);
    setOpenGroup(null);
  };

  const toggleMobileNavigation = () => {
    setMenuOpen((open) => !open);
    setOpenGroup(null);
    setAccountOpen(false);
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroup((group) => (group === groupId ? null : groupId));
    setAccountOpen(false);
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
      <div className="flex h-12 items-center gap-2 px-2 sm:px-3 lg:gap-3 lg:px-4">
        <button
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={toggleMobileNavigation}
          className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-raised hover:text-ink lg:hidden"
        >
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>

        <span className="flex shrink-0 items-center gap-2">
          <Mark />
          <span className="text-sm font-semibold tracking-[0.12em] text-ink lg:text-base lg:tracking-[0.14em]">
            SETRYN
          </span>
        </span>

        <nav aria-label="Primary" className="ml-3 hidden items-center lg:flex">
          {PRIMARY_NAV.map((item) => {
            const active = isActive(item, pathname);
            const underline = (
              <span
                aria-hidden="true"
                className={`absolute inset-x-2 bottom-0 h-[2px] ${active ? "bg-brand" : "bg-transparent"}`}
              />
            );

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

          {NAV_GROUPS.map((group) => {
            const active = isGroupActive(group, pathname);
            const expanded = openGroup === group.id;

            return (
              <div key={group.id} className="relative">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-haspopup="menu"
                  onClick={() => toggleGroup(group.id)}
                  className={`focus-ring relative flex h-12 items-center gap-1 px-3 text-sm transition-colors ${
                    active || expanded ? "text-ink" : "text-dim hover:text-ink"
                  }`}
                >
                  {group.label}
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-2 bottom-0 h-[2px] ${active ? "bg-brand" : "bg-transparent"}`}
                  />
                </button>

                {expanded ? (
                  <div
                    role="menu"
                    aria-label={`${group.label} navigation`}
                    className="absolute top-full left-0 z-50 mt-1 w-48 rounded-md border border-line-strong bg-panel p-1 shadow-[0_24px_48px_rgba(0,0,0,0.55)]"
                  >
                    {group.items.map((item) => {
                      const itemActive = isActive(item, pathname);
                      return (
                        <Link
                          key={item.id}
                          role="menuitem"
                          href={hrefFor(item, pathname)}
                          aria-current={itemActive ? "page" : undefined}
                          onClick={closeNavigation}
                          className={`focus-ring relative flex h-9 items-center rounded-sm px-2.5 text-sm transition-colors ${
                            itemActive ? "bg-raised text-ink" : "text-dim hover:bg-raised hover:text-ink"
                          }`}
                        >
                          {itemActive ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px bg-brand" /> : null}
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 lg:gap-3">
          <EnvironmentChip label={snapshot.environment.label} className="hidden lg:flex" />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setAccountOpen((open) => !open);
                setOpenGroup(null);
                setMenuOpen(false);
              }}
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

      {openGroup ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setOpenGroup(null)}
        />
      ) : null}

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 cursor-default bg-black/50 lg:hidden"
            onClick={closeNavigation}
          />
          <div className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-3rem)] overflow-y-auto border-b border-line-strong bg-panel p-3 shadow-[0_24px_48px_rgba(0,0,0,0.55)] lg:hidden">
            <nav aria-label="Primary">
              <div className="grid gap-4 sm:grid-cols-2">
                {MOBILE_NAV.map((group) => (
                  <section key={group.id} aria-label={group.label}>
                    <SectionLabel>{group.label}</SectionLabel>
                    <div className="mt-1 grid gap-px">
                      {group.items.map((item) => {
                        const active = isActive(item, pathname);
                        return (
                          <Link
                            key={item.id}
                            href={hrefFor(item, pathname)}
                            aria-current={active ? "page" : undefined}
                            onClick={closeNavigation}
                            className={`focus-ring relative flex h-10 items-center rounded-sm px-2.5 text-sm transition-colors ${
                              active ? "bg-raised text-ink" : "text-dim hover:bg-raised hover:text-ink"
                            }`}
                          >
                            {active ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px bg-brand" /> : null}
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </nav>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-xs text-faint">Development environment</span>
              <EnvironmentChip label={snapshot.environment.label} />
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
