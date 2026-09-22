"use client";

import { useState } from "react";
import { ChevronDown, Menu, Wallet, X } from "lucide-react";
import { DataRow, SectionLabel, StatusDot } from "@/components/terminal/primitives";
import { ACCOUNT, ENVIRONMENT } from "@/lib/terminal/account";
import { formatCompactUsd, formatNumber } from "@/lib/terminal/format";

const NAV = [
  { id: "trade", label: "Trade" },
  { id: "markets", label: "Markets" },
  { id: "portfolio", label: "Portfolio" },
  { id: "activity", label: "Activity" },
];

const INACTIVE_NAV_HINT = "This preview build ships the Trade terminal only.";
const NAV_HINT_ID = "nav-inactive-hint";

function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <path d="M2 13.5 L9 3 L16 13.5" stroke="var(--color-brand)" strokeWidth="1.6" fill="none" />
      <path d="M5.4 10 L12.6 10" stroke="var(--color-brand)" strokeWidth="1.6" />
    </svg>
  );
}

function EnvironmentChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-sm bg-raised px-2 py-1 text-xs whitespace-nowrap text-dim ${className}`}
    >
      <StatusDot ok />
      {ENVIRONMENT.chain}
    </span>
  );
}

export function GlobalHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header className="relative z-40 shrink-0 border-b border-line bg-panel">
      <span id={NAV_HINT_ID} className="sr-only">
        {INACTIVE_NAV_HINT}
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
            const active = item.id === "trade";
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                aria-disabled={active ? undefined : true}
                aria-describedby={active ? undefined : NAV_HINT_ID}
                title={active ? undefined : INACTIVE_NAV_HINT}
                className={`focus-ring relative h-12 px-3 text-sm transition-colors ${
                  active ? "text-ink" : "cursor-default text-off hover:text-faint"
                }`}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-2 bottom-0 h-[2px] ${active ? "bg-brand" : "bg-transparent"}`}
                />
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 lg:gap-3">
          <EnvironmentChip className="hidden md:flex" />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              aria-expanded={accountOpen}
              aria-label={`Account, ${ACCOUNT.subaccount}`}
              className="focus-ring flex h-11 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9 lg:gap-2 lg:px-2.5"
            >
              <Wallet size={15} aria-hidden="true" className="shrink-0" />
              <span className="hidden min-[360px]:inline">{ACCOUNT.subaccount}</span>
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
                    <span className="text-xs text-faint">{ACCOUNT.workspace}</span>
                  </div>
                  <p className="mt-2 text-xs leading-snug text-dim">
                    No wallet is connected. This build cannot request a signature or move
                    collateral, so every balance below is a preview fixture.
                  </p>

                  <div className="mt-3 divide-y divide-line border-t border-line">
                    <DataRow
                      label="Total collateral"
                      value={formatCompactUsd(ACCOUNT.totalCollateral)}
                    />
                    <DataRow label="Available" value={formatCompactUsd(ACCOUNT.available)} />
                    <DataRow label="Reserved" value={formatCompactUsd(ACCOUNT.reserved)} />
                    <DataRow
                      label="Initial margin"
                      value={formatCompactUsd(ACCOUNT.initialMargin)}
                    />
                    <DataRow
                      label="Maintenance margin"
                      value={formatCompactUsd(ACCOUNT.maintenanceMargin)}
                    />
                    <DataRow
                      label="Health factor"
                      value={`${formatNumber(ACCOUNT.healthFactor, 2)}x`}
                    />
                    <DataRow label="Risk domain" value={ACCOUNT.riskDomain} tone="muted" />
                  </div>
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
                const active = item.id === "trade";
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    aria-disabled={active ? undefined : true}
                    aria-describedby={active ? undefined : NAV_HINT_ID}
                    title={active ? undefined : INACTIVE_NAV_HINT}
                    onClick={active ? () => setMenuOpen(false) : undefined}
                    className={`focus-ring flex h-11 w-full items-center justify-between rounded-md px-3 text-sm transition-colors ${
                      active ? "bg-raised text-ink" : "cursor-default text-off"
                    }`}
                  >
                    {item.label}
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="h-[6px] w-[6px] shrink-0 rounded-full bg-brand"
                      />
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-1 pt-2.5">
              <span className="text-xs text-faint">Environment</span>
              <EnvironmentChip />
            </div>
          </div>
        </>
      ) : null}
    </header>
  );
}
