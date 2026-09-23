/* POST /forms/contact -- the form on contact-us.html.
 * See functions/_shared/forms.js. */
import { formEndpoint, validEmail, cut } from '../_shared/forms.js';

export const onRequestPost = formEndpoint(async (db, f, meta) => {
  const email = cut(f.email, 254).toLowerCase();
  if (!validEmail(email)) return 'Please enter a valid email address.';
  const message = cut(f.message || f.Message, 5000);
  if (!message) return 'Please write a message.';
  await db.prepare('INSERT INTO contact_messages (created_at, name, email, reason, message, page, country) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(meta.now, cut(f.name || f['Full-Name'], 200), email, cut(f.reason || f.Reason, 100),
          message, meta.page, meta.country).run();
});
