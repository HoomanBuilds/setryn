"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { Chip, Skeleton, motion } from "@/components/markets/ui";
import { PlaneNote } from "@/components/portfolio/panels";
import { CollateralPanel } from "@/components/portfolio/RiskPanels";
import { usePortfolio } from "@/components/portfolio/usePortfolio";
import { Segmented } from "@/components/terminal/primitives";
import { formatNumber, formatShare, parseDecimal } from "@/lib/terminal/format";

type Kind = "DEPOSIT" | "WITHDRAW";

const KINDS: { value: Kind; label: string }[] = [
  { value: "DEPOSIT", label: "Deposit" },
  { value: "WITHDRAW", label: "Withdraw" },
];

export function CollateralView() {
  const { snapshot, portfolio } = usePortfolio();
  const { account } = portfolio;
  const asset = snapshot.account.collateralAsset;
  const figures = [
    { label: "Posted", value: formatNumber(account.postedValue, 2), note: `onchain ${asset}` },
    { label: "Eligible", value: formatNumber(account.eligible, 2), note: "no haircut in local runtime" },
    { label: "Reserved", value: formatNumber(account.reserved, 2), note: `${formatShare(account.marginUsage)} of eligible` },
    { label: "Available", value: formatNumber(account.available, 2), note: "free for package intents" },
  ];

  return (
    <div className="flex min-w-0 flex-col">
      <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col">
          <dl
            className={`${motion.enter} grid grid-cols-2 gap-px border-b border-line-soft bg-line-soft lg:grid-cols-4`}
          >
            {figures.map((figure) => (
              <div key={figure.label} className="flex min-w-0 flex-col gap-1 bg-panel px-3 py-2.5 lg:px-4">
                <dt className="truncate text-[11px] text-faint">{figure.label}</dt>
                <dd className="tnum truncate font-mono text-[13px] text-ink">
                  {figure.value}
                  <span className="ml-1 text-[10.5px] text-off">{asset}</span>
                </dd>
                <dd className="truncate text-[11px] text-off">{figure.note}</dd>
              </div>
            ))}
          </dl>
          <CollateralPanel
            className="shrink-0"
            lines={portfolio.collateralLines}
            eligible={account.eligible}
            reserved={account.reserved}
            available={account.available}
            unit={asset}
          />
        </div>
        <div className="border-t border-line-soft lg:border-t-0 lg:border-l">
          <Suspense fallback={<TransferSkeleton />}>
            <TransferCard />
          </Suspense>
        </div>
      </div>
      <PlaneNote
        chips={
          <>
            <Chip tone="muted">Onchain vault</Chip>
            <Chip tone="muted">Mainnet writes disabled</Chip>
          </>
        }
      >
        {`Balances are read from the ${snapshot.environment.label} collateral vault. Deposits and withdrawals require wallet transactions.`}
      </PlaneNote>
    </div>
  );
}

function TransferSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/**
 * The same collateral intent the account menu submits, placed where the
 * balances are read. The header's Deposit and Withdraw links preselect a side.
 */
function TransferCard() {
  const gateway = useInternalGateway();
  const { snapshot, portfolio } = usePortfolio();
  const params = useSearchParams();
  const requested: Kind = params.get("transfer") === "withdraw" ? "WITHDRAW" : "DEPOSIT";
  const [seen, setSeen] = useState<Kind>(requested);
  const [kind, setKind] = useState<Kind>(requested);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  /* A new Deposit or Withdraw link while already here switches the side. */
  if (requested !== seen) {
    setSeen(requested);
    setKind(requested);
  }

  const asset = snapshot.account.collateralAsset;
  const connected = snapshot.wallet.status === "CONNECTED";
  const available = portfolio.account.available;
  const value = parseDecimal(amount);
  const exceeds = kind === "WITHDRAW" && value > available;
  const valid = value > 0 && !exceeds;

  const connect = async () => {
    setMessage(null);
    try {
      await gateway.connectWallet();
    } catch {
      setMessage({ text: "Wallet connection was not completed. Try again from your wallet.", ok: false });
    }
  };

  const submit = async () => {
    setPending(true);
    setMessage(null);
    try {
      const result = await gateway.submitCollateralIntent({
        kind,
        accountId: snapshot.account.id,
        asset,
        amount: value,
        recipient: snapshot.wallet.address ?? "",
      });
      setAmount("");
      setMessage({
        text: `${result.kind === "DEPOSIT" ? "Deposited" : "Withdrew"} ${result.amount.toLocaleString()} ${asset} onchain.`,
        ok: true,
      });
    } catch (error) {
      setMessage({
        text:
          error instanceof Error && error.message === "CONNECT_WALLET"
            ? "Connect a wallet before creating a collateral intent."
            : error instanceof Error && error.message === "INSUFFICIENT_AVAILABLE_COLLATERAL"
              ? "That withdrawal exceeds available collateral."
              : error instanceof Error && error.message === "MAINNET_WRITE_DISABLED"
                ? "Mainnet writes are disabled by the current Setryn environment."
                : "Enter a valid collateral amount and try again.",
        ok: false,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      id="transfer"
      aria-label="Deposit or withdraw collateral"
      style={{ animationDelay: "60ms" }}
      className={`${motion.enter} flex flex-col gap-3 px-3 py-3 lg:px-4`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-ink">Transfer collateral</h2>
        <Chip tone="muted">{snapshot.environment.label}</Chip>
      </div>

      <Segmented options={KINDS} value={kind} onChange={setKind} label="Transfer direction" size="sm" />

      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between text-[11px] text-faint">
          Amount
          <span className="tnum font-mono">
            {kind === "WITHDRAW" ? `Available ${formatNumber(available, 2)}` : `Posted ${formatNumber(portfolio.account.postedValue, 2)}`}
          </span>
        </span>
        <span
          className={`flex h-11 items-center rounded-md border bg-inset px-3 transition-colors duration-150 focus-within:border-brand-edge lg:h-9 ${
            exceeds ? "border-down/50" : "border-line hover:border-line-strong"
          }`}
        >
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            aria-invalid={exceeds || undefined}
            className="tnum min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-off"
          />
          {kind === "WITHDRAW" ? (
            <button
              type="button"
              onClick={() => setAmount(String(available))}
              className="focus-ring mr-2 rounded-sm px-1 text-[11px] text-dim transition-colors hover:text-brand"
            >
              Max
            </button>
          ) : null}
          <span className="font-mono text-xs text-faint">{asset}</span>
        </span>
        {exceeds ? <span className="text-[11px] text-down">Exceeds available collateral.</span> : null}
      </label>

      {connected ? (
        <button
          type="button"
          onClick={submit}
          disabled={!valid || pending}
          className="focus-ring h-11 rounded-md bg-ink text-[13px] font-medium text-app transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 lg:h-9"
        >
          {pending ? "Waiting for wallet..." : kind === "DEPOSIT" ? `Deposit ${asset}` : `Withdraw ${asset}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={connect}
          disabled={snapshot.wallet.status === "CONNECTING"}
          className="focus-ring h-11 rounded-md bg-ink text-[13px] font-medium text-app transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 lg:h-9"
        >
          {snapshot.wallet.status === "CONNECTING" ? "Connecting..." : "Connect wallet to transfer"}
        </button>
      )}

      {message ? (
        <p role="status" className={`${motion.fade} text-xs ${message.ok ? "text-up" : "text-down"}`}>
          {message.text}
        </p>
      ) : null}

      <p className="text-[11px] leading-snug text-off">
        Each transfer is a wallet transaction against the onchain vault. Withdrawals are limited to
        available collateral; reserved collateral stays pledged to open packages.
      </p>
    </section>
  );
}
