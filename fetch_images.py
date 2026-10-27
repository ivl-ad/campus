#!/usr/bin/env python3
"""
fetch_images.py -- keep a copy of every product image and partner logo on the
site itself, so pages never load them from the retailers' servers.

    python fetch_images.py              download what is missing, drop what is unused
    python fetch_images.py --check      report only; write nothing
    python fetch_images.py --refresh X  download X again (a product id, a partner
                                        name, or an image address); repeatable

How it fits together
--------------------
The editor keeps each image as the address it was given (`img` in
js/products.js, `logo` in js/partners.js). A product whose "image served
from" is set to the retailer (`"imgFrom": "retailer"`) is skipped: it always
shows from its own address, and a copy only it used is deleted. This script never edits those data
files -- so a rebuild never looks like "a commit made outside the editor" to
the shared draft. Instead it saves a copy under images/products/ or
images/partners/ and records "address -> copy" in js/local-images.js:

  * build_listings.py bakes the copies into the Store and Home cards;
  * product.html, category.html, merchant.html and the home page's partner
    strip load js/local-images.js right after the data file, and it points
    the data at the copies before the page's own script runs;
  * the SEO functions (functions/_shared/site-data.js) use the copies for
    share images.

An address with no copy yet -- a product saved a minute ago, or a download
the retailer refused -- simply shows from its original address, as before.

Copies
------
A copy is named after its product (or partner) plus a hash of the address,
so a new address is a new file and no browser ever shows a stale one. A copy
nothing uses any more is deleted; a file put in those folders by hand is
never touched (only files this script recorded are). To fetch one again --
the retailer replaced the picture at the same address -- use --refresh, or
delete the file and run the script.

Bigger versions: a product image that comes out small (under UPGRADE_BELOW)
is very often the thumbnail of a bigger one, with the size written into its
address (Shopify's _300x300, ?width=, Walmart's odnWidth, -150x150.jpg...).
When its copy is made -- once, never again -- the address is tried without
those markers, and a bigger version is used for the copy only if it is the
same picture (find_bigger()). The data file keeps the address as pasted.
Product images only: partner logos are shown small. --retry-small does the
same for copies made before this existed (run once, by hand).

With Pillow installed (the GitHub Action installs it), an image over MAX_SIDE
pixels is scaled down to fit and saved as WebP, and an AVIF one is converted
to WebP so every browser can show it. Nothing is ever scaled up, cropped or
stretched; animated GIFs and SVGs are kept exactly as downloaded. Without
Pillow every file is kept exactly as downloaded. An SVG containing script is
refused (images/ is served from the site's own origin, so a scripted SVG
opened directly would run as the site); _headers sandboxes these folders too.

A download that fails is reported and does not stop the build: that image
keeps showing from its original address, and the next run tries again.
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from build_listings import BuildError, extract_array, read_local_images as read_manifest

# Longest side kept, in pixels: twice the size the largest slot shows it at
# (the product page's half-width panel), so it is sharp on high-DPI screens.
MAX_SIDE = 1200
# Re-encode a file larger than this even when it needs no scaling.
BIG_BYTES = 400 * 1024
WEBP_QUALITY = 85
# Smaller than this on its long side and it looks soft at card size (cards
# are about 350 x 300); reported, and marked "low-res" in the editor.
LOW_RES = 300
# Nothing legitimate is this large; a bigger answer is refused unread.
MAX_DOWNLOAD = 15 * 1024 * 1024
TIMEOUT = 25

# Bigger versions (see find_bigger()). A copy smaller than UPGRADE_BELOW on
# its long side is checked once, when it is made, for a full-size version at
# the same address minus its size markers; at most UPGRADE_TRIES addresses
# are tried. A candidate counts only if it is the same picture: the same
# shape within SAME_SHAPE, and alike within SAME_PICTURE (mean difference
# out of 255) once both are shrunk to 16 x 16 colour pixels.
UPGRADE_BELOW = 800
UPGRADE_TRIES = 4
SAME_SHAPE = 0.03
SAME_PICTURE = 12
# Query parameters that only choose a size (compared lowercased).
SIZE_PARAMS = {'w', 'h', 'width', 'height', 'size', 'sz', 'maxwidth', 'maxheight', 'resize',
               'fit', 'crop', 'sw', 'sh', 'sm', 'odnwidth', 'odnheight', 'wid', 'hei',
               'imwidth', 'imheight', 'dw', 'dh', 'scale', 'dpr'}

MANIFEST = os.path.join('js', 'local-images.js')
SOURCES = (
    # data file, array, field, folder, what, warn below this many pixels,
    # look for bigger versions. Partner logos are shown small, so they are
    # neither held to card size nor swapped for a heavier full-size file.
    (os.path.join('js', 'products.js'), 'PRODUCTS', 'img', 'images/products', 'product', LOW_RES,
     True),
    (os.path.join('js', 'partners.js'), 'PARTNERS', 'logo', 'images/partners', 'partner', 0, False),
)

# A browser's request, minus AVIF: some CDNs answer with AVIF when it is
# offered, and Safari before 16 cannot show it.
HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    'Accept': 'image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.9,*/*;q=0.5',
}

EXT = {'png': 'png', 'jpeg': 'jpg', 'gif': 'gif', 'webp': 'webp', 'avif': 'avif', 'svg': 'svg',
       'ico': 'ico'}

# The generated file. The small function at the end is part of it on
# purpose: it is what lets the browser-side pages use the copies without any
# change to their own scripts. Edit it here, never in js/local-images.js.
MANIFEST_HEAD = """\
/*
 * local-images.js -- GENERATED by fetch_images.py. Do not edit by hand: the
 * next rebuild rewrites it.
 *
 * Product images and partner logos are stored on this site (images/products,
 * images/partners) rather than loaded from the retailers. This maps each
 * original address, exactly as the editor saved it, to its copy. Load it
 * right after js/products.js or js/partners.js: it points the data at the
 * copies, so the page's own script never needs to know. An address with no
 * copy keeps showing from where it is.
 */
window.LOCAL_IMAGES = """

MANIFEST_TAIL = """;
(function (map) {
  function swap(list, field) {
    if (!list || !list.forEach) return;
    list.forEach(function (item) {
      if (item && item.imgFrom === 'retailer') return;   // shown from its own address
      var key = item && typeof item[field] === 'string' ? item[field].trim() : '';
      if (!key || !Object.prototype.hasOwnProperty.call(map, key)) return;
      // Absolute, so share tags and structured data built from it are too.
      var a = document.createElement('a');
      a.href = map[key];
      item[field] = a.href;
    });
  }
  swap(window.PRODUCTS, 'img');
  swap(window.PARTNERS, 'logo');
})(window.LOCAL_IMAGES || {});
"""

try:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 60_000_000      # refuse decompression bombs
except ImportError:                         # pragma: no cover - depends on the machine
    Image = None


# ------------------------------------------------------------------ helpers
def render_manifest(entries):
    body = json.dumps(dict(sorted(entries.items())), indent=2, ensure_ascii=False)
    return MANIFEST_HEAD + body + MANIFEST_TAIL


def sniff(data):
    """The image format from its first bytes, or None for anything else
    (an HTML error page served with a 200, say)."""
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[4:12] in (b'ftypavif', b'ftypavis'):
        return 'avif'
    if data[:4] == b'\x00\x00\x01\x00':          # a favicon; browsers show it as is
        return 'ico'
    head = data[:1024].lstrip().lower()
    if head.startswith(b'<svg') or (head.startswith(b'<?xml') and b'<svg' in head):
        return 'svg'
    return None


def unsafe_svg(data):
    text = data.decode('utf-8', 'replace').lower()
    return bool(re.search(r'<script|javascript:|\bon[a-z]+\s*=|<foreignobject', text))


def slug(text, fallback):
    s = re.sub(r'[^a-z0-9]+', '-', str(text or '').lower()).strip('-')[:40].strip('-')
    return s or fallback


def download(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        if res.status != 200:
            raise ValueError('HTTP %d' % res.status)
        data = res.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError('larger than %d MB' % (MAX_DOWNLOAD // (1024 * 1024)))
    return data


def dimensions(data, fmt):
    """(width, height) when Pillow can tell, else None."""
    if Image is None or fmt == 'svg':
        return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:
        return None


def optimise(data, fmt):
    """(bytes, format): scaled to fit MAX_SIDE and/or re-encoded as WebP when
    that helps; otherwise the original, untouched."""
    if Image is None or fmt in ('gif', 'svg', 'ico'):
        return data, fmt
    with Image.open(io.BytesIO(data)) as im:
        if getattr(im, 'n_frames', 1) > 1:          # animated: keep as it is
            return data, fmt
        im = ImageOps.exif_transpose(im)
        too_big = max(im.size) > MAX_SIDE
        if not (too_big or fmt == 'avif' or len(data) > BIG_BYTES):
            return data, fmt
        if im.mode in ('P', 'PA', 'LA', 'RGBA') or 'transparency' in im.info:
            im = im.convert('RGBA')
        elif im.mode != 'RGB':
            im = im.convert('RGB')
        if too_big:
            im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)   # keeps the aspect ratio
        out = io.BytesIO()
        im.save(out, 'WEBP', quality=WEBP_QUALITY, method=6)
        webp = out.getvalue()
    # Only worth it when it is smaller -- or the original could not be shown
    # everywhere (AVIF), or was over the size limit.
    if too_big or fmt == 'avif' or len(webp) < len(data):
        return webp, 'webp'
    return data, fmt


# ---------------------------------------------------------- bigger versions
# A small image is often a thumbnail of a bigger one on the same server, with
# the size written into its address. An editor pastes what they can find --
# frequently the thumbnail -- so when a copy comes out small, the address is
# tried again without those markers. Nothing here is trusted: find_bigger()
# keeps a candidate only if it really is the same picture, and bigger. The
# data file keeps the address the editor gave; only the copy changes.
def upgrade_candidates(url):
    """Addresses that may hold a bigger version of the same image, most
    likely first. [] when the address carries no size marker at all."""
    parts = urllib.parse.urlsplit(url)
    path = parts.path
    big = path
    # Shopify and many others: name_300x300.jpg, name_300x.jpg, name_x300.jpg,
    # name_300x300_crop_center.jpg, name_300x300@2x.jpg, name_grande.jpg
    big = re.sub(r'_(?:\d+x\d*|x\d+)(?:_crop_[a-z]+)?(?:@\dx)?(?=\.\w+$)', '', big, flags=re.I)
    big = re.sub(r'_(?:pico|icon|thumb|small|compact|medium|large|grande)(?=\.\w+$)', '', big,
                 flags=re.I)
    # WordPress / WooCommerce: name-300x250.jpg
    big = re.sub(r'-\d{2,4}x\d{2,4}(?=\.\w+$)', '', big)
    # Amazon: name._AC_SX300_.jpg
    big = re.sub(r'\._[A-Z0-9_,]+_(?=\.\w+$)', '', big)
    # Best Buy and others: name.jpg;maxHeight=200;maxWidth=200
    big = re.sub(r';(?:maxheight|maxwidth|height|width)=\d+', '', big, flags=re.I)
    # Wix: /media/ID~mv2.jpg/v1/fill/w_300,h_300,.../name.jpg -> /media/ID~mv2.jpg
    big = re.sub(r'(/media/[^/]+~mv2\.\w+)/v1/.*$', r'\1', big)
    # Cloudinary-style transformation segments: /c_fill,w_300,h_300/ /dpr_2.0/
    big = '/'.join(s for s in big.split('/')
                   if not (re.fullmatch(r'[a-z]{1,4}_[^/,]+(?:,[a-z]{1,4}_[^/,]+)*', s) and
                           re.search(r'(?:^|,)(?:w|h|c|dpr|t)_', s)))
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    sized = [(k, v) for k, v in query if k.lower() in SIZE_PARAMS]
    plain = [(k, v) for k, v in query if k.lower() not in SIZE_PARAMS]
    # Squarespace: ?format=300w
    plain = [(k, '2500w' if k == 'format' and re.fullmatch(r'\d+w', v) else v) for k, v in plain]
    as_big = [(k, '2000' if k.lower() in SIZE_PARAMS and v.isdigit() else v) for k, v in query]

    def build(p, q):
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, p, urllib.parse.urlencode(q),
                                        parts.fragment))
    out = []
    for cand in (build(big, plain), build(big, query), build(path, plain),
                 build(big, as_big) if sized else None):
        if cand and cand != url and cand not in out:
            out.append(cand)
    return out[:UPGRADE_TRIES]


def picture(data):
    """A Pillow image of the first frame, transparency laid on white."""
    im = Image.open(io.BytesIO(data))
    im.seek(0)
    im = ImageOps.exif_transpose(im)
    if im.mode in ('P', 'PA', 'LA', 'RGBA') or 'transparency' in im.info:
        im = im.convert('RGBA')
        flat = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(flat, im)
    return im.convert('RGB')


def same_picture(a, b):
    """True when a and b (RGB) are the same image at different sizes. In
    colour, not grey: a product's red and blue versions can be identical in
    grey, and swapping one for the other is exactly the mistake to avoid."""
    if abs((a.width / a.height) / (b.width / b.height) - 1) > SAME_SHAPE:
        return False
    ca = a.resize((16, 16), Image.BOX).tobytes()      # RGB, 3 bytes a pixel
    cb = b.resize((16, 16), Image.BOX).tobytes()
    return sum(abs(x - y) for x, y in zip(ca, cb)) / (256.0 * 3) <= SAME_PICTURE


def find_bigger(url, data):
    """(bytes, format, size, address) of a bigger version of the image in
    data, found by upgrade_candidates(url) -- or None."""
    if Image is None:
        return None
    try:
        ref = picture(data)
    except Exception:
        return None
    best = None
    for cand in upgrade_candidates(url):
        try:
            got = download(cand)
            fmt = sniff(got)
            if fmt not in ('png', 'jpeg', 'webp', 'avif'):
                continue
            im = picture(got)
        except Exception:
            continue                                  # a 404 or an error page: next
        if max(im.size) < max(ref.size) * 1.25 or not same_picture(ref, im):
            continue
        if best is None or max(im.size) > max(best[2]):
            best = (got, fmt, im.size, cand)
        if max(im.size) >= MAX_SIDE:
            break                                     # big enough: stop asking
    return best


# --------------------------------------------------------------------- main
def wanted(root):
    """Every image in use. Returns (external, named):
      external  address -> (folder, name hint, low-res threshold, look for bigger)
      named     files the data names directly ("images/products/x.jpg") --
                those are never deleted, even if they began life as a copy:
                pointing a product at its copy is a perfectly good manual fix."""
    out, named = {}, set()
    for rel, array, field, folder, what, low, bigger in SOURCES:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            continue
        for item in extract_array(open(path, encoding='utf-8').read(), array, path, True):
            if not isinstance(item, dict):
                continue
            if item.get('imgFrom') == 'retailer':     # served from its own address
                continue
            url = str(item.get(field) or '').strip()
            if re.match(r'^https?://', url, re.I):
                if url not in out:
                    out[url] = (folder, slug(item.get('id') or item.get('name'), what), low, bigger)
            elif url:
                named.add(url.lstrip('/'))
    return out, named


def matches(url, hint, refresh):
    return any(r == url or slug(r, '') == hint for r in refresh)


def dimensions_of(root, rel):
    with Image.open(os.path.join(root, rel)) as im:
        return im.size


def small_copy(path):
    """True for a stored raster copy under UPGRADE_BELOW on its long side."""
    if Image is None or not path.endswith(('.png', '.jpg', '.webp', '.avif')):
        return False
    try:
        with Image.open(path) as im:
            return max(im.size) < UPGRADE_BELOW
    except Exception:
        return False


def run(root, check=False, refresh=(), retry_small=False):
    """retry_small: also look once for bigger versions of copies already
    stored (new copies always get that look when they are made)."""
    manifest = read_manifest(root)
    need, named = wanted(root)
    entries, report = {}, {'stored': [], 'kept': 0, 'failed': [], 'low': [], 'dropped': [],
                           'bigger': []}

    for url, (folder, hint, low, bigger) in sorted(need.items()):
        have = manifest.get(url)
        fresh = matches(url, hint, refresh)
        if have and os.path.isfile(os.path.join(root, have)) and not fresh:
            if not (retry_small and bigger and not check and small_copy(os.path.join(root, have))):
                entries[url] = have
                report['kept'] += 1
                continue
            found = find_bigger(url, open(os.path.join(root, have), 'rb').read())
            if not found:
                entries[url] = have
                report['kept'] += 1
                continue
            data, fmt, size, via = found
            report['bigger'].append((hint, '%dx%d' % dimensions_of(root, have), '%dx%d' % size, via))
            data, fmt = optimise(data, fmt)
        elif check:
            report['stored'].append((hint, url, 'would download'))
            continue
        else:
            try:
                data = download(url)
                fmt = sniff(data)
                if fmt is None:
                    raise ValueError('the answer is not an image')
                if fmt == 'svg' and unsafe_svg(data):
                    raise ValueError('an SVG containing script -- refused')
                size = dimensions(data, fmt)
                # Small? Perhaps it is the thumbnail of a bigger version.
                if (bigger and size and max(size) < UPGRADE_BELOW and
                        fmt in ('png', 'jpeg', 'webp', 'avif')):
                    found = find_bigger(url, data)
                    if found:
                        report['bigger'].append((hint, '%dx%d' % size, '%dx%d' % found[2], found[3]))
                        data, fmt, size = found[0], found[1], found[2]
                data, fmt = optimise(data, fmt)
            except (urllib.error.URLError, ValueError, OSError) as exc:
                report['failed'].append((hint, url, str(getattr(exc, 'reason', exc))))
                continue
            except Exception as exc:                 # a file Pillow cannot read
                report['failed'].append((hint, url, '%s: %s' % (type(exc).__name__, exc)))
                continue
        name = '%s-%s.%s' % (hint, hashlib.sha1(url.encode('utf-8')).hexdigest()[:10], EXT[fmt])
        rel = folder + '/' + name
        os.makedirs(os.path.join(root, folder), exist_ok=True)
        if have and have != rel and os.path.isfile(os.path.join(root, have)):
            os.remove(os.path.join(root, have))      # a refreshed copy changed format
        with open(os.path.join(root, rel), 'wb') as f:
            f.write(data)
        entries[url] = rel
        report['stored'].append((hint, url, '%s, %d KB' % (rel, (len(data) + 1023) // 1024)))
        if size and max(size) < low:
            report['low'].append((hint, '%dx%d' % size))

    # Copies nothing uses any more. Only files this script recorded, and
    # never one a product or partner now names directly.
    for url, rel in manifest.items():
        if url in need or rel in entries.values() or rel in named:
            continue
        report['dropped'].append(rel)
        if not check and os.path.isfile(os.path.join(root, rel)):
            os.remove(os.path.join(root, rel))

    # Low resolution, for the ones already stored too.
    if Image is not None:
        for url, rel in entries.items():
            _, hint, low, _ = need[url]
            if not low or any(h == hint for h, _ in report['low']) or rel.endswith('.svg'):
                continue
            try:
                with Image.open(os.path.join(root, rel)) as im:
                    if max(im.size) < low:
                        report['low'].append((hint, '%dx%d' % im.size))
            except Exception:
                pass

    changed = render_manifest(entries)
    path = os.path.join(root, MANIFEST)
    old = open(path, encoding='utf-8').read() if os.path.isfile(path) else None
    if not check and changed != old:
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(changed)
    return report, changed != old


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description='Store product images and partner logos on the site.')
    ap.add_argument('--root', default=here, help="site folder (default: this script's folder)")
    ap.add_argument('--check', action='store_true', help='report only; write nothing')
    ap.add_argument('--refresh', action='append', default=[],
                    help='download this one again: a product id, partner name or image address')
    ap.add_argument('--retry-small', action='store_true',
                    help='also look for bigger versions of small copies already stored '
                         '(new copies always get that look when they are made)')
    args = ap.parse_args()

    try:
        report, changed = run(os.path.abspath(args.root), args.check, args.refresh,
                              args.retry_small)
    except BuildError as exc:
        print('error: %s' % exc)
        return 1

    print('images: %d kept, %d %s, %d failed, %d dropped%s'
          % (report['kept'], len(report['stored']),
             'to download' if args.check else 'stored', len(report['failed']),
             len(report['dropped']), '' if Image else '   (no Pillow: kept as downloaded)'))
    for hint, url, what in report['stored']:
        print('  + %-34s %s' % (hint, what))
    for hint, was, now, via in report['bigger']:
        print('  ^ %-34s bigger version found: %s -> %s px\n      %s' % (hint, was, now, via))
    for rel in report['dropped']:
        print('  - %s' % rel)
    for hint, url, why in report['failed']:
        print('  ! %-34s %s\n      %s -- it keeps showing from that address' % (hint, why, url))
    for hint, size in sorted(report['low']):
        print('  low-res: %-28s %s px -- looks soft on the site; a larger image fixes it'
              % (hint, size))
    if args.check:
        print('\n--check: nothing was written.%s'
              % (' js/local-images.js would change.' if changed else ''))
    # Failed downloads are not an error: those images keep their own address.
    return 0


if __name__ == '__main__':
    sys.exit(main())
