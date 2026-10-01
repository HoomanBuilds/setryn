import type { Metadata } from "next";
import { OperationsConsole } from "@/components/operations/OperationsConsole";

export const metadata: Metadata = {
  title: "Operations / Setryn",
  description: "Deployment, chain, contract evidence, series schedules, signer status and fee schedule for the connected network.",
};

export default function OperationsPage() {
  return <OperationsConsole />;
}
