import type { Metadata } from "next";
import { OperationsConsole } from "@/components/operations/OperationsConsole";

export const metadata: Metadata = {
  title: "Operations / Setryn",
  description: "First-party operator control and observability console over explicit development fixture evidence.",
};

export default function OperationsPage() {
  return <OperationsConsole />;
}
