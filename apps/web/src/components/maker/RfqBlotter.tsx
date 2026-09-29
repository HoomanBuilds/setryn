"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  useGatewaySnapshot,
  useInternalGateway,
} from "@/components/gateway/InternalGatewayProvider";
import {
  Chip,
  DeskTabs,
  Panel,
  PanelHead,
  TabBody,
  TH,
  TH_NUM,
  deskMotion,
} from "@/components/strategies/desk/Desk";
import { makerCockpitSnapshot } from "@/lib/maker/fixtures";
import type {
  FirmRfqQuote,
  RfqRequest as GatewayRfqRequest,
} from "@/lib/internal-gateway/types";

function makerQuoteError(error: unknown): string {
  if (!(error instanceof Error)) return "Local quote failed.";
  if (error.message === "INVALID_PACKAGE_PRICE") return "Package price must be positive.";
  if (error.message === "INVALID_FEE_CAP") return "Fee cap must be zero or more.";
  if (error.message === "INVALID_CAPACITY") return "Capacity must be positive.";
  if (error.message === "INVALID_TTL") return "TTL must be 5 to 45 seconds.";
  if (error.message === "RFQ_NOT_FOUND") return "Request not found.";
  if (error.message === "RFQ_NOT_OPEN") return "Request is not open.";
  if (error.message === "RFQ_EXPIRED") return "Request expired.";
  if (error.message === "RFQ_QUOTE_NOT_FOUND") return "Local quote not found.";
  return "Local quote failed.";
}

function localMakerQuote(request: GatewayRfqRequest): FirmRfqQuote | null {
  return [...request.quotes].reverse().find((quote) => quote.provenance === "DEVNET_MAKER") ?? null;
}

const INPUT =
  "focus-ring tnum h-8 w-full rounded-md border border-line bg-panel px-2 font-mono text-xs text-ink transition-colors hover:border-line-strong";
const BUTTON =
  "focus-ring inline-flex h-7 cursor-pointer items-center rounded-md border border-line px-2 text-[11px] font-medium transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45";

export function RfqBlotter({
  selectedSeries,
  sessionPaused,
  riskPaused,
  scopeStopReason,
  defaultTtl,
  onNotice,
}: {
  selectedSeries: string;
  sessionPaused: boolean;
  riskPaused: boolean;
  /** Set when a staged scoped stop covers this series. */
  scopeStopReason: string | null;
  defaultTtl: number;
  onNotice: (message: string) => void;
}) {
  const requests = makerCockpitSnapshot.rfqs.filter((rfq) => rfq.seriesId === selectedSeries);
  const series = makerCockpitSnapshot.series.find((item) => item.id === selectedSeries);
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const [tab, setTab] = useState("RELAY");
  const [now, setNow] = useState(() => Date.now());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [capacityInput, setCapacityInput] = useState("");
  const [feeCapInput, setFeeCapInput] = useState("");
  const [ttlInput, setTtlInput] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const localRequests = useMemo(
    () =>
      [...snapshot.rfqRequests]
        .filter((request) => request.authorization.intent.marketId.toLowerCase() === selectedSeries.toLowerCase())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [snapshot.rfqRequests, selectedSeries],
  );
  const runtimeOrigin = snapshot.environment.label;
  const openLocal = localRequests.filter(
    (request) => request.state === "OPEN" && Date.parse(request.expiresAt) > now,
  ).length;

  const openTicket = (request: GatewayRfqRequest) => {
    const intent = request.authorization.intent;
    const existing = localMakerQuote(request);
    setPriceInput(String(existing ? existing.packagePrice : intent.limitPrice));
    setCapacityInput(String(existing ? existing.capacityLots : intent.lots));
    setFeeCapInput(String(existing ? existing.feeCap : intent.feeCap));
    const clampedTtl = Math.min(45, Math.max(5, Math.round(defaultTtl)));
    setTtlInput(String(clampedTtl));
    setActiveId(request.id);
  };

  const closeTicket = () => {
    if (working) return;
    setActiveId(null);
  };

  const submitTicket = async (request: GatewayRfqRequest) => {
    const existing = localMakerQuote(request);
    const isReprice = existing !== null;
    const packagePrice = Number(priceInput);
    const capacityLots = Number(capacityInput);
    const feeCap = Number(feeCapInput);
    const ttlSeconds = Number(ttlInput);
    if (working) return;
    setWorking(true);
    try {
      const updated = await gateway.submitLocalMakerQuote(request.id, {
        packagePrice,
        capacityLots,
        feeCap,
        ttlSeconds,
      });
      const posted = localMakerQuote(updated);
      setActiveId(null);
      onNotice(
        isReprice
          ? `Local quote repriced for ${request.id} at ${posted ? posted.packagePrice : packagePrice}.`
          : `Local quote posted for ${request.id} at ${posted ? posted.packagePrice : packagePrice}.`,
      );
    } catch (error) {
      onNotice(makerQuoteError(error));
    } finally {
      setWorking(false);
    }
  };

  const withdrawQuote = async (request: GatewayRfqRequest) => {
    if (working) return;
    setWorking(true);
    try {
      await gateway.withdrawLocalMakerQuote(request.id);
      if (activeId === request.id) setActiveId(null);
      onNotice(`Local quote withdrawn for ${request.id}.`);
    } catch (error) {
      onNotice(makerQuoteError(error));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Panel label="RFQ blotter" delay={100}>
      <PanelHead
        tabs={
          <DeskTabs
            idBase="maker-rfq"
            value={tab}
            onChange={setTab}
            items={[
              { id: "RELAY", label: "Active RFQs", badge: requests.length, badgeTone: "brand" },
              { id: "LOCAL", label: "Local user RFQs", badge: localRequests.length, badgeTone: openLocal > 0 ? "up" : "neutral" },
            ]}
          />
        }
        tools={
          tab === "RELAY" ? (
            <Chip>Simulated relay</Chip>
          ) : (
            <Chip tone="dim" title="Requests from this browser's internal gateway runtime">
              {runtimeOrigin}
            </Chip>
          )
        }
      />

      {tab === "RELAY" ? (
        <TabBody idBase="maker-rfq" className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs whitespace-nowrap">
            <caption className="sr-only">Active simulated RFQ queue</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Request</th>
                <th scope="col" className={TH}>Side</th>
                <th scope="col" className={TH_NUM}>Size</th>
                <th scope="col" className={TH}>Eligibility</th>
                <th scope="col" className={TH_NUM}>TTL at snapshot</th>
                <th scope="col" className={TH_NUM}>Hedge cost</th>
                <th scope="col" className={TH_NUM}>Modeled edge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {requests.length > 0 ? (
                requests.map((rfq) => (
                  <tr key={rfq.id} className="transition-colors duration-150 hover:bg-raised/50">
                    <td className="h-11 px-3">
                      <div className="flex items-center gap-2">
                        <span className="tnum font-mono text-[13px] text-ink">{rfq.id.toUpperCase()}</span>
                        <Chip>Simulated</Chip>
                      </div>
                      <span className="mt-0.5 block text-[11px] text-faint">{`${rfq.counterpartyScope} / ${rfq.requestedAt} UTC`}</span>
                    </td>
                    <td className="px-3">
                      <span
                        className={`inline-flex h-5 items-center rounded-[4px] px-1.5 font-mono text-[10px] ${
                          rfq.side === "BUY" ? "bg-up-soft text-up" : "bg-down-soft text-down"
                        }`}
                      >
                        {rfq.side}
                      </span>
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">{rfq.sizeLabel}</td>
                    <td className="px-3">
                      <span
                        className={`text-[11px] ${
                          rfq.eligibility === "ELIGIBLE" ? "text-up" : rfq.eligibility === "CAPACITY_LIMITED" ? "text-brand" : "text-down"
                        }`}
                      >
                        {rfq.eligibility.replace("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td className="tnum px-3 text-right font-mono text-brand">{`${rfq.expiresInSeconds}s`}</td>
                    <td className="tnum px-3 text-right font-mono text-dim">{`${rfq.modeledHedgeCostBps.toFixed(1)} bp`}</td>
                    <td className="tnum px-3 text-right font-mono text-up">{`+${rfq.modeledEdgeBps.toFixed(1)} bp`}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-faint">
                    No active simulated RFQs for {series?.displayName}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabBody>
      ) : (
        <TabBody idBase="maker-rfq" className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-xs whitespace-nowrap">
            <caption className="sr-only">Local user private RFQ records for the selected series</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Request</th>
                <th scope="col" className={TH}>Side</th>
                <th scope="col" className={TH_NUM}>Lots</th>
                <th scope="col" className={TH}>State</th>
                <th scope="col" className={`${TH_NUM} w-[150px]`}>Request expiry</th>
                <th scope="col" className={TH_NUM}>Local quote</th>
                <th scope="col" className={TH_NUM}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {localRequests.length > 0 ? (
                localRequests.map((request) => {
                  const intent = request.authorization.intent;
                  const sideLabel = `${intent.side === "ENTER" ? "Enter" : "Exit"} ${intent.packageSide === "SHORT" ? "Short" : "Long"}`;
                  const isTerminal = request.state === "EXECUTED" || request.state === "CANCELLED";
                  const requestExpired = Date.parse(request.expiresAt) <= now;
                  const requestOpen = request.state === "OPEN" && !requestExpired;
                  const secondsLeft = Math.max(0, Math.ceil((Date.parse(request.expiresAt) - now) / 1000));
                  const totalSeconds = Math.max(1, (Date.parse(request.expiresAt) - Date.parse(request.createdAt)) / 1000);
                  const expiryLabel = isTerminal
                    ? request.state === "EXECUTED"
                      ? request.receiptId
                        ? `Executed ${request.receiptId}`
                        : "Executed"
                      : "Cancelled"
                    : requestExpired
                      ? "Expired"
                      : `${secondsLeft}s`;
                  const owned = localMakerQuote(request);
                  const ownedExpired = owned ? Date.parse(owned.expiresAt) <= now : false;
                  const ownedLeft = owned ? Math.max(0, Math.ceil((Date.parse(owned.expiresAt) - now) / 1000)) : 0;
                  const blockReason = sessionPaused
                    ? "Session paused"
                    : riskPaused
                      ? "Risk paused"
                      : scopeStopReason
                        ? scopeStopReason
                        : !requestOpen
                          ? request.state !== "OPEN"
                            ? `Request ${request.state.toLowerCase()}`
                            : "Request expired"
                          : null;
                  const quoteDisabled = blockReason !== null || working;
                  const isActive = activeId === request.id;
                  return (
                    <Fragment key={request.id}>
                      <tr className={`transition-colors duration-150 ${isActive ? "bg-raised/60" : "hover:bg-raised/50"}`}>
                        <td className="h-11 px-3">
                          <div className="flex items-center gap-2">
                            <span className="tnum font-mono text-[13px] text-ink">{request.id}</span>
                            <Chip tone="dim">{runtimeOrigin}</Chip>
                          </div>
                          <span className="mt-0.5 block text-[11px] text-faint">{intent.packageCode}</span>
                        </td>
                        <td className="px-3 text-dim">{sideLabel}</td>
                        <td className="tnum px-3 text-right font-mono text-dim">{intent.lots}</td>
                        <td className="px-3">
                          <span className={`font-mono text-[11px] ${requestOpen ? "text-up" : "text-dim"}`}>
                            {requestExpired && request.state === "OPEN" ? "OPEN" : request.state}
                          </span>
                        </td>
                        <td className="px-3 text-right">
                          <span className={`tnum font-mono ${requestOpen && secondsLeft <= 10 ? "text-down" : "text-dim"}`}>
                            {expiryLabel}
                          </span>
                          {requestOpen ? (
                            <span aria-hidden="true" className="mt-1 ml-auto block h-[2px] w-24 rounded-full bg-line">
                              <span
                                className={`ml-auto block h-full rounded-full transition-[width] duration-1000 ease-linear ${
                                  secondsLeft <= 10 ? "bg-down" : "bg-brand"
                                }`}
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
                              <span className="mt-0.5 block font-mono text-[10px] text-off">
                                {owned.feeCap} cap / {ownedExpired ? "Expired" : `${ownedLeft}s`} / DEVNET
                              </span>
                            </span>
                          ) : (
                            <span className="font-mono text-faint">-</span>
                          )}
                        </td>
                        <td className="px-3">
                          <span className="flex items-center justify-end gap-1.5">
                            {owned ? (
                              <>
                                <button
                                  type="button"
                                  disabled={quoteDisabled}
                                  title={blockReason ?? "Replace local quote"}
                                  onClick={() => openTicket(request)}
                                  className={`${BUTTON} text-ink`}
                                >
                                  Reprice
                                </button>
                                <button
                                  type="button"
                                  disabled={!requestOpen || working}
                                  title={!requestOpen ? "Request not open" : "Withdraw local quote"}
                                  onClick={() => withdrawQuote(request)}
                                  className={`${BUTTON} text-dim hover:text-down`}
                                >
                                  Withdraw
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={quoteDisabled}
                                title={blockReason ?? "Quote this request"}
                                onClick={() => openTicket(request)}
                                className={`${BUTTON} border-brand-edge/50 text-brand hover:border-brand-edge hover:bg-brand-soft`}
                              >
                                Quote
                              </button>
                            )}
                          </span>
                          {blockReason ? <span className="mt-1 block text-right text-[10px] text-off">{blockReason}</span> : null}
                        </td>
                      </tr>
                      {isActive && requestOpen ? (
                        <tr className="bg-inset">
                          <td colSpan={7} className="px-3 py-2.5">
                            <div className={`${deskMotion.slideDown} grid gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end`}>
                              <label className="grid gap-1">
                                <span className="text-[11px] text-faint">Package price</span>
                                <input
                                  value={priceInput}
                                  onChange={(event) => setPriceInput(event.target.value)}
                                  inputMode="decimal"
                                  className={INPUT}
                                  aria-label="Package price"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-[11px] text-faint">Capacity lots</span>
                                <input
                                  value={capacityInput}
                                  onChange={(event) => setCapacityInput(event.target.value)}
                                  inputMode="decimal"
                                  className={INPUT}
                                  aria-label="Capacity lots"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-[11px] text-faint">Fee cap</span>
                                <input
                                  value={feeCapInput}
                                  onChange={(event) => setFeeCapInput(event.target.value)}
                                  inputMode="decimal"
                                  className={INPUT}
                                  aria-label="Fee cap"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-[11px] text-faint">TTL seconds, 5 to 45</span>
                                <input
                                  value={ttlInput}
                                  onChange={(event) => setTtlInput(event.target.value)}
                                  inputMode="numeric"
                                  className={INPUT}
                                  aria-label="TTL seconds"
                                />
                              </label>
                              <span className="flex items-center justify-end gap-1.5 sm:col-span-2 xl:col-span-1">
                                <button type="button" onClick={closeTicket} disabled={working} className={`${BUTTON} h-8 text-dim hover:text-ink`}>
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => submitTicket(request)}
                                  disabled={working || blockReason !== null}
                                  title={blockReason ?? (owned ? "Replace local quote" : "Submit local quote")}
                                  className="focus-ring inline-flex h-8 cursor-pointer items-center rounded-md bg-brand px-3 text-[11px] font-semibold text-app transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  {working ? "Working" : owned ? "Replace quote" : "Submit quote"}
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
                    No local user RFQs for {series?.displayName} in {runtimeOrigin}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabBody>
      )}
    </Panel>
  );
}
