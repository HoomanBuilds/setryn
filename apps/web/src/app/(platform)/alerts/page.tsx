import type { Metadata } from "next";
import { AlertsWorkspace } from "@/components/alerts/AlertsWorkspace";

export const metadata: Metadata = {
  title: "Alerts / Setryn",
  description: "Market, risk, fixing, settlement, and system alerts with per-viewer rules over the live board and account.",
};

export default function AlertsPage() {
  return <AlertsWorkspace />;
}
