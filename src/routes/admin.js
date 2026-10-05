// /api/admin/* — everything the owner does. Every route below the sign-in
// routes requires the owner's session, so nobody else can add, change or
// price paintings, see orders or change settings.

import { DEFAULT_SETTINGS, clearSettingsCache, getSettings, saveSettings } from "../lib/db.js";
import { HttpError, assertSameOrigin, clientIp, json, readJson } from "../lib/http.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSession,
  hashPassword,
  passwordProblem,
  rateLimit,
  requireOwner,
  secretsMatch,
  verifyPassword,
} from "../lib/auth.js";
import { deleteImages, saveUploadedImage } from "../lib/images.js";
import { isCountry } from "../lib/countries.js";
import { bool, email, isId, line, moneyToMinor, multiline, oneOf, optionalNumber } from "../lib/validate.js";
import { clampInt, currencyDigits, isCurrency, newId, slugify } from "../lib/util.js";
import { FONT_THEMES } from "../views/layout.js";

const PAINTING_STATUSES = ["draft", "published", "archived"];
const ORDER_TRANSITIONS = {
  awaiting_payment: ["paid", "cancelled"],
  paid: ["shipped", "completed", "refunded", "cancelled"],
  shipped: ["completed", "refunded"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

export async function handleAdminApi(request, env, ctx, url) {
  const db = env.DB;
  const path = url.pathname.slice("/api/admin".length).replace(/\/+$/, "") || "/";
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    assertSameOrigin(request);
    // Browsers can't send this header cross-site without a CORS preflight,
    // which this API never allows.
    if (request.headers.get("X-Requested-With") !== "art-admin") throw new HttpError(403, "Request blocked.");
  }

  // ---- signing in ------------------------------------------------------------
  if (path === "/status" && method === "GET") {
    const owner = await db.prepare("SELECT name, email FROM owner WHERE id = 1").first();
    const session = owner ? await getSession(db, request) : null;
    return json({
      setup_needed: !owner,
      setup_key_configured: Boolean(env.SETUP_KEY),
      signed_in: Boolean(session),
      owner: session ? owner : null,
    });
  }
  if (path === "/setup" && method === "POST") return setup(request, env);
  if (path === "/login" && method === "POST") return login(request, db);
  if (path === "/logout" && method === "POST") {
    await destroySession(db, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  }

  // ---- everything else: owner only -------------------------------------
  await requireOwner(db, request);

  if (path === "/dashboard" && method === "GET") return dashboard(db);

  if (path === "/paintings" && method === "GET") return listPaintings(db);
  if (path === "/paintings" && method === "POST") return savePainting(db, null, await readJson(request, 128 * 1024));
  if (path === "/paintings/reorder" && method === "POST") return reorderPaintings(db, await readJson(request));
  let m = /^\/paintings\/([a-z0-9]+)$/.exec(path);
  if (m && method === "GET") return getPainting(db, m[1]);
  if (m && method === "PUT") return savePainting(db, m[1], await readJson(request, 128 * 1024));
  if (m && method === "DELETE") return deletePainting(db, m[1]);

  if (path === "/images" && method === "POST") {
    const form = await request.formData();
    return json({ image: await saveUploadedImage(db, form) });
  }
  m = /^\/images\/([a-z0-9]+)$/.exec(path);
  if (m && method === "PUT") {
    const body = await readJson(request);
    await db.prepare("UPDATE images SET alt = ? WHERE id = ?").bind(line(body.alt, 300), m[1]).run();
    return json({ ok: true });
  }
  if (m && method === "DELETE") {
    await deleteImages(db, [m[1]]);
    return json({ ok: true });
  }

  if (path === "/orders" && method === "GET") return listOrders(db, url);
  m = /^\/orders\/([a-z0-9]+)$/.exec(path);
  if (m && method === "GET") return getOrder(db, m[1]);
  if (m && method === "PUT") return updateOrder(db, m[1], await readJson(request));
  m = /^\/orders\/([a-z0-9]+)\/status$/.exec(path);
  if (m && method === "POST") return changeOrderStatus(db, m[1], await readJson(request));

  if (path === "/messages" && method === "GET") {
    const { results } = await db
      .prepare(
        `SELECT m.*, p.title AS painting_title, p.slug AS painting_slug FROM messages m
         LEFT JOIN paintings p ON p.id = m.painting_id ORDER BY m.created_at DESC LIMIT 300`,
      )
      .all();
    return json({ messages: results });
  }
  m = /^\/messages\/([a-z0-9]+)$/.exec(path);
  if (m && method === "PUT") {
    const body = await readJson(request);
    await db.prepare("UPDATE messages SET is_read = ? WHERE id = ?").bind(bool(body.is_read) ? 1 : 0, m[1]).run();
    return json({ ok: true });
  }
  if (m && method === "DELETE") {
    await db.prepare("DELETE FROM messages WHERE id = ?").bind(m[1]).run();
    return json({ ok: true });
  }

  if (path === "/settings" && method === "GET") return settingsResponse(db);
  if (path === "/settings" && method === "PUT") return updateSettings(db, await readJson(request, 256 * 1024));

  if (path === "/account" && method === "PUT") return updateAccount(request, db, await readJson(request));
  if (path === "/logout-all" && method === "POST") {
    await db.prepare("DELETE FROM sessions").run();
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  }
  if (path === "/export" && method === "GET") return exportData(db);

  throw new HttpError(404, "Not found.");
}

// ---------------------------------------------------------------------------
// Owner account

async function setup(request, env) {
  const db = env.DB;
  await rateLimit(db, `setup:${clientIp(request)}`, 10, 15 * 60_000);
  const existing = await db.prepare("SELECT id FROM owner WHERE id = 1").first();
  if (existing) throw new HttpError(409, "This store already has an owner. Please sign in.");
  if (!env.SETUP_KEY) throw new HttpError(503, "Add a SETUP_KEY secret to the Cloudflare project first (see the README).");

  const body = await readJson(request);
  if (!(await secretsMatch(String(body.setup_key || ""), env.SETUP_KEY))) throw new HttpError(403, "That setup key isn't right.");
  const name = line(body.name, 100);
  const ownerEmail = email(body.email);
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem);

  const now = Date.now();
  const hashed = await hashPassword(body.password);
  try {
    await db
      .prepare("INSERT INTO owner (id, name, email, pass_hash, pass_salt, pass_iter, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)")
      .bind(name, ownerEmail, hashed.pass_hash, hashed.pass_salt, hashed.pass_iter, now, now)
      .run();
  } catch {
    throw new HttpError(409, "This store already has an owner. Please sign in.");
  }

  // Fill in a couple of obvious settings the first time.
  const settings = await getSettings(db);
  const first = {};
  if (!settings.contact_email) first.contact_email = ownerEmail;
  if (!settings.artist_name && name) first.artist_name = name;
  if (Object.keys(first).length) await saveSettings(db, first);

  return json({ ok: true }, 200, { "Set-Cookie": await createSession(db, request) });
}

async function login(request, db) {
  const ip = clientIp(request);
  await rateLimit(db, `login:${ip}`, 10, 15 * 60_000);
  await rateLimit(db, "login:all", 200, 15 * 60_000);
  const body = await readJson(request);
  const owner = await db.prepare("SELECT * FROM owner WHERE id = 1").first();
  if (!owner) throw new HttpError(400, "This store hasn't been set up yet.");
  const given = String(body.email || "").trim().toLowerCase();
  const passwordOk = await verifyPassword(String(body.password || "").slice(0, 200), owner); // always run (even timing)
  if (!passwordOk || given !== owner.email) throw new HttpError(401, "That email or password is incorrect.");
  return json({ ok: true }, 200, { "Set-Cookie": await createSession(db, request) });
}

async function updateAccount(request, db, body) {
  await rateLimit(db, `account:${clientIp(request)}`, 10, 15 * 60_000);
  const owner = await db.prepare("SELECT * FROM owner WHERE id = 1").first();
  if (!(await verifyPassword(String(body.current_password || "").slice(0, 200), owner))) {
    throw new HttpError(403, "Your current password is incorrect.");
  }
  const name = line(body.name, 100);
  const ownerEmail = email(body.email);
  const now = Date.now();
  const statements = [db.prepare("UPDATE owner SET name = ?, email = ?, updated_at = ? WHERE id = 1").bind(name, ownerEmail, now)];
  const headers = {};
  if (body.new_password) {
    const problem = passwordProblem(body.new_password);
    if (problem) throw new HttpError(400, problem);
    const hashed = await hashPassword(body.new_password);
    statements.push(
      db.prepare("UPDATE owner SET pass_hash = ?, pass_salt = ?, pass_iter = ?, updated_at = ? WHERE id = 1").bind(hashed.pass_hash, hashed.pass_salt, hashed.pass_iter, now),
      db.prepare("DELETE FROM sessions"), // sign out every other device
    );
  }
  await db.batch(statements);
  if (body.new_password) headers["Set-Cookie"] = await createSession(db, request);
  return json({ ok: true, owner: { name, email: ownerEmail } }, 200, headers);
}

// ---------------------------------------------------------------------------
// Dashboard

async function dashboard(db) {
  const day = 86400_000;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [paintings, orders, revenue, messages, recent, settings] = await Promise.all([
    db
      .prepare(
        `SELECT
          SUM(status = 'published' AND quantity > 0) AS available,
          SUM(status = 'published' AND quantity = 0) AS sold,
          SUM(status = 'draft') AS drafts,
          COUNT(*) AS total
         FROM paintings`,
      )
      .first(),
    db
      .prepare(
        `SELECT SUM(status = 'awaiting_payment') AS awaiting, SUM(status = 'paid') AS to_ship, COUNT(*) AS total FROM orders`,
      )
      .first(),
    db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS all_time,
                COALESCE(SUM(CASE WHEN paid_at >= ? THEN total ELSE 0 END), 0) AS this_month
         FROM orders WHERE status IN ('paid', 'shipped', 'completed')`,
      )
      .bind(monthStart.getTime())
      .first(),
    db.prepare("SELECT SUM(is_read = 0) AS unread FROM messages").first(),
    db.prepare("SELECT id, number, name, total, currency, status, created_at FROM orders ORDER BY created_at DESC LIMIT 6").all(),
    getSettings(db),
  ]);

  // Tidy up photos that were uploaded but never saved with a painting.
  const keep = [settings.hero_image_id, settings.about_image_id].filter(Boolean);
  const { results: orphans } = await db
    .prepare(`SELECT id FROM images WHERE painting_id IS NULL AND created_at < ? ${keep.length ? `AND id NOT IN (${keep.map(() => "?").join(",")})` : ""} LIMIT 50`)
    .bind(Date.now() - day, ...keep)
    .all();
  if (orphans.length) await deleteImages(db, orphans.map((o) => o.id));

  const checklist = [
    { label: "Name your store", done: settings.store_name !== DEFAULT_SETTINGS.store_name, link: "#/settings" },
    { label: "Add your first painting", done: Number(paintings.total) > 0, link: "#/paintings/new" },
    { label: "Write your About page", done: settings.about_body !== DEFAULT_SETTINGS.about_body, link: "#/settings/about" },
    { label: "Add a contact email", done: Boolean(settings.contact_email), link: "#/settings" },
    { label: "Set shipping prices", done: settings.default_shipping > 0 || settings.free_shipping_over > 0, link: "#/settings/checkout" },
    { label: "Review your policies", done: settings.policy_returns !== DEFAULT_SETTINGS.policy_returns || settings.policy_terms !== DEFAULT_SETTINGS.policy_terms, link: "#/settings/policies" },
  ];

  return json({
    paintings: { available: Number(paintings.available || 0), sold: Number(paintings.sold || 0), drafts: Number(paintings.drafts || 0), total: Number(paintings.total || 0) },
    orders: { awaiting: Number(orders.awaiting || 0), to_ship: Number(orders.to_ship || 0), total: Number(orders.total || 0) },
    revenue: { all_time: revenue.all_time, this_month: revenue.this_month, currency: settings.currency },
    messages: { unread: Number(messages.unread || 0) },
    recent_orders: recent.results,
    checklist,
  });
}

// ---------------------------------------------------------------------------
// Paintings

async function listPaintings(db) {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.medium, p.price, p.quantity, p.status, p.featured, p.collection, p.sort_order, p.created_at, p.updated_at,
         (SELECT id FROM images WHERE painting_id = p.id ORDER BY position, created_at LIMIT 1) AS cover_image_id,
         (SELECT COUNT(*) FROM images WHERE painting_id = p.id) AS image_count
       FROM paintings p ORDER BY p.sort_order, p.created_at DESC`,
    )
    .all();
  const settings = await getSettings(db);
  return json({ paintings: results, currency: settings.currency });
}

async function getPainting(db, id) {
  const painting = await db.prepare("SELECT * FROM paintings WHERE id = ?").bind(id).first();
  if (!painting) throw new HttpError(404, "That painting doesn't exist.");
  const { results: images } = await db.prepare("SELECT id, width, height, alt, position FROM images WHERE painting_id = ? ORDER BY position, created_at").bind(id).all();
  const { results: collections } = await db.prepare("SELECT DISTINCT collection FROM paintings WHERE collection != '' ORDER BY collection").all();
  return json({ painting, images, collections: collections.map((c) => c.collection) });
}

async function uniqueSlug(db, wanted, exceptId) {
  const base = slugify(wanted);
  const { results } = await db
    .prepare("SELECT slug FROM paintings WHERE (slug = ? OR slug LIKE ?) AND id != ?")
    .bind(base, `${base}-%`, exceptId || "")
    .all();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${newId(6)}`;
}

async function savePainting(db, id, body) {
  const settings = await getSettings(db);
  const digits = currencyDigits(settings.currency);
  const existing = id ? await db.prepare("SELECT * FROM paintings WHERE id = ?").bind(id).first() : null;
  if (id && !existing) throw new HttpError(404, "That painting doesn't exist.");

  const title = line(body.title, 150);
  if (!title) throw new HttpError(400, "Please give the painting a title.");
  const year = body.year === "" || body.year == null ? null : clampInt(body.year, 1000, 2200, null);
  const data = {
    title,
    description: multiline(body.description, 8000),
    medium: line(body.medium, 120),
    width: optionalNumber(body.width, { max: 100000 }),
    height: optionalNumber(body.height, { max: 100000 }),
    depth: optionalNumber(body.depth, { max: 100000 }),
    unit: oneOf(body.unit, ["in", "cm"], "in"),
    year,
    price: moneyToMinor(body.price, digits),
    quantity: clampInt(body.quantity, 0, 9999, 1),
    shipping: moneyToMinor(body.shipping, digits, { allowEmpty: true }),
    shipping_intl: moneyToMinor(body.shipping_intl, digits, { allowEmpty: true }),
    framed: bool(body.framed) ? 1 : 0,
    collection: line(body.collection, 80),
    featured: bool(body.featured) ? 1 : 0,
    status: oneOf(body.status, PAINTING_STATUSES, "draft"),
  };
  const wantedSlug = line(body.slug, 100);
  data.slug = existing && (!wantedSlug || slugify(wantedSlug) === existing.slug) ? existing.slug : await uniqueSlug(db, wantedSlug || title, id);

  const imageIds = Array.isArray(body.images) ? body.images.filter(isId).slice(0, 12) : null;
  const now = Date.now();
  const paintingId = id || newId();
  const statements = [];

  if (existing) {
    const soldAt = data.quantity === 0 ? existing.sold_at || now : null;
    statements.push(
      db
        .prepare(
          `UPDATE paintings SET title=?, slug=?, description=?, medium=?, width=?, height=?, depth=?, unit=?, year=?, price=?, quantity=?,
             shipping=?, shipping_intl=?, framed=?, collection=?, featured=?, status=?, sold_at=?, updated_at=? WHERE id=?`,
        )
        .bind(data.title, data.slug, data.description, data.medium, data.width, data.height, data.depth, data.unit, data.year, data.price, data.quantity,
          data.shipping, data.shipping_intl, data.framed, data.collection, data.featured, data.status, soldAt, now, paintingId),
    );
  } else {
    const top = await db.prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS s FROM paintings").first();
    statements.push(
      db
        .prepare(
          `INSERT INTO paintings (id, slug, title, description, medium, width, height, depth, unit, year, price, quantity, shipping, shipping_intl,
             framed, collection, featured, status, sort_order, created_at, updated_at, sold_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(paintingId, data.slug, data.title, data.description, data.medium, data.width, data.height, data.depth, data.unit, data.year, data.price,
          data.quantity, data.shipping, data.shipping_intl, data.framed, data.collection, data.featured, data.status, top.s, now, now, data.quantity === 0 ? now : null),
    );
  }

  let removed = [];
  if (imageIds) {
    const { results: current } = await db.prepare("SELECT id FROM images WHERE painting_id = ?").bind(paintingId).all();
    removed = current.map((r) => r.id).filter((x) => !imageIds.includes(x));
    imageIds.forEach((imageId, position) => {
      statements.push(
        db.prepare("UPDATE images SET painting_id = ?, position = ? WHERE id = ? AND (painting_id IS NULL OR painting_id = ?)").bind(paintingId, position, imageId, paintingId),
      );
    });
  }

  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE/i.test(String(err?.message))) throw new HttpError(409, "Another painting already uses that web address. Try a different one.");
    throw err;
  }
  if (removed.length) await deleteImages(db, removed);
  return getPainting(db, paintingId);
}

async function deletePainting(db, id) {
  const { results } = await db.prepare("SELECT id FROM images WHERE painting_id = ?").bind(id).all();
  await db.prepare("DELETE FROM paintings WHERE id = ?").bind(id).run();
  await deleteImages(db, results.map((r) => r.id));
  return json({ ok: true });
}

async function reorderPaintings(db, body) {
  const ids = Array.isArray(body.ids) ? body.ids.filter(isId).slice(0, 2000) : [];
  if (!ids.length) return json({ ok: true });
  const statements = ids.map((id, i) => db.prepare("UPDATE paintings SET sort_order = ? WHERE id = ?").bind(i, id));
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Orders

async function listOrders(db, url) {
  const status = url.searchParams.get("status");
  const filter = status && ORDER_TRANSITIONS[status] ? "WHERE o.status = ?" : status === "open" ? "WHERE o.status IN ('awaiting_payment', 'paid', 'shipped')" : "";
  const stmt = db.prepare(
    `SELECT o.id, o.number, o.name, o.email, o.status, o.total, o.currency, o.created_at,
       (SELECT GROUP_CONCAT(title, ', ') FROM order_items WHERE order_id = o.id) AS items
     FROM orders o ${filter} ORDER BY o.created_at DESC LIMIT 500`,
  );
  const { results } = filter.includes("?") ? await stmt.bind(status).all() : await stmt.all();
  return json({ orders: results });
}

async function getOrder(db, id) {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order) throw new HttpError(404, "That order doesn't exist.");
  const { results: items } = await db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid").bind(id).all();
  order.shipping_address = JSON.parse(order.shipping_address);
  order.billing_address = JSON.parse(order.billing_address);
  delete order.ip;
  return json({ order, items, transitions: ORDER_TRANSITIONS[order.status] || [] });
}

async function updateOrder(db, id, body) {
  await db
    .prepare("UPDATE orders SET owner_note = ?, tracking = ?, updated_at = ? WHERE id = ?")
    .bind(multiline(body.owner_note, 4000), line(body.tracking, 200), Date.now(), id)
    .run();
  return getOrder(db, id);
}

async function changeOrderStatus(db, id, body) {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order) throw new HttpError(404, "That order doesn't exist.");
  const next = String(body.status || "");
  if (!(ORDER_TRANSITIONS[order.status] || []).includes(next)) {
    throw new HttpError(400, `An order that is "${order.status.replace("_", " ")}" can't be marked "${next.replace("_", " ")}".`);
  }
  const now = Date.now();
  const fields = { status: next, updated_at: now };
  if (next === "paid") {
    fields.paid_at = now;
    if (!order.payment_provider) fields.payment_provider = "manual";
    if (body.payment_ref) fields.payment_ref = line(body.payment_ref, 200);
  }
  if (next === "shipped") {
    fields.shipped_at = now;
    if (body.tracking) fields.tracking = line(body.tracking, 200);
  }
  if (next === "cancelled" || next === "refunded" || next === "completed") fields.closed_at = now;

  const restock = (next === "cancelled" || next === "refunded") && bool(body.restock) && !order.stock_released;
  if (restock) fields.stock_released = 1;

  const keys = Object.keys(fields);
  const statements = [
    db
      .prepare(`UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND status = ?`)
      .bind(...keys.map((k) => fields[k]), id, order.status),
  ];
  if (restock) {
    const { results: items } = await db.prepare("SELECT painting_id, quantity FROM order_items WHERE order_id = ?").bind(id).all();
    for (const it of items) {
      statements.push(
        db.prepare("UPDATE paintings SET quantity = quantity + ?, sold_at = NULL, updated_at = ? WHERE id = ?").bind(it.quantity, now, it.painting_id),
      );
    }
  }
  await db.batch(statements);
  return getOrder(db, id);
}

// ---------------------------------------------------------------------------
// Settings

const SOCIAL_KEYS = ["social_instagram", "social_facebook", "social_tiktok", "social_pinterest", "social_youtube", "social_x"];
const MONEY_KEYS = ["default_shipping", "default_shipping_intl", "free_shipping_over"];

async function settingsResponse(db) {
  const settings = await getSettings(db);
  const digits = currencyDigits(settings.currency);
  const owner = await db.prepare("SELECT name, email FROM owner WHERE id = 1").first();
  return json({
    settings,
    digits,
    owner,
    font_themes: Object.fromEntries(Object.entries(FONT_THEMES).map(([k, v]) => [k, v.label])),
  });
}

async function updateSettings(db, body) {
  const current = await getSettings(db);
  const changes = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  // Currency first, so money amounts below use the right number of decimals.
  if (has("currency")) {
    const c = String(body.currency || "").toUpperCase();
    if (!isCurrency(c)) throw new HttpError(400, "Please choose a valid currency code, like USD or EUR.");
    changes.currency = c;
  }
  const digits = currencyDigits(changes.currency || current.currency);

  const lines = {
    store_name: 80, tagline: 160, artist_name: 100, location: 120, announcement: 200,
    hero_title: 160, about_title: 120, tax_label: 40, seo_description: 300,
  };
  const texts = {
    hero_text: 600, about_body: 12000, highlights: 1000, checkout_note: 800,
    policy_shipping: 20000, policy_returns: 20000, policy_privacy: 20000, policy_terms: 20000,
  };
  for (const [k, max] of Object.entries(lines)) if (has(k)) changes[k] = line(body[k], max);
  for (const [k, max] of Object.entries(texts)) if (has(k)) changes[k] = multiline(body[k], max);
  if (has("store_name") && !changes.store_name) throw new HttpError(400, "Your store needs a name.");
  if (has("contact_email")) changes.contact_email = email(body.contact_email, { optional: true });

  for (const k of SOCIAL_KEYS) {
    if (!has(k)) continue;
    const v = line(body[k], 300);
    if (v && !/^https:\/\/[^\s]+\.[^\s]+$/.test(v)) throw new HttpError(400, "Social links must be full web addresses starting with https://");
    changes[k] = v;
  }
  for (const k of ["hero_image_id", "about_image_id"]) {
    if (!has(k)) continue;
    const v = String(body[k] || "");
    if (v && !isId(v)) throw new HttpError(400, "That image couldn't be found.");
    changes[k] = v;
  }
  for (const k of MONEY_KEYS) if (has(k)) changes[k] = moneyToMinor(body[k] === "" ? 0 : body[k], digits);
  for (const k of ["ship_international", "tax_home_only"]) if (has(k)) changes[k] = bool(body[k]);

  if (has("checkout_mode")) changes.checkout_mode = oneOf(body.checkout_mode, ["requests", "closed"], current.checkout_mode);
  if (has("home_country")) {
    const c = String(body.home_country || "").toUpperCase();
    if (!isCountry(c)) throw new HttpError(400, "Please choose the country you ship from.");
    changes.home_country = c;
  }
  if (has("tax_percent")) {
    const t = optionalNumber(body.tax_percent === "" ? 0 : body.tax_percent, { min: 0, max: 50 });
    changes.tax_percent = Math.round((t || 0) * 1000) / 1000;
  }
  if (has("accent")) {
    const a = String(body.accent || "");
    if (!/^#[0-9a-f]{6}$/i.test(a)) throw new HttpError(400, "Please pick an accent colour.");
    changes.accent = a.toLowerCase();
  }
  if (has("font_theme")) changes.font_theme = oneOf(body.font_theme, Object.keys(FONT_THEMES), current.font_theme);

  await saveSettings(db, changes);
  clearSettingsCache();
  return settingsResponse(db);
}

// ---------------------------------------------------------------------------

async function exportData(db) {
  const [settings, paintings, images, orders, items, messages] = await Promise.all([
    getSettings(db),
    db.prepare("SELECT * FROM paintings ORDER BY sort_order").all(),
    db.prepare("SELECT id, painting_id, position, width, height, alt, created_at FROM images").all(),
    db.prepare("SELECT * FROM orders ORDER BY created_at").all(),
    db.prepare("SELECT * FROM order_items").all(),
    db.prepare("SELECT * FROM messages ORDER BY created_at").all(),
  ]);
  const data = {
    exported_at: new Date().toISOString(),
    settings,
    paintings: paintings.results,
    images: images.results,
    orders: orders.results.map((o) => ({ ...o, shipping_address: JSON.parse(o.shipping_address), billing_address: JSON.parse(o.billing_address) })),
    order_items: items.results,
    messages: messages.results,
  };
  return json(data, 200, { "Content-Disposition": `attachment; filename="store-export-${new Date().toISOString().slice(0, 10)}.json"` });
}
