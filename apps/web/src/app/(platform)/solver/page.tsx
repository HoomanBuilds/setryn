import type { Metadata } from "next";
import { SolverCockpit } from "@/components/solver/SolverCockpit";

export const metadata: Metadata = {
  title: "Solver / Setryn",
  description: "Your private requests and their firm quotes, compared with the public book, with request history and recovery.",
};

export default function SolverPage() {
  return <SolverCockpit />;
}
