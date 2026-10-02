import { NetworkArbitrumOne, TokenBTC, TokenETH, TokenUSDC } from "@web3icons/react";
import type { ComponentType, ReactNode, SVGProps } from "react";

/*
 * Asset, pair and chain marks. Crypto assets and the Arbitrum network come from @web3icons/react; fiat pairs use the
 * flag-icons flags in /public/icons, and spot gold uses a drawn bar because no gold token logo stands for XAU spot.
 * Unknown symbols fall back to a lettered disc so a new catalog asset never renders empty.
 */

type Web3Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; variant?: "branded" | "mono" | "background" }>;

const TOKENS: Record<string, Web3Icon> = {
  BTC: TokenBTC as Web3Icon,
  ETH: TokenETH as Web3Icon,
  // The web3icons "TokenARB" glyph is a different project's "AR+" mark; the ARB token wears the Arbitrum network mark.
  ARB: NetworkArbitrumOne as Web3Icon,
  USDC: TokenUSDC as Web3Icon,
  SUSD: TokenUSDC as Web3Icon,
};

const FLAGS: Record<string, string> = { EUR: "/icons/flag-eu.svg", USD: "/icons/flag-us.svg" };

function GoldMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2a2418" />
      <path d="M6.2 15.6 8 10.4h8l1.8 5.2z" fill="#d9a92f" />
      <path d="M8 10.4h8l-.8-2.4H8.8z" fill="#f1c95a" />
      <path d="M6.2 15.6h11.6l-.5.9H6.7z" fill="#a67c1b" />
    </svg>
  );
}

function LetterMark({ symbol, size }: { symbol: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-full bg-inset font-mono font-semibold text-dim"
      style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.42)) }}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

/** A single asset mark (BTC, ETH, ARB, USDC, EUR, USD, XAU). */
export function AssetIcon({ symbol, size = 16, className = "" }: { symbol: string; size?: number; className?: string }) {
  const key = symbol.trim().toUpperCase();
  const Token = TOKENS[key];
  if (Token) {
    return (
      <span className={`inline-flex shrink-0 ${className}`} aria-hidden="true">
        <Token size={size} variant="branded" />
      </span>
    );
  }
  if (FLAGS[key]) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG flag
      <img src={FLAGS[key]} alt="" width={size} height={size} className={`shrink-0 rounded-full ${className}`} aria-hidden="true" />
    );
  }
  if (key === "XAU" || key === "GOLD") {
    return (
      <span className={`inline-flex shrink-0 ${className}`} aria-hidden="true">
        <GoldMark size={size} />
      </span>
    );
  }
  return <LetterMark symbol={key} size={size} />;
}

/**
 * The underlying's mark. A single asset ("BTC") draws one icon; a pair ("EUR/USD", "XAU/USD") draws the base with the
 * quote tucked behind it, the way exchanges show pairs.
 */
export function UnderlyingIcon({ underlying, size = 16, className = "" }: { underlying: string; size?: number; className?: string }) {
  const [base, quote] = underlying.split("/").map((part) => part.trim());
  if (!quote) return <AssetIcon symbol={base} size={size} className={className} />;
  const small = Math.round(size * 0.7);
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size + small * 0.55, height: size }} aria-hidden="true">
      <span className="absolute right-0 bottom-0 rounded-full ring-2 ring-[var(--color-panel,#111)]" style={{ lineHeight: 0 }}>
        <AssetIcon symbol={quote} size={small} />
      </span>
      <span className="absolute top-0 left-0 rounded-full ring-2 ring-[var(--color-panel,#111)]" style={{ lineHeight: 0 }}>
        <AssetIcon symbol={base} size={size} />
      </span>
    </span>
  );
}

export type ChainKey = "arbitrum-one" | "arbitrum-sepolia" | "local";

const CHAIN_NAMES: Record<ChainKey, string> = {
  "arbitrum-one": "Arbitrum One",
  "arbitrum-sepolia": "Arbitrum Sepolia",
  local: "Arbitrum",
};

/** Chain id to the chain Setryn runs on. The local devnet mirrors Arbitrum One, so it wears the Arbitrum mark too. */
export function chainKeyOf(chainId: number | null | undefined): ChainKey {
  if (chainId === 42161) return "arbitrum-one";
  if (chainId === 421614) return "arbitrum-sepolia";
  return "local";
}

/** Display name per chain id. The local devnet (31337) mirrors Arbitrum One but is shown as plain Arbitrum. */
export function chainLabelOf(chainId: number | null | undefined): string {
  return CHAIN_NAMES[chainKeyOf(chainId)];
}

export function ChainIcon({ size = 16, className = "", mono = false }: { size?: number; className?: string; mono?: boolean }) {
  const Icon = NetworkArbitrumOne as Web3Icon;
  return (
    <span className={`inline-flex shrink-0 ${className}`} aria-hidden="true">
      <Icon size={size} variant={mono ? "mono" : "branded"} />
    </span>
  );
}

/** Arbitrum mark with the network name, for headers, footers and status rows. */
export function ChainBadge({
  chain = "arbitrum-one",
  size = 14,
  className = "",
  label,
}: {
  chain?: ChainKey;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
      <ChainIcon size={size} />
      <span>{label ?? CHAIN_NAMES[chain]}</span>
    </span>
  );
}

/**
 * An asset mark beside its text (a symbol or an amount). The row keeps the text's baseline, so it sits in
 * baseline-aligned rows exactly where the bare text did, while the mark is centred on the line.
 */
export function AssetLabel({
  symbol,
  size = 14,
  className = "",
  children,
}: {
  symbol: string;
  size?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <AssetIcon symbol={symbol} size={size} className="self-center" />
      <span className="min-w-0">{children ?? symbol}</span>
    </span>
  );
}

/**
 * An amount with its asset: "1,250.00 [mark] USDC". The mark and symbol trail the figure, so right-aligned columns
 * of amounts keep their marks in one vertical line.
 */
export function AssetAmount({
  value,
  symbol,
  size = 12,
  className = "",
  symbolClassName = "text-faint",
}: {
  value: ReactNode;
  symbol: string;
  size?: number;
  className?: string;
  symbolClassName?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1 whitespace-nowrap ${className}`}>
      <span>{value}</span>
      <AssetIcon symbol={symbol} size={size} className="ml-0.5 self-center" />
      <span className={symbolClassName}>{symbol}</span>
    </span>
  );
}
