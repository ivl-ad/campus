/*
 * /api/cf-analytics -- Cloudflare Web Analytics for /admin/analytics?source=cloudflare.
 * Behind the editor password like the rest of /api/* (functions/api/_middleware.js).
 *
 *   GET ?days=7|30|90   the same shape as /api/analytics (days, totals,
 *                       previous, pages, sources, countries, devices) plus
 *                       browsers, and `sampled` when Cloudflare estimated
 *
 * Reads Cloudflare's GraphQL Analytics API (dataset
 * rumPageloadEventsAdaptiveGroups) with a read-only API token. Pages
 * project variables (Settings > Variables and Secrets), see admin/SETUP.md 17:
 *
 *   CF_API_TOKEN          secret. Permissions: Account > Account Analytics >
 *                         Read, and Account > Account Settings > Read (to find
 *                         the site by itself)
 *   CF_ACCOUNT_ID         the account's ID
 *   CF_WEB_ANALYTICS_SITE optional: the Web Analytics site tag, when the site
 *                         cannot be found by its host name
 *
 * Cloudflare documents this dataset's fields only through its own dashboard,
 * so anything it refuses is passed back word for word rather than guessed at.
 * Its numbers are estimates from sampled data on busy days; the page says so.
 */
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
const API = 'https://api.cloudflare.com/client/v4';
const SPANS = new Set([7, 30, 90]);
const DAY_MS = 86400000;
const WINDOW = 30;                       // days per query: the dataset keeps at least 31
const TOPS = { pages: 'requestPath', sources: 'refererHost', countries: 'countryName',
               devices: 'deviceType', browsers: 'userAgentBrowser' };

let noBotFilter = false;                 // set once Cloudflare refuses the `bot` filter
let siteTagCache = null;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

async function cf(env, path, init) {
  const res = await fetch(API + path, Object.assign({}, init, {
    headers: Object.assign({ Authorization: 'Bearer ' + env.CF_API_TOKEN,
                             'Content-Type': 'application/json' }, (init && init.headers) || {})
  }));
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, body };
}

// The Web Analytics site for this host: the variable when set, else the
// site whose host is this one (or the site's own address).
async function siteTag(env, host) {
  if (env.CF_WEB_ANALYTICS_SITE) return String(env.CF_WEB_ANALYTICS_SITE).trim();
  if (siteTagCache) return siteTagCache;
  const r = await cf(env, '/accounts/' + encodeURIComponent(env.CF_ACCOUNT_ID) +
                          '/rum/site_info/list?per_page=100');
  if (!r.ok || !r.body || !Array.isArray(r.body.result)) {
    const why = r.body && r.body.errors && r.body.errors.length
      ? r.body.errors.map((e) => e.message).join('; ') : 'HTTP ' + r.status;
    throw new Error('could not list the Web Analytics sites (' + why + '). Give the token ' +
                    'Account Settings: Read, or set CF_WEB_ANALYTICS_SITE to the site tag.');
  }
  const want = [bare(host), bare(String(env.SITE_URL || 'https://mycampuskorner.com').replace(/^https?:\/\//, '').split('/')[0])];
  const sites = r.body.result;
  const hit = sites.find((s) => want.includes(bare(s.host))) ||
              sites.find((s) => want.some((w) => bare(s.host).endsWith(w))) ||
              (sites.length === 1 ? sites[0] : null);
  if (!hit || !hit.site_tag) {
    throw new Error('no Web Analytics site for ' + want[1] + ' on this account (found: ' +
                    (sites.map((s) => s.host).join(', ') || 'none') + '). Turn Web Analytics on ' +
                    'first (admin/SETUP.md 17), or set CF_WEB_ANALYTICS_SITE.');
  }
  siteTagCache = hit.site_tag;
  return siteTagCache;
}

// One GraphQL request for one window: totals, the daily series and the top lists.
function windowQuery(withBot, withTops) {
  const f = '{ siteTag: $site, date_geq: $from, date_leq: $to' + (withBot ? ', bot: 0' : '') + ' }';
  const tops = withTops ? Object.keys(TOPS).map((k) =>
    k + ': rumPageloadEventsAdaptiveGroups(filter: ' + f + ', limit: 50, orderBy: [count_DESC]) ' +
    '{ count sum { visits } dimensions { name: ' + TOPS[k] + ' } }').join('\n') : '';
  return 'query MCK($account: String!, $site: String!, $from: Date!, $to: Date!) {\n' +
    ' viewer { accounts(filter: { accountTag: $account }) {\n' +
    '  total: rumPageloadEventsAdaptiveGroups(filter: ' + f + ', limit: 1) ' +
    '{ count sum { visits } avg { sampleInterval } }\n' +
    (withTops ? '  daily: rumPageloadEventsAdaptiveGroups(filter: ' + f + ', limit: 100, orderBy: [date_ASC]) ' +
                '{ count sum { visits } dimensions { date } }\n' + tops + '\n' : '') +
    ' } }\n}';
}

async function runWindow(env, site, from, to, withTops) {
  for (;;) {
    const r = await cf(env, '/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: windowQuery(!noBotFilter, withTops),
                             variables: { account: env.CF_ACCOUNT_ID, site, from, to } })
    });
    const errors = (r.body && r.body.errors) || [];
    if (errors.length && !noBotFilter && errors.some((e) => /\bbot\b/i.test(e.message || ''))) {
      noBotFilter = true;                // this dataset has no such filter: ask again without it
      continue;
    }
    if (!r.ok || errors.length || !r.body || !r.body.data) {
      const why = errors.length ? errors.map((e) => e.message).join('; ') : 'HTTP ' + r.status;
      throw new Error('Cloudflare answered: ' + why);
    }
    const acc = (r.body.data.viewer && r.body.data.viewer.accounts && r.body.data.viewer.accounts[0]) || {};
    return acc;
  }
}

const n = (x) => Number(x) || 0;
const row0 = (list) => (Array.isArray(list) && list[0]) || {};

export async function onRequestGet({ request, env }) {
  const missing = ['CF_API_TOKEN', 'CF_ACCOUNT_ID'].filter((k) => !env[k]);
  if (missing.length) return json(200, { configured: false, missing });
  const asked = parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  const span = SPANS.has(asked) ? asked : 30;
  const today = Date.parse(iso(Date.now()) + 'T12:00:00Z');      // UTC days, as Cloudflare keeps them
  const list = [];
  for (let i = span - 1; i >= 0; i--) list.push(iso(today - i * DAY_MS));

  let site;
  try { site = await siteTag(env, new URL(request.url).host); } catch (e) {
    return json(502, { configured: true, error: e.message });
  }
  // Windows of at most WINDOW days, for this period and the one before it.
  const windows = (start, days) => {
    const out = [];
    for (let i = 0; i < days; i += WINDOW) {
      out.push([iso(start + i * DAY_MS), iso(start + Math.min(i + WINDOW, days) * DAY_MS - DAY_MS)]);
    }
    return out;
  };
  const first = Date.parse(list[0] + 'T12:00:00Z');
  try {
    const now = await Promise.all(windows(first, span).map(([a, b]) => runWindow(env, site, a, b, true)));
    const before = await Promise.all(windows(first - span * DAY_MS, span)
      .map(([a, b]) => runWindow(env, site, a, b, false)));

    const byDay = new Map();
    const tops = {};
    Object.keys(TOPS).forEach((k) => { tops[k] = new Map(); });
    let sampled = false;
    now.forEach((acc) => {
      (acc.daily || []).forEach((r) => {
        const d = r.dimensions && r.dimensions.date;
        if (d) byDay.set(d, { views: n(r.count), visits: n(r.sum && r.sum.visits) });
      });
      if (n(row0(acc.total).avg && row0(acc.total).avg.sampleInterval) > 1) sampled = true;
      Object.keys(TOPS).forEach((k) => (acc[k] || []).forEach((r) => {
        const name = (r.dimensions && r.dimensions.name) || '';
        const cur = tops[k].get(name) || { views: 0, visits: 0 };
        cur.views += n(r.count); cur.visits += n(r.sum && r.sum.visits);
        tops[k].set(name, cur);
      }));
    });
    const sum = (accs) => accs.reduce((t, acc) => {
      const r = row0(acc.total);
      t.views += n(r.count); t.visits += n(r.sum && r.sum.visits);
      return t;
    }, { views: 0, visits: 0 });
    const top = (k, max, empty) => Array.from(tops[k].entries())
      .map(([name, v]) => ({ name: name || empty, path: name || empty, views: v.views, visits: v.visits }))
      .sort((a, b) => b.views - a.views || String(a.name).localeCompare(String(b.name)))
      .slice(0, max);
    return json(200, {
      configured: true, source: 'cloudflare', span, from: list[0], to: list[list.length - 1], sampled,
      days: list.map((day) => Object.assign({ day, clicks: 0 }, byDay.get(day) || { views: 0, visits: 0 })),
      totals: sum(now), previous: sum(before),
      pages: top('pages', 50, '/'),
      // Where visits came from: other sites only (a page reached from this
      // site is not a visit), most visits first.
      sources: top('sources', 50, 'Direct / app')
        .filter((x) => bare(x.name) !== bare(new URL(request.url).host) && bare(x.name) !== 'mycampuskorner.com')
        .map((x) => ({ name: x.name, visits: x.visits || x.views }))
        .sort((a, b) => b.visits - a.visits).slice(0, 25),
      countries: top('countries', 25, '??').map((x) => ({ name: x.name, visits: x.visits || x.views })),
      devices: top('devices', 5, 'Unknown').map((x) => ({ name: x.name, visits: x.visits || x.views })),
      browsers: top('browsers', 10, 'Unknown').map((x) => ({ name: x.name, visits: x.visits || x.views }))
    });
  } catch (e) {
    return json(502, { configured: true, error: e.message });
  }
}
