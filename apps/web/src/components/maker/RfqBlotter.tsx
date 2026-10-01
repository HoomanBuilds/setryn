"use client";

import { Fragment, useMemo, useState } from "react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { useChainNow } from "@/components/market-data/MarketDataProvider";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Chip, DeskTabs, Panel, PanelHead, TabBody, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import type { FirmRfqQuote, RfqRequest } from "@/lib/internal-gateway/types";
import type { MakerMarket, WorkingQuote } from "@/lib/maker/types";
import { formatLots, formatNumber, formatUtcStamp } from "@/lib/terminal/format";
import { signedUsd, usd } from "./format";

function quoteError(error: unknown): string {
  if (!(error instanceof Error)) return "The maker quote did not complete.";
  const messages: Record<string, string> = {
    INVALID_PACKAGE_PRICE: "Price must be a valid level on the market's grid.",
    INVALID_FEE_CAP: "Fee cap must be zero or more.",
    INVALID_CAPACITY: "Capacity must be positive.",
    INVALID_TTL: "TTL must be 5 to 45 seconds.",
    RFQ_NOT_FOUND: "Request not found.",
    RFQ_NOT_OPEN: "Request is not open.",
    RFQ_EXPIRED: "Request expired.",
    RFQ_QUOTE_NOT_FOUND: "No maker quote to withdraw.",
    MAKER_SIGNER_UNCONFIGURED: "No designated maker is configured on this network.",
  };
  return messages[error.message.split(/[\s:]/)[0]] ?? "The maker quote did not complete.";
}

function makerQuote(request: RfqRequest): FirmRfqQuote | null {
  return [...request.quotes].reverse().find((quote) => quote.provenance === "DESIGNATED_MAKER") ?? null;
}

const INPUT =
  "focus-ring tnum h-8 w-full rounded-md border border-line bg-panel px-2 font-mono text-xs text-ink transition-colors hover:border-line-strong";
const BUTTON =
  "focus-ring inline-flex h-7 cursor-pointer items-center rounded-md border border-line px-2 text-[11px] font-medium transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45";

function Side({ action }: { action: "BUY" | "SELL" }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-[4px] px-1.5 font-mono text-[10px] ${
        action === "BUY" ? "bg-up-soft text-up" : "bg-down-soft text-down"
      }`}
    >
      {action === "BUY" ? "BID" : "ASK"}
    </span>
  );
}

/** The wallet's working quotes, fills and private requests, each read from the gateway. */
export function RfqBlotter({
  entry,
  quotes,
  makerSigner,
  working,
  onCancel,
  onNotice,
}: {
  entry: MakerMarket;
  quotes: WorkingQuote[];
  /** Whether the deployment has a designated maker key; null when not reported. */
  makerSigner: boolean | null;
  working: boolean;
  onCancel: (quote: WorkingQuote) => void;
  onNotice: (message: string) => void;
}) {
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const now = useChainNow();
  const [tab, setTab] = useState("QUOTES");
  const [scope, setScope] = useState<"MARKET" | "ALL">("MARKET");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [capacityInput, setCapacityInput] = useState("");
  const [feeCapInput, setFeeCapInput] = useState("");
  const [ttlInput, setTtlInput] = useState("20");
  const [busy, setBusy] = useState(false);
  const market = entry.market;

  const scopedQuotes = scope === "MARKET" ? quotes.filter((quote) => quote.order.marketId === market.id) : quotes;
  const fills = useMemo(
    () =>
      [...snapshot.receipts]
        .filter((receipt) => scope === "ALL" || receipt.marketId === market.id)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, 50),
    [market.id, scope, snapshot.receipts],
  );
  const requests = useMemo(
    () =>
      [...snapshot.rfqRequests]
        .filter((request) => scope === "ALL" || request.authorization.intent.marketId === market.id)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [market.id, scope, snapshot.rfqRequests],
  );
  const openRequests = requests.filter((request) => request.state === "OPEN" && Date.parse(request.expiresAt) / 1000 > now).length;

  const openTicket = (request: RfqRequest) => {
    const intent = request.authorization.intent;
    const existing = makerQuote(request);
    setPriceInput(String(existing ? existing.packagePrice : intent.limitPrice));
    setCapacityInput(String(existing ? existing.capacityLots : intent.lots));
    setFeeCapInput(String(existing ? existing.feeCap : intent.feeCap));
    setActiveId(request.id);
  };

  const submitTicket = async (request: RfqRequest) => {
    if (busy) return;
    const reprice = makerQuote(request) !== null;
    setBusy(true);
    try {
      const updated = await gateway.submitLocalMakerQuote(request.id, {
        packagePrice: Number(priceInput),
        capacityLots: Number(capacityInput),
        feeCap: Number(feeCapInput),
        ttlSeconds: Number(ttlInput),
      });
      const posted = makerQuote(updated);
      setActiveId(null);
      onNotice(`${reprice ? "Maker quote repriced" : "Maker quote posted"} on ${request.id.slice(0, 10)} at ${posted ? posted.packagePrice : priceInput}.`);
    } catch (error) {
      onNotice(quoteError(error));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (request: RfqRequest) => {
    if (busy) return;
    setBusy(true);
    try {
      await gateway.withdrawLocalMakerQuote(request.id);
      if (activeId === request.id) setActiveId(null);
      onNotice(`Maker quote withdrawn on ${request.id.slice(0, 10)}.`);
    } catch (error) {
      onNotice(quoteError(error));
    } finally {
      setBusy(false);
    }
  };

  const makerBlock =
    makerSigner === false ? "No designated maker on this network" : snapshot.wallet.status !== "CONNECTED" ? "Connect a wallet" : null;

  return (
    <Panel label="Desk blotter" delay={100}>
      <PanelHead
        tabs={
          <DeskTabs
            idBase="maker-blotter"
            value={tab}
            onChange={setTab}
            items={[
              { id: "QUOTES", label: "Working quotes", badge: scopedQuotes.length, badgeTone: scopedQuotes.length > 0 ? "up" : "neutral" },
              { id: "FILLS", label: "Fills", badge: fills.length },
              { id: "RFQS", label: "Private requests", badge: requests.length, badgeTone: openRequests > 0 ? "brand" : "neutral" },
            ]}
          />
        }
        tools={
          <span className="flex items-center gap-1 text-[11px]">
            {(["MARKET", "ALL"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`focus-ring h-6 rounded-md px-2 transition-colors ${scope === value ? "bg-raised text-ink" : "text-faint hover:text-dim"}`}
              >
                {value === "MARKET" ? market.id : "All markets"}
              </button>
            ))}
          </span>
        }
      />

      {tab === "QUOTES" ? (
        <TabBody idBase="maker-blotter" className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs whitespace-nowrap">
            <caption className="sr-only">Your working public-book quotes</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Quote</th>
                <th scope="col" className={TH}>Side</th>
                <th scope="col" className={TH_NUM}>Price</th>
                <th scope="col" className={TH_NUM}>Remaining</th>
                <th scope="col" className={TH_NUM}>Filled</th>
                <th scope="col" className={TH_NUM}>Reservation</th>
                <th scope="col" className={TH_NUM}>Expires</th>
                <th scope="col" className={TH_NUM}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {scopedQuotes.length > 0 ? (
                scopedQuotes.map((quote) => {
                  const order = quote.order;
                  const left = order.expiresAt ? Math.max(0, Math.floor(Date.parse(order.expiresAt) / 1000 - now)) : null;
                  return (
                    <tr key={order.id} className={`${deskMotion.fade} transition-colors duration-150 hover:bg-raised/50`}>
                      <td className="h-11 px-3">
                        <span className="flex items-center gap-2">
                          <MarketMark code={order.marketId} size={14} />
                          <span className="tnum font-mono text-[12px] text-ink">{`${order.orderHash.slice(0, 10)}…`}</span>
                          {order.postOnly ? <Chip tone="dim">Post only</Chip> : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-faint">{`${order.marketId} / ${formatUtcStamp(Date.parse(order.createdAt) / 1000)} UTC`}</span>
                      </td>
                      <td className="px-3"><Side action={quote.action} /></td>
                      <td className="tnum px-3 text-right font-mono text-ink">{formatNumber(order.limitPrice, market.id === order.marketId ? market.priceDecimals : 2)}</td>
                      <td className="tnum px-3 text-right font-mono text-dim">{formatLots(order.remainingLots)}</td>
                      <td className="tnum px-3 text-right font-mono text-dim">{formatLots(order.filledLots)}</td>
                      <td className="tnum px-3 text-right font-mono text-dim">{usd(order.remainingCollateralReservation)}</td>
                      <td className={`tnum px-3 text-right font-mono ${left !== null && left < 30 ? "text-down" : "text-dim"}`}>
                        {left === null ? order.timeInForce : `${left}s`}
                      </td>
                      <td className="px-3 text-right">
                        <button type="button" disabled={working} onClick={() => onCancel(quote)} className={`${BUTTON} text-dim hover:text-down`}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-xs text-faint">
                    {snapshot.wallet.status === "CONNECTED"
                      ? `No working quotes${scope === "MARKET" ? ` on ${market.id}` : ""}. Post one from the quote composer.`
                      : "Connect a wallet to see its working quotes."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabBody>
      ) : null}

      {tab === "FILLS" ? (
        <TabBody idBase="maker-blotter" className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs whitespace-nowrap">
            <caption className="sr-only">Your fills</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Fill</th>
                <th scope="col" className={TH}>Side</th>
                <th scope="col" className={TH_NUM}>Price</th>
                <th scope="col" className={TH_NUM}>Lots</th>
                <th scope="col" className={TH_NUM}>Fee</th>
                <th scope="col" className={TH_NUM}>Realized</th>
                <th scope="col" className={TH}>Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {fills.length > 0 ? (
                fills.map((receipt) => (
                  <tr key={receipt.id} className="transition-colors duration-150 hover:bg-raised/50">
                    <td className="h-10 px-3">
                      <span className="tnum block font-mono text-[12px] text-ink">{`${receipt.fillId.slice(0, 10)}…`}</span>
                      <span className="block text-[11px] text-faint">{`${receipt.marketId} / ${formatUtcStamp(Date.parse(receipt.createdAt) / 1000)} UTC`}</span>
                    </td>
                    <td className={`px-3 ${receipt.packageSide === "LONG" ? "text-up" : "text-down"}`}>{receipt.packageSide.toLowerCase()}</td>
                    <td className="tnum px-3 text-right font-mono text-ink">{formatNumber(receipt.price, receipt.marketId === market.id ? market.priceDecimals : 2)}</td>
                    <td className="tnum px-3 text-right font-mono text-dim">{formatLots(receipt.filledLots || receipt.lots)}</td>
                    <td className="tnum px-3 text-right font-mono text-dim">{usd(receipt.fees)}</td>
                    <td className={`tnum px-3 text-right font-mono ${receipt.realizedPnlUsd === undefined ? "text-faint" : receipt.realizedPnlUsd >= 0 ? "text-up" : "text-down"}`}>
                      {receipt.realizedPnlUsd === undefined ? "-" : signedUsd(receipt.realizedPnlUsd)}
                    </td>
                    <td className="px-3 text-dim">{receipt.routeLabel}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-faint">
                    No fills yet{scope === "MARKET" ? ` on ${market.id}` : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabBody>
      ) : null}

      {tab === "RFQS" ? (
        <TabBody idBase="maker-blotter" className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-xs whitespace-nowrap">
            <caption className="sr-only">Private requests visible to this account</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Request</th>
                <th scope="col" className={TH}>Side</th>
                <th scope="col" className={TH_NUM}>Lots</th>
                <th scope="col" className={TH}>State</th>
                <th scope="col" className={`${TH_NUM} w-[150px]`}>Request expiry</th>
                <th scope="col" className={TH_NUM}>Maker quote</th>
                <th scope="col" className={TH_NUM}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {requests.length > 0 ? (
                requests.map((request) => {
                  const intent = request.authorization.intent;
                  const expiresAt = Date.parse(request.expiresAt) / 1000;
                  const secondsLeft = Math.max(0, Math.ceil(expiresAt - now));
                  const totalSeconds = Math.max(1, expiresAt - Date.parse(request.createdAt) / 1000);
                  const requestOpen = request.state === "OPEN" && secondsLeft > 0;
                  const owned = makerQuote(request);
                  const ownedLeft = owned ? Math.max(0, Math.ceil(Date.parse(owned.expiresAt) / 1000 - now)) : 0;
                  const blockReason = makerBlock ?? (!requestOpen ? (request.state !== "OPEN" ? `Request ${request.state.toLowerCase()}` : "Request expired") : null);
                  const isActive = activeId === request.id;
                  return (
                    <Fragment key={request.id}>
                      <tr className={`transition-colors duration-150 ${isActive ? "bg-raised/60" : "hover:bg-raised/50"}`}>
                        <td className="h-11 px-3">
                          <span className="tnum block font-mono text-[12px] text-ink">{`${request.id.slice(0, 10)}…`}</span>
                          <span className="mt-0.5 block text-[11px] text-faint">{intent.marketId}</span>
                        </td>
                        <td className="px-3 text-dim">{`${intent.side === "ENTER" ? "Enter" : "Exit"} ${intent.packageSide === "SHORT" ? "short" : "long"}`}</td>
                        <td className="tnum px-3 text-right font-mono text-dim">{intent.lots}</td>
                        <td className="px-3">
                          <span className={`font-mono text-[11px] ${requestOpen ? "text-up" : "text-dim"}`}>
                            {request.state === "OPEN" && !requestOpen ? "EXPIRED" : request.state}
                          </span>
                        </td>
                        <td className="px-3 text-right">
                          <span className={`tnum font-mono ${requestOpen && secondsLeft <= 10 ? "text-down" : "text-dim"}`}>
                            {request.state === "EXECUTED" ? "Executed" : request.state === "CANCELLED" ? "Cancelled" : requestOpen ? `${secondsLeft}s` : "Expired"}
                          </span>
                          {requestOpen ? (
                            <span aria-hidden="true" className="mt-1 ml-auto block h-[2px] w-24 rounded-full bg-line">
                              <span
                                className={`ml-auto block h-full rounded-full transition-[width] duration-1000 ease-linear ${secondsLeft <= 10 ? "bg-down" : "bg-brand"}`}
                                style={{ width: `${Math.min(100, (secondsLeft / totalSeconds) * 100)}%` }}
                              />
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 text-right">
                          {owned ? (
                            <span>
                              <span className="tnum font-mono text-ink">{owned.packagePrice}</span>
                              <span className="tnum ml-2 font-mono text-[11px] text-dim">{owned.capacityLots} lots</span>
                              <span className="mt-0.5 block font-mono text-[10px] text-off">{`${owned.feeCap} cap / ${ownedLeft > 0 ? `${ownedLeft}s` : "expired"}`}</span>
                            </span>
                          ) : (
                            <span className="font-mono text-faint">{request.quotes.length > 0 ? `${request.quotes.length} quotes` : "-"}</span>
                          )}
                        </td>
                        <td className="px-3">
                          <span className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={blockReason !== null || busy}
                              title={blockReason ?? (owned ? "Replace the maker quote" : "Quote this request")}
                              onClick={() => openTicket(request)}
                              className={`${BUTTON} ${owned ? "text-ink" : "border-brand-edge/50 text-brand hover:border-brand-edge hover:bg-brand-soft"}`}
                            >
                              {owned ? "Reprice" : "Quote"}
                            </button>
                            {owned ? (
                              <button type="button" disabled={!requestOpen || busy} onClick={() => withdraw(request)} className={`${BUTTON} text-dim hover:text-down`}>
                                Withdraw
                              </button>
                            ) : null}
                          </span>
                          {blockReason ? <span className="mt-1 block text-right text-[10px] text-off">{blockReason}</span> : null}
                        </td>
                      </tr>
                      {isActive && requestOpen ? (
                        <tr className="bg-inset">
                          <td colSpan={7} className="px-3 py-2.5">
                            <div className={`${deskMotion.slideDown} grid gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end`}>
                              {[
                                ["Price", priceInput, setPriceInput, "decimal"],
                                ["Capacity lots", capacityInput, setCapacityInput, "numeric"],
                                ["Fee cap", feeCapInput, setFeeCapInput, "decimal"],
                                ["TTL seconds, 5 to 45", ttlInput, setTtlInput, "numeric"],
                              ].map(([label, value, setter, mode]) => (
                                <label key={label as string} className="grid gap-1">
                                  <span className="text-[11px] text-faint">{label as string}</span>
                                  <input
                                    value={value as string}
                                    onChange={(event) => (setter as (next: string) => void)(event.target.value)}
                                    inputMode={mode as "decimal" | "numeric"}
                                    className={INPUT}
                                    aria-label={label as string}
                                  />
                                </label>
                              ))}
                              <span className="flex items-center justify-end gap-1.5 sm:col-span-2 xl:col-span-1">
                                <button type="button" onClick={() => setActiveId(null)} disabled={busy} className={`${BUTTON} h-8 text-dim hover:text-ink`}>
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => submitTicket(request)}
                                  disabled={busy || blockReason !== null}
                                  className="focus-ring inline-flex h-8 cursor-pointer items-center rounded-md bg-brand px-3 text-[11px] font-semibold text-app transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  {busy ? "Working" : owned ? "Replace quote" : "Submit quote"}
                                </button>
                              </span>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-faint">
                    No private requests{scope === "MARKET" ? ` on ${market.id}` : ""} visible to this account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-faint">
            Private requests are visible to their taker and the eligible maker set. Quotes on them are signed by the
            network&apos;s designated maker{makerSigner === false ? ", which this network does not configure" : ""}.
          </p>
        </TabBody>
      ) : null}
    </Panel>
  );
}
