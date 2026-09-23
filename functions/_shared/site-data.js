/*
 * Shared by the public SEO functions (product, category, merchant, blog-post,
 * blog-category, sitemap.xml). Nothing here is behind the editor password and
 * nothing here writes anywhere: it only READS the same js/products.js and
 * js/blogs.js the browser reads, straight from this deployment's static files.
 *
 * That is the point of doing SEO this way. The admin editor's Save commits
 * js/products.js, Cloudflare redeploys, and the very next request here sees
 * the new catalog -- so canonical tags, per-product titles, real 404s and the
 * sitemap can never go stale, with no build step of their own.
 *
 * Every entry point catches its own errors and falls back to serving the
 * untouched static page, so a bug in here can degrade SEO but can never take
 * a page down.
 */

import { CATEGORIES } from '../api/catalog.js';
import { extractArray } from './js-data.js';

export { CATEGORIES };

// The one public address of the site. Canonical tags and the sitemap must use
// a single fixed origin (not whatever host a request came in on -- preview
// deploys and *.pages.dev would otherwise canonicalise to themselves).
// Override with a SITE_URL variable in Pages settings if it ever changes.
export function siteUrl(env) {
  return String((env && env.SITE_URL) || 'https://mycampuskorner.com').replace(/\/+$/, '');
}

export { extractArray };

// A full address for an image. Share tags and structured data need one, but
// images served by the site are stored as paths ("/images/blog/x.png",
// "images/y.jpg"); those are made absolute on the site's own domain.
export function absoluteUrl(site, u) {
  const s = String(u || '').trim();
  if (!s || /^https?:\/\//i.test(s)) return s || undefined;
  return site + '/' + s.replace(/^\/+/, '');
}

async function readAsset(env, request, path, optional) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!res.ok) {
    if (optional) return '';
    throw new Error(path + ' -> HTTP ' + res.status);
  }
  return res.text();
}

// A deployment's files never change, so one parse per isolate is enough.
let cache = null;

export async function loadSiteData(env, request) {
  if (cache) return cache;
  const [productsJs, blogsJs, teamJs, configJs] = await Promise.all([
    readAsset(env, request, '/js/products.js'),
    readAsset(env, request, '/js/blogs.js'),
    readAsset(env, request, '/js/team.js', true),
    readAsset(env, request, '/js/site-config.js', true)
  ]);
  const allPosts = extractArray(blogsJs, 'BLOG_POSTS');
  let team = [];
  try { team = teamJs ? extractArray(teamJs, 'TEAM') : []; } catch (e) { /* no team yet */ }
  cache = {
    products: extractArray(productsJs, 'PRODUCTS'),
    // Posts marked hidden in the editor are drafts: never shown, listed or indexed.
    posts: allPosts.filter((p) => !p.hidden),
    blogCategories: extractArray(blogsJs, 'BLOG_CATEGORIES'),
    team,
    // Prices go into structured data only when the site shows them: markup
    // must never state what the visible page does not (js/site-config.js).
    showPrices: /var\s+SHOW_PRICES\s*=\s*true\b/.test(configJs || '')
  };
  return cache;
}

// A listing page as structured data: a named collection of links.
export function collectionLd(site, name, description, path, links) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name, description,
    url: site + path,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'MyCampusKorner', url: site + '/' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: links.length,
      itemListElement: links.map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: site + l.path, name: l.name }))
    }
  };
}

export function clip(text, max) {
  const s = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,.;:–—-]+$/, '') + '…';
}

/*
 * Serve the static template, with its <head> rewritten for the item the URL
 * names -- or with a real 404 status and noindex when it names nothing.
 *
 * resolve(data, id) returns null (not found) or
 *   { path, title, description, image, jsonld }   path like '/product?id=abc'
 * jsonld, when given, is added to <head> as structured data.
 */
export async function renderTemplate(context, resolve) {
  const { request, env, next } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();

  // Ask for the template unconditionally. Its ETag says nothing about the
  // catalog / blog data the page is rewritten with, so answering a browser's
  // or crawler's If-None-Match with 304 would keep serving an old title -- or
  // a deleted product's 200 -- until the template file itself changed.
  const plain = new Request(request);
  plain.headers.delete('If-None-Match');
  plain.headers.delete('If-Modified-Since');
  const page = await next(plain);
  // Only rewrite a real HTML page; pass redirects/errors through untouched.
  if (page.status !== 200 || !/text\/html/.test(page.headers.get('Content-Type') || '')) {
    return page;
  }

  let meta;
  try {
    const id = new URL(request.url).searchParams.get('id');
    meta = id ? resolve(await loadSiteData(env, request), id) : null;
  } catch (err) {
    console.error('seo: could not read site data, serving page as-is:', err);
    return page;
  }

  const headers = new Headers(page.headers);
  headers.delete('ETag');
  headers.delete('Last-Modified');
  if (!meta) {
    // The page's own script still shows its friendly "not found" message;
    // this just stops search engines indexing it as a real page.
    headers.set('X-Robots-Tag', 'noindex');
    return new HTMLRewriter()
      .on('head', { element(el) { el.append('<meta name="robots" content="noindex"/>', { html: true }); } })
      .transform(new Response(page.body, { status: 404, headers }));
  }

  const url = siteUrl(env) + meta.path;
  const image = absoluteUrl(siteUrl(env), meta.image);
  const setContent = (value) => ({ element(el) { if (value) el.setAttribute('content', value); } });
  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title); } })
    .on('meta[name="description"]', setContent(meta.description))
    .on('meta[property="og:title"]', setContent(meta.title))
    .on('meta[name="twitter:title"]', setContent(meta.title))
    .on('meta[property="og:description"]', setContent(meta.description))
    .on('meta[name="twitter:description"]', setContent(meta.description))
    .on('meta[property="og:image"]', setContent(image))
    .on('meta[name="twitter:image"]', setContent(image))
    .on('link[rel="canonical"]', { element(el) { el.remove(); } })
    // A template's own placeholder structured data gives way to the real one.
    .on('script[type="application/ld+json"]', { element(el) { if (meta.jsonld) el.remove(); } })
    .on('head', {
      element(el) {
        el.append('<link rel="canonical" href="' + attr(url) + '"/>' +
                  '<meta property="og:url" content="' + attr(url) + '"/>', { html: true });
        if (meta.jsonld) {
          // "</" is escaped so text inside the data can never close the script.
          el.append('<script type="application/ld+json">' +
                    JSON.stringify(meta.jsonld).replace(/</g, '\\u003c') + '</script>', { html: true });
        }
      }
    })
    .transform(new Response(page.body, { status: 200, headers }));
}
