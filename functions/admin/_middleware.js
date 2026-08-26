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

// The browser sends "user:password" as UTF-8 bytes, base64'd. atob() gives one
// character per byte, so the bytes have to be run back through a UTF-8 decoder
// or any non-ASCII password (£, é, a curly quote) silently never matches.
function passwordFrom(header) {
  const binary = atob(header.slice(6).trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const decoded = new TextDecoder('utf-8').decode(bytes);
  // Everything after the first colon: usernames cannot contain one, passwords can.
  return decoded.slice(decoded.indexOf(':') + 1);
}

function challenge() {
  return new Response(
    'Not signed in.\n\n' +
    'The username is ignored - leave it blank or type anything. Only the\n' +
    'password is checked, against the EDITOR_PASSWORD variable on this\n' +
    'Cloudflare Pages project.\n\n' +
    'If the password keeps being refused, it does not match that variable.\n' +
    'Check for a stray space or newline pasted into the value, then redeploy.\n',
    {
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
    let supplied = null;
    try {
      supplied = passwordFrom(header);
    } catch (e) { /* malformed header -> falls through to the challenge */ }
    // The stored value is trimmed: a newline pasted into the Cloudflare box is
    // invisible and would otherwise lock everyone out with no way to see why.
    if (supplied !== null && await sameSecret(supplied, String(expected).trim())) {
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
