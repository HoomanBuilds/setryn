"use client";

import { Info } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";

export function StatusStrip() {
  const snapshot = useGatewaySnapshot();
  return (
    <div className="relative z-30 flex h-8 shrink-0 items-center border-b border-line bg-app px-3 lg:px-4">
      <p className="flex min-w-0 items-center gap-2 text-xs whitespace-nowrap text-faint">
        <Info size={13} aria-hidden="true" className="shrink-0" />
        <span className="truncate md:hidden">{snapshot.environment.label}. Mainnet writes disabled.</span>
        <span className="hidden truncate md:inline">
          {snapshot.environment.label}: collateral and public orders settle onchain. Market observations use the development feed. Mainnet writes are disabled.
        </span>
      </p>
    </div>
  );
}
