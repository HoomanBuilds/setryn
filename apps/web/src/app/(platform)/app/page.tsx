import type { Metadata } from "next";
import { HomeDashboard } from "@/components/home/HomeDashboard";

export const metadata: Metadata = {
  title: "Home / Setryn",
  description: "Account summary, pending actions, opportunities, alerts, and system health for the Setryn platform.",
};

export default function HomePage() {
  return <HomeDashboard />;
}
