// Owner sign-in: password hashing, sessions and rate limits.
//
// There is no sign-up. The single owner account is created once at /admin
// using the SETUP_KEY secret, and only that account can manage the store.

import { HttpError, clientIp } from "./http.js";

const PBKDF2_ITERATIONS = 100_000; // the maximum Cloudflare allows
const SESSION_DAYS = 30;
const enc = new TextEncoder();

function toB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { pass_hash: toB64(hash), pass_salt: toB64(salt), pass_iter: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password, owner) {
  const hash = await pbkdf2(password, fromB64(owner.pass_salt), owner.pass_iter);
  return timingSafeEqual(hash, fromB64(owner.pass_hash));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Compare two secrets without leaking where (or how long) they differ. */
export async function secretsMatch(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Owner passwords: at least 10 characters, not trivially weak. */
export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 10) return "Use a password with at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  if (/^(password|1234567890|qwertyuiop)/i.test(password)) return "That password is too easy to guess.";
  return "";
}

// ---------------------------------------------------------------------------
// Sessions. The browser keeps a random token in an HttpOnly cookie; the
// database only stores its SHA-256 hash, so a leaked database can't be used
// to sign in.

function cookieName(request) {
  return new URL(request.url).protocol === "https:" ? "__Host-art_owner" : "art_owner";
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

export async function createSession(db, request) {
  const token = toB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db
      .prepare("INSERT INTO sessions (token_hash, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), now, now + SESSION_DAYS * 86400_000, clientIp(request), (request.headers.get("User-Agent") || "").slice(0, 200)),
  ]);
  return sessionCookie(request, token, SESSION_DAYS * 86400);
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(request) {
  return sessionCookie(request, "", 0);
}

export async function getSession(db, request) {
  const token = readCookie(request, cookieName(request));
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await db.prepare("SELECT token_hash, expires_at FROM sessions WHERE token_hash = ?").bind(hash).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

export async function destroySession(db, request) {
  const token = readCookie(request, cookieName(request));
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

/** Throws 401 unless the request carries a valid owner session. */
export async function requireOwner(db, request) {
  const session = await getSession(db, request);
  if (!session) throw new HttpError(401, "Please sign in again.");
  return session;
}

// ---------------------------------------------------------------------------
// Rate limits, stored in D1 so they hold across all server instances.

export async function rateLimit(db, key, limit, windowMs) {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at < ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, now + windowMs, now)
    .first();
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now).run();
  }
  if (row && row.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((row.reset_at - now) / 1000));
    throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.", { retryAfter });
  }
}
