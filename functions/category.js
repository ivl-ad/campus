/* /category?id=… -- canonical tag, title, share image and structured data per
 * product category, and a real 404 for an unknown one.
 * See functions/_shared/site-data.js. */
import { renderTemplate, CATEGORIES, siteUrl, collectionLd } from './_shared/site-data.js';

export const onRequest = (context) => renderTemplate(context, (data, id) => {
  const cat = CATEGORIES.find((c) => c[0] === id);
  if (!cat) return null;
  const items = data.products.filter((p) => p.cat === id);
  const path = '/category?id=' + encodeURIComponent(id);
  const title = cat[1] + ' for College | MyCampusKorner';
  const description = 'Shop ' + items.length + ' hand-picked ' + cat[1].toLowerCase() +
                      ' for college students and dorm life, curated by a college parent.';
  return {
    path, title, description,
    image: items.length ? items[0].img : undefined,
    jsonld: collectionLd(siteUrl(context.env), title, description, path,
      items.map((p) => ({ path: '/product?id=' + encodeURIComponent(p.id), name: p.name })))
  };
});
