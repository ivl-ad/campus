/*
 * /api/signups -- newsletter sign-ups and contact messages for /admin/signups.
 * Behind the editor password like the rest of /api/* (functions/api/_middleware.js).
 *
 *   GET  ?list=newsletter|contact[&offset=N]  JSON: {rows, total, last7, last30, offset, more}
 *                                             -- newest first, PAGE rows at a time
 *   GET  ?list=newsletter|contact&format=csv  a spreadsheet download of every row
 *   POST {list, remove: <email or id>}        delete one row (unsubscribe /
 *                                             "please delete my data" requests)
 *
 * The tables are created by functions/_shared/forms.js on the first sign-up.
 */
import { ensureTables } from '../_shared/forms.js';

const LISTS = {
  newsletter: {
    table: 'newsletter_subscribers', key: 'email',
    cols: ['email', 'created_at', 'page', 'country']
  },
  contact: {
    table: 'contact_messages', key: 'id',
    cols: ['id', 'created_at', 'name', 'email', 'reason', 'message', 'page', 'country']
  }
};

const PAGE = 200;
const listFor = (name) => (Object.prototype.hasOwnProperty.call(LISTS, name) ? LISTS[name] : null);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Stop a spreadsheet treating a submitted "=..." as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json(503, { error: 'No D1 binding (DB) on this Pages project -- see admin/SETUP.md step 5.' });
  const url = new URL(request.url);
  const list = listFor(url.searchParams.get('list')) || LISTS.newsletter;
  await ensureTables(env.DB);
  const select = 'SELECT ' + list.cols.join(', ') + ' FROM ' + list.table + ' ORDER BY created_at DESC';

  if (url.searchParams.get('format') === 'csv') {
    const { results } = await env.DB.prepare(select).all();
    const header = list.cols.map((c) => (c === 'created_at' ? 'date_utc' : c));
    const lines = [header.join(',')].concat(results.map((r) => list.cols.map((c) =>
      csvCell(c === 'created_at' ? new Date(r[c]).toISOString().replace('T', ' ').slice(0, 19) : r[c])
    ).join(',')));
    const name = list.table.replace(/_/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    return new Response('﻿' + lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + name + '"',
        'Cache-Control': 'no-store'
      }
    });
  }

  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const now = Date.now(), day = 86400000;
  const count = (where, ...args) => env.DB.prepare('SELECT COUNT(*) AS n FROM ' + list.table + where)
    .bind(...args).first('n');
  const [page, total, last7, last30] = await Promise.all([
    env.DB.prepare(select + ' LIMIT ?1 OFFSET ?2').bind(PAGE, offset).all(),
    count(''), count(' WHERE created_at >= ?1', now - 7 * day), count(' WHERE created_at >= ?1', now - 30 * day)
  ]);
  const rows = page.results;
  return json(200, { rows, total, last7, last30, offset, more: offset + rows.length < total });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json(503, { error: 'No D1 binding (DB) on this Pages project.' });
  let body;
  try { body = await request.json(); } catch (e) { return json(400, { error: 'Bad request' }); }
  const list = body && typeof body === 'object' ? listFor(body.list) : null;
  if (!list || body.remove == null || typeof body.remove === 'object') {
    return json(400, { error: 'Need list and remove' });
  }
  await ensureTables(env.DB);
  const res = await env.DB.prepare('DELETE FROM ' + list.table + ' WHERE ' + list.key + ' = ?')
    .bind(body.remove).run();
  return json(200, { ok: true, removed: res.meta ? res.meta.changes : undefined });
}
