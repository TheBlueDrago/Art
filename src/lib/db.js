// Database schema (created automatically) and store settings.
//
// Amounts of money are always stored as whole numbers in the currency's
// minor unit (cents for USD). Timestamps are milliseconds since 1970.

const MIGRATIONS = [
  // 1 — first version
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    // Exactly one owner can ever exist (id must be 1). Only the owner can
    // sign in to /admin, so only the owner can list paintings for sale.
    `CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      pass_iter INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS paintings (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      medium TEXT NOT NULL DEFAULT '',
      width REAL,
      height REAL,
      depth REAL,
      unit TEXT NOT NULL DEFAULT 'in',
      year INTEGER,
      price INTEGER NOT NULL CHECK (price >= 0),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
      shipping INTEGER,
      shipping_intl INTEGER,
      framed INTEGER NOT NULL DEFAULT 0,
      collection TEXT NOT NULL DEFAULT '',
      featured INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sold_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS paintings_status ON paintings (status, sort_order)`,
    `CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      painting_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      alt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS images_painting ON images (painting_id, position)`,
    `CREATE TABLE IF NOT EXISTS image_data (
      image_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (image_id, variant)
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      view_key TEXT NOT NULL,
      status TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      shipping_address TEXT NOT NULL,
      billing_address TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      shipping INTEGER NOT NULL,
      tax INTEGER NOT NULL,
      total INTEGER NOT NULL,
      payment_provider TEXT NOT NULL DEFAULT '',
      payment_ref TEXT NOT NULL DEFAULT '',
      tracking TEXT NOT NULL DEFAULT '',
      owner_note TEXT NOT NULL DEFAULT '',
      stock_released INTEGER NOT NULL DEFAULT 0,
      ip TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      paid_at INTEGER,
      shipped_at INTEGER,
      closed_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at)`,
    `CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL,
      painting_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      shipping INTEGER NOT NULL,
      image_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (order_id, painting_id)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      painting_id TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      ip TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
  ],
  // Add new migrations as new arrays at the end. Never edit old ones.
];

let schemaReady = null;

/** Make sure all tables exist. Runs once per server instance. */
export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = migrate(db).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function migrate(db) {
  let version = 0;
  try {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    version = Number(row?.value || 0);
  } catch {
    version = 0; // meta table does not exist yet
  }
  for (let i = version; i < MIGRATIONS.length; i++) {
    const statements = MIGRATIONS[i].map((sql) => db.prepare(sql));
    statements.push(
      db
        .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(String(i + 1)),
    );
    await db.batch(statements);
  }
}

// ---------------------------------------------------------------------------
// Settings — everything the owner can change in Admin → Settings. A new owner
// can rebrand the whole store from there without touching code.

export const DEFAULT_SETTINGS = {
  store_name: "Atelier",
  tagline: "Original paintings, made by hand",
  artist_name: "",
  contact_email: "",
  location: "",
  announcement: "",

  hero_title: "Original paintings for the walls you live with",
  hero_text: "Every piece is painted by hand, one at a time. When it finds a home, it's gone for good.",
  hero_image_id: "",

  about_title: "About the artist",
  about_body:
    "Write a few words about yourself here: where you paint, what you paint, and why.\n\nCollectors love knowing the story behind the work. You can change this text in Admin → Settings → About page.",
  about_image_id: "",

  highlights:
    "One of a kind | Every painting is an original, signed by the artist.\nPacked with care | Each piece is wrapped and boxed by hand for its trip to you.\nQuestions welcome | Ask about any piece, framing or a commission.",

  social_instagram: "",
  social_facebook: "",
  social_tiktok: "",
  social_pinterest: "",
  social_youtube: "",
  social_x: "",

  currency: "USD",
  // requests = customers place an order and the owner sends a payment link
  // closed   = the shop is browse-only
  // (online  = reserved for when a payment provider is connected)
  checkout_mode: "requests",
  checkout_note:
    "Secure online card payment is being set up. Place your order now and we'll email you a payment link within 24 hours. Your painting is held for you in the meantime, and nothing is charged today.",

  home_country: "US",
  ship_international: true,
  default_shipping: 0,
  default_shipping_intl: 0,
  free_shipping_over: 0,
  tax_percent: 0,
  tax_label: "Sales tax",
  tax_home_only: true,

  policy_shipping:
    "## Shipping\nEvery painting is carefully wrapped, protected at the corners and boxed by hand. Orders usually ship within 3–5 business days after payment, and you'll get a tracking number by email.\n\n## Damage in transit\nIf your painting arrives damaged, email us within 48 hours with photos of the box and the painting and we'll make it right.",
  policy_returns:
    "## Returns\nIf a painting isn't right for your space, you can return it within 14 days of delivery. It must come back in the condition it arrived in, in its original packaging. Return shipping is paid by the buyer unless the painting arrived damaged.\n\n## Refunds\nOnce the painting is back with us and checked, your refund is sent to your original payment method within 5 business days.\n\n## Commissions\nCommissioned work is made just for you and can't be returned.",
  policy_privacy:
    "## What we collect\nWhen you place an order we keep your name, email, phone number (if given) and addresses so we can deliver your painting and contact you about your order. Messages you send through the contact form are kept so we can reply.\n\n## What we don't do\nWe don't sell or share your information, and this site doesn't use advertising or tracking cookies. Your cart is stored only in your own browser.\n\n## Your choices\nYou can ask us to see, correct or delete your information at any time by emailing us.",
  policy_terms:
    "## Artwork\nAll paintings are original works. Colours can look slightly different on different screens. Copyright and reproduction rights stay with the artist unless agreed in writing.\n\n## Orders and prices\nPrices are confirmed by us when you place your order. We may cancel an order if a painting is no longer available, and you'll get a full refund of anything you paid.\n\n## Contact\nQuestions about these terms? Get in touch through the contact page.",

  accent: "#9a4a2f",
  font_theme: "classic",
  seo_description: "",
};

let settingsCache = null;

export async function getSettings(db) {
  if (settingsCache && Date.now() - settingsCache.at < 10_000) return settingsCache.value;
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const value = { ...DEFAULT_SETTINGS };
  for (const row of results) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      value[row.key] = JSON.parse(row.value);
    } catch {
      /* keep default */
    }
  }
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(db, changes) {
  const now = Date.now();
  const statements = Object.entries(changes).map(([key, val]) =>
    db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .bind(key, JSON.stringify(val), now),
  );
  if (statements.length) await db.batch(statements);
  settingsCache = null;
}

export function clearSettingsCache() {
  settingsCache = null;
}

/** D1 can hand back BLOBs as ArrayBuffer or as a plain array of numbers. */
export function blobToBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data || []);
}
