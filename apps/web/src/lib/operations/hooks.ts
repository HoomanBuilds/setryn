"use client";

import { useEffect, useState } from "react";
import { loadSetrynRuntime, type SetrynRuntime } from "@/lib/internal-gateway/runtime";
import { parseEvidence, parseOperatorStatus, type DeploymentEvidence, type OperatorStatus, type Resource } from "./deployment";

/* Browser polling of the deployment routes; the parsing they use is in ./deployment.ts. */

/** Polls a JSON route. `parse` may also read an error body (returning null when it carries nothing usable). */
function usePolledJson<T>(url: string, intervalMs: number, parse: (body: unknown) => T | null): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, error: null, loading: true, readAt: 0 });
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as unknown;
        const data = body === null ? null : parse(body);
        if (!response.ok) {
          const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
          if (active) setState((current) => ({ data: data ?? current.data, error: message, loading: false, readAt: data ? Date.now() : current.readAt }));
          return;
        }
        if (data === null) throw new Error("UNREADABLE_RESPONSE");
        if (active) setState({ data, error: null, loading: false, readAt: Date.now() });
      } catch (error) {
        if (active) {
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : "UNAVAILABLE", loading: false }));
        }
      } finally {
        if (active && intervalMs > 0) timer = window.setTimeout(load, intervalMs);
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [url, intervalMs, parse]);
  return state;
}

let runtimePromise: Promise<SetrynRuntime> | null = null;

function sharedRuntime(): Promise<SetrynRuntime> {
  runtimePromise ??= loadSetrynRuntime().catch((error: unknown) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

/** The selected network's runtime file, read once per page load and shared by every consumer. */
export function useDeploymentRuntime(): Resource<SetrynRuntime> {
  const [state, setState] = useState<Resource<SetrynRuntime>>({ data: null, error: null, loading: true, readAt: 0 });
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = () => {
      sharedRuntime()
        .then((data) => {
          if (active) setState({ data, error: null, loading: false, readAt: Date.now() });
        })
        .catch((error: unknown) => {
          if (!active) return;
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : "RUNTIME_UNAVAILABLE", loading: false }));
          timer = window.setTimeout(load, 10_000);
        });
    };
    load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);
  return state;
}

export function useOperatorStatus(intervalMs = 10_000): Resource<OperatorStatus> {
  return usePolledJson("/api/internal/operator/status", intervalMs, parseOperatorStatus);
}

export function useDeploymentEvidence(intervalMs = 30_000): Resource<DeploymentEvidence> {
  return usePolledJson("/api/internal/deployment", intervalMs, parseEvidence);
}

