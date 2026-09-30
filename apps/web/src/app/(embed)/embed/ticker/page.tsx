import type { Metadata } from "next";
import { TickerWidget } from "@/components/widgets/TickerWidget";
import { WidgetFrame } from "@/components/widgets/WidgetFrame";
import { parseEmbedParams } from "@/components/widgets/embed-params";

export const metadata: Metadata = { title: "Setryn ticker widget" };

export default async function TickerEmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseEmbedParams(await searchParams);
  return (
    <WidgetFrame
      widget="ticker"
      theme={params.theme}
      partner={params.partner}
      preview={params.preview}
      frameId={params.frameId}
      marketId="ALL"
      label="Setryn market ticker widget"
    >
      <TickerWidget marketIds={params.markets.map((market) => market.id)} partner={params.partner} />
    </WidgetFrame>
  );
}
