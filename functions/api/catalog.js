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

import { draftMarks, settleBase, recordSave, epochMoved, epochChanged, RACE_MESSAGE, RESET_MESSAGE,
         planOutside, adoptMerged, outsideNote, draftRows, rowRules } from '../_shared/draft-save.js';
import { jsValue, extractArray, headerBefore } from '../_shared/js-data.js';

const FILE = 'js/products.js';

const FIELD_ORDER = ['id', 'name', 'cat', 'catLabel', 'merchant', 'merchantSlug',
                     'url', 'img', 'imgFrom', 'price', 'desc', 'note'];

// Where a product's image is served from. Absent (the default) = the copy
// fetch_images.py keeps on this site; "retailer" = always the img address
// itself, for an affiliate creative whose network counts its views.
export const IMG_FROM = ['site', 'retailer'];

/*
 * The built-in categories, in menu order. The editor can add more ("+ New
 * category…" in the category menu): a product is simply given a new cat and
 * catLabel, and Save adds that category to the list kept in js/products.js
 * itself, as window.PRODUCT_CATEGORIES -- the one list the build script, the
 * category pages and the sitemap all read. This list is the fallback for a
 * file that has none yet, and these ten are always kept (the menus in every
 * page link to them). Must match SITE_CATEGORIES in build_listings.py and
 * BUILT_IN in js/listing-page.js.
 */
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
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// The file's own category list, as [[id, label], ...]; [] when it has none.
export function fileCategories(source) {
  if (!/^[ \t]*window\.PRODUCT_CATEGORIES\s*=/m.test(source || '')) return [];
  return extractArray(source, 'PRODUCT_CATEGORIES')
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' &&
                   SLUG_RE.test(c.id.trim()) && typeof c.label === 'string' && c.label.trim())
    .map((c) => [c.id.trim(), c.label.trim()]);
}

/*
 * Every category, in menu order: the file's list, any built-in one it lacks,
 * then any category a product names that neither has, labelled from that
 * product -- which is how "+ New category…" becomes a real category. With
 * prune (on Save), an added category no product uses any more is dropped, so
 * one that was tried and emptied again does not linger as an empty page.
 */
export function categoryList(source, products, prune) {
  const out = [], seen = new Set();
  const add = (id, label) => {
    id = typeof id === 'string' ? id.trim() : '';
    label = typeof label === 'string' ? label.trim() : '';
    if (id && label && SLUG_RE.test(id) && !seen.has(id)) { seen.add(id); out.push([id, label]); }
  };
  let listed = [];
  try { listed = fileCategories(source); } catch (e) { /* unreadable list: built-ins below */ }
  listed.forEach(([id, label]) => add(id, label));
  CATEGORIES.forEach(([id, label]) => add(id, label));
  (products || []).forEach((p) => { if (p && typeof p === 'object') add(p.cat, p.catLabel); });
  if (!prune) return out;
  const used = new Set((products || []).map((p) => p && p.cat));
  return out.filter(([id]) => LABEL.has(id) || used.has(id));
}

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
export const parseProducts = (source) => extractArray(source, 'PRODUCTS');
export const readHeader = (source) => headerBefore(source, 'PRODUCTS');

export function tidy(product, labels = LABEL) {
  const out = {};
  const put = (k) => {
    let v = product[k];
    // catLabel is never the editor's to get right: it follows cat, decided
    // here so every copy of it agrees. (validate() has already refused an
    // unknown cat by the time anything is rendered.) The editor used to
    // refresh it while drawing each row, which meant renaming a category in
    // CATEGORIES never reached products whose dropdown nobody touched.
    if (k === 'catLabel' && labels.has(product.cat)) v = labels.get(product.cat);
    if (k === 'imgFrom' && v === 'site') return;     // the default is never written
    if (v === undefined || v === null || v === '') return;
    // Whole cents, so every page shows the same figure (the build scripts
    // and the browser would each round 19.999 their own way). JSON has one
    // number type, so 199.0 arrives as 199; priceLiteral writes it back as
    // 199.0, keeping the committed file byte-stable between saves.
    if (k === 'price' && typeof v === 'number' && isFinite(v)) {
      out[k] = Math.round(v * 100) / 100;
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

export function serialise(product, labels) {
  const tidied = tidy(product, labels);
  const parts = Object.keys(tidied).map((k) => {
    const v = tidied[k];
    if (k === 'price' && typeof v === 'number') {
      return JSON.stringify(k) + ': ' + priceLiteral(v);
    }
    return JSON.stringify(k) + ': ' + jsValue(v);
  });
  return '{' + parts.join(', ') + '}';
}

// categories: [[id, label], ...] from categoryList(). Each product's catLabel
// is set from it, and it is written after the products as
// window.PRODUCT_CATEGORIES.
export function render(header, products, categories) {
  const labels = categories ? new Map(categories) : LABEL;
  const lines = [];
  if (header.trim()) lines.push(header);
  lines.push('window.PRODUCTS = [');
  // Trailing comma on every entry, including the last -- that is how the file
  // is written locally, and both the browser and the build script accept it.
  products.forEach((p) => lines.push('  ' + serialise(p, labels) + ','));
  lines.push('];');
  if (categories) {
    lines.push('');
    lines.push('// Product categories, in menu order. The editor adds one when a product is');
    lines.push('// given a new category; the store filters and category pages read this list.');
    lines.push('window.PRODUCT_CATEGORIES = [');
    categories.forEach(([id, label]) => lines.push('  {"id": ' + jsValue(id) + ', "label": ' +
                                                   jsValue(label) + '},'));
    lines.push('];');
  }
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
        else if (typeof p[f] !== 'string') errors.push(where + ': "' + f + '" must be text');
      });
    ['desc', 'note'].forEach((f) => {
      if (p[f] !== undefined && p[f] !== null && typeof p[f] !== 'string') {
        errors.push(where + ': "' + f + '" must be text');
      }
    });

    // The id is the product page's address (product?id=...): anything but
    // lowercase letters, digits and dashes makes a broken link somewhere.
    if (p.id && !/^[a-z0-9][a-z0-9-]*$/.test(String(p.id))) {
      errors.push(where + ': id must be lowercase letters, numbers and dashes');
    }
    if (p.id) {
      if (seen.has(p.id)) {
        errors.push(where + ': duplicate id -- also used by product #' + seen.get(p.id));
      }
      seen.set(p.id, i + 1);
    }
    // Any well-formed category is accepted: one this list does not have yet
    // is a new category, and Save adds it (see categoryList()).
    if (p.cat && typeof p.cat === 'string' && !SLUG_RE.test(p.cat)) {
      errors.push(where + ': category id "' + p.cat + '" must be lowercase letters, numbers and dashes');
    }
    if (p.imgFrom !== undefined && p.imgFrom !== null && p.imgFrom !== '' &&
        IMG_FROM.indexOf(p.imgFrom) < 0) {
      errors.push(where + ': imgFrom must be "site" or "retailer" (or left out)');
    }
    if ('price' in p && (typeof p.price !== 'number' || !isFinite(p.price) || p.price < 0)) {
      errors.push(where + ': price must be a positive number, or left out');
    }
    if (p.merchantSlug && !/^[a-z0-9][a-z0-9-]*$/.test(String(p.merchantSlug))) {
      errors.push(where + ': merchantSlug must be lowercase letters, numbers and dashes');
    }
    // url becomes the Buy button's link and img an image source on the site:
    // only real web addresses (a "javascript:" link would run on the page).
    if (p.url && !/^https?:\/\/[^\s<>"']+$/i.test(String(p.url).trim())) {
      errors.push(where + ': url must be a full web address starting with https://');
    }
    if (p.img && !/^(https?:\/\/[^\s<>"']+|\/?images\/[^\s<>"']+)$/i.test(String(p.img).trim())) {
      errors.push(where + ': img must be a full https:// image address (or a path under images/)');
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
  // GITHUB_API is only for local testing against a stand-in server; leave it
  // unset on Cloudflare.
  const api = String(env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
  return { repo, token, branch, api };
}

/*
 * file defaults to the catalog; /api/partners passes js/partners.js.
 *
 * Every GET is deliberately un-cacheable. GitHub answers an authenticated
 * read of this endpoint with "Cache-Control: private, max-age=60", and it
 * serves the file from a replica, so a plain read can hand back the PREVIOUS
 * version of a file for a few seconds after a write, and a Save that believed
 * one would take a perfectly ordinary Save for a commit made outside the
 * editor. So: a unique
 * query string (GitHub ignores unknown params), no-cache headers, and
 * cacheTtl 0 for Cloudflare's own fetch cache. See settleBase() in
 * _shared/draft-save.js, which re-reads through here before trusting a
 * mismatch.
 */
export async function github(cfg, method, body, file) {
  const url = (cfg.api || 'https://api.github.com') + '/repos/' + cfg.repo + '/contents/' + (file || FILE) +
              (method === 'GET'
                ? '?ref=' + encodeURIComponent(cfg.branch) + '&fresh=' + Date.now() + '-' +
                  Math.random().toString(36).slice(2, 8)
                : '');
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mycampuskorner-catalog-editor',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    },
    cf: { cacheTtl: 0, cacheEverything: false },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep raw below */ }
  return { ok: res.ok, status: res.status, data, text };
}

// One version of a file by its blob sha -- what a draft's base_sha names, and
// what a Save merges an outside commit against. Blobs never change, so unlike
// github() this needs no cache-busting. ("Contents: read" covers it.)
export async function githubBlob(cfg, sha) {
  const res = await fetch((cfg.api || 'https://api.github.com') + '/repos/' + cfg.repo +
                          '/git/blobs/' + encodeURIComponent(sha), {
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mycampuskorner-catalog-editor'
    }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.content !== 'string') {
    throw new Error('GitHub would not return version ' + String(sha).slice(0, 7) +
                    ' (HTTP ' + res.status + ')');
  }
  return decodeBase64(data.content);
}

// How a Save tells one product from another when it merges a commit made
// outside the editor (see planOutside() in _shared/draft-save.js).
const RULES = rowRules(tidy, 'id', 'product');

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
    categories: categoryList(source, products),
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
  let draftSeq = 0, draftEpoch = null, draftRead = null;
  if (body && body.fromDraft) {
    // The synced editor sends no products: publish the shared draft exactly as
    // it stands in D1 (see functions/api/draft.js), including edits made on
    // other screens. Counter first, then rows -- an edit landing in between
    // shows as "unpublished" afterwards instead of being silently published.
    if (!env.DB) return json(400, { error: 'The shared draft has no DB binding on this Pages project.' });
    ({ seq: draftSeq, epoch: draftEpoch } = await draftMarks(env.DB, 'draft_meta'));
    if (epochMoved(body, draftEpoch)) return json(409, { error: RESET_MESSAGE });
    draftRead = await draftRows(env.DB, 'draft_rows');
    products = draftRead.map((r) => r.data);
    // Re-checked AFTER the rows: see epochChanged() in _shared/draft-save.js.
    if (await epochChanged(env.DB, 'draft_meta', draftEpoch)) return json(409, { error: RESET_MESSAGE });
  }
  if (!Array.isArray(products)) return json(400, { error: 'products must be a list' });
  if (!products.length) return json(400, { error: 'refusing to save an empty catalog' });

  const errors = validate(products);
  if (errors.length) return json(400, { error: 'validation failed', errors });

  // Re-read so we keep the comment header and can see the current sha. One
  // cache-busted read, reusable: settleBase() re-reads through it before it is
  // willing to call a sha disagreement an outside commit.
  const readFresh = async () => {
    const res = await github(cfg, 'GET');
    if (!res.ok) throw new Error('could not read the current ' + FILE +
                                 ' from GitHub (HTTP ' + res.status + ')');
    return { sha: res.data.sha, source: decodeBase64(res.data.content) };
  };
  let current;
  try { current = await readFresh(); } catch (e) { return json(502, { error: e.message }); }

  let plan = null;
  if (body.fromDraft) {
    // The draft remembers the sha it was seeded from. A disagreement is only
    // an outside commit once both sides have been re-read and still differ --
    // see settleBase() in _shared/draft-save.js.
    const settled = await settleBase(env.DB, 'draft_meta', current, readFresh);
    current = settled.current;
    if (settled.verdict === 'race') return json(409, { error: RACE_MESSAGE });
    if (settled.verdict) {
      // Changed outside the editor (a push from GitHub Desktop): merge it in
      // rather than refuse -- see planOutside() in _shared/draft-save.js.
      plan = await planOutside(env.DB, 'draft_meta', {
        file: FILE, base: settled.base, current, rows: draftRead, parse: parseProducts,
        rules: RULES, fetchBase: (sha) => githubBlob(cfg, sha),
        choice: body.outside, choiceSha: body.outsideSha
      });
      if (plan.ask) return json(409, plan.ask);
      if (plan.merged) {
        products = plan.merged.rows.map((r) => r.data);
        if (!products.length) return json(400, { error: 'refusing to save an empty catalog' });
        const again = validate(products);
        if (again.length) return json(400, { error: 'validation failed', errors: again });
      }
    }
  } else if (body.sha && body.sha !== current.sha) {
    return json(409, {
      error: 'Somebody else saved the catalog while this page was open.\n' +
             'Press Reload to pick up their version, then make your changes again. ' +
             'Nothing has been overwritten.'
    });
  }

  let header = '';
  try { header = readHeader(current.source); } catch (e) { /* header optional */ }
  const categories = categoryList(current.source, products, true);
  const content = render(header, products, categories);
  const who = (body.author || '').toString().slice(0, 40).replace(/[^\p{L}\p{N} .@'_-]/gu, '');
  const message = 'Catalog: ' + products.length + ' products, edited in the web editor' +
                  (who ? ' by ' + who : '');

  // Last check before the commit. settleBase() above can wait a couple of
  // seconds for GitHub, which is ample time for a Reset or a History restore
  // to land; publishing the rows read before it would send out a version
  // nobody has seen.
  if (body.fromDraft && await epochChanged(env.DB, 'draft_meta', draftEpoch)) {
    return json(409, { error: RESET_MESSAGE });
  }

  const put = await github(cfg, 'PUT', {
    message,
    content: encodeBase64(content),
    sha: current.sha,
    branch: cfg.branch
  });

  if (!put.ok) {
    // GitHub's own check: the file moved on between our read and our write --
    // in practice another editor's Save landing in the same second.
    if (put.status === 409 && body.fromDraft) return json(409, { error: RACE_MESSAGE });
    return json(put.status === 409 ? 409 : 502, {
      error: 'GitHub refused the commit (HTTP ' + put.status + '). ' +
             (put.data && put.data.message ? put.data.message : '')
    });
  }

  const newSha = put.data && put.data.content ? put.data.content.sha : null;
  const commit = put.data && put.data.commit ? put.data.commit.sha.slice(0, 7) : null;
  let adopted = null;
  if (body.fromDraft && newSha) {
    // Tell every open editor: base_sha keeps the next out-of-band check honest,
    // save.seq is what the "unpublished changes" indicator compares against.
    const saved = { who: who, at: Date.now(), count: products.length, commit: commit || '' };
    // extra.categories is what every editor's category menu starts from.
    const extra = ['extra', JSON.stringify({ categories })];
    if (plan && plan.merged) {
      adopted = await adoptMerged(env.DB, { rows: 'draft_rows', meta: 'draft_meta' }, {
        read: draftRead, merged: plan.merged.rows, seq: draftSeq, epoch: draftEpoch,
        newSha, save: saved });
      if (adopted === 'ok') await recordSave(env.DB, 'draft_meta', draftEpoch, [extra]);
    } else {
      await recordSave(env.DB, 'draft_meta', draftEpoch,
                       [['base_sha', newSha], ['save', JSON.stringify({ ...saved, seq: draftSeq })], extra]);
    }
  }

  return json(200, {
    ok: true,
    count: products.length,
    sha: newSha,
    commit: commit,
    message: 'Committed to ' + cfg.repo + '@' + cfg.branch +
             '. The site rebuilds and redeploys in about a minute.' + outsideNote(plan, adopted)
  });
}
