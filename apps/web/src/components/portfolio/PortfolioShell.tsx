"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { Chip, LiveDot, motion } from "@/components/markets/ui";
import { AccountHero } from "@/components/portfolio/AccountHero";
import { PortfolioNav } from "@/components/portfolio/PortfolioNav";
import { usePortfolio } from "@/components/portfolio/usePortfolio";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * The frame every portfolio view shares: the title, the account hero, and one
 * panel whose header is the view switcher. The page scrolls as a document and
 * the switcher sticks, so a long book never hides where you are.
 */
export function PortfolioShell({ children }: { children: ReactNode }) {
  const read = usePortfolio();
  const gateway = useInternalGateway();
  const { snapshot, portfolio } = read;
  const [message, setMessage] = useState<string | null>(null);
  const status = snapshot.wallet.status;
  const count = portfolio.runtimePositions.length;

  const connect = async () => {
    setMessage(null);
    try {
      await gateway.connectWallet();
    } catch {
      setMessage("Wallet connection was not completed. Try again from your wallet.");
    }
  };

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app">
      <div className="flex flex-col gap-1 pb-1 lg:p-1">
        <header
          className={`${motion.enter} flex flex-col gap-3 px-3 pt-4 pb-3 lg:flex-row lg:items-end lg:px-3 lg:pt-3 lg:pb-2`}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-serif text-[30px] leading-none font-medium tracking-[-0.015em] text-ink lg:text-[32px]">
              Portfolio
            </h1>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Chip tone="neutral">{snapshot.account.label}</Chip>
              <Chip tone="muted" title={`Chain ${snapshot.environment.chainId}`}>
                {`${snapshot.environment.label} / ${snapshot.environment.evidence.toLowerCase()} evidence`}
              </Chip>
              <Chip tone="muted">{snapshot.account.riskDomain}</Chip>
              <Chip tone="muted">{`${count} active package${count === 1 ? "" : "s"}`}</Chip>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {status === "CONNECTED" && snapshot.wallet.address ? (
              <span className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-xs text-dim">
                <LiveDot />
                <span className="tnum font-mono">{shortAddress(snapshot.wallet.address)}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={connect}
                disabled={status === "CONNECTING"}
                className="focus-ring flex h-11 items-center gap-2 rounded-md bg-ink px-3.5 text-[13px] font-medium text-app transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 lg:h-8"
              >
                <Wallet size={14} aria-hidden="true" />
                {status === "CONNECTING"
                  ? "Connecting..."
                  : status === "WRONG_NETWORK"
                    ? "Switch network"
                    : "Connect wallet"}
              </button>
            )}
            <Link
              href="/portfolio/collateral?transfer=deposit"
              className="focus-ring flex h-11 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-[13px] text-ink transition-colors duration-150 hover:border-brand-edge lg:h-8 lg:text-xs"
            >
              <ArrowDownToLine size={13} aria-hidden="true" />
              Deposit
            </Link>
            <Link
              href="/portfolio/collateral?transfer=withdraw"
              className="focus-ring flex h-11 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-dim transition-colors duration-150 hover:border-line-strong hover:text-ink lg:h-8 lg:text-xs"
            >
              <ArrowUpFromLine size={13} aria-hidden="true" />
              Withdraw
            </Link>
          </div>
          {message ? (
            <p role="status" className="text-xs text-down lg:basis-full">
              {message}
            </p>
          ) : null}
        </header>

        <AccountHero read={read} />

        <div
          style={{ animationDelay: "120ms" }}
          className={`${motion.enter} flex min-w-0 flex-col border-y border-line bg-panel [--sticky-top:44px] md:overflow-clip lg:rounded-lg lg:border lg:[--sticky-top:40px]`}
        >
          <div className="sticky top-0 z-20 border-b border-line bg-panel">
            <PortfolioNav counts={{ "/portfolio/positions": count }} />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
