// The page shell shared by every public page: <head>, header, footer.

import { esc, formatMoney, formatSize } from "../lib/util.js";

export const FONT_THEMES = {
  classic: {
    label: "Classic (Cormorant serif)",
    href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap",
    display: "'Cormorant Garamond', 'Times New Roman', serif",
  },
  modern: {
    label: "Modern (Fraunces serif)",
    href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Inter:wght@400;500;600&display=swap",
    display: "'Fraunces', Georgia, serif",
  },
  minimal: {
    label: "Minimal (Inter sans-serif)",
    href: "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Inter:wght@400;500;600&display=swap",
    display: "'Inter Tight', 'Inter', system-ui, sans-serif",
  },
};

const SOCIALS = [
  ["social_instagram", "Instagram"],
  ["social_facebook", "Facebook"],
  ["social_tiktok", "TikTok"],
  ["social_pinterest", "Pinterest"],
  ["social_youtube", "YouTube"],
  ["social_x", "X"],
];

export function socialLinks(settings) {
  return SOCIALS.filter(([key]) => /^https:\/\//.test(settings[key] || "")).map(([key, label]) => ({ label, href: settings[key] }));
}

const ICONS = {
  cart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>',
};

export function icon(name) {
  return ICONS[name] || "";
}

/**
 * @param {object} o
 * @param {object} o.settings  store settings
 * @param {string} o.title     page title (store name is added)
 * @param {string} o.body      main HTML
 * @param {string} [o.path]    current path, to highlight the nav
 */
export function page(o) {
  const s = o.settings;
  const theme = FONT_THEMES[s.font_theme] || FONT_THEMES.classic;
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : "#9a4a2f";
  const fullTitle = o.title ? `${o.title} — ${s.store_name}` : `${s.store_name}${s.tagline ? " — " + s.tagline : ""}`;
  const description = o.description || s.seo_description || s.tagline || "";
  const origin = o.origin || "";
  const canonical = o.path ? origin + o.path : "";
  const ogImage = o.image ? origin + o.image : "";
  const nav = [
    ["/shop", "Shop"],
    ["/about", "About"],
    ["/contact", "Contact"],
  ];
  const active = (href) => (o.path && (o.path === href || o.path.startsWith(href + "/") || (href === "/shop" && o.path.startsWith("/art/"))) ? ' aria-current="page"' : "");
  const year = new Date().getFullYear();
  const socials = socialLinks(s);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${o.noindex ? '<meta name="robots" content="noindex">' : ""}
${canonical && !o.noindex ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:site_name" content="${esc(s.store_name)}">
<meta property="og:title" content="${esc(o.title || s.store_name)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${o.ogType || "website"}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${theme.href}">
<link rel="stylesheet" href="/assets/site.css?v=${o.assetVersion || "1"}">
<style>:root{--accent:${accent};--font-display:${theme.display}}</style>
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
<script src="/assets/site.js?v=${o.assetVersion || "1"}" defer></script>
</head>
<body class="${esc(o.bodyClass || "")}" data-currency="${esc(s.currency)}">
<a class="skip-link" href="#main">Skip to content</a>
${s.announcement ? `<div class="announcement">${esc(s.announcement)}</div>` : ""}
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">${esc(s.store_name)}</a>
    <nav class="site-nav" id="site-nav" aria-label="Main">
      ${nav.map(([href, label]) => `<a href="${href}"${active(href)}>${label}</a>`).join("")}
    </nav>
    <div class="header-actions">
      <a class="cart-link" href="/cart" aria-label="Cart">${icon("cart")}<span class="cart-count" data-cart-count hidden>0</span></a>
      <button class="menu-toggle" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="Menu">${icon("menu")}</button>
    </div>
  </div>
</header>
<main id="main">
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a class="brand" href="/">${esc(s.store_name)}</a>
      ${s.tagline ? `<p>${esc(s.tagline)}</p>` : ""}
      ${s.location ? `<p class="muted">${esc(s.location)}</p>` : ""}
    </div>
    <div>
      <h2 class="footer-title">Shop</h2>
      <a href="/shop">All work</a>
      <a href="/shop?show=available">Available now</a>
      <a href="/cart">Your cart</a>
    </div>
    <div>
      <h2 class="footer-title">Information</h2>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/legal/shipping">Shipping</a>
      <a href="/legal/returns">Returns</a>
    </div>
    <div>
      <h2 class="footer-title">${socials.length ? "Follow" : "Legal"}</h2>
      ${socials.length ? socials.map((l) => `<a href="${esc(l.href)}" rel="noopener" target="_blank">${esc(l.label)}</a>`).join("") : ""}
      ${socials.length ? "" : '<a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a>'}
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>© ${year} ${esc(s.artist_name || s.store_name)}. All artwork and images are protected by copyright.</span>
    ${socials.length ? '<span><a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a></span>' : ""}
  </div>
</footer>
</body>
</html>`;
}

/** Responsive <img> for a stored painting photo. */
export function picture(imageId, alt, { sizes = "(max-width: 700px) 90vw, 33vw", eager = false, width = 0, height = 0, className = "" } = {}) {
  if (!imageId) return `<div class="img-missing ${esc(className)}" role="img" aria-label="${esc(alt)}"></div>`;
  const dims = width && height ? ` width="${width}" height="${height}"` : "";
  return `<img class="${esc(className)}" src="/img/${esc(imageId)}/thumb" srcset="/img/${esc(imageId)}/thumb 900w, /img/${esc(imageId)}/full 2400w" sizes="${esc(sizes)}" alt="${esc(alt)}"${dims} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

/** A painting tile used on the home page, shop grid and "more work". */
export function artCard(p, settings, { eager = false } = {}) {
  const sold = p.quantity <= 0;
  const sub = [p.medium, formatSize(p).replace(/ \(.*\)$/, "")].filter(Boolean).join(" · ");
  return `<a class="art-card" href="/art/${esc(p.slug)}">
  <div class="art-frame">${picture(p.cover_image_id, p.title, { eager, width: p.cover_width, height: p.cover_height })}</div>
  <div class="art-meta">
    <h3 class="art-title">${esc(p.title)}</h3>
    ${sub ? `<p class="art-sub">${esc(sub)}</p>` : ""}
    <p class="art-price">${sold ? '<span class="tag tag-sold">Sold</span>' : esc(formatMoney(p.price, settings.currency))}</p>
  </div>
</a>`;
}
