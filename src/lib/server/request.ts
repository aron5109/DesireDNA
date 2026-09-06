import "server-only";
import type { NextRequest } from "next/server";

export class RequestRejectedError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestRejectedError";
    this.status = status;
  }
}

/**
 * Reads a JSON body, enforcing the limit against the bytes actually received.
 * Content-Length is a claim by the caller, so it is only used as an early exit.
 */
export async function readJsonBody(req: NextRequest, maxBytes: number): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RequestRejectedError("Expected application/json", 415);
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestRejectedError("Request is too large", 413);
  }

  const body = req.body;
  if (!body) throw new RequestRejectedError("Missing request body", 400);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestRejectedError("Request is too large", 413);
    }
    chunks.push(value);
  }

  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestRejectedError("Body is not valid JSON", 400);
  }
}

/**
 * Same-origin check for cookie-authenticated state changes.
 *
 * The owner cookie is SameSite=Strict, which already blocks cross-site sends in
 * current browsers; this is the belt-and-braces check for anything that slips
 * through an older one.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  // Same-origin fetches from some browsers omit Origin on GET but not on
  // state-changing verbs, so a missing Origin with Sec-Fetch-Site is enough.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new RequestRejectedError("Cross-site request refused", 403);
  }
  if (!origin) return;

  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) {
      throw new RequestRejectedError("Cross-site request refused", 403);
    }
  } catch {
    throw new RequestRejectedError("Cross-site request refused", 403);
  }
}
