# Handover — MyCampusKorner, October 2026

This folder is the version to ship. It is `latest/campus-main(2)/campus-main`
plus the fixes and features described below, in two rounds:

* **Round 1** (backups, stale reads, the rebuild Action) — **deployed on
  27 Oct 2026** as commits `1160b7a` and `93c6228` ("update").
* **Round 2** (commits made outside the editor are merged, not refused; new
  product categories) — section 3.7 and section 5. **Deployed on 27 Oct 2026**
  as `ad80dfe`; four minutes later a partner Save went through on the live
  site (`58ebe5e`, "Partners: 22 logos … by vlad") — the first since 22 Sep.
* **Round 3** (product images never cropped; product images and partner
  logos stored on the site) — sections 3.8 and 3.9. **Deployed on 27 Oct
  2026**, except the cache fix (3.10, `stamp_assets.py`), which was finished
  after that push and goes out with round 4.
* **Round 4** (the team's first two rounds of feedback: carousel, six home
  page categories and a Categories tab, the site's own visit counts,
  product descriptions, blog scheduling and product cards,
  affiliate-link warnings, blog covers stored on the site) — the list below
  and sections 5 and 8. **In this folder, tested, not yet deployed.**

**Start with 3.1 and 3.7.** The reported error had a different cause from
the one round 1 fixed, and those two sections are the accurate account.

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

### Round 4 — what changed since the round-3 push

```
index.html                              student carousel: 3 new photos (13 in all), the
                                        white "price tag" bubbles removed, slower scroll;
                                        "disparate" gone; six category cards
images/model-11..13*, fitness-img*      NEW — the new carousel photos, the Health & Fitness card
js/categories.js                        NEW — THE category list (Categories tab), section 5
functions/api/categories.js             NEW — its Save: validation, delete guard, merge
functions/api/draft.js, history.js,     the Categories tab's shared draft, History and Export
  export.js
functions/api/catalog.js                a product's category must be in js/categories.js;
                                        js/products.js no longer carries a category list
admin/index.html                        Categories tab; Products menu from it ("Manage
                                        categories…" replaces "+ New category…"); Analytics link
build_listings.py                       bakes the category cards, the "six core campus
                                        tracks" count and every page's menu + footer links
fetch_images.py, _headers, workflow     a category picture given as a link is copied too
js/listing-page.js, js/product-page.js  category names from js/categories.js
functions/_shared/site-data.js          the same, for titles, share text and the sitemap
functions/hit.js, _shared/stats.js      NEW — the site's own visit counter (section 5)
functions/api/analytics.js              NEW — its report
admin/analytics.html                    NEW — the Analytics tab
js/analytics.js                         NEW — on every page: page views and clicks out
*.html (13 pages)                       the Google Analytics placeholder removed (it never
                                        worked: G-XXXXXXXXXX); js/analytics.js added;
                                        category pages load js/categories.js
js/site-config.js                       GA_MEASUREMENT_ID: '' = off (switch for later)
privacy-policy.html                     describes what is actually collected (no GA)
stamp_assets.py                         (round 3.10, first push)
tools/dev-server.mjs, tools/test.mjs    /hit routed; 297 checks (not committed)

--- second round of feedback ---
js/products.js                          50 products: a description for each; names and
                                        stores tidied (typos, casing, stray dashes, the
                                        pasted Bentgo text); the "Moving (copy)" test
                                        entry removed; the Hisense TV and the popcorn
                                        maker moved to Dorm & Living Essentials. Header
                                        carries "data-release: 2026-10-28-r4" (5, below)
js/categories.js                        the two emptied categories removed: six left
functions/_shared/draft-save.js         a push labelled with a newer data-release is
                                        merged without the "large change" question
build_listings.py                       menus list the featured ("Shown") categories only
js/listing-page.js                      a category with no products says "coming soon"
fetch_images.py                         blog covers copied too; a big cover that is a file
                                        on the site gets a lighter WebP copy
images/blog-covers/                     NEW, GENERATED — those copies (1.85 MB -> 240 KB)
build_content.py                        covers from the copies, as relative paths (the
                                        pages work opened from disk); scheduled posts
                                        wait for their time
functions/_shared/site-data.js,         scheduled posts hidden until their time (post
  js/blog-page.js, functions/api/blog.js  page, blog category pages, sitemap)
js/blog-page.js, css/site-custom.css    product links in articles; a paragraph that is
                                        only a product link shows as a product card
blog-post.html, blog-category.html      load js/products.js / js/local-images.js
admin/index.html                        Blog: Scheduled status, a Product button in the
                                        article toolbar, "not on the site yet" made loud;
                                        Products/Partners: links without affiliate
                                        tracking in red, with a line naming them;
                                        Categories: "Shown" = home card + menu link
.github/workflows/rebuild-listings.yml  a half-hourly timer (scheduled posts); covers folder
privacy-policy.html                     Cloudflare Web Analytics named
*.html, product functions               visible em dashes removed (footer, home, contact,
                                        blog description, generated share text)

--- third pass ---
*.html (13 pages)                       jQuery tag without crossorigin/integrity (a page
                                        opened from disk lost every animation: see 5)
js/site-config.js                       SOCIAL_LINKS set (TikTok, Instagram, Facebook);
                                        a plain menu icon when a page is opened from disk
build_listings.py                       footer icons, labelled social buttons and the
                                        Organization's @id + sameAs written into the pages
contact-us.html, index.html             social buttons (data-social-handles slots)
build_content.py                        writes /llms.txt
llms.txt                                NEW, GENERATED -- the site described for AI tools
css/site-custom.css                     .social-pill buttons
```

`js/partners.js`, `js/blogs.js` and `js/team.js` are byte-for-byte what
GitHub has (`2f1a990`, after vlad's Saves of 27 Oct); `js/products.js` is that
file plus the changes listed. `js/local-images.js` keeps this folder's four
larger image copies (book, king-hunter, moving, ticket-liquidator); GitHub's
are the 150 px originals.

### Round 3 — what changed since the round-2 deploy

```
css/site-custom.css                     card images fit whole: object-fit contain;
                                        one already card-shaped fills it (.fills)
js/catalog.js                           measures each card image, adds .fills
fetch_images.py                         finds the full-size version of a pasted thumbnail (3.9)
js/site-config.js, js/product-page.js   IMAGE_ENLARGE_LIMIT, off; ?imgcap=N preview (3.9)
admin/index.html                        product thumbnails show the site's copy (3.9)
*.html (13 pages)                       site-custom.css?v=20261027 (cache bump)
fetch_images.py                         NEW — stores image copies, writes js/local-images.js
js/local-images.js                      NEW, GENERATED — original address -> copy
images/products/, images/partners/      NEW — the copies (69 files, ~4.5 MB)
build_listings.py                       Store/Home cards use the copies
product/category/merchant/index.html    load js/local-images.js after the data file
functions/_shared/site-data.js          share images use the copies
.github/workflows/rebuild-listings.yml  runs fetch_images.py; also on js/partners.js
_headers                                the copy folders are sandboxed
admin/index.html                        "low-res" marker; local image paths show;
                                        "image served from" column (per-product opt-out)
functions/api/catalog.js                imgFrom: validated; "site" (default) never written
tools/test.mjs                          199 checks (not committed)
```

`js/partners.js` was brought up to date with GitHub (`58ebe5e`) before the
copies were made, so no data file differs from GitHub.

### Round 2 — what changed since the 27 Oct deploy

```
functions/_shared/draft-save.js   planOutside(), mergeRows(), adoptMerged()  ← the real fix (3.7)
functions/api/catalog.js          merge on Save; githubBlob(); categoryList() + PRODUCT_CATEGORIES
functions/api/partners.js         merge on Save
functions/api/team.js             merge on Save
functions/api/blog.js             merge on Save
functions/api/draft.js            the category menu starts from the file's list
functions/_shared/site-data.js    categories read from js/products.js
functions/category.js             real title / 404 for added categories
functions/sitemap.xml.js          added categories are in the sitemap
admin/index.html                  asks about a large outside change; "+ New category…"
js/listing-page.js                category + merchant pages read the file's list
build_listings.py                 Store filter buttons read the file's list
admin/SETUP.md, admin/HANDOVER.md
tools/dev-server.mjs, tools/test.mjs   blob endpoint, ASSETS binding, 181 checks (not committed)
```

No data file differs from GitHub. `js/products.js` gains its
`window.PRODUCT_CATEGORIES` list on the first products Save after the deploy,
not before.

### Round 1 — what changed, relative to `latest/` (deployed)

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

1. **In GitHub Desktop, Pull origin first**, so your checkout has every Save
   the team has made.
2. Copy everything in `final/` over your checkout of the repo. It is a
   superset — nothing needs deleting.
3. In GitHub Desktop, review the changed files. **If any of `js/products.js`,
   `js/partners.js`, `js/blogs.js` or `js/team.js` shows as changed and you
   did not mean to edit it, untick it.** A changed data file means the copy
   you are pushing is older or newer than what the editor saved. Since round 2
   that no longer breaks the editor (3.7) — a big difference is asked about,
   and small ones are merged — but the live site would still show your copy
   until the next Save.
4. Commit and push to `main`. `tools/` will not appear: it is in `.gitignore`
   on purpose (see section 6).
5. Cloudflare Pages redeploys in about a minute. The Action only runs when a
   data file or a build script changed; round 2 changes `build_listings.py`,
   so it runs once and reports "Pages already match the data files".

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

For round 4, in order:

1. **Home page** (Ctrl+F5 once): 13 photos in the student strip and no white
   bubbles; six category cards, the sixth Health & Fitness; the sentence above
   them says "six core campus tracks"; the header's Featured Categories menu
   and the footer list the eight categories.
2. **`/admin/?view=categories`** shows eight rows. Delete on *Living & Social
   Spaces* is refused, naming the product that uses it.
3. **Products tab:** the category menu lists the same eight and ends with
   **Manage categories…**.
4. **Actions tab:** the push changes `build_listings.py`, so the workflow runs
   once. Its commit should change nothing, or only `?v=` stamps.
5. **`/admin/analytics`** loads (zeros at first). Open a few public pages in
   another browser and press Refresh: they appear under Top pages. Then press
   **Don't count this browser** on each browser the team uses.
6. **Categories → Save** once, even with no change: that writes
   `js/categories.js` through the editor, so its History starts there.
7. **Products → change anything small → Save.** It goes through with no
   question and its message ends "This Save also took in the change made on
   GitHub…": that is the new descriptions and names being merged into the
   shared draft (the data-release label, section 5). Three rows show red urls
   (Belkin weekly deals, Gemini, Cloudfield: no affiliate tracking yet).
8. **Blog:** the two posts the team added are still in the shared draft:
   check their Status (Draft / Published / Scheduled) and press **Save**.

For round 3, in order:

1. **Open the home page.** The "See what actually works" cards show each
   image whole — Corp Direct and Grad Guard show their full logos. Hard-refresh
   once (Ctrl+F5) if a browser still has yesterday's stylesheet.
2. **Right-click a product image → Open image in new tab.** The address is
   `mycampuskorner.com/images/products/…`, not a retailer's.
3. **Check the Actions tab.** The push changes `build_listings.py` and
   `fetch_images.py`, so the workflow runs once and should report "Pages and
   images already match".
4. **Products → add a product with an image → Save.** About two minutes later
   the Action commits "Rebuild baked pages and image copies…" with the new
   copy in `images/products/`. Until then the image shows from its own
   address. If the log says a download was refused, that image simply stays
   on its own address (see 3.8).
5. **Products tab:** seven thumbnails say **low-res** (see 3.8).

For round 2 (already deployed and confirmed), in order:

1. **Open `/admin/`.** The table loads.
2. **Export ▾ → Everything (JSON).** Keep the file: it is the backup for the
   rest of this list.
3. **Partners → add a partner → Save.** This is the reported bug. Unless
   somebody pressed Reset draft *on the Partners tab* since 23 Sep, the
   partner draft is still based on the 22 Sep file, so this Save takes about
   five seconds and its message ends *"This Save also took in the change made
   on GitHub outside the editor (removed down2chill)"*. That is the merge
   working. The next partner Save is an ordinary one.
4. **Products → open any category menu.** It ends with **+ New category…**.
   No need to create one to check it; section 5 says what happens when you do.
5. **Check the Actions tab** after the first products Save. That Save also
   writes `window.PRODUCT_CATEGORIES` into `js/products.js`, so the workflow
   runs and should report the pages unchanged (or rebuilt, if a category was
   added).

**If step 1 fails**, roll back in Cloudflare Pages → Deployments. Round 2
writes nothing to the database until a Save, so a rollback costs nothing. A
`js/products.js` that already gained its category list is fine for the old
code (it only reads `window.PRODUCTS`) — **unless a new category was
created**: the old code refuses any category outside the built-in ten, so
move those products back to a built-in category first.

---

## 3. What was wrong, and why

### 3.1 The reported bug: "js/partners.js changed on GitHub"

**Symptom.** Adding a partner and pressing Save showed:

> js/partners.js changed on GitHub since this draft was loaded (a direct commit
> in git, or a Save that finished while the draft was being reset).
> Press "Reset draft" to start over…

**The actual cause — found in round 2, from the public repo's history.** The
message was telling the truth. On **23 Sep 2026** a commit named "update",
pushed from GitHub Desktop, removed one line from `js/partners.js` — the
`down2chill` placeholder ("delete this once we have real ones"). The last
editor Save of that file had been the day before ("Partners: 19 logos … by
Greg", blob `eb95ffd`); the push left it at blob `f5fa18d`. From then on the
partner draft was based on a version GitHub no longer held, and **every**
partner Save was refused — there is no partner commit at all between 22 Sep
and the round-1 deploy on 27 Oct. The other sections kept working because
later Saves there moved their drafts on.

The only way out was Reset draft — which also throws away whatever the team
had just typed, and which only resets **the tab it is pressed on** (pressing
it on Products does nothing for Partners). Round 1 kept that design and just
reworded the message, so after the deploy the error was still there. Round 2
removes the trap: such a commit is now merged on the next Save (3.7).

To reproduce it exactly, `tools/test.mjs` has the case, and section 3.7
records the run against the real 22 Sep and 23 Sep files.

**What round 1 fixed instead — a real, separate hazard.** GitHub's contents
API answers reads from a replica and sends `Cache-Control: private, max-age=60`
on authenticated ones, so a read taken shortly after a write can return the
**previous** version of a file. A Save that compared one such read against
`base_sha` would wrongly conclude the file had changed outside the editor, and
Reset (through the same stale read) could then reload the version from before
the partner was added. That can happen; it was simply not what was happening
here. Round 1's fix stands:

**The stale-read fix.** `settleBase()` in `functions/_shared/draft-save.js` replaces
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

A real outside commit is still detected — and since round 2 it is merged
rather than refused (3.7).

This is in the regression suite as `STALE READS -- the October bug`. Keep
that section passing; the name is historical.

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
non-fast-forward, and the rebuilt pages were simply never published. Each
attempt now fetches, resets its own throwaway checkout to the branch head,
rebuilds and commits once — no rebase, no merge, no force-push — and it
retries up to three times, failing loudly if it still cannot.

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
  `catLabel` is checked client-side. (Round 2 replaced the fixed list with
  `productCategories()` and **+ New category…**, so an unknown slug can no
  longer occur.)

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

### 3.7 Round 2: a commit made outside the editor is merged, not refused

The requirement: the site's code is updated by pushing from GitHub Desktop,
so a commit outside the editor must never break the editor, and the editor
must never damage the data. Everything is in `functions/_shared/draft-save.js`
(the comment above `BIG` is the design note); the four Save endpoints call it
the same way.

**When `settleBase()` says `'outside'`**, `planOutside()` runs a three-way
merge, row by row, the way git merges lines:

* **base** — the file the draft was based on, fetched by its blob sha
  (`githubBlob()` in `catalog.js`; GitHub's `git/blobs` endpoint, covered by
  the token's existing "Contents: read");
* **theirs** — the file on GitHub now;
* **ours** — the draft.

A stretch only one side changed takes that side's version; rows both sides
added are both kept; neighbouring rows edited on different sides both
survive. Rows are matched by content, and for a draft row nobody has touched
since the last publish also by key (product `id`, partner `name`, team `id`,
post `id`) — the blog's publish step adds dates and excerpts, so an untouched
draft row and its published copy are not byte-equal. "Touched" comes from the
draft's own counters (row `seq` vs the save marker's `seq`), not a guess.
**Where both sides changed the same row, the draft wins** — it is what the
person pressing Save is looking at — and the reply names the row and says
GitHub's version is in History.

**It stops and asks instead of merging when:**

* the outside change **removed or changed more than three rows** (`BIG`) —
  the signature of an old copy of a data file pushed by mistake. The editor
  shows two `confirm()`s, worded by the server: *keep that change and add the
  draft's edits* (merge), or *publish the draft exactly as shown, undoing the
  change* (the GitHub version stays in History). Cancel both and nothing
  happens;
* the file on GitHub **cannot be parsed** (a half-finished hand edit), or the
  base version cannot be fetched — then only "publish the draft as shown" is
  offered.

The answer is sent back with the sha it was about, and is ignored if GitHub
has moved on since (the question is asked again).

**Why it is safe:**

* Nothing touches the draft until GitHub has **accepted the commit**, and the
  commit names the sha it replaces. If the "outside" version was really a
  stale read, GitHub refuses the commit (409) and nothing anywhere changed —
  the user is told to press Save again.
* `adoptMerged()` then brings the draft in line (GitHub's rows inserted
  between their neighbours, removed rows tombstoned) in **one D1 transaction
  guarded on the draft's counter**, so an edit typed during the Save is never
  overwritten: a row edited since the Save read it keeps that edit and stays
  marked unpublished. If it cannot get a quiet moment in three tries, it
  leaves `base_sha` alone and the next Save simply merges again.
* No epoch bump, so no editor reloads: the merged rows arrive by the normal
  poll.

**Verified** with the real files: a draft based on the 22 Sep `partners.js`,
GitHub holding the 23 Sep one, a partner added and saved through the real
admin UI → *"Saved 19 partners … This Save also took in the change made on
GitHub outside the editor (removed down2chill)"*, and `down2chill` dropped out
of the editor without a reload. A simulated mistaken push dropping six
partners was asked about, and "publish the draft" put all six back. The blog
path was checked in a scratch run with a do-nothing `HTMLRewriter` (it never
enters the suite, for the reason in section 6).

### 3.8 Round 3: product images — never cropped, and stored on the site

**The cropping.** Every product card image used Webflow's `.full-img` rule,
`object-fit: cover`, in a fixed ~350 × 300 box. Cover fills the box by
cropping, so anything not that shape lost its ends — Corp Direct (400 × 131)
and Grad Guard (400 × 77) were cut down to the middle of their logos. The
catalog really is every shape: 468 × 60 and 160 × 600 ad banners, wide logos,
squares, 2400 × 1260. `css/site-custom.css` now fits each image whole inside a
white box (`object-fit: contain`, 12 px inset) — never cropped, never
stretched. It is the treatment `product.html` already gave its main photo
(`#p-image`). Only `.product-img-wrap` uses it, and that class is only ever a
product card (home rail, store, category, merchant, product-page rail).

An image that is already (within 5%) its card's own shape fills the card
edge to edge instead of sitting in a white frame: `js/catalog.js`
(`watchCards()`) measures each image against its actual box — which changes
with the screen, since the box is a fixed height and its column's width — and
adds `.fills` (cover, no inset), trimming the small difference evenly from
both sides, a few pixels at most. A `ResizeObserver` re-measures on resize
and when a hidden card (the store's paging) is revealed.

A small image is still scaled up to fill the box and can look soft; that is
the "manual fix" case. The editor marks those thumbnails **low-res** (long
side under 300 px — `lowRes` in the products `DOCS` entry, `LOW_RES` in
`fetch_images.py`). Seven were, at the time: Moving, Huffy bikes, Marriot
Bonvoy, Ticket Liquidator, Book Seats Tickets, Blick Art Supplys, Kingbull
Hunter.

**The copies.** `fetch_images.py` downloads every product image and partner
logo into `images/products/` or `images/partners/` and writes
`js/local-images.js`: original address → copy. It deliberately **does not
edit the data files** — the editor keeps the original address, so the
rebuild's commit is never "a commit made outside the editor" (3.7), and the
admin, the draft and Export are untouched. Each reader uses the map:

| Reader | How |
| --- | --- |
| `build_listings.py` | `with_local_images()` before baking the Store/Home cards; structured data gets full addresses (`absolute()`) |
| `product.html`, `category.html`, `merchant.html`, `index.html` | load `js/local-images.js` right after the data file; its generated footer points `PRODUCTS[].img` / `PARTNERS[].logo` at the copies, so `product-page.js`, `listing-page.js` and `partner-marquee.js` are unchanged |
| `functions/_shared/site-data.js` | `localImages()` — share images and structured data for the SEO functions |

An address with no copy — a product saved a minute ago, or a download the
retailer refused — just shows from its own address, as before. Nothing
breaks if the map is missing.

**When copies are made.** The GitHub Action runs `fetch_images.py` before the
build scripts on every change to `js/products.js` or `js/partners.js`, and
commits new copies, dropped copies, the map and the rebuilt pages in its one
commit. Simulated against a throwaway repo: new image stored, removed
product's copy deleted, a Save landing mid-run retried, data files never in
the bot's commit, history linear. The 69 copies in this folder were made from
this machine; GitHub's runners may be refused by some retailers' CDNs (they
block data-centre addresses) — such a product keeps its own address and the
log says so.

**Details that matter:**

* Copies are named `<id>-<hash of address>.<ext>`: a new address is a new
  file, so browsers never show a stale one (images are cached for a week).
* With Pillow (the Action installs `pillow==12.3.0`, the version used here),
  anything over 1200 px is scaled down and saved as WebP, and AVIF is
  converted to WebP (Safari before 16 cannot show AVIF). Never scaled up,
  cropped or stretched; animated GIFs, SVGs and favicons are kept as is. That
  took the 50 product images from 11.6 MB to 3.9 MB.
* A copy is deleted only when nothing uses its address **and** no product or
  partner names the file directly — pointing a product at its own copy
  (`images/products/x.jpg`) is a valid manual fix, and an earlier draft of
  the script deleted exactly that file. Hand-placed files are never touched.
* The answer must actually be an image (checked by its first bytes — an HTML
  error page served with 200 is refused), at most 15 MB, and an SVG
  containing script is refused. `_headers` also sandboxes both folders with a
  CSP, since these are third-party files served from the site's own origin.
* To fetch an image again (the retailer replaced the picture at the same
  address): `python fetch_images.py --refresh <product id>`, or delete the
  file and run it.

### 3.10 Why a deploy "changed nothing": browser caching, and the fix

After the 3.8/3.9 deploy the live site looked unchanged. Two caches:

* **JavaScript — 4 hours.** Every `.js` file comes back with
  `Cache-Control: public, max-age=14400`. That is not in `_headers`; it is the
  Cloudflare zone's **Browser Cache TTL** (4 hours is Cloudflare's default),
  which overrides Pages' own `max-age=0` for static file types. It applies to
  the data files too, so an editor's Save could take up to 4 hours to reach a
  returning shopper. (HTML is not affected: pages come back `max-age=0`.)
* **Stylesheets — a day**, from `_headers`, keyed by `?v=`. The stylesheet
  changed but its `?v=20261027` did not, so Cloudflare's edge kept serving the
  old one (`cf-cache-status: HIT`).

**The fix does not depend on any dashboard setting:** `stamp_assets.py` writes
each page's own scripts and stylesheets as `file?v=<first 10 of the content's
sha1>`. Pages are never cached, so a changed file is a new address on the very
next page load; unchanged files keep theirs and stay cached. The Action runs
it last on every rebuild and commits any page whose stamps moved — so an
editor's Save now reaches shoppers in the ~2 minutes the Action takes, not up
to 4 hours. It also runs on any push touching `js/` or `css/`. `js/vendor/`
is left alone (versioned file names, cached a year). Simulated against a
throwaway repo: after two Saves, `product.html` names `products.js?v=` equal
to the file's real fingerprint, and the race retry still works.

(Optional, not required: setting the zone's Browser Cache TTL to "Respect
Existing Headers" in Cloudflare would also stop the 4-hour override.)

### 3.9 Small product images: a full-size version is fetched automatically, and an optional enlargement limit

Measured on the product page (photo area ~650 × 540 on a desktop): 9 images
were blown up 2.2–4.3×, 11 by 1–2×, 30 shown at or below natural size. The
worst 9 are all fixed-size affiliate ad creatives (150 × 150, 180 × 150,
300 × 250), for which no bigger version of that file exists.

**B — a pasted thumbnail is swapped for its full-size version
(`fetch_images.py`, automatic).** When a product image's copy is first made
and comes out under 800 px, `upgrade_candidates()` rewrites the address
without its size markers (Shopify `_200x200` / `?width=`, Walmart `odnWidth`,
Best Buy `;maxWidth=`, WordPress `-300x250`, Amazon `._AC_SX300_`, Wix,
Cloudinary-style `/c_fill,w_300/`, Squarespace `?format=300w`, Salesforce
Commerce `?sw=`) and `find_bigger()` downloads at most four candidates. One is
used only if it is bigger and **the same picture**: same shape within 3%, and
alike within 12/255 when both are shrunk to 16 × 16 *colour* pixels (grey
alone let a red and a blue product variant pass — the colour check is there
because of that test). An address with no size marker costs no requests.
Once per image, when its copy is made; the data keeps the pasted address.
Product images only — partner logos are shown small, and a full-size logo is
weight with no visible gain. Verified against real CDNs from thumbnail
addresses: Shopify 200 → 1000, Walmart 180 → 2500, Best Buy 200 → 2000, and
end to end in the admin (paste a thumbnail → "low-res" → Save → rebuild →
the copy is 1000 × 1000 and the mark is gone).

**Impact thumbnails.** `app.impact.com/display-thumbnail/<ad>` is the
thumbnail of a banner; the product's Impact link (`/c/<account>/<ad>/<campaign>`)
names the campaign, and Impact's own banner code loads the full creative from
`a.impactradius-go.com/display-ad/<campaign>-<ad>` (views are counted by a
separate `/i/` pixel this never touches; the link is only read, never
followed, since following it would count as a click). `--retry-small` was run
once over every existing copy with this rule: Good Greek 150×125 → 300×250,
Ticket Liquidator 150×150 → 250×250, King Hunter 150×85 → 3024×1700, Book
Seats 150×150 → 4320×4320. Still low-res, with nothing bigger anywhere:
Huffy bikes and Blick Art Supplys (fixed-size AvantLink/ShareASale banners),
Marriot Bonvoy (Impact campaign logo) and Ticket Liquidator (its creative is
250 px). A covers those. Run `--retry-small` by hand again only when the rules
here gain a new case; new images get the check automatically.

The admin's product thumbnails now show the **copy the site shows**
(`siteCopy()`, reading `js/local-images.js`), so the low-res mark reflects
what visitors see; a product with no copy yet, or set to "retailer's
address", shows its pasted address.

**A — the enlargement limit (`IMAGE_ENLARGE_LIMIT` in `js/site-config.js`,
applied by `capPhoto()` in `js/product-page.js`).** **On, at 2** (it first
shipped at 0 for preview; the operator then asked to see it live).
With a value above 0, the product page photo is never enlarged more than that
many times: the photo's inset grows so the space it is fitted into is exactly
the capped size, so the panel never changes size and nothing moves.
**Compare without affecting anyone:** `?imgcap=0` on any page shows that
browser the site without the limit (localStorage, with a small label in the
corner); `?imgcap=site` forgets it. To turn it off for everyone, set
`IMAGE_ENLARGE_LIMIT = 0` and push. Cards are not limited — they fill or frame as in 3.8.

AI upscaling was considered and deferred (the operator may run it locally
later); if it comes back, the advice was to do it in the same rebuild step,
never at Save, and to leave affiliate creatives alone.

**Affiliate impressions — the per-product opt-out.** 19 of the 50 images were
affiliate-network creatives at the time (Impact, Awin, CJ, ShareASale,
AvantLink, FlexOffers). Some networks count a view each time their image
loads (CJ's image links are built for exactly that); served from a copy, they
no longer see views. Clicks are unaffected — the Buy links are untouched.

So each product has **image served from** (the column after *img url*):

* **this site (copy)** — the default, and the recommendation: same domain,
  cached a week, scaled to size, and immune to the retailer moving or
  deleting the file. Not written to the file at all.
* **retailer's address** — `"imgFrom": "retailer"` in `js/products.js`.
  The img url is always loaded as is: `fetch_images.py` skips the product
  (and deletes a copy only it used), `build_listings.py`, the generated
  footer of `js/local-images.js` and `site-data.js` all leave it alone. Use
  it for a creative whose view counts matter or whose program's terms require
  the hosted file.

The choice is per product, not per image: if a partner logo or another
product uses the same address, their copy stays (Blick's partner logo and the
"art supplies" product share one Awin image, for example). Validation
accepts only `site`, `retailer` or nothing; the editor's select can only
produce those.

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
  the browser and need no rebuild. `js/partners.js` is read live too; partner
  saves still run the Action, but only so `fetch_images.py` can store new
  logos (3.8).
* **Sign-ups** come in through `functions/forms/*` into D1 and are read back
  at `/admin/signups`.

### Product categories (round 4: the Categories tab)

**`js/categories.js` is the list** — `window.CATEGORIES = [{id, name, home,
button, text, img, alt}, …]`, in site order — edited in its own tab
(`/admin/?view=categories`) with the same shared draft, Save, History and
outside-commit merge as Partners and Team. `id` is the category page's address
and what each product's `cat` refers to; it never changes once products use
it. A **rename** changes `name` only, and reaches every page at the next
rebuild — before any product is saved again (the readers below take the name
from the list, not from each product's `catLabel`; the next products Save
updates `catLabel` too). `home: "hidden"` = no card on the home page; the
category still has its page, menu link and Store filter.

| Reader | What it does with it |
| --- | --- |
| `build_listings.py` | the home page cards (shown ones, in order, numbered 01…), the "N core campus tracks" count, every page's header menu and footer category links, the Store filters. A card picture saved the Webflow way (`images/X_1X.avif` + `X_1-p-500/800/1080`) gets a srcset; any other gets just `src`. A product in a category the list lacks is a **warning**, not a stopped build. |
| `functions/api/catalog.js` | products Save refuses a category the list lacks, by name; `catLabel` = the list's name |
| `functions/api/categories.js` | its own Save: `validate()` (slug ids, unique; a shown card needs picture, text and button) and the **delete guard**: a category used by any product — published, or in the products' shared draft — is refused, naming the products. Changing an id counts as deleting the old one. |
| `admin/index.html` | Categories tab (same rules client-side, plus Delete refused on the spot); Products menu loads the list from the Categories draft (so a category added a minute ago is offered) and re-reads it when the tab regains focus |
| `js/listing-page.js`, `js/product-page.js` | names on category/merchant/product pages |
| `functions/_shared/site-data.js` | `category.js` (real title / 404) and `sitemap.xml.js` |
| `fetch_images.py` | a card picture given as an https link is copied into `images/categories/` |

The older arrangement — a `window.PRODUCT_CATEGORIES` list inside
`js/products.js`, and **+ New category…** in the product menu — is gone. The
code still reads it when `js/categories.js` does not exist (a rollback), and
the first products Save after the deploy drops it from `js/products.js`.

The two categories still used by one product each (Living & Social Spaces,
Kitchen & Dining) are kept, hidden from the home page; Laundry & Cleaning,
Bathroom and Bedroom & Study had no products and were removed.

### A deliberate bulk change pushed from git: `data-release`

A push that changes more than three rows of a data file makes the next Save
in that tab stop and ask (3.7), because the usual cause is an old copy pushed
by mistake. A *meant* bulk change says so in the file's header comment:

```
 * data-release: 2026-10-28-r4
```

`releaseBumped()` in `functions/_shared/draft-save.js`: a label newer (as text,
so keep the date first) than the one in the draft's base merges like a small
change. An old copy has an older label or none and is still asked about.
Editors' Saves keep the header, so the label stays. Round 4's `js/products.js`
carries one. Next time you hand-edit many rows in git, bump it. A row that an
editor had also changed (unsaved in the shared draft) keeps the editor's
version, as for any merge; the Save's message names it.

### Blog: scheduled posts, product links, covers

* **Scheduled** = Status Published with a publish date still to come. The
  post's page, blog category pages and the sitemap hide it until then on each
  request (`site-data.js` `posts` is a getter; `js/blog-page.js` filters in the
  browser). The baked listings (`blog.html`, the home page's three cards) are
  rebuilt by the Action, which now also runs every 30 minutes (cron
  `7,37 * * * *`), so they catch up within about half an hour. GitHub pauses
  timers after 60 days without repository activity. The editor shows
  "Scheduled" in the Status column and the panel (`isScheduled()`).
* **Product links**: the article toolbar's **Product** button links the
  selected words to `product.html?id=…`, or with nothing selected adds a
  paragraph holding only such a link. `js/blog-page.js` `productLinks()` turns
  that paragraph into a card (picture, store, name, "View product") from
  `js/products.js` as it is at view time; a link to a product that no longer
  exists keeps its words and loses the link. No new markup: these are plain
  links, already allowed by both cleaners.
* **Covers** are copied by `fetch_images.py` like product images: an https
  cover is downloaded; a big cover that is a file on the site (`LIGHTER`
  folders) gets a WebP copy named after its content. `build_content.py` uses
  the copy and writes site paths relative (`images/…`, not `/images/…`), which
  is what made the home page's blog cards lose their pictures when the page
  was opened from disk. `js/local-images.js` swaps `BLOG_POSTS` too.

### Affiliate links (admin only)

`isAffiliate()` in `admin/index.html`: the networks' click hosts (`AFF_HOSTS`:
Rakuten/LinkShare, Awin, FlexOffers, ShareASale, CJ's domains, Impact's
shared domains, Amazon with `tag=` …) plus Impact's link shapes on a brand's
own tracking host (`/c/<n>/<n>/<n>`, or a six-character code). A product or
partner url that is none of these is red, and one line under the toolbar names
them. It never blocks a Save. A new network's links will show red until its
host is added to `AFF_HOSTS`.

### Cloudflare Web Analytics: not in the editor

An admin tab that read Cloudflare Web Analytics through the GraphQL API
(`functions/api/cf-analytics.js`) was built and then removed at the owner's
request: the editor is for the three content admins, and Cloudflare is the
owner's to read in its own dashboard (SETUP.md 17). Nothing in the site
depends on it; no Cloudflare API token or variable is needed. If it is ever
wanted again it is in this round's history (the dataset is
`rumPageloadEventsAdaptiveGroups`, whose fields Cloudflare documents only
through its dashboard).

### Social profiles, structured data and llms.txt

`SOCIAL_LINKS` in `js/site-config.js` is the one list. The page script
there draws the footer icons in the browser; `build_listings.py`
(`read_social()`, `bake_social()`) writes the same markup into every page, and
fills each `data-social-handles` slot (Contact page, home page "Stay
connected") with labelled buttons (network + handle), because most AI crawlers
run no script. `bake_org_profiles()` gives every MyCampusKorner Organization
in the pages' JSON-LD one `@id` (`https://mycampuskorner.com/#organization`)
and `sameAs` = the profiles: that is how search engines and AI assistants
link the accounts to the site. `build_content.py` writes `/llms.txt` (the
llmstxt.org convention: what the site is, its categories, the newest
published posts, the profiles) from the same data on every rebuild; the
Action commits it with the pages. Change a profile: edit `SOCIAL_LINKS` and
push; the Action rebuilds everything from it.

Cloudflare's managed robots.txt (on for this zone) blocks AI *training*
crawlers (GPTBot, ClaudeBot: 403) and allows search and assistant crawlers
(OAI-SearchBot, ChatGPT-User, PerplexityBot, Googlebot: 200). That is what
lets ChatGPT and others read the site when someone asks. Whether to also let
training crawlers in is a business choice (SETUP.md 11).

### Pages opened straight from disk

Two browser rules apply to `file://` only, never to the published site:
the jQuery tag carried `crossorigin="anonymous"` + `integrity` (left from
the Webflow CDN tag), which a file page cannot satisfy, so jQuery did not
load, `webflow.js` stopped and no animation ran (the stacked blog cards on
the home page did not scale and overlapped). The attributes are gone: SRI
protects against a third-party CDN, and this file is the site's own. And the
mobile menu button's Lottie animation (`documents/hamburger-menu.json`)
cannot be fetched from disk, so `js/site-config.js` puts a plain three-line
icon there in that case. The suite checks no page brings the attributes back.
`404.html` addresses everything from the site root on purpose (it is shown at
any address), so it only looks right served.

### Visit counts (round 4)

The site counts its own visits; nothing is sent to a third party.
`js/analytics.js` (every public page, deferred) sends a beacon to **`/hit`**
(`functions/hit.js`, public, always 204) on page load and when a link out to
another site is followed: a product's Buy button (by product id), a partner
logo (by name) or any other link (by host). `functions/_shared/stats.js`
turns that into **daily totals only** — five tables, `stats_pages`,
`stats_sources`, `stats_places`, `stats_devices`, `stats_clicks`, created on
first use in the same D1 database. No IP address, cookie, identifier or
per-visitor row is stored, so no consent banner is needed; the privacy policy
says exactly this. A "visit" is a page view whose referrer is not this site.
Paths are reduced to the site's own pages (`/product?id=…` etc.); anything
else counts as `/404`, so a stray request cannot fill the tables. Crawler
user agents and other origins are ignored. `/admin/analytics` reads
`/api/analytics?days=7|30|90|365` (behind the password). "Don't count this
browser" sets `localStorage.mckNoStats`, which the page script checks.

Cost: one D1 write batch per page view (1–4 rows), well inside the free
tier's 100,000 rows written a day.

**Google Analytics** is not loaded. The old snippet only ever had the
placeholder ID `G-XXXXXXXXXX`, so it never reported anything. To add GA4
later: put the Measurement ID in `GA_MEASUREMENT_ID` in `js/site-config.js`,
and first add a cookie notice and a GA paragraph to the privacy policy (GA
sets cookies; the own counts above do not).

Files worth knowing:

| File | Why you would open it |
| --- | --- |
| `functions/_shared/draft-save.js` | All the save-time concurrency logic, and the outside-commit merge (3.7). The comments explain the timing. Start here. |
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
the file. It serves GitHub's `git/blobs` endpoint (the merge's base version)
and Pages' `env.ASSETS` binding, so `/sitemap.xml` works locally; the other
SEO functions rewrite pages with `HTMLRewriter` and fall back to the plain page.

**The suite is 218 checks and should be 0 failures.** Two tests report as
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
* **Never conclude anything from a single GitHub read** (3.1, round 1).
* **A commit made outside the editor is normal**, not an error: pushes from
  GitHub Desktop happen. It is merged (3.7); never answer it with "Reset
  draft", which discards the team's unpublished work.
* **Change the draft only after GitHub has accepted the commit**, and only
  under the counter guard in `adoptMerged()` — that ordering is what makes a
  stale read harmless.

Then run the suite, and add a case for whatever you just changed.

---

## 8. Known limitations and things left undone

* **Blog HTML sanitising is not covered by the local suite** (section 6).
  Use wrangler if you touch `sanitizeHtml` or `unsafeOutput` in
  `functions/api/blog.js`. For the same reason the blog's *merge* path is
  tested by the shared merge tests and a scratch run, not by an end-to-end
  blog Save in the suite.
* **A category with no products** still gets its page, menu link and (if
  shown) home card — Health & Fitness today — and its page says "No items
  found" until products are put in it.
* **Two Saves at the same moment** — one deleting a category, the other moving
  a product into it — can publish a product in a deleted category. The build
  then only warns, the page still works, and the Products tab flags the row
  until it is moved.
* **Field-level merging is not done**: a product edited both in the push and
  in the editor's unsaved draft keeps the editor's whole row (5).
* **Blog article saves are still not covered end to end locally** (the
  cleaner needs Cloudflare's HTMLRewriter; section 6).
* **Visit counts start at the deploy**: there is no history before it, and
  visitors with JavaScript off, or blockers that block same-site beacons, are
  not counted. Reloads count as views (not visits).
* **Image copies arrive a minute or two after a Save** (the Action), and only
  if the retailer lets GitHub's servers download them; otherwise that image
  keeps its own address (3.8). Affiliate networks no longer count views of a
  copied creative; set that product's **image served from** to the
  retailer's address where that matters (3.8).
* **A merge conflict keeps the draft's row** (3.7). That is a policy, not a
  certainty about intent; the other version is always in History.
* **The "large change" threshold is a count** (more than three rows removed
  or changed). A deliberate bulk edit in git is asked about once; that is the
  intended price.
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
