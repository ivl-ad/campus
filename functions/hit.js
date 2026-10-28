/*
 * POST /hit -- the site's own visit counter. js/analytics.js sends one when a
 * page opens ({t:"pv"}) and one when a visitor follows a link out to a
 * retailer ({t:"out"}). Public on purpose (it is not under /api/, so no
 * password), and it answers 204 whatever happens: counting must never slow
 * down or break a page.
 *
 * It only ever adds 1 to daily totals -- see functions/_shared/stats.js for
 * what is kept, and why that needs no cookie or consent banner. Read by
 * /admin/analytics (functions/api/analytics.js).
 *
 * Without the DB binding it does nothing at all.
 */
import { ensureStats, dayOf, BOT_UA, cleanPath, isEntry, sourceOf, deviceOf,
         clickOf } from './_shared/stats.js';

const bump = (db, table, col, day, value) => db.prepare(
  'INSERT INTO ' + table + ' (day, ' + col + ', visits) VALUES (?1, ?2, 1) ' +
  'ON CONFLICT (day, ' + col + ') DO UPDATE SET visits = visits + 1').bind(day, value);

async function count(env, request, b) {
  const db = env.DB;
  const site = new URL(request.url);
  const page = cleanPath(b.p, b.q);
  const day = dayOf(Date.now());
  await ensureStats(db);
  if (b.t === 'pv') {
    const entry = isEntry(b.r, site.host);
    const writes = [db.prepare(
      'INSERT INTO stats_pages (day, path, views, entries) VALUES (?1, ?2, 1, ?3) ' +
      'ON CONFLICT (day, path) DO UPDATE SET views = views + 1, entries = entries + ?3'
    ).bind(day, page, entry ? 1 : 0)];
    if (entry) {
      const country = /^[A-Z]{2}$/.test(request.headers.get('CF-IPCountry') || '')
        ? request.headers.get('CF-IPCountry') : '??';
      writes.push(bump(db, 'stats_sources', 'source', day, sourceOf(b.r, b.q)),
                  bump(db, 'stats_places', 'country', day, country),
                  bump(db, 'stats_devices', 'device', day, deviceOf(request.headers.get('User-Agent') || '')));
    }
    await db.batch(writes);
  } else if (b.t === 'out') {
    const click = clickOf(b);
    if (!click) return;
    await db.prepare(
      'INSERT INTO stats_clicks (day, kind, target, page, clicks) VALUES (?1, ?2, ?3, ?4, 1) ' +
      'ON CONFLICT (day, kind, target, page) DO UPDATE SET clicks = clicks + 1'
    ).bind(day, click.kind, click.target, page).run();
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (!env.DB) return done;
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOT_UA.test(ua)) return done;
  // Only this site's own pages count. A browser always says where a beacon
  // came from; anything claiming another origin is not a visit here.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return done;
  let b = null;
  try { b = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return done; }
  if (!b || typeof b !== 'object' || (b.t !== 'pv' && b.t !== 'out')) return done;
  const work = count(env, request, b).catch(() => { /* a lost count is fine */ });
  if (context.waitUntil) context.waitUntil(work); else await work;
  return done;
}
