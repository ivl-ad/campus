/*
 * /api/history -- every saved version of the catalog, and restore.
 *
 * There is nothing to write at save time: every Save already commits
 * js/products.js to GitHub, so git IS the backup store -- one backup per
 * save, kept forever, including saves made before this endpoint existed.
 *
 *   GET          the last 100 saved versions, newest first
 *   POST {sha}   restore the catalog exactly as it was at that commit
 *
 * Restore writes the old content as a NEW commit (history only ever grows;
 * the version being replaced stays restorable), lets the usual GitHub Action
 * rebuild the site, and then reseeds the shared draft in D1 so every open
 * editor reloads the restored table within a poll.
 *
 * The fine-grained token from SETUP.md step 1 already covers this: listing
 * commits and reading a file at a ref are both "Contents: read".
 */

import { config, github, decodeBase64, encodeBase64, parseProducts } from './catalog.js';
import { ensure, seed, putMeta } from './draft.js';

const FILE = 'js/products.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// github() in catalog.js only talks to contents/<FILE>; history also needs
// the commits list and contents-at-a-ref, so this is the generic variant.
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
  let oldText, count;
  try {
    oldText = decodeBase64(old.data.content);
    count = parseProducts(oldText).length;
  } catch (e) {
    return json(400, { error: 'That version cannot be read as a catalog: ' + e.message });
  }

  const current = await github(cfg, 'GET');
  if (!current.ok) {
    return json(502, { error: 'could not read the current ' + FILE +
                              ' (HTTP ' + current.status + ')' });
  }
  if (decodeBase64(current.data.content) === oldText) {
    return json(400, { error: 'That version is identical to the live catalog — nothing to restore.' });
  }

  const who = (body.author || '').toString().slice(0, 40).replace(/[^\w .@-]/g, '');
  const put = await github(cfg, 'PUT', {
    message: 'Catalog: restored ' + count + ' products from version ' + sha.slice(0, 7) +
             (who ? ' by ' + who : ''),
    content: encodeBase64(oldText),
    sha: current.data.sha,
    branch: cfg.branch
  });
  if (!put.ok) {
    return json(put.status === 409 ? 409 : 502, {
      error: 'GitHub refused the restore (HTTP ' + put.status + '). ' +
             (put.data && put.data.message ? put.data.message : '')
    });
  }

  // Reseed the shared draft from the restored catalog and tell every open
  // editor why its table just reloaded.
  if (env.DB) {
    try {
      await ensure(env.DB);
      await seed(env.DB, env);
      await putMeta(env.DB, 'reset', JSON.stringify({
        who, at: Date.now(), note: 'restored version ' + sha.slice(0, 7)
      })).run();
    } catch (e) {
      return json(200, {
        ok: true, count,
        commit: put.data && put.data.commit ? put.data.commit.sha.slice(0, 7) : null,
        message: 'Restored, and the site is rebuilding — but the shared draft could not be ' +
                 'reloaded (' + e.message + '). Press "Reset draft" to pick it up.'
      });
    }
  }

  return json(200, {
    ok: true, count,
    commit: put.data && put.data.commit ? put.data.commit.sha.slice(0, 7) : null,
    message: 'Restored ' + count + ' products from ' + sha.slice(0, 7) +
             '. The site rebuilds in about a minute; every open editor reloads automatically.'
  });
}
