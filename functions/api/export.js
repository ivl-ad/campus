/*
 * /api/export -- take a copy of everything the site holds.
 *
 * The point of this endpoint is that nothing here depends on the editor, the
 * draft, or a working deploy. It reads the published data files straight from
 * GitHub and the sign-up tables straight from D1, and hands back a file you
 * can keep. Behind the editor password like the rest of /api/* .
 *
 *   GET /api/export                              everything, as one JSON bundle
 *   GET /api/export?section=products             one section, as JSON
 *   GET /api/export?section=partners&format=js   that section's data file, verbatim
 *   GET /api/export?section=newsletter&format=csv    a spreadsheet
 *   GET /api/export?section=contact&format=sql       INSERTs, to restore into D1
 *
 * sections: all | products | categories | partners | blog | team | newsletter | contact
 *
 * HOW TO RESTORE, which is the only reason to have a backup:
 *
 *  - products / categories / partners / blog / team live in git. The bundle
 *    carries each file's exact bytes under "files", so restoring one is:
 *    paste those bytes over the file, commit, done. (Day to day you would use History in the
 *    editor instead -- every Save is a commit. This is for when the repo
 *    itself is gone or mangled.)
 *  - newsletter / contact live ONLY in D1. Nothing else has a copy, so these
 *    are the rows that a dropped binding or a deleted database would really
 *    lose. "files" carries a signups-restore.sql you can paste into the D1
 *    console (Cloudflare dashboard -> D1 -> your database -> Console).
 *
 * The bundle is a point-in-time copy: unpublished draft edits are NOT in it
 * (they are not published yet, and Save is what makes them real).
 */

import { config } from './catalog.js';
import { readRemote } from './partners.js';
import { extractArray } from '../_shared/js-data.js';
import { ensureTables } from '../_shared/forms.js';

const BUNDLE_VERSION = 1;

// Every content section: its file in git and the window.NAME arrays inside it.
const CONTENT = {
  products: { file: 'js/products.js', arrays: { items: 'PRODUCTS' } },
  partners: { file: 'js/partners.js', arrays: { items: 'PARTNERS' } },
  blog: { file: 'js/blogs.js', arrays: { items: 'BLOG_POSTS', categories: 'BLOG_CATEGORIES' } },
  team: { file: 'js/team.js', arrays: { items: 'TEAM' } },
  categories: { file: 'js/categories.js', arrays: { items: 'CATEGORIES' } }
};

// The two D1-only tables. Columns are listed, never interpolated from input.
const TABLES = {
  newsletter: {
    table: 'newsletter_subscribers',
    cols: ['email', 'created_at', 'page', 'country']
  },
  contact: {
    table: 'contact_messages',
    cols: ['id', 'created_at', 'name', 'email', 'reason', 'message', 'page', 'country']
  }
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const stamp = () => new Date().toISOString().slice(0, 10);

function download(body, type, filename) {
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store'
    }
  });
}

// ------------------------------------------------------------------- CSV
function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Stop a spreadsheet treating a submitted "=..." as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const utcLabel = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function toCsv(spec, rows) {
  const header = spec.cols.map((c) => (c === 'created_at' ? 'date_utc' : c));
  const lines = [header.join(',')].concat(rows.map((r) => spec.cols
    .map((c) => csvCell(c === 'created_at' ? utcLabel(r[c]) : r[c])).join(',')));
  // A BOM so Excel opens UTF-8 correctly; CRLF for the same reason.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------- SQL
// Values are quoted here rather than bound, because the output is a text file
// meant to be pasted into the D1 console. Single quotes are doubled, which is
// the whole of SQLite's string escaping.
function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function toSql(name, spec, rows) {
  const out = [
    '-- ' + spec.table + ': ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') +
      ', exported ' + new Date().toISOString(),
    '-- Paste into: Cloudflare dashboard -> D1 -> your database -> Console.',
    '-- INSERT OR IGNORE, so running it twice is harmless and it will not',
    '-- overwrite rows that are already there.',
    ''
  ];
  rows.forEach((r) => {
    out.push('INSERT OR IGNORE INTO ' + spec.table + ' (' + spec.cols.join(', ') + ') VALUES (' +
      spec.cols.map((c) => sqlValue(r[c])).join(', ') + ');');
  });
  out.push('');
  return out.join('\n');
}

// --------------------------------------------------------------- gathering
async function readContent(cfg, name) {
  const spec = CONTENT[name];
  const got = await readRemote(cfg, spec.file);
  const out = { file: spec.file, exists: got.exists, sha: got.sha, source: got.source };
  Object.keys(spec.arrays).forEach((key) => {
    try {
      out[key] = got.exists ? extractArray(got.source, spec.arrays[key]) : [];
    } catch (e) {
      // A file we cannot parse is exactly when a backup matters most, so the
      // raw bytes still travel; the parse failure is reported beside them.
      out[key] = null;
      out.parseError = (out.parseError ? out.parseError + '; ' : '') +
        spec.arrays[key] + ': ' + e.message;
    }
  });
  out.count = Array.isArray(out.items) ? out.items.length : null;
  return out;
}

async function readTable(db, name) {
  const spec = TABLES[name];
  await ensureTables(db);
  const { results } = await db
    .prepare('SELECT ' + spec.cols.join(', ') + ' FROM ' + spec.table + ' ORDER BY created_at DESC')
    .all();
  return results;
}

// ------------------------------------------------------------------ handler
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const section = url.searchParams.get('section') || 'all';
  const format = url.searchParams.get('format') || 'json';

  const isContent = Object.prototype.hasOwnProperty.call(CONTENT, section);
  const isTable = Object.prototype.hasOwnProperty.call(TABLES, section);
  if (section !== 'all' && !isContent && !isTable) {
    return json(400, { error: 'unknown section "' + section + '". Use one of: all, ' +
      Object.keys(CONTENT).join(', ') + ', ' + Object.keys(TABLES).join(', ') });
  }
  if ((format === 'csv' || format === 'sql') && !isTable) {
    return json(400, { error: format + ' is only for the sign-up lists (newsletter, contact). ' +
      'Content sections export as json, or as js for the data file itself.' });
  }
  if (format === 'js' && !isContent) {
    return json(400, { error: 'js is only for the content sections (' +
      Object.keys(CONTENT).join(', ') + ').' });
  }
  if (['json', 'js', 'csv', 'sql'].indexOf(format) < 0) {
    return json(400, { error: 'unknown format "' + format + '". Use json, js, csv or sql.' });
  }
  if (isTable && !env.DB) {
    return json(503, { error: 'No D1 binding (DB) on this Pages project, so the sign-up ' +
      'lists cannot be read -- see admin/SETUP.md step 5.' });
  }

  let cfg = null, cfgError = null;
  if (isContent || section === 'all') {
    try { cfg = config(env); } catch (e) { cfgError = e.message; }
    // A whole-bundle request carries on without GitHub: the sign-up tables
    // are the only data with no second copy, and refusing the backup because
    // a GitHub variable is missing would withhold it in exactly the
    // situation it exists for. A single content section still cannot work.
    if (cfgError && section !== 'all') return json(500, { error: cfgError });
  }

  try {
    // ---- one sign-up list, in a spreadsheet or restore format
    if (isTable && format !== 'json') {
      const rows = await readTable(env.DB, section);
      const base = TABLES[section].table.replace(/_/g, '-') + '-' + stamp();
      return format === 'csv'
        ? download(toCsv(TABLES[section], rows), 'text/csv; charset=utf-8', base + '.csv')
        : download(toSql(section, TABLES[section], rows), 'text/plain; charset=utf-8', base + '.sql');
    }

    // ---- one content file, verbatim
    if (isContent && format === 'js') {
      const got = await readContent(cfg, section);
      if (!got.exists) return json(404, { error: got.file + ' does not exist on GitHub yet.' });
      return download(got.source, 'text/javascript; charset=utf-8',
                      section + '-' + stamp() + '.js');
    }

    // ---- one section, as JSON
    if (section !== 'all') {
      const body = isContent ? await readContent(cfg, section)
                             : { table: TABLES[section].table, items: await readTable(env.DB, section) };
      if (!isContent) body.count = body.items.length;
      return download(JSON.stringify({
        mycampuskornerBackup: BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        section,
        data: body
      }, null, 2), 'application/json; charset=utf-8',
        'mycampuskorner-' + section + '-' + stamp() + '.json');
    }

    // ---- everything
    const sections = {};
    const files = {};
    const notes = [];

    if (cfgError) {
      notes.push('GitHub is not configured on this Pages project (' + cfgError +
                 ') so no content section is in this bundle. The sign-up tables below ' +
                 'are complete.');
    } else {
      for (const name of Object.keys(CONTENT)) {
        // Each section is read on its own: one unreadable file must not cost
        // you the other three AND both sign-up tables.
        let got;
        try {
          got = await readContent(cfg, name);
        } catch (e) {
          sections[name] = { file: CONTENT[name].file, error: e.message };
          notes.push(CONTENT[name].file + ' could not be read from GitHub (' + e.message + ').');
          continue;
        }
        sections[name] = { file: got.file, sha: got.sha, count: got.count, items: got.items };
        if (got.categories !== undefined) sections[name].categories = got.categories;
        if (got.parseError) {
          sections[name].parseError = got.parseError;
          notes.push(got.file + ' could not be parsed (' + got.parseError +
                     ') -- its raw bytes are under "files".');
        }
        if (got.exists) files[got.file] = got.source;
        else notes.push(got.file + ' does not exist on GitHub yet.');
      }
    }

    if (env.DB) {
      const sql = [];
      for (const name of Object.keys(TABLES)) {
        const rows = await readTable(env.DB, name);
        sections[name] = { table: TABLES[name].table, count: rows.length, items: rows };
        sql.push(toSql(name, TABLES[name], rows));
      }
      files['signups-restore.sql'] = sql.join('\n');
    } else {
      notes.push('No D1 binding (DB) on this Pages project, so the newsletter and contact ' +
                 'lists are NOT in this bundle.');
    }

    return download(JSON.stringify({
      mycampuskornerBackup: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      source: cfg ? 'github:' + cfg.repo + '@' + cfg.branch : '(GitHub not configured)',
      // Unpublished draft edits are deliberately not here: Save is what makes
      // an edit real, and this is a copy of what the site actually serves.
      contains: 'published content + sign-up tables',
      notes,
      sections,
      files
    }, null, 2), 'application/json; charset=utf-8',
      'mycampuskorner-backup-' + stamp() + '.json');
  } catch (e) {
    return json(e.status || 502, { error: 'Export failed: ' + e.message });
  }
}
