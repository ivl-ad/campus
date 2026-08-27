/*
 * /api/catalog -- the hosted half of the catalog editor.
 *
 *   GET   read js/products.js straight from GitHub (the source of truth)
 *   POST  commit an edited catalog back to GitHub
 *
 * GitHub, not the deployed copy, is read on GET so the editor always starts
 * from the newest catalog even in the minute before Pages finishes deploying.
 * The file's git blob sha travels with it and is sent back on save, so if
 * somebody else saved in the meantime GitHub rejects the write instead of one
 * person silently overwriting the other.
 *
 * Committing js/products.js is all this does. The GitHub Action in
 * .github/workflows/rebuild-listings.yml then runs build_listings.py to re-bake
 * store.html and index.html, and Pages redeploys from that commit.
 *
 * Environment (Pages project settings):
 *   EDITOR_PASSWORD  secret  shared password, checked by functions/api/_middleware.js
 *   GITHUB_TOKEN     secret  fine-grained PAT, Contents: read and write, this repo only
 *   GITHUB_REPO      plain   e.g. ivl-ad/campus
 *   GITHUB_BRANCH    plain   optional, defaults to main
 */

const FILE = 'js/products.js';

const FIELD_ORDER = ['id', 'name', 'cat', 'catLabel', 'merchant', 'merchantSlug',
                     'url', 'img', 'price', 'desc', 'note'];

// Must match SITE_CATEGORIES in build_listings.py.
export const CATEGORIES = [
  ['dorm-living-essentials', 'Dorm & Living Essentials'],
  ['academic-essentials', 'Academic Essentials'],
  ['personal-lifestyle', 'Personal Lifestyle'],
  ['event-tickets-travel', 'Event Tickets & Travel'],
  ['financial-services', 'Financial Services'],
  ['laundry-cleaning', 'Laundry & Cleaning'],
  ['living-social-spaces', 'Living & Social Spaces'],
  ['bathroom', 'Bathroom'],
  ['kitchen-dining', 'Kitchen & Dining'],
  ['bedroom-study', 'Bedroom & Study']
];
const LABEL = new Map(CATEGORIES);

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// ---------------------------------------------------------------- base64
// The catalog contains em dashes and curly quotes, so bytes must round-trip
// through UTF-8 rather than being treated as latin-1 by atob/btoa.
export function decodeBase64(b64) {
  const binary = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ------------------------------------------------------------- products.js
export function parseProducts(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = stripped.indexOf('[');
  const close = stripped.lastIndexOf(']');
  if (open < 0 || close < 0) throw new Error('no product array found in ' + FILE);
  return JSON.parse(stripped.slice(open, close + 1).replace(/,(\s*])/g, '$1'));
}

export function readHeader(source) {
  const i = source.indexOf('window.PRODUCTS');
  return i > 0 ? source.slice(0, i).replace(/\n+$/, '') : '';
}

export function tidy(product) {
  const out = {};
  const put = (k) => {
    let v = product[k];
    if (v === undefined || v === null || v === '') return;
    // JSON has one number type, so 199.0 arrives as 199. Keep prices as
    // floats so the committed file stays byte-stable between saves.
    if (k === 'price' && typeof v === 'number' && isFinite(v)) {
      out[k] = v;
      return;
    }
    out[k] = v;
  };
  FIELD_ORDER.forEach(put);
  Object.keys(product).forEach((k) => { if (!(k in out)) put(k); });
  return out;
}

export function priceLiteral(value) {
  // Number.isInteger(199) -> "199.0", matching how Python writes the file.
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

export function serialise(product) {
  const tidied = tidy(product);
  const parts = Object.keys(tidied).map((k) => {
    const v = tidied[k];
    if (k === 'price' && typeof v === 'number') {
      return JSON.stringify(k) + ': ' + priceLiteral(v);
    }
    return JSON.stringify(k) + ': ' + JSON.stringify(v);
  });
  return '{' + parts.join(', ') + '}';
}

export function render(header, products) {
  const lines = [];
  if (header.trim()) lines.push(header);
  lines.push('window.PRODUCTS = [');
  // Trailing comma on every entry, including the last -- that is how the file
  // is written locally, and both the browser and the build script accept it.
  products.forEach((p) => lines.push('  ' + serialise(p) + ','));
  lines.push('];');
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------- validation
// Deliberately the same rules as validate() in build_listings.py, so the
// editor can never commit something the build would then refuse.
export function validate(products) {
  const errors = [];
  const seen = new Map();
  products.forEach((p, i) => {
    let where = 'product #' + (i + 1);
    if (typeof p !== 'object' || p === null) { errors.push(where + ': not an object'); return; }
    if (p.id) where += ' (' + p.id + ')';

    ['id', 'name', 'cat', 'catLabel', 'merchant', 'merchantSlug', 'url', 'img']
      .forEach((f) => {
        if (!p[f] || !String(p[f]).trim()) errors.push(where + ': missing "' + f + '"');
      });

    if (p.id) {
      if (seen.has(p.id)) {
        errors.push(where + ': duplicate id -- also used by product #' + seen.get(p.id));
      }
      seen.set(p.id, i + 1);
    }
    if (p.cat && !LABEL.has(p.cat)) {
      errors.push(where + ': unknown category "' + p.cat + '"');
    }
    if ('price' in p && (typeof p.price !== 'number' || !isFinite(p.price) || p.price < 0)) {
      errors.push(where + ': price must be a positive number, or left out');
    }
    if (p.merchantSlug && !/^[a-z0-9][a-z0-9-]*$/.test(String(p.merchantSlug))) {
      errors.push(where + ': merchantSlug must be lowercase letters, numbers and dashes');
    }
  });
  return errors;
}

// ----------------------------------------------------------------- GitHub
export function config(env) {
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!repo || !token) {
    throw new Error('GITHUB_REPO and GITHUB_TOKEN must be set on this Pages project ' +
                    'before the editor can read or save the catalog.');
  }
  return { repo, token, branch };
}

export async function github(cfg, method, body) {
  const url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + FILE +
              (method === 'GET' ? '?ref=' + encodeURIComponent(cfg.branch) : '');
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mycampuskorner-catalog-editor',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep raw below */ }
  return { ok: res.ok, status: res.status, data, text };
}

// -------------------------------------------------------------- handlers
export async function onRequestGet({ env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  const res = await github(cfg, 'GET');
  if (!res.ok) {
    return json(res.status === 404 ? 404 : 502, {
      error: 'GitHub would not return ' + FILE + ' (HTTP ' + res.status + '). ' +
             (res.data && res.data.message ? res.data.message : '') +
             (res.status === 404 ? ' Check GITHUB_REPO and GITHUB_BRANCH.' : '') +
             (res.status === 401 || res.status === 403
               ? ' Check GITHUB_TOKEN has Contents: read and write on this repo.' : '')
    });
  }

  let source, products;
  try {
    source = decodeBase64(res.data.content);
    products = parseProducts(source);
  } catch (e) {
    return json(500, { error: 'could not read ' + FILE + ': ' + e.message });
  }

  return json(200, {
    products,
    sha: res.data.sha,           // sent back on save as an overwrite guard
    categories: CATEGORIES,
    source: 'github:' + cfg.repo + '@' + cfg.branch
  });
}

export async function onRequestPost({ request, env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }
  let products = body && body.products;
  let draftSeq = 0;
  if (body && body.fromDraft) {
    // The synced editor sends no products: publish the shared draft exactly as
    // it stands in D1 (see functions/api/draft.js), including edits made on
    // other screens. Counter first, then rows -- an edit landing in between
    // shows as "unpublished" afterwards instead of being silently published.
    if (!env.DB) return json(400, { error: 'The shared draft has no DB binding on this Pages project.' });
    draftSeq = Number(await env.DB.prepare("SELECT v FROM draft_meta WHERE k='seq'").first('v')) || 0;
    const got = await env.DB.prepare('SELECT data FROM draft_rows WHERE deleted=0 ORDER BY pos, rid').all();
    products = got.results.map((r) => JSON.parse(r.data));
  }
  if (!Array.isArray(products)) return json(400, { error: 'products must be a list' });
  if (!products.length) return json(400, { error: 'refusing to save an empty catalog' });

  const errors = validate(products);
  if (errors.length) return json(400, { error: 'validation failed', errors });

  // Re-read so we keep the comment header and can see the current sha.
  const current = await github(cfg, 'GET');
  if (!current.ok) {
    return json(502, { error: 'could not read the current ' + FILE +
                              ' from GitHub (HTTP ' + current.status + ')' });
  }

  let header = '';
  try { header = readHeader(decodeBase64(current.data.content)); } catch (e) { /* header optional */ }

  if (body.fromDraft) {
    // The draft remembers the sha it was seeded from; a mismatch means somebody
    // committed js/products.js directly in git while the draft was live.
    const base = await env.DB.prepare("SELECT v FROM draft_meta WHERE k='base_sha'").first('v');
    if (base && base !== current.data.sha) {
      return json(409, {
        error: 'js/products.js changed on GitHub outside this editor (a direct commit).\n' +
               'Press "Reset draft" to start over from that newer version (unpublished ' +
               'edits are discarded), or reconcile the two in git first.'
      });
    }
  } else if (body.sha && body.sha !== current.data.sha) {
    return json(409, {
      error: 'Somebody else saved the catalog while this page was open.\n' +
             'Press Reload to pick up their version, then make your changes again. ' +
             'Nothing has been overwritten.'
    });
  }

  const content = render(header, products);
  const who = (body.author || '').toString().slice(0, 40).replace(/[^\w .@-]/g, '');
  const message = 'Catalog: ' + products.length + ' products, edited in the web editor' +
                  (who ? ' by ' + who : '');

  const put = await github(cfg, 'PUT', {
    message,
    content: encodeBase64(content),
    sha: current.data.sha,
    branch: cfg.branch
  });

  if (!put.ok) {
    return json(put.status === 409 ? 409 : 502, {
      error: 'GitHub refused the commit (HTTP ' + put.status + '). ' +
             (put.data && put.data.message ? put.data.message : '')
    });
  }

  const newSha = put.data && put.data.content ? put.data.content.sha : null;
  const commit = put.data && put.data.commit ? put.data.commit.sha.slice(0, 7) : null;
  if (body.fromDraft && newSha) {
    // Tell every open editor: base_sha keeps the next out-of-band check honest,
    // save.seq is what the "unpublished changes" indicator compares against.
    const note = JSON.stringify({ who: who, at: Date.now(), count: products.length,
                                  seq: draftSeq, commit: commit || '' });
    const up = (k, v) => env.DB
      .prepare('INSERT INTO draft_meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2')
      .bind(k, v);
    await env.DB.batch([up('base_sha', newSha), up('save', note)]);
  }

  return json(200, {
    ok: true,
    count: products.length,
    sha: newSha,
    commit: commit,
    message: 'Committed to ' + cfg.repo + '@' + cfg.branch +
             '. The site rebuilds and redeploys in about a minute.'
  });
}
