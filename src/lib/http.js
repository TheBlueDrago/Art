// Response helpers, request parsing and security headers.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Scripts only from this site; no inline scripts. Styles allow inline for the
// owner's accent colour. If a payment provider is added later, its script and
// frame domains must be added here (see README).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function securityHeaders(headers, request) {
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  if (request && new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return headers;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}

export function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

export function text(body, status = 200, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  return new Response(body, { status, headers: { "Content-Type": contentType, ...extraHeaders } });
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location } });
}

/** Read a JSON object body, refusing anything too large or not an object. */
export async function readJson(request, maxBytes = 64 * 1024) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new HttpError(413, "That request is too large.");
  const raw = await request.text();
  if (raw.length > maxBytes) throw new HttpError(413, "That request is too large.");
  let data;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "The request could not be read.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "The request could not be read.");
  return data;
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "local";
}

/**
 * Blocks cross-site form posts / fetches that try to ride on the owner's
 * session cookie. Browsers always send Origin on POST/PUT/DELETE.
 */
export function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Requests from other websites are not allowed.");
  }
}
