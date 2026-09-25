"use client";

import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";
import { DemoTradingGateway } from "@/lib/internal-gateway/demo";
import type { GatewaySnapshot, InternalTradingGateway } from "@/lib/internal-gateway/types";

const GatewayContext = createContext<InternalTradingGateway | null>(null);

export function InternalGatewayProvider({ children }: { children: ReactNode }) {
  const gateway = useRef<InternalTradingGateway | null>(null);
  if (!gateway.current) gateway.current = new DemoTradingGateway();
  return <GatewayContext value={gateway.current}>{children}</GatewayContext>;
}

export function useInternalGateway(): InternalTradingGateway {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error("InternalGatewayProvider is missing");
  return gateway;
}

export function useGatewaySnapshot(): GatewaySnapshot {
  const gateway = useInternalGateway();
  return useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getSnapshot);
}
