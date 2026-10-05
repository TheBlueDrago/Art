// Payment providers plug in here.
//
// Right now no provider is connected, so orders are taken as "order requests":
// the order is saved, the painting is held, and the owner emails the customer
// a payment link (Admin → Orders → "Email customer"), then marks it paid.
//
// To add Stripe, PayPal, Square, etc. later, implement a provider with:
//
//   name: "stripe"
//   async startPayment(order, items, env, origin)
//       -> create the checkout/order on the provider's server using the
//          order's server-side total, return { redirectUrl }
//   async handleWebhook(request, env)
//       -> verify the provider's signature, look up the order by the
//          provider's reference, and only then mark it paid (idempotently)
//
// Safety rules (please keep them):
//   * Secret keys only as Cloudflare secrets (npx wrangler pages secret put …),
//     never in code or in the browser.
//   * The amount always comes from the order row (computed on the server),
//     never from the browser.
//   * Never mark an order paid because the browser came back to a "success"
//     page — only after the provider's API or a signed webhook confirms it.
//   * Payouts go only to the owner's own provider account.

/** Returns the active provider, or null when payments aren't set up yet. */
export function getPaymentProvider(env) {
  void env;
  return null;
}
