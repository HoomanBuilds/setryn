import { Suspense } from "react";
import type { Metadata } from "next";
import { HedgeWorkspace, HedgeWorkspaceFromQuery } from "@/components/hedges/HedgeWorkspace";

export const metadata: Metadata = {
  title: "Hedge builder / Setryn",
  description:
    "Size a dated cash-flow exposure or your positions' delta against the listed range forwards at the live reference, compare outcomes at expiry, then hand off to Strategy Studio or Trade.",
};

export default function HedgesPage() {
  // The query carries an exposure handed off from /exposures or /protect/new.
  return (
    <Suspense fallback={<HedgeWorkspace />}>
      <HedgeWorkspaceFromQuery />
    </Suspense>
  );
}
