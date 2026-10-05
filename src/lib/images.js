// Painting photos are stored inside D1 (no paid storage needed). The admin
// page shrinks each photo in the browser before upload into two versions:
//   full  – up to 2400px on the long side, for the painting page and zoom
//   thumb – up to 900px, for grids and the cart
// A D1 row can hold up to 2 MB, so each version must stay under that.

import { HttpError } from "./http.js";
import { blobToBytes } from "./db.js";
import { newId } from "./util.js";

export const MAX_IMAGE_BYTES = 1_950_000;
export const VARIANTS = ["full", "thumb"];

/** Work out the real file type from its first bytes (never trust the name). */
export function sniffImageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return "";
}

async function readUpload(file, label) {
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    throw new HttpError(400, `The ${label} image is missing.`);
  }
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, `The ${label} image is too large (max 1.9 MB after resizing).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime) throw new HttpError(400, "Only JPEG, PNG or WebP images can be uploaded.");
  return { bytes, mime };
}

/** Save an uploaded photo (owner only — the caller checks the session). */
export async function saveUploadedImage(db, form) {
  const full = await readUpload(form.get("full"), "full-size");
  const thumbFile = form.get("thumb");
  const thumb = thumbFile && typeof thumbFile !== "string" ? await readUpload(thumbFile, "thumbnail") : full;
  const width = Math.max(0, Math.min(20000, Math.round(Number(form.get("width")) || 0)));
  const height = Math.max(0, Math.min(20000, Math.round(Number(form.get("height")) || 0)));
  const alt = String(form.get("alt") || "").slice(0, 300);
  const id = newId();
  await db.batch([
    db.prepare("INSERT INTO images (id, painting_id, position, width, height, alt, created_at) VALUES (?, NULL, 0, ?, ?, ?, ?)").bind(id, width, height, alt, Date.now()),
    db.prepare("INSERT INTO image_data (image_id, variant, mime, data) VALUES (?, 'full', ?, ?)").bind(id, full.mime, full.bytes),
    db.prepare("INSERT INTO image_data (image_id, variant, mime, data) VALUES (?, 'thumb', ?, ?)").bind(id, thumb.mime, thumb.bytes),
  ]);
  return { id, width, height, alt };
}

export async function deleteImages(db, ids) {
  if (!ids.length) return;
  const statements = [];
  for (const id of ids) {
    statements.push(db.prepare("DELETE FROM image_data WHERE image_id = ?").bind(id));
    statements.push(db.prepare("DELETE FROM images WHERE id = ?").bind(id));
  }
  await db.batch(statements);
}

/** GET /img/<id>/<full|thumb> — images never change, so cache them forever. */
export async function serveImage(db, request, id, variant, ctx) {
  if (!/^[a-z0-9]{6,40}$/.test(id) || !VARIANTS.includes(variant)) return null;
  const etag = `"${id}-${variant}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" } });
  }

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(new URL(request.url).origin + `/img/${id}/${variant}`);
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {
      /* cache not available here */
    }
  }

  const row = await db.prepare("SELECT mime, data FROM image_data WHERE image_id = ? AND variant = ?").bind(id, variant).first();
  if (!row) return null;
  const response = new Response(blobToBytes(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
  if (cache && ctx?.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  }
  return response;
}
