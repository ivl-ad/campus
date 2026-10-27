/*
 * The shared-draft half of every Save (/api/catalog, /api/partners,
 * /api/blog, /api/team), in one place because the timing is subtle.
 *
 * A Save publishes the D1 draft to GitHub. The draft remembers which commit
 * it was based on (base_sha) so a direct commit in git is noticed instead of
 * overwritten -- and then merged, see planOutside() below. Three things can
 * look like such a commit at the moment of a Save:
 *
 *  - Another editor's Save. Their commit reaches GitHub a beat before their
 *    base_sha update reaches D1, so a Save in that gap would see a mismatch
 *    and wrongly call it an outside commit. settleBase() waits for the
 *    update to arrive and then says so plainly.
 *  - A stale read from GitHub. Its contents API answers from a replica and
 *    can return the PREVIOUS version of a file for a few seconds after a
 *    write, so the sha a Save compares against may simply be out of date.
 *    That is not an outside commit, and treating it as one could send the
 *    team to Reset draft, which would reseed from the same stale copy and
 *    lose the row just added. settleBase() therefore re-reads BOTH sides.
 *    (The October 2026 "js/partners.js changed on GitHub" reports turned out
 *    to be a REAL outside commit -- see planOutside() -- but this hazard is
 *    real too.)
 *  - A Reset or a History restore. That reseeds the draft and bumps its
 *    epoch. recordSave() only moves base_sha when the epoch is still the one
 *    this Save started from -- otherwise the reseeded draft would be marked
 *    as based on the new commit, and the next Save would quietly undo it.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read BEFORE the rows, like the counter in draft.js: anything that lands
// in between shows as unpublished afterwards rather than being lost.
export async function draftMarks(db, meta) {
  const seq = Number(await db.prepare('SELECT v FROM ' + meta + " WHERE k='seq'").first('v')) || 0;
  const epoch = await db.prepare('SELECT v FROM ' + meta + " WHERE k='epoch'").first('v');
  return { seq, epoch: epoch === undefined ? null : epoch };
}

// Up to ~4s of re-reading before giving up. GitHub's replica lag after a
// write is normally well under a second, but the budget is deliberately
// generous: the verdict at the end of it is 'outside', which means a merge --
// and, if GitHub's read was merely slow, a commit GitHub then refuses and a
// "press Save again". Waiting a few seconds longer is cheaper than either.
// tools/test.mjs exercises the boundary either side.
const TRIES = 8, STEP = 500;

/*
 * Is the draft still based on what GitHub holds?
 *
 * An 'outside' verdict is not the end of the Save: the caller hands it to
 * planOutside(), which merges the outside change in.
 *
 *   current   the first read, as { sha, ... }. For a file that does not exist
 *             yet, sha is the caller's NO_FILE sentinel.
 *   refetch   async () => a fresh read in that same shape, cache-busted.
 *
 * Returns { verdict, current, base } where current is the freshest read (use it for
 * the header and the PUT sha) and verdict is:
 *   null      -- in step; go ahead and publish
 *   'race'    -- another editor's Save is landing (press Save again)
 *   'outside' -- the file really was changed outside the editor (merge it)
 *
 * The two sides can disagree for a second or two without anything being
 * wrong, in BOTH directions: our base_sha may not have caught up with another
 * editor's Save, or GitHub's read may be the stale one. Re-reading both until
 * they agree is what tells a passing disagreement from a real one -- a plain
 * one-shot comparison reported perfectly ordinary Saves as outside commits.
 */
export async function settleBase(db, meta, current, refetch) {
  const read = () => db.prepare('SELECT v FROM ' + meta + " WHERE k='base_sha'").first('v');
  let base = await read();
  if (!base || base === current.sha) return { verdict: null, current, base };

  const started = base;
  for (let i = 0; i < TRIES; i++) {
    await sleep(STEP);
    // A failed re-read is not evidence of anything: keep the copy we have and
    // let the next turn (or the verdict below) decide.
    const fresh = await refetch().catch(() => null);
    if (fresh) current = fresh;
    base = await read();
    if (base === current.sha) return { verdict: null, current, base };
  }
  // Still apart. If OUR base moved while we waited, somebody else's Save is
  // mid-flight; if it never moved, the file genuinely changed under us.
  return { verdict: base === started ? 'outside' : 'race', current, base };
}

/*
 * true when the Save came from a page that loaded an older epoch of the draft
 * -- somebody pressed Reset draft or restored a version since. Publishing now
 * would send out a version that person has not seen, so the Save is refused.
 * (A page too old to send its epoch is not checked.)
 */
export function epochMoved(body, draftEpoch) {
  return body.epoch !== undefined && body.epoch !== null && draftEpoch !== null &&
         String(body.epoch) !== String(draftEpoch);
}

/*
 * The draft's rows are read in a round trip of their own, after the epoch has
 * been checked, so a Reset or a History restore can replace every one of them
 * in between. True when that happened: the Save must then be refused rather
 * than commit a list the person pressing Save has never seen. (The reverse
 * order already fails safe, because the epoch they sent would not match.)
 */
export async function epochChanged(db, meta, since) {
  if (since === null || since === undefined) return false;
  const now = await db.prepare('SELECT v FROM ' + meta + " WHERE k='epoch'").first('v');
  return now !== null && now !== undefined && String(now) !== String(since);
}

export const RESET_MESSAGE =
  'The shared draft was just reset or restored by another editor, so this Save was not sent. ' +
  'Check the table (it has reloaded), then press Save again.';

export const RACE_MESSAGE =
  'Another editor saved a moment ago, so this Save was not sent. Press Save again to ' +
  'publish the latest shared draft — nothing has been lost.';

// ------------------------------------------- commits made outside the editor
/*
 * A push from GitHub Desktop (or any edit in git) that changes a data file
 * moves it on from the version the draft was based on. That used to stop
 * every Save in that section until somebody pressed Reset draft -- which also
 * threw away whatever the team had just typed, and which nobody knew to do.
 * It is what actually broke the Partners tab: one placeholder line removed by
 * hand from js/partners.js on 23 Sep 2026, and no partner Save went through
 * for a month afterwards.
 *
 * Now a Save merges instead, row by row, the way git merges lines:
 *   base    the file the draft was based on (fetched by its blob sha)
 *   theirs  the file on GitHub now
 *   ours    the draft
 * A stretch only one side changed takes that side's version. A row both
 * sides changed differently keeps the draft's -- it is what the person
 * pressing Save is looking at -- and is named in the reply; GitHub's version
 * stays in History.
 *
 * Two things keep this safe:
 *  - Nothing is written to the draft until GitHub has accepted the commit,
 *    and the commit names the sha it replaces, so GitHub refuses it if that
 *    is not really the head. A stale read can therefore never leak into the
 *    draft or the file.
 *  - A LARGE outside change -- most likely an old copy of a data file pushed
 *    by mistake -- is not merged silently. The Save stops and the editor
 *    asks: keep GitHub's change and merge, or publish the draft as shown and
 *    undo it. Either way nothing has been published until somebody chooses.
 */

// More rows than this removed or changed on GitHub, and the Save asks first.
const BIG = 3;

// Field order and empty values never count as a difference.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort()
      .filter((k) => v[k] !== undefined && v[k] !== null && v[k] !== '')
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/*
 * How one section's rows are compared. tidy is the section's own publish
 * normalisation, so a draft row and the same row read back from the file
 * compare equal; keyField names the field that says "this is the same row,
 * edited" (a product's id, a partner's name).
 */
export function rowRules(tidy, keyField, noun) {
  return {
    canon: (r) => canonical(r && typeof r === 'object' ? tidy(r) : r),
    key: (r) => String((r && r[keyField]) || '').trim().toLowerCase(),
    label: (r) => String((r && (r.name || r.id)) || ('an unnamed ' + noun))
  };
}

// Longest common subsequence: for each a-index, the b-index it pairs with, or -1.
function lcs(n, m, eq) {
  const w = m + 1;
  const L = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = eq(i, j) ? L[(i + 1) * w + j + 1] + 1
                              : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const pair = new Array(n).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(i, j)) { pair[i] = j; i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
    else j++;
  }
  return pair;
}

/*
 *   base, theirs   lists of rows, as parsed from the two files
 *   ours           the draft: [{ rid, data, touched }] in table order, where
 *                  touched = edited since base was published
 * Returns { rows: [{ rid?, data }], conflicts: [label] }. A row with a rid is
 * the draft's own; one without is GitHub's, new to the draft.
 */
export function mergeRows(base, ours, theirs, rules) {
  const cB = base.map(rules.canon), cT = theirs.map(rules.canon);
  const cD = ours.map((r) => rules.canon(r.data));
  const kB = base.map(rules.key), kT = theirs.map(rules.key);
  const kD = ours.map((r) => rules.key(r.data));
  // A draft row nobody has touched since base was published IS its base row,
  // even where the publish step reshaped it (the blog fills in dates and
  // excerpts), so for those the key alone is enough.
  const bd = (i, j) => cB[i] === cD[j] || (!ours[j].touched && kB[i] !== '' && kB[i] === kD[j]);
  const bt = (i, k) => cB[i] === cT[k];
  const pairD = lcs(base.length, ours.length, bd);
  const pairT = lcs(base.length, theirs.length, bt);

  const out = [], conflicts = [];
  const own = (j) => ({ rid: ours[j].rid, data: ours[j].data });
  const span = (a, b) => { const r = []; for (let x = a; x < b; x++) r.push(x); return r; };

  // One stretch where base, ours and theirs do not all agree.
  const resolve = (B, D, T) => {
    if (!B.length && !D.length && !T.length) return;
    const same = (X, Y, eq) => X.length === Y.length && X.every((x, n) => eq(x, Y[n]));
    if (same(B, T, bt)) { D.forEach((j) => out.push(own(j))); return; }   // GitHub left it alone
    if (same(B, D, bd)) { T.forEach((k) => out.push({ data: theirs[k] })); return; }  // so did we
    if (same(D, T, (j, k) => cD[j] === cT[k])) { D.forEach((j) => out.push(own(j))); return; }
    if (!B.length) {                       // both added rows here: keep both
      T.forEach((k) => { if (!D.some((j) => cD[j] === cT[k])) out.push({ data: theirs[k] }); });
      D.forEach((j) => out.push(own(j)));
      return;
    }
    // Row by row.
    const usedB = new Set(), usedT = new Set();
    const fresh = (k) => !B.some((i) => bt(i, k));          // GitHub added or changed it
    D.forEach((j) => {
      const i = B.find((x) => !usedB.has(x) && bd(x, j));
      if (i !== undefined) {               // our copy is the base row, untouched
        usedB.add(i);
        const k = T.find((x) => !usedT.has(x) && bt(i, x));
        if (k !== undefined) { usedT.add(k); out.push(own(j)); return; }   // GitHub kept it
        const k2 = kB[i] ? T.find((x) => !usedT.has(x) && fresh(x) && kT[x] === kB[i]) : undefined;
        if (k2 !== undefined) { usedT.add(k2); out.push({ data: theirs[k2] }); }  // GitHub edited it
        return;                            // ...or deleted it
      }
      out.push(own(j));                    // ours: new or edited
      if (kD[j]) {
        const k = T.find((x) => !usedT.has(x) && fresh(x) && kT[x] === kD[j]);
        if (k !== undefined) { usedT.add(k); conflicts.push(rules.label(theirs[k])); }
      }
    });
    T.forEach((k) => {
      if (usedT.has(k) || !fresh(k)) return;   // a base row we deleted stays deleted
      // GitHub edited a row the draft deleted: the deletion stands.
      if (kT[k] && B.some((i) => !usedB.has(i) && kB[i] === kT[k])) {
        conflicts.push(rules.label(theirs[k]));
        return;
      }
      out.push({ data: theirs[k] });
    });
  };

  let b = 0, d = 0, t = 0;
  for (let i = 0; i < base.length; i++) {
    if (pairD[i] < 0 || pairT[i] < 0) continue;
    resolve(span(b, i), span(d, pairD[i]), span(t, pairT[i]));
    out.push(own(pairD[i]));               // all three agree on this row
    b = i + 1; d = pairD[i] + 1; t = pairT[i] + 1;
  }
  resolve(span(b, base.length), span(d, ours.length), span(t, theirs.length));
  return { rows: out, conflicts };
}

// What the outside commit did, in rows, for the reply and the "is it big" test.
export function outsideSummary(base, theirs, rules) {
  const cB = new Set(base.map(rules.canon)), cT = new Set(theirs.map(rules.canon));
  const gone = base.filter((r) => !cT.has(rules.canon(r)));
  const fresh = theirs.filter((r) => !cB.has(rules.canon(r)));
  const goneKeys = new Set(gone.map(rules.key).filter(Boolean));
  const freshKeys = new Set(fresh.map(rules.key).filter(Boolean));
  return {
    removed: gone.filter((r) => !freshKeys.has(rules.key(r))).map(rules.label),
    changed: fresh.filter((r) => goneKeys.has(rules.key(r))).map(rules.label),
    added: fresh.filter((r) => !goneKeys.has(rules.key(r))).map(rules.label)
  };
}

const names = (list) => list.slice(0, 8).join(', ') +
  (list.length > 8 ? ' and ' + (list.length - 8) + ' more' : '');

function describe(s) {
  const parts = [];
  if (s.added.length) parts.push('added ' + names(s.added));
  if (s.changed.length) parts.push('changed ' + names(s.changed));
  if (s.removed.length) parts.push('removed ' + names(s.removed));
  return parts.join('; ') || 'reordered rows';
}

// The 409 that asks. The editor turns outside.merge / outside.overwrite into
// confirm() questions and sends the answer back with the same sha.
function askReply(file, sha, what) {
  const head = file + ' was changed on GitHub outside the editor (a push from GitHub ' +
    'Desktop, or an edit in git) since this draft was loaded.';
  const overwrite = 'Publish the draft exactly as it is shown instead, undoing the change ' +
    'made on GitHub to ' + file + '?\n\nOK = publish the draft. The GitHub version stays ' +
    'in History.\nCancel = do nothing for now.';
  const tail = '\n\nNothing has been published. Press Save again to choose, or take a copy ' +
    'first with Export ▾.';
  if (what.summary) {
    const big = '\n\nIt is a large change: ' + describe(what.summary) + '.';
    return {
      error: head + big + tail,
      outside: {
        file, sha, summary: what.summary,
        merge: head + big + '\n\nKeep that change and add the draft\'s edits on top of it?\n\n' +
               'OK = merge (right if the push was meant).\n' +
               'Cancel = other choices (right if an old copy was pushed by mistake).',
        overwrite
      }
    };
  }
  const why = what.unreadable
    ? 'The file on GitHub cannot be read (' + what.unreadable + '), so the two cannot be merged.'
    : 'The version this draft was based on could not be fetched (' + what.nobase + '), so the ' +
      'two cannot be merged.';
  return {
    error: head + '\n\n' + why + tail,
    outside: { file, sha, overwrite: head + '\n\n' + why + '\n\n' + overwrite }
  };
}

export async function savedSeq(db, meta) {
  const raw = await db.prepare('SELECT v FROM ' + meta + " WHERE k='save'").first('v');
  try { const s = JSON.parse(raw); return Number(s && s.seq); } catch (e) { return NaN; }
}

// The draft's rows as a Save reads them: [{ rid, seq, data }] in table order.
export async function draftRows(db, rows) {
  const got = await db.prepare('SELECT rid, seq, data FROM ' + rows +
                               ' WHERE deleted=0 ORDER BY pos, rid').all();
  return got.results.map((r) => ({ rid: r.rid, seq: Number(r.seq), data: JSON.parse(r.data) }));
}

/*
 * Called when settleBase() says 'outside'. Returns one of
 *   { ask }                 a 409 body: the editor must choose first
 *   { overwrite: true }     publish the draft as it is (chosen)
 *   { merged, summary }     publish merged.rows
 *
 *   o.base       the draft's base_sha       o.current   the fresh read
 *   o.rows       draftRows() of this Save   o.parse     source -> list
 *   o.fetchBase  sha -> source, or null when the base is "no file yet"
 *   o.choice     'merge' | 'overwrite' from the editor, honoured only when
 *   o.choiceSha  matches the file the question was asked about
 */
export async function planOutside(db, meta, o) {
  const chosen = o.choice && o.choiceSha && o.choiceSha === o.current.sha ? o.choice : null;
  if (chosen === 'overwrite') return { overwrite: true };

  let theirs, base;
  try { theirs = o.current.exists === false ? [] : o.parse(o.current.source); } catch (e) {
    return { ask: askReply(o.file, o.current.sha, { unreadable: e.message }) };
  }
  try {
    const src = await o.fetchBase(o.base);
    base = src === null ? [] : o.parse(src);
  } catch (e) {
    return { ask: askReply(o.file, o.current.sha, { nobase: e.message }) };
  }

  const summary = outsideSummary(base, theirs, o.rules);
  if (chosen !== 'merge' && summary.removed.length + summary.changed.length > BIG) {
    return { ask: askReply(o.file, o.current.sha, { summary }) };
  }
  const saved = await savedSeq(db, meta);
  const ours = o.rows.map((r) => ({ rid: r.rid, data: r.data, touched: !(r.seq <= saved) }));
  return { merged: mergeRows(base, ours, theirs, o.rules), summary };
}

// The line added to a successful Save's reply.
export function outsideNote(plan, adopted) {
  if (!plan) return '';
  if (plan.overwrite) {
    return '  The draft was published as shown, replacing the change made on GitHub ' +
           'outside the editor (that version is still in History).';
  }
  let s = '  This Save also took in the change made on GitHub outside the editor (' +
          describe(plan.summary) + ').';
  if (plan.merged.conflicts.length) {
    s += ' Where the draft and that change both edited a row, the draft\'s version was ' +
         'published: ' + names(plan.merged.conflicts) + ' -- GitHub\'s is in History.';
  }
  if (adopted === 'busy') {
    s += ' The table was being edited at the same moment, so it will show the merged ' +
         'rows after the next Save.';
  }
  return s;
}

/*
 * After a merged Save has been committed, bring the draft in line with what
 * was published -- GitHub's rows added, the rows it removed tombstoned --
 * without disturbing anything typed since the Save read the rows (a row
 * edited since then keeps that edit). One transaction, guarded on the draft's
 * counter, retried if somebody types in between. Returns 'ok', 'reset' (the
 * draft was reset meanwhile, so it already holds what GitHub has) or 'busy'
 * (base_sha left alone, so the next Save simply merges again).
 *
 *   o.read    draftRows() as this Save read them    o.seq    draftSeq
 *   o.merged  merged.rows that were published       o.epoch  draftEpoch
 *   o.newSha  the blob sha just committed           o.save   the save note
 */
export async function adoptMerged(db, tables, o) {
  const keep = new Set(o.merged.filter((r) => r.rid).map((r) => r.rid));
  for (let attempt = 0; attempt < 3; attempt++) {
    const marks = await draftMarks(db, tables.meta);
    if (o.epoch !== null && marks.epoch !== null && String(marks.epoch) !== String(o.epoch)) {
      return 'reset';
    }
    const now = new Map();
    (await db.prepare('SELECT rid, pos, seq, deleted FROM ' + tables.rows).all())
      .results.forEach((r) => now.set(r.rid, r));
    const next = marks.seq + 1;
    // Numbers only, so they are written into the SQL rather than bound.
    const guard = '(SELECT v+0 FROM ' + tables.meta + " WHERE k='seq') = " + Number(marks.seq) +
      (o.epoch === null ? '' : ' AND (SELECT v+0 FROM ' + tables.meta + " WHERE k='epoch') = " +
                               Number(o.epoch));
    const stmts = [];

    o.read.forEach((r) => {
      if (keep.has(r.rid)) return;
      const cur = now.get(r.rid);
      if (!cur || cur.deleted || Number(cur.seq) > o.seq) return;   // edited since: that wins
      stmts.push(db.prepare('UPDATE ' + tables.rows + ' SET deleted=1, seq=' + next +
                            ' WHERE rid=?1 AND ' + guard).bind(r.rid));
    });

    // GitHub's rows go between their neighbours in the merged order.
    const list = o.merged;
    const posAt = (k) => {
      const c = k >= 0 && k < list.length && list[k].rid ? now.get(list[k].rid) : null;
      return c ? Number(c.pos) : null;
    };
    for (let i = 0; i < list.length;) {
      if (list[i].rid) { i++; continue; }
      let j = i;
      while (j < list.length && !list[j].rid) j++;
      const n = j - i;
      let lo = posAt(i - 1), hi = posAt(j);
      if (lo === null && hi === null) { lo = 0; hi = n + 1; }
      else if (lo === null) lo = hi - (n + 1);
      else if (hi === null) hi = lo + (n + 1);
      for (let k = i; k < j; k++) {
        stmts.push(db.prepare('INSERT INTO ' + tables.rows + '(rid,pos,seq,deleted,data) ' +
                              'SELECT ?1,?2,' + next + ',0,json(?3) WHERE ' + guard)
          .bind(crypto.randomUUID(), lo + (hi - lo) * (k - i + 1) / (n + 1),
                JSON.stringify(list[k].data)));
      }
      i = j;
    }

    const rowsChanged = stmts.length > 0;
    // "Published up to": the merge's own rows too, unless somebody's edits
    // landed after this Save read the table -- those must stay unpublished.
    const save = JSON.stringify(Object.assign({}, o.save, {
      seq: marks.seq === o.seq && rowsChanged ? next : o.seq }));
    const put = (k, v) => db.prepare('INSERT INTO ' + tables.meta + '(k,v) SELECT ?1, ?2 WHERE ' +
                                     guard + ' ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, v);
    stmts.push(put('base_sha', o.newSha), put('save', save));
    // Last, so every statement above saw the counter it was guarded on.
    if (rowsChanged) {
      stmts.push(db.prepare('UPDATE ' + tables.meta + " SET v=v+1 WHERE k='seq' AND " + guard));
    }
    await db.batch(stmts);
    if (await db.prepare('SELECT v FROM ' + tables.meta + " WHERE k='base_sha'").first('v') === o.newSha) {
      return 'ok';
    }
  }
  return 'busy';
}

// entries: [[key, value], …] written only if the draft's epoch is unchanged.
export async function recordSave(db, meta, epoch, entries) {
  const stmts = entries.map(([k, v]) => (epoch === null
    ? db.prepare('INSERT INTO ' + meta + '(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2').bind(k, v)
    : db.prepare('INSERT INTO ' + meta + '(k,v) SELECT ?1, ?2 WHERE (SELECT v FROM ' + meta +
                 " WHERE k='epoch') = ?3 ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v, epoch)));
  await db.batch(stmts);
}
