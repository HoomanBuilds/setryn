import type { Metadata } from "next";
import { SolverCockpit } from "@/components/solver/SolverCockpit";

export const metadata: Metadata = {
  title: "Solver / Setryn",
  description: "Solver opportunities, hedge routes and implied liquidity, reserved capacity, performance, and recovery cases.",
};

export default function SolverPage() {
  return <SolverCockpit />;
}
