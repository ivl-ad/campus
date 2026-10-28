/*
 * /api/analytics -- the visit counts for /admin/analytics. Behind the editor
 * password like the rest of /api/* (functions/api/_middleware.js).
 *
 *   GET ?days=7|30|90|365   {from, to, days: [{day, views, visits, clicks}],
 *                            totals, previous (the same length just before),
 *                            pages, sources, countries, devices, clicks}
 *
 * Collected by functions/hit.js; what is kept, and why, is in
 * functions/_shared/stats.js.
 */
import { ensureStats, dayOf } from '../_shared/stats.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
const SPANS = new Set([7, 30, 90, 365]);
const DAY_MS = 86400000;

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json(503, { error: 'No D1 binding (DB) on this Pages project -- see admin/SETUP.md step 5.' });
  const asked = parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  const span = SPANS.has(asked) ? asked : 30;
  const now = Date.now();
  // Noon, so a day that is 23 or 25 hours long cannot skip or repeat a date.
  const today = Date.parse(dayOf(now) + 'T12:00:00Z');
  const list = [];
  for (let i = span - 1; i >= 0; i--) list.push(new Date(today - i * DAY_MS).toISOString().slice(0, 10));
  const from = list[0], to = list[list.length - 1];
  const prevFrom = new Date(today - (2 * span - 1) * DAY_MS).toISOString().slice(0, 10);
  const prevTo = new Date(today - span * DAY_MS).toISOString().slice(0, 10);

  const db = env.DB;
  await ensureStats(db);
  const all = (sql, ...args) => db.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const top = (table, col, n) => all(
    'SELECT ' + col + ' AS name, SUM(visits) AS visits FROM ' + table +
    ' WHERE day BETWEEN ?1 AND ?2 GROUP BY ' + col + ' ORDER BY visits DESC, name LIMIT ' + n, from, to);
  const sums = (a, b) => Promise.all([
    db.prepare('SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(entries),0) AS visits ' +
               'FROM stats_pages WHERE day BETWEEN ?1 AND ?2').bind(a, b).first(),
    db.prepare('SELECT COALESCE(SUM(clicks),0) AS clicks FROM stats_clicks WHERE day BETWEEN ?1 AND ?2')
      .bind(a, b).first()
  ]).then(([p, c]) => ({ views: p.views, visits: p.visits, clicks: c.clicks }));

  const [perDay, perDayClicks, totals, previous, pages, sources, countries, devices, clicks] =
    await Promise.all([
      all('SELECT day, SUM(views) AS views, SUM(entries) AS visits FROM stats_pages ' +
          'WHERE day BETWEEN ?1 AND ?2 GROUP BY day', from, to),
      all('SELECT day, SUM(clicks) AS clicks FROM stats_clicks WHERE day BETWEEN ?1 AND ?2 GROUP BY day',
          from, to),
      sums(from, to),
      sums(prevFrom, prevTo),
      all('SELECT path, SUM(views) AS views, SUM(entries) AS visits FROM stats_pages ' +
          'WHERE day BETWEEN ?1 AND ?2 GROUP BY path ORDER BY views DESC, path LIMIT 50', from, to),
      top('stats_sources', 'source', 25),
      top('stats_places', 'country', 25),
      top('stats_devices', 'device', 5),
      all('SELECT kind, target, SUM(clicks) AS clicks FROM stats_clicks WHERE day BETWEEN ?1 AND ?2 ' +
          'GROUP BY kind, target ORDER BY clicks DESC, target LIMIT 50', from, to)
    ]);
  const byDay = new Map(perDay.map((r) => [r.day, r]));
  const clicksByDay = new Map(perDayClicks.map((r) => [r.day, r.clicks]));
  const days = list.map((day) => ({
    day,
    views: (byDay.get(day) || {}).views || 0,
    visits: (byDay.get(day) || {}).visits || 0,
    clicks: clicksByDay.get(day) || 0
  }));
  return json(200, { from, to, span, days, totals, previous, pages, sources, countries, devices, clicks });
}
