"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { DataRow, SectionLabel, StatusDot } from "@/components/terminal/primitives";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { formatCompactAsset } from "@/lib/terminal/format";
import { AssetAmount, AssetIcon, ChainIcon, chainLabelOf } from "@/components/icons/AssetIcon";
import { WalletDetails, WalletTrigger, isWalletRejection } from "@/components/wallet/WalletMenu";
import SetrynMark from "@/components/landing/SetrynMark";
import { CommandPalette, openCommandPalette } from "@/components/shell/CommandPalette";
import { NotificationBell } from "@/components/shell/NotificationBell";
import {
  HOME_ITEM,
  NAV_GROUPS,
  PRIMARY_NAV,
  hrefFor,
  isActive,
  isGroupActive,
  type NavGroup,
} from "@/components/shell/routes";
import { useConfirmationPrefs } from "@/lib/settings/preferences";
import { useConfirmStep } from "@/components/terminal/confirm-step";

const MOBILE_NAV: NavGroup[] = [
  { id: "trade", label: "Trade", items: [HOME_ITEM, ...PRIMARY_NAV] },
  ...NAV_GROUPS,
];

/** The landing's egg, slash, and orbit dot, drawn in the brand lime. */
function Mark() {
  return <SetrynMark className="h-[22px] w-[19px] shrink-0 text-brand" />;
}

/** Network pill: the Arbitrum mark with the chain the environment runs on. */
function EnvironmentChip({ chainId, className = "" }: { chainId: number; className?: string }) {
  return (
    <span
      title={`${chainLabelOf(chainId)}, chain ${chainId}. Mainnet writes are disabled.`}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised pr-2 pl-1.5 text-xs whitespace-nowrap text-dim ${className}`}
    >
      <ChainIcon size={15} />
      {chainLabelOf(chainId)}
      <StatusDot ok />
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

  const asset = snapshot.account.collateralAsset;
  /* Compact figure with the collateral mark trailing it, so the balance column keeps its marks aligned. */
  const balance = (value: number) => (
    <AssetAmount value={formatCompactAsset(value, asset).replace(` ${asset}`, "")} symbol={asset} />
  );

  /* Opens the wallet prompt. Dismissing it is not an error; any other failure opens the panel to explain. */
  const connect = async () => {
    setAccountMessage(null);
    try {
      await gateway.connectWallet();
    } catch (error) {
      if (isWalletRejection(error)) return;
      const text = error instanceof Error ? error.message : "";
      setAccountMessage(
        text === "GAS_FUNDING_FAILED"
          ? "Gas could not be funded for this wallet. Check the chain connection and try again."
          : /rpc|fetch|http request failed|timed out|RUNTIME_UNAVAILABLE/i.test(text)
            ? "The chain RPC did not respond, so the wallet was not connected. Check the connection and try again."
            : "Wallet connection was not completed. Try again from your wallet.",
      );
      setAccountOpen(true);
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

  const [confirmations] = useConfirmationPrefs();
  const collateralStep = useConfirmStep(confirmations.collateral, 6_000);

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
      setAccountMessage(
        `${result.kind === "DEPOSIT" ? "Deposited" : "Withdrew"} ${result.amount.toLocaleString()} ${snapshot.account.collateralAsset} onchain.`,
      );
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

        <Link href="/app" aria-label="Setryn home" className="focus-ring flex shrink-0 items-center gap-2 rounded-sm">
          <Mark />
          <span className="font-serif text-[19px] leading-none font-medium tracking-[-0.01em] text-ink">Setryn</span>
        </Link>

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
                    className="menu-pop absolute top-full left-0 z-50 mt-1 w-72 rounded-lg border border-line-strong bg-panel p-1 shadow-[0_24px_48px_rgba(0,0,0,0.55)]"
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
                          className={`focus-ring relative flex flex-col rounded-md px-3 py-2 transition-colors ${
                            itemActive ? "bg-raised" : "hover:bg-raised"
                          }`}
                        >
                          {itemActive ? <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-px bg-brand" /> : null}
                          <span className={`text-sm ${itemActive ? "text-ink" : "text-dim"}`}>{item.label}</span>
                          <span className="text-xs leading-snug text-faint">{item.description}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1 lg:gap-2">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search markets, pages, and actions"
            aria-keyshortcuts="Control+K Meta+K"
            className="focus-ring flex h-11 items-center gap-2 rounded-md text-faint transition-colors hover:text-ink max-lg:w-11 max-lg:justify-center lg:h-9 lg:w-56 lg:border lg:border-line lg:bg-inset lg:px-2.5 xl:w-64"
          >
            <Search size={15} aria-hidden="true" className="shrink-0" />
            <span className="hidden flex-1 text-left text-xs lg:inline">Search markets, pages</span>
            <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-off lg:inline">Ctrl K</kbd>
          </button>
          <NotificationBell />
          <EnvironmentChip chainId={snapshot.environment.chainId} className="hidden xl:flex" />

          <div className="relative shrink-0">
            <WalletTrigger
              expanded={accountOpen}
              accountLabel={snapshot.account.label}
              onConnect={() => {
                setOpenGroup(null);
                setMenuOpen(false);
                void connect();
              }}
              onToggle={() => {
                setAccountOpen((open) => !open);
                setOpenGroup(null);
                setMenuOpen(false);
              }}
            />

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
                  <WalletDetails onConnect={() => void connect()} onDisconnect={() => setAccountOpen(false)} />

                  <div className="mt-3 divide-y divide-line border-t border-line">
                    <DataRow label="Equity" value={balance(snapshot.account.equity)} />
                    <DataRow
                      label="Eligible collateral"
                      value={balance(snapshot.account.eligible)}
                    />
                    <DataRow label="Available" value={balance(snapshot.account.available)} />
                    <DataRow label="Reserved" value={balance(snapshot.account.reserved)} />
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
                        <span className="ml-2 flex items-center gap-1 text-xs text-faint">
                          <AssetIcon symbol={snapshot.account.collateralAsset} size={13} />
                          {snapshot.account.collateralAsset}
                        </span>
                      </label>
                      <button
                        type="button"
                        disabled={collateralPending}
                        onClick={() => collateralStep.run("collateral", () => void submitCollateral())}
                        className={`focus-ring h-9 rounded-md border px-3 text-xs disabled:opacity-60 ${
                          collateralStep.armed ? "border-brand-edge text-ink" : "border-line text-dim hover:border-line-strong hover:text-ink"
                        }`}
                      >
                        {collateralPending
                          ? "Pending"
                          : collateralStep.armed
                            ? `Confirm ${collateralKind === "DEPOSIT" ? "deposit" : "withdrawal"}`
                            : "Submit"}
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
              <EnvironmentChip chainId={snapshot.environment.chainId} />
            </div>
          </div>
        </>
      ) : null}
      <CommandPalette />
    </header>
  );
}
