/* POST /forms/newsletter -- the "Sign Up" email boxes on Home and the blog.
 * See functions/_shared/forms.js. */
import { formEndpoint, validEmail, cut } from '../_shared/forms.js';

export const onRequestPost = formEndpoint(async (db, f, meta) => {
  const email = cut(f.email, 254).toLowerCase();
  if (!validEmail(email)) return 'Please enter a valid email address.';
  // Signing up twice is fine: the original date is kept.
  await db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email, created_at, page, country) VALUES (?, ?, ?, ?)')
    .bind(email, meta.now, meta.page, meta.country).run();
});
