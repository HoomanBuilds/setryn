"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { AssetIcon, AssetLabel } from "@/components/icons/AssetIcon";
import { MarketSwitcher } from "@/components/terminal/MarketSwitcher";
import { FlashValue } from "@/components/terminal/motion";
import { Delta, QUALIFICATION_LABEL, SectionLabel } from "@/components/terminal/primitives";
import {
  changePercent,
  daysToExpiry,
  formatCompactUsd,
  formatExpiry,
  formatLots,
  formatNumber,
  formatPrice,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

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

function statsFor(market: PackageMarket) {
  const unit = priceUnitSuffix(market.priceUnit);
  return [
    { label: "Best bid", value: formatPrice(market.bestBid, market), tone: "up" as const },
    { label: "Best offer", value: formatPrice(market.bestAsk, market), tone: "down" as const },
    {
      label: "Spread",
      value: `${formatNumber(market.bestAsk - market.bestBid, market.priceDecimals)} ${unit}`,
      title: "Best executable offer minus best executable bid across every liquidity source.",
    },
    {
      label: "Firm depth",
      value: `${formatLots(market.firmDepthLots)} lots`,
      title: "Executable lots only. Indicative rows are never counted.",
    },
    {
      label: "Expiry",
      value: formatExpiry(market.expiryIso),
      sub: `${daysToExpiry(market.expiryIso)}d`,
    },
    { label: "Open interest", value: `${formatLots(market.openInterestLots)} lots` },
    {
      label: "Settlement",
      value: "USDC",
      sub: market.settlementClass === "CASH_USDC_NDF" ? "NDF" : "cash",
      asset: "USDC",
      title: SETTLEMENT_LABEL[market.settlementClass],
    },
  ];
}

/** One compact row: identity and switcher, package price, aligned stats, contract disclosure. */
export function MarketHeader({
  market,
  onSelectMarket,
  onchain = false,
}: {
  market: PackageMarket;
  onSelectMarket: (market: PackageMarket) => void;
  /** Whether orders on this market settle on the connected chain; index markets are quoted but not executable. */
  onchain?: boolean;
}) {
  const change = changePercent(market.netPrice, market.priorNetPrice);
  const unit = priceUnitSuffix(market.priceUnit);

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
          <Delta value={change} className="text-xs" />
        </span>
        <span
          className={`hidden shrink-0 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px] lg:flex ${
            onchain ? "border-up/30 text-up" : "border-line-strong text-faint"
          }`}
          title={
            onchain
              ? "Orders on this market are signed and settled on the connected chain."
              : "Reference market: quotes and depth come from the Setryn index feed; trading is not open for this market."
          }
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${onchain ? "bg-up" : "bg-faint"}`} />
          {onchain ? "Onchain" : "Reference"}
        </span>
      </div>

      {/* Only the stat strip scrolls, so the switcher popover never sits in a clipping context. */}
      <div className="no-scrollbar hidden min-w-0 flex-1 items-center gap-6 overflow-x-auto pr-3 lg:flex">
        {statsFor(market).map((stat) => (
          <Stat key={stat.label} {...stat} />
        ))}
      </div>

      <div className="ml-auto flex shrink-0 flex-col items-end justify-center pr-3 lg:hidden">
        <span className="tnum font-mono text-[15px] text-ink">
          <FlashValue value={market.netPrice}>{`${formatPrice(market.netPrice, market)} `}</FlashValue>
          <span className="text-xs text-faint">{unit}</span>
        </span>
        <Delta value={change} className="text-xs" />
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
  return (
    <div className="min-w-0 space-y-3">
      <div className="divide-y divide-line border-y border-line">
        <SpecRow label="Strategy" value={market.strategyLabel} />
        <SpecRow label="Legs" value={`${market.legs.length}, filled as one package`} />
        <SpecRow
          label="Expiry"
          value={`${formatExpiry(market.expiryIso)}, ${daysToExpiry(market.expiryIso)}d`}
          mono
        />
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
          label="Collateral per lot"
          value={formatCompactUsd(market.collateralPerLot)}
          mono
        />
      </div>

      <p className="text-xs leading-relaxed text-dim">{market.qualificationNote}</p>

      <div className="min-w-0">
        <SectionLabel>Package legs</SectionLabel>
        <ul className="mt-1.5 divide-y divide-line border-y border-line">
          {market.legs.map((leg) => (
            <li key={leg.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{leg.instrument}</span>
                <span className="block text-xs text-faint">
                  {`${leg.side === "BUY" ? "Buy" : "Sell"} ${formatNumber(leg.ratio, 2)}x / ${
                    leg.venueClass === "NATIVE_BOOK" ? "native leg book" : "implied component"
                  }`}
                </span>
              </span>
              <span className="tnum shrink-0 font-mono text-xs text-dim">
                {`${formatNumber(leg.mark, leg.markUnit === "USD" ? (leg.mark < 10 ? 4 : 2) : 1)} ${priceUnitSuffix(leg.markUnit)}`}
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
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {statsFor(market).map((stat) => (
        <Stat key={stat.label} {...stat} />
      ))}
    </div>
  );
}
