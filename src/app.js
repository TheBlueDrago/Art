// The whole server: one request handler for pages, the API and images.
// Runs as a Cloudflare Pages Function (functions/[[path]].js).

import { ensureSchema, getSettings } from "./lib/db.js";
import { HttpError, clientIp, html, json, readJson, redirect, securityHeaders, text } from "./lib/http.js";
import { rateLimit, secretsMatch } from "./lib/auth.js";
import { serveImage } from "./lib/images.js";
import { computeQuote, normalizeCart } from "./lib/pricing.js";
import { getImages, getPublishedBySlug, listCollections, listForHome, listPublished, loadPaintings, moreWorks, SHOP_SORTS } from "./lib/store.js";
import { address, bool, email, isId, line, multiline } from "./lib/validate.js";
import { newId } from "./lib/util.js";
import { getPaymentProvider } from "./payments/index.js";
import { handleAdminApi } from "./routes/admin.js";
import { adminShell } from "./views/admin.js";
import {
  LEGAL_PAGES,
  aboutPage,
  cartPage,
  checkoutPage,
  contactPage,
  errorPage,
  homePage,
  legalPage,
  notFoundPage,
  orderPage,
  paintingPage,
  shopPage,
} from "./views/pages.js";

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith("/api/");
  try {
    if (!env.DB) throw new Error("The D1 database binding 'DB' is missing. See README → Setup.");
    await ensureSchema(env.DB);
    const response = (await route(request, env, ctx, url)) || (await notFound(env, url, isApi));
    return finalize(response, request);
  } catch (err) {
    if (err instanceof HttpError) {
      const headers = err.extra?.retryAfter ? { "Retry-After": String(err.extra.retryAfter) } : {};
      if (isApi) return finalize(json({ error: err.message }, err.status, headers), request);
      if (err.status === 404) return finalize(await notFound(env, url, false), request);
      return finalize(html(errorPage(), err.status, headers), request);
    }
    console.error("Unhandled error", url.pathname, err?.stack || err);
    return finalize(isApi ? json({ error: "Something went wrong. Please try again." }, 500) : html(errorPage(), 500), request);
  }
}

function finalize(response, request) {
  const res = new Response(response.body, response);
  if (res.headers.has("Content-Security-Policy")) {
    // Images set their own strict policy; only add the generic headers.
    res.headers.set("X-Content-Type-Options", "nosniff");
  } else {
    securityHeaders(res.headers, request);
  }
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-cache");
  return res;
}

async function notFound(env, url, isApi) {
  if (isApi) return json({ error: "Not found." }, 404);
  const settings = await getSettings(env.DB);
  return html(notFoundPage({ settings, origin: url.origin }), 404);
}

async function route(request, env, ctx, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method === "HEAD" ? "GET" : request.method;

  // ---- API -----------------------------------------------------------------
  if (path.startsWith("/api/admin")) return handleAdminApi(request, env, ctx, url);
  if (path === "/api/cart/quote" && method === "POST") return quoteCart(request, db);
  if (path === "/api/orders" && method === "POST") return createOrder(request, env, url);
  if (path === "/api/messages" && method === "POST") return createMessage(request, db);
  if (path.startsWith("/api/")) return null;

  // ---- images --------------------------------------------------------------
  const img = /^\/img\/([a-z0-9]+)\/(full|thumb)$/.exec(path);
  if (img && method === "GET") return serveImage(db, request, img[1], img[2], ctx);

  if (method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

  // ---- admin (the page itself; all data goes through /api/admin) ----------
  if (path === "/admin" || path.startsWith("/admin/")) {
    return html(adminShell(), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  }

  // ---- public pages -----------------------------------------------------------
  if (path === "/robots.txt") return robots(url);
  if (path === "/sitemap.xml") return sitemap(db, url);
  if (path === "/favicon.ico") return redirect("/assets/favicon.svg", 301);

  const settings = await getSettings(db);
  const origin = url.origin;

  if (path === "/") {
    const [featured, collections] = await Promise.all([listForHome(db, 6), listCollections(db)]);
    const hero = featured.find((p) => p.quantity > 0 && p.cover_image_id) || featured.find((p) => p.cover_image_id) || null;
    return html(homePage({ settings, featured, hero, collections, origin }));
  }

  if (path === "/shop") {
    const filters = {
      collection: line(url.searchParams.get("collection"), 80),
      show: url.searchParams.get("show") === "available" ? "available" : "all",
      sort: SHOP_SORTS[url.searchParams.get("sort")] ? url.searchParams.get("sort") : "featured",
    };
    const [paintings, collections] = await Promise.all([
      listPublished(db, { collection: filters.collection, availableOnly: filters.show === "available", sort: filters.sort }),
      listCollections(db),
    ]);
    return html(shopPage({ settings, paintings, collections, filters, origin }));
  }

  const art = /^\/art\/([a-z0-9-]{1,100})$/.exec(path);
  if (art) {
    const painting = await getPublishedBySlug(db, art[1]);
    if (!painting) return null;
    const [images, more] = await Promise.all([getImages(db, painting.id), moreWorks(db, painting, 4)]);
    return html(paintingPage({ settings, painting, images, more, origin }));
  }

  if (path === "/about") return html(aboutPage({ settings, origin }));
  if (path === "/contact") {
    const slug = url.searchParams.get("art");
    const painting = slug && /^[a-z0-9-]{1,100}$/.test(slug) ? await getPublishedBySlug(db, slug) : null;
    return html(contactPage({ settings, painting, origin }));
  }
  if (path === "/cart") return html(cartPage({ settings, origin }), 200, { "Cache-Control": "no-store" });
  if (path === "/checkout") return html(checkoutPage({ settings, origin }), 200, { "Cache-Control": "no-store" });

  const legal = /^\/legal\/([a-z]+)$/.exec(path);
  if (legal && LEGAL_PAGES[legal[1]]) return html(legalPage({ settings, kind: legal[1], origin }));

  const order = /^\/order\/([a-z0-9]{6,40})$/.exec(path);
  if (order) return viewOrder(db, settings, order[1], url);

  return null;
}

// ---------------------------------------------------------------------------
// Cart, orders and messages

async function quoteCart(request, db) {
  const body = await readJson(request);
  const cart = normalizeCart(body.items);
  const settings = await getSettings(db);
  const country = typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country) ? body.country : "";
  const paintings = await loadPaintings(db, cart.map((i) => i.id));
  return json({ quote: computeQuote(cart, paintings, settings, country), checkout_mode: settings.checkout_mode });
}

async function createOrder(request, env, url) {
  const db = env.DB;
  const settings = await getSettings(db);
  if (settings.checkout_mode === "closed") throw new HttpError(403, "Online checkout is closed right now. Please get in touch to buy a painting.");

  const body = await readJson(request);
  if (body.website) throw new HttpError(400, "Your order could not be placed.");

  const ip = clientIp(request);
  await rateLimit(db, `order:${ip}`, 6, 60 * 60_000);
  await rateLimit(db, "order:all", 300, 24 * 60 * 60_000);

  const cart = normalizeCart(body.items);
  if (!cart.length) throw new HttpError(400, "Your cart is empty.");
  const customerEmail = email(body.email);
  const phone = line(body.phone, 40);
  const shipping = address(body.shipping, "shipping");
  const billing = bool(body.billing_same) ? { ...shipping } : address(body.billing, "billing");
  const note = multiline(body.note, 1000);
  if (!bool(body.agree)) throw new HttpError(400, "Please accept the terms of sale to place your order.");

  const quoteFor = async () => computeQuote(cart, await loadPaintings(db, cart.map((i) => i.id)), settings, shipping.country);
  const quote = await quoteFor();
  if (quote.problems.length || !quote.lines.length) {
    return json({ error: quote.problems[0]?.message || "Your cart is empty.", code: "cart_changed", quote }, 409);
  }
  // If the customer was looking at a different total (a price changed while
  // they were checking out), show them the new one before taking the order.
  if (body.expected_total !== undefined && Number(body.expected_total) !== quote.total) {
    return json({ error: "Prices were updated while you were checking out. Please review your order.", code: "cart_changed", quote }, 409);
  }

  const id = newId();
  const viewKey = newId(24);
  const now = Date.now();
  const statements = [
    db
      .prepare(
        `INSERT INTO orders (id, number, view_key, status, email, name, phone, shipping_address, billing_address, note,
           currency, subtotal, shipping, tax, total, ip, created_at, updated_at)
         VALUES (?, (SELECT COALESCE(MAX(number), 1000) + 1 FROM orders), ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, viewKey, customerEmail, shipping.name, phone, JSON.stringify(shipping), JSON.stringify(billing), note,
        quote.currency, quote.subtotal, quote.shipping, quote.tax, quote.total, ip, now, now),
    // The title is copied from the painting only if it is still published at
    // the same price — otherwise it is NULL, the insert fails and the whole
    // order is rolled back.
    ...quote.lines.map((l) =>
      db
        .prepare(
          `INSERT INTO order_items (order_id, painting_id, title, slug, unit_price, quantity, shipping, image_id)
           VALUES (?1, ?2, (SELECT title FROM paintings WHERE id = ?2 AND status = 'published' AND price = ?3), ?4, ?3, ?5, ?6, ?7)`,
        )
        .bind(id, l.id, l.unit_price, l.slug, l.quantity, l.shipping, l.image_id),
    ),
    // Hold the paintings. quantity has CHECK (quantity >= 0), so two people
    // buying the last one at the same moment can't both succeed.
    ...quote.lines.map((l) =>
      db
        .prepare(
          `UPDATE paintings SET quantity = quantity - ?1,
             sold_at = CASE WHEN quantity - ?1 = 0 THEN ?2 ELSE sold_at END, updated_at = ?2
           WHERE id = ?3`,
        )
        .bind(l.quantity, now, l.id),
    ),
  ];

  try {
    await db.batch(statements);
  } catch (err) {
    if (/constraint|NOT NULL|CHECK/i.test(String(err?.message || err))) {
      const fresh = await quoteFor();
      return json({ error: fresh.problems[0]?.message || "Something in your cart just changed. Please review your order.", code: "cart_changed", quote: fresh }, 409);
    }
    throw err;
  }

  const result = { ok: true, order_id: id, redirect: `/order/${id}?key=${viewKey}&placed=1` };
  const provider = getPaymentProvider(env);
  if (provider) {
    const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
    const started = await provider.startPayment(order, quote.lines, env, url.origin);
    if (started?.redirectUrl) result.redirect = started.redirectUrl;
  }
  return json(result);
}

async function viewOrder(db, settings, id, url) {
  const key = url.searchParams.get("key") || "";
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!order || !(await secretsMatch(key, order.view_key))) return null;
  const { results: items } = await db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid").bind(id).all();
  return html(orderPage({ settings, order, items, justPlaced: url.searchParams.get("placed") === "1", origin: url.origin }), 200, {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  });
}

async function createMessage(request, db) {
  const body = await readJson(request, 32 * 1024);
  // Bots fill the hidden "website" field. Pretend it worked.
  if (body.website) return json({ ok: true });
  const ip = clientIp(request);
  await rateLimit(db, `msg:${ip}`, 5, 10 * 60_000);
  await rateLimit(db, "msg:all", 200, 24 * 60 * 60_000);

  const name = line(body.name, 120);
  const from = email(body.email);
  const subject = line(body.subject, 150);
  const message = multiline(body.body, 4000);
  const paintingId = isId(body.painting_id) ? body.painting_id : "";
  if (!name) throw new HttpError(400, "Please tell us your name.");
  if (message.length < 2) throw new HttpError(400, "Please write a message.");

  await db
    .prepare("INSERT INTO messages (id, name, email, subject, body, painting_id, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), name, from, subject, message, paintingId, ip, Date.now())
    .run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------

function robots(url) {
  return text(
    ["User-agent: *", "Disallow: /admin", "Disallow: /api/", "Disallow: /cart", "Disallow: /checkout", "Disallow: /order/", "", `Sitemap: ${url.origin}/sitemap.xml`, ""].join("\n"),
  );
}

async function sitemap(db, url) {
  const { results } = await db.prepare("SELECT slug, updated_at FROM paintings WHERE status = 'published' ORDER BY sort_order").all();
  const pages = ["/", "/shop", "/about", "/contact", ...Object.keys(LEGAL_PAGES).map((k) => `/legal/${k}`)];
  const entries = [
    ...pages.map((p) => `<url><loc>${url.origin}${p}</loc></url>`),
    ...results.map((r) => `<url><loc>${url.origin}/art/${r.slug}</loc><lastmod>${new Date(r.updated_at).toISOString().slice(0, 10)}</lastmod></url>`),
  ];
  return text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>`, 200, "application/xml; charset=utf-8");
}
