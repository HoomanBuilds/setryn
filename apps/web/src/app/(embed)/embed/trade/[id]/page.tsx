import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeWidget } from "@/components/widgets/TradeWidget";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { parseEmbedParams } from "@/components/widgets/embed-params";
import { marketBySlug, packageLabel } from "@/lib/terminal/markets";

export async function generateMetadata({ params }: PageProps<"/embed/trade/[id]">): Promise<Metadata> {
  const market = marketBySlug((await params).id);
  return { title: market ? `${packageLabel(market)} quote widget / Setryn` : "Setryn quote widget" };
}

export default async function TradeEmbedPage({ params, searchParams }: PageProps<"/embed/trade/[id]">) {
  const market = marketBySlug((await params).id);
  if (!market) notFound();
  const embed = parseEmbedParams(await searchParams);
  return (
    <WidgetFrame
      widget="trade"
      theme={embed.theme}
      partner={embed.partner}
      consoleView={embed.consoleView}
      frameId={embed.frameId}
      marketId={market.id}
      label={`${packageLabel(market)} quote widget`}
    >
      <TradeWidget marketId={market.id} partner={embed.partner} initialSide={embed.side} initialLots={embed.lots} />
    </WidgetFrame>
  );
}
