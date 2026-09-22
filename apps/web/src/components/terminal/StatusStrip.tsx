"use client";

import { Info } from "lucide-react";

export function StatusStrip() {
  return (
    <div className="relative z-30 flex h-8 shrink-0 items-center border-b border-line bg-app px-3 lg:px-4">
      <p className="flex min-w-0 items-center gap-2 text-xs whitespace-nowrap text-faint">
        <Info size={13} aria-hidden="true" className="shrink-0" />
        <span className="truncate md:hidden">Preview data. No transaction is sent.</span>
        <span className="hidden truncate md:inline">
          Arbitrum Sepolia preview data. Deterministic values. No transaction is sent.
        </span>
      </p>
    </div>
  );
}
