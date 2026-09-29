import type { Metadata, Viewport } from "next";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Setryn: the private exchange for dated risk",
  description:
    "Setryn is a private dated-risk exchange on Arbitrum. Trade fixed-expiry forwards, options and multi-leg strategies, compare public and private liquidity, clear against USDC and verify every settlement from its receipt.",
};

export const viewport: Viewport = {
  themeColor: "#0c0b10",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
