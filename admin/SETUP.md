# Hosted catalog editor — setup

The editor at `/admin/` lets the management team edit the shop from a browser.
Everyone edits one **live shared draft** (stored in a D1 database, step 5):
edits appear on every open editor within a few seconds, with presence ("Anna
is also editing") and no rebuilds. Pressing **Save** publishes that draft by
committing `js/products.js` to GitHub; a GitHub Action then rebuilds
`store.html` and `index.html`, and Cloudflare Pages redeploys. About a minute
end to end. Nothing but Save ever touches GitHub or triggers a rebuild.

You keep the local editor too — `python catalog_server.py` — which writes to
your disk instead. Both use the same page and the same `/api/catalog` endpoint.

---

## 0. Deploying an update — is anything needed in Cloudflare?

If the editor already saves products for you, **no**: commit and push, and
Cloudflare Pages deploys. Everything new reuses what is set up below —

- the same password (`EDITOR_PASSWORD`), GitHub token, `GITHUB_REPO` /
  `GITHUB_BRANCH`, and the same D1 binding `DB`;
- new tables (blog/team drafts, sign-ups, contact messages, rate-limit
  counters) create themselves on first use — nothing to run in D1;
- the token needs nothing new: *Contents: read and write* covers every file
  the editor commits (`js/products.js`, `js/partners.js`, `js/blogs.js`,
  `js/team.js`).

If a data file (`js/products.js`, `js/partners.js`, `js/blogs.js`,
`js/team.js`) was changed in git rather than in the editor, press **Reset
draft** once on that tab after the deploy — the editor notices the outside
change and would otherwise refuse the next Save until you do (nothing is lost
either way).

Never set `GITHUB_API` in Cloudflare — it exists only for local testing.
`SITE_URL` is optional (only if the site's address is not
`https://mycampuskorner.com`).

After the first deploy, check once: open `/admin/`, each tab loads with
"Reset draft" (not "Reload") in the header, and send yourself a test
message from the Contact page — it appears under **Signups → Contact
messages**.

## 1. GitHub token

Create a **fine-grained** personal access token:
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained.

- **Repository access:** Only select repositories → `ivl-ad/campus`
- **Permissions:** Repository permissions → **Contents: Read and write**
  (that is the only one needed)
- **Expiration:** your call — the editor stops saving when it expires, with a
  clear error, so a long expiry is reasonable

Copy the token once; GitHub will not show it again.

## 2. Cloudflare Pages variables

Pages project → **Settings → Environment variables** → Production
(add them to Preview too if you use preview deploys):

| Name | Type | Value |
|---|---|---|
| `EDITOR_PASSWORD` | **Secret (encrypted)** | the shared password for the team |
| `GITHUB_TOKEN` | **Secret (encrypted)** | the token from step 1 |
| `GITHUB_REPO` | Plain text | `ivl-ad/campus` |
| `GITHUB_BRANCH` | Plain text | `main` |

Mark the first two **encrypted**. Redeploy after adding them — variables are
only picked up by a new deployment.

## 3. Allow the Action to push

Repo → **Settings → Actions → General → Workflow permissions** →
**Read and write permissions**. Without it the rebuild runs but cannot commit.

## 4. Try it

Visit `https://mycampuskorner.com/admin/`. The browser asks for a username and
password.

**The username is ignored.** Leave it blank or type anything at all — only the
password is checked, against `EDITOR_PASSWORD`. There is no username to set
anywhere in Cloudflare.

If the box keeps reappearing, the password does not match the variable. Press
Escape/Cancel at the prompt to read the error page, which says which case you
are in.

After a save: GitHub shows a new commit, the Action runs, and the site updates.
Watch progress in the repo's **Actions** tab.

## 5. D1 database — the live shared draft

One database powers the real-time co-editing. Without it the editor still
works, but falls back to the old one-screen-at-a-time behaviour.

1. Cloudflare dashboard → your account → **Storage & Databases → D1 SQL
   Database** → **Create database**. Name it `campus-draft` (any name works;
   the *binding* below is what the code sees). Leave location on automatic.
   Do **not** create any tables — the editor creates its own schema on first
   use.
2. **Workers & Pages → your Pages project → Settings → Bindings** (older
   dashboards: **Settings → Functions → D1 database bindings**) → **Add →
   D1 database**:
   - **Variable name:** `DB`  ← must be exactly this
   - **D1 database:** `campus-draft`
   Add the binding to **Production** (and Preview if you use preview deploys).
3. Redeploy — bindings are only picked up by a new deployment (Deployments →
   ⋯ on the latest → Retry deployment, or just push a commit).

How it behaves once bound:

- Everyone's keystrokes stream into the shared draft (debounced, batched) and
  every open editor polls for changes every ~2.5s while its tab is visible.
  Two people editing different fields of the same row both keep their edits;
  the same field at the same moment resolves to the last writer.
- **Save publishes the draft as it stands — including colleagues' edits.**
  After a save, other editors see "«name» saved N products — the site is
  rebuilding" and simply keep working toward the next save.
- **Reset draft** (replaces Reload) throws away *everyone's* unpublished edits
  and reloads the draft from the last saved catalog. It asks first.
- **History ▾** lists every saved version — each Save is a git commit, so the
  trail reaches back to the very first save and only ever grows. **Restore is
  draft-only:** it loads that version into the shared draft, every open editor
  reloads to it with a note saying who restored what, and that is all — no
  commit, no rebuild, no file is touched, the live site does not change.
  The restored table sits there as unpublished changes; review it (or keep
  editing) and press **Save** to publish it, exactly like any other edit.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z, or the ↶ ↷ buttons) covers your own
  edits since the last save — including bringing a deleted row back. Undoing
  syncs to the other editors like any other edit. Saved states are History's
  job, so the stacks clear on Save.
- **Columns ▾** shows/hides columns; drag a column header's right edge to
  resize it (double-click the edge resets). Remembered per browser. The name
  column stays pinned next to # and the row buttons while you scroll right.
- Spreadsheet keys: **Enter** moves down a cell (Shift+Enter up; in desc/note
  Shift+Enter makes a new line instead), **arrow keys** hop cells once the
  caret is at the edge of the text, and **/** jumps to the filter box.
- The old "somebody else saved, reload and redo" conflict is gone — there is
  one draft, so there is nothing to collide. The only 409 left fires if
  someone commits `js/products.js` directly in git while a draft is live;
  Reset draft recovers from that.
- Console diagnostics: `catalogSync.state()` on the editor page.

Cost: comfortably inside the free tiers (D1 allows 100k writes/day — a full
day of editing uses a few hundred; polling is a few thousand tiny requests per
editor per day against a 100k/day allowance).

## 6. Partner logos — the scrolling strip on the home page

The **Partners** tab at the top of the editor (`/admin/?view=partners`)
manages the logo strip on `index.html` (the band that scrolls sideways under
"MyCampusKorner helps you…"). Partners are the companies themselves, kept
separate from their products: they live in `js/partners.js`, not
`js/products.js`. Nothing extra to set up — it uses the same password, token
and D1 binding (its own `partner_*` tables, created on first use).

Each row is one logo: **name** (alt text / hover title), **link url** (opens
in a new tab), **logo url** (a full `https://` image address, or a path under
`images/`), and an optional **note** (internal — it is stored in the public `js/partners.js`, so nothing secret). Table order is strip order —
use **↑ ↓** to reorder. The preview above the table draws the strip from the
draft exactly as the site will, so you can check sizes and click the links
before saving.

What the strip shows:

| Partners | Strip |
|---|---|
| 0 | The MyCampusKorner wordmark strip, exactly as before |
| 1 | That logo in every box |
| 2 or more | All of them in order, then the list starts again — repeated until the strip spans the screen, so the loop is seamless |
| More than fill the screen | Listed once and simply looped |

Logos of any shape are sized to the same visual area, the scroll keeps its
original speed per box, and it pauses on hover (desktop) so a logo is easy to
click.

**Save** commits `js/partners.js` only. There is no rebuild: the home page
reads that file in the browser (`js/partner-marquee.js`), so the change is live
once Cloudflare Pages redeploys, about a minute. Undo, History ▾ and Reset draft
work as for products, on the partner list only.

## 7. Blog posts — the Blog tab

`/admin/?view=blog` edits `js/blogs.js`, with the same shared draft, Undo,
History ▾ and Reset draft as the other tabs (its own `blog_*` tables). Nothing
to set up.

- **+ Add post** opens the post in a side panel (**Edit** on any row reopens
  it; Esc or **Done** closes it — edits are already in the shared draft).
- **Status.** New posts start as **Draft (hidden)**. Drafts are saved with
  every Save — so they are kept in History — but never shown, listed, linked or
  put in the sitemap. Set Status to **Published** when a post is ready. This is
  what stops a colleague's Save from publishing your half-written post.
  Drafts sit in the public `js/blogs.js` file, so treat them as unlisted, not
  secret.
- **Publish date & time** is pre-set to *now* in **Michigan time**, whatever
  the editor's own computer is set to; change it to anything (back-dating is
  fine) or press **Now**. It sorts the posts; the page shows the date.
- **Article.** Paste straight from Google Docs, Word or a web page, or type.
  The paste is cleaned to plain structure — paragraphs, headings, lists, quotes,
  bold/italic, links, images — and fonts, colours and junk markup are dropped
  (and cleaned again on Save). Toolbar: paragraph/headings, bold, italic,
  lists, quote, link, image, clear, and **HTML** to see or edit the source.
  Ctrl+Z inside the article undoes typing.
  - Images must already be online: use **Image** with its `https://` address,
    or add the file to the site's `images/` folder in git and write
    `/images/<file>` (as the existing covers in `images/blog/` do). Pasted or
    dragged image files are not uploaded.
  - Links to other sites open in a new tab and are marked
    `rel="sponsored"` automatically — the right label for affiliate links.
- **Excerpt** (the card text) is optional: leave it blank and the first
  sentences of the article are used.
- **Category**: pick one, or **+ New category…** to create it (it appears on
  the blog's filter once a published post uses it). Choosing a category fills
  in its usual cover image if the post has none.
- **Author** comes from the Team tab (section 8). The byline then reads
  "By *Name*, *Role*" and links to that person on the About page. With no
  author the post shows no byline at all (as every post does for now).
- **Continue reading**: pick up to three posts, or leave "Automatic" (newest
  in the same category).
- **Permalink** is filled in from the title. Don't change it after a post is
  live — old links would break.
- **Raw block** (switch at the top of the panel) shows the whole post as one
  block of text: its settings between two `---` lines, then the article HTML.
  Use it to copy a post out, edit the HTML directly, or paste a whole post in.
  To have an AI write a new post: open any good post → Raw block → **Copy with
  AI instructions** → paste into ChatGPT/Claude and replace the Topic line →
  copy its reply → **+ Add post** → Raw block → paste over the box →
  **Apply to this post**.
  - Nothing changes until **Apply**, and Apply checks the block first.
    **Errors block it**: unknown settings, bad dates, a category or author that
    doesn't exist, a missing title, a published post without an article, and
    any code that doesn't belong in a post (`<script>`, `<iframe>`, `onclick=`,
    `javascript:` links… — **Remove unsafe parts** strips them). **Warnings**
    need a confirm: links to products/posts that don't exist, placeholder text
    like `[INSERT LINK]`, a permalink that belongs to another post (the post
    gets a new one instead), a changed permalink on a live post, very short
    articles.
  - Tidied automatically (and listed): code fences and chatty text around an
    AI reply, inline styles/classes/fonts, `<h1>` → `<h2>`, a first heading that
    just repeats the title, Markdown → HTML.
  - Empty settings keep what the post already has (an empty excerpt means
    "from the article"). One **Undo** reverts a whole Apply.

**Save** commits `js/blogs.js`. The article page and category pages update when
Pages redeploys (~1 min); the GitHub Action then runs `build_content.py`, which
re-bakes the cards on `blog.html` and the three newest posts on the home page
(~1 min more). Save refuses a *published* post with no category, cover image or
article text, and says which row.

## 8. Team — the About page

`/admin/?view=team` edits `js/team.js`: one row per person — name, role
(e.g. "Founder"), photo URL, bio (blank line = new paragraph), optional
profile link (LinkedIn, website or `mailto:`). Table order is page order
(**↑ ↓**). **Edit** opens the same side panel.

**Save** commits `js/team.js`; `build_content.py` bakes the "Meet the team"
cards into `about.html` (plain HTML, so reviewers and search engines see real
people), and lists the people in the page's structured data — anyone whose
role contains "Founder" as a founder. With nobody on the list the section is
hidden. People with no photo get their initials.

## 9. Newsletter sign-ups and contact messages

The email boxes on Home and the blog post to `/forms/newsletter`; the Contact
page posts to `/forms/contact`. Both store into the same D1 database as step 5
(tables `newsletter_subscribers` and `contact_messages`, created on the first
submission). Nothing extra to set up — no DB binding means the form shows an
error asking people to email support instead.

Read them in the editor's **Signups** tab (`/admin/signups`): switch between
**Newsletter** and **Contact messages**. Totals and last 7 / 30 days at the
top; every entry newest first, 200 at a time (**Show more** loads the rest);
a search box; **Reply** opens your email app addressed to the sender; **Remove**
for unsubscribe or "delete my data" requests; **Download CSV** has every row
(import it into Mailchimp, Kit, Beehiiv… to actually send a newsletter). Also
visible in Cloudflare: D1 → `campus-draft` → Console, e.g.
`SELECT * FROM contact_messages ORDER BY created_at DESC`.

Nobody is emailed when a contact message arrives — check the tab regularly.

Spam protection: a hidden honeypot field, and each form accepts at most 30
submissions per 10 minutes from one connection — generous because a whole
campus can share one public IP address. (IP addresses are stored only as a
one-way hash, and those counters are deleted after a day.)

## 10. SEO pieces that run by themselves

- **`/sitemap.xml`** is generated on request (`functions/sitemap.xml.js`) from
  `js/products.js` and `js/blogs.js`, so every product and published post is in
  it the moment a Save redeploys. Add a new static page to `STATIC_PAGES` there.
- **Blog posts** also get BlogPosting structured data (headline, date, image,
  and the author from the Team tab).
- **Product / category / store / blog pages** get their title, description,
  image and canonical tag filled in server-side (`functions/product.js` etc.),
  and an unknown `?id=` returns a real **404** (plus noindex) instead of a
  "not found" page with a 200.
- **Any other missing URL** serves `404.html` with a 404 status.
- **`robots.txt`** points at the sitemap and keeps `/admin/`, `/api/` out.
- These run as Pages Functions: page views of those templates count toward
  the Functions free tier (100,000 requests/day). If any of them fails, the
  plain page is served as before.
- Canonical URLs use `https://mycampuskorner.com` (no `www` — see section 12).
  If the site ever moves, set a `SITE_URL` variable in Pages settings (and
  update robots.txt and the `rel="canonical"` tags in the static pages).

## 11. Site-wide settings (no rebuild needed)

- **Social icons:** `js/site-config.js` → `SOCIAL_LINKS`. Paste full
  `https://` profile URLs; blank ones are hidden, all blank hides "Follow us".
- **Google Analytics:** every public `.html` page has the gtag snippet at the
  top of `<head>`. To change the Measurement ID, replace it in all of them:
  `sed -i 's/G-OLDID/G-NEWID/g' *.html` (the admin pages are deliberately not
  tracked).

---

## Security, in short

- `/admin/` and `/api/*` need the password. A **blank or spaces-only**
  `EDITOR_PASSWORD` counts as not set: the editor is then disabled (never open).
- The editor's API only accepts changes sent from the editor's own pages, so
  another website cannot use a signed-in editor's browser to save, reset or
  delete anything (cross-site request forgery). The editor cannot be embedded
  in another site (clickjacking).
- Blog articles are cleaned three times — when pasted, when saved (the save is
  refused if anything unsafe would survive), and again in the reader's browser
  — so article HTML can never run script on the site.
- Product links must be real `https://` addresses before they can be saved.
- Two Saves in the same moment: one publishes, the other is refused with
  "Another editor saved a moment ago — press Save again"; nothing is lost.
  A Save that finishes while someone presses Reset draft is kept (the next
  Save asks for a reset instead of silently undoing it).
- If the shared draft cannot be reached, the editor says so and retries; it
  never quietly switches to a private copy, and Save never publishes without
  your latest edits.

## How to think about it

- **`/admin/` and `/api/*` are the only protected paths.** Everything else is
  the public site and is untouched. The draft API lives at `/api/draft`, so it
  sits behind the same password automatically.
- **With the D1 binding, two open editors share one draft** — no conflicts,
  no refused saves. Without it (or on the local python editor), saving is
  atomic per file: the second save is refused with "somebody else saved"
  rather than overwriting; press Reload and redo the change.
- **One file per tab:** Products → `js/products.js`, Partners →
  `js/partners.js`, Blog → `js/blogs.js`, Team → `js/team.js`. The GitHub
  Action rebuilds the pages that bake them in (`build_listings.py` for
  products, `build_content.py` for blog + team); partners need no build.
- **Every save is a git commit,** so the full history is in GitHub and the
  editor's **History ▾** button lists every one of them (`/api/history`).
  Restore loads a version back into the shared draft; Save is still the only
  thing that commits, rebuilds or deploys anything. The local editor's
  `js/backups/` folder is a separate, local-only safety net.
- **The catalog is read from GitHub, not the live site,** so the editor is never
  looking at a stale copy while a deploy is in flight.

## 12. The site's address and its own files

**Address.** The site is `https://mycampuskorner.com` — without `www`. Every
canonical tag, the sitemap, share images and structured data use it. The
`www.` address still works; to make it send visitors (and search engines) to
the plain one with a permanent redirect, add one rule in Cloudflare — this
cannot live in the code, because Pages cannot redirect by hostname without
running a Function on every image and stylesheet request:

1. Cloudflare dashboard → the `mycampuskorner.com` domain → **Rules** →
   **Overview** → template **Redirect from WWW to root** (or **Redirect
   Rules → Create rule**).
2. If building it by hand: *Hostname equals* `www.mycampuskorner.com` →
   **Dynamic** redirect to `concat("https://mycampuskorner.com", http.request.uri.path)`,
   status **301**, **Preserve query string** on. Save and deploy the rule.
3. Check: `https://www.mycampuskorner.com/blog?x=1` lands on
   `https://mycampuskorner.com/blog?x=1`.

Leave the `www` DNS record in place (proxied): the redirect needs it.

**Files.** Everything the pages load is served with the site itself —
nothing from Webflow, Google Fonts or other CDNs:

| Folder | What |
| --- | --- |
| `images/`, `images/blog/` | site images, logos, share image, blog covers |
| `fonts/` + `css/fonts.css` | Rubik and Instrument Serif |
| `js/vendor/`, `css/vendor/` | jQuery 3.5.1, GSAP 3.15.0, Swiper 14.0.1 |
| `documents/` | the menu-button animation |

The exceptions are deliberate: **product images and partner logos** are the
addresses you enter in the editor, so they load from wherever those point;
and **Google Analytics** (`googletagmanager.com`) has to load from Google to
report anything.

## If something goes wrong

| What you see | Cause |
|---|---|
| Browser never asks for a password | `functions/` did not deploy — the page is then unprotected. Check the deployment includes Functions, and fix before sharing the URL. |
| Password box keeps reappearing | The password does not match `EDITOR_PASSWORD`. Cancel the prompt to see the error page. Re-enter the variable (watch for a pasted newline) and redeploy. |
| "EDITOR_PASSWORD is not set… editor is disabled" | Variable missing on the environment you are hitting. This is fail-closed and safe. |
| "GITHUB_REPO and GITHUB_TOKEN must be set" | Same, for the two GitHub variables. |
| "Check GITHUB_TOKEN has Contents: read and write" | Token lacks permission, expired, or is not scoped to this repo. |
| Save succeeds but the site does not change | The Action has not finished, or it lacks write permission (step 3). Check the Actions tab. Also hard-refresh: Ctrl+F5. |
| Product pages update but Shop/Home do not | The rebuild commit reached GitHub but Cloudflare skipped deploying it. Never put `[skip ci]`, `[CI Skip]` or `[CF Pages Skip]` in a commit message — Cloudflare Pages treats those as "do not build". |
| "Somebody else saved the catalog…" | Two editors open **without** the D1 binding (step 5). Reload and reapply your change. Nothing was lost. |
| Edits do not appear on a colleague's screen | The D1 binding is missing or was added without a redeploy (step 5). The footer says "shared draft · source: …" when live sync is on. |
| "js/products.js changed on GitHub outside this editor" | Someone committed the file directly in git while a draft was live. Press **Reset draft** to start from that newer version. |
| Editor shows stale rows after a Reset | It catches up on its next poll (a few seconds). Every editor reloads its table automatically when the draft is reset. |
| "The shared draft was just reset or restored by another editor, so this Save was not sent" | Someone pressed **Reset draft** or restored a version while your Save was on its way. Your table has reloaded to their version: check it, redo anything missing, then press Save again. Edits typed during a Reset are dropped the same way (never half-applied). |
| "Your unapplied Raw block … was closed" (with a **Copy the block** button) | The post you were pasting into was deleted, or is not in a draft someone just reset / restored. Press **Copy the block**, open (or add) the post, and paste it into its Raw block. |
| History ▾ says "GitHub would not list the saved versions" | The token lost Contents: read (expired, or re-scoped). Same fix as other token errors: re-issue per step 1. |
| Restored a version but the live site still shows the new products | By design. Restore only fills the shared draft; press **Save** to publish the restored table to the site. |
| Blog / Home cards or the About page did not update after a Save | The rebuild runs after the commit (~1–2 min). Check the Actions tab: if `build_content.py` refused the data, its log says which post or person and why; nothing half-built is published. |
| A post saved but is not on the site | Its Status is Draft. Set it to Published and Save. |
| Pasted article lost its images | Image files can't be pasted or dropped — put the image online and insert it with **Image** and its address. |
| A partner row says "can't load" | The logo url is not an image the browser can fetch (typo, a page rather than an image, or the partner's site blocks hotlinking). Right-click the logo on their site → Copy image address, or put the file in `images/` and use that path. |
| Saved partners but the home page strip has not changed | Wait for the Pages redeploy (~1 min), then hard-refresh (Ctrl+F5). With 0 partners the MyCampusKorner strip is expected. |

## Changing the password

Edit `EDITOR_PASSWORD` in Pages settings and redeploy. Everyone uses the new
one immediately. Because it is shared it cannot be revoked per person — if
someone leaves the team, change it.

If you later want per-person access with no shared secret, Cloudflare Access
(Zero Trust) can protect `/admin/*` with emailed one-time codes, free for up to
50 users, and you would then delete `functions/admin/_middleware.js`.
