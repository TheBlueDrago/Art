// Works out what an order costs. Prices ONLY come from the database rows the
// server loaded — never from anything the browser sends — so nobody can change
// what they pay by editing the page.

export const MAX_CART_LINES = 20;

/** Clean up a cart sent by the browser: [{id, qty}] with sane values, merged. */
export function normalizeCart(items) {
  if (!Array.isArray(items)) return [];
  const merged = new Map();
  for (const item of items.slice(0, 100)) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!/^[a-z0-9]{6,40}$/.test(id)) continue;
    const qty = Math.floor(Number(item.qty));
    if (!Number.isFinite(qty) || qty < 1) continue;
    merged.set(id, Math.min(99, (merged.get(id) || 0) + qty));
  }
  return [...merged].slice(0, MAX_CART_LINES).map(([id, qty]) => ({ id, qty }));
}

/** Is tax charged when shipping to this country? */
function taxApplies(settings, country) {
  if (!(Number(settings.tax_percent) > 0)) return false;
  if (!settings.tax_home_only) return true;
  return !country || country === settings.home_country;
}

/**
 * @param cart       normalized [{id, qty}]
 * @param paintings  Map id -> painting row from the database
 * @param settings   store settings
 * @param country    destination country code ('' = not chosen yet, treated as home)
 */
export function computeQuote(cart, paintings, settings, country = "") {
  const international = Boolean(country) && country !== settings.home_country;
  const lines = [];
  const problems = [];

  for (const { id, qty } of cart) {
    const p = paintings.get(id);
    if (!p || p.status !== "published") {
      problems.push({ id, reason: "unavailable", message: "This painting is no longer available." });
      continue;
    }
    if (p.quantity <= 0) {
      problems.push({ id, title: p.title, reason: "sold", message: `“${p.title}” has been sold.` });
      continue;
    }
    if (international && !settings.ship_international) {
      problems.push({ id, title: p.title, reason: "no_shipping", message: `We can't ship “${p.title}” to that country yet.` });
      continue;
    }
    const quantity = Math.min(qty, p.quantity);
    if (quantity < qty) {
      problems.push({ id, title: p.title, reason: "limited", available: p.quantity, message: `Only ${p.quantity} of “${p.title}” left.` });
    }
    const unitShipping = international
      ? (p.shipping_intl ?? settings.default_shipping_intl ?? 0)
      : (p.shipping ?? settings.default_shipping ?? 0);
    lines.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      image_id: p.cover_image_id || "",
      unit_price: p.price,
      quantity,
      max_quantity: p.quantity,
      line_total: p.price * quantity,
      shipping: Math.max(0, Math.round(unitShipping)) * quantity,
    });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
  let shipping = lines.reduce((sum, l) => sum + l.shipping, 0);
  const freeOver = Number(settings.free_shipping_over) || 0;
  const freeShipping = freeOver > 0 && subtotal >= freeOver;
  if (freeShipping) {
    shipping = 0;
    for (const l of lines) l.shipping = 0;
  }
  const tax = taxApplies(settings, country) ? Math.round((subtotal * Number(settings.tax_percent)) / 100) : 0;

  return {
    currency: settings.currency,
    lines,
    problems,
    subtotal,
    shipping,
    free_shipping: freeShipping,
    tax,
    tax_label: settings.tax_label,
    total: subtotal + shipping + tax,
    international,
  };
}
