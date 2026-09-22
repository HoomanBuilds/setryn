import type { Metadata } from "next";
import { CollateralView } from "@/components/portfolio/CollateralView";

export const metadata: Metadata = {
  title: "Collateral / Portfolio / Setryn",
  description:
    "Posted collateral by asset with the haircut applied before it counts as margin, what is reserved against open packages, and how each line can be withdrawn.",
};

export default function PortfolioCollateralPage() {
  return <CollateralView />;
}
