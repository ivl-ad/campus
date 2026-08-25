/*
 * Password gate for /admin/* on Cloudflare Pages.
 *
 * Uses HTTP Basic auth, so the browser shows its own login box and remembers
 * it for the session. The username is ignored -- only the password matters,
 * and it is read from the EDITOR_PASSWORD secret set in the Pages project.
 *
 * The same check exists in functions/api/_middleware.js. It is duplicated on
 * purpose: these two files are the entire security boundary, and a shared
 * import that silently failed to bundle would open both. Keep them in sync.
 */

// Compare via digests so the work does not depend on how many characters match.
async function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected))
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function challenge(message) {
  return new Response(message || 'Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Catalog editor", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const expected = env.EDITOR_PASSWORD;

  if (!expected) {
    // Fail closed. Without this the editor would be wide open.
    return new Response(
      'EDITOR_PASSWORD is not set on this Pages project, so the catalog editor ' +
      'is disabled.\nAdd it under Settings > Environment variables (encrypted).',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const header = request.headers.get('Authorization') || '';
  if (header.startsWith('Basic ')) {
    let supplied = '';
    try {
      const decoded = atob(header.slice(6));
      supplied = decoded.slice(decoded.indexOf(':') + 1);
    } catch (e) { /* malformed header -> falls through to the challenge */ }
    if (await sameSecret(supplied, expected)) {
      const response = await next();
      const out = new Response(response.body, response);
      // Never cache the editor, and keep it out of search results.
      out.headers.set('Cache-Control', 'no-store');
      out.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return out;
    }
  }
  return challenge();
}
