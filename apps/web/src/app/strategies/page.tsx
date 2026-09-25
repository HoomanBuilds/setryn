import type { Metadata } from "next";
import { StrategyStudio } from "@/components/strategies/StrategyStudio";

export const metadata: Metadata = {
  title: "Strategy Studio / Setryn",
  description:
    "Construct or select a canonical package strategy, inspect modeled economics and settlement terms, then hand it to the Setryn trade terminal.",
};

export default function StrategiesPage() {
  return <StrategyStudio />;
}
