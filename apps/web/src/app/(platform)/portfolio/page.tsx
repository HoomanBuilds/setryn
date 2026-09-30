import type { Metadata } from "next";
import { OverviewView } from "@/components/portfolio/Overview";

export const metadata: Metadata = {
  title: "Portfolio / Setryn",
  description:
    "Account snapshot, open package positions, book health, and profit and loss attribution over the Arbitrum One fixture.",
};

export default function PortfolioOverviewPage() {
  return <OverviewView />;
}
