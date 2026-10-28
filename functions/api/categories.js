/*
 * /api/categories -- the hosted half of the category editor (/admin/?view=categories).
 *
 *   GET   read js/categories.js straight from GitHub
 *   POST  commit an edited category list back to GitHub
 *
 * js/categories.js is THE list of product categories, in order. Everything
 * that shows categories follows it: the product editor's category menu, the
 * category cards on the home page and the "N core campus tracks" sentence
 * above them, the category menu in every page's header and footer, the
 * Store's filters, the category pages and the sitemap (build_listings.py
 * bakes the pages after each Save; js/listing-page.js and the SEO functions
 * read the file directly).
 *
 * A category is renamed by changing its name -- its id is its address
 * (/category?id=...) and what products refer to, so it stays put. Deleting
 * is refused while any product still uses the category, here and in the
 * editor: move those products to another category first. That check covers
 * the published catalog AND the products still in the editor's shared draft,
 * so a category can never disappear from under a product.
 *
 * Same environment as /api/catalog. The shared draft behind it is
 * /api/draft?doc=categories, in the category_* tables of the same DB binding.
 */

import { config, github, githubBlob, encodeBase64, parseProducts } from './catalog.js';
import { readRemote, NO_FILE } from './partners.js';
import { extractArray, headerBefore, renderArray } from '../_shared/js-data.js';
import { draftMarks, settleBase, recordSave, epochMoved, epochChanged, RACE_MESSAGE, RESET_MESSAGE,
         planOutside, adoptMerged, outsideNote, draftRows, rowRules } from '../_shared/draft-save.js';

export const FILE = 'js/categories.js';
export const TABLES = { rows: 'category_rows', meta: 'category_meta', presence: 'category_presence' };

const FIELD_ORDER = ['id', 'name', 'home', 'button', 'text', 'img', 'alt'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const IMG_RE = /^(https?:\/\/[^\s<>"']+|\/?images\/[^\s<>"']+)$/i;

const DEFAULT_HEADER = [
  '/*',
  ' * categories.js — the product categories, as data, in order.',
  ' *',
  ' * Edited from /admin/ (the Categories tab). Everything that shows',
  ' * categories follows this list: the product editor, the home page cards,',
  ' * the header and footer menus, the Store filters and the category pages.',
  ' *   id      the address (/category?id=...) and what products refer to;',
  ' *           never changes once products use it',
  ' *   name    what shoppers see -- rename a category here',
  ' *   home    "hidden" keeps it off the home page cards; otherwise shown',
  ' *   button  the card\'s button text, e.g. "Shop dorm essentials"',
  ' *   text    the card\'s description',
  ' *   img     the card\'s picture: a path under images/ or an https:// address',
  ' *   alt     describes that picture, for screen readers',
  ' */'
].join('\n');

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export const parseCategories = (source) => extractArray(source, 'CATEGORIES');

export function tidy(cat) {
  const out = {};
  const put = (k) => {
    let v = cat[k];
    if (typeof v === 'string') v = k === 'text' ? v.replace(/\r\n?/g, '\n').trim() : v.trim();
    if (k === 'home' && v !== 'hidden') return;          // shown is the default, never written
    if (v === undefined || v === null || v === '') return;
    out[k] = v;
  };
  FIELD_ORDER.forEach(put);
  Object.keys(cat).forEach((k) => { if (!(k in out)) put(k); });
  return out;
}

export function render(header, cats) {
  return [header && header.trim() ? header : DEFAULT_HEADER,
          renderArray('CATEGORIES', cats.map(tidy), FIELD_ORDER)].join('\n') + '\n';
}

// How a Save tells one row from another when it merges a commit made outside
// the editor (see planOutside() in _shared/draft-save.js).
const RULES = rowRules(tidy, 'id', 'category');

// The editor page runs the same rules before it lets Save through.
export function validate(cats) {
  const errors = [];
  const seen = new Map();
  cats.forEach((c, i) => {
    let where = 'category #' + (i + 1);
    if (typeof c !== 'object' || c === null || Array.isArray(c)) { errors.push(where + ': not an object'); return; }
    if (c.name) where += ' (' + c.name + ')';
    FIELD_ORDER.forEach((f) => {
      if (c[f] !== undefined && c[f] !== null && typeof c[f] !== 'string') errors.push(where + ': ' + f + ' must be text');
    });
    if (!c.name || !String(c.name).trim()) errors.push(where + ': missing name');
    if (!c.id) errors.push(where + ': missing id');
    else {
      if (!SLUG_RE.test(c.id)) errors.push(where + ': id must be lowercase letters, numbers and dashes');
      if (seen.has(c.id)) errors.push(where + ': duplicate id -- also used by category #' + seen.get(c.id));
      seen.set(c.id, i + 1);
    }
    if (c.home && c.home !== 'hidden' && c.home !== 'shown') errors.push(where + ': home must be "shown" or "hidden"');
    if (c.img && !IMG_RE.test(String(c.img).trim())) {
      errors.push(where + ': picture must be a path under images/ or a full https:// image address');
    }
    // A card on the home page needs all of its parts, or it shows up broken.
    if (c.home !== 'hidden') {
      ['img', 'text', 'button'].forEach((f) => {
        if (!c[f] || !String(c[f]).trim()) {
          errors.push(where + ': a home page card needs its ' +
                      { img: 'picture', text: 'text', button: 'button text' }[f] +
                      ' (or set "home page card" to hidden)');
        }
      });
    }
  });
  return errors;
}

/*
 * Which categories products use right now, and by which products: the
 * published catalog (js/products.js on GitHub) and the products editor's
 * shared draft (rows not deleted), so a product added a minute ago counts.
 * Returns Map(category id -> [product names]).
 */
export async function categoriesInUse(env, cfg) {
  const used = new Map();
  const add = (p, where) => {
    if (!p || typeof p.cat !== 'string' || !p.cat) return;
    if (!used.has(p.cat)) used.set(p.cat, []);
    used.get(p.cat).push((p.name || p.id || 'a product') + where);
  };
  const live = await readRemote(cfg, 'js/products.js');
  const published = live.exists ? parseProducts(live.source) : [];
  const seenIds = new Set();
  if (env.DB) {
    try {
      const got = await env.DB.prepare('SELECT data FROM draft_rows WHERE deleted=0').all();
      got.results.forEach((r) => {
        const p = JSON.parse(r.data);
        if (p && p.id) seenIds.add(p.id);
        add(p, '');
      });
    } catch (e) { /* no products draft yet: the published catalog is all there is */ }
  }
  // A published product the draft has not got (or no draft at all).
  published.forEach((p) => { if (!p || !seenIds.has(p.id)) add(p, ''); });
  return used;
}

export function stillUsed(cats, used) {
  const ids = new Set(cats.map((c) => c && c.id));
  const errors = [];
  used.forEach((names, id) => {
    if (ids.has(id)) return;
    const some = names.slice(0, 5).join(', ') + (names.length > 5 ? ' and ' + (names.length - 5) + ' more' : '');
    errors.push('category "' + id + '" is used by ' + names.length + ' product' +
                (names.length === 1 ? '' : 's') + ' (' + some + '). Move ' +
                (names.length === 1 ? 'it' : 'them') + ' to another category in the Products tab ' +
                'first, then delete the category -- or put it back here.');
  });
  return errors;
}

// -------------------------------------------------------------- handlers
export async function onRequestGet({ env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let cur, categories;
  try { cur = await readRemote(cfg, FILE); } catch (e) { return json(e.status || 502, { error: e.message }); }
  try {
    categories = cur.exists ? parseCategories(cur.source) : [];
  } catch (e) {
    return json(500, { error: 'could not read ' + FILE + ': ' + e.message });
  }
  return json(200, { categories, sha: cur.sha, source: 'github:' + cfg.repo + '@' + cfg.branch });
}

export async function onRequestPost({ request, env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }
  let cats = body && body.categories;
  let draftSeq = 0, draftEpoch = null, draftRead = null;
  if (body && body.fromDraft) {
    // Publish the shared draft exactly as it stands (see functions/api/draft.js).
    if (!env.DB) return json(400, { error: 'The shared draft has no DB binding on this Pages project.' });
    ({ seq: draftSeq, epoch: draftEpoch } = await draftMarks(env.DB, TABLES.meta));
    if (epochMoved(body, draftEpoch)) return json(409, { error: RESET_MESSAGE });
    draftRead = await draftRows(env.DB, TABLES.rows);
    cats = draftRead.map((r) => r.data);
    // Re-checked AFTER the rows: see epochChanged() in _shared/draft-save.js.
    if (await epochChanged(env.DB, TABLES.meta, draftEpoch)) return json(409, { error: RESET_MESSAGE });
  }
  if (!Array.isArray(cats)) return json(400, { error: 'categories must be a list' });
  cats = cats.map(tidy);
  if (!cats.length) return json(400, { error: 'refusing to save an empty category list' });

  const errors = validate(cats);
  if (errors.length) return json(400, { error: 'validation failed', errors });

  // Never drop a category a product still uses.
  let used;
  try { used = await categoriesInUse(env, cfg); } catch (e) {
    return json(502, { error: 'could not check which categories products use: ' + e.message });
  }
  const inUse = stillUsed(cats, used);
  if (inUse.length) return json(400, { error: 'validation failed', errors: inUse });

  const readFresh = async () => {
    const got = await readRemote(cfg, FILE);
    return { exists: got.exists, source: got.source,
             sha: got.sha || NO_FILE, putSha: got.sha || undefined };
  };
  let current;
  try { current = await readFresh(); } catch (e) {
    return json(502, { error: 'could not read the current ' + FILE + ' from GitHub. ' + e.message });
  }

  let plan = null;
  if (body.fromDraft) {
    const settled = await settleBase(env.DB, TABLES.meta, current, readFresh);
    current = settled.current;
    if (settled.verdict === 'race') return json(409, { error: RACE_MESSAGE });
    if (settled.verdict) {
      // Changed outside the editor (a push from GitHub Desktop): merge it in
      // rather than refuse -- see planOutside() in _shared/draft-save.js.
      plan = await planOutside(env.DB, TABLES.meta, {
        file: FILE, base: settled.base, current, rows: draftRead, parse: parseCategories,
        rules: RULES, fetchBase: (sha) => (sha === NO_FILE ? null : githubBlob(cfg, sha)),
        choice: body.outside, choiceSha: body.outsideSha
      });
      if (plan.ask) return json(409, plan.ask);
      if (plan.merged) {
        cats = plan.merged.rows.map((r) => r.data).map(tidy);
        const again = validate(cats).concat(stillUsed(cats, used));
        if (again.length) return json(400, { error: 'validation failed', errors: again });
      }
    }
  } else if (!body.sha && current.exists) {
    return json(409, {
      error: 'This page loaded before ' + FILE + ' existed, but it is there now -- ' +
             'somebody else saved first. Press Reload to pick up their version, then ' +
             'make your changes again. Nothing has been overwritten.'
    });
  } else if (body.sha && body.sha !== current.sha) {
    return json(409, {
      error: 'Somebody else saved the categories while this page was open.\n' +
             'Press Reload to pick up their version, then make your changes again. ' +
             'Nothing has been overwritten.'
    });
  }

  const content = render(current.exists ? headerBefore(current.source, 'CATEGORIES') : '', cats);
  const who = (body.author || '').toString().slice(0, 40).replace(/[^\p{L}\p{N} .@'_-]/gu, '');
  const message = 'Categories: ' + cats.length + (cats.length === 1 ? ' category' : ' categories') +
                  ', edited in the web editor' + (who ? ' by ' + who : '');

  if (body.fromDraft && await epochChanged(env.DB, TABLES.meta, draftEpoch)) {
    return json(409, { error: RESET_MESSAGE });
  }

  const put = await github(cfg, 'PUT', {
    message,
    content: encodeBase64(content),
    sha: current.putSha,             // undefined = create the file
    branch: cfg.branch
  }, FILE);

  if (!put.ok) {
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
    const saved = { who: who, at: Date.now(), count: cats.length, commit: commit || '' };
    if (plan && plan.merged) {
      adopted = await adoptMerged(env.DB, TABLES, {
        read: draftRead, merged: plan.merged.rows, seq: draftSeq, epoch: draftEpoch,
        newSha, save: saved });
    } else {
      await recordSave(env.DB, TABLES.meta, draftEpoch, [['base_sha', newSha],
        ['save', JSON.stringify({ ...saved, seq: draftSeq })]]);
    }
  }

  return json(200, {
    ok: true,
    count: cats.length,
    sha: newSha,
    commit: commit,
    message: 'Committed to ' + cfg.repo + '@' + cfg.branch +
             '. The home page, menus and Store update when the rebuild finishes and Pages ' +
             'redeploys (~2 min).' + outsideNote(plan, adopted)
  });
}
