/*
 * /api/team -- the hosted half of the team editor (/admin/?view=team).
 *
 *   GET   read js/team.js straight from GitHub
 *   POST  commit an edited team list back to GitHub
 *
 * The twin of /api/partners. Each entry is one person on the About page, in
 * order. A Save commits js/team.js; the GitHub Action then runs
 * build_content.py, which bakes the "Meet the team" cards into about.html
 * (plain HTML, so reviewers and search engines see real people without
 * running any script). Blog bylines pick authors from this list too.
 *
 * An empty list is a real state: the About page simply hides its team
 * section, so unlike the catalog it can be saved.
 *
 * Same environment as /api/catalog. The shared draft behind it is
 * /api/draft?doc=team, in the team_* tables of the same DB binding.
 */

import { config, github, encodeBase64 } from './catalog.js';
import { readRemote, NO_FILE } from './partners.js';
import { extractArray, headerBefore, renderArray } from '../_shared/js-data.js';
import { draftMarks, baseMismatch, recordSave, epochMoved, RACE_MESSAGE, RESET_MESSAGE } from '../_shared/draft-save.js';

export const FILE = 'js/team.js';
export const TABLES = { rows: 'team_rows', meta: 'team_meta', presence: 'team_presence' };

const FIELD_ORDER = ['id', 'name', 'role', 'photo', 'bio', 'link'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
// Addresses only: no spaces, quotes or angle brackets.
const PHOTO_RE = /^(https?:\/\/[^\s<>"']+|\/?images\/[^\s<>"']+)$/i;
const LINK_RE = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+@[^\s<>"']+)$/i;

const DEFAULT_HEADER = [
  '/*',
  ' * team.js — the people on the About page, as data.',
  ' *',
  ' * Edited from /admin/ (the Team tab). build_content.py bakes these into the',
  ' * "Meet the team" section of about.html, in this order; blog posts name',
  ' * their author by id. Fields:',
  ' *   id     permalink slug (about.html#team-<id>; blog posts refer to it)',
  ' *   name   full name',
  ' *   role   title shown above the name, e.g. "Founder"',
  ' *   photo  image URL: a full https:// address, or a path under images/',
  ' *   bio    a few sentences; a blank line starts a new paragraph',
  ' *   link   optional profile link (LinkedIn, website) or mailto: address',
  ' */'
].join('\n');

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export const parseTeam = (source) => extractArray(source, 'TEAM');

export function tidy(person) {
  const out = {};
  const put = (k) => {
    let v = person[k];
    if (typeof v === 'string') v = k === 'bio' ? v.replace(/\r\n?/g, '\n').trim() : v.trim();
    if (v === undefined || v === null || v === '') return;
    out[k] = v;
  };
  FIELD_ORDER.forEach(put);
  Object.keys(person).forEach((k) => { if (!(k in out)) put(k); });
  return out;
}

export function render(header, team) {
  return [header && header.trim() ? header : DEFAULT_HEADER,
          renderArray('TEAM', team.map(tidy), FIELD_ORDER)].join('\n') + '\n';
}

// The editor page runs the same rules before it lets Save through.
export function validate(team) {
  const errors = [];
  const seen = new Map();
  team.forEach((p, i) => {
    let where = 'person #' + (i + 1);
    if (typeof p !== 'object' || p === null || Array.isArray(p)) { errors.push(where + ': not an object'); return; }
    if (p.name) where += ' (' + p.name + ')';
    ['id', 'name', 'role', 'photo', 'bio', 'link'].forEach((f) => {
      if (p[f] !== undefined && p[f] !== null && typeof p[f] !== 'string') errors.push(where + ': ' + f + ' must be text');
    });
    if (!p.name || !String(p.name).trim()) errors.push(where + ': missing name');
    if (!p.id) errors.push(where + ': missing id');
    else {
      if (!SLUG_RE.test(p.id)) errors.push(where + ': id must be lowercase letters, numbers and dashes');
      if (seen.has(p.id)) errors.push(where + ': duplicate id -- also used by person #' + seen.get(p.id));
      seen.set(p.id, i + 1);
    }
    if (p.photo && !PHOTO_RE.test(String(p.photo).trim())) {
      errors.push(where + ': photo must be a full https:// image address, or a path under images/');
    }
    if (p.link && !LINK_RE.test(String(p.link).trim())) {
      errors.push(where + ': link must be a full https:// address (or mailto:you@example.com)');
    }
  });
  return errors;
}

// -------------------------------------------------------------- handlers
export async function onRequestGet({ env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let cur, team;
  try { cur = await readRemote(cfg, FILE); } catch (e) { return json(e.status || 502, { error: e.message }); }
  try {
    team = cur.exists ? parseTeam(cur.source) : [];
  } catch (e) {
    return json(500, { error: 'could not read ' + FILE + ': ' + e.message });
  }
  return json(200, { team, sha: cur.sha, source: 'github:' + cfg.repo + '@' + cfg.branch });
}

export async function onRequestPost({ request, env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }
  let team = body && body.team;
  let draftSeq = 0, draftEpoch = null;
  if (body && body.fromDraft) {
    // Publish the shared draft exactly as it stands (see functions/api/draft.js).
    if (!env.DB) return json(400, { error: 'The shared draft has no DB binding on this Pages project.' });
    ({ seq: draftSeq, epoch: draftEpoch } = await draftMarks(env.DB, TABLES.meta));
    if (epochMoved(body, draftEpoch)) return json(409, { error: RESET_MESSAGE });
    const got = await env.DB.prepare(
      'SELECT data FROM ' + TABLES.rows + ' WHERE deleted=0 ORDER BY pos, rid').all();
    team = got.results.map((r) => JSON.parse(r.data));
  }
  if (!Array.isArray(team)) return json(400, { error: 'team must be a list' });
  team = team.map(tidy);

  const errors = validate(team);
  if (errors.length) return json(400, { error: 'validation failed', errors });

  let current;
  try { current = await readRemote(cfg, FILE); } catch (e) {
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
      error: 'Somebody else saved the team while this page was open.\n' +
             'Press Reload to pick up their version, then make your changes again. ' +
             'Nothing has been overwritten.'
    });
  }

  const content = render(current.exists ? headerBefore(current.source, 'TEAM') : '', team);
  const who = (body.author || '').toString().slice(0, 40).replace(/[^\p{L}\p{N} .@'_-]/gu, '');
  const message = 'Team: ' + team.length + (team.length === 1 ? ' person' : ' people') +
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
    const note = JSON.stringify({ who: who, at: Date.now(), count: team.length,
                                  seq: draftSeq, commit: commit || '' });
    await recordSave(env.DB, TABLES.meta, draftEpoch, [['base_sha', newSha], ['save', note]]);
  }

  return json(200, {
    ok: true,
    count: team.length,
    sha: newSha,
    commit: commit,
    message: 'Committed to ' + cfg.repo + '@' + cfg.branch +
             '. The About page updates when the rebuild finishes and Pages redeploys (~2 min).'
  });
}
