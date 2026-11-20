import { createHash } from "node:crypto";

export function snapshotTag(value: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
}

export function notModified(request: Request, tag: string): Response | null {
  if (request.headers.get("if-none-match") !== tag) return null;
  return new Response(null, {
    status: 304,
    headers: { ETag: tag, "Cache-Control": "no-store" },
  });
}

export function snapshotJson(value: unknown, tag: string): Response {
  return Response.json(value, {
    headers: { ETag: tag, "Cache-Control": "no-store" },
  });
}
