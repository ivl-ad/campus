/*
 * /api/partners -- the hosted half of the partner-logo editor.
 *
 *   GET   read js/partners.js straight from GitHub
 *   POST  commit an edited partner list back to GitHub
 *
 * The twin of /api/catalog for the scrolling logo strip on the home page.
 * Partners are the companies themselves, kept apart from their products in
 * js/products.js.
 *
 * Unlike the catalog there is nothing to rebuild: index.html reads
 * js/partners.js in the browser (see js/partner-marquee.js), so the commit is
 * the whole publish and Cloudflare Pages deploys it in about a minute. An
 * empty list is a real state, not a mistake -- it brings back the
 * MyCampusKorner wordmark strip -- so unlike the catalog it can be saved.
 *
 * Same environment as /api/catalog. The shared draft behind it is
 * /api/draft?doc=partners, in the partner_* tables of the same DB binding.
 */

import { config, github, decodeBase64, encodeBase64 } from './catalog.js';
import { draftMarks, baseMismatch, recordSave, epochMoved, RACE_MESSAGE, RESET_MESSAGE } from '../_shared/draft-save.js';
import { jsValue, extractArray, headerBefore } from '../_shared/js-data.js';

export const FILE = 'js/partners.js';
export const TABLES = { rows: 'partner_rows', meta: 'partner_meta', presence: 'partner_presence' };

// base_sha for a draft seeded before js/partners.js existed on GitHub.
export const NO_FILE = 'none';

const FIELD_ORDER = ['name', 'url', 'logo', 'note'];

// A logo is a full image URL, or a file in this site's images folder.
const LOGO_RE = /^(https?:\/\/[^\s<>"']+|\/?images\/[^\s<>"']+)$/i;
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

// Used when the file is first created from the editor.
const DEFAULT_HEADER = [
  '/*',
  ' * partners.js — the partner logo strip on the home page, as data.',
  ' *',
  ' * Edited from /admin/ (the Partners tab); js/partner-marquee.js draws it.',
  ' * Each entry is one logo in the scrolling strip on index.html, in order:',
  ' *   name   the partner (the logo\'s alt text and hover title)',
  ' *   url    where the logo links to -- opens in a new tab',
  ' *   logo   image URL: a full https:// address, or a path under images/',
  ' *   note   optional and private -- never shown on the site',
  ' *',
  ' * These are the partner companies themselves, separate from their products',
  ' * in products.js. With no entries the strip shows the MyCampusKorner',
  ' * wordmark, exactly as before.',
  ' */'
].join('\n');

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// ------------------------------------------------------------ partners.js
export const parsePartners = (source) => extractArray(source, 'PARTNERS');
export const readHeader = (source) => headerBefore(source, 'PARTNERS');

export function tidy(partner) {
  const out = {};
  const put = (k) => {
    let v = partner[k];
    if (typeof v === 'string' && k !== 'note') v = v.trim();
    if (v === undefined || v === null || v === '') return;
    out[k] = v;
  };
  FIELD_ORDER.forEach(put);
  Object.keys(partner).forEach((k) => { if (!(k in out)) put(k); });
  return out;
}

export function render(header, partners) {
  const lines = [header && header.trim() ? header : DEFAULT_HEADER];
  lines.push('window.PARTNERS = [');
  partners.forEach((p) => {
    const t = tidy(p);
    lines.push('  {' + Object.keys(t).map((k) => JSON.stringify(k) + ': ' + jsValue(t[k]))
      .join(', ') + '},');
  });
  lines.push('];');
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------- validation
// The editor page runs the same rules before it lets Save through.
export function validate(partners) {
  const errors = [];
  partners.forEach((p, i) => {
    let where = 'partner #' + (i + 1);
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      errors.push(where + ': not an object');
      return;
    }
    if (p.name) where += ' (' + p.name + ')';
    ['name', 'url', 'logo'].forEach((f) => {
      if (!p[f] || !String(p[f]).trim()) errors.push(where + ': missing "' + f + '"');
    });
    if (p.url && String(p.url).trim() && !URL_RE.test(String(p.url).trim())) {
      errors.push(where + ': url must be a full address starting with https://');
    }
    if (p.logo && String(p.logo).trim() && !LOGO_RE.test(String(p.logo).trim())) {
      errors.push(where + ': logo must be a full https:// image URL, or a path under images/');
    }
  });
  return errors;
}

// ----------------------------------------------------------------- GitHub
// The file does not exist until the first Save, and GitHub answers 404 both
// for that and for a wrong repo or branch. js/products.js is always there, so
// asking for it tells the two apart. /api/team and /api/blog pass their own file.
export async function readRemote(cfg, file = FILE) {
  const res = await github(cfg, 'GET', null, file);
  if (res.ok) {
    return { exists: true, sha: res.data.sha, source: decodeBase64(res.data.content) };
  }
  if (res.status === 404) {
    const probe = await github(cfg, 'GET');
    if (probe.ok) return { exists: false, sha: null, source: '' };
  }
  const err = new Error('GitHub would not return ' + file + ' (HTTP ' + res.status + '). ' +
    (res.data && res.data.message ? res.data.message : '') +
    (res.status === 404 ? ' Check GITHUB_REPO and GITHUB_BRANCH.' : '') +
    (res.status === 401 || res.status === 403
      ? ' Check GITHUB_TOKEN has Contents: read and write on this repo.' : ''));
  err.status = res.status === 404 ? 404 : 502;
  throw err;
}

// -------------------------------------------------------------- handlers
export async function onRequestGet({ env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let cur, partners;
  try { cur = await readRemote(cfg); } catch (e) { return json(e.status || 502, { error: e.message }); }
  try {
    partners = cur.exists ? parsePartners(cur.source) : [];
  } catch (e) {
    return json(500, { error: 'could not read ' + FILE + ': ' + e.message });
  }

  return json(200, {
    partners,
    sha: cur.sha,                // sent back on save as an overwrite guard
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
  let partners = body && body.partners;
  let draftSeq = 0, draftEpoch = null;
  if (body && body.fromDraft) {
    // Publish the shared draft exactly as it stands (see functions/api/draft.js).
    // Counter first, then rows, for the same reason as /api/catalog.
    if (!env.DB) return json(400, { error: 'The shared draft has no DB binding on this Pages project.' });
    ({ seq: draftSeq, epoch: draftEpoch } = await draftMarks(env.DB, TABLES.meta));
    if (epochMoved(body, draftEpoch)) return json(409, { error: RESET_MESSAGE });
    const got = await env.DB.prepare(
      'SELECT data FROM ' + TABLES.rows + ' WHERE deleted=0 ORDER BY pos, rid').all();
    partners = got.results.map((r) => JSON.parse(r.data));
  }
  if (!Array.isArray(partners)) return json(400, { error: 'partners must be a list' });

  const errors = validate(partners);
  if (errors.length) return json(400, { error: 'validation failed', errors });

  let current;
  try { current = await readRemote(cfg); } catch (e) {
    return json(502, { error: 'could not read the current ' + FILE + ' from GitHub. ' + e.message });
  }

  if (body.fromDraft) {
    const mismatch = await baseMismatch(env.DB, TABLES.meta, current.sha || NO_FILE);
    if (mismatch === 'race') return json(409, { error: RACE_MESSAGE });
    if (mismatch) {
      return json(409, {
        error: FILE + ' changed on GitHub since this draft was loaded (a direct commit in git, or a\n' +
               'Save that finished while the draft was being reset).\n' +
               'Press "Reset draft" to start over from that version (unpublished ' +
               'edits are discarded), or reconcile the two in git first.'
      });
    }
  } else if (body.sha && body.sha !== current.sha) {
    return json(409, {
      error: 'Somebody else saved the partner list while this page was open.\n' +
             'Press Reload to pick up their version, then make your changes again. ' +
             'Nothing has been overwritten.'
    });
  }

  const content = render(current.exists ? readHeader(current.source) : '', partners);
  const who = (body.author || '').toString().slice(0, 40).replace(/[^\p{L}\p{N} .@'_-]/gu, '');
  const message = 'Partners: ' + partners.length + ' logo' + (partners.length === 1 ? '' : 's') +
                  ', edited in the web editor' + (who ? ' by ' + who : '');

  const put = await github(cfg, 'PUT', {
    message,
    content: encodeBase64(content),
    sha: current.sha || undefined,   // no sha = create the file
    branch: cfg.branch
  }, FILE);

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
  if (body.fromDraft && newSha) {
    const note = JSON.stringify({ who: who, at: Date.now(), count: partners.length,
                                  seq: draftSeq, commit: commit || '' });
    await recordSave(env.DB, TABLES.meta, draftEpoch, [['base_sha', newSha], ['save', note]]);
  }

  return json(200, {
    ok: true,
    count: partners.length,
    sha: newSha,
    commit: commit,
    message: 'Committed to ' + cfg.repo + '@' + cfg.branch +
             '. The home page shows it once Cloudflare Pages redeploys, in about a minute.'
  });
}
