/*
 * Read and write the site's data files: js/products.js, js/blogs.js,
 * js/team.js … each is `window.NAME = [ {...}, {...}, ];` with a comment
 * header. Shared by the public SEO functions and the editor APIs.
 */

/*
 * Pull `window.NAME = [ ... ];` out of a data file as JSON. A string-aware
 * scan, never a regex over the whole file: blogs.js holds two arrays, article
 * HTML is full of brackets, and any text may contain "/*", "*\/" or ", ]" --
 * stripping those blindly once deleted real entries. The same scan exists in
 * build_listings.py (extract_array) and admin/index.html (parseList).
 */
export function extractArray(source, name) {
  // The declaration itself, at the start of a line -- not a mention of it in
  // the comment header.
  const at = new RegExp('^[ \\t]*window\\.' + name + '\\s*=\\s*\\[', 'm').exec(source);
  if (!at) throw new Error('window.' + name + ' = [ ... ] not found');
  const open = at.index + at[0].length - 1;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {               // a /* comment */ between entries
      const close = source.indexOf('*/', i + 2);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error('window.' + name + ': the list is never closed');
  const out = source.slice(open, end + 1);

  // Trailing commas are legal JS but not JSON, and /* comments */ may sit
  // between entries. Drop both -- only outside strings.
  let json = '', s = false, e = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (s) {
      json += c;
      if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false;
      continue;
    }
    if (c === '"') { s = true; json += c; continue; }
    if (c === '/' && out[i + 1] === '*') {
      const close = out.indexOf('*/', i + 2);
      i = close < 0 ? out.length : close + 1;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < out.length) {
        if (/\s/.test(out[j])) { j++; continue; }
        if (out[j] === '/' && out[j + 1] === '*') {
          const close = out.indexOf('*/', j + 2);
          j = close < 0 ? out.length : close + 2;
          continue;
        }
        break;
      }
      if (out[j] === ']' || out[j] === '}') continue;
    }
    json += c;
  }
  const list = JSON.parse(json);
  if (!Array.isArray(list)) throw new Error('window.' + name + ' is not a list');
  return list;
}

// Everything above the first `window.NAME =` line: the file's comment header.
export function headerBefore(source, name) {
  const m = new RegExp('^window\\.' + name + '\\s*=', 'm').exec(source);
  return m && m.index > 0 ? source.slice(0, m.index).replace(/\n+$/, '') : '';
}

// Half of a surrogate pair (half an emoji -- cut in two by a length limit, or
// written as "&#xD83D;"). JSON.stringify writes one as a "\ud83d" escape,
// which no UTF-8 page can hold: build_*.py would refuse the whole file.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const wellFormed = (s) => String(s).replace(LONE_SURROGATE, '\uFFFD');

// A value as JavaScript source. JSON is valid JS except that older browsers
// reject a raw U+2028/U+2029 (line/paragraph separator -- invisible, and it
// arrives with some pasted text) inside a string, which would break the
// whole data file for them. Escaped, it means exactly the same. A broken half
// of an emoji becomes U+FFFD (\ufffd, the replacement character browsers
// show for it anyway).
export function jsValue(v) {
  return JSON.stringify(v, (k, x) => (typeof x === 'string' ? wellFormed(x) : x))
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// One entry per line, trailing comma on every entry -- the house style of
// every data file (the browser and build_*.py both accept it).
export function renderArray(name, list, keyOrder) {
  const lines = ['window.' + name + ' = ['];
  list.forEach((item) => {
    const keys = (keyOrder || []).filter((k) => k in item)
      .concat(Object.keys(item).filter((k) => !(keyOrder || []).includes(k)));
    lines.push('  {' + keys.map((k) => JSON.stringify(k) + ': ' + jsValue(item[k])).join(', ') + '},');
  });
  lines.push('];');
  return lines.join('\n');
}
