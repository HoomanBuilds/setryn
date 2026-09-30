import { WebhookApiError } from "./service";

/** Shared JSON envelope for the webhook and partner routes: `{ data }` on success, `{ error: { code, message } }`. */
export function ok(data: unknown, status = 200): Response {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function failure(error: unknown): Response {
  if (error instanceof WebhookApiError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function readBody(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) return {};
  if (text.length > maxBytes) throw new WebhookApiError(413, "BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WebhookApiError(400, "INVALID_JSON", "Request body must be JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WebhookApiError(400, "INVALID_JSON", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
