"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { AssetIcon, AssetLabel } from "@/components/icons/AssetIcon";
import { useChainNow } from "@/components/market-data/MarketDataProvider";
import { MarketSwitcher } from "@/components/terminal/MarketSwitcher";
import { FlashValue } from "@/components/terminal/motion";
import { Delta, QUALIFICATION_LABEL, SectionLabel } from "@/components/terminal/primitives";
import { formatAnalytic, strategyAnalytic } from "@/lib/market-data/analytics";
import {
  changePercent,
  daysToExpiry,
  formatCompactUsd,
  formatExpiry,
  formatLots,
  formatNumber,
  formatPrice,
  formatUtcStamp,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

const MARK_SOURCE_LABEL: Record<PackageMarket["markSource"], string> = {
  MID: "Mid",
  LAST: "Last",
  REFERENCE: "Reference",
  NONE: "No mark",
};

/** Where the mark comes from, in words, for the mark's tooltip. */
export function markSourceDetail(market: PackageMarket): string {
  const at = market.markAsOf > 0 ? ` at ${formatUtcStamp(market.markAsOf)} UTC` : "";
  if (market.markSource === "MID") return `Mid of the best bid and offer on the onchain book${at}.`;
  if (market.markSource === "LAST") return `Last onchain fill${at}; the book does not hold both sides.`;
  if (market.markSource === "REFERENCE") {
    return `No book or trades yet: the Chainlink ${market.referencePair} reference${at}, held inside the ${market.floor}–${market.cap} payoff range.`;
  }
  return "No book, trades, or reference reading is available.";
}

const SETTLEMENT_LABEL: Record<PackageMarket["settlementClass"], string> = {
  CASH_USDC: "Cash settled in USDC",
  CASH_USDC_NDF: "Non-deliverable, USDC",
};

function Stat({
  label,
  value,
  sub,
  tone = "default",
  title,
  asset,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "up" | "down";
  title?: string;
  /** Asset mark drawn before the value, for example the settlement asset. */
  asset?: string;
}) {
  const valueTone = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div className="flex shrink-0 flex-col justify-center" title={title}>
      <span className="text-xs whitespace-nowrap text-faint">{label}</span>
      <span className="tnum flex items-baseline font-mono text-[13px] whitespace-nowrap">
        {asset ? <AssetIcon symbol={asset} size={13} className="mr-1.5 self-center" /> : null}
        <span className={valueTone}>{value}</span>
        {sub ? <span className="ml-1.5 text-off">{sub}</span> : null}
      </span>
    </div>
  );
}

function SpecRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[6px]">
      <span className="shrink-0 text-xs text-faint">{label}</span>
      <span
        className={`min-w-0 text-right text-xs text-dim ${mono ? "tnum font-mono text-ink" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function statsFor(market: PackageMarket, nowSeconds: number) {
  const unit = priceUnitSuffix(market.priceUnit);
  const spread = market.bestAsk - market.bestBid;
  const analytic = strategyAnalytic(market, market.netPrice, market.referencePrice, nowSeconds);
  return [
    { label: "Best bid", value: formatPrice(market.bestBid, market), tone: "up" as const },
    { label: "Best offer", value: formatPrice(market.bestAsk, market), tone: "down" as const },
    {
      label: "Spread",
      value: Number.isFinite(spread) ? `${formatNumber(spread, market.priceDecimals)} ${unit}` : "—",
      title: "Best resting offer minus best resting bid on the onchain book.",
    },
    {
      label: "Firm depth",
      value: `${formatLots(market.firmDepthLots)} lots`,
      title: "Lots resting on the onchain book, both sides.",
    },
    {
      label: `${market.underlying} ref`,
      value: formatNumber(market.referencePrice, market.priceDecimals + (market.priceDecimals === 0 ? 0 : 1)),
      title:
        market.referenceAsOf > 0
          ? `Chainlink ${market.referencePair} on Arbitrum One, updated ${formatUtcStamp(market.referenceAsOf)} UTC.`
          : `Chainlink ${market.referencePair} could not be read.`,
    },
    {
      label: analytic.label,
      // A market marked at its reference has no forward of its own yet, so its carry or basis is not a reading.
      value: market.markSource === "MID" || market.markSource === "LAST" ? formatAnalytic(analytic) : "—",
      title:
        market.markSource === "MID" || market.markSource === "LAST"
          ? `${analytic.describe} From the mark against the live reference.`
          : `${analytic.describe} Shown once the market has a book or a trade.`,
    },
    {
      label: "Expiry",
      value: formatExpiry(market.expiryIso),
      sub: `${daysToExpiry(market.expiryIso, nowSeconds * 1000)}d`,
    },
    {
      label: "Open interest",
      value: Number.isFinite(market.openInterestLots) ? `${formatLots(market.openInterestLots)} lots` : "—",
    },
    {
      label: "Settlement",
      value: "USDC",
      sub: market.settlementClass === "CASH_USDC_NDF" ? "NDF" : "cash",
      asset: "USDC",
      title: SETTLEMENT_LABEL[market.settlementClass],
    },
  ];
}

/** One compact row: identity and switcher, the mark and its source, aligned stats, contract disclosure. */
export function MarketHeader({
  market,
  onSelectMarket,
  onchain = market.listedOnchain,
}: {
  market: PackageMarket;
  onSelectMarket: (market: PackageMarket) => void;
  /** Whether orders on this market settle on the connected chain. */
  onchain?: boolean;
}) {
  const now = useChainNow();
  const change = changePercent(market.netPrice, market.priorNetPrice);
  const unit = priceUnitSuffix(market.priceUnit);
  const reference = market.markSource === "REFERENCE" || market.markSource === "NONE";

  return (
    <div className="relative z-[35] flex h-[52px] shrink-0 items-stretch border-b border-line bg-panel lg:mx-1 lg:mt-1 lg:h-12 lg:rounded-lg lg:border lg:border-line">
      <div className="flex min-w-0 shrink-0 items-center gap-3 pr-3 pl-3 lg:pl-4">
        <MarketSwitcher market={market} onSelect={onSelectMarket} />

        <span aria-hidden="true" className="hidden h-6 w-px bg-line lg:block" />

        <span className="hidden items-baseline gap-2 lg:flex">
          <FlashValue value={market.netPrice} className="tnum font-mono text-[17px] tracking-[-0.01em] text-ink">
            {formatPrice(market.netPrice, market)}
          </FlashValue>
          <span className="text-xs text-faint">{unit}</span>
          {reference ? null : <Delta value={change} className="text-xs" />}
        </span>
        <span
          className={`hidden shrink-0 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] lg:flex ${
            reference ? "border-line-strong text-faint" : "border-up/30 text-up"
          }`}
          title={`${markSourceDetail(market)}${
            onchain ? " Orders on this market are signed and settled on the connected chain." : " This market is not open for trading on the connected chain."
          }`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${reference ? "bg-faint" : "bg-up"}`} />
          {MARK_SOURCE_LABEL[market.markSource]}
        </span>
      </div>

      {/* Only the stat strip scrolls, so the switcher popover never sits in a clipping context. */}
      <div className="no-scrollbar hidden min-w-0 flex-1 items-center gap-6 overflow-x-auto pr-3 lg:flex">
        {statsFor(market, now).map((stat) => (
          <Stat key={stat.label} {...stat} />
        ))}
      </div>

      <div className="ml-auto flex shrink-0 flex-col items-end justify-center pr-3 lg:hidden">
        <span className="tnum font-mono text-[15px] text-ink">
          <FlashValue value={market.netPrice}>{`${formatPrice(market.netPrice, market)} `}</FlashValue>
          <span className="text-xs text-faint">{unit}</span>
        </span>
        {reference ? <span className="text-xs text-off">{MARK_SOURCE_LABEL[market.markSource]}</span> : <Delta value={change} className="text-xs" />}
      </div>

      <div className="hidden shrink-0 items-center border-l border-line px-2 lg:flex">
        <ContractDisclosure market={market} />
      </div>
    </div>
  );
}

function ContractDisclosure({ market }: { market: PackageMarket }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="focus-ring flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-dim transition-colors hover:bg-raised hover:text-ink"
      >
        <FileText size={14} aria-hidden="true" className="shrink-0" />
        <span className="hidden xl:inline">Contract</span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close contract details"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="scroll-thin absolute top-full right-0 z-50 mt-1.5 max-h-[66dvh] w-[min(400px,calc(100vw-24px))] overflow-y-auto rounded-lg border border-line-strong bg-panel p-3 shadow-[0_24px_48px_rgba(0,0,0,0.55)]">
            <SectionLabel>Contract specification</SectionLabel>
            <div className="mt-2">
              <ContractSpec market={market} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Shared by the desktop contract popover and the mobile details disclosure. */
export function ContractSpec({ market }: { market: PackageMarket }) {
  const range = `${formatNumber(market.floor, market.priceDecimals)} – ${formatNumber(market.cap, market.priceDecimals)}`;
  return (
    <div className="min-w-0 space-y-3">
      <div className="divide-y divide-line border-y border-line">
        <SpecRow label="Contract" value="Dated range forward, cash settled" />
        <SpecRow label="View" value={market.strategyLabel} />
        <SpecRow
          label="Payoff per lot"
          value={`${formatNumber(market.lotSize, 4).replace(/\.?0+$/, "")} ${market.underlying.split("/")[0]} x (fixing − price), fixing held in ${range}`}
        />
        <SpecRow label="Tick" value={`${formatNumber(market.tickSize, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`} mono />
        <SpecRow
          label="Expiry"
          value={`${formatExpiry(market.expiryIso)} 08:00 UTC, ${daysToExpiry(market.expiryIso)}d`}
          mono
        />
        <SpecRow label="Last trading" value={`${formatUtcStamp(market.lastTradingAt)} UTC`} mono />
        <SpecRow
          label="Settlement"
          value={<AssetLabel symbol="USDC" size={12} className="gap-1.5">{SETTLEMENT_LABEL[market.settlementClass]}</AssetLabel>}
        />
        <SpecRow label="Fixing" value={market.fixingSource} />
        <SpecRow
          label="Qualification"
          value={`${QUALIFICATION_LABEL[market.qualification]} benchmark`}
        />
        <SpecRow label="Notional per lot" value={formatCompactUsd(market.notionalPerLot)} mono />
        <SpecRow
          label="Max liability per lot"
          value={formatCompactUsd(market.collateralPerLot)}
          mono
        />
        {market.maxOrderLots ? <SpecRow label="Max order" value={`${formatLots(market.maxOrderLots)} lots`} mono /> : null}
      </div>

      <p className="text-xs leading-relaxed text-dim">{market.qualificationNote}</p>

      <div className="min-w-0">
        <SectionLabel>Pricing legs</SectionLabel>
        <ul className="mt-1.5 divide-y divide-line border-y border-line">
          {market.legs.map((leg) => (
            <li key={leg.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{leg.instrument}</span>
                <span className="block text-xs text-faint">
                  {leg.family === "SPOT_REF" ? "Reference for the strategy view, not traded" : "Traded on the onchain book"}
                </span>
              </span>
              <span className="tnum shrink-0 font-mono text-xs text-dim">
                {Number.isFinite(leg.mark)
                  ? `${formatNumber(leg.mark, leg.markUnit === "USD" ? Math.max(market.priceDecimals, leg.mark < 10 ? 4 : 0) : 1)} ${priceUnitSuffix(leg.markUnit)}`
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Mobile-only: the desktop stat strip restated as a two-column grid. */
export function MarketStatGrid({ market }: { market: PackageMarket }) {
  const now = useChainNow();
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {statsFor(market, now).map((stat) => (
        <Stat key={stat.label} {...stat} />
      ))}
    </div>
  );
}
