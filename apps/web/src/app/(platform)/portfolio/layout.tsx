import type { ReactNode } from "react";
import { PortfolioShell } from "@/components/portfolio/PortfolioShell";

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return <PortfolioShell>{children}</PortfolioShell>;
}
