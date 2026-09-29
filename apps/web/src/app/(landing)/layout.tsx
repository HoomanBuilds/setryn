import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { fontVariables } from "./fonts";
import "./landing.css";

export const metadata: Metadata = {
  title: "Setryn: the private exchange for dated risk",
  description:
    "Setryn is a private dated-risk exchange on Arbitrum. Trade fixed-expiry forwards, options and multi-leg strategies, compare public and private liquidity, clear against USDC and verify every settlement from its receipt.",
};

export const viewport: Viewport = {
  themeColor: "#0c0b10",
};

/**
 * Root layout for the public landing experience. It is a separate root from the
 * platform so the landing's global styles, fonts, and scroll locking never reach
 * the terminal; moving between the two is a full document navigation.
 */
export default function LandingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
