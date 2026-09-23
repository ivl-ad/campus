/* /product?id=… -- per-product title, description, image, canonical tag and
 * structured data, and a real 404 for an id that is not in the catalog.
 * See functions/_shared/site-data.js. */
import { renderTemplate, clip, siteUrl, absoluteUrl } from './_shared/site-data.js';

export const onRequest = (context) => renderTemplate(context, (data, id) => {
  const p = data.products.find((x) => x.id === id);
  if (!p) return null;
  const site = siteUrl(context.env);
  const path = '/product?id=' + encodeURIComponent(p.id);
  const image = absoluteUrl(site, p.img);
  const title = p.name + ' | MyCampusKorner';
  // desc is optional in the catalog; note is private and never used here.
  const description = clip(p.desc || (p.name + ' from ' + p.merchant + ' — a hand-picked ' +
                      p.catLabel + ' pick for college students, on MyCampusKorner.'), 158);
  // A price goes into the markup only when the site shows prices; otherwise
  // this is described as a page about the item, with no price claimed.
  const jsonld = data.showPrices && typeof p.price === 'number'
    ? {
        '@context': 'https://schema.org', '@type': 'Product',
        name: p.name, image, description, category: p.catLabel, url: site + path,
        brand: { '@type': 'Brand', name: p.merchant },
        offers: { '@type': 'Offer', price: String(p.price), priceCurrency: 'USD', url: p.url,
                  seller: { '@type': 'Organization', name: p.merchant } }
      }
    : {
        '@context': 'https://schema.org', '@type': 'ItemPage',
        name: p.name, description, url: site + path, inLanguage: 'en',
        primaryImageOfPage: { '@type': 'ImageObject', url: image },
        isPartOf: { '@type': 'WebSite', name: 'MyCampusKorner', url: site + '/' }
      };
  return { path, title, description, image: p.img, jsonld };
});
