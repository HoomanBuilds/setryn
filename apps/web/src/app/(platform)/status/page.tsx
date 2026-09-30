import type { Metadata } from "next";
import { StatusBoard } from "@/components/status/StatusBoard";

export const metadata: Metadata = {
  title: "System status / Setryn",
  description: "Deployment evidence checked against the live chain: contract code hashes, chain ID, head block, and chain time.",
};

export default function StatusPage() {
  return <StatusBoard />;
}
