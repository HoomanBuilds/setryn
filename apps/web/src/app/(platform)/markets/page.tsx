import type { Metadata } from "next";
import { MarketsDirectory } from "@/components/markets/MarketsDirectory";

export const metadata: Metadata = {
  title: "Markets / Setryn",
  description:
    "Listed dated forwards. Table, expiry ladder, and term curve views over the onchain book and Chainlink references.",
};

export default function MarketsPage() {
  return <MarketsDirectory />;
}
