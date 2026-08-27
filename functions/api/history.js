/*
 * /api/history -- every saved version of the catalog, and restore.
 *
 * There is nothing to write at save time: every Save already commits
 * js/products.js to GitHub, so git IS the backup store -- one backup per
 * save, kept forever, including saves made before this endpoint existed.
 *
 *   GET          the last 100 saved versions, newest first
 *   POST {sha}   load that version into the shared draft
 *
 * Restore is DRAFT-ONLY by design: it repopulates the D1 draft with the old
 * version and bumps the epoch so every open editor reloads to it -- and that
 * is all. No commit, no rebuild, no file is written or edited; the live site
 * does not change. The restored table sits in the editor as unpublished
 * changes, and pressing Save is the one and only way to publish it (which is
 * also what makes the restore itself land in this history).
 *
 * base_sha is deliberately left alone: the draft still overwrites the same
 * live version on Save, and the out-of-band-commit check keeps working.
 *
 * The fine-grained token from SETUP.md step 1 already covers this: listing
 * commits and reading a file at a ref are both "Contents: read".
 */

import { config, decodeBase64, parseProducts } from './catalog.js';
import { ensure, reseed, putMeta } from './draft.js';

const FILE = 'js/products.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// github() in catalog.js only talks to contents/<FILE> on the branch head;
// history also needs the commits list and contents-at-a-ref, so this is the
// generic read-only variant.
async function gh(cfg, path) {
  const res = await fetch('https://api.github.com/repos/' + cfg.repo + '/' + path, {
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mycampuskorner-catalog-editor'
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* raw below */ }
  return { ok: res.ok, status: res.status, data, text };
}

export async function onRequestGet({ env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  const r = await gh(cfg, 'commits?path=' + encodeURIComponent(FILE) +
                          '&sha=' + encodeURIComponent(cfg.branch) + '&per_page=100');
  if (!r.ok || !Array.isArray(r.data)) {
    return json(502, {
      error: 'GitHub would not list the saved versions (HTTP ' + r.status + '). ' +
             (r.data && r.data.message ? r.data.message : '')
    });
  }
  return json(200, {
    versions: r.data.map((c) => ({
      sha: c.sha,
      at: c.commit && c.commit.committer ? c.commit.committer.date
          : (c.commit && c.commit.author ? c.commit.author.date : null),
      message: c.commit ? String(c.commit.message || '').split('\n')[0] : ''
    }))
  });
}

export async function onRequestPost({ request, env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }
  if (!env.DB) {
    return json(400, { error: 'Restoring needs the shared draft (the DB binding) — ' +
                              'there is nowhere to load the version into without it.' });
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }
  const sha = String(body.sha || '');
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return json(400, { error: 'not a commit sha' });

  const old = await gh(cfg, 'contents/' + FILE + '?ref=' + encodeURIComponent(sha));
  if (!old.ok) {
    return json(502, { error: 'GitHub would not return that version (HTTP ' + old.status + ').' });
  }
  let products;
  try {
    products = parseProducts(decodeBase64(old.data.content));
  } catch (e) {
    return json(400, { error: 'That version cannot be read as a catalog: ' + e.message });
  }

  const who = (body.author || '').toString().slice(0, 40).replace(/[^\w .@-]/g, '');
  try {
    await ensure(env.DB);
    await reseed(env.DB, products);
    await putMeta(env.DB, 'reset', JSON.stringify({
      who, at: Date.now(), note: 'restored version ' + sha.slice(0, 7)
    })).run();
  } catch (e) {
    return json(500, { error: 'Could not load that version into the draft: ' + e.message });
  }

  return json(200, {
    ok: true,
    count: products.length,
    message: 'Loaded ' + products.length + ' products from ' + sha.slice(0, 7) +
             ' into the shared draft — every open editor reloads to it. The live site is ' +
             'untouched until somebody presses Save.'
  });
}
