"use client";

import { Chip, Panel, PanelHead, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import { ladder, ownLevels } from "@/lib/maker/model";
import type { MakerMarket } from "@/lib/maker/types";
import { MARK_SOURCE_LABEL } from "@/lib/strategies/range";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import type { BookRow } from "@/lib/terminal/types";

const MAX_LEVELS = 24;

/**
 * The selected market's public book at the feed's block, by price, with the wallet's own working lots at each level.
 * An empty book reads as empty; nothing is filled in.
 */
export function QuoteLadder({ entry, book }: { entry: MakerMarket; book: readonly BookRow[] }) {
  const { market, quote } = entry;
  const levels = ladder(book, ownLevels(entry.working)).slice(0, MAX_LEVELS);
  const maxLots = Math.max(1, ...levels.map((level) => Math.max(level.bidLots, level.askLots, level.ownBidLots, level.ownAskLots)));
  const decimals = market.priceDecimals;
  const spread = quote.bid !== null && quote.ask !== null ? quote.ask - quote.bid : null;
  const tick = market.tickSize > 0 ? market.tickSize : 10 ** -decimals;

  return (
    <Panel label="Book ladder" delay={60}>
      <PanelHead
        title="Book ladder"
        tools={
          <>
            <span className="hidden truncate text-[11px] text-faint md:inline">
              {quote.mark !== null
                ? `Mark ${formatNumber(quote.mark, decimals)} / ${MARK_SOURCE_LABEL[quote.markSource].toLowerCase()}`
                : "No mark yet"}
            </span>
            <Chip tone="up">Onchain book</Chip>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {[
          ["Best bid", quote.bid !== null ? formatNumber(quote.bid, decimals) : "-", "text-up"],
          ["Best offer", quote.ask !== null ? formatNumber(quote.ask, decimals) : "-", "text-down"],
          ["Spread", spread !== null ? `${formatNumber(spread, decimals)} / ${Math.round(spread / tick)} ticks` : "-", "text-ink"],
          [
            "Reference",
            quote.reference ? formatNumber(quote.reference.price, Math.max(decimals, 2)) : "-",
            "text-dim",
          ],
        ].map(([label, value, tone]) => (
          <div key={label} className="bg-panel px-3 py-2">
            <div className="text-[11px] text-faint">{label}</div>
            <div className={`tnum mt-0.5 font-mono text-[13px] ${tone}`}>{value}</div>
          </div>
        ))}
      </div>
      {levels.length === 0 ? (
        <p className="px-3 py-10 text-center text-xs text-faint">
          No resting orders on the {market.id} book yet. A post-only quote from the composer opens it.
        </p>
      ) : (
        <div role="region" tabIndex={0} aria-label="Book ladder" className="focus-ring scroll-thin max-h-[420px] overflow-auto">
          <table className="w-full min-w-[620px] border-collapse text-xs whitespace-nowrap">
            <caption className="sr-only">{`${market.id} public book by price with your working lots`}</caption>
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line">
                <th scope="col" className={TH_NUM}>Your bids</th>
                <th scope="col" className={`${TH_NUM} w-[160px]`}>Bid lots</th>
                <th scope="col" className={`${TH} text-center`}>Price</th>
                <th scope="col" className={`${TH} w-[160px]`}>Ask lots</th>
                <th scope="col" className={TH}>Your asks</th>
                <th scope="col" className={TH_NUM}>From mark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {levels.map((level) => {
                const distance = quote.mark !== null ? Math.round((level.price - quote.mark) / tick) : null;
                const atTouch = level.price === quote.bid || level.price === quote.ask;
                return (
                  <tr key={level.price} className={`${deskMotion.fade} transition-colors duration-150 hover:bg-raised/50 ${atTouch ? "bg-raised/40" : ""}`}>
                    <td className="tnum h-8 px-3 text-right font-mono text-up">{level.ownBidLots > 0 ? formatLots(level.ownBidLots) : ""}</td>
                    <td className="px-3">
                      {level.bidLots > 0 ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className="tnum font-mono text-dim">{formatLots(level.bidLots)}</span>
                          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden="true">
                            <span className="absolute inset-y-0 right-0 rounded-full bg-up/70" style={{ width: `${(level.bidLots / maxLots) * 100}%` }} />
                          </span>
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`tnum px-3 text-center font-mono text-[13px] ${
                        level.bidLots > 0 || level.ownBidLots > 0 ? "text-up" : level.askLots > 0 || level.ownAskLots > 0 ? "text-down" : "text-ink"
                      }`}
                    >
                      {formatNumber(level.price, decimals)}
                    </td>
                    <td className="px-3">
                      {level.askLots > 0 ? (
                        <span className="flex items-center gap-2">
                          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden="true">
                            <span className="absolute inset-y-0 left-0 rounded-full bg-down/70" style={{ width: `${(level.askLots / maxLots) * 100}%` }} />
                          </span>
                          <span className="tnum font-mono text-dim">{formatLots(level.askLots)}</span>
                        </span>
                      ) : null}
                    </td>
                    <td className="tnum px-3 font-mono text-down">{level.ownAskLots > 0 ? formatLots(level.ownAskLots) : ""}</td>
                    <td className="tnum px-3 text-right font-mono text-faint">
                      {distance === null ? "-" : `${distance > 0 ? "+" : ""}${distance}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[11px] text-faint">
        <span>{`${book.length} resting ${book.length === 1 ? "order" : "orders"} / tick ${formatNumber(tick, decimals)}`}</span>
        <span className="text-off">
          Your lots are your wallet&apos;s working orders at each price. Distance is in ticks from the mark.
        </span>
      </div>
    </Panel>
  );
}
