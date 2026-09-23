/*
 * Public form intake: the newsletter sign-ups and the contact form, stored in
 * the same D1 database the catalog editor already uses (binding DB). Tables
 * are created on first use -- nothing to set up in the dashboard.
 *
 *   newsletter_subscribers   one row per email address (re-signups are no-ops)
 *   contact_messages         one row per message
 *   form_hits                rate-limit counters (hashed IP + form + 10-minute
 *                            window; pruned after a day, never shown anywhere)
 *
 * Read them at /admin/signups (password-protected, with CSV download), or in
 * the Cloudflare dashboard: D1 -> campus-draft -> Console.
 *
 * Works two ways: js/forms.js posts JSON and shows the page's own
 * "Thank you" / "Oops" boxes; with JavaScript off the browser posts the form
 * normally and is redirected back to the page it came from.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
     email TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL,
     page TEXT,
     country TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at INTEGER NOT NULL,
     name TEXT,
     email TEXT NOT NULL,
     reason TEXT,
     message TEXT,
     page TEXT,
     country TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS form_hits (
     k TEXT PRIMARY KEY,
     n INTEGER NOT NULL,
     at INTEGER NOT NULL
   )`
];

// A script trying to fill the database (or burn the daily D1 write
// allowance) does not get far. Generous on purpose: a whole campus can share
// one public IP address, and students signing up together must not be refused.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;

async function rateLimited(db, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return false;                                   // local dev
  const form = new URL(request.url).pathname;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + form));
  const hash = Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  const key = hash + ':' + Math.floor(Date.now() / WINDOW_MS);
  const row = await db.prepare(
    'INSERT INTO form_hits (k, n, at) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(key, Date.now()).first();
  if (Math.random() < 0.02) {
    await db.prepare('DELETE FROM form_hits WHERE at < ?1').bind(Date.now() - 86400000).run();
  }
  return !!row && row.n > MAX_PER_WINDOW;
}

let ready = false;
export async function ensureTables(db) {
  if (ready) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  ready = true;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
export const validEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL.test(s);
export const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  const out = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

// Only ever redirect back to a page on this same site.
function backTo(request, hash) {
  const self = new URL(request.url);
  let target = new URL('/', self);
  try {
    const ref = new URL(request.headers.get('Referer') || '/', self);
    if (ref.origin === self.origin) target = ref;
  } catch (e) { /* keep "/" */ }
  target.hash = hash;
  return Response.redirect(target.toString(), 303);
}

/*
 * handler(db, fields, meta) stores the submission, or returns an error string
 * the visitor should see.
 */
export function formEndpoint(handler) {
  return async function onRequestPost({ request, env }) {
    const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
    const reply = (ok, error, status) => wantsJson
      ? new Response(JSON.stringify(ok ? { ok: true } : { ok: false, error }), {
          status: ok ? 200 : (status || 400),
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
      : backTo(request, ok ? 'form-sent' : 'form-error');

    let fields;
    try { fields = await readBody(request); } catch (e) { return reply(false, 'Could not read the form.'); }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return reply(false, 'Could not read the form.');

    // Honeypot: a field people never see. Bots fill it in; pretend it worked.
    // Its name means nothing to browser/password-manager autofill (a field
    // called "website" could be filled by Safari's contact AutoFill, which
    // would silently drop a real sign-up). "website" is still honoured for
    // pages cached from before the rename.
    if (fields.mck_trap || fields.website) return reply(true);

    if (!env.DB) {
      console.error('forms: no DB binding on this Pages project -- submission dropped');
      return reply(false, 'Sign-ups are temporarily unavailable. Please email support@mycampuskorner.com.');
    }
    const meta = {
      now: Date.now(),
      page: cut(fields.page || request.headers.get('Referer') || '', 300),
      country: (request.cf && request.cf.country) || ''
    };
    try {
      await ensureTables(env.DB);
      if (await rateLimited(env.DB, request)) {
        return reply(false, 'Too many attempts from your connection — please try again in a few minutes.', 429);
      }
      const problem = await handler(env.DB, fields, meta);
      return problem ? reply(false, problem) : reply(true);
    } catch (err) {
      console.error('forms: store failed', err);
      return reply(false, 'Something went wrong. Please try again in a minute.');
    }
  };
}
