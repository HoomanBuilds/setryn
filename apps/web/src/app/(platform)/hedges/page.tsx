import { Suspense } from "react";
import type { Metadata } from "next";
import { HedgeWorkspace, HedgeWorkspaceFromQuery } from "@/components/hedges/HedgeWorkspace";

export const metadata: Metadata = {
  title: "Hedge builder / Setryn",
  description:
    "Goal-first package hedge workspace. Size a dated cash-flow exposure against listed package templates, compare modeled outcomes, then hand off to Strategy Studio or Trade.",
};

export default function HedgesPage() {
  // The query carries an exposure handed off from /exposures or /protect/new.
  return (
    <Suspense fallback={<HedgeWorkspace />}>
      <HedgeWorkspaceFromQuery />
    </Suspense>
  );
}
