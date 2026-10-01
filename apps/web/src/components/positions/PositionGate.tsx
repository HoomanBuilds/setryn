"use client";

import Link from "next/link";
import { FileSearch, Wallet } from "lucide-react";
import { BUTTON_INK, BUTTON_QUIET, useWalletPrompt } from "@/components/activity/ledger-ui";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { Panel } from "@/components/strategies/desk/Desk";
import { shortId } from "./parts";

/**
 * The route's non-position states. A disconnected wallet cannot rule out an
 * account position, so it asks for a connection; a connected account that
 * holds nothing under the id gets a plain not-found.
 */
export function PositionGate({ kind, positionId }: { kind: "connect" | "missing"; positionId?: string }) {
  const wallet = useWalletPrompt();
  const snapshot = useGatewaySnapshot();
  const connect = kind === "connect";
  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="mx-auto flex min-h-full max-w-3xl items-start justify-center pt-[6vh] pb-6">
        <Panel className="w-full" label={connect ? "Wallet required" : "Position not found"}>
          <div className="px-6 py-7 sm:px-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-raised text-dim">
              {connect ? <Wallet size={18} aria-hidden="true" /> : <FileSearch size={18} aria-hidden="true" />}
            </div>
            <p className="mt-4 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
              {connect ? "Wallet required" : "404 · Position not found"}
            </p>
            <h1 className="mt-1 font-serif text-[26px] leading-[30px] text-ink">
              {connect ? "Connect to load this position" : "No position with this identifier"}
            </h1>
            {positionId ? (
              <p title={positionId} className="tnum mt-2 truncate font-mono text-xs text-dim">
                {positionId.length > 42 ? shortId(positionId) : positionId}
              </p>
            ) : null}
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
              {connect
                ? `Positions are read from ${snapshot.environment.label} chain state for the connected account. Connect the wallet that holds this position to load its lifecycle, fills and receipts.`
                : snapshot.wallet.status === "CONNECTED"
                  ? `The connected account on ${snapshot.environment.label} holds no position under this ID, open or closed. Closed positions stay addressable here through their linked fills.`
                  : "This ID is not a Setryn position identifier. Positions are addressed by their onchain position ID."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {connect ? (
                <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={`${BUTTON_INK} h-9`}>
                  {wallet.connecting
                    ? "Connecting..."
                    : snapshot.wallet.status === "WRONG_NETWORK"
                      ? "Switch network"
                      : "Connect wallet"}
                </button>
              ) : null}
              <Link href="/portfolio/positions" className={`${BUTTON_QUIET} h-9`}>
                Open positions
              </Link>
              <Link href="/settlements" className={`${BUTTON_QUIET} h-9`}>
                Settlement center
              </Link>
              <Link href="/activity" className={`${BUTTON_QUIET} h-9`}>
                Activity
              </Link>
            </div>
            {wallet.error ? <p className="mt-3 text-xs text-down">{wallet.error}</p> : null}
          </div>
        </Panel>
      </div>
    </main>
  );
}

export function PositionSkeleton() {
  return (
    <main aria-busy="true" className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <span className="sr-only">Loading position</span>
      <div className="flex flex-col gap-1">
        <div className="rounded-lg border border-line bg-panel p-4">
          <span className="skeleton block h-3 w-48" />
          <span className="skeleton mt-3 block h-8 w-80 max-w-full" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} className="skeleton block h-12" />
            ))}
          </div>
        </div>
        <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-lg border border-line bg-panel p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="skeleton mb-4 block h-10" />
            ))}
          </div>
          <div className="rounded-lg border border-line bg-panel p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="skeleton mb-3 block h-8" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
