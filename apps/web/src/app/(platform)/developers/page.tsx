import type { Metadata } from "next";
import { DevelopersConsole } from "@/components/developers/DevelopersConsole";

export const metadata: Metadata = {
  title: "Developers / Setryn",
  description: "API keys, SDK quickstart, delegated signers, webhooks, and integration logs for the Setryn public API.",
};

export default function DevelopersPage() {
  return <DevelopersConsole />;
}
