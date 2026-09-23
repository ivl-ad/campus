/* /merchant?id=… -- canonical tag, title, share image and structured data per
 * store, and a real 404 for a store with no products.
 * See functions/_shared/site-data.js. */
import { renderTemplate, siteUrl, collectionLd } from './_shared/site-data.js';

export const onRequest = (context) => renderTemplate(context, (data, id) => {
  const items = data.products.filter((p) => p.merchantSlug === id);
  if (!items.length) return null;
  const name = items[0].merchant;
  const path = '/merchant?id=' + encodeURIComponent(id);
  const title = name + ' Picks for College Students | MyCampusKorner';
  const description = items.length + ' hand-picked ' + name + ' ' +
                      (items.length === 1 ? 'product' : 'products') +
                      ' for college students, curated by MyCampusKorner.';
  return {
    path, title, description,
    image: items[0].img,
    jsonld: collectionLd(siteUrl(context.env), title, description, path,
      items.map((p) => ({ path: '/product?id=' + encodeURIComponent(p.id), name: p.name })))
  };
});
