import type { Metadata } from "next";
import { RiskView } from "@/components/portfolio/RiskView";

export const metadata: Metadata = {
  title: "Risk / Portfolio / Setryn",
  description:
    "Exposure concentration, modeled scenario risk with its binding shock, and the expiry and cash ladder for the connected account.",
};

export default function PortfolioRiskPage() {
  return <RiskView />;
}
