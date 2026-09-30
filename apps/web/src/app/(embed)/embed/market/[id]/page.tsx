import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketWidget } from "@/components/widgets/MarketWidget";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { parseEmbedParams } from "@/components/widgets/embed-params";
import { marketBySlug, packageLabel } from "@/lib/terminal/markets";

export async function generateMetadata({ params }: PageProps<"/embed/market/[id]">): Promise<Metadata> {
  const market = marketBySlug((await params).id);
  return { title: market ? `${packageLabel(market)} widget / Setryn` : "Setryn market widget" };
}

export default async function MarketEmbedPage({ params, searchParams }: PageProps<"/embed/market/[id]">) {
  const market = marketBySlug((await params).id);
  if (!market) notFound();
  const embed = parseEmbedParams(await searchParams);
  return (
    <WidgetFrame
      widget="market"
      theme={embed.theme}
      partner={embed.partner}
      preview={embed.preview}
      frameId={embed.frameId}
      marketId={market.id}
      label={`${packageLabel(market)} market widget`}
    >
      <MarketWidget marketId={market.id} partner={embed.partner} />
    </WidgetFrame>
  );
}
