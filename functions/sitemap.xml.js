/*
 * /sitemap.xml -- generated on request from js/products.js and js/blogs.js,
 * so it always lists the whole catalog and every post. Nothing to rebuild:
 * a Save in the admin editor redeploys, and the next fetch here includes it.
 *
 * URLs are the clean form Cloudflare Pages serves (/product?id=…, not
 * product.html?id=…), matching the canonical tags the page functions emit.
 */
import { loadSiteData, siteUrl, CATEGORIES } from './_shared/site-data.js';

// Public, indexable static pages. Add a line here when you add a page.
const STATIC_PAGES = [
  ['/', '1.0'], ['/store', '0.9'], ['/blog', '0.8'], ['/about', '0.6'],
  ['/contact-us', '0.5'], ['/privacy-policy', '0.2'], ['/terms', '0.2']
];

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export async function onRequestGet({ request, env }) {
  const base = siteUrl(env);
  let data;
  try {
    data = await loadSiteData(env, request);
  } catch (err) {
    console.error('sitemap: could not read site data', err);
    return new Response('Sitemap temporarily unavailable.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300' } });
  }
  const rows = [];
  const add = (path, priority, lastmod) => rows.push(
    '  <url><loc>' + xml(base + path) + '</loc>' +
    (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') +
    '<priority>' + priority + '</priority></url>');
  const q = (page, id) => '/' + page + '?id=' + encodeURIComponent(id);

  STATIC_PAGES.forEach(([path, pr]) => add(path, pr));
  CATEGORIES.forEach(([id]) => {
    if (data.products.some((p) => p.cat === id)) add(q('category', id), '0.7');
  });
  [...new Set(data.products.map((p) => p.merchantSlug))].forEach((slug) => add(q('merchant', slug), '0.5'));
  data.products.forEach((p) => add(q('product', p.id), '0.8'));
  data.blogCategories.forEach((c) => {
    if (data.posts.some((p) => p.cat === c.id)) add(q('blog-category', c.id), '0.5');
  });
  const day = (ms) => (typeof ms === 'number' && isFinite(ms) && Math.abs(ms) < 8.64e15)
    ? new Date(ms).toISOString().slice(0, 10) : '';
  data.posts.forEach((p) => { if (p.id) add(q('blog-post', p.id), '0.7', day(p.dateMs)); });

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows.join('\n') + '\n</urlset>\n',
    { headers: { 'Content-Type': 'application/xml; charset=utf-8',
                 'Cache-Control': 'public, max-age=3600' } });
}
