/* /blog-post?id=… -- per-article title, description, image, canonical tag and
 * BlogPosting structured data, and a real 404 for an unknown (or draft)
 * article. See functions/_shared/site-data.js. */
import { renderTemplate, clip, siteUrl, absoluteUrl } from './_shared/site-data.js';

export const onRequest = (context) => renderTemplate(context, (data, id) => {
  const post = data.posts.find((x) => x.id === id);     // drafts are already filtered out
  if (!post) return null;
  const site = siteUrl(context.env);
  const path = '/blog-post?id=' + encodeURIComponent(post.id);
  const person = post.author ? data.team.find((t) => t.id === post.author) : null;
  const org = {
    '@type': 'Organization', name: 'MyCampusKorner', url: site + '/',
    logo: { '@type': 'ImageObject', url: site + '/images/mycampuskorner-logo.png' }
  };
  const description = clip(post.excerpt || post.contentHTML, 158);
  return {
    path,
    title: post.name + ' | MyCampusKorner',
    description,
    image: post.img,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.name,
      description,
      image: absoluteUrl(site, post.img),
      datePublished: post.dateMs ? new Date(post.dateMs).toISOString() : undefined,
      author: person
        ? { '@type': 'Person', name: person.name, jobTitle: person.role || undefined,
            url: site + '/about#team-' + person.id }
        : org,
      publisher: org,
      mainEntityOfPage: site + path,
      articleSection: post.catLabel || undefined,
      inLanguage: 'en'
    }
  };
});
