# Hosted catalog editor — setup

The editor at `/admin/` lets the management team edit the shop from a browser.
It saves by committing `js/products.js` to GitHub; a GitHub Action then rebuilds
`store.html` and `index.html`, and Cloudflare Pages redeploys. About a minute
end to end.

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
password — **the username is ignored**, type anything; only the password is
checked. Then edit and press Save.

After a save: GitHub shows a new commit, the Action runs, and the site updates.
Watch progress in the repo's **Actions** tab.

---

## How to think about it

- **`/admin/` and `/api/*` are the only protected paths.** Everything else is
  the public site and is untouched.
- **Saving is atomic per file.** If two people have the editor open, the second
  save is refused with "somebody else saved" rather than overwriting. Press
  Reload and redo the change.
- **Every save is a git commit,** so the full history is in GitHub and any
  change can be reverted there. The local editor's `js/backups/` folder is a
  separate, local-only safety net.
- **The catalog is read from GitHub, not the live site,** so the editor is never
  looking at a stale copy while a deploy is in flight.

## If something goes wrong

| What you see | Cause |
|---|---|
| Browser never asks for a password | `functions/` did not deploy — the page is then unprotected. Check the deployment includes Functions, and fix before sharing the URL. |
| "EDITOR_PASSWORD is not set… editor is disabled" | Variable missing on the environment you are hitting. This is fail-closed and safe. |
| "GITHUB_REPO and GITHUB_TOKEN must be set" | Same, for the two GitHub variables. |
| "Check GITHUB_TOKEN has Contents: read and write" | Token lacks permission, expired, or is not scoped to this repo. |
| Save succeeds but the site does not change | The Action has not finished, or it lacks write permission (step 3). Check the Actions tab. Also hard-refresh: Ctrl+F5. |
| "Somebody else saved the catalog…" | Two editors open. Reload and reapply your change. Nothing was lost. |

## Changing the password

Edit `EDITOR_PASSWORD` in Pages settings and redeploy. Everyone uses the new
one immediately. Because it is shared it cannot be revoked per person — if
someone leaves the team, change it.

If you later want per-person access with no shared secret, Cloudflare Access
(Zero Trust) can protect `/admin/*` with emailed one-time codes, free for up to
50 users, and you would then delete `functions/admin/_middleware.js`.
