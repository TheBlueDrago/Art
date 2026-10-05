// Public pages. Every value from the database is escaped with esc() or
// formatted with richText(), which escapes first.

import { currencyDigits, esc, excerpt, formatDate, formatMoney, formatSize, richText } from "../lib/util.js";
import { COUNTRY_CODES, countryName } from "../lib/countries.js";
import { artCard, page, picture, socialLinks } from "./layout.js";

export const LEGAL_PAGES = {
  shipping: { key: "policy_shipping", title: "Shipping" },
  returns: { key: "policy_returns", title: "Returns & refunds" },
  privacy: { key: "policy_privacy", title: "Privacy policy" },
  terms: { key: "policy_terms", title: "Terms of sale" },
};

export const ORDER_STATUS = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function highlights(settings) {
  return String(settings.highlights || "")
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter(([title]) => title)
    .slice(0, 4);
}

// ---------------------------------------------------------------------------

export function homePage({ settings, featured, hero, collections, origin }) {
  const s = settings;
  const heroImageId = s.hero_image_id || hero?.cover_image_id || "";
  const heroCaption = !s.hero_image_id && hero ? hero : null;
  const items = highlights(s);

  const heroArt = heroImageId
    ? `<figure class="hero-art">
        ${heroCaption ? `<a href="/art/${esc(heroCaption.slug)}" class="hero-frame">` : '<div class="hero-frame">'}
          ${picture(heroImageId, heroCaption ? heroCaption.title : s.store_name, { eager: true, sizes: "(max-width: 900px) 90vw, 45vw", width: heroCaption?.cover_width, height: heroCaption?.cover_height })}
        ${heroCaption ? "</a>" : "</div>"}
        ${heroCaption ? `<figcaption><a href="/art/${esc(heroCaption.slug)}"><em>${esc(heroCaption.title)}</em></a>${heroCaption.medium ? `, ${esc(heroCaption.medium)}` : ""}</figcaption>` : ""}
      </figure>`
    : `<figure class="hero-art"><div class="hero-frame"><div class="canvas-placeholder" aria-hidden="true"></div></div></figure>`;

  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">${esc(s.artist_name ? `Paintings by ${s.artist_name}` : "Original paintings")}</p>
      <h1 class="display">${esc(s.hero_title)}</h1>
      ${s.hero_text ? `<p class="lead">${esc(s.hero_text)}</p>` : ""}
      <div class="btn-row">
        <a class="btn btn-primary" href="/shop">Explore the collection</a>
        <a class="btn btn-ghost" href="/about">${esc(s.about_title || "About")}</a>
      </div>
    </div>
    ${heroArt}
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2 class="section-title">${featured.some((p) => p.featured) ? "Selected works" : "Latest works"}</h2>
      ${featured.length ? '<a class="link-arrow" href="/shop">View all work</a>' : ""}
    </div>
    ${
      featured.length
        ? `<div class="art-grid">${featured.map((p) => artCard(p, s)).join("")}</div>`
        : `<div class="empty-state"><p class="display-sm">New work is on its way.</p><p class="muted">The first paintings will appear here soon.${s.contact_email ? ` To hear when they're ready, write to <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>.` : ""}</p></div>`
    }
  </div>
</section>

${
  collections.length > 1
    ? `<section class="section section-tight">
  <div class="wrap">
    <h2 class="section-title">Browse by collection</h2>
    <div class="chip-row">${collections.map((c) => `<a class="chip" href="/shop?collection=${encodeURIComponent(c)}">${esc(c)}</a>`).join("")}</div>
  </div>
</section>`
    : ""
}

${
  items.length
    ? `<section class="section highlights">
  <div class="wrap highlight-grid">
    ${items.map(([title, text]) => `<div class="highlight"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}</div>`).join("")}
  </div>
</section>`
    : ""
}

<section class="section">
  <div class="wrap about-teaser ${s.about_image_id ? "" : "no-image"}">
    ${s.about_image_id ? `<div class="about-photo">${picture(s.about_image_id, s.artist_name || s.store_name, { sizes: "(max-width: 900px) 90vw, 40vw" })}</div>` : ""}
    <div>
      <p class="eyebrow">The artist</p>
      <h2 class="display-sm">${esc(s.about_title)}</h2>
      <p class="lead">${esc(excerpt(s.about_body, 320))}</p>
      <a class="link-arrow" href="/about">Read the story</a>
    </div>
  </div>
</section>`;

  return page({
    settings: s,
    title: "",
    path: "/",
    origin,
    body,
    image: heroImageId ? `/img/${heroImageId}/full` : "",
    bodyClass: "page-home",
    jsonLd: { "@context": "https://schema.org", "@type": "Store", name: s.store_name, description: s.seo_description || s.tagline, url: origin + "/" },
  });
}

// ---------------------------------------------------------------------------

export function shopPage({ settings, paintings, collections, filters, origin }) {
  const s = settings;
  const q = (extra) => {
    const params = new URLSearchParams();
    const merged = { ...filters, ...extra };
    if (merged.collection) params.set("collection", merged.collection);
    if (merged.show === "available") params.set("show", "available");
    if (merged.sort && merged.sort !== "featured") params.set("sort", merged.sort);
    const str = params.toString();
    return "/shop" + (str ? "?" + str : "");
  };
  const available = paintings.filter((p) => p.quantity > 0).length;
  const heading = filters.collection || "The collection";

  const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">Shop</p>
    <h1 class="display">${esc(heading)}</h1>
    <p class="muted">${paintings.length} ${paintings.length === 1 ? "work" : "works"}${available !== paintings.length ? ` · ${available} available` : ""}</p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap">
    <form class="filter-bar" method="get" action="/shop" data-auto-submit>
      <div class="chip-row" role="list">
        <a role="listitem" class="chip ${!filters.collection ? "is-active" : ""}" href="${esc(q({ collection: "" }))}">All</a>
        ${collections.map((c) => `<a role="listitem" class="chip ${filters.collection === c ? "is-active" : ""}" href="${esc(q({ collection: c }))}">${esc(c)}</a>`).join("")}
      </div>
      <div class="filter-controls">
        ${filters.collection ? `<input type="hidden" name="collection" value="${esc(filters.collection)}">` : ""}
        <label class="check"><input type="checkbox" name="show" value="available" ${filters.show === "available" ? "checked" : ""}> Available only</label>
        <label class="select-label"><span class="visually-hidden">Sort</span>
          <select name="sort">
            ${[
              ["featured", "Featured"],
              ["newest", "Newest"],
              ["price-asc", "Price: low to high"],
              ["price-desc", "Price: high to low"],
            ]
              .map(([v, l]) => `<option value="${v}" ${filters.sort === v ? "selected" : ""}>${l}</option>`)
              .join("")}
          </select>
        </label>
        <noscript><button class="btn btn-small" type="submit">Apply</button></noscript>
      </div>
    </form>
    ${
      paintings.length
        ? `<div class="art-grid">${paintings.map((p, i) => artCard(p, s, { eager: i < 3 })).join("")}</div>`
        : `<div class="empty-state"><p class="display-sm">Nothing here just yet.</p><p class="muted">${filters.show === "available" || filters.collection ? `<a href="/shop">See all work</a>` : "New paintings are coming soon."}</p></div>`
    }
  </div>
</section>`;

  return page({ settings: s, title: filters.collection || "Shop", path: q({}), origin, body, bodyClass: "page-shop", description: `Original paintings for sale from ${s.store_name}.` });
}

// ---------------------------------------------------------------------------

export function paintingPage({ settings, painting: p, images, more, origin }) {
  const s = settings;
  const sold = p.quantity <= 0;
  const size = formatSize(p);
  const main = images[0];
  const specs = [
    ["Medium", p.medium],
    ["Size", size],
    ["Year", p.year],
    ["Framing", p.framed ? "Framed, ready to hang" : ""],
    ["Edition", p.quantity > 1 ? `${p.quantity} available` : ""],
    ["Ships from", s.location],
  ].filter(([, v]) => v);

  const gallery = images.length
    ? `<div class="gallery" data-gallery>
        <button type="button" class="gallery-main" data-zoom aria-label="View larger image">
          <img src="/img/${esc(main.id)}/full" alt="${esc(main.alt || p.title)}" ${main.width ? `width="${main.width}" height="${main.height}"` : ""} fetchpriority="high" decoding="async">
        </button>
        ${
          images.length > 1
            ? `<div class="gallery-thumbs">${images
                .map(
                  (img, i) =>
                    `<button type="button" class="gallery-thumb ${i === 0 ? "is-active" : ""}" data-full="/img/${esc(img.id)}/full" data-alt="${esc(img.alt || p.title)}" ${img.width ? `data-w="${img.width}" data-h="${img.height}"` : ""} aria-label="Show image ${i + 1}"><img src="/img/${esc(img.id)}/thumb" alt="" loading="lazy"></button>`,
                )
                .join("")}</div>`
            : ""
        }
      </div>`
    : `<div class="gallery"><div class="gallery-main"><div class="img-missing" role="img" aria-label="${esc(p.title)}"></div></div></div>`;

  let buy;
  if (sold) {
    buy = `<p class="detail-price"><span class="tag tag-sold">Sold</span></p>
      <p class="muted">This painting has found its home. Interested in something similar, or a commission?</p>
      <div class="btn-row"><a class="btn btn-primary" href="/contact?art=${esc(p.slug)}">Ask about similar work</a></div>`;
  } else if (s.checkout_mode === "closed") {
    buy = `<p class="detail-price">${esc(formatMoney(p.price, s.currency))}</p>
      <div class="btn-row"><a class="btn btn-primary" href="/contact?art=${esc(p.slug)}">Enquire to buy</a></div>`;
  } else {
    buy = `<p class="detail-price">${esc(formatMoney(p.price, s.currency))}</p>
      <p class="stock-note">${p.quantity === 1 ? "Original — one of a kind" : p.quantity <= 3 ? `Only ${p.quantity} left` : "In stock"}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-wide" data-add-to-cart data-id="${esc(p.id)}" data-max="${p.quantity}">Add to cart</button>
        <a class="btn btn-ghost btn-wide" href="/contact?art=${esc(p.slug)}">Ask a question</a>
      </div>`;
  }

  const body = `
<div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/shop">Shop</a>${p.collection ? ` <span aria-hidden="true">/</span> <a href="/shop?collection=${encodeURIComponent(p.collection)}">${esc(p.collection)}</a>` : ""}</nav>
  <div class="detail-grid">
    ${gallery}
    <div class="detail-info">
      ${p.collection ? `<p class="eyebrow">${esc(p.collection)}</p>` : ""}
      <h1 class="display">${esc(p.title)}</h1>
      ${s.artist_name || p.year ? `<p class="byline">${esc([s.artist_name, p.year].filter(Boolean).join(", "))}</p>` : ""}
      ${buy}
      ${specs.length ? `<dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
      ${p.description ? `<div class="prose">${richText(p.description)}</div>` : ""}
      <details class="fold">
        <summary>Shipping &amp; returns</summary>
        <div class="prose small">
          <p>${esc(excerpt(s.policy_shipping, 220))}</p>
          <p><a href="/legal/shipping">Shipping details</a> · <a href="/legal/returns">Returns policy</a></p>
        </div>
      </details>
    </div>
  </div>
</div>
${
  more.length
    ? `<section class="section">
  <div class="wrap">
    <div class="section-head"><h2 class="section-title">More work</h2><a class="link-arrow" href="/shop">View all</a></div>
    <div class="art-grid art-grid-4">${more.map((m) => artCard(m, s)).join("")}</div>
  </div>
</section>`
    : ""
}`;

  return page({
    settings: s,
    title: p.title,
    description: excerpt(p.description, 160) || [p.medium, size].filter(Boolean).join(", "),
    path: `/art/${p.slug}`,
    origin,
    body,
    image: main ? `/img/${main.id}/full` : "",
    ogType: "product",
    bodyClass: "page-art",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.title,
      description: excerpt(p.description, 300),
      image: images.map((i) => `${origin}/img/${i.id}/full`),
      sku: p.id,
      brand: s.artist_name || s.store_name,
      offers: {
        "@type": "Offer",
        url: `${origin}/art/${p.slug}`,
        priceCurrency: s.currency,
        price: (p.price / 10 ** currencyDigits(s.currency)).toFixed(currencyDigits(s.currency)),
        availability: sold ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
      },
    },
  });
}

// ---------------------------------------------------------------------------

export function aboutPage({ settings, origin }) {
  const s = settings;
  const body = `
<section class="page-head">
  <div class="wrap"><p class="eyebrow">About</p><h1 class="display">${esc(s.about_title)}</h1></div>
</section>
<section class="section section-tight">
  <div class="wrap about-page ${s.about_image_id ? "" : "no-image"}">
    ${s.about_image_id ? `<div class="about-photo">${picture(s.about_image_id, s.artist_name || s.store_name, { eager: true, sizes: "(max-width: 900px) 90vw, 40vw" })}</div>` : ""}
    <div class="prose prose-lg">${richText(s.about_body)}
      <p class="btn-row"><a class="btn btn-primary" href="/shop">See the work</a><a class="btn btn-ghost" href="/contact">Get in touch</a></p>
    </div>
  </div>
</section>`;
  return page({ settings: s, title: s.about_title, path: "/about", origin, body, image: s.about_image_id ? `/img/${s.about_image_id}/full` : "", description: excerpt(s.about_body, 160) });
}

// ---------------------------------------------------------------------------

export function contactPage({ settings, painting, origin }) {
  const s = settings;
  const socials = socialLinks(s);
  const subject = painting ? `About “${painting.title}”` : "";
  const body = `
<section class="page-head">
  <div class="wrap"><p class="eyebrow">Contact</p><h1 class="display">Get in touch</h1></div>
</section>
<section class="section section-tight">
  <div class="wrap contact-grid">
    <div class="contact-info">
      <p class="lead">Questions about a painting, shipping, framing or a commission? Send a message and you'll get a personal reply, usually within a day or two.</p>
      ${s.contact_email ? `<p><span class="muted">Email</span><br><a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></p>` : ""}
      ${s.location ? `<p><span class="muted">Studio</span><br>${esc(s.location)}</p>` : ""}
      ${socials.length ? `<p><span class="muted">Follow</span><br>${socials.map((l) => `<a href="${esc(l.href)}" rel="noopener" target="_blank">${esc(l.label)}</a>`).join(" · ")}</p>` : ""}
    </div>
    <form class="card form" data-contact-form novalidate>
      ${painting ? `<div class="contact-art">${picture(painting.cover_image_id, painting.title, { sizes: "80px" })}<div><span class="muted small">Asking about</span><br><strong>${esc(painting.title)}</strong></div></div><input type="hidden" name="painting_id" value="${esc(painting.id)}">` : ""}
      <div class="field-row">
        <label class="field"><span>Your name</span><input name="name" autocomplete="name" required maxlength="120"></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="254"></label>
      </div>
      <label class="field"><span>Subject</span><input name="subject" maxlength="150" value="${esc(subject)}"></label>
      <label class="field"><span>Message</span><textarea name="body" rows="6" required maxlength="4000"></textarea></label>
      <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit">Send message</button>
      <div class="form-success" hidden><p class="display-sm">Thank you.</p><p>Your message is on its way. You'll hear back soon.</p></div>
    </form>
  </div>
</section>`;
  return page({ settings: s, title: "Contact", path: "/contact", origin, body, description: `Contact ${s.store_name}.` });
}

// ---------------------------------------------------------------------------

export function cartPage({ settings, origin }) {
  const s = settings;
  const body = `
<section class="page-head page-head-small"><div class="wrap"><h1 class="display">Your cart</h1></div></section>
<section class="section section-tight">
  <div class="wrap" data-cart-page data-checkout-mode="${esc(s.checkout_mode)}">
    <p class="muted loading">Loading your cart…</p>
  </div>
</section>`;
  return page({ settings: s, title: "Cart", path: "/cart", origin, body, noindex: true, bodyClass: "page-cart" });
}

// ---------------------------------------------------------------------------

function countryOptions(selected, home) {
  const names = COUNTRY_CODES.map((code) => [code, countryName(code)]).sort((a, b) => a[1].localeCompare(b[1]));
  const homeEntry = names.find(([c]) => c === home);
  const list = homeEntry ? [homeEntry, ...names.filter(([c]) => c !== home)] : names;
  return list.map(([code, name]) => `<option value="${code}" ${code === selected ? "selected" : ""}>${esc(name)}</option>`).join("");
}

function addressFields(prefix, settings) {
  return `
  <label class="field"><span>Full name</span><input name="${prefix}.name" autocomplete="${prefix} name" required maxlength="120"></label>
  <label class="field"><span>Address</span><input name="${prefix}.line1" autocomplete="${prefix} address-line1" required maxlength="200"></label>
  <label class="field"><span>Apartment, suite, etc. <em class="muted">(optional)</em></span><input name="${prefix}.line2" autocomplete="${prefix} address-line2" maxlength="200"></label>
  <div class="field-row field-row-3">
    <label class="field"><span>City</span><input name="${prefix}.city" autocomplete="${prefix} address-level2" required maxlength="120"></label>
    <label class="field"><span>State / region</span><input name="${prefix}.region" autocomplete="${prefix} address-level1" maxlength="120"></label>
    <label class="field"><span>Postal code</span><input name="${prefix}.postal" autocomplete="${prefix} postal-code" maxlength="30"></label>
  </div>
  <label class="field"><span>Country</span><select name="${prefix}.country" autocomplete="${prefix} country" required>${countryOptions(settings.home_country, settings.home_country)}</select></label>`;
}

export function checkoutPage({ settings, origin }) {
  const s = settings;
  if (s.checkout_mode === "closed") {
    const body = `
<section class="page-head page-head-small"><div class="wrap"><h1 class="display">Checkout</h1></div></section>
<section class="section section-tight"><div class="wrap narrow">
  <div class="card notice"><p class="display-sm">Online checkout is closed for now.</p>
  <p>To buy a painting, please <a href="/contact">get in touch</a> and we'll arrange everything with you directly.</p></div>
</div></section>`;
    return page({ settings: s, title: "Checkout", path: "/checkout", origin, body, noindex: true });
  }

  const body = `
<section class="page-head page-head-small"><div class="wrap"><h1 class="display">Checkout</h1></div></section>
<section class="section section-tight">
  <div class="wrap checkout-grid">
    <form class="checkout-form" data-checkout-form novalidate>
      <fieldset class="card">
        <legend><span class="step">1</span> Contact</legend>
        <div class="field-row">
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="254"></label>
          <label class="field"><span>Phone <em class="muted">(optional, for delivery)</em></span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
        </div>
      </fieldset>

      <fieldset class="card">
        <legend><span class="step">2</span> Shipping address</legend>
        ${addressFields("shipping", s)}
      </fieldset>

      <fieldset class="card">
        <legend><span class="step">3</span> Billing address</legend>
        <label class="check"><input type="checkbox" name="billing_same" checked data-billing-toggle> Same as shipping address</label>
        <div class="billing-fields" data-billing-fields hidden>
          ${addressFields("billing", s)}
        </div>
      </fieldset>

      <fieldset class="card">
        <legend><span class="step">4</span> Payment</legend>
        <div class="payment-panel">
          <div class="payment-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>
          <div>
            <p class="payment-title">Pay securely after you order</p>
            <p class="muted">${esc(s.checkout_note)}</p>
          </div>
        </div>
        <div data-payment-slot></div>
      </fieldset>

      <fieldset class="card">
        <legend><span class="step">5</span> Anything else?</legend>
        <label class="field"><span>Note for the artist <em class="muted">(optional)</em></span><textarea name="note" rows="3" maxlength="1000" placeholder="Delivery instructions, a gift message, framing questions…"></textarea></label>
        <label class="check"><input type="checkbox" name="agree" required> I agree to the <a href="/legal/terms" target="_blank">terms of sale</a> and the <a href="/legal/returns" target="_blank">returns policy</a>.</label>
        <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      </fieldset>

      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-wide btn-large" type="submit" data-place-order>Place order</button>
      <p class="muted small center">Nothing is charged now. Your painting is held while we send your payment link.</p>
    </form>

    <aside class="summary card" aria-label="Order summary">
      <h2 class="summary-title">Order summary</h2>
      <div data-summary><p class="muted">Loading…</p></div>
    </aside>
  </div>
</section>`;
  return page({ settings: s, title: "Checkout", path: "/checkout", origin, body, noindex: true, bodyClass: "page-checkout" });
}

// ---------------------------------------------------------------------------

function addressBlock(a) {
  return [a.name, a.line1, a.line2, [a.city, a.region, a.postal].filter(Boolean).join(", "), countryName(a.country)]
    .filter(Boolean)
    .map(esc)
    .join("<br>");
}

export function orderPage({ settings, order, items, justPlaced, origin }) {
  const s = settings;
  const money = (v) => esc(formatMoney(v, order.currency));
  const shipping = JSON.parse(order.shipping_address);
  const billing = JSON.parse(order.billing_address);
  const steps = [
    ["Order placed", true],
    ["Payment received", ["paid", "shipped", "completed"].includes(order.status)],
    ["Shipped", ["shipped", "completed"].includes(order.status)],
    ["Delivered", order.status === "completed"],
  ];
  const closed = order.status === "cancelled" || order.status === "refunded";

  let next = "";
  if (order.status === "awaiting_payment") {
    next = `<div class="card notice"><p class="payment-title">What happens next</p><p>We'll email a secure payment link to <strong>${esc(order.email)}</strong>, usually within 24 hours. Your painting is held for you until then.</p></div>`;
  } else if (order.status === "paid") {
    next = `<div class="card notice"><p class="payment-title">Payment received — thank you!</p><p>Your painting is being packed. You'll get tracking details by email when it ships.</p></div>`;
  } else if (order.status === "shipped") {
    next = `<div class="card notice"><p class="payment-title">On its way</p><p>Your painting has shipped.${order.tracking ? ` Tracking: <strong>${esc(order.tracking)}</strong>` : ""}</p></div>`;
  } else if (closed) {
    next = `<div class="card notice notice-muted"><p class="payment-title">This order was ${order.status === "refunded" ? "refunded" : "cancelled"}.</p><p>Questions? <a href="/contact">Get in touch</a>.</p></div>`;
  }

  const body = `
<section class="page-head page-head-small">
  <div class="wrap narrow">
    <p class="eyebrow">Order #${order.number}</p>
    <h1 class="display">${justPlaced ? `Thank you, ${esc(order.name.split(" ")[0])}.` : esc(ORDER_STATUS[order.status] || order.status)}</h1>
    <p class="muted">Placed ${esc(formatDate(order.created_at))}. Keep this page's link to check your order any time.</p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap narrow order-page">
    ${closed ? "" : `<ol class="progress">${steps.map(([label, done]) => `<li class="${done ? "done" : ""}">${esc(label)}</li>`).join("")}</ol>`}
    ${next}
    <div class="card">
      <ul class="line-items">
        ${items
          .map(
            (it) => `<li class="line-item">
          <div class="line-thumb">${it.image_id ? `<img src="/img/${esc(it.image_id)}/thumb" alt="" loading="lazy">` : ""}</div>
          <div class="line-info"><a href="/art/${esc(it.slug)}">${esc(it.title)}</a>${it.quantity > 1 ? `<span class="muted"> × ${it.quantity}</span>` : ""}</div>
          <div class="line-price">${money(it.unit_price * it.quantity)}</div>
        </li>`,
          )
          .join("")}
      </ul>
      <dl class="totals">
        <div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div>
        <div><dt>Shipping</dt><dd>${order.shipping ? money(order.shipping) : "Free"}</dd></div>
        ${order.tax ? `<div><dt>${esc(s.tax_label || "Tax")}</dt><dd>${money(order.tax)}</dd></div>` : ""}
        <div class="total"><dt>Total</dt><dd>${money(order.total)}</dd></div>
      </dl>
    </div>
    <div class="address-grid">
      <div class="card"><h2 class="card-title">Shipping to</h2><p>${addressBlock(shipping)}</p>${order.phone ? `<p class="muted">${esc(order.phone)}</p>` : ""}</div>
      <div class="card"><h2 class="card-title">Billing</h2><p>${addressBlock(billing)}</p><p class="muted">${esc(order.email)}</p></div>
    </div>
    <p class="center"><a class="btn btn-ghost" href="/shop">Continue browsing</a></p>
  </div>
</section>`;
  return page({ settings: s, title: `Order #${order.number}`, origin, body, noindex: true, bodyClass: justPlaced ? "page-order just-placed" : "page-order" });
}

// ---------------------------------------------------------------------------

export function legalPage({ settings, kind, origin }) {
  const s = settings;
  const info = LEGAL_PAGES[kind];
  const body = `
<section class="page-head page-head-small"><div class="wrap narrow"><p class="eyebrow">Information</p><h1 class="display">${esc(info.title)}</h1></div></section>
<section class="section section-tight"><div class="wrap narrow">
  <div class="prose prose-lg">${richText(s[info.key])}</div>
  <nav class="legal-nav">${Object.entries(LEGAL_PAGES)
    .map(([k, v]) => `<a href="/legal/${k}" ${k === kind ? 'aria-current="page"' : ""}>${esc(v.title)}</a>`)
    .join("")}</nav>
</div></section>`;
  return page({ settings: s, title: info.title, path: `/legal/${kind}`, origin, body });
}

export function notFoundPage({ settings, origin }) {
  const body = `
<section class="section"><div class="wrap narrow center">
  <p class="eyebrow">404</p>
  <h1 class="display">This page has wandered off.</h1>
  <p class="lead">It may have been sold, renamed or never existed.</p>
  <p class="btn-row center"><a class="btn btn-primary" href="/shop">Browse the collection</a><a class="btn btn-ghost" href="/">Home</a></p>
</div></section>`;
  return page({ settings, title: "Page not found", origin, body, noindex: true });
}

export function errorPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Something went wrong</title><link rel="stylesheet" href="/assets/site.css"></head><body><main class="section"><div class="wrap narrow center"><h1 class="display">Something went wrong.</h1><p class="lead">Please try again in a moment.</p><p><a class="btn btn-primary" href="/">Back to the shop</a></p></div></main></body></html>`;
}
