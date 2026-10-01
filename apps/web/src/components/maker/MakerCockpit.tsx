"use client";

import { useMemo, useState } from "react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Chip, Flash, LiveDot, Meter, Metric, deskMotion } from "@/components/strategies/desk/Desk";
import { BUTTON_INK } from "@/components/activity/ledger-ui";
import { inventoryByMarket, makerError, onTick, quoteFeeCap, workingQuotes } from "@/lib/maker/model";
import type { MakerMarket, WorkingQuote } from "@/lib/maker/types";
import { networkLabel, runtimeMarket } from "@/lib/operations/deployment";
import { useDeploymentRuntime, useOperatorStatus } from "@/lib/operations/hooks";
import { expiryAt, liveQuote, rangeTerms } from "@/lib/strategies/range";
import { formatExpiry, formatLots, formatNumber } from "@/lib/terminal/format";
import { signedUsd, usd } from "./format";
import { CapitalPlane, DeskHealth, Inventory, MarketTerms, QuoteComposer, QuoteStops } from "./MakerPanels";
import { QuoteLadder } from "./QuoteLadder";
import { RfqBlotter } from "./RfqBlotter";

function shortAddress(address: string | null): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "No wallet";
}

function SeriesTabs({
  markets,
  selected,
  onSelect,
}: {
  markets: MakerMarket[];
  selected: string;
  onSelect: (marketId: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Listed markets" className="no-scrollbar flex overflow-x-auto border-t border-line">
      {markets.map((entry) => {
        const { market, quote } = entry;
        const active = market.id === selected;
        const tone = quote.seriesStatus === "ACTIVE" ? "up" : quote.seriesStatus === "PAUSED" ? "brand" : quote.seriesStatus === "UNKNOWN" ? "dim" : "down";
        const ownLots = entry.bidLots + entry.askLots;
        const limit = market.maxOrderLots ?? 0;
        return (
          <button
            key={market.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(market.id)}
            className={`focus-ring relative flex min-w-[224px] shrink-0 flex-col gap-1 border-r border-line px-3 py-2 text-left transition-colors duration-150 ${
              active ? "bg-raised/70" : "hover:bg-raised/40"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <LiveDot tone={tone} live={quote.seriesStatus === "ACTIVE"} />
                <MarketMark underlying={market.underlying} code={market.id} size={15} />
                <span className={`truncate text-[13px] font-medium ${active ? "text-ink" : "text-dim"}`}>{market.id}</span>
              </span>
              <span className="tnum font-mono text-xs text-ink">
                {quote.mark !== null ? (
                  <Flash value={quote.mark}>{formatNumber(quote.mark, market.priceDecimals)}</Flash>
                ) : (
                  <span className="text-faint">No mark</span>
                )}
              </span>
            </span>
            <span className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-faint">{market.strategyLabel}</span>
              <span className="tnum shrink-0 font-mono text-faint">{formatExpiry(market.expiryIso)}</span>
            </span>
            <span className="flex items-center gap-2 text-[10px]">
              <span className="text-faint">Your quotes</span>
              <Meter
                value={limit > 0 ? Math.min(1, ownLots / (2 * limit)) : ownLots > 0 ? 1 : 0}
                tone={ownLots > 0 ? "up" : "dim"}
                label={`${market.id} working quote lots`}
                height="h-[3px]"
                className="flex-1"
              />
              <span className="tnum font-mono text-dim">{`${formatLots(entry.bidLots)} / ${formatLots(entry.askLots)}`}</span>
            </span>
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 bottom-0 h-0.5 origin-center rounded-full bg-brand transition-transform duration-200 ease-out ${
                active ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

export function MakerCockpit() {
  const board = useMarketBoard();
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const runtime = useDeploymentRuntime();
  const operator = useOperatorStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Quotes are signed by your wallet and rest on the public book.");
  const [working, setWorking] = useState(false);

  const connected = snapshot.wallet.status === "CONNECTED";
  const inventory = useMemo(() => inventoryByMarket(snapshot), [snapshot]);
  const markets = useMemo<MakerMarket[]>(
    () =>
      board.markets.map((market) => {
        const quotes = workingQuotes(snapshot, market.id);
        return {
          market,
          quote: liveQuote(board.snapshot, market),
          terms: rangeTerms(market, runtimeMarket(runtime.data, market.id)),
          working: quotes,
          bidLots: quotes.filter((quote) => quote.action === "BUY").reduce((total, quote) => total + quote.order.remainingLots, 0),
          askLots: quotes.filter((quote) => quote.action === "SELL").reduce((total, quote) => total + quote.order.remainingLots, 0),
          inventory: inventory.get(market.id) ?? null,
          fills: snapshot.receipts.filter((receipt) => receipt.marketId === market.id),
        };
      }),
    [board.markets, board.snapshot, inventory, runtime.data, snapshot],
  );

  const selected = markets.find((entry) => entry.market.id === selectedId) ?? markets[0] ?? null;
  const allQuotes = useMemo(() => workingQuotes(snapshot), [snapshot]);
  const onchain = selected ? (snapshot.onchainMarkets[selected.market.id] ?? null) : null;
  const book = selected ? (board.snapshot?.markets.find((entry) => entry.marketKey === selected.market.id)?.book ?? []) : [];
  const bookLots = book.reduce((total, row) => total + (Number.isFinite(row.lots) ? row.lots : 0), 0);
  const ownBookLots = selected ? selected.bidLots + selected.askLots : 0;
  const reservedByQuotes = allQuotes.reduce((total, quote) => total + (quote.order.remainingCollateralReservation || 0), 0);
  const feesPaid = snapshot.receipts.reduce((total, receipt) => total + (Number.isFinite(receipt.fees) ? receipt.fees : 0), 0);
  const realized = snapshot.receipts.reduce((total, receipt) => total + (receipt.realizedPnlUsd ?? 0), 0);
  const network = networkLabel(runtime.data?.chainId ?? board.snapshot?.chainId ?? null, runtime.data?.network ?? board.snapshot?.network ?? null);
  const expiry = selected ? expiryAt(selected.market, runtimeMarket(runtime.data, selected.market.id)) : null;

  const connect = () => {
    gateway.connectWallet().catch((error: unknown) => setNotice(makerError(error, "Wallet connection was not completed.")));
  };

  const postQuote = async (action: "BUY" | "SELL", price: number, lots: number) => {
    if (!selected) return;
    const market = selected.market;
    const current = gateway.getSnapshot();
    const fees = current.onchainMarkets[market.id] ?? null;
    const authorization = await gateway.authorizeOrder({
      accountId: current.account.id,
      marketId: market.id,
      packageCode: market.id,
      routeId: "DIRECT_BOOK",
      routeLabel: "Direct package book",
      side: "ENTER",
      packageSide: action === "BUY" ? "LONG" : "SHORT",
      lots,
      fillLots: lots,
      limitPrice: price,
      executionPrice: price,
      contractMultiplier: fees?.considerationPerPriceUnit ?? market.contractMultiplier,
      orderType: "LIMIT",
      timeInForce: "GTC",
      expiresAt: null,
      feeCap: quoteFeeCap(lots, price, fees?.considerationPerPriceUnit ?? market.contractMultiplier, fees),
      collateralRequired:
        selected.terms !== null
          ? lots *
            (action === "BUY"
              ? selected.terms.lotSize * Math.max(0, price - selected.terms.floor)
              : selected.terms.lotSize * Math.max(0, selected.terms.cap - price))
          : lots * (action === "BUY" ? (fees?.longCollateralPerLot ?? 0) : (fees?.shortCollateralPerLot ?? 0)),
      closePositionId: null,
      replacesOrderId: null,
      recipient: current.wallet.address ?? "",
      disclosure: "PUBLIC",
      settlementGuarantee: "Package atomic",
      postOnly: true,
    });
    await gateway.placeRestingOrder(authorization);
  };

  const submitQuotes = async (draft: { bid: number | null; ask: number | null; lots: number }) => {
    if (!selected || working) return;
    if (!connected) {
      connect();
      return;
    }
    setWorking(true);
    const market = selected.market;
    const posted: string[] = [];
    try {
      if (draft.bid !== null) {
        await postQuote("BUY", onTick(draft.bid, market), draft.lots);
        posted.push(`bid ${formatNumber(onTick(draft.bid, market), market.priceDecimals)}`);
      }
      if (draft.ask !== null) {
        await postQuote("SELL", onTick(draft.ask, market), draft.lots);
        posted.push(`ask ${formatNumber(onTick(draft.ask, market), market.priceDecimals)}`);
      }
      setNotice(`Posted ${posted.join(" and ")} for ${draft.lots} ${draft.lots === 1 ? "lot" : "lots"} on ${market.id}.`);
    } catch (error) {
      const prefix = posted.length > 0 ? `Posted ${posted.join(" and ")}; the other side failed: ` : "";
      setNotice(`${prefix}${makerError(error, "The quote was not posted.")}`);
    } finally {
      setWorking(false);
    }
  };

  const cancelQuotes = async (quotes: readonly WorkingQuote[], scope: string) => {
    if (working || quotes.length === 0) return;
    setWorking(true);
    let cancelled = 0;
    try {
      for (const quote of quotes) {
        await gateway.cancelRestingOrder(quote.order.id);
        cancelled += 1;
      }
      setNotice(`Cancelled ${cancelled} ${cancelled === 1 ? "quote" : "quotes"} (${scope}).`);
    } catch (error) {
      setNotice(`Cancelled ${cancelled} of ${quotes.length} (${scope}). ${makerError(error, "A cancellation failed.")}`);
    } finally {
      setWorking(false);
    }
  };

  const feedTone = board.status === "LIVE" ? "up" : board.status === "LOADING" ? "dim" : "down";

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1" aria-label="Setryn maker desk">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Maker desk</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">{`Public book quoting / ${network}`}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={feedTone === "up" ? "up" : feedTone === "down" ? "down" : "dim"} dot>
              {board.status === "LIVE" ? "Feed live" : board.status === "LOADING" ? "Feed loading" : board.status === "STALE" ? "Feed stale" : "Feed unavailable"}
            </Chip>
            {selected && selected.quote.seriesStatus !== "ACTIVE" && selected.quote.seriesStatus !== "UNKNOWN" ? (
              <Chip tone="down" dot>{`${selected.market.id} ${selected.quote.seriesStatus.toLowerCase()}`}</Chip>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lg:ml-auto">
            <span className="tnum font-mono text-[11px] text-dim">
              <span className="font-sans text-faint">Account </span>
              {shortAddress(snapshot.wallet.address)}
            </span>
            {connected ? null : (
              <button type="button" onClick={connect} disabled={snapshot.wallet.status === "CONNECTING"} className={`${BUTTON_INK} h-7`}>
                {snapshot.wallet.status === "CONNECTING" ? "Connecting..." : snapshot.wallet.status === "WRONG_NETWORK" ? "Switch network" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>
        {markets.length > 0 && selected ? (
          <SeriesTabs markets={markets} selected={selected.market.id} onSelect={setSelectedId} />
        ) : (
          <p className="border-t border-line px-3 py-3 text-xs text-faint">No markets are listed on this network yet.</p>
        )}
      </header>

      {selected ? (
        <>
          <section
            aria-label="Desk metrics"
            className={`${deskMotion.rise} grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 xl:grid-cols-7`}
            style={{ ["--rise-delay" as string]: "30ms" }}
          >
            <Metric
              className="bg-panel"
              label="Working quotes"
              value={allQuotes.length}
              note={`${formatLots(allQuotes.reduce((total, quote) => total + quote.order.remainingLots, 0))} lots across ${new Set(allQuotes.map((quote) => quote.order.marketId)).size} markets`}
            />
            <Metric
              className="bg-panel"
              label="Quote reservations"
              value={usd(reservedByQuotes)}
              note="Collateral bound by working quotes"
            />
            <Metric
              className="bg-panel"
              label="Available collateral"
              value={connected ? usd(snapshot.account.available) : "-"}
              tone={connected ? "up" : "dim"}
              note={connected ? `${usd(snapshot.account.posted)} posted` : "Connect a wallet"}
            />
            <Metric
              className="bg-panel"
              label="Book share"
              value={bookLots > 0 ? `${Math.round((ownBookLots / bookLots) * 100)}%` : "-"}
              note={bookLots > 0 ? `${formatLots(ownBookLots)} of ${formatLots(bookLots)} lots resting` : "Book is empty"}
            >
              {bookLots > 0 ? <Meter value={ownBookLots / bookLots} tone="up" label="Your share of resting lots" /> : null}
            </Metric>
            <Metric
              className="bg-panel"
              label="Net inventory"
              value={selected.inventory ? `${selected.inventory.netLots > 0 ? "+" : ""}${formatLots(selected.inventory.netLots)} lots` : "Flat"}
              tone={selected.inventory && selected.inventory.netLots !== 0 ? (selected.inventory.netLots > 0 ? "up" : "down") : "dim"}
              note={selected.market.id}
            />
            <Metric className="bg-panel" label="Fills" value={snapshot.receipts.length} note={`${selected.fills.length} on ${selected.market.id}`} />
            <Metric
              className="bg-panel"
              label="Fees / realized"
              value={
                <>
                  {usd(feesPaid)}
                  <span className="text-faint"> / </span>
                  <span className={realized >= 0 ? "text-up" : "text-down"}>{signedUsd(realized)}</span>
                </>
              }
              note="From your fill receipts"
            />
          </section>

          <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_344px]">
            <div className="flex min-w-0 flex-col gap-1">
              <QuoteLadder entry={selected} book={book} />
              <RfqBlotter
                entry={selected}
                quotes={allQuotes}
                makerSigner={operator.data?.maker.available ?? null}
                working={working}
                onCancel={(quote) => cancelQuotes([quote], quote.order.marketId)}
                onNotice={setNotice}
              />
              <div className="grid min-w-0 gap-1 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <Inventory markets={markets} selected={selected.market.id} onSelect={setSelectedId} />
                <CapitalPlane account={connected ? snapshot.account : null} quoteReservations={reservedByQuotes} />
              </div>
              <DeskHealth
                feedStatus={board.status}
                feedAsOf={board.asOf}
                walletStatus={snapshot.wallet.status}
                operator={operator}
                chainOffsetMs={snapshot.chainClockOffsetMs}
              />
            </div>

            <aside className="flex min-w-0 flex-col gap-1">
              <QuoteComposer
                key={selected.market.id}
                entry={selected}
                fees={onchain}
                connected={connected}
                working={working}
                onSubmit={submitQuotes}
              />
              <MarketTerms entry={selected} fees={onchain} expiryAt={expiry} />
              <QuoteStops
                markets={markets}
                quotes={allQuotes}
                working={working}
                onCancel={cancelQuotes}
              />
            </aside>
          </div>
        </>
      ) : null}

      <div className="sticky bottom-0 z-10 flex min-h-9 shrink-0 items-center justify-between gap-3 rounded-lg border border-line bg-inset/95 px-3 py-2 backdrop-blur">
        <p aria-live="polite" className="flex min-w-0 items-center gap-2 text-xs text-dim">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${working ? "bg-brand" : "bg-up"}`} />
          <span key={notice} className={`${deskMotion.fade} truncate`}>
            {working ? "Waiting for the wallet and the chain..." : notice}
          </span>
        </p>
        <span className="hidden shrink-0 font-mono text-[10px] text-off sm:inline">
          {board.asOf > 0 ? `Feed block ${board.snapshot?.blockNumber ?? "-"}` : "Feed not read yet"}
        </span>
      </div>
    </main>
  );
}
