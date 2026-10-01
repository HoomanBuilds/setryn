"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress } from "viem";
import { useSignMessage } from "wagmi";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import {
  organizationActionMessage,
  type OrganizationAction,
  type OrganizationActionResponse,
  type OrganizationControlState,
} from "./organization-protocol";

const QUERY_KEY = "organization-control";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failureMessage(body: unknown, fallback: string): string {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

async function fetchOrganizationState(member: string | null): Promise<OrganizationControlState> {
  const response = await fetch(member ? `/api/organization?member=${member}` : "/api/organization", { cache: "no-store" });
  const body = await readJson(response);
  if (!response.ok) throw new Error(failureMessage(body, "Organization records are unavailable."));
  return body as OrganizationControlState;
}

export interface OrganizationControl {
  /** The connected wallet, lowercased; organization records are filtered to its memberships. */
  member: string | null;
  state: OrganizationControlState | null;
  loading: boolean;
  error: string | null;
  /** Signs the action with the connected wallet, submits it, and replaces the records with the server's result. */
  act: (action: OrganizationAction, params: Record<string, unknown>) => Promise<OrganizationActionResponse>;
  refresh: () => void;
}

/**
 * Organization control for the connected wallet. Records come from `/api/organization`; every change is a message the
 * wallet signs and the server verifies, so the wallet is the member's identity. Consumers share one cached read.
 */
export function useOrganizationControl(): OrganizationControl {
  const snapshot = useGatewaySnapshot();
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const address = snapshot.wallet.status === "CONNECTED" ? snapshot.wallet.address : null;
  const member = address ? address.toLowerCase() : null;
  const query = useQuery({
    queryKey: [QUERY_KEY, member],
    queryFn: () => fetchOrganizationState(member),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const state = query.data ?? null;

  const act = useCallback(
    async (action: OrganizationAction, params: Record<string, unknown>) => {
      if (!member) throw new Error("Connect a wallet to manage organizations.");
      const current = state ?? (await fetchOrganizationState(member));
      if (!current.write.allowed) throw new Error(current.write.reason ?? "Organization changes are disabled on this network.");
      // Hash exactly what the server will parse: undefined fields are dropped the same way JSON does.
      const payload = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
      const issuedAt = new Date().toISOString();
      const message = organizationActionMessage({ action, params: payload, network: current.network, issuedAt });
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message, account: getAddress(member) });
      } catch {
        throw new Error("The wallet did not sign the request.");
      }
      const response = await fetch("/api/organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params: payload, actor: member, issuedAt, signature }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(failureMessage(body, "The organization change was not applied."));
      const result = body as OrganizationActionResponse;
      const next: OrganizationControlState = {
        network: result.network,
        networkLabel: result.networkLabel,
        write: result.write,
        member: result.member,
        snapshot: result.snapshot,
      };
      queryClient.setQueryData([QUERY_KEY, member], next);
      return result;
    },
    [member, state, queryClient, signMessageAsync],
  );

  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    member,
    state,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    act,
    refresh,
  };
}
