import { NextResponse } from "next/server";

/**
 * Input validation for API routes.
 *
 * Two jobs: stop oversized/malformed bodies before they reach expensive work
 * (an AI call billed per token shouldn't be reachable with a 5MB string), and
 * give every route the same predictable 400 instead of each inventing its own.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** 256KB — far above any legitimate body here, far below anything harmful. */
const MAX_BODY_BYTES = 256 * 1024;

/** Strips control characters: NUL can truncate strings in some drivers,
 *  and the rest corrupt logs. Written as a char-code filter rather than a
 *  regex so no escape sequences can be mangled by tooling. */
function stripControl(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code > 31 && code !== 127) out += ch;
  }
  return out;
}

/**
 * Parses a JSON body with a hard size cap.
 *
 * Checks Content-Length first (cheap rejection), then measures the actual text,
 * because Content-Length is client-supplied and can lie or be absent under
 * chunked encoding.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = MAX_BODY_BYTES
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new ValidationError("Request body is too large.");
  }

  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new ValidationError("Request body is too large.");
  }
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("Request body isn't valid JSON.");
  }
  // Arrays and primitives would pass a naive `typeof === "object"` check and
  // then read as undefined everywhere downstream.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

interface StrOpts {
  min?: number;
  max?: number;
  required?: boolean;
  label?: string;
}

/**
 * Validates and normalises a string field.
 *
 * Strips control characters but does NOT HTML-escape: React escapes on render,
 * and escaping at the boundary would double-encode legitimate apostrophes in
 * names and post text.
 */
export function str(value: unknown, opts: StrOpts = {}): string {
  const { min = 0, max = 2000, required = true, label = "field" } = opts;

  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`${label} is required.`);
    return "";
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be text.`);
  }

  const cleaned = stripControl(value).trim();

  if (cleaned.length < min) {
    throw new ValidationError(`${label} must be at least ${min} characters.`);
  }
  if (cleaned.length > max) {
    throw new ValidationError(`${label} must be under ${max} characters.`);
  }
  return cleaned;
}

/** Validates a URL and restricts it to http/https on a public host. */
export function httpUrl(value: unknown, label = "URL"): string {
  const raw = str(value, { label, max: 2048 });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`${label} isn't a valid link.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`${label} must start with http or https.`);
  }
  // Blocks the obvious SSRF shapes — loopback, link-local and private ranges.
  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) {
    throw new ValidationError(`${label} must be a public address.`);
  }
  return parsed.toString();
}

/** One place that turns a ValidationError into a 400, so routes stay tidy. */
export function validationErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return null;
}
