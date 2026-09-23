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
 *    throws away everyone's unpublished edits). baseMismatch() waits for the
 *    update to arrive and then says so plainly.
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

/*
 * null when the draft is based on GitHub's current file; otherwise
 *   'race'    -- another editor's Save just landed (press Save again)
 *   'outside' -- the file was changed directly in git (Reset draft)
 */
export async function baseMismatch(db, meta, currentSha) {
  const read = () => db.prepare('SELECT v FROM ' + meta + " WHERE k='base_sha'").first('v');
  const first = await read();
  if (!first || first === currentSha) return null;
  let base = first;
  for (let i = 0; i < 5 && base === first; i++) {
    await sleep(300);
    base = await read();
  }
  return base === currentSha ? 'race' : 'outside';
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

export const RESET_MESSAGE =
  'The shared draft was just reset or restored by another editor, so this Save was not sent. ' +
  'Check the table (it has reloaded), then press Save again.';

export const RACE_MESSAGE =
  'Another editor saved a moment ago, so this Save was not sent. Press Save again to ' +
  'publish the latest shared draft — nothing has been lost.';

// entries: [[key, value], …] written only if the draft's epoch is unchanged.
export async function recordSave(db, meta, epoch, entries) {
  const stmts = entries.map(([k, v]) => (epoch === null
    ? db.prepare('INSERT INTO ' + meta + '(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=?2').bind(k, v)
    : db.prepare('INSERT INTO ' + meta + '(k,v) SELECT ?1, ?2 WHERE (SELECT v FROM ' + meta +
                 " WHERE k='epoch') = ?3 ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v, epoch)));
  await db.batch(stmts);
}
