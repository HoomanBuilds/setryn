"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import { AssetAmount, AssetIcon, ChainIcon } from "@/components/icons/AssetIcon";
import { BUTTON_PRIMARY, BUTTON_QUIET, useWalletPrompt } from "@/components/activity/ledger-ui";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { Chip, DeskTabs, LiveDot, Metric, Panel, PanelHead, Row, TabBody, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { FEE_ACTION_LABELS } from "@/lib/internal-gateway/fee-schedule";
import { formatNumber } from "@/lib/terminal/format";
import {
  FEE_LEDGER_KIND_LABELS,
  REVENUE_CHANNEL_LABELS,
  type RevenueBucket,
  type TreasuryLedgerEntry,
  type TreasuryProjection,
} from "@/lib/treasury/types";
import { REVENUE_STREAMS } from "./revenue-streams";

const POLL_MS = 15_000;
const LEDGER_ROWS = 60;

type Reading =
  | { kind: "LOADING" }
  | { kind: "UNAVAILABLE"; reason: string; checkedAt: string; last: TreasuryProjection | null }
  | { kind: "READY"; data: TreasuryProjection };

const usd = (minor: string | bigint) => Number(formatUnits(BigInt(minor), 6));
const bps = (ppm: number | null) => (ppm === null ? "–" : `${formatNumber(ppm / 100, 2)} bp`);
const short = (value: string | null) => (value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "–");

function utc(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function useTreasury(): { reading: Reading; reload: () => void } {
  const [reading, setReading] = useState<Reading>({ kind: "LOADING" });
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/internal/treasury", { cache: "no-store" });
      const body = (await response.json()) as TreasuryProjection | { error: string; message?: string };
      if (!response.ok || "error" in body) throw new Error("error" in body ? (body.message ?? body.error) : "TREASURY_UNAVAILABLE");
      setReading({ kind: "READY", data: body });
    } catch {
      setReading((current) => ({
        kind: "UNAVAILABLE",
        reason: "The chain RPC did not answer, so treasury figures could not be refreshed.",
        checkedAt: new Date().toISOString(),
        last: current.kind === "READY" ? current.data : current.kind === "UNAVAILABLE" ? current.last : null,
      }));
    }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);
  return { reading, reload: () => void load() };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every ledger entry the projection carries, one row each, amounts exact to the settlement unit. */
function exportCsv(data: TreasuryProjection): void {
  const header = [
    "time_utc",
    "block",
    "transaction_hash",
    "consumption_id",
    "fill_id",
    "market",
    "channel",
    "fee_action",
    "entry_kind",
    "account_id",
    "amount_usdc",
    "amount_minor",
    "fee_schedule_version",
    "notional_usdc",
    "charge_rate_ppm",
  ];
  const rows = data.revenue.entries.map((entry) => [
    entry.time,
    entry.blockNumber,
    entry.transactionHash,
    entry.consumptionId,
    entry.fillId,
    entry.marketKey,
    REVENUE_CHANNEL_LABELS[entry.channel],
    entry.action === "UNRECOGNIZED" ? `unrecognized ${entry.actionId}` : FEE_ACTION_LABELS[entry.action],
    FEE_LEDGER_KIND_LABELS[entry.kind],
    entry.accountId,
    formatUnits(BigInt(entry.amountMinor), 6),
    entry.amountMinor,
    entry.feeScheduleVersion,
    entry.notionalMinor === null ? null : formatUnits(BigInt(entry.notionalMinor), 6),
    entry.chargeRatePpm,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `setryn-fee-ledger-block-${data.headBlock}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Usdc({ minor, className = "" }: { minor: string; className?: string }) {
  return <AssetAmount value={formatNumber(usd(minor), 2)} symbol="USDC" className={className} />;
}

type BreakdownId = "market" | "channel" | "action" | "kind" | "recipient";

function BucketTable({ buckets, total, caption, keyLabel }: { buckets: RevenueBucket[]; total: bigint; caption: string; keyLabel: string }) {
  return (
    <table className="w-full min-w-[560px] border-collapse text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className={TH}>{keyLabel}</th>
          <th scope="col" className={TH_NUM}>Revenue</th>
          <th scope="col" className={TH_NUM}>Share</th>
          <th scope="col" className={TH_NUM}>Fee actions</th>
        </tr>
      </thead>
      <tbody>
        {buckets.length === 0 ? (
          <tr>
            <td colSpan={4} className="px-3 py-8 text-center text-faint">No fees have been charged yet.</td>
          </tr>
        ) : (
          buckets.map((bucket) => {
            const share = total > BigInt(0) ? Number((BigInt(bucket.revenueMinor) * BigInt(10_000)) / total) / 100 : 0;
            return (
              <tr key={bucket.key} className="border-b border-line-soft">
                <td className="px-3 py-2 text-ink">{bucket.label}</td>
                <td className="tnum px-3 py-2 text-right font-mono text-ink"><Usdc minor={bucket.revenueMinor} /></td>
                <td className="tnum px-3 py-2 text-right font-mono text-dim">{`${formatNumber(share, 2)}%`}</td>
                <td className="tnum px-3 py-2 text-right font-mono text-dim">{bucket.actions}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function Breakdown({ data }: { data: TreasuryProjection }) {
  const [view, setView] = useState<BreakdownId>("market");
  const total = BigInt(data.revenue.totals.revenueMinor);
  const tabs = [
    { id: "market", label: "Market", badge: data.revenue.byMarket.length },
    { id: "channel", label: "Channel" },
    { id: "action", label: "Fee action" },
    { id: "kind", label: "Entry kind" },
    { id: "recipient", label: "Recipient" },
  ];
  return (
    <Panel label="Revenue breakdown" delay={60}>
      <PanelHead
        tabs={<DeskTabs items={tabs} value={view} onChange={(id) => setView(id as BreakdownId)} idBase="treasury-breakdown" />}
        tools={
          <button type="button" className={BUTTON_QUIET} onClick={() => exportCsv(data)} disabled={data.revenue.entries.length === 0}>
            Export CSV
          </button>
        }
      />
      <TabBody idBase="treasury-breakdown" key={view}>
        <div role="region" aria-label="Revenue breakdown table" tabIndex={0} className="focus-ring scroll-thin overflow-x-auto">
          {view === "market" ? <BucketTable buckets={data.revenue.byMarket} total={total} caption="Revenue by market" keyLabel="Market" /> : null}
          {view === "channel" ? <BucketTable buckets={data.revenue.byChannel} total={total} caption="Revenue by execution channel" keyLabel="Execution channel" /> : null}
          {view === "action" ? <BucketTable buckets={data.revenue.byAction} total={total} caption="Revenue by fee action" keyLabel="Fee action" /> : null}
          {view === "recipient" ? <BucketTable buckets={data.revenue.byRecipient} total={total} caption="Revenue by recipient account" keyLabel="Recipient account" /> : null}
          {view === "kind" ? (
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <caption className="sr-only">Fee ledger entries by kind</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={TH}>Entry kind</th>
                  <th scope="col" className={TH_NUM}>Entries</th>
                  <th scope="col" className={TH_NUM}>Signed amount</th>
                </tr>
              </thead>
              <tbody>
                {data.revenue.byKind.map((bucket) => (
                  <tr key={bucket.kind} className="border-b border-line-soft">
                    <td className="px-3 py-2 text-ink">{bucket.label}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-dim">{bucket.entries}</td>
                    <td className={`tnum px-3 py-2 text-right font-mono ${BigInt(bucket.amountMinor) < BigInt(0) ? "text-down" : "text-ink"}`}>
                      <Usdc minor={bucket.amountMinor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </TabBody>
      {data.revenue.unrecognized > 0 ? (
        <p role="status" className="border-t border-line px-3 py-2 text-xs text-down">
          {`${data.revenue.unrecognized} ledger entries carry a kind outside the fee engine's enum and are left out of every total.`}
        </p>
      ) : null}
    </Panel>
  );
}

function LedgerTable({ data }: { data: TreasuryProjection }) {
  const rows: TreasuryLedgerEntry[] = data.revenue.entries.slice(0, LEDGER_ROWS);
  return (
    <Panel label="Fee ledger" delay={100}>
      <PanelHead
        title="Fee ledger"
        tools={<Chip tone="dim">{`${data.revenue.totals.entries} entries`}</Chip>}
      />
      <div role="region" aria-label="Fee ledger entries" tabIndex={0} className="focus-ring scroll-thin max-h-[420px] overflow-auto">
        <table className="w-full min-w-[880px] border-collapse text-xs">
          <caption className="sr-only">Most recent fee ledger entries from the fee engine</caption>
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Time</th>
              <th scope="col" className={TH}>Market</th>
              <th scope="col" className={TH}>Channel</th>
              <th scope="col" className={TH}>Action</th>
              <th scope="col" className={TH}>Entry</th>
              <th scope="col" className={TH}>Account</th>
              <th scope="col" className={TH_NUM}>Amount</th>
              <th scope="col" className={TH_NUM}>Rate</th>
              <th scope="col" className={TH_NUM}>Version</th>
              <th scope="col" className={TH}>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-faint">No fee has been charged yet.</td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={`${entry.consumptionId}-${entry.kind}-${entry.accountId}`} className="border-b border-line-soft">
                  <td className="tnum px-3 py-2 whitespace-nowrap text-dim">{utc(entry.time).slice(5, 19)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink">{entry.marketKey ?? "–"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-dim">{REVENUE_CHANNEL_LABELS[entry.channel]}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-dim">
                    {entry.action === "UNRECOGNIZED" ? `Unrecognized ${short(entry.actionId)}` : FEE_ACTION_LABELS[entry.action]}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-dim">{FEE_LEDGER_KIND_LABELS[entry.kind]}</td>
                  <td className="tnum px-3 py-2 font-mono text-[11px] text-dim" title={entry.accountId}>
                    {entry.accountId.toLowerCase() === data.account.accountId.toLowerCase() ? "Fee account" : short(entry.accountId)}
                  </td>
                  <td className={`tnum px-3 py-2 text-right font-mono ${BigInt(entry.amountMinor) < BigInt(0) ? "text-down" : "text-up"}`}>
                    <Usdc minor={entry.amountMinor} />
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">{bps(entry.chargeRatePpm)}</td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">{entry.feeScheduleVersion === null ? "–" : `v${entry.feeScheduleVersion}`}</td>
                  <td className="tnum px-3 py-2 font-mono text-[11px] text-faint" title={entry.transactionHash}>{short(entry.transactionHash)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data.revenue.entriesTruncated ? (
        <p className="border-t border-line px-3 py-2 text-[11px] text-faint">The export carries the most recent 2,000 entries; totals cover every entry.</p>
      ) : null}
    </Panel>
  );
}

const STATUS_TONE = { ACTIVE: "up", PAUSED: "dim", DEPRECATED: "down", UNSPECIFIED: "dim" } as const;

function ScheduleHistory({ data }: { data: TreasuryProjection }) {
  return (
    <Panel label="Fee schedule history" delay={140}>
      <PanelHead title="Fee schedule history" tools={<Chip tone="dim">{`${data.feeSchedule.history.length} versions`}</Chip>} />
      <div role="region" aria-label="Fee schedule versions" tabIndex={0} className="focus-ring scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <caption className="sr-only">Every registered fee schedule version, its rates, and the revenue charged under it</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Version</th>
              <th scope="col" className={TH}>Status</th>
              <th scope="col" className={TH_NUM}>Maker</th>
              <th scope="col" className={TH_NUM}>Taker</th>
              <th scope="col" className={TH}>Registered</th>
              <th scope="col" className={TH}>Last activated</th>
              <th scope="col" className={TH_NUM}>Revenue</th>
              <th scope="col" className={TH_NUM}>Fee actions</th>
            </tr>
          </thead>
          <tbody>
            {data.feeSchedule.history.map((version) => (
              <tr key={version.version} className="border-b border-line-soft">
                <td className="tnum px-3 py-2 font-mono text-ink">{`v${version.version}`}</td>
                <td className="px-3 py-2">
                  <Chip tone={STATUS_TONE[version.status]} dot={version.status === "ACTIVE"}>
                    {version.status.toLowerCase()}
                  </Chip>
                  {!version.witnessInstalled ? <span className="ml-1.5 text-[11px] text-down">no rule witness</span> : null}
                </td>
                <td className="tnum px-3 py-2 text-right font-mono text-dim">{bps(version.makerFeeRatePpm)}</td>
                <td className="tnum px-3 py-2 text-right font-mono text-dim">{bps(version.takerFeeRatePpm)}</td>
                <td className="tnum px-3 py-2 whitespace-nowrap text-dim">{utc(version.registeredAt).slice(0, 16)}</td>
                <td className="tnum px-3 py-2 whitespace-nowrap text-dim">
                  {version.activatedAt.length > 0 ? utc(version.activatedAt[version.activatedAt.length - 1]).slice(0, 16) : "–"}
                </td>
                <td className="tnum px-3 py-2 text-right font-mono text-ink"><Usdc minor={version.revenueMinor} /></td>
                <td className="tnum px-3 py-2 text-right font-mono text-dim">{version.actions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.feeSchedule.events.length > 0 ? (
        <ol className="max-h-[200px] divide-y divide-line-soft overflow-y-auto border-t border-line text-xs" aria-label="Fee schedule registry events">
          {data.feeSchedule.events.slice(0, 24).map((event) => (
            <li key={`${event.transactionHash}-${event.kind}-${event.version}`} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0 truncate text-dim">{event.detail}</span>
              <span className="tnum shrink-0 font-mono text-[11px] text-faint" title={event.transactionHash}>{utc(event.time).slice(5, 16)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}

function FeeAccount({ data }: { data: TreasuryProjection }) {
  const { account } = data;
  const mismatch = account.configuredController && account.controller && account.configuredController.toLowerCase() !== account.controller.toLowerCase();
  return (
    <Panel label="Fee account" delay={80}>
      <PanelHead title="Fee account" tools={<Chip tone={account.exists ? "up" : "down"} dot>{account.exists ? "Collateral vault" : "Missing"}</Chip>} />
      <div className="px-3 py-2">
        <Row label="Account" value={<span title={account.accountId}>{short(account.accountId)}</span>} />
        <Row label="Controller" value={<span title={account.controller ?? undefined}>{short(account.controller)}</span>} />
        <Row label="Controller source" value={account.controllerSource === "RUNTIME" ? "Deployment record" : "Collateral vault"} />
        {account.pendingController ? <Row label="Pending controller" value={short(account.pendingController)} tone="brand" /> : null}
        <Row label="Posted" value={<Usdc minor={account.postedMinor} />} />
        <Row label="Locked" value={<Usdc minor={account.lockedMinor} />} />
        <Row label="Available" value={<Usdc minor={account.availableMinor} />} tone="up" />
      </div>
      {mismatch ? (
        <p className="border-t border-line px-3 py-2 text-xs text-down">
          The deployment records a different treasury controller than the vault reports. The vault&apos;s controller is the one that can withdraw.
        </p>
      ) : null}
    </Panel>
  );
}

type WithdrawStage =
  | { kind: "IDLE" }
  | { kind: "SIMULATING" }
  | { kind: "CONFIRM"; amount: number; recipient: string }
  | { kind: "SENDING"; amount: number; recipient: string }
  | { kind: "DONE"; amount: number; recipient: string; transactionHash: string }
  | { kind: "FAILED"; message: string };

const WITHDRAW_ERRORS: Record<string, string> = {
  TREASURY_CONTROLLER_REQUIRED: "Only the fee account's controller can withdraw. Nothing was sent.",
  INSUFFICIENT_AVAILABLE_COLLATERAL: "The amount is above the fee account's available balance. Nothing was sent.",
  INVALID_RECIPIENT: "Enter a valid recipient address.",
  INVALID_COLLATERAL_AMOUNT: "Enter an amount above zero.",
  TREASURY_WITHDRAWAL_REVERTED: "The vault refused the withdrawal in simulation. Nothing was sent.",
  TREASURY_WITHDRAWAL_FAILED: "The withdrawal transaction reverted.",
  CONNECT_WALLET: "Connect the controller wallet first.",
  WRONG_NETWORK: "Switch the wallet to Arbitrum One and try again.",
};

function withdrawError(caught: unknown): string {
  const code = caught instanceof Error ? caught.message : "";
  if (WITHDRAW_ERRORS[code]) return WITHDRAW_ERRORS[code];
  if (/rejected|denied/i.test(code)) return "The wallet rejected the request. Nothing was sent.";
  return "The withdrawal did not complete. No outcome is claimed; check the fee account balance.";
}

function Withdraw({ data, onDone }: { data: TreasuryProjection; onDone: () => void }) {
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const wallet = useWalletPrompt();
  const [amountInput, setAmountInput] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [stage, setStage] = useState<WithdrawStage>({ kind: "IDLE" });
  const address = snapshot.wallet.address;
  const controller = data.account.controller;
  const isController = Boolean(address && controller && address.toLowerCase() === controller.toLowerCase());
  const available = usd(data.account.availableMinor);
  const recipient = recipientInput.trim() || address || "";

  const review = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) return setStage({ kind: "FAILED", message: WITHDRAW_ERRORS.INVALID_COLLATERAL_AMOUNT });
    if (!/^\d+(\.\d{1,6})?$/.test(amountInput.trim())) return setStage({ kind: "FAILED", message: "Use at most six decimals." });
    setStage({ kind: "SIMULATING" });
    try {
      await gateway.withdrawTreasuryFees({ accountId: data.account.accountId, amount, recipient }, "SIMULATE");
      setStage({ kind: "CONFIRM", amount, recipient });
    } catch (caught) {
      setStage({ kind: "FAILED", message: withdrawError(caught) });
    }
  };

  const confirm = async () => {
    if (stage.kind !== "CONFIRM") return;
    const { amount } = stage;
    setStage({ kind: "SENDING", amount, recipient: stage.recipient });
    try {
      const result = await gateway.withdrawTreasuryFees({ accountId: data.account.accountId, amount, recipient: stage.recipient }, "SEND");
      setStage({ kind: "DONE", amount, recipient: result.recipient, transactionHash: result.transactionHash ?? "" });
      setAmountInput("");
      onDone();
    } catch (caught) {
      setStage({ kind: "FAILED", message: withdrawError(caught) });
    }
  };

  return (
    <Panel label="Withdraw fees" delay={120}>
      <PanelHead title="Withdraw fees" tools={<Chip tone={isController ? "up" : "dim"}>{isController ? "Controller connected" : "Controller only"}</Chip>} />
      <div className="px-3 py-3 text-xs">
        {!wallet.connected ? (
          <div className="space-y-2">
            <p className="leading-relaxed text-dim">
              Fees are withdrawn from the fee account with a CollateralVault withdrawal signed by the account&apos;s controller,
              <span className="tnum font-mono text-ink">{` ${short(controller)}`}</span>. Connect that wallet to withdraw.
            </p>
            <button type="button" className={BUTTON_QUIET} onClick={wallet.connect} disabled={wallet.connecting}>
              {wallet.connecting ? "Connecting" : "Connect wallet"}
            </button>
            {wallet.error ? <p className="text-down">{wallet.error}</p> : null}
          </div>
        ) : !isController ? (
          <p className="leading-relaxed text-dim">
            The connected wallet <span className="tnum font-mono text-ink">{short(address)}</span> is not the fee account&apos;s controller.
            Only <span className="tnum font-mono text-ink">{short(controller)}</span> can withdraw: the vault refuses a withdrawal from any other
            caller, and a controller change takes a proposal from the current controller and an acceptance by the new one.
          </p>
        ) : stage.kind === "CONFIRM" || stage.kind === "SENDING" ? (
          <div className="space-y-2">
            <p className="text-dim">The withdrawal simulated cleanly against the chain. Confirm to sign it.</p>
            <Row label="Amount" value={<AssetAmount value={formatNumber(stage.amount, 2)} symbol="USDC" />} />
            <Row label="Recipient" value={<span title={stage.recipient}>{short(stage.recipient)}</span>} />
            <Row label="From" value="Protocol fee account" />
            <div className="flex gap-2 pt-1">
              <button type="button" className={BUTTON_PRIMARY} onClick={() => void confirm()} disabled={stage.kind === "SENDING"}>
                {stage.kind === "SENDING" ? "Withdrawing" : "Confirm withdrawal"}
              </button>
              <button type="button" className={BUTTON_QUIET} onClick={() => setStage({ kind: "IDLE" })} disabled={stage.kind === "SENDING"}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <form className="space-y-2" onSubmit={(event) => void review(event)}>
            <div>
              <label htmlFor="treasury-withdraw-amount" className="mb-1 flex items-center justify-between text-[11px] text-faint">
                <span>Amount</span>
                <button type="button" className="text-dim underline decoration-line-strong underline-offset-2 hover:text-ink" onClick={() => setAmountInput(formatUnits(BigInt(data.account.availableMinor), 6))}>
                  {`Max ${formatNumber(available, 2)}`}
                </button>
              </label>
              <div className="flex items-center gap-2 rounded-md border border-line-strong bg-inset px-2">
                <AssetIcon symbol="USDC" size={14} />
                <input
                  id="treasury-withdraw-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  className="focus-ring tnum w-full bg-transparent py-1.5 font-mono text-sm text-ink placeholder:text-faint"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                />
                <span className="text-faint">USDC</span>
              </div>
            </div>
            <div>
              <label htmlFor="treasury-withdraw-recipient" className="mb-1 block text-[11px] text-faint">Recipient</label>
              <input
                id="treasury-withdraw-recipient"
                autoComplete="off"
                spellCheck={false}
                className="focus-ring tnum w-full rounded-md border border-line-strong bg-inset px-2 py-1.5 font-mono text-xs text-ink placeholder:text-faint"
                placeholder={address ?? "0x…"}
                value={recipientInput}
                onChange={(event) => setRecipientInput(event.target.value)}
              />
            </div>
            <button type="submit" className={BUTTON_PRIMARY} disabled={stage.kind === "SIMULATING" || available <= 0}>
              {stage.kind === "SIMULATING" ? "Simulating" : "Review withdrawal"}
            </button>
          </form>
        )}
        {stage.kind === "DONE" ? (
          <p role="status" className="mt-2 text-up">
            {`Withdrew ${formatNumber(stage.amount, 2)} USDC to ${short(stage.recipient)}. `}
            <span className="tnum font-mono text-[11px] text-dim" title={stage.transactionHash}>{short(stage.transactionHash)}</span>
          </p>
        ) : null}
        {stage.kind === "FAILED" ? <p role="alert" className="mt-2 text-down">{stage.message}</p> : null}
      </div>
    </Panel>
  );
}

type ChangeStage =
  | { kind: "IDLE" }
  | { kind: "CONFIRM" }
  | { kind: "SENDING"; since: number }
  | { kind: "DONE"; message: string }
  | { kind: "FAILED"; message: string };

interface FeeChangeJobView {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  result: { changed: boolean; previousFeeScheduleVersion: number; feeScheduleVersion: number; markets: unknown[] } | null;
  error: { code: string; message: string } | null;
}

const JOB_POLL_MS = 3_000;

function FeeScheduleCard({ data, onChanged }: { data: TreasuryProjection; onChanged: () => void }) {
  const active = data.feeSchedule.active;
  const [makerInput, setMakerInput] = useState(String(active.makerFeeBps));
  const [takerInput, setTakerInput] = useState(String(active.takerFeeBps));
  const [stage, setStage] = useState<ChangeStage>({ kind: "IDLE" });
  const operatorControl = data.feeControl.mode === "DEVNET_OPERATOR";
  const ceiling = active.maxChargeRatePpm;

  const settle = useCallback(
    (job: FeeChangeJobView) => {
      if (job.status === "SUCCEEDED" && job.result) {
        const { result } = job;
        setStage({
          kind: "DONE",
          message: result.changed
            ? `Version ${result.feeScheduleVersion} is active and every market moved to it (${result.markets.length} markets). New orders and quotes sign version ${result.feeScheduleVersion}.`
            : `Version ${result.feeScheduleVersion} already charges these rates; nothing changed.`,
        });
        onChanged();
      } else {
        setStage({ kind: "FAILED", message: job.error?.message ?? "The fee schedule change did not complete." });
        onChanged();
      }
    },
    [onChanged],
  );

  const poll = useCallback(
    async (id: string) => {
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, JOB_POLL_MS));
        const response = await fetch(`/api/internal/devnet/fee-schedule?job=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        if (!response || !response.ok) continue;
        const job = (await response.json()) as FeeChangeJobView;
        if (job.status !== "RUNNING") return settle(job);
      }
    },
    [settle],
  );

  // A change started earlier (or from another tab) is picked up and followed to completion.
  useEffect(() => {
    if (!operatorControl) return;
    let cancelled = false;
    void fetch("/api/internal/devnet/fee-schedule", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<FeeChangeJobView>) : null))
      .then((job) => {
        if (!cancelled && job?.status === "RUNNING") {
          setStage({ kind: "SENDING", since: Date.now() });
          void poll(job.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [operatorControl, poll]);

  const submit = async () => {
    setStage({ kind: "SENDING", since: Date.now() });
    try {
      const response = await fetch("/api/internal/devnet/fee-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makerBps: Number(makerInput), takerBps: Number(takerInput) }),
      });
      const body = (await response.json()) as FeeChangeJobView & { message?: string; error?: unknown };
      if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "The fee schedule change did not start.");
      await poll(body.id);
    } catch (caught) {
      setStage({ kind: "FAILED", message: caught instanceof Error ? caught.message : "The fee schedule change did not complete." });
    }
  };

  return (
    <Panel label="Fee schedule" delay={100}>
      <PanelHead
        title="Fee schedule"
        tools={
          <Chip tone={active.active ? "up" : "down"} dot={active.active}>
            {active.active ? `v${active.version} active` : "none active"}
          </Chip>
        }
      />
      <div className="px-3 py-2">
        <Row label="Maker fee" value={bps(active.makerFeeRatePpm)} />
        <Row label="Taker fee" value={bps(active.takerFeeRatePpm)} />
        <Row label="Charged on" value="Fill consideration" />
        <Row label="Rate ceiling" value={bps(ceiling)} />
        <Row label="Latest version" value={`v${active.latestVersion}`} />
        <Row label="Registry" value={<span title={data.feeSchedule.registry}>{short(data.feeSchedule.registry)}</span>} />
        {active.source === "RUNTIME" ? <Row label="Source" value="Deployment record (chain unreachable)" tone="down" /> : null}
      </div>
      <div className="border-t border-line px-3 py-3 text-xs">
        {operatorControl ? (
          stage.kind === "CONFIRM" || stage.kind === "SENDING" ? (
            <div className="space-y-2">
              <p className="leading-relaxed text-dim">
                {stage.kind === "SENDING"
                  ? "Registering the new version, activating it, and moving every market and series onto it. This takes a few blocks, and longer when the contracts are rebuilt first."
                  : `Register v${active.latestVersion + 1} at ${formatNumber(Number(makerInput), 2)} bp maker and ${formatNumber(Number(takerInput), 2)} bp taker, activate it in place of v${active.version}, and move every market and series onto it. Resting orders signed under v${active.version} stop matching; open positions keep their version and settle as before.`}
              </p>
              <div className="flex gap-2">
                <button type="button" className={BUTTON_PRIMARY} onClick={() => void submit()} disabled={stage.kind === "SENDING"}>
                  {stage.kind === "SENDING" ? "Activating" : `Activate v${active.latestVersion + 1}`}
                </button>
                <button type="button" className={BUTTON_QUIET} onClick={() => setStage({ kind: "IDLE" })} disabled={stage.kind === "SENDING"}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                setStage({ kind: "CONFIRM" });
              }}
            >
              <p className="leading-relaxed text-dim">
                A change registers the next version with new rates, activates it in place of the active one, and moves every market and series onto it. Versions are never edited, so every past fill and open position stays under the version it signed.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["treasury-maker-bps", "Maker (bp)", makerInput, setMakerInput],
                  ["treasury-taker-bps", "Taker (bp)", takerInput, setTakerInput],
                ] as const).map(([id, label, value, setValue]) => (
                  <div key={id}>
                    <label htmlFor={id} className="mb-1 block text-[11px] text-faint">{label}</label>
                    <input
                      id={id}
                      inputMode="decimal"
                      autoComplete="off"
                      className="focus-ring tnum w-full rounded-md border border-line-strong bg-inset px-2 py-1.5 font-mono text-sm text-ink"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  </div>
                ))}
              </div>
              <button type="submit" className={BUTTON_QUIET} disabled={!Number.isFinite(Number(makerInput)) || !Number.isFinite(Number(takerInput)) || makerInput.trim() === "" || takerInput.trim() === ""}>
                Review change
              </button>
            </form>
          )
        ) : (
          <p className="leading-relaxed text-dim">
            Fee changes go through governance: a new version is registered with its rates, then the governance timelock pauses the active version and activates the new one through the registry status controller. Orders and quotes pick up the active version automatically.
          </p>
        )}
        {stage.kind === "DONE" ? <p role="status" className="mt-2 text-up">{stage.message}</p> : null}
        {stage.kind === "FAILED" ? <p role="alert" className="mt-2 text-down">{stage.message}</p> : null}
      </div>
    </Panel>
  );
}

function RevenueStreams() {
  const implemented = REVENUE_STREAMS.filter((stream) => stream.status === "IMPLEMENTED");
  const planned = REVENUE_STREAMS.filter((stream) => stream.status !== "IMPLEMENTED");
  return (
    <Panel label="Revenue streams" delay={160}>
      <PanelHead title="Revenue streams" />
      <div className="px-3 py-2 text-xs">
        <h3 className="mt-1 mb-1 text-[11px] text-faint">Implemented, collected onchain</h3>
        <ul className="divide-y divide-line-soft">
          {implemented.map((stream) => (
            <li key={stream.id} className="py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-ink">{stream.label}</span>
                <Chip tone="up" dot>Live</Chip>
              </div>
              <p className="mt-0.5 leading-relaxed text-faint">{stream.detail}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-3 mb-1 text-[11px] text-faint">Planned, not collected</h3>
        <ul className="divide-y divide-line-soft">
          {planned.map((stream) => (
            <li key={stream.id} className="flex items-baseline justify-between gap-2 py-1.5">
              <span className="min-w-0 text-dim" title={stream.detail}>{stream.label}</span>
              <Chip tone={stream.status === "MODELED" ? "brand" : "dim"}>{stream.status === "MODELED" ? "Modeled" : "Planned"}</Chip>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export function TreasuryConsole() {
  const { reading, reload } = useTreasury();
  const data = reading.kind === "READY" ? reading.data : reading.kind === "UNAVAILABLE" ? reading.last : null;
  const totals = data?.revenue.totals;
  const active = data?.feeSchedule.active;
  const collecting = Boolean(active?.active);
  const headline = reading.kind === "LOADING" ? "Checking" : reading.kind === "UNAVAILABLE" ? "Unavailable" : collecting ? "Collecting" : "No active schedule";
  const tone = reading.kind === "LOADING" ? "dim" : reading.kind === "READY" && collecting ? "up" : "down";
  const treasuryShare = useMemo(() => {
    if (!totals || BigInt(totals.revenueMinor) === BigInt(0)) return null;
    return Number((BigInt(totals.treasuryRevenueMinor) * BigInt(10_000)) / BigInt(totals.revenueMinor)) / 100;
  }, [totals]);

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="flex flex-col gap-1">
        <Panel label="Treasury">
          <div className="flex flex-col gap-3 px-4 pt-4 pb-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="font-serif text-2xl text-ink">Treasury</h1>
              <p className="mt-1 max-w-[76ch] text-xs leading-relaxed text-dim">
                Protocol fees on Arbitrum One, rebuilt from the fee engine&apos;s own ledger. Every maker and taker fee is funded from the payer&apos;s collateral at clearing and credited to the protocol fee account in the collateral vault.
              </p>
            </div>
            <div className="flex items-center gap-2" role="status" aria-live="polite">
              <LiveDot tone={tone} live={tone === "up"} />
              <span className={`text-sm font-medium ${tone === "up" ? "text-up" : tone === "dim" ? "text-dim" : "text-down"}`}>{headline}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Fee account"
              value={data ? <Usdc minor={data.account.postedMinor} /> : "–"}
              note={data ? `${formatNumber(usd(data.account.lockedMinor), 2)} locked` : undefined}
            />
            <Metric label="Available to withdraw" value={data ? <Usdc minor={data.account.availableMinor} /> : "–"} tone={data ? "up" : "neutral"} note="controller only" />
            <Metric
              label="Fee revenue"
              value={totals ? <Usdc minor={totals.revenueMinor} /> : "–"}
              note={treasuryShare !== null ? `${formatNumber(treasuryShare, 1)}% to the fee account` : totals ? "all recipients" : undefined}
            />
            <Metric label="Fee actions" value={totals ? formatNumber(totals.feeActions, 0) : "–"} note={totals ? `${totals.fills} fills` : undefined} />
            <Metric
              label="Active schedule"
              value={active ? (active.active ? `v${active.version}` : "none") : "–"}
              note={active ? `${bps(active.makerFeeRatePpm)} maker / ${bps(active.takerFeeRatePpm)} taker` : undefined}
            />
            <Metric
              label="Network"
              value={
                data ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ChainIcon size={15} />
                    Arbitrum One
                  </span>
                ) : (
                  "–"
                )
              }
              note={data ? `block ${formatNumber(Number(data.headBlock), 0)}, every ${POLL_MS / 1000}s` : undefined}
            />
          </div>
          {reading.kind === "UNAVAILABLE" ? <p className="border-t border-line px-4 py-3 text-xs text-down">{reading.reason}</p> : null}
        </Panel>

        {data ? (
          <div className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-1">
              <Breakdown data={data} />
              <LedgerTable data={data} />
              <ScheduleHistory data={data} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <FeeAccount data={data} />
              <Withdraw data={data} onDone={reload} />
              <FeeScheduleCard data={data} onChanged={reload} />
              <RevenueStreams />
            </div>
          </div>
        ) : (
          <div className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel label="Loading treasury">
              <p className="px-4 py-8 text-center text-xs text-faint">
                {reading.kind === "LOADING" ? "Reading the fee account and the fee ledger." : "Treasury figures appear here once the chain answers."}
              </p>
            </Panel>
            <RevenueStreams />
          </div>
        )}
      </div>
    </main>
  );
}
