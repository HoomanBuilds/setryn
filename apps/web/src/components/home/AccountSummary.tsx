"use client";

import type { ReactNode } from "react";
import { AssetLabel } from "@/components/icons/AssetIcon";
import { ConnectWalletButton, ProvenanceChip } from "@/components/home/kit";
import type { PortfolioRead } from "@/components/portfolio/usePortfolio";
import { Chip, Flash, Meter, Panel, deskMotion } from "@/components/strategies/desk/Desk";
import { tone } from "@/components/terminal/primitives";
import type { SizeUnit } from "@/lib/settings/preferences";
import { formatCompactUsd, formatMultiple, formatNumber, formatShare, formatSignedUsd } from "@/lib/terminal/format";

function Tile({
  label,
  value,
  note,
  valueTone = "text-ink",
  chip,
  children,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  valueTone?: string;
  chip?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col bg-panel px-3 py-3 lg:px-4">
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-[11px] text-faint">{label}</span>
        {chip}
      </span>
      <span className={`tnum mt-1.5 truncate font-mono text-[17px] leading-6 ${valueTone}`}>{value}</span>
      <span className="mt-0.5 truncate text-[11px] text-off">{note}</span>
      {children ? <span className="mt-2 block">{children}</span> : null}
    </div>
  );
}

/**
 * Equity in the landing serif, with the balances and book behind it. Every figure comes from the connected
 * account on the gateway and is marked on the shared preview board, exactly as the portfolio reads it.
 */
export function AccountSummary({ read, unit }: { read: PortfolioRead; unit: SizeUnit }) {
  const { snapshot, portfolio } = read;
  const { account, runtimePnl, runtimePositions } = portfolio;
  const connected = snapshot.wallet.status === "CONNECTED";
  const asset = snapshot.account.collateralAsset;
  const [whole, fraction] = formatNumber(account.equity, 2).split(".");
  const lots = runtimePositions.reduce((sum, position) => sum + position.lots, 0);
  const usage = Math.min(1, account.marginUsage);
  const dash = <span className="text-off">-</span>;

  return (
    <Panel label="Account summary" className="overflow-hidden">
      <div className="flex flex-col lg:flex-row">
        <div className="flex shrink-0 flex-col gap-2 border-b border-line-soft px-3 py-3 lg:w-[280px] lg:border-r lg:border-b-0 lg:px-4 2xl:w-[300px]">
          <span className="flex items-center gap-2">
            <span className="text-xs text-dim">Account equity</span>
            <ProvenanceChip kind="OBSERVED" title={`Read from the ${snapshot.environment.label} collateral vault.`} />
          </span>
          {connected ? (
            <p className={`${deskMotion.fade} flex items-baseline gap-2 text-ink`}>
              <span className="tnum font-serif text-[40px] leading-[42px] font-normal tracking-[-0.02em]">
                {whole}
                <span className="text-dim">{`.${fraction}`}</span>
              </span>
              <AssetLabel symbol={asset} size={13} className="font-mono text-xs text-faint" />
            </p>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs leading-relaxed text-faint">
                {`Connect a wallet to load balances, open packages, and PnL from the ${snapshot.environment.label} account.`}
              </p>
              <ConnectWalletButton />
            </div>
          )}
          <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            <Chip tone="neutral">{snapshot.account.label}</Chip>
            <Chip tone="neutral">{snapshot.account.riskDomain}</Chip>
          </span>
        </div>
        <div className={`${connected ? "grid" : "hidden md:grid"} min-w-0 flex-1 grid-cols-2 gap-px bg-line-soft md:grid-cols-3 2xl:grid-cols-5 [&>*:last-child]:col-span-2 2xl:[&>*:last-child]:col-span-1`}>
          <Tile label="Available collateral" value={connected ? formatNumber(account.available, 2) : dash} note={connected ? "free to reserve or withdraw" : "wallet not connected"} />
          <Tile
            label="Reserved"
            value={connected ? formatNumber(account.reserved, 2) : dash}
            note={connected ? `${formatShare(account.marginUsage)} of eligible` : "wallet not connected"}
          >
            <Meter value={connected ? usage : 0} tone={usage > 0.8 ? "down" : usage > 0.6 ? "brand" : "up"} label="Reservation use" />
          </Tile>
          <Tile
            label="Open packages"
            value={connected ? String(runtimePositions.length) : dash}
            note={
              connected
                ? unit === "LOTS"
                  ? `${formatNumber(lots, 0)} lots held`
                  : `${formatCompactUsd(portfolio.runtimeGross)} gross`
                : "wallet not connected"
            }
          />
          <Tile
            label="Unrealized PnL"
            value={
              connected ? (
                <Flash value={runtimePnl.total} className="px-0.5">
                  {formatSignedUsd(runtimePnl.total, 2)}
                </Flash>
              ) : (
                dash
              )
            }
            valueTone={connected ? tone(runtimePnl.total) : "text-ink"}
            note={
              <span title="Estimated: open packages marked on the coherent index feed. Not oracle settlement values.">
                estimated on index marks
              </span>
            }
          />
          <Tile
            label="Maintenance health"
            value={connected ? (account.maintenanceMargin === 0 ? "No margin" : formatMultiple(account.healthFactor)) : dash}
            valueTone={connected && account.maintenanceMargin === 0 ? "text-dim" : "text-ink"}
            note={connected ? (account.maintenanceMargin === 0 ? "no active requirement" : `${formatNumber(account.maintenanceMargin, 0)} maintenance`) : "wallet not connected"}
          />
        </div>
      </div>
    </Panel>
  );
}
