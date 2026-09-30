import type { Metadata } from "next";
import { TreasuryConsole } from "@/components/treasury/TreasuryConsole";

export const metadata: Metadata = {
  title: "Treasury / Setryn",
  description: "Protocol fee account, the active fee schedule and its versions, and fee revenue by market, channel, action and recipient.",
};

export default function TreasuryPage() {
  return <TreasuryConsole />;
}
