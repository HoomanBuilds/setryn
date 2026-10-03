import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { GlobalHeader } from "@/components/terminal/GlobalHeader";
import { StatusStrip } from "@/components/terminal/StatusStrip";
import { ActionDock } from "@/components/gateway/ActionDock";
import { InternalGatewayProvider } from "@/components/gateway/InternalGatewayProvider";
import { MarketDataProvider } from "@/components/market-data/MarketDataProvider";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { SkipLinks } from "@/components/shell/SkipLinks";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Setryn Terminal",
  description: "Dated cash-settled forwards on Arbitrum, marked from the onchain book and Chainlink references.",
};

export const viewport: Viewport = {
  themeColor: "#0e0e10",
  colorScheme: "dark",
};

export default function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`}>
      <body>
        <SkipLinks />
        <InternalGatewayProvider>
          {/* The wallet layer loads with the platform only; the landing and embed roots never include it. */}
          <WalletProvider>
            <MarketDataProvider>
              <div className="flex h-dvh w-full flex-col overflow-hidden bg-app">
                <GlobalHeader />
                {children}
                <StatusStrip />
              </div>
              <ActionDock />
            </MarketDataProvider>
          </WalletProvider>
        </InternalGatewayProvider>
      </body>
    </html>
  );
}
