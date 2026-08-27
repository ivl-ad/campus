/*
 * /api/draft -- the shared live draft behind /admin/.
 *
 * Every open editor reads and writes this one draft, held in the D1 database
 * bound as DB, so an edit on one screen shows up on the others within a poll
 * (about 2.5s) with no save, no commit and no rebuild. GitHub is only written
 * when somebody presses Save -- /api/catalog then publishes THIS draft (its
 * fromDraft branch), and that commit is the sole thing that rebuilds the site.
 *
 *   GET  ?since=N            everything that changed after seq N
 *   POST {since, ops, ...}   apply edits; the response doubles as a poll
 *   POST {reset:true}        discard the draft, reseed from GitHub (everyone)
 *
 * Model: one D1 row per product, keyed by a random rid that never changes
 * (the visible id is editable, so it cannot be the key). pos is a fractional
 * index -- a row added between 3 and 4 gets 3.5 -- so an insert writes one
 * row. Deletes are tombstones, so they reach editors still showing the row.
 * A counter in draft_meta stamps every write, and clients ask for "rows with
 * seq above the last one I saw". The counter bump and the row writes share
 * one batch, i.e. one transaction, so a reader can never observe the counter
 * ahead of the rows and skip past an in-flight write.
 *
 * Ops, applied in order inside that transaction:
 *   {rid, pos, data:{...}}   create (Add / Copy) -- the full product object
 *   {rid, patch:{f:v|null}}  edit -- only the changed fields; null clears one.
 *                            json_patch() merges per FIELD, so two people in
 *                            different columns of one row never clobber each other
 *   {rid, del:true}          tombstone
 *
 * With no DB binding this answers {mode:'solo'} and the page falls back to the
 * old single-screen editor. catalog_server.py 404s this path, so the local
 * editor takes the same fallback.
 *
 * Binding (Pages project settings): DB -> the campus-draft D1 database.
 */

import { config, github, decodeBase64, parseProducts, CATEGORIES } from './catalog.js';

const PRESENCE_ALIVE = 45 * 1000;       // heartbeats this fresh count as "here"
const PRESENCE_PURGE = 10 * 60 * 1000;  // rows older than this are dropped

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// Schema is created lazily, so there is nothing to paste into the D1 console:
// bind an empty database and it initialises itself on first use.
let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS draft_rows(' +
               'rid TEXT PRIMARY KEY, pos REAL NOT NULL, seq INTEGER NOT NULL, ' +
               'deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS draft_rows_seq ON draft_rows(seq)'),
    db.prepare('CREATE TABLE IF NOT EXISTS draft_meta(k TEXT PRIMARY KEY, v TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS draft_presence(' +
               'client TEXT PRIMARY KEY, name TEXT, rid TEXT, ts INTEGER)'),
    db.prepare("INSERT OR IGNORE INTO draft_meta(k,v) VALUES ('seq','0'),('epoch','1')")
  ]);
  ready = true;
}

const SEQ = "(SELECT v+0 FROM draft_meta WHERE k='seq')";
const putMeta = (db, k, v) => db
  .prepare('INSERT INTO draft_meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2')
  .bind(k, v);

async function meta(db) {
  const got = await db.prepare('SELECT k,v FROM draft_meta').all();
  const out = {};
  got.results.forEach((r) => { out[r.k] = r.v; });
  return out;
}

// Throw the draft away and rebuild it from js/products.js on GitHub. Runs on
// first use (empty database) and on an explicit reset. The epoch bump tells
// every connected editor to reload its table from scratch.
async function seed(db, env) {
  const cfg = config(env);
  const res = await github(cfg, 'GET');
  if (!res.ok) {
    throw new Error('GitHub would not return the catalog to seed the draft (HTTP ' +
                    res.status + '). ' +
                    (res.data && res.data.message ? res.data.message : ''));
  }
  const products = parseProducts(decodeBase64(res.data.content));
  const stmts = [
    db.prepare('DELETE FROM draft_rows'),
    db.prepare("UPDATE draft_meta SET v=v+1 WHERE k='seq'"),
    db.prepare("UPDATE draft_meta SET v=v+1 WHERE k='epoch'"),
    putMeta(db, 'base_sha', res.data.sha),
    putMeta(db, 'source', 'github:' + cfg.repo + '@' + cfg.branch)
  ];
  products.forEach((p, i) => stmts.push(
    db.prepare('INSERT INTO draft_rows(rid,pos,seq,deleted,data) VALUES(?1,?2,' + SEQ + ',0,?3)')
      .bind(crypto.randomUUID(), i + 1, JSON.stringify(p))));
  await db.batch(stmts);
  // A freshly seeded draft matches GitHub exactly, so record a synthetic save
  // marker at the current counter -- "unpublished changes" then starts false.
  // commit:'' also keeps the editors from announcing it as a real save.
  const m = await meta(db);
  await putMeta(db, 'save', JSON.stringify({
    who: '', at: Date.now(), count: products.length, seq: Number(m.seq), commit: ''
  })).run();
}

async function snapshot(db, env, since) {
  let m = await meta(db);
  if (!m.base_sha) { await seed(db, env); m = await meta(db); since = 0; }

  const rows = since > 0
    ? (await db.prepare('SELECT rid,pos,seq,deleted,data FROM draft_rows WHERE seq>?1')
        .bind(since).all()).results
    : (await db.prepare('SELECT rid,pos,seq,deleted,data FROM draft_rows WHERE deleted=0')
        .all()).results;

  const presence = (await db.prepare('SELECT client,name,rid,ts FROM draft_presence WHERE ts>?1')
    .bind(Date.now() - PRESENCE_ALIVE).all()).results;

  const out = {
    mode: 'sync',
    epoch: Number(m.epoch),
    seq: Number(m.seq),
    full: since === 0,
    rows: rows.map((r) => ({
      rid: r.rid, pos: r.pos, seq: r.seq, del: !!r.deleted, data: JSON.parse(r.data)
    })),
    presence,
    save: m.save ? JSON.parse(m.save) : null,
    reset: m.reset ? JSON.parse(m.reset) : null
  };
  if (since === 0) { out.categories = CATEGORIES; out.source = m.source || ''; }
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json(200, { mode: 'solo' });
  try {
    await ensure(env.DB);
    const since = Math.max(0,
      parseInt(new URL(request.url).searchParams.get('since') || '0', 10) || 0);
    return json(200, await snapshot(env.DB, env, since));
  } catch (e) {
    return json(500, { error: e.message });
  }
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return json(200, { mode: 'solo' });

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }

  try {
    await ensure(db);
    const since = Math.max(0, Number(body.since) || 0);
    const client = String(body.client || '').slice(0, 64);
    const name = String(body.name || '').slice(0, 40);

    if (body.reset) {
      await seed(db, env);
      await putMeta(db, 'reset', JSON.stringify({ who: name, at: Date.now() })).run();
      return json(200, await snapshot(db, env, 0));
    }

    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : [];
    const stmts = [];
    ops.forEach((op) => {
      const rid = op && typeof op.rid === 'string' ? op.rid.slice(0, 64) : '';
      if (!rid) return;
      if (op.del) {
        stmts.push(db.prepare('UPDATE draft_rows SET deleted=1, seq=' + SEQ + ' WHERE rid=?1')
          .bind(rid));
      } else if (op.data && typeof op.data === 'object') {
        // Whole row (Add / Copy). On a retried create, json_patch simply
        // rewrites every field, which is the same row again.
        const pos = Number(op.pos);
        stmts.push(db.prepare(
          'INSERT INTO draft_rows(rid,pos,seq,deleted,data) VALUES(?1,?2,' + SEQ + ',0,json(?3)) ' +
          'ON CONFLICT(rid) DO UPDATE SET pos=?2, deleted=0, seq=' + SEQ + ', data=json_patch(data,?3)')
          .bind(rid, isFinite(pos) ? pos : 1e9, JSON.stringify(op.data)));
      } else if (op.patch && typeof op.patch === 'object') {
        // Field-level merge; a null value removes the field. A patch for a rid
        // this database has never seen (a reset race) starts a partial row --
        // harmless, validation at save time reports it like any other gap.
        // deleted is deliberately left alone: typing into a row somebody just
        // deleted must not resurrect it.
        stmts.push(db.prepare(
          'INSERT INTO draft_rows(rid,pos,seq,deleted,data) VALUES(?1,1e9,' + SEQ + ',0,json(?2)) ' +
          'ON CONFLICT(rid) DO UPDATE SET seq=' + SEQ + ', data=json_patch(data,?2)')
          .bind(rid, JSON.stringify(op.patch)));
      }
    });
    if (stmts.length) {
      stmts.unshift(db.prepare("UPDATE draft_meta SET v=v+1 WHERE k='seq'"));
      await db.batch(stmts);
    }

    if (client) {
      if (body.presence !== undefined) {
        await db.prepare(
          'INSERT INTO draft_presence(client,name,rid,ts) VALUES(?1,?2,?3,?4) ' +
          'ON CONFLICT(client) DO UPDATE SET name=?2, rid=?3, ts=?4')
          .bind(client, name, (body.presence && body.presence.rid) || null, Date.now()).run();
        await db.prepare('DELETE FROM draft_presence WHERE ts<?1')
          .bind(Date.now() - PRESENCE_PURGE).run();
      } else {
        // Any contact keeps the heartbeat fresh between presence sends.
        await db.prepare('UPDATE draft_presence SET ts=?2 WHERE client=?1')
          .bind(client, Date.now()).run();
      }
    }

    return json(200, await snapshot(db, env, since));
  } catch (e) {
    return json(500, { error: e.message });
  }
}
