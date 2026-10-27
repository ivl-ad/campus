/*
 * The shared-draft half of every Save (/api/catalog, /api/partners,
 * /api/blog, /api/team), in one place because the timing is subtle.
 *
 * A Save publishes the D1 draft to GitHub. The draft remembers which commit
 * it was based on (base_sha) so a direct commit in git is noticed instead of
 * overwritten. Two things can happen at the same moment as a Save:
 *
 *  - Another editor's Save. Their commit reaches GitHub a beat before their
 *    base_sha update reaches D1, so a Save in that gap would see a mismatch
 *    and wrongly call it an outside commit (whose advice, "Reset draft",
 *    throws away everyone's unpublished edits). settleBase() waits for the
 *    update to arrive and then says so plainly.
 *  - A stale read from GitHub. Its contents API answers from a replica and
 *    can return the PREVIOUS version of a file for a few seconds after a
 *    write, so the sha a Save compares against may simply be out of date.
 *    That is not an outside commit, and treating it as one was the reported
 *    bug: "js/partners.js changed on GitHub" straight after adding a partner,
 *    with Reset draft -- the advice -- then reseeding from the stale copy and
 *    losing the new row. settleBase() therefore re-reads BOTH sides.
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
// generous: the verdict at the end of it is 'outside', whose only remedy is
// Reset draft, and that discards unpublished work. Waiting a few seconds
// longer is always cheaper than sending somebody down that path wrongly.
// tools/test.mjs exercises the boundary either side.
const TRIES = 8, STEP = 500;

/*
 * Is the draft still based on what GitHub holds?
 *
 *   current   the first read, as { sha, ... }. For a file that does not exist
 *             yet, sha is the caller's NO_FILE sentinel.
 *   refetch   async () => a fresh read in that same shape, cache-busted.
 *
 * Returns { verdict, current } where current is the freshest read (use it for
 * the header and the PUT sha) and verdict is:
 *   null      -- in step; go ahead and publish
 *   'race'    -- another editor's Save is landing (press Save again)
 *   'outside' -- the file really was changed outside the editor (Reset draft)
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
  if (!base || base === current.sha) return { verdict: null, current };

  const started = base;
  for (let i = 0; i < TRIES; i++) {
    await sleep(STEP);
    // A failed re-read is not evidence of anything: keep the copy we have and
    // let the next turn (or the verdict below) decide.
    const fresh = await refetch().catch(() => null);
    if (fresh) current = fresh;
    base = await read();
    if (base === current.sha) return { verdict: null, current };
  }
  // Still apart. If OUR base moved while we waited, somebody else's Save is
  // mid-flight; if it never moved, the file genuinely changed under us.
  return { verdict: base === started ? 'outside' : 'race', current };
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

/*
 * The last resort, when the file really did change outside the editor. It
 * names Export first on purpose: Reset draft is the only way out, and it
 * discards unpublished work, so the team should take a copy before they do.
 */
export function outsideMessage(file) {
  return file + ' changed on GitHub since this draft was loaded — a direct commit in\n' +
    'git, or an edit made in another branch.\n\n' +
    'Nothing has been lost and nothing was published. Take a copy first with\n' +
    'Export ▾ → "Everything (JSON)", then press "Reset draft" to start again from\n' +
    'the version that is on GitHub, or reconcile the two in git.';
}

// entries: [[key, value], …] written only if the draft's epoch is unchanged.
export async function recordSave(db, meta, epoch, entries) {
  const stmts = entries.map(([k, v]) => (epoch === null
    ? db.prepare('INSERT INTO ' + meta + '(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2').bind(k, v)
    : db.prepare('INSERT INTO ' + meta + '(k,v) SELECT ?1, ?2 WHERE (SELECT v FROM ' + meta +
                 " WHERE k='epoch') = ?3 ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v, epoch)));
  await db.batch(stmts);
}
