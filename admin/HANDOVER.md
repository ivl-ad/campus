# Handover — MyCampusKorner, October 2026

This folder is the version to ship. It is `latest/campus-main(2)/campus-main`
(what is on GitHub today) plus the fixes and the new backup feature described
below. Everything here is tested; nothing in it has been deployed yet.

Read this file first in a new session. It lives under `admin/` so that the
editor password covers it: everything under that folder is behind
`functions/admin/_middleware.js`, and Cloudflare Pages publishes anything else
in the repo straight to the public site. `SETUP.md`, beside it, is the
operator's manual — how to set Cloudflare up and how the team uses the editor. This file
is the developer's: what the pieces are, what was wrong, and how to check your
work.

---

## 1. Which folder is which

| Folder | What it is |
| --- | --- |
| `campus-main/` (the top one) | A September snapshot. **Obsolete** — it has no unique files, every one of them is in `latest/`. Keep it as an archive or delete it; do not deploy it. |
| `latest/campus-main(2)/campus-main/` | Exactly what is on GitHub today, with a month of edits made through `/admin/`. The reference point. |
| `final/` ← **you are here** | `latest/` + this round of work. **This is what to deploy.** |

The two were reconciled by comparing them file by file: the September folder
contributed nothing that `latest/` did not already have, so `latest/` is the
only ancestor that matters.

### What changed, relative to `latest/`

```
.github/workflows/rebuild-listings.yml   blog + team pages are now rebuilt; push retried
admin/SETUP.md                           new section 13 (backups), corrected troubleshooting
admin/index.html                         Export ▾ menu
admin/signups.html                       "Back up everything" button
blog.html, index.html                    re-baked (they were stale — see 3.2)
functions/_shared/draft-save.js          baseMismatch() → settleBase()  ← the main fix
functions/api/catalog.js                 cache-busted GitHub reads; uses settleBase()
functions/api/partners.js                uses settleBase()
functions/api/team.js                    uses settleBase()
functions/api/blog.js                    uses settleBase()
functions/api/export.js                  NEW — the backup endpoint
HANDOVER.md -> admin/HANDOVER.md         moved behind the editor password
.gitignore                               tools/ is not committed (see below)
tools/dev-server.mjs, tools/test.mjs     NEW — run and test locally; NOT committed
```

Nothing else was touched. No data file (`js/products.js`, `js/partners.js`,
`js/blogs.js`, `js/team.js`) differs from `latest/` by a single byte.

## 2. Deploying it

The folder's contents **are** the repository root. There is no build step and
nothing to install.

1. Copy everything in `final/` over your checkout of the repo. It is a
   superset — nothing needs deleting.
2. In GitHub Desktop, review the changed files, commit, and push to `main`.
   `tools/` will not appear: it is in `.gitignore` on purpose (see section 6).
3. Cloudflare Pages redeploys in about a minute. The Action will also run, but
   the baked pages are already correct in this folder, so it will report
   "Pages already match the data files" and commit nothing.

**Nothing in this repo rebases, merges or force-pushes.** The one automated
commit — the Action's page rebuild — is always a plain commit on top of the
branch head, so the history stays linear and GitHub Desktop only ever needs
"Pull origin". If a Save lands while the Action is running, it does not try to
reconcile two histories: it starts again from the new head, rebuilds from the
data files it finds there, and commits once. That path was tested against a
throwaway local repo, including the mid-run Save.

No Cloudflare settings change. No new variables, no new bindings — `/api/export`
uses the same `GITHUB_*` variables and the same `DB` binding as everything
else, and sits behind the same password.

**Before you push, take a backup** (`/admin/` → **Export ▾** → Everything).
That is now a ten-second job, and it is the habit this round of work was
meant to make possible.

### Checking it afterwards

Everything here was tested against a stand-in GitHub and an in-memory
database, never against the real ones — no token for them, and rightly so. So
the first few minutes after the deploy are the real test. In order, each one
checking something that was changed:

1. **Open `/admin/`.** The table loads → GitHub reads still work with the new
   cache-busting query string. (If anything was going to break, this is it,
   and it breaks loudly and harmlessly.)
2. **Export ▾ → Everything (JSON).** A file downloads. Keep it: it is the
   backup for the rest of this list.
3. **Partners → add a logo → Save. Then add another → Save.** Two saves in a
   row inside a minute is the exact pattern that used to fail. Both should
   just work.
4. **Check the Actions tab.** A products or blog save should run the workflow
   and commit the rebuilt pages. Watch for a push failure on the first run —
   that is the rebase step, and the only part that cannot be tested anywhere
   but GitHub.
5. **Look at `/blog`.** The Wellness category and the newest post should be
   there (they were missing before this deploy).
6. **Signups → Download CSV**, and **Back up everything**.
7. In a private window, open `/admin/SETUP.md`. It should ask for the
   password — that is what keeps this handover, which sits beside it, off the
   public site too.

**If step 1 fails**, it is the GitHub reads: revert the deploy
(Cloudflare Pages → Deployments → roll back to the previous one) and the
editor is exactly as it was. Nothing in this release changes stored data, so a
rollback costs nothing.

---

## 3. What was wrong, and why

### 3.1 The reported bug: "js/partners.js changed on GitHub"

**Symptom.** Adding a partner and pressing Save showed:

> js/partners.js changed on GitHub since this draft was loaded (a direct commit
> in git, or a Save that finished while the draft was being reset).
> Press "Reset draft" to start over…

**Cause.** GitHub's contents API answers reads from a replica and sends
`Cache-Control: private, max-age=60` on authenticated ones, so a read taken
shortly after a write can return the **previous** version of a file. The Save
path compared one such read against the draft's recorded `base_sha`, and when
they disagreed it concluded the file had been changed outside the editor.

It had not. The save was perfectly ordinary — it just read a stale copy.

**Why it mattered more than an annoying message.** The advice in that message
is "Reset draft", and Reset reseeds the draft from GitHub — *through the same
stale read*. So the recovery could reload the version from **before** the
partner was added and throw away the row the person had just typed. The error
and its remedy together could lose work.

**The fix.** `settleBase()` in `functions/_shared/draft-save.js` replaces
`baseMismatch()`. Instead of trusting one read, it re-reads **both** sides —
GitHub and `base_sha` — for up to two seconds, and only calls it an outside
commit if they still disagree. In support of that, every GitHub `GET` in
`functions/api/catalog.js` is now un-cacheable (unique query string,
`Cache-Control: no-cache`, `cf.cacheTtl: 0`).

Two kinds of passing disagreement now resolve by themselves:

* GitHub's read is behind → the re-read catches up → the save proceeds.
* Another editor's save landed → our `base_sha` catches up → also proceeds,
  because the shared draft already contains their edits. If it genuinely
  cannot settle, you get "press Save again", not "reset everything".

A real outside commit is still caught, and its message now tells you to
**export first** — because Reset really does discard unpublished work.

This is in the regression suite as `STALE READS -- the October bug`. Keep
that section passing.

### 3.2 The blog and team pages were never rebuilt

`build_content.py` bakes the blog listing, the three blog cards on the home
page, and the About page team out of `js/blogs.js` and `js/team.js`. It was
written, documented in SETUP.md — and **never called by the GitHub Action**,
which only ran `build_listings.py` and only triggered on `js/products.js`.

So every blog post and team member saved since that script was added reached
the data file, and the live pages never caught up. Running
`build_content.py --check` against `latest/` showed it plainly: the blog
listing was missing a whole category (**Wellness**) and the home page was
showing an older post as the newest.

Fixed in the workflow: it now triggers on `js/blogs.js` and `js/team.js` too,
runs both build scripts, and commits all four baked pages. `blog.html` and
`index.html` in this folder have been rebuilt, so the live site is correct the
moment you deploy rather than after the next save.

### 3.3 The Action's push could fail silently

The rebuild job pushed without pulling first. A Save landing while it ran
(which commits a data file to the same branch) made that push fail
non-fast-forward, and the rebuilt pages were simply never published. It now
rebases and retries up to three times, and fails loudly if it still cannot.

### 3.4 A second round, from two code reviews

After the three above were fixed, two reviewers went over the backend and the
editor's browser code looking for anything else that could lose work. These
are the ones that were real, confirmed in the code, and fixed. Each is covered
by a test or was checked in a browser.

**Could publish something nobody had seen**

* *The draft's rows were read in a round trip after the epoch check* — so a
  Reset or a History restore landing in between meant Save committed whatever
  the reseed had just put there, and reported it as a success. All four save
  endpoints now re-check the epoch **after** reading the rows
  (`epochChanged()` in `_shared/draft-save.js`).
* *Save stayed enabled during a reload* — when another editor reset or
  restored, this page adopted the new epoch and fetched the new table, but the
  old table was still on screen and Save still worked. Pressed in that gap it
  passed every guard and published the version just loaded. A `reloading` flag
  now holds Save off until the new table is actually rendered.
* *A remote reorder was skipped while the caret was in that row* — and
  `row.pos` was left stale with nothing to correct it, so the editor's order
  silently disagreed with the draft. On Partners that is the published strip
  order. The move is now always applied, with focus and caret restored.
* *The cell under the cursor kept its local value but never re-sent it* — once
  the debounce had flushed there was nothing queued, so the draft still held
  the colleague's value while the screen showed yours, and Save published
  theirs. The value is now re-queued, so what is on screen is what publishes.

**Could lose edits**

* *A failed send grew the queue without bound* — and the server applies only
  the first 500 ops it is sent, still answering 200, so the **newest** edits
  were the ones dropped. Field edits for a row are now folded together as they
  are requeued, and the client never sends more than 400 ops at once.
* *A request that never settled wedged the editor* — `inFlight` stayed true for
  ever, polling stopped, and a Save sat disabled on "Saving…" until the tab was
  reloaded. Every request now has a 20-second deadline and fails into the
  normal retry path.

**Could block the whole team**

* *A malformed blog category 500'd every blog Save* — one hand-committed
  `{"id": "food"}` with no label reached the renderer as `undefined` and threw,
  with nothing in the message to point at it. `jsValue` is now total and
  unusable category entries are dropped.
* *A sanitiser refusal named no post* — one odd paste, in anyone's hidden
  draft, blocked every editor from publishing any blog change. The error now
  names the post.
* *Client and server disagreed about prices* — a negative price passed the
  editor and was refused by the server, and since it sat in the **shared**
  draft it broke everyone's Save. The client now uses the server's exact rule.
  Related: the price box used `parseFloat`, so `19x` silently became `19` —
  the cell showed one thing and the site published another. It uses `Number()`
  now and marks the cell invalid.
* *The category dropdown rewrote the row on every render* — locally only, so a
  row with no category looked complete here, passed the editor's own check,
  and the server then refused everyone's Save without saying which row. It no
  longer writes to the row, an unknown slug keeps an option of its own, and
  `catLabel` is checked client-side.

**Smaller, still real**

* `js/products.js` and friends lost their whole comment header on the next
  Save if the declaration ever gained a leading space (`headerBefore` and
  `extractArray` disagreed about indentation).
* A History restore left `base_sha` untouched, which combined with a Save
  landing at the same moment could leave the draft permanently reporting
  "changed on GitHub". The restore now records what GitHub holds at that
  moment, which is what the restored draft is genuinely based on.
* `/api/history` reads were cacheable, so the version list could omit the Save
  you had just made.
* Sign-up paging had no tie-breaker, so two sign-ups in the same millisecond
  could show one twice and drop the other across a page boundary.
* `{list:'contact', remove:true}` deleted message #1.
* The honeypot still honoured a field called `website` — the one name Safari's
  contact AutoFill fills — so a real sign-up caught by it was dropped with a
  cheerful "thank you" and no trace.
* Maps keyed by user-typed slugs were plain `{}`, so `constructor` was always
  "present": phantom duplicate-id errors, and a hard crash in the blog link
  checker.

### 3.5 A third round: reviewing the fixes themselves

The changes above were then reviewed as a diff against `latest/`, looking only
for bugs the changes had introduced. They had introduced six, which is why the
pass was worth doing. All are fixed and tested.

* **A retry storm.** The new "drain the backlog without waiting for the poll"
  shortcut could not tell a capped backlog from a requeued failure, so a
  dropped connection became a 60 ms retry loop — a simulated outage fired 129
  requests in five seconds, and a hidden tab did not stop it. It now drains
  only after a send that got through, and never while the tab is hidden. Same
  simulation: 8 requests.
* **An endless write loop.** To stop the screen disagreeing with the draft,
  the focused field's value was re-sent when it differed from the server's.
  But `row.data` is a deep copy, so for any array or object the comparison was
  always unequal — the blog drawer's "Continue reading" selects would have
  written to the database every ~400 ms, for ever, from one editor with a
  select focused.
* **Reverting a colleague from a cell you were only parked in.** The same
  re-send fired on focus alone, so an editor with a caret resting in a cell
  would undo someone else's edit to it without touching the keyboard — and two
  carets in one cell would ping-pong indefinitely.

  Both are gone. The rule is now simply: **unsent keystrokes win, everything
  else takes the server's value, including the cell the caret is in** — and
  the focused input is refreshed rather than left showing something the draft
  no longer holds. (A long rich field like an article body still keeps its old
  behaviour, since rewriting one under the cursor costs more than it saves.)
* **Free products.** `Number()` replaced `parseFloat()` to stop `19x` being
  read as `19` — but `Number('')` is `0`, so a price cell holding only `$` or
  a comma would have published the item at zero. An empty remainder is now not
  a number.
* **A category dropdown that could not be satisfied.** Making the `<select>`
  stop writing to the row left a row with no category showing the first one in
  the list while Save complained "cat is required", and re-picking the option
  already displayed fires no event. Such a row now shows "— choose a category
  —". `catLabel` is no longer demanded of the editor at all: the server
  derives it from `cat` (`tidy()` in `functions/api/catalog.js`), which also
  fixes a quieter regression — renaming a category used to reach every product
  through the editor's re-render, and no longer did.
* **An unreachable guard.** The new "every blog category was dropped" check
  could never fire, because validation upstream had already rejected anything
  that would trigger it. It now compares against what the file held, which is
  the case actually worth catching.

Also tightened in the same pass: the stale-read budget went from ~2s to ~4s
(the suite now tests either side of it, and proves that past the budget the
Save is refused *safely* — nothing committed, the row still in the draft);
the epoch is re-checked once more immediately before the commit, because
`settleBase` can wait seconds in between; a History restore reads the head sha
*after* the reseed and says so if that read fails; `reloading` is cleared on
the paths that return early; and the backup endpoint no longer gives up
entirely when GitHub is misconfigured or one data file is unreadable — it
returns what it can with a note, which is the whole point of a backup.

### 3.6 Looked at and deliberately left alone

* **A retried Add can resurrect a row someone else deleted.** The create op
  sets `deleted=0` on conflict, which looks wrong until you notice that
  undo-of-a-delete re-creates the row through that same op. Making the
  resurrection impossible would break Undo. The window needs a lost response
  plus a deletion plus a retry, and the result is a visible blank row, so it
  was left as the better trade. Revisit only with a per-attempt token.
* **`forms.js` truncates an over-long contact message silently.** Worth a
  visible warning one day; it loses a tail, not a message.
* **History restore does not validate the version it loads.** An old version
  that today's rules reject leaves the draft unsaveable until it is fixed or
  reset.

---

## 4. The new thing: backups

**`/admin/` → Export ▾**, on every tab, plus **Back up everything** on the
Signups page. The operator-facing description is SETUP.md section 13; what
follows is what a developer needs.

`functions/api/export.js` is deliberately standalone. It reads the published
files from GitHub and the sign-up tables from D1 — it does not touch the
draft, the editor, or any other endpoint — so it still works when they are
broken. That is the whole point of a backup.

```
GET /api/export                                   everything, JSON
GET /api/export?section=products                  one section, JSON
GET /api/export?section=partners&format=js        the data file, verbatim
GET /api/export?section=newsletter&format=csv     spreadsheet
GET /api/export?section=contact&format=sql        INSERT OR IGNORE, to restore into D1
```

sections: `all` `products` `partners` `blog` `team` `newsletter` `contact` ·
formats: `json` `js` `csv` `sql`

The "everything" bundle carries each data file's **exact bytes** under `files`,
so a restore is a paste-and-commit and never depends on this code being able
to re-render the file correctly.

**What is actually at risk.** Worth being precise, because the honest answer
changes what you should worry about:

* Products, partners, blog and team are in **git**. Every Save is a commit.
  They already have full history, and a bad deploy cannot touch them — a
  deploy changes pages, not data files. Export is a convenience here.
* Newsletter sign-ups and contact messages are in **D1 only**. Nothing else
  has a copy. Drop the binding or the database and they are gone. These are
  the rows worth downloading on a schedule.

---

## 5. How the system fits together

```
         browser (public)                     browser (/admin/, password)
                │                                         │
      js/products.js, partners.js,            admin/index.html — one page,
      blogs.js, team.js  (read live)          four documents (?view=)
                │                                         │
                │                              /api/draft?doc=…   ← shared live draft
                │                                         │          (D1, polled ~2.5s)
                │                              Save → /api/catalog | partners | blog | team
                │                                         │
                │                              commit the data file to GitHub
                │                                         │
                │                              Action: build_listings.py + build_content.py
                │                              re-bake store/index/blog/about → commit
                │                                         │
                └──────────── Cloudflare Pages deploys ───┘
```

* **Data lives in git as JS files.** `window.PRODUCTS = [...]` and friends.
  Readable by the browser with no API, and versioned for free.
* **The draft lives in D1**, one table-set per document (`draft_*`,
  `partner_*`, `blog_*`, `team_*`). It is the shared scratchpad; GitHub is the
  truth. `base_sha` ties one to the other and `epoch` marks a reset.
* **Some pages are baked, some are live.** `store.html`, `index.html`,
  `blog.html`, `about.html` carry their content as HTML so they are crawlable
  — those are what the two Python scripts rebuild. `product.html`,
  `category.html`, `merchant.html`, `blog-post.html` read the data files in
  the browser and need no rebuild. `js/partners.js` is read live, which is why
  partner saves trigger no Action at all.
* **Sign-ups** come in through `functions/forms/*` into D1 and are read back
  at `/admin/signups`.

Files worth knowing:

| File | Why you would open it |
| --- | --- |
| `functions/_shared/draft-save.js` | All the save-time concurrency logic. Small, and the comments explain the timing. Start here. |
| `functions/api/draft.js` | The shared draft: ops, seq, epoch, presence, seeding. |
| `functions/_shared/js-data.js` | Reading and writing the data files. The array scanner is deliberately not a regex — read the comment before changing it. |
| `functions/api/blog.js` | Much the largest API: it also sanitises pasted HTML. |
| `admin/index.html` | The whole editor. `DOCS` near the top describes each tab; the rest is generic. |

---

## 6. Running and testing it locally

```bash
node tools/dev-server.mjs          # http://localhost:8800  → /admin/
node tools/test.mjs --serve        # the regression suite, starts its own server
```

`tools/dev-server.mjs` serves the static site and runs the **real**
`functions/` handlers against a stand-in GitHub held in memory and an
in-memory SQLite database. Save, History and Reset all work and commit
nowhere. It cannot touch the real repo: the handlers are pointed elsewhere
with the `GITHUB_API` variable `functions/api/catalog.js` already supports.

It also has hooks for forcing the failures that matter, under `/__t/` — a
stale GitHub read, an outage, a direct commit. See the comment at the top of
the file.

**The suite is 119 checks and should be 0 failures.** Two tests report as
*skipped*: both need `HTMLRewriter`, a Cloudflare runtime API with no Node
equivalent, used to sanitise pasted article HTML. There is
deliberately no polyfill — a hand-made one would let the suite claim a
sanitiser worked when it had never run. To cover that path, use the real
runtime:

```bash
npx wrangler pages dev .
```

(`.wrangler/` is already in `.gitignore`, so this was in use before.) Against
wrangler you get genuine `HTMLRewriter` and a local D1; you would need to
supply the `GITHUB_*` variables, and it will talk to the real GitHub, so use
a scratch repo.

**`tools/` is deliberately NOT committed** (see `.gitignore`). Cloudflare
Pages publishes everything that is in the repo, and a dev server and a test
suite are not part of serving the site, so they would only add public surface
at `mycampuskorner.com/tools/`. They live in the working folder instead —
keep that folder, because a fresh clone will not have them. If you would
rather have them version-controlled, move them to `admin/tools/`: everything
under `admin/` is behind the editor password.

---

## 7. If you change the save path

The timing is genuinely subtle and the comments in `draft-save.js` are there
because each case cost something to find. Before changing it:

* Two drafts of the same document never exist — there is **one** shared draft
  per document. A Save publishes it as it stands, including other people's
  edits. That is intended.
* `base_sha` says which commit the draft was built on. `epoch` says which
  *generation* of the draft it is, bumped by Reset and by a History restore.
  Edits and saves carry the epoch they were made against so a reset cannot be
  half-applied.
* **Never conclude anything from a single GitHub read.** That was the bug.
* A mismatch that tells the user to Reset is a destructive instruction. Make
  very sure before showing it, and point at Export first.

Then run the suite, and add a case for whatever you just changed.

---

## 8. Known limitations and things left undone

* **Blog HTML sanitising is not covered by the local suite** (section 6).
  Use wrangler if you touch `sanitizeHtml` or `unsafeOutput` in
  `functions/api/blog.js`.
* **There is no import.** Export writes; restoring is a git commit (content)
  or pasting SQL into the D1 console (sign-ups), both documented in SETUP.md
  section 13. An import endpoint is the obvious next step if restores ever
  stop being rare — it needs care, since it would be the one endpoint that
  can overwrite everything at once.
* **Backups are manual.** The export is a plain authenticated URL, so a
  scheduled job could fetch it; nothing schedules one today. Worth doing for
  the sign-up lists, which are the only data with no second copy.
* **One shared password** for the whole team, so access cannot be revoked per
  person. SETUP.md's closing section describes the Cloudflare Access route if
  that ever matters.
* **`cancel-in-progress` on the Action** means a rebuild can be cancelled by a
  newer one. That is safe — both scripts rebuild from whatever the data files
  hold at that moment, so the surviving run covers the cancelled one — but it
  is worth remembering when reading the Actions tab.
