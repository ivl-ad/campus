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
  trail reaches back to the very first save and only ever grows. **Restore**
  writes an old version as a *new* commit (nothing is ever deleted), the site
  rebuilds, and every open editor reloads to the restored table with a note
  saying who restored what.
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

---

## How to think about it

- **`/admin/` and `/api/*` are the only protected paths.** Everything else is
  the public site and is untouched. The draft API lives at `/api/draft`, so it
  sits behind the same password automatically.
- **With the D1 binding, two open editors share one draft** — no conflicts,
  no refused saves. Without it (or on the local python editor), saving is
  atomic per file: the second save is refused with "somebody else saved"
  rather than overwriting; press Reload and redo the change.
- **Every save is a git commit,** so the full history is in GitHub and the
  editor's **History ▾** button lists every one of them with one-click
  restore (`/api/history`). The local editor's `js/backups/` folder is a
  separate, local-only safety net.
- **The catalog is read from GitHub, not the live site,** so the editor is never
  looking at a stale copy while a deploy is in flight.

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
| History ▾ says "GitHub would not list the saved versions" | The token lost Contents: read (expired, or re-scoped). Same fix as other token errors: re-issue per step 1. |

## Changing the password

Edit `EDITOR_PASSWORD` in Pages settings and redeploy. Everyone uses the new
one immediately. Because it is shared it cannot be revoked per person — if
someone leaves the team, change it.

If you later want per-person access with no shared secret, Cloudflare Access
(Zero Trust) can protect `/admin/*` with emailed one-time codes, free for up to
50 users, and you would then delete `functions/admin/_middleware.js`.
