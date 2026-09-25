import type { Metadata } from "next";
import { StrategyLifecycleConsole } from "@/components/lifecycle/StrategyLifecycleConsole";

export const metadata: Metadata = {
  title: "Strategy Lifecycle / Setryn",
  description: "Inspect package lifecycle health, bounded actions, dependencies, and settlement recovery terms.",
};

export default function LifecyclePage() {
  return <StrategyLifecycleConsole />;
}
