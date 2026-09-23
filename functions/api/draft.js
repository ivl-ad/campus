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
 *   {rid, pos, move:true}    reorder -- pos only, so it never clobbers a field
 *                            somebody else is typing into on that row
 *
 * With no DB binding this answers {mode:'solo'} and the page falls back to the
 * old single-screen editor. catalog_server.py 404s this path, so the local
 * editor takes the same fallback.
 *
 * Several documents share this engine. ?doc=partners on any request selects
 * the home page logo strip (js/partners.js, tables partner_*), ?doc=blog the
 * blog posts (js/blogs.js, blog_*) and ?doc=team the About page team
 * (js/team.js, team_*); anything else is the product catalog, exactly as it
 * always was (tables draft_*). The drafts, counters and presence lists never mix.
 *
 * Binding (Pages project settings): DB -> the campus-draft D1 database.
 */

import { config, github, decodeBase64, parseProducts, CATEGORIES } from './catalog.js';
import { readRemote as readPartners, parsePartners, TABLES as PARTNER_TABLES,
         NO_FILE } from './partners.js';
import { FILE as BLOG_FILE, TABLES as BLOG_TABLES, parseBlog } from './blog.js';
import { FILE as TEAM_FILE, TABLES as TEAM_TABLES, parseTeam } from './team.js';

const PRESENCE_ALIVE = 45 * 1000;       // heartbeats this fresh count as "here"
const PRESENCE_PURGE = 10 * 60 * 1000;  // rows older than this are dropped

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// load() fetches the published list from GitHub to seed the draft from.
export const DOCS = {
  products: {
    rows: 'draft_rows', meta: 'draft_meta', presence: 'draft_presence',
    extra: { categories: CATEGORIES },
    async load(env) {
      const cfg = config(env);
      const res = await github(cfg, 'GET');
      if (!res.ok) {
        throw new Error('GitHub would not return the catalog to seed the draft (HTTP ' +
                        res.status + '). ' +
                        (res.data && res.data.message ? res.data.message : ''));
      }
      return { list: parseProducts(decodeBase64(res.data.content)), sha: res.data.sha,
               source: 'github:' + cfg.repo + '@' + cfg.branch };
    }
  },
  partners: {
    rows: PARTNER_TABLES.rows, meta: PARTNER_TABLES.meta, presence: PARTNER_TABLES.presence,
    extra: {},
    async load(env) {
      const cfg = config(env);
      // Never saved yet: an empty draft, remembered as based on "no file".
      const cur = await readPartners(cfg);
      return { list: cur.exists ? parsePartners(cur.source) : [], sha: cur.sha || NO_FILE,
               source: 'github:' + cfg.repo + '@' + cfg.branch };
    }
  },
  blog: {
    rows: BLOG_TABLES.rows, meta: BLOG_TABLES.meta, presence: BLOG_TABLES.presence,
    extra: {},
    async load(env) {
      const cfg = config(env);
      const cur = await readPartners(cfg, BLOG_FILE);
      const parsed = cur.exists ? parseBlog(cur.source) : { posts: [], categories: [] };
      // The category list travels with full snapshots (see snapshot()), so the
      // editor's dropdown matches the file it was seeded from.
      return { list: parsed.posts, sha: cur.sha || NO_FILE,
               source: 'github:' + cfg.repo + '@' + cfg.branch,
               extra: { blogCategories: parsed.categories } };
    }
  },
  team: {
    rows: TEAM_TABLES.rows, meta: TEAM_TABLES.meta, presence: TEAM_TABLES.presence,
    extra: {},
    async load(env) {
      const cfg = config(env);
      const cur = await readPartners(cfg, TEAM_FILE);
      return { list: cur.exists ? parseTeam(cur.source) : [], sha: cur.sha || NO_FILE,
               source: 'github:' + cfg.repo + '@' + cfg.branch };
    }
  }
};

export function docFor(request) {
  const name = new URL(request.url).searchParams.get('doc');
  return name && name !== 'products' && Object.prototype.hasOwnProperty.call(DOCS, name)
    ? DOCS[name] : DOCS.products;
}

// Schema is created lazily, so there is nothing to paste into the D1 console:
// bind an empty database and it initialises itself on first use.
export async function ensure(db, doc = DOCS.products) {
  if (doc.ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS ' + doc.rows + '(' +
               'rid TEXT PRIMARY KEY, pos REAL NOT NULL, seq INTEGER NOT NULL, ' +
               'deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS ' + doc.rows + '_seq ON ' + doc.rows + '(seq)'),
    db.prepare('CREATE TABLE IF NOT EXISTS ' + doc.meta + '(k TEXT PRIMARY KEY, v TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS ' + doc.presence + '(' +
               'client TEXT PRIMARY KEY, name TEXT, rid TEXT, ts INTEGER)'),
    db.prepare('INSERT OR IGNORE INTO ' + doc.meta + "(k,v) VALUES ('seq','0'),('epoch','1')")
  ]);
  doc.ready = true;
}

const seqOf = (doc) => '(SELECT v+0 FROM ' + doc.meta + " WHERE k='seq')";
export const putMeta = (db, k, v, doc = DOCS.products) => db
  .prepare('INSERT INTO ' + doc.meta + '(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2')
  .bind(k, v);

async function meta(db, doc) {
  const got = await db.prepare('SELECT k,v FROM ' + doc.meta).all();
  const out = {};
  got.results.forEach((r) => { out[r.k] = r.v; });
  return out;
}

// Replace the draft's rows with this list, atomically, bumping the
// epoch so every connected editor reloads its table. Touches nothing else:
// base_sha and the save marker are the caller's business, which is what lets
// /api/history load an OLD version in as unpublished work (draft differs from
// the live site until somebody presses Save).
export async function reseed(db, products, extraMeta, doc = DOCS.products) {
  const stmts = [
    db.prepare('DELETE FROM ' + doc.rows),
    db.prepare('UPDATE ' + doc.meta + " SET v=v+1 WHERE k='seq'"),
    db.prepare('UPDATE ' + doc.meta + " SET v=v+1 WHERE k='epoch'")
  ];
  (extraMeta || []).forEach((kv) => stmts.push(putMeta(db, kv[0], kv[1], doc)));
  products.forEach((p, i) => stmts.push(
    db.prepare('INSERT INTO ' + doc.rows + '(rid,pos,seq,deleted,data) VALUES(?1,?2,' +
               seqOf(doc) + ',0,?3)')
      .bind(crypto.randomUUID(), i + 1, JSON.stringify(p))));
  await db.batch(stmts);
}

// Throw the draft away and rebuild it from the published file on GitHub. Runs
// on first use (empty database) and on an explicit reset.
export async function seed(db, env, doc = DOCS.products) {
  const got = await doc.load(env);
  const meta0 = [['base_sha', got.sha], ['source', got.source]];
  if (got.extra) meta0.push(['extra', JSON.stringify(got.extra)]);
  await reseed(db, got.list, meta0, doc);
  // A freshly seeded draft matches GitHub exactly, so record a synthetic save
  // marker at the current counter -- "unpublished changes" then starts false.
  // commit:'' also keeps the editors from announcing it as a real save.
  const m = await meta(db, doc);
  await putMeta(db, 'save', JSON.stringify({
    who: '', at: Date.now(), count: got.list.length, seq: Number(m.seq), commit: ''
  }), doc).run();
}

async function snapshot(db, env, since, doc) {
  let m = await meta(db, doc);
  if (!m.base_sha) { await seed(db, env, doc); m = await meta(db, doc); since = 0; }

  const rows = since > 0
    ? (await db.prepare('SELECT rid,pos,seq,deleted,data FROM ' + doc.rows + ' WHERE seq>?1')
        .bind(since).all()).results
    : (await db.prepare('SELECT rid,pos,seq,deleted,data FROM ' + doc.rows + ' WHERE deleted=0')
        .all()).results;

  const presence = (await db.prepare('SELECT client,name,rid,ts FROM ' + doc.presence +
                                     ' WHERE ts>?1')
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
  if (since === 0) {
    Object.assign(out, doc.extra);
    if (m.extra) { try { Object.assign(out, JSON.parse(m.extra)); } catch (e) { /* ignore */ } }
    out.source = m.source || '';
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json(200, { mode: 'solo' });
  const doc = docFor(request);
  try {
    await ensure(env.DB, doc);
    const since = Math.max(0,
      parseInt(new URL(request.url).searchParams.get('since') || '0', 10) || 0);
    return json(200, await snapshot(env.DB, env, since, doc));
  } catch (e) {
    return json(500, { error: e.message });
  }
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return json(200, { mode: 'solo' });
  const doc = docFor(request);
  const SEQ = seqOf(doc);

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }

  try {
    await ensure(db, doc);
    const since = Math.max(0, Number(body.since) || 0);
    const client = String(body.client || '').slice(0, 64);
    const name = String(body.name || '').slice(0, 40);

    if (body.reset) {
      await seed(db, env, doc);
      await putMeta(db, 'reset', JSON.stringify({ who: name, at: Date.now() }), doc).run();
      return json(200, await snapshot(db, env, 0, doc));
    }

    // Edits are for the draft the editor loaded (body.epoch). After a Reset or
    // a History restore their rows are gone, and applying them would start
    // stray half-rows ({"url": ...} with no name) that then block every Save.
    // So each statement only runs while the epoch still matches -- checked
    // inside the batch, which is one transaction -- and otherwise nothing is
    // written; the reply's new epoch makes that editor reload its table.
    const E = Number(body.epoch);
    const same = Number.isInteger(E)
      ? '(SELECT v+0 FROM ' + doc.meta + " WHERE k='epoch') = " + E : '1';
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 500) : [];
    const stmts = [];
    ops.forEach((op) => {
      const rid = op && typeof op.rid === 'string' ? op.rid.slice(0, 64) : '';
      if (!rid) return;
      if (op.del) {
        stmts.push(db.prepare('UPDATE ' + doc.rows + ' SET deleted=1, seq=' + SEQ +
                              ' WHERE rid=?1 AND ' + same)
          .bind(rid));
      } else if (op.data && typeof op.data === 'object') {
        // Whole row (Add / Copy). On a retried create, json_patch simply
        // rewrites every field, which is the same row again.
        const pos = Number(op.pos);
        stmts.push(db.prepare(
          'INSERT INTO ' + doc.rows + '(rid,pos,seq,deleted,data) SELECT ?1,?2,' + SEQ + ',0,json(?3) ' +
          'WHERE ' + same + ' ' +
          'ON CONFLICT(rid) DO UPDATE SET pos=?2, deleted=0, seq=' + SEQ + ', data=json_patch(data,?3)')
          .bind(rid, isFinite(pos) ? pos : 1e9, JSON.stringify(op.data)));
      } else if (op.move) {
        // Reorder: only pos changes. A move for a row this database has never
        // seen simply matches nothing.
        const pos = Number(op.pos);
        if (!isFinite(pos)) return;
        stmts.push(db.prepare('UPDATE ' + doc.rows + ' SET pos=?2, seq=' + SEQ +
                              ' WHERE rid=?1 AND ' + same)
          .bind(rid, pos));
      } else if (op.patch && typeof op.patch === 'object') {
        // Field-level merge; a null value removes the field. A patch for a rid
        // this draft has never seen (an editor too old to send its epoch, in a
        // reset race) starts a partial row, which Save then reports by name.
        // deleted is deliberately left alone: typing into a row somebody just
        // deleted must not resurrect it.
        stmts.push(db.prepare(
          'INSERT INTO ' + doc.rows + '(rid,pos,seq,deleted,data) SELECT ?1,1e9,' + SEQ + ',0,json(?2) ' +
          'WHERE ' + same + ' ' +
          'ON CONFLICT(rid) DO UPDATE SET seq=' + SEQ + ', data=json_patch(data,?2)')
          .bind(rid, JSON.stringify(op.patch)));
      }
    });
    if (stmts.length) {
      stmts.unshift(db.prepare('UPDATE ' + doc.meta + " SET v=v+1 WHERE k='seq' AND " + same));
      await db.batch(stmts);
    }

    if (client) {
      if (body.presence !== undefined) {
        await db.prepare(
          'INSERT INTO ' + doc.presence + '(client,name,rid,ts) VALUES(?1,?2,?3,?4) ' +
          'ON CONFLICT(client) DO UPDATE SET name=?2, rid=?3, ts=?4')
          .bind(client, name, (body.presence && body.presence.rid) || null, Date.now()).run();
        await db.prepare('DELETE FROM ' + doc.presence + ' WHERE ts<?1')
          .bind(Date.now() - PRESENCE_PURGE).run();
      } else {
        // Any contact keeps the heartbeat fresh between presence sends.
        await db.prepare('UPDATE ' + doc.presence + ' SET ts=?2 WHERE client=?1')
          .bind(client, Date.now()).run();
      }
    }

    return json(200, await snapshot(db, env, since, doc));
  } catch (e) {
    return json(500, { error: e.message });
  }
}
