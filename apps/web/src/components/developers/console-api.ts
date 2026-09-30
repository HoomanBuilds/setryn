/** Browser calls to the console-only key management routes (served for the local devnet console only). */

export type Scope = "read" | "trade";

export interface RequestLogEntry {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  code?: string;
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  signers: string[];
  rateLimit: { capacity: number; refillPerSecond: number; remaining: number; resetSeconds: number };
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "ACTIVE" | "REVOKED";
  usage: { requests: number; errors: number; rateLimited: number; replayRejected: number };
  recentRequests: RequestLogEntry[];
}

export interface IssueKeyInput {
  name: string;
  scopes: Scope[];
  signers: string[];
  rateLimit: { capacity: number; refillPerSecond: number };
}

export class ConsoleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
  if (!response.ok || !body || body.error || body.data === undefined) {
    throw new ConsoleError(body?.error?.code ?? `HTTP_${response.status}`, body?.error?.message ?? "The key service did not respond.");
  }
  return body.data;
}

export const listKeys = () => call<ApiKeyView[]>("/api/v1/keys");

export const issueKey = (input: IssueKeyInput) =>
  call<{ key: string; record: ApiKeyView }>("/api/v1/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const revokeKey = (id: string) => call<ApiKeyView>(`/api/v1/keys/${id}`, { method: "DELETE" });
