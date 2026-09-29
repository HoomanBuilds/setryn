import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { GlobalHeader } from "@/components/terminal/GlobalHeader";
import { StatusStrip } from "@/components/terminal/StatusStrip";
import { InternalGatewayProvider } from "@/components/gateway/InternalGatewayProvider";
import { PreviewMarketProvider } from "@/components/terminal/PreviewMarketProvider";
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
  description: "Package-native dated risk exchange terminal. Arbitrum Sepolia preview market data.",
};

export const viewport: Viewport = {
  themeColor: "#0a090d",
  colorScheme: "dark",
};

export default function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`}>
      <body>
        <InternalGatewayProvider>
          <PreviewMarketProvider>
            <div className="flex h-dvh w-full flex-col overflow-hidden bg-app">
              <GlobalHeader />
              {children}
              <StatusStrip />
            </div>
          </PreviewMarketProvider>
        </InternalGatewayProvider>
      </body>
    </html>
  );
}
