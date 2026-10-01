import { randomUUID } from "node:crypto";
import { PublicApiError, errorResponse, toPublicApiError } from "./errors";
import { verifyKey } from "./keys";
import { takeToken } from "./rate-limit";
import { getPartner } from "../webhooks/partners";
import { verifySignedRequest } from "./replay";
import { recordApiRequest, type ApiScope, type StoredApiKey } from "./store";

export const API_VERSION = "v1";

export interface PublicApiContext<Params> {
  key: StoredApiKey;
  url: URL;
  /** Raw request body; empty for reads. Writes are signed over these exact bytes. */
  body: string;
  requestId: string;
  params: Params;
}

interface RouteOptions {
  scope: ApiScope;
  /** Write requests must carry replay protection headers and a valid request signature. */
  write?: boolean;
}

type RouteContext<Params> = { params: Promise<Params> };

function baseHeaders(requestId: string): Record<string, string> {
  return { "Setryn-Api-Version": API_VERSION, "Setryn-Request-Id": requestId, "Cache-Control": "no-store" };
}

/**
 * Wraps a public route: bearer authentication, per-key rate limit, scope check, replay protection on writes, the
 * error envelope, and the per-key request log the developer console shows. A handler returns the `data` payload.
 */
export function publicRoute<Params = Record<string, never>>(
  options: RouteOptions,
  handler: (context: PublicApiContext<Params>, request: Request) => Promise<unknown>,
) {
  return async (request: Request, routeContext: RouteContext<Params>): Promise<Response> => {
    const started = performance.now();
    const requestId = randomUUID();
    const url = new URL(request.url);
    const pathWithQuery = `${url.pathname}${url.search}`;
    const headers = baseHeaders(requestId);
    let key: StoredApiKey | null = null;
    let response: Response;
    let code: string | undefined;
    try {
      const authorization = request.headers.get("authorization") ?? "";
      const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
      if (!bearer) {
        throw new PublicApiError(401, "UNAUTHENTICATED", "Send an API key as `Authorization: Bearer stk_...`.", {
          "WWW-Authenticate": 'Bearer realm="setryn"',
        });
      }
      key = await verifyKey(bearer);
      const decision = takeToken(key.id, key.rateLimit);
      Object.assign(headers, decision.headers);
      if (!decision.allowed) {
        throw new PublicApiError(429, "RATE_LIMITED", `Rate limit exceeded. Retry in ${decision.retryAfterSeconds}s.`);
      }
      if (key.partnerCode) await enforcePartnerQuota(key.partnerCode, headers);
      if (!key.scopes.includes(options.scope)) {
        throw new PublicApiError(403, "INSUFFICIENT_SCOPE", `This endpoint needs the "${options.scope}" scope.`);
      }
      const body = options.write ? await request.text() : "";
      if (options.write) {
        verifySignedRequest({
          keyId: key.id,
          secretHash: key.secretHash,
          method: request.method,
          pathWithQuery,
          headers: request.headers,
          body,
        });
      }
      const params = (routeContext?.params ? await routeContext.params : {}) as Params;
      const data = await handler({ key, url, body, requestId, params }, request);
      response = data instanceof Response ? data : Response.json(data, { headers });
      if (data instanceof Response) for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    } catch (error) {
      const apiError = toPublicApiError(error);
      code = apiError.code;
      // Unexpected failures are logged server-side with the request id the client sees; details never reach the client.
      if (apiError.status >= 500) console.error(`[public-api] ${requestId} ${request.method} ${pathWithQuery}`, error);
      response = errorResponse(apiError, headers);
    }
    if (key) {
      await recordApiRequest(key.id, {
        id: requestId,
        at: new Date().toISOString(),
        method: request.method,
        path: pathWithQuery.length > 240 ? `${pathWithQuery.slice(0, 237)}...` : pathWithQuery,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        code,
      }, code).catch((error) => console.error(`[public-api] ${requestId} could not persist request accounting`, error));
    }
    return response;
  };
}

/**
 * Every key issued under a partner deployment shares that partner's apiRequestsPerMinute quota: a bucket of one
 * minute's allowance refilled continuously. A paused or deleted partner stops its keys.
 */
async function enforcePartnerQuota(partnerCode: string, headers: Record<string, string>): Promise<void> {
  const partner = await getPartner(partnerCode);
  if (!partner || partner.status !== "active") {
    throw new PublicApiError(403, "PARTNER_INACTIVE", `Partner deployment "${partnerCode}" is not active.`);
  }
  const perMinute = Math.floor(partner.quotas.apiRequestsPerMinute);
  if (perMinute < 1) throw new PublicApiError(403, "PARTNER_INACTIVE", `Partner deployment "${partner.code}" has no API quota.`);
  const decision = takeToken(`partner:${partner.code}`, { capacity: perMinute, refillPerSecond: perMinute / 60 });
  headers["Setryn-Partner-Quota-Limit"] = String(perMinute);
  headers["Setryn-Partner-Quota-Remaining"] = decision.headers["RateLimit-Remaining"];
  if (!decision.allowed) {
    headers["Retry-After"] = String(decision.retryAfterSeconds);
    throw new PublicApiError(
      429,
      "RATE_LIMITED",
      `Partner "${partner.code}" quota of ${perMinute} requests per minute exceeded. Retry in ${decision.retryAfterSeconds}s.`,
    );
  }
}

/** Parses a JSON body that was already read for signing. */
export function parseJsonBody(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new PublicApiError(400, "INVALID_REQUEST", "The request body must be a JSON object.");
}

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null; total: number };
}

/** Offset pagination behind an opaque cursor. Lists are ordered newest first unless an endpoint says otherwise. */
export function paginate<T>(items: readonly T[], url: URL, defaultLimit = 50): Page<T> {
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? defaultLimit : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new PublicApiError(400, "INVALID_REQUEST", "limit must be an integer from 1 to 200.");
  }
  const cursor = url.searchParams.get("cursor");
  let offset = 0;
  if (cursor) {
    const decoded = /^o:(\d{1,9})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!decoded) throw new PublicApiError(400, "INVALID_REQUEST", "cursor is not valid for this list.");
    offset = Number(decoded[1]);
  }
  const data = items.slice(offset, offset + limit);
  const next = offset + limit;
  return {
    data,
    page: {
      limit,
      nextCursor: next < items.length ? Buffer.from(`o:${next}`, "utf8").toString("base64url") : null,
      total: items.length,
    },
  };
}
