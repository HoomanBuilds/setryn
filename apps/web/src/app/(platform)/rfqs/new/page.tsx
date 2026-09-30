import type { Metadata } from "next";
import { RfqBuilder } from "@/components/rfqs/RfqBuilder";

export const metadata: Metadata = {
  title: "New RFQ / Setryn",
  description: "Build a private multi-maker RFQ: package, size, limit, invitation, disclosure, quote window and firmness, with live economics and pre-flight checks.",
};

export default function NewRfqPage() {
  return <RfqBuilder />;
}
