/*
 * The site's own visit counts: shared by functions/hit.js, which counts, and
 * functions/api/analytics.js, which reads them for /admin/analytics.
 *
 * Only daily TOTALS are stored -- "the Store was viewed 40 times on
 * 2026-10-27, 12 of them as the first page of a visit" -- never a row per
 * visitor, an IP address, a cookie or any identifier. Nothing here can be
 * traced back to a person, which is why it needs no consent banner.
 *
 *   stats_pages    day, path     -> views, entries (first page of a visit)
 *   stats_sources  day, source   -> visits   (where a visit came from)
 *   stats_places   day, country  -> visits   (Cloudflare's country code)
 *   stats_devices  day, device   -> visits   (phone / tablet / computer)
 *   stats_clicks   day, kind, target, page -> clicks (links out to retailers)
 *
 * A "visit" is a page view that did not come from another page of this site.
 * Days are Michigan days, like the blog's dates.
 */

const TABLES = [
  'CREATE TABLE IF NOT EXISTS stats_pages (day TEXT NOT NULL, path TEXT NOT NULL, ' +
    'views INTEGER NOT NULL DEFAULT 0, entries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))',
  'CREATE TABLE IF NOT EXISTS stats_sources (day TEXT NOT NULL, source TEXT NOT NULL, ' +
    'visits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, source))',
  'CREATE TABLE IF NOT EXISTS stats_places (day TEXT NOT NULL, country TEXT NOT NULL, ' +
    'visits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, country))',
  'CREATE TABLE IF NOT EXISTS stats_devices (day TEXT NOT NULL, device TEXT NOT NULL, ' +
    'visits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, device))',
  'CREATE TABLE IF NOT EXISTS stats_clicks (day TEXT NOT NULL, kind TEXT NOT NULL, ' +
    'target TEXT NOT NULL, page TEXT NOT NULL, clicks INTEGER NOT NULL DEFAULT 0, ' +
    'PRIMARY KEY (day, kind, target, page))'
];

let ready = false;
export async function ensureStats(db) {
  if (ready) return;
  await db.batch(TABLES.map((sql) => db.prepare(sql)));
  ready = true;
}

const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit'
});
/** "2026-10-27": the Michigan day a moment falls on. */
export const dayOf = (ms) => DAY.format(new Date(ms));

// Crawlers, link previews and test tools. Most never run the page's script
// anyway; these are the ones that do.
export const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|curl|wget|python|httpclient|okhttp|axios|node-fetch|phantom|selenium|playwright|puppeteer/i;

// The pages a visit can be counted against. Anything else (a mistyped
// address, which shows the 404 page) counts as /404, so the table can only
// ever hold these -- whatever a stray request sends.
const PAGES = new Set(['', 'store', 'about', 'blog', 'contact-us', 'privacy-policy', 'terms', '404',
                       'category', 'merchant', 'product', 'blog-post', 'blog-category']);
const WITH_ID = new Set(['category', 'merchant', 'product', 'blog-post', 'blog-category']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** "/product?id=x", "/store", "/" or "/404" -- from a page's path and query. */
export function cleanPath(path, query) {
  let name = String(path || '').replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  if (name === 'index') name = '';
  if (!PAGES.has(name)) return '/404';
  if (!WITH_ID.has(name)) return '/' + name;
  let id = null;
  try { id = new URLSearchParams(String(query || '')).get('id'); } catch (e) { /* none */ }
  return id && SLUG.test(id) ? '/' + name + '?id=' + id : '/' + name;
}

const bare = (host) => String(host || '').toLowerCase().replace(/^www\./, '');

/** True when the page was not reached from another page of this site. */
export function isEntry(referrer, siteHost) {
  try { return !referrer || bare(new URL(referrer).host) !== bare(siteHost); } catch (e) { return true; }
}

const KNOWN = [
  [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\./, 'Yahoo'], [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'], [/^(t\.co|x\.com|twitter\.com)$/, 'X / Twitter'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn'], [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)pinterest\./, 'Pinterest'], [/(^|\.)(chatgpt\.com|openai\.com)$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity']
];

/** Where a visit came from: utm_source when the link was tagged (a
 *  newsletter, a post), else the referring site, else "Direct / app". */
export function sourceOf(referrer, query) {
  let tag = '';
  try { tag = new URLSearchParams(String(query || '')).get('utm_source') || ''; } catch (e) { /* none */ }
  tag = tag.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (tag) return 'tag: ' + tag;
  let host = '';
  try { host = bare(new URL(referrer).host); } catch (e) { return 'Direct / app'; }
  if (!host) return 'Direct / app';
  for (const [re, name] of KNOWN) if (re.test(host)) return name;
  return host.slice(0, 80);
}

export function deviceOf(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'Tablet';
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(ua)) return 'Phone';
  return 'Computer';
}

/** A click out to a retailer, as {kind, target}, or null.
 *  product: the product's id · partner: the logo's name · link: the site's host. */
export function clickOf(b) {
  const kind = String(b && b.k || '');
  let host = '';
  try {
    const u = new URL(String(b.u || ''));
    if (u.protocol === 'https:' || u.protocol === 'http:') host = bare(u.host);
  } catch (e) { /* not a link */ }
  if (!host) return null;
  if (kind === 'product') {
    const id = String(b.id || '');
    return { kind, target: SLUG.test(id) ? id : host };
  }
  if (kind === 'partner') {
    const name = String(b.n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    return { kind, target: name || host };
  }
  return { kind: 'link', target: host.slice(0, 80) };
}
