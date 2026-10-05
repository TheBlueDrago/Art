// Database queries for paintings shared by the public pages and the API.

const COVER_JOIN = `
  LEFT JOIN images c ON c.id = (
    SELECT id FROM images WHERE painting_id = p.id ORDER BY position, created_at LIMIT 1
  )`;
const COVER_FIELDS = "c.id AS cover_image_id, c.width AS cover_width, c.height AS cover_height";

export const SHOP_SORTS = {
  featured: "(p.quantity = 0), p.sort_order, p.created_at DESC",
  newest: "(p.quantity = 0), p.created_at DESC",
  "price-asc": "(p.quantity = 0), p.price, p.created_at DESC",
  "price-desc": "(p.quantity = 0), p.price DESC, p.created_at DESC",
};

export async function listPublished(db, { collection = "", availableOnly = false, sort = "featured", limit = 500 } = {}) {
  const where = ["p.status = 'published'"];
  const binds = [];
  if (collection) {
    where.push("p.collection = ?");
    binds.push(collection);
  }
  if (availableOnly) where.push("p.quantity > 0");
  const order = SHOP_SORTS[sort] || SHOP_SORTS.featured;
  const { results } = await db
    .prepare(`SELECT p.*, ${COVER_FIELDS} FROM paintings p ${COVER_JOIN} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`)
    .bind(...binds, limit)
    .all();
  return results;
}

/** Up to `limit` works for the home page: featured first, then the newest. */
export async function listForHome(db, limit = 6) {
  const { results } = await db
    .prepare(
      `SELECT p.*, ${COVER_FIELDS} FROM paintings p ${COVER_JOIN}
       WHERE p.status = 'published'
       ORDER BY p.featured DESC, (p.quantity = 0), p.sort_order, p.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return results;
}

export async function listCollections(db) {
  const { results } = await db
    .prepare("SELECT DISTINCT collection FROM paintings WHERE status = 'published' AND collection != '' ORDER BY collection COLLATE NOCASE")
    .all();
  return results.map((r) => r.collection);
}

export async function getPublishedBySlug(db, slug) {
  return db.prepare(`SELECT p.*, ${COVER_FIELDS} FROM paintings p ${COVER_JOIN} WHERE p.slug = ? AND p.status = 'published'`).bind(slug).first();
}

export async function getPaintingWithCover(db, id) {
  return db.prepare(`SELECT p.*, ${COVER_FIELDS} FROM paintings p ${COVER_JOIN} WHERE p.id = ?`).bind(id).first();
}

export async function getImages(db, paintingId) {
  const { results } = await db
    .prepare("SELECT id, width, height, alt, position FROM images WHERE painting_id = ? ORDER BY position, created_at")
    .bind(paintingId)
    .all();
  return results;
}

/** Load paintings by id into a Map (for pricing a cart). */
export async function loadPaintings(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const { results } = await db
    .prepare(`SELECT p.*, ${COVER_FIELDS} FROM paintings p ${COVER_JOIN} WHERE p.id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all();
  for (const row of results) map.set(row.id, row);
  return map;
}

export async function moreWorks(db, painting, limit = 4) {
  const { results } = await db
    .prepare(
      `SELECT p.*, ${COVER_FIELDS} FROM paintings p ${COVER_JOIN}
       WHERE p.status = 'published' AND p.id != ?
       ORDER BY (p.collection = ?) DESC, (p.quantity = 0), p.sort_order, p.created_at DESC LIMIT ?`,
    )
    .bind(painting.id, painting.collection || "\u0000", limit)
    .all();
  return results;
}
