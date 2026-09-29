"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileCheck2,
  FileSearch,
  Fingerprint,
  Link2,
  Lock,
  Minus,
  Receipt,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import {
  BUTTON_INK,
  BUTTON_QUIET,
  Chip,
  CopyButton,
  EnvironmentChip,
  Kpi,
  KpiStrip,
  PageHeader,
  Panel,
  PanelHeader,
  PanelTitle,
  formatUtcFull,
  middleTruncate,
  motion,
  useWalletPrompt,
} from "@/components/activity/ledger-ui";
import { StepTimeline } from "@/components/activity/StepTimeline";
import { DEFAULT_TRADE_HREF, findMarket, tradeHref } from "@/lib/terminal/markets";
import { formatLots, formatNumber, formatSignedUsd, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";

/* ------------------------------------------------------------------ */
/* Hash chain                                                          */
/* ------------------------------------------------------------------ */

interface ChainLink {
  id: string;
  label: string;
  caption: string;
  value: string;
  icon: ReactNode;
}

function HashChain({ links }: { links: ChainLink[] }) {
  return (
    <ol className="px-3 py-3 sm:px-4">
      {links.map((link, index) => {
        const last = index === links.length - 1;
        return (
          <li key={link.id} style={{ ["--i" as string]: index }} className={`relative ${motion.step}`}>
            <div className="group grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 rounded-md px-1 py-2 transition-colors duration-150 hover:bg-raised/60">
              <span
                className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-md border ${
                  last ? "border-brand-edge bg-brand-soft text-brand" : "border-line-strong bg-raised text-dim"
                }`}
              >
                {link.icon}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-ink">{link.label}</span>
                  <span className="tnum font-mono text-[10px] text-off">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <p className="text-[11px] text-faint">{link.caption}</p>
                <div className="mt-1 flex min-w-0 items-center gap-1 rounded-sm border border-line-soft bg-inset py-0.5 pr-0.5 pl-2">
                  <span title={link.value} className="tnum min-w-0 flex-1 truncate font-mono text-[11px] text-dim sm:hidden">
                    {middleTruncate(link.value, 12, 10)}
                  </span>
                  <span title={link.value} className="tnum hidden min-w-0 flex-1 truncate font-mono text-[11px] text-dim sm:block">
                    {link.value}
                  </span>
                  <CopyButton value={link.value} label={link.label.toLowerCase()} size={11} className="h-6 w-6" />
                </div>
              </div>
            </div>
            {!last ? (
              <span
                aria-hidden="true"
                style={{ ["--i" as string]: index }}
                className={`absolute top-[42px] bottom-[-6px] left-[20.5px] w-px bg-line-strong ${motion.rail}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Field checklist                                                     */
/* ------------------------------------------------------------------ */

interface FieldCheck {
  label: string;
  value: ReactNode;
  copy?: string;
  state: "pass" | "info" | "absent";
  note?: string;
}

function Checklist({ checks }: { checks: FieldCheck[] }) {
  return (
    <ul className="divide-y divide-line-soft">
      {checks.map((check, index) => (
        <li
          key={check.label}
          style={{ ["--i" as string]: index }}
          className={`grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 px-4 py-2 ${motion.stagger}`}
          title={check.note}
        >
          <span
            className={`mt-[1px] flex h-[18px] w-[18px] items-center justify-center rounded-full ${
              check.state === "pass"
                ? "bg-up-soft text-up"
                : check.state === "info"
                  ? "bg-raised text-dim"
                  : "border border-dashed border-line-strong text-off"
            }`}
          >
            {check.state === "pass" ? (
              <Check size={11} strokeWidth={2.5} aria-label="Present" />
            ) : check.state === "info" ? (
              <span className="h-1 w-1 rounded-full bg-dim" aria-hidden="true" />
            ) : (
              <Minus size={10} aria-label="Not retained" />
            )}
          </span>
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-xs text-faint">{check.label}</span>
            <span className="flex min-w-0 items-center justify-end gap-0.5">
              <span className="tnum min-w-0 truncate text-right font-mono text-xs text-ink">{check.value}</span>
              {check.copy ? <CopyButton value={check.copy} label={check.label.toLowerCase()} size={11} className="h-5 w-5" /> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Unavailable states                                                  */
/* ------------------------------------------------------------------ */

function Unavailable() {
  const wallet = useWalletPrompt();
  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="mx-auto flex min-h-full max-w-3xl items-start justify-center pt-[8vh]">
        <Panel className={`w-full ${motion.mount}`}>
          <div className="px-6 py-8 sm:px-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-raised text-dim">
              {wallet.connected ? <FileSearch size={18} aria-hidden="true" /> : <Wallet size={18} aria-hidden="true" />}
            </div>
            <p className="mt-4 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
              {wallet.connected ? "Receipt unavailable" : "Wallet required"}
            </p>
            <h1 className="mt-1 font-serif text-[26px] leading-[30px] text-ink">
              {wallet.connected ? "No receipt with this identifier" : "Connect to load this receipt"}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
              {wallet.connected
                ? "This receipt was not found in the connected development chain state. Confirm the network and transaction identifier, then try again."
                : "Receipts are reconstructed from the connected development chain for your account. Connect the wallet that executed this package to load its evidence."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {wallet.connected ? null : (
                <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={`${BUTTON_INK} h-9`}>
                  {wallet.connecting ? "Connecting..." : "Connect wallet"}
                </button>
              )}
              <Link href="/activity" className={`${BUTTON_QUIET} h-9`}>
                Open activity
              </Link>
              <Link href={DEFAULT_TRADE_HREF} className={`${BUTTON_QUIET} h-9`}>
                Return to trade
              </Link>
            </div>
            {wallet.error ? <p className="mt-3 text-xs text-down">{wallet.error}</p> : null}
          </div>
        </Panel>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Receipt                                                             */
/* ------------------------------------------------------------------ */

export function ReceiptExplorer({ receiptId }: { receiptId: string }) {
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const receipt = gateway.getReceipt(receiptId);
  if (!receipt) return <Unavailable />;

  const candidate = findMarket(receipt.marketId);
  const market = candidate.id === receipt.marketId ? candidate : null;
  const execution = snapshot.executions.find((entry) => entry.result.receipt.id === receipt.id);
  const unit = market ? priceUnitSuffix(market.priceUnit) : "";
  const decimals = market ? market.priceDecimals : 2;
  const outcome = execution?.result.outcome ?? "OPENED";
  const outcomeLabel = outcome === "CLOSED" ? "Closed" : outcome === "REDUCED" ? "Reduced" : "Opened";
  const sideLabel = receipt.packageSide === "SHORT" ? "Short" : "Long";
  const requestedLots = receipt.requestedLots ?? receipt.lots;
  const filledLots = receipt.filledLots ?? receipt.lots;
  const cancelledLots = receipt.cancelledLots ?? Math.max(0, requestedLots - filledLots);
  const partial = cancelledLots > 1e-9;
  const rfqRequest =
    snapshot.rfqRequests.find(
      (entry) =>
        entry.state === "EXECUTED" &&
        entry.receiptId === receipt.id &&
        entry.selectedQuoteId != null &&
        entry.quotes.some((quote) => quote.id === entry.selectedQuoteId),
    ) ?? null;
  const selectedQuote = rfqRequest?.quotes.find((quote) => quote.id === rfqRequest.selectedQuoteId) ?? null;
  const priceText = `${formatNumber(receipt.price, decimals)}${unit ? ` ${unit}` : ""}`;

  const chain: ChainLink[] = [
    {
      id: "order",
      label: "Signed order",
      caption: "Order hash the taker authorized",
      value: receipt.orderHash,
      icon: <Fingerprint size={15} aria-hidden="true" />,
    },
    ...(rfqRequest
      ? [
          {
            id: "rfq",
            label: "Private RFQ",
            caption: "Request committed to the private RFQ book",
            value: rfqRequest.id,
            icon: <Lock size={14} aria-hidden="true" />,
          },
        ]
      : []),
    ...(selectedQuote
      ? [
          {
            id: "quote",
            label: "Selected firm quote",
            caption: `${selectedQuote.solverLabel} · ${formatNumber(selectedQuote.packagePrice, decimals)} ${unit}`.trim(),
            value: selectedQuote.id,
            icon: <Link2 size={14} aria-hidden="true" />,
          },
        ]
      : []),
    {
      id: "fill",
      label: "Atomic fill",
      caption: `${formatLots(filledLots)} lots at ${priceText}`,
      value: receipt.fillId,
      icon: <Zap size={14} aria-hidden="true" />,
    },
    {
      id: "tx",
      label: "Transaction reference",
      caption: "Emitted by the connected development chain",
      value: receipt.transactionHash,
      icon: <Link2 size={14} aria-hidden="true" />,
    },
    {
      id: "receipt",
      label: "Execution receipt",
      caption: "Reconstructed from contract state and events",
      value: receipt.id,
      icon: <Receipt size={14} aria-hidden="true" />,
    },
  ];

  const checks: FieldCheck[] = [
    { label: "Outcome", value: `${outcomeLabel} ${sideLabel}`, state: "pass" },
    { label: "Package side", value: receipt.packageSide, state: "pass" },
    { label: "Order hash", value: middleTruncate(receipt.orderHash, 10, 6), copy: receipt.orderHash, state: "pass" },
    { label: "Fill ID", value: middleTruncate(receipt.fillId, 10, 6), copy: receipt.fillId, state: "pass" },
    {
      label: "Transaction reference",
      value: middleTruncate(receipt.transactionHash, 10, 6),
      copy: receipt.transactionHash,
      state: "pass",
    },
    { label: "Execution route", value: receipt.routeLabel, state: "pass" },
    {
      label: "Fill within request",
      value: partial ? `${formatLots(filledLots)} of ${formatLots(requestedLots)}` : `${formatLots(filledLots)} lots`,
      state: filledLots <= requestedLots + 1e-9 ? "pass" : "info",
      note: "Filled lots do not exceed the signed request.",
    },
    ...(selectedQuote
      ? [
          {
            label: "Fee within quote cap",
            value: `${formatUsd(receipt.fees, 2)} ≤ ${formatUsd(selectedQuote.feeCap, 2)}`,
            state: receipt.fees <= selectedQuote.feeCap + 1e-9 ? ("pass" as const) : ("info" as const),
          },
        ]
      : []),
    { label: "Created", value: formatUtcFull(receipt.createdAt), state: "pass" },
    {
      label: "Timeline steps",
      value: execution ? `${execution.updates.length} recorded` : "Not retained",
      state: execution ? "pass" : "absent",
    },
  ];

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-1">
        <PageHeader
          eyebrow={
            <>
              <Link href="/activity" className="focus-ring rounded-sm transition-colors hover:text-ink">
                Activity
              </Link>
              <ChevronRight size={11} aria-hidden="true" className="text-off" />
              <span>Execution receipt</span>
            </>
          }
          title={
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span>Execution receipt</span>
              <span className={`font-sans text-sm ${receipt.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
                {`${outcomeLabel} ${sideLabel}`}
              </span>
            </span>
          }
          description={`${receipt.packageCode} · ${snapshot.environment.label} · ${receipt.evidence.toLowerCase()} evidence`}
          right={
            <>
              <Chip tone="muted" title="Mainnet writes are disabled.">
                Mainnet writes disabled
              </Chip>
              <EnvironmentChip />
              {market ? (
                <Link href={tradeHref(market)} className={BUTTON_QUIET}>
                  Back to package market
                  <ArrowUpRight size={12} aria-hidden="true" />
                </Link>
              ) : null}
            </>
          }
        >
          <div className="flex min-w-0 items-center gap-2 border-t border-line bg-inset/60 px-4 py-2">
            <ShieldCheck size={13} aria-hidden="true" className="shrink-0 text-up" />
            <span className="shrink-0 text-[11px] text-faint">Receipt ID</span>
            <span title={receipt.id} className="tnum min-w-0 truncate font-mono text-xs text-ink">
              {receipt.id}
            </span>
            <CopyButton value={receipt.id} label="receipt ID" />
          </div>
          <KpiStrip>
            <Kpi label="Fill price" value={priceText} />
            <Kpi
              label={partial ? "Filled / requested" : "Lots"}
              value={partial ? `${formatLots(filledLots)} / ${formatLots(requestedLots)}` : formatLots(filledLots)}
              sub={partial ? `${formatLots(cancelledLots)} cancelled` : undefined}
            />
            <Kpi label="Fees" value={formatUsd(receipt.fees, 2)} />
            <Kpi
              label="Collateral released"
              value={receipt.collateralReleasedUsd != null ? formatUsd(receipt.collateralReleasedUsd, 2) : "Unavailable"}
              tone={receipt.collateralReleasedUsd != null ? "text-ink" : "text-faint"}
            />
            <Kpi
              label="Realized PnL"
              value={receipt.realizedPnlUsd != null ? formatSignedUsd(receipt.realizedPnlUsd, 2) : "Unavailable"}
              tone={
                receipt.realizedPnlUsd == null
                  ? "text-faint"
                  : receipt.realizedPnlUsd > 0
                    ? "text-up"
                    : receipt.realizedPnlUsd < 0
                      ? "text-down"
                      : "text-ink"
              }
            />
            <Kpi label="Guarantee" value={<span className="font-sans text-sm">{receipt.guarantee}</span>} title={receipt.guarantee} />
          </KpiStrip>
        </PageHeader>

        <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col gap-1">
            <Panel className={motion.mount} label="Hash chain">
              <PanelHeader right={<span className="text-[11px] text-faint">{`${chain.length} linked records`}</span>}>
                <PanelTitle icon={<Link2 size={14} aria-hidden="true" />}>Hash chain</PanelTitle>
              </PanelHeader>
              <HashChain links={chain} />
            </Panel>

            <Panel className={motion.mount} label="Completed package outcome">
              <PanelHeader
                right={
                  <Chip tone={receipt.packageSide === "SHORT" ? "down" : "up"}>{`${outcomeLabel} ${sideLabel}`}</Chip>
                }
              >
                <PanelTitle icon={<FileCheck2 size={14} aria-hidden="true" />}>Completed package outcome</PanelTitle>
              </PanelHeader>
              <p className="px-4 py-3 text-xs leading-relaxed text-dim">
                {partial
                  ? `Filled ${formatLots(filledLots)} of ${formatLots(requestedLots)} lots; ${formatLots(cancelledLots)} lots cancelled. The fill and position evidence is recorded on the connected development chain.`
                  : outcome === "CLOSED"
                    ? "This exit closed the position and released its eligible collateral on the connected development chain."
                    : outcome === "REDUCED"
                      ? "This exit reduced the position. Remaining lots and collateral stay active on the connected development chain."
                      : "This fill, position, fee, and route outcome is recorded by the local production-parity contracts."}
              </p>
            </Panel>

            {selectedQuote ? (
              <Panel className={motion.mount} label="Private RFQ evidence">
                <PanelHeader right={<span className="text-[11px] text-faint">executed locally</span>}>
                  <PanelTitle icon={<Lock size={13} aria-hidden="true" />}>Private RFQ evidence</PanelTitle>
                </PanelHeader>
                <dl className="grid grid-cols-2 gap-x-4 px-4 py-1.5 sm:grid-cols-3">
                  {[
                    ["Solver", selectedQuote.solverLabel],
                    ["Package price", `${formatNumber(selectedQuote.packagePrice, decimals)} ${unit}`.trim()],
                    ["Fee cap", formatUsd(selectedQuote.feeCap, 2)],
                    ["Capacity", formatLots(selectedQuote.capacityLots)],
                    ["Quote expires", formatUtcFull(selectedQuote.expiresAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 py-2">
                      <dt className="text-[11px] text-faint">{label}</dt>
                      <dd className="tnum mt-0.5 truncate font-mono text-xs text-ink" title={value}>
                        {value}
                      </dd>
                    </div>
                  ))}
                  <div className="col-span-2 min-w-0 py-2 sm:col-span-1">
                    <dt className="text-[11px] text-faint">Quote ID</dt>
                    <dd className="mt-0.5 flex min-w-0 items-center">
                      <span title={selectedQuote.id} className="tnum truncate font-mono text-xs text-ink">
                        {middleTruncate(selectedQuote.id, 10, 6)}
                      </span>
                      <CopyButton value={selectedQuote.id} label="quote ID" size={11} className="h-5 w-5" />
                    </dd>
                  </div>
                </dl>
              </Panel>
            ) : null}

            <Panel className={motion.mount} label="Execution timeline">
              <PanelHeader
                right={
                  <span className="text-[11px] text-faint">
                    {execution ? `${execution.updates.length} recorded steps` : "Not retained"}
                  </span>
                }
              >
                <PanelTitle icon={<Zap size={13} aria-hidden="true" />}>Execution timeline</PanelTitle>
              </PanelHeader>
              {execution && execution.updates.length > 0 ? (
                <StepTimeline
                  className="px-4 py-3.5"
                  steps={execution.updates.map((update, index) => ({
                    id: `${update.step}-${index}`,
                    label: update.label,
                    detail: update.detail,
                    hash: update.transactionHash,
                    hashLabel: "Transaction reference",
                    meta: String(index + 1).padStart(2, "0"),
                    state: "done",
                  }))}
                />
              ) : (
                <p className="px-4 py-3 text-xs leading-relaxed text-faint">
                  The step-by-step chronology is kept only for executions observed in this browser session. The linked
                  records above remain the durable evidence.
                </p>
              )}
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <Panel className={motion.mount} label="Verifiable fields">
              <PanelHeader
                right={
                  <span className="tnum font-mono text-[11px] text-up">
                    {`${checks.filter((check) => check.state === "pass").length}/${checks.length}`}
                  </span>
                }
              >
                <PanelTitle icon={<ShieldCheck size={14} aria-hidden="true" />}>Verifiable fields</PanelTitle>
              </PanelHeader>
              <Checklist checks={checks} />
              <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-faint">
                Each field is read back from the connected development chain in this browser. A check marks a recorded,
                consistent field; it is not a mainnet settlement claim.
              </p>
            </Panel>

            <Panel className={motion.mount} label="Evidence class">
              <PanelHeader>
                <PanelTitle icon={<ShieldCheck size={14} aria-hidden="true" />}>Evidence class</PanelTitle>
              </PanelHeader>
              <div className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Chip tone="brand" dot>
                    {snapshot.environment.label}
                  </Chip>
                  <Chip tone="muted">{`${receipt.evidence.toLowerCase()} evidence`}</Chip>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-faint">
                  Mainnet writes are disabled. This receipt is reconstructed from local contract state and events.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-line px-4 py-3">
                <Link href="/activity" className={`${BUTTON_QUIET} h-9`}>
                  Open activity
                </Link>
                {market ? (
                  <Link href={tradeHref(market)} className={`${BUTTON_QUIET} h-9`}>
                    Package market
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link href={DEFAULT_TRADE_HREF} className={`${BUTTON_QUIET} h-9`}>
                    Return to trade
                  </Link>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}
