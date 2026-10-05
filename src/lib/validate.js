// Input checks for everything visitors and the owner send in.

import { HttpError } from "./http.js";
import { isCountry } from "./countries.js";

/** Trimmed single-line string, control characters removed. */
export function line(value, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Multi-line text (keeps newlines), control characters removed. */
export function multiline(value, max = 5000) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
}

export function required(value, message) {
  if (!value) throw new HttpError(400, message);
  return value;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export function email(value, { optional = false } = {}) {
  const v = line(value, 254).toLowerCase();
  if (!v && optional) return "";
  if (!EMAIL_RE.test(v)) throw new HttpError(400, "Please enter a valid email address.");
  return v;
}

export function address(value, label) {
  const a = value && typeof value === "object" ? value : {};
  const out = {
    name: line(a.name, 120),
    line1: line(a.line1, 200),
    line2: line(a.line2, 200),
    city: line(a.city, 120),
    region: line(a.region, 120),
    postal: line(a.postal, 30),
    country: line(a.country, 2).toUpperCase(),
  };
  if (!out.name) throw new HttpError(400, `Please enter the full name for the ${label} address.`);
  if (!out.line1) throw new HttpError(400, `Please enter the street address for the ${label} address.`);
  if (!out.city) throw new HttpError(400, `Please enter the city for the ${label} address.`);
  if (!isCountry(out.country)) throw new HttpError(400, `Please choose a country for the ${label} address.`);
  return out;
}

/** Money typed by the owner in major units ("1,250.00") -> minor units (125000). */
export function moneyToMinor(value, digits, { allowEmpty = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowEmpty) return null;
    throw new HttpError(400, "Please enter a price.");
  }
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new HttpError(400, "Please enter a valid amount.");
  return Math.round(n * 10 ** digits);
}

export function optionalNumber(value, { min = 0, max = 100_000 } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, "Please check the numbers you entered.");
  return n;
}

export function bool(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

export function oneOf(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

export function isId(value) {
  return typeof value === "string" && /^[a-z0-9]{6,40}$/.test(value);
}
