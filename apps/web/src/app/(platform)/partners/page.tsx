import type { Metadata } from "next";
import { PartnersConsole } from "@/components/partners/PartnersConsole";

export const metadata: Metadata = {
  title: "Partners / Setryn",
  description: "Partner console: embedded widget deployments, permissions, quotas, attribution, usage, webhooks and modeled revenue share.",
};

export default function PartnersPage() {
  return <PartnersConsole />;
}
