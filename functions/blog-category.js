/* /blog-category?id=… -- canonical tag, title, share image and structured data
 * per blog category; a real 404 for an unknown category or one with no
 * published posts (an empty listing is not a page worth indexing).
 * See functions/_shared/site-data.js. */
import { renderTemplate, siteUrl, collectionLd } from './_shared/site-data.js';

export const onRequest = (context) => renderTemplate(context, (data, id) => {
  const cat = data.blogCategories.find((c) => c.id === id);
  if (!cat) return null;
  const posts = data.posts.filter((p) => p.cat === cat.id)       // published only
    .sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
  if (!posts.length) return null;
  const path = '/blog-category?id=' + encodeURIComponent(cat.id);
  const title = cat.label + ' Articles | MyCampusKorner Blog';
  const description = 'College ' + cat.label.toLowerCase() + ' guides, tips and checklists ' +
                      'for students and parents from the MyCampusKorner blog.';
  return {
    path, title, description,
    image: posts[0].img,
    jsonld: collectionLd(siteUrl(context.env), title, description, path,
      posts.map((p) => ({ path: '/blog-post?id=' + encodeURIComponent(p.id), name: p.name })))
  };
});
