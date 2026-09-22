import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TerminalWorkspace } from "@/components/terminal/TerminalWorkspace";
import { formatExpiry } from "@/lib/terminal/format";
import { MARKETS, marketBySlug, marketSlug, tradeHref } from "@/lib/terminal/markets";

type TradeParams = { params: Promise<{ market: string }> };

export function generateStaticParams() {
  return MARKETS.map((market) => ({ market: marketSlug(market) }));
}

export async function generateMetadata({ params }: TradeParams): Promise<Metadata> {
  const { market: slug } = await params;
  const market = marketBySlug(slug);
  if (!market) return { title: "Market not listed / Setryn" };
  return {
    title: `${market.code} / Setryn`,
    description: `${market.name}. ${market.strategyLabel}. Expires ${formatExpiry(
      market.expiryIso,
    )}, settled in ${market.settlementAsset}.`,
  };
}

export default async function TradePage({ params }: TradeParams) {
  const { market: slug } = await params;
  const market = marketBySlug(slug);

  /* An unlisted slug is a 404, never a silent fallback onto another market.
     A listed one under different casing moves to its own canonical URL. */
  if (!market) notFound();
  if (slug !== marketSlug(market)) redirect(tradeHref(market));

  return <TerminalWorkspace market={market} />;
}
