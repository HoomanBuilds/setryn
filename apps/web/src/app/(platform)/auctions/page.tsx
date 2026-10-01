import type { Metadata } from "next";
import { AuctionBoard } from "@/components/auctions/AuctionBoard";

export const metadata: Metadata = {
  title: "Auctions / Setryn",
  description: "Sealed-bid package auctions read from the deployment's auction house, with commit and reveal windows, bids and clearing.",
};

export default function AuctionsPage() {
  return <AuctionBoard />;
}
