import type { Metadata } from "next";
import { MarketsDirectory } from "@/components/markets/MarketsDirectory";

export const metadata: Metadata = {
  title: "Markets / Setryn",
  description:
    "Package market directory. Table, expiry ladder, and term curve views over the coherent local preview feed.",
};

export default function MarketsPage() {
  return <MarketsDirectory />;
}
