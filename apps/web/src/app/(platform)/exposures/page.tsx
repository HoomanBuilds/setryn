import type { Metadata } from "next";
import { ExposuresWorkspace } from "@/components/exposures/ExposuresWorkspace";

export const metadata: Metadata = {
  title: "Exposures / Setryn",
  description:
    "Imported, forecast, confirmed, netted, and protected dated exposures, with coverage from the connected account and hand-off to the hedge builder.",
};

export default function ExposuresPage() {
  return <ExposuresWorkspace />;
}
