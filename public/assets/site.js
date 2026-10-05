// Storefront behaviour: cart, checkout (billing page), contact form, image
// viewer and the mobile menu. Prices shown here are only for display — the
// server works out every total again from its own database.
(() => {
  "use strict";

  const CART_KEY = "art_cart_v1";
  const currency = document.body.dataset.currency || "USD";
  const digits = (() => {
    try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; } catch { return 2; }
  })();
  const fmt = (minor) => {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 10 ** digits); }
    catch { return (minor / 10 ** digits).toFixed(digits) + " " + currency; }
  };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---- cart storage ------------------------------------------------------------

  function readCart() {
    try {
      const data = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(data) ? data.filter((i) => i && typeof i.id === "string" && i.qty > 0) : [];
    } catch { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* private mode */ }
    updateCount(true);
  }
  function cartCount() { return readCart().reduce((n, i) => n + i.qty, 0); }
  function updateCount(bump) {
    const n = cartCount();
    $$("[data-cart-count]").forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
      if (bump && n) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    });
  }

  async function api(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong. Please try again.");
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
  const quote = (items, country = "") => api("/api/cart/quote", { items: items.map(({ id, qty }) => ({ id, qty })), country });

  /** Drop sold/unavailable items and cap quantities to what's in stock. */
  function syncCartWithQuote(q) {
    const lines = new Map(q.lines.map((l) => [l.id, l]));
    const before = readCart();
    const after = before.filter((i) => lines.has(i.id)).map((i) => ({ ...i, qty: Math.min(i.qty, lines.get(i.id).quantity) }));
    if (JSON.stringify(before) !== JSON.stringify(after)) writeCart(after);
    return after;
  }

  // ---- add to cart ---------------------------------------------------------------

  function toast(html, ms = 5000) {
    $(".toast")?.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  $$("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const max = Number(btn.dataset.max) || 1;
      const items = readCart();
      const existing = items.find((i) => i.id === id);
      if (existing) {
        if (existing.qty >= max) {
          toast(`<div><p>${max === 1 ? "This original is already in your cart." : "You have all available copies in your cart."}</p><div class="toast-links"><a href="/cart">View cart</a><a href="/checkout">Checkout</a></div></div>`);
          return;
        }
        existing.qty += 1;
      } else {
        items.push({ id, qty: 1 });
      }
      writeCart(items);
      const img = $(".gallery-main img");
      const title = $(".detail-info h1")?.textContent || "Painting";
      toast(`${img ? `<img src="${esc(img.currentSrc || img.src)}" alt="">` : ""}<div><p><strong>${esc(title)}</strong> was added to your cart.</p><div class="toast-links"><a href="/cart">View cart</a><a href="/checkout">Checkout →</a></div></div>`);
      btn.textContent = "Added to cart ✓";
      setTimeout(() => { btn.textContent = "Add to cart"; }, 2200);
    });
  });

  // ---- cart page -------------------------------------------------------------------

  const cartRoot = $("[data-cart-page]");
  if (cartRoot) renderCartPage();

  async function renderCartPage() {
    const items = readCart();
    if (!items.length) {
      cartRoot.innerHTML = `<div class="empty-state"><p class="display-sm">Your cart is empty.</p><p class="muted">Find something you love in the collection.</p><p class="btn-row center" style="margin-top:20px"><a class="btn btn-primary" href="/shop">Browse paintings</a></p></div>`;
      return;
    }
    let q;
    try { q = (await quote(items)).quote; }
    catch (e) { cartRoot.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    const notices = q.problems.filter((p) => p.reason !== "limited").map((p) => `<p class="form-error">${esc(p.message)} It was removed from your cart.</p>`).join("");
    syncCartWithQuote(q);
    if (!q.lines.length) {
      cartRoot.innerHTML = notices + `<div class="empty-state" style="margin-top:16px"><p class="display-sm">Your cart is empty.</p><p class="btn-row center"><a class="btn btn-primary" href="/shop">Browse paintings</a></p></div>`;
      return;
    }
    const closed = cartRoot.dataset.checkoutMode === "closed";
    cartRoot.innerHTML = `${notices}
      <div class="cart-layout">
        <ul class="line-items">${q.lines.map((l) => `
          <li class="line-item" data-id="${esc(l.id)}">
            <a class="line-thumb" href="/art/${esc(l.slug)}">${l.image_id ? `<img src="/img/${esc(l.image_id)}/thumb" alt="">` : ""}</a>
            <div class="line-info">
              <a href="/art/${esc(l.slug)}">${esc(l.title)}</a>
              <div class="line-meta">${l.max_quantity === 1 ? "Original" : fmt(l.unit_price) + " each"}</div>
              <div class="line-actions">
                ${l.max_quantity > 1 ? `<label>Qty <select data-qty>${Array.from({ length: Math.min(l.max_quantity, 20) }, (_, i) => `<option ${i + 1 === l.quantity ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>` : ""}
                <button type="button" class="link-btn" data-remove>Remove</button>
              </div>
            </div>
            <div class="line-price">${fmt(l.line_total)}</div>
          </li>`).join("")}
        </ul>
        <aside class="card summary">
          <h2 class="summary-title">Summary</h2>
          <dl class="totals">
            <div><dt>Subtotal</dt><dd>${fmt(q.subtotal)}</dd></div>
            <div><dt>Shipping</dt><dd>${q.shipping ? fmt(q.shipping) : "Free"}</dd></div>
            ${q.tax ? `<div><dt>${esc(q.tax_label || "Tax")}</dt><dd>${fmt(q.tax)}</dd></div>` : ""}
            <div class="total"><dt>Total</dt><dd>${fmt(q.total)}</dd></div>
          </dl>
          ${closed
            ? `<a class="btn btn-primary btn-wide" href="/contact">Contact us to buy</a><p class="summary-note">Online checkout is closed for now.</p>`
            : `<a class="btn btn-primary btn-wide btn-large" href="/checkout">Continue to checkout</a><p class="summary-note">Shipping is for your home country; it updates at checkout.</p>`}
        </aside>
      </div>`;

    $$("[data-remove]", cartRoot).forEach((b) => b.addEventListener("click", () => {
      const id = b.closest("[data-id]").dataset.id;
      writeCart(readCart().filter((i) => i.id !== id));
      renderCartPage();
    }));
    $$("[data-qty]", cartRoot).forEach((s) => s.addEventListener("change", () => {
      const id = s.closest("[data-id]").dataset.id;
      writeCart(readCart().map((i) => (i.id === id ? { ...i, qty: Number(s.value) } : i)));
      renderCartPage();
    }));
  }

  // ---- checkout (billing page) ----------------------------------------------------------

  const checkoutForm = $("[data-checkout-form]");
  if (checkoutForm) initCheckout(checkoutForm);

  function initCheckout(form) {
    const summary = $("[data-summary]");
    const errorBox = $(".form-error", form);
    const billingToggle = $("[data-billing-toggle]", form);
    const billingFields = $("[data-billing-fields]", form);
    const shipCountry = form.elements["shipping.country"];
    let current = null;

    if (!readCart().length) { location.replace("/cart"); return; }

    function setBillingRequired() {
      const same = billingToggle.checked;
      billingFields.hidden = same;
      $$("input, select", billingFields).forEach((el) => {
        if (["billing.name", "billing.line1", "billing.city", "billing.country"].includes(el.name)) el.required = !same;
      });
    }
    billingToggle.addEventListener("change", setBillingRequired);
    setBillingRequired();

    function renderSummary(q) {
      current = q;
      summary.innerHTML = `
        <ul class="line-items">${q.lines.map((l) => `
          <li class="line-item">
            <div class="line-thumb">${l.image_id ? `<img src="/img/${esc(l.image_id)}/thumb" alt="">` : ""}</div>
            <div class="line-info"><a href="/art/${esc(l.slug)}">${esc(l.title)}</a>${l.quantity > 1 ? `<div class="line-meta">Qty ${l.quantity}</div>` : ""}</div>
            <div class="line-price">${fmt(l.line_total)}</div>
          </li>`).join("")}
        </ul>
        <dl class="totals">
          <div><dt>Subtotal</dt><dd>${fmt(q.subtotal)}</dd></div>
          <div><dt>Shipping${q.international ? " (international)" : ""}</dt><dd>${q.shipping ? fmt(q.shipping) : "Free"}</dd></div>
          ${q.tax ? `<div><dt>${esc(q.tax_label || "Tax")}</dt><dd>${fmt(q.tax)}</dd></div>` : ""}
          <div class="total"><dt>Total</dt><dd>${fmt(q.total)}</dd></div>
        </dl>
        <p class="summary-note"><a href="/cart">Edit cart</a></p>`;
      const shipProblem = q.problems.find((p) => p.reason === "no_shipping");
      showError(shipProblem ? shipProblem.message : "");
    }

    async function refresh() {
      try {
        const q = (await quote(readCart(), shipCountry.value)).quote;
        const removed = q.problems.filter((p) => p.reason === "sold" || p.reason === "unavailable");
        if (q.problems.some((p) => p.reason !== "no_shipping")) syncCartWithQuote(q);
        if (!readCart().length) { location.replace("/cart"); return; }
        renderSummary(q);
        if (removed.length) showError(removed.map((p) => p.message).join(" ") + " Your cart was updated.");
      } catch (e) {
        summary.innerHTML = `<p class="form-error">${esc(e.message)}</p>`;
      }
    }
    shipCountry.addEventListener("change", refresh);
    refresh();

    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.hidden = !msg;
    }

    form.addEventListener("input", (e) => e.target.removeAttribute("aria-invalid"));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("");
      const invalid = $$("input, select, textarea", form).filter((el) => !el.closest("[hidden]") && !el.checkValidity());
      invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
      if (invalid.length) {
        const first = invalid[0];
        showError(first.name === "agree" ? "Please accept the terms of sale to place your order." : "Please fill in the highlighted fields.");
        first.focus();
        return;
      }
      const f = form.elements;
      const addr = (p) => ({
        name: f[`${p}.name`].value, line1: f[`${p}.line1`].value, line2: f[`${p}.line2`].value,
        city: f[`${p}.city`].value, region: f[`${p}.region`].value, postal: f[`${p}.postal`].value, country: f[`${p}.country`].value,
      });
      const payload = {
        items: readCart().map(({ id, qty }) => ({ id, qty })),
        email: f.email.value,
        phone: f.phone.value,
        shipping: addr("shipping"),
        billing_same: billingToggle.checked,
        billing: billingToggle.checked ? null : addr("billing"),
        note: f.note.value,
        agree: f.agree.checked,
        website: f.website.value,
        expected_total: current ? current.total : undefined,
      };
      const btn = $("[data-place-order]", form);
      btn.disabled = true;
      btn.textContent = "Placing your order…";
      try {
        const res = await api("/api/orders", payload);
        writeCart([]);
        location.assign(res.redirect);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Place order";
        if (err.data && err.data.quote) {
          syncCartWithQuote(err.data.quote);
          if (!readCart().length) { location.replace("/cart"); return; }
          renderSummary(err.data.quote);
        }
        showError(err.message);
        errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  // ---- contact form -------------------------------------------------------------------

  const contactForm = $("[data-contact-form]");
  if (contactForm) {
    contactForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorBox = $(".form-error", contactForm);
      errorBox.hidden = true;
      const invalid = $$("input, textarea", contactForm).filter((el) => !el.checkValidity());
      invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
      if (invalid.length) {
        errorBox.textContent = "Please fill in your name, a valid email and a message.";
        errorBox.hidden = false;
        invalid[0].focus();
        return;
      }
      const data = Object.fromEntries(new FormData(contactForm));
      const btn = $("button[type=submit]", contactForm);
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        await api("/api/messages", data);
        $$(".field, .field-row, .contact-art, button[type=submit]", contactForm).forEach((el) => (el.hidden = true));
        $(".form-success", contactForm).hidden = false;
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        btn.disabled = false;
        btn.textContent = "Send message";
      }
    });
    contactForm.addEventListener("input", (e) => e.target.removeAttribute("aria-invalid"));
  }

  // ---- painting gallery & zoom -----------------------------------------------------------

  const gallery = $("[data-gallery]");
  if (gallery) {
    const mainImg = $(".gallery-main img", gallery);
    const thumbs = $$(".gallery-thumb", gallery);
    const sources = thumbs.length ? thumbs.map((t) => ({ src: t.dataset.full, alt: t.dataset.alt })) : mainImg ? [{ src: mainImg.src, alt: mainImg.alt }] : [];
    let index = 0;

    const show = (i) => {
      index = (i + sources.length) % sources.length;
      thumbs.forEach((t, j) => t.classList.toggle("is-active", j === index));
      if (mainImg) {
        mainImg.src = sources[index].src;
        mainImg.alt = sources[index].alt;
        const t = thumbs[index];
        if (t && t.dataset.w) { mainImg.width = Number(t.dataset.w); mainImg.height = Number(t.dataset.h); }
      }
    };
    thumbs.forEach((t, i) => t.addEventListener("click", () => show(i)));

    $("[data-zoom]", gallery)?.addEventListener("click", () => {
      if (!sources.length) return;
      const box = document.createElement("div");
      box.className = "lightbox";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Image viewer");
      box.innerHTML = `<img alt=""><button type="button" class="lb-close" aria-label="Close">×</button>${sources.length > 1 ? '<button type="button" class="lb-prev" aria-label="Previous image">‹</button><button type="button" class="lb-next" aria-label="Next image">›</button>' : ""}`;
      const img = $("img", box);
      const set = () => { img.src = sources[index].src; img.alt = sources[index].alt; box.classList.remove("zoomed"); };
      const close = () => { box.remove(); document.body.classList.remove("no-scroll"); document.removeEventListener("keydown", onKey); $("[data-zoom]", gallery).focus(); };
      const step = (d) => { show(index + d); set(); };
      const onKey = (e) => {
        if (e.key === "Escape") close();
        if (e.key === "ArrowRight" && sources.length > 1) step(1);
        if (e.key === "ArrowLeft" && sources.length > 1) step(-1);
      };
      img.addEventListener("click", (e) => { e.stopPropagation(); box.classList.toggle("zoomed"); });
      box.addEventListener("click", (e) => { if (e.target === box) close(); });
      $(".lb-close", box).addEventListener("click", close);
      $(".lb-prev", box)?.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
      $(".lb-next", box)?.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
      document.addEventListener("keydown", onKey);
      set();
      document.body.appendChild(box);
      document.body.classList.add("no-scroll");
      $(".lb-close", box).focus();
    });
  }

  // ---- shop filters, mobile menu --------------------------------------------------------------

  $$("form[data-auto-submit]").forEach((form) => {
    form.addEventListener("change", () => form.submit());
  });

  const menuBtn = $(".menu-toggle");
  const nav = $("#site-nav");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", () => {
      const open = !nav.classList.contains("open");
      nav.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    });
  }

  updateCount(false);
})();
