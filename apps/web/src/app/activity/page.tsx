import type { Metadata } from "next";
import { ActivityWorkspace } from "@/components/activity/ActivityWorkspace";

export const metadata: Metadata = {
  title: "Activity / Setryn",
  description: "First-party package execution activity, runtime chronology, and receipt evidence.",
};

export default function ActivityPage() {
  return <ActivityWorkspace />;
}
