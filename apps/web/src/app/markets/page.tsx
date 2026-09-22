import type { Metadata } from "next";
import { MarketsDirectory } from "@/components/markets/MarketsDirectory";
import { MARKETS } from "@/lib/terminal/markets";

export const metadata: Metadata = {
  title: "Markets / Setryn",
  description:
    "Package market directory. Table, expiry ladder, and term curve views over the Arbitrum Sepolia preview fixture.",
};

export default function MarketsPage() {
  return <MarketsDirectory markets={MARKETS} />;
}
