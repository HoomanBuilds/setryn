import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { MarketDataProvider } from "@/components/market-data/MarketDataProvider";
import "../(platform)/globals.css";
import "./embed.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Setryn widget",
  description: "Embeddable Setryn market-data and quote widget, read from the onchain book and Chainlink references.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
};

/**
 * Root layout for embeddable widgets. It is a separate root from the platform so iframes load without the terminal
 * shell, gateway or wallet, while sharing the platform's design tokens and the single market-data feed. Widgets
 * never sign: every trading action is a link out to the platform.
 */
export default function EmbedLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="embed-body">
        <MarketDataProvider>{children}</MarketDataProvider>
      </body>
    </html>
  );
}
