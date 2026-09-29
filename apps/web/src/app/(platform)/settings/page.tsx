import type { Metadata } from "next";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

export const metadata: Metadata = {
  title: "Settings / Setryn",
  description: "Organizations, subaccounts, roles, approvals, trading preferences, privacy, and security.",
};

export default function SettingsPage() {
  return <SettingsWorkspace />;
}
