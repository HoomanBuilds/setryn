import type { ReactNode } from "react";
import { AssetIcon, ChainIcon, UnderlyingIcon } from "@/components/icons/AssetIcon";
import { MARKETS } from "@/lib/terminal/markets";

/*
 * Small marks the account, execution and lifecycle pages set beside a package, a collateral figure or a transaction.
 * The text always stays; the marks are aria-hidden so a screen reader hears the same row it did before.
 */

const UNDERLYING_BY_CODE = new Map(MARKETS.map((market) => [market.code.toUpperCase(), market.underlying]));
const UNDERLYINGS = new Set(MARKETS.map((market) => market.underlying.toUpperCase()));
const SINGLE = new Set(["BTC", "ETH", "ARB", "XAU", "EUR", "USDC", "SUSD"]);

/**
 * The underlying for a package code or id ("BTC-YC-24DEC26", "EURUSD-FW-30DEC26"). Unknown catalog codes still resolve
 * from their prefix so a re-dated series keeps its mark; anything unrecognised returns null and draws nothing.
 */
export function underlyingOf(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const key = ref.trim().toUpperCase();
  const known = UNDERLYING_BY_CODE.get(key);
  if (known) return known;
  const prefix = key.split(/[-_\s:/]/)[0];
  if (/^[A-Z]{3}USD$/.test(prefix) && prefix !== "SUSD") return `${prefix.slice(0, 3)}/USD`;
  if (SINGLE.has(prefix)) return prefix;
  return null;
}

/** The label itself when it names a catalog underlying ("BTC", "EUR/USD"), so grouped rows can lead with its mark. */
export function knownUnderlying(label: string | null | undefined): string | null {
  if (!label) return null;
  return UNDERLYINGS.has(label.trim().toUpperCase()) ? label.trim() : null;
}

/** The underlying mark for a market object, an underlying string, or a package code. */
export function MarketMark({
  underlying,
  code,
  size = 14,
  className = "",
}: {
  underlying?: string | null;
  code?: string | null;
  size?: number;
  className?: string;
}) {
  const resolved = underlying ?? underlyingOf(code);
  if (!resolved) return null;
  return <UnderlyingIcon underlying={resolved} size={size} className={className} />;
}

/** A label led by its underlying mark, aligned on the text's first line. */
export function WithMark({
  underlying,
  code,
  size = 14,
  gap = "gap-1.5",
  className = "",
  children,
}: {
  underlying?: string | null;
  code?: string | null;
  size?: number;
  gap?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`flex min-w-0 items-center ${gap} ${className}`}>
      <MarketMark underlying={underlying} code={code} size={size} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Collateral and settlement amounts are USDC-denominated (the local chain's settlement token mirrors it). */
export function CollateralMark({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <AssetIcon symbol="USDC" size={size} className={className} />;
}

/** An amount with the collateral mark ahead of it. */
export function CollateralAmount({
  children,
  size = 14,
  className = "",
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <CollateralMark size={size} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Arbitrum mark for transaction, receipt and explorer rows. */
export function TxChainMark({ size = 12, className = "" }: { size?: number; className?: string }) {
  return <ChainIcon size={size} className={className} />;
}
