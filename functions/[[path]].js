// Cloudflare Pages sends every request that isn't a static file in
// public/assets to this function. All the logic lives in src/.
import { handle } from "../src/app.js";

export function onRequest(context) {
  return handle(context.request, context.env, context);
}
