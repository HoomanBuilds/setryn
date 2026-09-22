import type { Metadata } from "next";
import { PositionsView } from "@/components/portfolio/PositionsView";

export const metadata: Metadata = {
  title: "Positions / Portfolio / Setryn",
  description:
    "The full package position book with entry, mark, profit and loss, collateral, risk buffer, and lifecycle state, grouped by strategy, underlying, expiry, or risk domain.",
};

export default function PortfolioPositionsPage() {
  return <PositionsView />;
}
