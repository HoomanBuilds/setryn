import type { Metadata } from "next";
import { StrategyLifecycleConsole } from "@/components/lifecycle/StrategyLifecycleConsole";

export const metadata: Metadata = {
  title: "Lifecycle / Setryn",
  description: "Your positions' fixing, election and settlement schedule read from chain, with exit, offset and roll actions.",
};

export default function LifecyclePage() {
  return <StrategyLifecycleConsole />;
}
