import type { Metadata } from "next";
import { RfqWorkspace } from "@/components/rfqs/RfqWorkspace";

export const metadata: Metadata = {
  title: "RFQs / Setryn",
  description: "Private solver RFQ requests, firm quote comparisons, and terminal resume links.",
};

export default function RfqsPage() {
  return <RfqWorkspace />;
}
