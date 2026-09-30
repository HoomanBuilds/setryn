import { openApiDocument } from "@/lib/public-api/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, unauthenticated: the machine-readable contract of the v1 API. */
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json(openApiDocument(origin), {
    headers: { "Setryn-Api-Version": "v1", "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" },
  });
}
