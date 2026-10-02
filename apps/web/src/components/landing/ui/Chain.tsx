import { NetworkArbitrumOne, TokenBTC, TokenETH, TokenUSDC } from "@web3icons/react";
import styles from "./Chain.module.css";

/*
 * The network and asset marks for the landing. Arbitrum's logomark and the token marks come from @web3icons/react
 * (Arbitrum's official navy, blue and light-blue); fiat uses the flag-icons flags in /public/icons and gold a drawn
 * bar. They are styled here with the landing's own CSS, since the platform's icon module relies on its Tailwind theme.
 */

type MarkProps = { size?: number; className?: string };

/** Arbitrum's logomark. `mono` follows the surrounding text colour. */
export function ArbitrumMark({ size = 16, className, mono = false }: MarkProps & { mono?: boolean }) {
  return <NetworkArbitrumOne size={size} variant={mono ? "mono" : "branded"} className={className} aria-hidden="true" />;
}

export function UsdcMark({ size = 16, className }: MarkProps) {
  return <TokenUSDC size={size} variant="branded" className={className} aria-hidden="true" />;
}

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

/* ARB wears Arbitrum's own logomark: @web3icons' TokenARB draws an unrelated "AR" token. */
const TOKENS = { BTC: TokenBTC, ETH: TokenETH, ARB: NetworkArbitrumOne, USDC: TokenUSDC } as const;
const FLAGS: Record<string, string> = { EUR: "/icons/flag-eu.svg", USD: "/icons/flag-us.svg" };

function Asset({ symbol, size }: { symbol: string; size: number }) {
  if (symbol in TOKENS) {
    const Token = TOKENS[symbol as keyof typeof TOKENS];
    return <Token size={size} variant="branded" aria-hidden="true" />;
  }
  if (FLAGS[symbol]) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny static flag
    return <img className={styles.flag} src={FLAGS[symbol]} alt="" width={size} height={size} />;
  }
  if (symbol === "XAU") return <GoldMark size={size} />;
  return <span className={styles.letter} style={{ width: size, height: size }}>{symbol.slice(0, 1)}</span>;
}

/** An underlying's mark: one asset, or a pair drawn base over quote the way exchanges show pairs. */
export function UnderlyingMark({ underlying, size = 20 }: { underlying: string; size?: number }) {
  const [base, quote] = underlying.split("/").map((part) => part.trim().toUpperCase());
  if (!quote) {
    return (
      <span className={styles.single} aria-hidden="true">
        <Asset symbol={base} size={size} />
      </span>
    );
  }
  const small = Math.round(size * 0.68);
  return (
    <span className={styles.pair} style={{ width: size + small * 0.55, height: size }} aria-hidden="true">
      <span className={styles.quote}>
        <Asset symbol={quote} size={small} />
      </span>
      <span className={styles.base}>
        <Asset symbol={base} size={size} />
      </span>
    </span>
  );
}
