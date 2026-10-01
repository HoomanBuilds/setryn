import type { Metadata } from "next";
import { StrategyStudio } from "@/components/strategies/StrategyStudio";

export const metadata: Metadata = {
  title: "Strategy Studio / Setryn",
  description:
    "Build on a listed range forward, inspect its payoff, collateral and settlement terms against the live book, then hand it to the Setryn trade terminal.",
};

export default function StrategiesPage() {
  return <StrategyStudio />;
}
