import type { Metadata } from "next";
import { Suspense } from "react";
import { SettlementsWorkspace } from "@/components/settlements/SettlementsWorkspace";

export const metadata: Metadata = {
  title: "Settlements / Setryn",
  description: "Fixing schedule and observations, settlement payouts, reconciliation and exceptions across held and listed dated series.",
};

export default function SettlementsPage() {
  return (
    <Suspense fallback={<main className="min-h-0 flex-1 bg-app" aria-busy="true" />}>
      <SettlementsWorkspace />
    </Suspense>
  );
}
