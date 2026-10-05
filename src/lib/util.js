// Small helpers shared by the server code. Everything here is pure so it can
// be unit-tested in Node (scripts/test-unit.mjs).

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape any value for safe use inside HTML text or a quoted attribute. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 chars, no look-alikes

/** Random, URL-safe, unguessable id. 20 chars = 100 bits. */
export function newId(length = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b & 31];
  return out;
}

/** Turn a title into a URL slug: "Blue Hour, No. 2" -> "blue-hour-no-2". */
export function slugify(text) {
  const slug = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "artwork";
}

/** Number of decimal places a currency uses (USD 2, JPY 0, ...). */
export function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/** Amounts are stored in minor units (cents). Format them for people. */
export function formatMoney(minor, currency = "USD", locale = "en-US") {
  const digits = currencyDigits(currency);
  const value = Number(minor || 0) / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** True for a valid ISO 4217 currency code that Intl understands. */
export function isCurrency(code) {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Format a millisecond timestamp as a short date. */
export function formatDate(ms, locale = "en-US") {
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/** "24 × 30 in (61 × 76 cm)" */
export function formatSize(p) {
  const w = Number(p.width) || 0;
  const h = Number(p.height) || 0;
  const d = Number(p.depth) || 0;
  if (!w || !h) return "";
  const unit = p.unit === "cm" ? "cm" : "in";
  const fmt = (n) => (Math.round(n * 10) / 10).toString();
  const main = [w, h, d].filter(Boolean).map(fmt).join(" × ") + " " + unit;
  const factor = unit === "in" ? 2.54 : 1 / 2.54;
  const other = [w, h, d].filter(Boolean).map((n) => fmt(n * factor)).join(" × ") + (unit === "in" ? " cm" : " in");
  return `${main} (${other})`;
}

/**
 * Tiny, safe text formatter for owner-written text (about page, policies,
 * painting descriptions). Everything is escaped first, then a few markers
 * are turned into HTML:
 *   blank line   -> new paragraph        "## Title" -> heading
 *   "- item"     -> bullet list          **bold**  -> bold
 *   [text](https://link) -> link (http/https/mailto only)
 */
export function richText(text) {
  const blocks = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  const out = [];
  for (const raw of blocks) {
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    const heading = /^(#{2,3})\s+(.+)$/.exec(lines[0].trim());
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      lines.shift();
      if (!lines.length) continue;
    }
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      out.push("<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("") + "</ul>");
    } else {
      out.push(`<p>${lines.map((l) => inline(l.trim())).join("<br>")}</p>`);
    }
  }
  return out.join("\n");
}

function inline(text) {
  let s = esc(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, href) => {
    const external = href.startsWith("http");
    return `<a href="${href}"${external ? ' rel="noopener" target="_blank"' : ""}>${label}</a>`;
  });
  return s;
}

/** First paragraph of a text as plain text, cut to `max` characters. */
export function excerpt(text, max = 160) {
  const first = String(text ?? "").replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/)[0] || "";
  const plain = first.replace(/^#+\s+/gm, "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  return plain.length > max ? plain.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : plain;
}

export function clampInt(value, min, max, fallback = min) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
