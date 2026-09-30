import type { Metadata } from "next";
import { AuctionBoard } from "@/components/auctions/AuctionBoard";

export const metadata: Metadata = {
  title: "Auctions / Setryn",
  description: "Sealed-bid package auctions and uniform-price batch clearing rounds, with commit and reveal windows and clearing history.",
};

export default function AuctionsPage() {
  return <AuctionBoard />;
}
