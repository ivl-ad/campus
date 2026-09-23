/*
 * /api/blog -- the hosted half of the blog editor (/admin/?view=blog).
 *
 *   GET   read js/blogs.js straight from GitHub
 *   POST  commit an edited post list back to GitHub
 *
 * The twin of /api/catalog and /api/partners. js/blogs.js holds two lists:
 * BLOG_CATEGORIES and BLOG_POSTS. The editor edits the posts; categories are
 * kept as they are, and a post filed under a brand-new category adds it.
 *
 * A Save commits js/blogs.js only. blog-post.html and blog-category.html read
 * it in the browser, so articles are live as soon as Pages redeploys; the
 * GitHub Action (.github/workflows/rebuild-listings.yml) then runs
 * build_content.py to re-bake the cards on blog.html and the three newest
 * posts on the home page.
 *
 * On the way out every post is normalised: dateLabel is written from dateMs in
 * the site's time zone (Michigan), a missing excerpt is taken from the body,
 * and the body HTML is cleaned to a safe list of tags -- the post page puts
 * it into the page as HTML, so nothing executable may reach it, whatever was
 * pasted into the editor.
 *
 * Posts with "hidden": true are drafts. They are saved (so History keeps
 * them) but every page, the sitemap and the builders skip them. The file is
 * public, so a hidden post's text is readable by anyone who opens
 * js/blogs.js -- it is unlisted, not secret.
 *
 * Same environment as /api/catalog. The shared draft behind it is
 * /api/draft?doc=blog, in the blog_* tables of the same DB binding.
 */

import { config, github, encodeBase64 } from './catalog.js';
import { readRemote, NO_FILE } from './partners.js';
import { extractArray, headerBefore, renderArray } from '../_shared/js-data.js';
import { draftMarks, baseMismatch, recordSave, epochMoved, RACE_MESSAGE, RESET_MESSAGE } from '../_shared/draft-save.js';

export const FILE = 'js/blogs.js';
export const TABLES = { rows: 'blog_rows', meta: 'blog_meta', presence: 'blog_presence' };
export const SITE_TZ = 'America/Detroit';

const FIELD_ORDER = ['id', 'name', 'cat', 'catLabel', 'dateMs', 'dateLabel', 'img', 'excerpt',
                     'author', 'authors', 'related', 'hidden', 'contentHTML'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const IMG_RE = /^(https?:\/\/[^\s<>"']+|\/?images\/[^\s<>"']+)$/i;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

// ----------------------------------------------------------------- blogs.js
export function parseBlog(source) {
  return {
    categories: extractArray(source, 'BLOG_CATEGORIES'),
    posts: extractArray(source, 'BLOG_POSTS')
  };
}
export const parsePosts = (source) => parseBlog(source).posts;

export function render(header, categories, posts) {
  const parts = [];
  if (header && header.trim()) parts.push(header);
  parts.push(renderArray('BLOG_CATEGORIES', categories, ['id', 'label']));
  parts.push(renderArray('BLOG_POSTS', posts, FIELD_ORDER));
  return parts.join('\n') + '\n';
}

// ------------------------------------------------------------- normalising
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: SITE_TZ, month: 'long', day: 'numeric', year: 'numeric'
});
export const dateLabel = (ms) => LABEL_FMT.format(new Date(ms));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function plainText(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
      if (e[0] === '#') {
        // As browsers read it: no character, half an emoji (a surrogate) or
        // past U+10FFFF all mean U+FFFD -- String.fromCodePoint would throw on
        // the last, or produce text no UTF-8 page can hold on the others.
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10FFFF && (n < 0xD800 || n > 0xDFFF) ? String.fromCodePoint(n) : '\uFFFD';
      }
      return m;
    })
    .replace(/\s+/g, ' ').trim();
}

// The first ~40 words of the body's paragraphs (headings skipped), cut at a word.
export function autoExcerpt(html) {
  const paras = String(html || '').match(/<p[\s>][\s\S]*?<\/p>/gi) || [];
  const text = plainText(paras.join(' ')) || plainText(html);
  if (text.length <= 280) return text;
  let cut = text.slice(0, 280);
  const space = cut.lastIndexOf(' ');
  // At a word; failing that (one very long word), never between the two
  // halves of an emoji.
  cut = space > 0 ? cut.slice(0, space) : cut.replace(/[\uD800-\uDBFF]$/, '');
  return cut.replace(/[\s,.;:–—-]+$/, '') + '…';
}

function tidy(post) {
  const out = {};
  const put = (k) => {
    let v = post[k];
    if (typeof v === 'string') v = v.trim();
    if (k === 'dateMs') v = Math.round(Number(v));
    if (k === 'hidden') v = v ? true : undefined;
    if (k === 'related') {
      v = Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
      v = v.filter((x, i) => v.indexOf(x) === i).slice(0, 3);
      if (!v.length) v = undefined;
    }
    if (k === 'authors' && (!Array.isArray(v) || !v.length)) v = undefined;
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && !isFinite(v))) return;
    out[k] = v;
  };
  FIELD_ORDER.forEach(put);
  Object.keys(post).forEach((k) => { if (!(k in out) && !FIELD_ORDER.includes(k)) put(k); });
  return out;
}

/*
 * The body, cleaned. The editor already cleans what is pasted into it; this is
 * the server-side guarantee. Allowed: text structure (p, h2–h4, lists, quotes,
 * tables), inline emphasis, links and images. Everything else is unwrapped
 * (its text kept) or, for executable/embedded things, removed with its content.
 */
const KEEP = new Set(['p', 'br', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 's', 'sup', 'sub', 'a',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'img', 'figure', 'figcaption', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'code', 'pre']);
const RENAME = { b: 'strong', i: 'em', h1: 'h2', h5: 'h4', h6: 'h4', strike: 's', del: 's' };
// Removed WITH their content. xmp / noembed / noframes / plaintext matter
// most: the parser treats what is inside them as plain text, so unwrapping
// them would turn that text back into live markup in the reader's browser.
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea', 'option', 'noscript', 'template', 'svg',
  'math', 'link', 'meta', 'base', 'title', 'head', 'video', 'audio', 'source', 'track',
  'canvas', 'map', 'area', 'dialog', 'portal', 'xmp', 'noembed', 'noframes', 'plaintext']);
const ATTRS = {
  a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start']
};
// "/\\host" is protocol-relative in browsers, so it is not a site-relative link.
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|#|\/(?![\/\\])|[a-z0-9-]+\.html(?:[?#]|$))/i;

// What must never survive cleaning, checked on the output as a last line of
// defence. Tags are read with their attributes; quoted values are skipped
// over, so text such as alt="one = two" is not mistaken for an attribute.
const FORBIDDEN_TAG = /^(script|style|iframe|frame|frameset|object|embed|applet|svg|math|xmp|noembed|noframes|plaintext|template|noscript|form|input|button|textarea|select|option|link|meta|base)$/i;

export function unsafeOutput(html) {
  const tagRe = /<\s*\/?\s*([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  // A tag opened but never closed before the end is refused outright.
  if (/<\s*\/?\s*[a-z][^>]*$/i.test(html)) return true;
  let m;
  while ((m = tagRe.exec(html))) {
    if (FORBIDDEN_TAG.test(m[1])) return true;
    const attrRe = /([^\s=\/"'>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let a;
    while ((a = attrRe.exec(m[2]))) {
      const name = a[1].toLowerCase();
      if (name.startsWith('on')) return true;
      if (name === 'href' || name === 'src') {
        const v = (a[2] || '').replace(/^["']|["']$/g, '').replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/.test(v)) return true;
      }
    }
  }
  return false;
}

async function sanitizePass(html, self) {
  const rewritten = new HTMLRewriter()
    .onDocument({
      comments(c) { c.remove(); },
      doctype() {},
      // A bare "<" in the text stays as source text through the rewriter;
      // escape it so nothing afterwards can join it into a tag.
      text(t) { if (t.text.indexOf('<') > -1) t.replace(t.text.replace(/</g, '&lt;'), { html: true }); }
    })
    .on('*', {
      element(el) {
        let tag = el.tagName.toLowerCase();
        if (DROP.has(tag)) { el.remove(); return; }
        const style = el.getAttribute('style') || '';
        // Google Docs wraps a whole paste in <b style="font-weight:normal">: not bold.
        if (tag === 'b' && /font-weight\s*:\s*(normal|[1-5]00)\b/i.test(style)) {
          el.removeAndKeepContent(); return;
        }
        // Docs marks bold / italic with styled spans rather than tags.
        if ((tag === 'span' || tag === 'font') && /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i.test(style)) tag = 'b';
        else if ((tag === 'span' || tag === 'font') && /font-style\s*:\s*italic/i.test(style)) tag = 'i';
        if (RENAME[tag]) { tag = RENAME[tag]; el.tagName = tag; }
        if (!KEEP.has(tag)) { el.removeAndKeepContent(); return; }

        const allowed = ATTRS[tag] || [];
        const attrs = [];
        for (const pair of el.attributes) attrs.push(pair);
        attrs.forEach(([name, value]) => {
          const n = name.toLowerCase();
          if (!allowed.includes(n)) { el.removeAttribute(name); return; }
          const v = String(value || '').trim();
          if (n === 'href' && !SAFE_HREF.test(v)) el.removeAttribute(name);
          if (n === 'src' && !IMG_RE.test(v)) el.removeAttribute(name);
          if ((n === 'width' || n === 'height' || n === 'colspan' || n === 'rowspan' || n === 'start') &&
              !/^\d{1,4}$/.test(v)) el.removeAttribute(name);
        });

        if (tag === 'a') {
          const href = el.getAttribute('href');
          if (!href) { el.removeAndKeepContent(); return; }
          // Outbound links on an affiliate site: new tab, and flagged as
          // sponsored so search engines treat them the way Google asks.
          if (/^https?:\/\//i.test(href) && href.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]
                .replace(/^www\./, '') !== self.replace(/^www\./, '')) {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'sponsored noopener');
          }
        }
        if (tag === 'img' && !el.getAttribute('src')) { el.remove(); return; }
        if (tag === 'img') el.setAttribute('loading', 'lazy');
      }
    })
    .transform(new Response(String(html), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  return (await rewritten.text()).trim();
}

export async function sanitizeHtml(html, site) {
  if (!html) return '';
  const self = String(site || 'https://mycampuskorner.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // Empty paragraphs from pasted documents go BEFORE cleaning, so the cleaner
  // sees whatever their removal leaves. Then any "<" with no ">" after it:
  // a tag left open at the very end is never handed to the rewriter's element
  // handler, so its attributes would pass unchecked. Browsers drop such a
  // fragment; here it becomes plain text.
  const input = String(html).replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/<(?=[^>]*$)/g, '&lt;');
  const once = await sanitizePass(input, self);
  // Clean output must be a fixed point: cleaning it again changes nothing,
  // and none of the forbidden patterns appear. Otherwise refuse the save
  // rather than publish something the cleaner did not fully understand.
  const twice = await sanitizePass(once, self);
  if (once !== twice || unsafeOutput(once)) {
    const err = new Error('An article contains markup that could not be cleaned safely. ' +
                          'Open it in the Blog tab, check the HTML (Raw block), and remove unusual code.');
    err.unsafe = true;
    throw err;
  }
  return once;
}

// Posts arrive tidied (trimmed), so " tips" and a blank label cannot slip a
// category through without a name -- build_content.py would refuse the file.
export function mergeCategories(fileCategories, posts) {
  const out = (fileCategories || []).map((c) => ({ id: c.id, label: c.label }));
  const known = new Map(out.map((c) => [c.id, c.label]));
  posts.forEach((p) => {
    if (typeof p.cat === 'string' && !known.has(p.cat) && SLUG_RE.test(p.cat)) {
      const label = (typeof p.catLabel === 'string' && p.catLabel.trim()) || p.cat;
      out.push({ id: p.cat, label });
      known.set(p.cat, label);
    }
  });
  return { categories: out, labelOf: known };
}

const isPost = (p) => typeof p === 'object' && p !== null && !Array.isArray(p);

export async function normalise(posts, fileCategories, site) {
  const tidied = posts.map((p) => (isPost(p) ? tidy(p) : p));
  const { categories, labelOf } = mergeCategories(fileCategories, tidied.filter(isPost));
  const out = [];
  for (const p of tidied) {
    if (!isPost(p)) { out.push(p); continue; }        // validate() names it
    if (!p.dateMs) p.dateMs = Date.now();
    // An impossible date gets no label; validate() then refuses it by name
    // (formatting it would throw instead).
    if (Math.abs(p.dateMs) < 8.64e15) p.dateLabel = dateLabel(p.dateMs);
    if (typeof p.cat === 'string' && labelOf.has(p.cat)) p.catLabel = labelOf.get(p.cat) || p.catLabel || p.cat;
    p.contentHTML = await sanitizeHtml(p.contentHTML || '', site);
    if (!p.contentHTML) delete p.contentHTML;
    if (!p.excerpt && p.contentHTML) p.excerpt = autoExcerpt(p.contentHTML);
    if (p.related && p.id) p.related = p.related.filter((r) => r !== p.id);
    if (p.related && !p.related.length) delete p.related;
    out.push(tidy(p));
  }
  // Related entries must name a post that exists.
  const ids = new Set(out.filter(isPost).map((p) => p.id));
  out.forEach((p) => {
    if (isPost(p) && p.related) {
      p.related = p.related.filter((r) => ids.has(r));
      if (!p.related.length) delete p.related;
    }
  });
  return { posts: out, categories };
}

// ------------------------------------------------------------- validation
// The editor page runs the same rules before it lets Save through. Drafts
// (hidden) only need a unique permalink and a title, so a half-written post
// never blocks a colleague's Save.
export function validate(posts) {
  const errors = [];
  const seen = new Map();
  posts.forEach((p, i) => {
    let where = 'post #' + (i + 1);
    if (typeof p !== 'object' || p === null || Array.isArray(p)) { errors.push(where + ': not an object'); return; }
    if (p.name) where += ' (' + p.name + ')';
    ['id', 'name', 'cat', 'catLabel', 'img', 'excerpt', 'author', 'contentHTML'].forEach((f) => {
      if (p[f] !== undefined && typeof p[f] !== 'string') errors.push(where + ': ' + f + ' must be text');
    });
    if (p.dateMs !== undefined && !(typeof p.dateMs === 'number' && isFinite(p.dateMs) &&
        Math.abs(p.dateMs) < 8.64e15)) errors.push(where + ': the date is not valid');
    if (!p.id) errors.push(where + ': missing permalink (id)');
    else {
      if (!SLUG_RE.test(p.id)) errors.push(where + ': id must be lowercase letters, numbers and dashes');
      if (seen.has(p.id)) errors.push(where + ': duplicate id -- also used by post #' + seen.get(p.id));
      seen.set(p.id, i + 1);
    }
    if (!p.name) errors.push(where + ': missing title');
    if (p.cat && !SLUG_RE.test(p.cat)) errors.push(where + ': category id must be lowercase letters, numbers and dashes');
    if (p.img && !IMG_RE.test(p.img)) errors.push(where + ': image must be a full https:// address (or a path under images/)');
    if (p.hidden) return;
    if (!p.cat) errors.push(where + ': missing category');
    else if (!p.catLabel) errors.push(where + ': the category has no name');
    if (!p.img) errors.push(where + ': missing cover image');
    if (!p.contentHTML || !plainText(p.contentHTML)) errors.push(where + ': the body is empty');
  });
  return errors;
}

// -------------------------------------------------------------- handlers
export async function onRequestGet({ env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let cur, parsed;
  try { cur = await readRemote(cfg, FILE); } catch (e) { return json(e.status || 502, { error: e.message }); }
  try {
    parsed = cur.exists ? parseBlog(cur.source) : { posts: [], categories: [] };
  } catch (e) {
    return json(500, { error: 'could not read ' + FILE + ': ' + e.message });
  }
  return json(200, {
    posts: parsed.posts,
    blogCategories: parsed.categories,
    sha: cur.sha,
    source: 'github:' + cfg.repo + '@' + cfg.branch
  });
}

export async function onRequestPost({ request, env }) {
  let cfg;
  try { cfg = config(env); } catch (e) { return json(500, { error: e.message }); }

  let body;
  try { body = await request.json(); } catch (e) {
    return json(400, { error: 'expected a JSON body' });
  }
  let posts = body && body.posts;
  let draftSeq = 0, draftEpoch = null;
  if (body && body.fromDraft) {
    // Publish the shared draft exactly as it stands (see functions/api/draft.js).
    // Counter first, then rows, for the same reason as /api/catalog.
    if (!env.DB) return json(400, { error: 'The shared draft has no DB binding on this Pages project.' });
    ({ seq: draftSeq, epoch: draftEpoch } = await draftMarks(env.DB, TABLES.meta));
    if (epochMoved(body, draftEpoch)) return json(409, { error: RESET_MESSAGE });
    const got = await env.DB.prepare(
      'SELECT data FROM ' + TABLES.rows + ' WHERE deleted=0 ORDER BY pos, rid').all();
    posts = got.results.map((r) => JSON.parse(r.data));
  }
  if (!Array.isArray(posts)) return json(400, { error: 'posts must be a list' });

  let current;
  try { current = await readRemote(cfg, FILE); } catch (e) {
    return json(502, { error: 'could not read the current ' + FILE + ' from GitHub. ' + e.message });
  }
  let fileCategories = [];
  try { if (current.exists) fileCategories = parseBlog(current.source).categories; } catch (e) {
    return json(500, { error: 'could not read the categories in ' + FILE + ': ' + e.message });
  }

  const site = env.SITE_URL || 'https://mycampuskorner.com';
  let clean, categories;
  try {
    ({ posts: clean, categories } = await normalise(posts, fileCategories, site));
  } catch (e) {
    if (e.unsafe) return json(400, { error: 'validation failed', errors: [e.message] });
    throw e;
  }
  const errors = validate(clean);
  if (errors.length) return json(400, { error: 'validation failed', errors });
  if (!clean.length && current.exists && parseBlog(current.source).posts.length) {
    return json(400, { error: 'refusing to save an empty blog (every post was deleted) -- ' +
                              'Reset draft if that was not intended' });
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
      error: 'Somebody else saved the blog while this page was open.\n' +
             'Press Reload to pick up their version, then make your changes again. ' +
             'Nothing has been overwritten.'
    });
  }

  const content = render(current.exists ? headerBefore(current.source, 'BLOG_CATEGORIES') : '',
                         categories, clean);
  const live = clean.filter((p) => !p.hidden).length;
  const who = (body.author || '').toString().slice(0, 40).replace(/[^\p{L}\p{N} .@'_-]/gu, '');
  const message = 'Blog: ' + clean.length + ' post' + (clean.length === 1 ? '' : 's') +
                  (live !== clean.length ? ' (' + live + ' live)' : '') +
                  ', edited in the web editor' + (who ? ' by ' + who : '');

  const put = await github(cfg, 'PUT', {
    message,
    content: encodeBase64(content),
    sha: current.sha || undefined,
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
    const note = JSON.stringify({ who: who, at: Date.now(), count: clean.length,
                                  seq: draftSeq, commit: commit || '' });
    await recordSave(env.DB, TABLES.meta, draftEpoch, [['base_sha', newSha], ['save', note],
      ['extra', JSON.stringify({ blogCategories: categories })]]);
  }

  return json(200, {
    ok: true,
    count: clean.length,
    live,
    sha: newSha,
    commit: commit,
    message: 'Committed to ' + cfg.repo + '@' + cfg.branch + '. ' +
             (live ? 'Articles are live once Cloudflare Pages redeploys (~1 min); the Blog and ' +
                     'Home page cards follow when the rebuild finishes (~2 min).'
                   : 'No post is published (all are drafts), so nothing shows on the site.')
  });
}
