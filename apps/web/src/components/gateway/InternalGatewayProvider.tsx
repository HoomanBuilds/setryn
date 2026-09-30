"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { OnchainTradingGateway } from "@/lib/internal-gateway/onchain";
import type { GatewaySnapshot, InternalTradingGateway } from "@/lib/internal-gateway/types";

const GatewayContext = createContext<InternalTradingGateway | null>(null);

export function InternalGatewayProvider({ children }: { children: ReactNode }) {
  const [gateway] = useState<InternalTradingGateway>(() => new OnchainTradingGateway());
  return <GatewayContext value={gateway}>{children}</GatewayContext>;
}

export function useInternalGateway(): InternalTradingGateway {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error("InternalGatewayProvider is missing");
  return gateway;
}

export function useGatewaySnapshot(): GatewaySnapshot {
  const gateway = useInternalGateway();
  return useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getServerSnapshot);
}
