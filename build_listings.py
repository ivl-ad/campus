#!/usr/bin/env python3
"""Re-bake the baked product listings from a catalog file.

Most of this site reads js/products.js live in the browser: product.html,
category.html and merchant.html all build themselves at load time, so adding a
product there needs no build step at all.

Two pages are different. store.html and index.html carry their product cards
as plain HTML so they stay crawlable and still work with JavaScript off. This
script is what keeps those two pages in step with the catalog.

    python build_listings.py                 # update store.html + index.html
    python build_listings.py --check         # report what would change, write nothing
    python build_listings.py --products js/products.sample.js --check

It rewrites, in place:
  - store.html   every product, the category filter list, the ItemList JSON-LD
  - index.html   the first FEATURED products in the home rail, and its JSON-LD

Everything outside those containers is left byte-for-byte alone, so running it
twice in a row changes nothing the second time.

The catalog is validated first. If anything is wrong -- a duplicate id, an
unknown category, a missing field -- nothing is written and the problems are
listed instead.
"""
import argparse
import glob
import html
import json
import os
import re
import shutil
import sys
import time

# how many products the home page rail shows
FEATURED = 8

# The built-in categories, in mega-menu order. Categories added in the editor
# are kept in js/products.js as window.PRODUCT_CATEGORIES -- see
# load_categories(). Must stay in step with BUILT_IN in js/listing-page.js and
# CATEGORIES in functions/api/catalog.js.
SITE_CATEGORIES = [
    ('dorm-living-essentials', 'Dorm & Living Essentials'),
    ('academic-essentials',    'Academic Essentials'),
    ('personal-lifestyle',     'Personal Lifestyle'),
    ('event-tickets-travel',   'Event Tickets & Travel'),
    ('financial-services',     'Financial Services'),
    ('laundry-cleaning',       'Laundry & Cleaning'),
    ('living-social-spaces',   'Living & Social Spaces'),
    ('bathroom',               'Bathroom'),
    ('kitchen-dining',         'Kitchen & Dining'),
    ('bedroom-study',          'Bedroom & Study'),
]
CATEGORY_LABEL = dict(SITE_CATEGORIES)

REQUIRED = ('id', 'name', 'cat', 'catLabel', 'merchant', 'merchantSlug', 'url', 'img')

GRID = r'<div class="product-grad-wrap w-dyn-items"[^>]*>'
SLIDER = r'<div class="swiper-wrapper w-dyn-items"[^>]*>'
RADIOS = r'<div class="collection-list w-dyn-items"[^>]*>'


class BuildError(Exception):
    pass


# ------------------------------------------------------------ reading data
# Half of a surrogate pair: half an emoji, e.g. "\ud83d" in a data file. No
# UTF-8 page can hold one, so it becomes U+FFFD -- the replacement character
# a browser shows for it anyway.
LONE_SURROGATE = re.compile('[\ud800-\udfff]')
TRAILING_COMMA = re.compile(r'\s*[\]}]')


def _well_formed(value, fixed):
    if isinstance(value, str):
        clean, n = LONE_SURROGATE.subn('�', value)
        fixed[0] += n
        return clean
    if isinstance(value, list):
        return [_well_formed(v, fixed) for v in value]
    if isinstance(value, dict):
        return dict((_well_formed(k, fixed), _well_formed(v, fixed)) for k, v in value.items())
    return value


def extract_array(source, name, path, quiet=False):
    """`window.NAME = [...]` as JSON. A string-aware scan, never a regex over
    the whole file: blogs.js holds two lists, article HTML is full of brackets,
    and any text may contain "/*", "*/" or ", ]" -- stripping those blindly
    deletes real entries. /* comments */ between entries and trailing commas
    are allowed, as the browser allows them. Same scan as extractArray() in
    functions/_shared/js-data.js."""
    at = re.search(r'^[ \t]*window\.%s\s*=\s*\[' % re.escape(name), source, re.M)
    if not at:
        raise BuildError('%s: window.%s = [ ... ] not found' % (path, name))
    start = at.end() - 1

    out, depth, in_str, esc, i, closed = [], 0, False, False, start, False
    while i < len(source):
        c = source[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '/' and source[i + 1:i + 2] == '*':             # skip a comment
            close = source.find('*/', i + 2)
            if close < 0:
                break
            i = close + 2
            continue
        if c == '"':
            in_str = True
        elif c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
        out.append(c)
        i += 1
        if depth == 0:
            closed = True
            break
    if not closed:
        raise BuildError('%s: window.%s is never closed' % (path, name))

    # drop trailing commas (legal JS, not JSON) -- outside strings only
    body, cleaned, in_str, esc = ''.join(out), [], False, False
    for j, c in enumerate(body):
        if in_str:
            cleaned.append(c)
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
            cleaned.append(c)
        elif c == ',' and TRAILING_COMMA.match(body, j + 1):
            pass
        else:
            cleaned.append(c)
    try:
        data = json.loads(''.join(cleaned))
    except ValueError as exc:
        raise BuildError('%s: could not parse window.%s (%s).\n'
                         '    Usually a missing comma between entries, or a " inside a value\n'
                         '    that needs to be written as \\".' % (path, name, exc))
    if not isinstance(data, list):
        raise BuildError('%s: window.%s is not a list' % (path, name))
    fixed = [0]
    data = _well_formed(data, fixed)
    if fixed[0] and not quiet:
        print('warning: %s: %d broken character(s) (half of an emoji?) in window.%s '
              'are shown as a replacement character' % (path, fixed[0], name))
    return data


# Copies of the product images kept on the site (fetch_images.py writes it).
LOCAL_IMAGES = os.path.join('js', 'local-images.js')


def read_local_images(root):
    """original image address -> its copy on this site, from
    js/local-images.js ({} when there is none yet). Shared with
    fetch_images.py, which writes the file."""
    path = os.path.join(root, LOCAL_IMAGES)
    if not os.path.isfile(path):
        return {}
    m = re.search(r'window\.LOCAL_IMAGES\s*=\s*(\{.*?\})\s*;',
                  open(path, encoding='utf-8').read(), re.S)
    if not m:
        raise BuildError('%s: window.LOCAL_IMAGES = { ... }; not found' % path)
    return json.loads(m.group(1))


def with_local_images(products, local):
    """The products as the pages should show them: each image from its copy
    on this site when there is one, else from its own address -- and always
    from its own address when the product says imgFrom: "retailer"."""
    out = []
    for p in products:
        img = str(p.get('img') or '').strip()
        keep = p.get('imgFrom') == 'retailer'
        out.append(dict(p, img=local[img]) if img in local and not keep else p)
    return out


def absolute(src):
    """A full address, as structured data needs: copies are site paths."""
    return src if re.match(r'^https?://', src, re.I) else SITE + '/' + src.lstrip('/')


def load_products(path, quiet=False):
    """The list in a products.js file (`window.PRODUCTS = [...]`)."""
    if not os.path.isfile(path):
        raise BuildError('catalog not found: %s' % path)
    return extract_array(open(path, encoding='utf-8').read(), 'PRODUCTS', path, quiet)


def load_categories(source, products, path, quiet=False):
    """Every category, in menu order, as [(id, label), ...]: the file's own
    window.PRODUCT_CATEGORIES (written by the editor once a category has been
    added there), any built-in one it lacks, then any category a product
    names that neither has, labelled from that product -- the same rule as
    categoryList() in functions/api/catalog.js, so a hand edit in git that
    forgets the list still gets a filter and a page."""
    out, seen = [], set()

    def add(cid, label):
        cid = cid.strip() if isinstance(cid, str) else ''
        label = label.strip() if isinstance(label, str) else ''
        if cid and label and re.match(r'^[a-z0-9][a-z0-9-]*$', cid) and cid not in seen:
            seen.add(cid)
            out.append((cid, label))

    if re.search(r'^[ \t]*window\.PRODUCT_CATEGORIES\s*=', source, re.M):
        for c in extract_array(source, 'PRODUCT_CATEGORIES', path, quiet):
            if isinstance(c, dict):
                add(c.get('id'), c.get('label'))
    for cid, label in SITE_CATEGORIES:
        add(cid, label)
    for p in products:
        if isinstance(p, dict):
            add(p.get('cat'), p.get('catLabel'))
    return out


def validate(products, categories=None, strict_categories=True):
    """Return (errors, warnings). Errors stop the build; warnings do not.
    With strict_categories=False (the list is js/categories.js) a product in a
    category the list lacks is only a warning: the editor refuses that on
    Save, and one stray hand edit must not stop every page being rebuilt."""
    category_label = dict(categories) if categories else CATEGORY_LABEL
    errors, warnings = [], []
    if not products:
        warnings.append('the catalog is empty -- both pages will be built with no products')

    seen = {}
    for n, p in enumerate(products, 1):
        where = 'product #%d' % n
        if not isinstance(p, dict):
            errors.append('%s: not an object' % where)
            continue
        if p.get('id'):
            where = 'product #%d (%s)' % (n, p['id'])

        for field in REQUIRED:
            if not p.get(field):
                errors.append('%s: missing "%s"' % (where, field))
            elif not isinstance(p[field], str):
                errors.append('%s: "%s" must be text' % (where, field))
        for field in ('desc', 'note'):
            if field in p and not isinstance(p[field], str):
                errors.append('%s: "%s" must be text' % (where, field))

        pid = p.get('id')
        if pid:
            if pid in seen:
                errors.append('%s: duplicate id -- also used by product #%d' % (where, seen[pid]))
            seen[pid] = n
            if not re.match(r'^[a-z0-9][a-z0-9-]*$', str(pid)):
                warnings.append('%s: id should be lowercase letters, numbers and dashes' % where)

        if p.get('imgFrom') not in (None, '', 'site', 'retailer'):
            warnings.append('%s: imgFrom "%s" is not "site" or "retailer" -- treated as "site"'
                            % (where, p.get('imgFrom')))

        cat = p.get('cat')
        if cat and cat not in category_label:
            (errors if strict_categories else warnings).append(
                '%s: unknown category "%s".\n    Valid: %s'
                % (where, cat, ', '.join(category_label)))
        elif cat and p.get('catLabel') and p['catLabel'] != category_label[cat]:
            warnings.append('%s: catLabel "%s" does not match "%s" for cat "%s"'
                            % (where, p['catLabel'], category_label[cat], cat))

        if 'price' in p:
            if isinstance(p['price'], bool) or not isinstance(p['price'], (int, float)):
                errors.append('%s: price must be a number with no quotes or $ (got %r)'
                              % (where, p['price']))
            elif p['price'] < 0:
                errors.append('%s: price cannot be negative' % where)

        for field in ('url', 'img'):
            v = p.get(field)
            if v and not str(v).startswith(('http://', 'https://', 'images/')):
                warnings.append('%s: %s does not look like a full URL' % (where, field))

        slug = p.get('merchantSlug')
        if slug and not re.match(r'^[a-z0-9][a-z0-9-]*$', str(slug)):
            errors.append('%s: merchantSlug must be lowercase letters, numbers and dashes '
                          '(it becomes merchant.html?id=%s)' % (where, slug))
    return errors, warnings


# ------------------------------------------------------------------- helpers
def e(s):
    """Escape for an HTML attribute or text node."""
    return html.escape(str(s), quote=True)


def money(p):
    return '${:,.2f}'.format(p)


def search_blob(p):
    bits = [p['name'], p['merchant'], p['catLabel']]
    if 'price' in p:
        bits.append(money(p['price']))
    return ' '.join(bits).lower()


def data_attrs(p):
    """Attributes js/catalog.js reads for search, filtering, sorting and clicks."""
    attrs = [
        'data-cats="%s"' % e(p['cat']),
        'data-href="product.html?id=%s"' % e(p['id']),
        'data-name="%s"' % e(p['name']),
    ]
    if 'price' in p:
        attrs.append('data-price="%s"' % e('{:.2f}'.format(p['price'])))
    attrs.append('data-search="%s"' % e(search_blob(p)))
    return ' '.join(attrs)


def price_block(p):
    """Products with no price (brand and landing pages) get no price line at
    all, rather than an invented one. Prices are hidden site-wide anyway while
    SHOW_PRICES is false in js/site-config.js -- this only decides the markup."""
    if 'price' not in p:
        return ''
    return ('<div class="product-price-wrap">'
            '<h4 class="heading-style-five font-second text-color-green" fs-list-field="price">'
            '%s</h4></div>' % e(money(p['price'])))


def grid_card(p):
    """A card in the store.html / category / merchant grid."""
    return (
        '<div class="w-dyn-item" {attrs} role="listitem">'
        '<div class="product-card-wrap">'
        '<div class="product-img-wrap">'
        '<img alt="{name}" class="full-img" loading="lazy" src="{img}"/>'
        '</div>'
        '<div class="product-cn-wrap">'
        '<div class="review-main-wrap"><div class="offer-text-wrap">{merchant}</div></div>'
        '<h2 class="text-size-medium font-second text-weight-normal text-style-2lines"'
        ' fs-list-field="name">{name}</h2>'
        '{price}'
        '<a class="dark-btn-wrap w-inline-block" href="product.html?id={pid}">'
        '<div class="dark-btn-text">View product</div>'
        '</a>'
        '</div></div></div>'
    ).format(attrs=data_attrs(p), name=e(p['name']), img=e(p['img']),
             merchant=e(p['merchant']), price=price_block(p), pid=e(p['id']))


def slide_card(p):
    """A slide in the home page "See what actually works" rail."""
    return (
        '<div class="swiper-slide w-dyn-item" {attrs} role="listitem">'
        '<div class="prodact-slider-cn-wrap">'
        '<div class="product-img-wrap">'
        '<img alt="{name}" class="full-img" loading="lazy" src="{img}"/>'
        '</div>'
        '<div class="prodact-slider-cn">'
        '<div class="review-main-wrap"><div class="offer-text-wrap">{merchant}</div></div>'
        '<h3 class="text-size-medium font-second text-weight-normal text-style-2lines">{name}</h3>'
        '{price}'
        '<a class="pr-btn-wrap w-variant-fc58d251-c396-31a8-d55a-a5f36995ac5d w-inline-block"'
        ' data-wf--pr-btn-wrap--variant="three" href="product.html?id={pid}">'
        '<div class="pr-btn-text">View product</div>'
        '</a>'
        '</div></div></div>'
    ).format(attrs=data_attrs(p), name=e(p['name']), img=e(p['img']),
             merchant=e(p['merchant']), price=price_block(p), pid=e(p['id']))


def category_radios(products, categories=None):
    """Only offer a filter for categories that actually have products."""
    present = [(slug, label) for slug, label in (categories or SITE_CATEGORIES)
               if any(p.get('cat') == slug for p in products)]
    out = []
    for i, (slug, label) in enumerate(present):
        out.append(
            '<div class="w-dyn-item" role="listitem">'
            '<label class="radio-filter w-radio">'
            '<input class="w-form-formradioinput hide w-radio-input" data-name="demo"'
            ' fs-list-field="demo" fs-list-value="" id="radio-cat-%d" name="demo"'
            ' type="radio" value="%s"/>'
            '<span class="w-form-label" for="radio">%s</span>'
            '</label></div>' % (i, e(slug), e(label)))
    return ''.join(out)


# ------------------------------------------------------------- html surgery
def replace_inner(doc, open_tag_re, new_inner, label):
    """Swap the contents of the first <div> whose opening tag matches, keeping
    the tag itself, by walking nested divs to find its true closing tag."""
    m = re.search(open_tag_re, doc)
    if not m:
        raise BuildError('%s: could not find the container %s.\n'
                         '    The page markup changed -- this script needs that div to exist.'
                         % (label, open_tag_re))
    depth, i = 1, m.end()
    tag = re.compile(r'<(/?)div\b', re.I)
    while depth:
        t = tag.search(doc, i)
        if not t:
            raise BuildError('%s: unbalanced <div> tags after the container' % label)
        depth += -1 if t.group(1) else 1
        i = t.end()
    close_start = doc.rfind('<', 0, i)
    return doc[:m.end()] + new_inner + doc[close_start:]


def set_empty_state(doc, is_empty, container_re=GRID):
    """Webflow's "No items found." block is hidden by default; show it only
    when the listing genuinely has nothing in it.

    Anchored to the listing container on purpose: several of these blocks exist
    on every page (the mega-menu and footer collections have their own), and the
    product grid's is not the first one in the document.
    """
    anchor = re.search(container_re, doc)
    if not anchor:
        return doc
    pattern = re.compile(r'<div class="(?:empty-state )?w-dyn-empty(?: w-dyn-hide)?">')
    m = pattern.search(doc, anchor.end())
    if not m:
        return doc
    keep = 'empty-state ' if 'empty-state' in m.group(0) else ''
    if is_empty:
        repl = '<div class="%sw-dyn-empty">' % keep
    else:
        repl = '<div class="%sw-dyn-empty w-dyn-hide">' % keep
    return doc[:m.start()] + repl + doc[m.end():]


SITE = 'https://mycampuskorner.com'


def prices_shown(root):
    """SHOW_PRICES in js/site-config.js. Structured data may only state what
    the page shows, so prices go into it only when the site displays them."""
    try:
        src = open(os.path.join(root, 'js', 'site-config.js'), encoding='utf-8').read()
    except OSError:
        return False
    return re.search(r'var\s+SHOW_PRICES\s*=\s*true\b', src) is not None


def list_elements(products, show_prices=False):
    """The listing as schema.org ListItems. With prices hidden each entry is
    just the product page (full URL) and its name -- a Product without a price
    would be reported as incomplete, and a hidden price must not be stated."""
    out = []
    for i, p in enumerate(products):
        url = SITE + '/product?id=' + p['id']
        if show_prices and 'price' in p:
            item = {'@type': 'Product', 'name': p['name'], 'image': absolute(p['img']),
                    'category': p['catLabel'], 'url': url,
                    'offers': {'@type': 'Offer', 'price': str(p['price']),
                               'priceCurrency': 'USD',
                               'seller': {'@type': 'Organization', 'name': p['merchant']}}}
            out.append({'@type': 'ListItem', 'position': i + 1, 'item': item})
        else:
            out.append({'@type': 'ListItem', 'position': i + 1, 'url': url, 'name': p['name']})
    return out


def find_itemlist(node):
    """The ItemList is nested inside a WebPage/CollectionPage wrapper carrying
    the page's own name, description and url. Only the list is ours to rewrite;
    the wrapper must survive untouched."""
    if isinstance(node, dict):
        if node.get('@type') == 'ItemList':
            return node
        for v in node.values():
            found = find_itemlist(v)
            if found is not None:
                return found
    elif isinstance(node, list):
        for v in node:
            found = find_itemlist(v)
            if found is not None:
                return found
    return None


def replace_itemlist_ld(doc, products, label, show_prices=False):
    """Rewrite just the itemListElement of the page's ItemList, in place."""
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', doc, re.S):
        raw = m.group(1)
        if '"ItemList"' not in raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise BuildError('%s: the JSON-LD block is not valid JSON (%s)' % (label, exc))
        lst = find_itemlist(data)
        if lst is None:
            continue
        lst['itemListElement'] = list_elements(products, show_prices)
        lst['numberOfItems'] = len(products)
        # "<" escaped, so no value can close the <script> it sits in.
        return doc[:m.start(1)] + json.dumps(data, ensure_ascii=False).replace('<', '\\u003c') + doc[m.end(1):]
    return doc


# --------------------------------------------------------------------- pages
def encode_pages(built):
    """Every built page as UTF-8 bytes, before any file is touched: a page that
    cannot be encoded stops the build with every file as it was."""
    out = []
    for name, n, path, doc in built:
        try:
            out.append((name, n, path, doc.encode('utf-8')))
        except UnicodeEncodeError as exc:
            raise BuildError('%s: could not be written as UTF-8 (%s)' % (name, exc.reason))
    return out


def write_if_changed(path, data, check):
    """Write bytes (from encode_pages) only if they differ. Through a temporary
    file and a rename, so the page is either the old one or the new one --
    never half-written, or empty."""
    if os.path.isfile(path):
        with open(path, 'rb') as f:
            if f.read() == data:
                return 'unchanged'
    if check:
        return 'would change'
    tmp = path + '.tmp'
    try:
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return 'updated'


# --------------------------------------------------------------- categories
# js/categories.js (the admin's Categories tab) is THE category list. This
# script bakes it into the pages: the category cards on the home page and the
# "N core campus tracks" sentence above them, the category links in every
# page's header menu and footer, and the Store's filters. A category set to
# "Shown" is featured: it has a home page card and a place in the menus. A
# "Hidden" one keeps its own page and its Store filter only.
CATEGORY_FILE = os.path.join('js', 'categories.js')
ACCORDION = r'<div class="accordion">'
MEGA_MENU = r'<div class="mega-menu-column w-dyn-items" role="list">'
FOOTER_CATS = r'<div class="footer-link-list w-dyn-items" role="list">'
COUNT_WORDS = ('no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
               'ten', 'eleven', 'twelve')


def load_category_list(root, quiet=False):
    """The categories in js/categories.js as dicts, in order -- or None when
    the file does not exist (the older list then applies)."""
    path = os.path.join(root, CATEGORY_FILE)
    if not os.path.isfile(path):
        return None
    out, seen = [], set()
    for c in extract_array(open(path, encoding='utf-8').read(), 'CATEGORIES', path, quiet):
        if not isinstance(c, dict):
            continue
        cid = c.get('id').strip() if isinstance(c.get('id'), str) else ''
        name = c.get('name').strip() if isinstance(c.get('name'), str) else ''
        if cid and name and re.match(r'^[a-z0-9][a-z0-9-]*$', cid) and cid not in seen:
            seen.add(cid)
            out.append(dict(c, id=cid, name=name))
    return out


def image_width(path):
    """Width in pixels from the file's own header (AVIF, PNG, JPEG, WebP,
    GIF), or None. No image library needed."""
    try:
        with open(path, 'rb') as f:
            data = f.read(1 << 16)
    except OSError:
        return None
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return int.from_bytes(data[16:20], 'big')
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return int.from_bytes(data[6:8], 'little')
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        kind = data[12:16]
        if kind == b'VP8X':
            return 1 + int.from_bytes(data[24:27], 'little')
        if kind == b'VP8 ':
            return int.from_bytes(data[26:28], 'little') & 0x3fff
        if kind == b'VP8L':
            return (int.from_bytes(data[21:25], 'little') & 0x3fff) + 1
        return None
    if data[4:12] in (b'ftypavif', b'ftypavis'):
        i = data.find(b'ispe')                      # the image's spatial extents
        return int.from_bytes(data[i + 8:i + 12], 'big') if i > 0 else None
    if data[:3] == b'\xff\xd8\xff':
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xff:
                i += 1
                continue
            mark = data[i + 1]
            if 0xc0 <= mark <= 0xcf and mark not in (0xc4, 0xc8, 0xcc):
                return int.from_bytes(data[i + 7:i + 9], 'big')
            i += 2 + int.from_bytes(data[i + 2:i + 4], 'big')
    return None


def card_srcset(root, img):
    """srcset for a card picture saved the Webflow way -- images/NAME_1NAME.ext
    with NAME_1-p-500/-800/-1080 beside it -- else '' (just the one file)."""
    m = re.match(r'^images/(.+?)_1\1\.(avif|webp|jpe?g|png)$', img)
    if not m:
        return ''
    base, ext = m.group(1), m.group(2)
    parts = []
    for w in (500, 800, 1080):
        rel = 'images/%s_1-p-%d.%s' % (base, w, ext)
        if os.path.isfile(os.path.join(root, rel)):
            parts.append('%s %dw' % (rel, w))
    full = image_width(os.path.join(root, img))
    if not parts or not full:
        return ''
    return ', '.join(parts + ['%s %dw' % (img, full)])


def category_card(root, n, c, local):
    """One card in the home page's category accordion -- the same markup the
    designed cards have."""
    img = str(c.get('img') or '').strip()
    src = local.get(img, img)
    srcset = card_srcset(root, src)
    return (
        '<div class="accordion-item">\n'
        '<div class="accordion-bg-image"><img alt="{alt}" class="max-width-full" loading="lazy" '
        'sizes="100vw" src="{src}"{srcset}/></div>\n'
        '<div class="accordion-overlay"></div>\n'
        '<div class="accordion-number">\n'
        '<div class="heading-style-three text-color-white op-50">{n:02d}</div>\n'
        '</div>\n'
        '<div class="accordion-label">\n'
        '<div class="heading-style-three text-color-white">{name}</div>\n'
        '</div>\n'
        '<div class="accordion-content">\n'
        '<div class="accordion-header">\n'
        '<div class="accordion-title">\n'
        '<div class="heading-style-two text-color-white">{name}</div>\n'
        '</div>\n'
        '<div class="accordion-index">\n'
        '<div class="heading-style-three text-color-white op-50">{n:02d}</div>\n'
        '</div>\n'
        '</div>\n'
        '<div class="accordion-footer">\n'
        '<div class="accordion-text">\n'
        '<p class="text-size-medium text-color-of-white">{text}</p>\n'
        '</div>\n'
        '<div class="accordion-button">\n'
        '<a class="pr-btn-wrap w-variant-0db183cc-d48a-dba3-2a04-f24898eccb6a w-inline-block" '
        'data-wf--pr-btn-wrap--variant="second" href="category.html?id={id}">\n'
        '<div class="pr-btn-text">{button}</div>\n'
        '</a>\n'
        '</div>\n'
        '</div>\n'
        '</div>\n'
        '</div>'
    ).format(alt=e(c.get('alt') or c['name']), src=e(src),
             srcset=' srcset="%s"' % e(srcset) if srcset else '', n=n, name=e(c['name']),
             text=e(' '.join(str(c.get('text') or '').split())), id=e(c['id']),
             button=e(c.get('button') or 'Shop ' + c['name']))


def home_categories(cat_list):
    """The featured categories ("Shown"), in list order: a home page card each
    (the first MAX_CARDS) and a place in the header menu and footer."""
    return [c for c in cat_list if c.get('home') != 'hidden']


# The home page row of cards stays readable up to this many (the open card
# keeps its width and the closed ones slim down); more Shown categories still
# get their menu links, page and Store filter, and the Categories tab says so.
MAX_CARDS = 12


def menu_categories(cat_list):
    return [(c['id'], c['name']) for c in home_categories(cat_list)]


def bake_category_cards(doc, root, cat_list, local, label):
    """The home page's category cards, and the count in the sentence above."""
    cards = home_categories(cat_list)[:MAX_CARDS]
    if re.search(ACCORDION, doc):
        doc = replace_inner(doc, ACCORDION, '\n' + '\n'.join(
            category_card(root, n, c, local) for n, c in enumerate(cards, 1)) + '\n',
            label + ' category cards')
    word = COUNT_WORDS[len(cards)] if len(cards) < len(COUNT_WORDS) else str(len(cards))
    track = ' core campus track' if len(cards) == 1 else ' core campus tracks'
    return re.sub(r'(into )\w+ core campus tracks?\b', lambda m: m.group(1) + word + track, doc)


# ------------------------------------------------------------------- footer
# One footer for every page, written in by this script: edit it here, never in
# a page (the next build would put this back). The category links and the
# social icons are filled into its slots by bake_category_menus() and
# bake_social(), as everywhere else. {P} is how the page links to the site
# root: "" for every page, "/" for 404.html, which is shown at any address.
FOOTER_TEMPLATE = """<footer class="footer mck-footer">
<div class="padding-global">
<div class="container-large">
<div class="mck-footer-grid">
<div class="mck-footer-brand">
<a aria-label="MyCampusKorner home" class="mck-footer-logo" href="{P}index.html"><img alt="MyCampusKorner" height="32" loading="lazy" src="{P}images/mycampuskorner-logo.avif" width="245"/></a>
<p class="mck-footer-about">Hand-picked college essentials and honest campus advice, built by a college parent in Ann Arbor, Michigan.</p>
<div class="social-media-main-wrap">
<div class="eyebrow">Follow us</div>
<div class="social-media-link-wrap" data-social-links=""></div>
</div>
</div>
<nav aria-label="Shop by category" class="mck-footer-col">
<h2 class="mck-footer-title">Shop</h2>
<div class="w-dyn-list">
<div class="footer-link-list w-dyn-items" role="list">{CATS}</div>
</div>
<a class="mck-footer-link mck-footer-more" href="{P}store.html">All products</a>
</nav>
<nav aria-label="Company" class="mck-footer-col">
<h2 class="mck-footer-title">Company</h2>
<a class="mck-footer-link" href="{P}about.html">About us</a>
<a class="mck-footer-link" href="{P}blog.html">Blog</a>
<a class="mck-footer-link" href="{P}contact-us.html">Contact</a>
<a class="mck-footer-link" href="{P}contact-us.html?reason=partner">Become a partner</a>
</nav>
<nav aria-label="Help and legal" class="mck-footer-col">
<h2 class="mck-footer-title">Help</h2>
<a class="mck-footer-link" href="mailto:support@mycampuskorner.com">support@mycampuskorner.com</a>
<a class="mck-footer-link" href="{P}privacy-policy.html">Privacy policy</a>
<a class="mck-footer-link" href="{P}terms.html">Terms of service</a>
<a class="mck-footer-link" href="{P}privacy-policy.html#affiliate-disclosure">Affiliate disclosure</a>
</nav>
</div>
<div class="mck-footer-bottom">
<p>© {YEAR} MyCampusKorner. All rights reserved.</p>
<p class="mck-footer-disclosure">Some links on this site are affiliate links: if you buy through them, we may earn a commission at no extra cost to you.</p>
</div>
</div>
</div>
</footer>"""
FOOTER_RE = re.compile(r'<footer\b[^>]*>.*?</footer>', re.S)


def category_items(cats, cls, prefix):
    """The category links of the header menu (cls mega-menu_link-wrapper) or
    the footer (cls footer-link), in the markup both lists use."""
    return ''.join(
        '<div class="w-dyn-item" role="listitem">\n<a class="%s" href="%scategory.html?id=%s">\n'
        '<div class="">%s</div>\n</a>\n</div>' % (cls, e(prefix), e(cid), e(name))
        for cid, name in cats)


def bake_footer(doc, cats, label):
    """The page's footer, from FOOTER_TEMPLATE. The link to the page itself is
    marked as the current one."""
    if not FOOTER_RE.search(doc):
        return doc
    prefix = '/' if label.startswith('404') else ''
    html_ = (FOOTER_TEMPLATE.replace('{P}', prefix).replace('{YEAR}', str(time.localtime().tm_year))
             .replace('{CATS}', '\n\n' + category_items(cats, 'footer-link w-inline-block', prefix)))
    own = 'href="%s%s"' % (prefix, label)
    html_ = html_.replace('class="mck-footer-link" ' + own, 'aria-current="page" class="mck-footer-link" ' + own)
    return FOOTER_RE.sub(lambda m: html_, doc, count=1)


def bake_category_menus(doc, cats, label):
    """The category links in the header menu and the footer: the featured
    categories, cats = menu_categories(...), in order. Each page keeps its own
    link style (the 404 page links from the site root)."""
    doc = bake_footer(doc, cats, label)
    for container, cls in ((MEGA_MENU, 'mega-menu_link-wrapper w-inline-block'),
                           (FOOTER_CATS, 'footer-link w-inline-block')):
        m = re.search(container, doc)
        if not m:
            continue
        first = re.search(r'href="([^"]*?)category\.html\?id=', doc[m.end():m.end() + 1000])
        prefix = first.group(1) if first else ('/' if label.startswith('404') else '')
        doc = replace_inner(doc, container, '\n\n' + category_items(cats, cls, prefix), label + ' category links')
    return doc


def build_other_pages(root, cats, done):
    """Every other page in the site folder: only its category links."""
    out = []
    for path in sorted(glob.glob(os.path.join(root, '*.html'))):
        name = os.path.basename(path)
        if name not in done:
            doc = open(path, encoding='utf-8', newline='').read()
            out.append((name, None, path, bake_category_menus(doc, cats, name)))
    return out


# ------------------------------------------------------------- social links
# SOCIAL_LINKS in js/site-config.js is the one list of the brand's profiles.
# The script there draws the footer icons in the browser; this writes the same
# markup into the pages, so crawlers that run no script (most AI crawlers) see
# the links too, together with labelled buttons and the structured data.
SITE_CONFIG = os.path.join('js', 'site-config.js')
SOCIAL_SLOT = r'<div class="social-media-link-wrap" data-social-links="">'
SOCIAL_BUTTONS = r'<div class="social-pills" data-social-handles="">'
SOCIAL_BLOCK = re.compile(r'<div class="social-media-main-wrap"( hidden="")?>(\s*<div class="eyebrow">Follow us</div>)')


def read_social(root):
    """([(key, label, url, svg path), ...] in the file's order, or [])."""
    path = os.path.join(root, SITE_CONFIG)
    if not os.path.isfile(path):
        return []
    src = open(path, encoding='utf-8').read()
    block = re.search(r'var\s+SOCIAL_LINKS\s*=\s*\{(.*?)\};', src, re.S)
    icons = dict((k, (label, d)) for k, label, d in
                 re.findall(r"^\s*(\w+):\s*\{\s*label:\s*'([^']+)',\s*d:\s*'([^']+)'\s*\}", src, re.M))
    out = []
    for key, url in re.findall(r"^\s*(\w+):\s*'([^']*)'", block.group(1), re.M) if block else []:
        url = url.strip()
        if url.startswith('https://') and key in icons:
            out.append((key, icons[key][0], url, icons[key][1]))
    return out


def social_handle(key, url):
    """What the profile is called: @name where the address has one."""
    parts = [p for p in re.sub(r'^https://[^/]+/', '', url).split('?')[0].split('/') if p]
    if not parts:
        return 'MyCampusKorner'
    if parts[0].startswith('@'):
        return parts[0]
    if key == 'facebook':
        if parts[0] == 'people' and len(parts) > 1:
            return parts[1].replace('-', ' ')
        return 'MyCampusKorner' if parts[0].isdigit() or parts[0] == 'profile.php' else parts[0]
    return '@' + parts[0]


def social_icons(links):
    """The footer icons: exactly what drawSocial() in js/site-config.js draws."""
    return ''.join(
        '<a class="social-media-link w-inline-block" href="%s" target="_blank" rel="noopener me"'
        ' aria-label="MyCampusKorner on %s" title="%s">'
        '<svg aria-hidden="true" focusable="false" width="100%%" height="100%%" viewBox="0 0 50 50" fill="none">'
        '<circle cx="25" cy="25" r="24.5" stroke="currentColor"/>'
        '<g transform="translate(16 16) scale(.75)"><path fill="currentColor" d="%s"/></g>'
        '</svg></a>' % (url.replace('"', '&quot;'), label, label, d)
        for key, label, url, d in links)


def social_buttons(links):
    """Labelled buttons: the network and the handle, as text."""
    return ''.join(
        '\n<a class="social-pill" href="%s" target="_blank" rel="noopener me" title="MyCampusKorner on %s">'
        '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="currentColor" d="%s"/></svg>'
        '<span class="social-pill-text"><span class="social-pill-name">%s</span>'
        '<span class="social-pill-handle">%s</span></span></a>'
        % (e(url), e(label), d, e(label), e(social_handle(key, url)))
        for key, label, url, d in links) + ('\n' if links else '')


def bake_social(doc, links, label):
    """Footer icons, labelled buttons and the "Follow us" block's visibility."""
    if re.search(SOCIAL_SLOT, doc):
        doc = replace_inner(doc, SOCIAL_SLOT, social_icons(links), label + ' social icons')
        doc = SOCIAL_BLOCK.sub(lambda m: '<div class="social-media-main-wrap"%s>%s'
                               % ('' if links else ' hidden=""', m.group(2)), doc)
    pos = 0                                       # every slot on the page, in turn
    while True:
        m = re.compile(SOCIAL_BUTTONS).search(doc, pos)
        if not m:
            return doc
        doc = doc[:m.start()] + replace_inner(doc[m.start():], SOCIAL_BUTTONS, social_buttons(links),
                                              label + ' social buttons')
        pos = m.end()


ORG_ID = SITE + '/#organization'


def bake_org_profiles(doc, links, label):
    """Every Organization in the page's structured data: one @id across pages,
    and sameAs = the brand's profiles (how search engines and AI assistants
    tie the accounts to the site)."""
    def visit(node):
        hit = False
        if isinstance(node, dict):
            if node.get('@type') == 'Organization' and node.get('name') == 'MyCampusKorner':
                node['@id'] = ORG_ID
                if links:
                    node['sameAs'] = [url for _, _, url, _ in links]
                else:
                    node.pop('sameAs', None)
                hit = True
            for v in list(node.values()):
                hit = visit(v) or hit
        elif isinstance(node, list):
            for v in node:
                hit = visit(v) or hit
        return hit
    out, last = [], 0
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', doc, re.S):
        raw = m.group(1)
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        if not visit(data):
            continue
        if '\n' in raw.strip():
            new = '\n' + json.dumps(data, indent=2, ensure_ascii=False).replace('<', '\\u003c') + '\n'
        else:
            new = json.dumps(data, ensure_ascii=False).replace('<', '\\u003c')
        out.append(doc[last:m.start(1)] + new)
        last = m.end(1)
    return ''.join(out) + doc[last:] if out else doc


# Every page is built in memory first and written only when all succeeded,
# so a problem in one never leaves the others half-updated.
def build_store(root, products, show_prices=False, categories=None, menus=None):
    path = os.path.join(root, 'store.html')
    doc = open(path, encoding='utf-8', newline='').read()
    if menus is not None:
        doc = bake_category_menus(doc, menus, 'store.html')
    doc = replace_inner(doc, GRID, ''.join(grid_card(p) for p in products), 'store.html grid')
    doc = replace_inner(doc, RADIOS, category_radios(products, categories),
                        'store.html category filter')
    doc = replace_itemlist_ld(doc, products, 'store.html', show_prices)
    doc = set_empty_state(doc, not products)
    return 'store.html', len(products), path, doc


def build_index(root, products, show_prices=False, cat_list=None, local=None):
    path = os.path.join(root, 'index.html')
    doc = open(path, encoding='utf-8', newline='').read()
    if cat_list is not None:
        doc = bake_category_cards(doc, root, cat_list, local or {}, 'index.html')
        doc = bake_category_menus(doc, menu_categories(cat_list), 'index.html')
    featured = products[:FEATURED]
    doc = replace_inner(doc, SLIDER, ''.join(slide_card(p) for p in featured),
                        'index.html featured rail')
    doc = replace_itemlist_ld(doc, featured, 'index.html', show_prices)
    return 'index.html', len(featured), path, doc


# ------------------------------------------------------- consistency safety
#
# store.html and index.html are baked from a catalog, but product.html,
# category.html and merchant.html read js/products.js live in the browser.
# If those two ever describe different products, every baked card links to a
# product page that answers "Product not found". That must never ship, so it
# is checked after every build rather than left to be noticed on the site.

def baked_ids(root):
    """Product ids currently written into the two baked pages."""
    ids = set()
    for name in ('store.html', 'index.html'):
        doc = open(os.path.join(root, name), encoding='utf-8', newline='').read()
        ids |= set(re.findall(r'data-href="product\.html\?id=([^"]+)"', doc))
    return ids


def runtime_ids(root):
    """Product ids the browser will actually find at runtime."""
    try:
        return set(p.get('id') for p in load_products(os.path.join(root, 'js', 'products.js'), quiet=True)
                   if isinstance(p, dict))
    except BuildError:
        return None


def report_mismatch(root):
    """Return a list of baked ids missing from js/products.js."""
    live = runtime_ids(root)
    if live is None:
        return None
    return sorted(baked_ids(root) - live)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(
        description='Re-bake store.html and index.html from the product catalog.')
    ap.add_argument('--root', default=here,
                    help="site folder holding store.html and index.html "
                         "(default: this script's folder)")
    ap.add_argument('--products', default=None,
                    help='catalog to preview with --check, or to switch to with --install')
    ap.add_argument('--check', action='store_true',
                    help='report what would change and write nothing')
    ap.add_argument('--install', action='store_true',
                    help='make --products the live catalog (backs up the current one), then build')
    ap.add_argument('--restore', action='store_true',
                    help='put the backed-up catalog back and rebuild')
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    live = os.path.join(root, 'js', 'products.js')
    backup = os.path.join(root, 'js', 'products.backup.js')

    for needed in ('store.html', 'index.html'):
        if not os.path.isfile(os.path.join(root, needed)):
            print('error: %s not found in %s' % (needed, root))
            print('       run this from the site folder, or pass --root')
            return 1

    # ---- restore ---------------------------------------------------------
    if args.restore:
        if not os.path.isfile(backup):
            print('error: no backup found at js/products.backup.js')
            print('       there is nothing to restore.')
            return 1
        shutil.copy2(backup, live)
        os.remove(backup)
        print('restored js/products.js from the backup.\n')
        catalog = live
    # ---- install ---------------------------------------------------------
    elif args.install:
        if not args.products:
            print('error: --install needs --products FILE')
            return 1
        if not os.path.isfile(args.products):
            print('error: catalog not found: %s' % args.products)
            return 1
        if os.path.abspath(args.products) == os.path.abspath(live):
            print('note: --products already points at js/products.js, so there is')
            print('      nothing to install. Just run:  python build_listings.py\n')
        if os.path.abspath(args.products) != os.path.abspath(live):
            # Work out exactly what this swap does to the shop before doing it,
            # so the message says "added 10" rather than something alarming.
            try:
                before_ids = set(p.get('id') for p in load_products(live))
            except BuildError:
                before_ids = set()
            try:
                after_ids = set(p.get('id') for p in load_products(args.products))
            except BuildError as exc:
                print('error: %s' % exc)
                return 1
            added = sorted(after_ids - before_ids)
            dropped = sorted(before_ids - after_ids)
            kept = len(before_ids & after_ids)

            if not os.path.isfile(backup):
                shutil.copy2(live, backup)
                saved = 'saved as js/products.backup.js'
            else:
                saved = 'already saved as js/products.backup.js'
            shutil.copy2(args.products, live)

            print('=' * 68)
            print('  TEST CATALOG INSTALLED')
            print('=' * 68)
            print('  %s is now js/products.js.' % args.products)
            print()
            print('    kept    %3d of your products' % kept)
            print('    added   %3d new' % len(added))
            for pid in added[:6]:
                print('              + %s' % pid)
            if len(added) > 6:
                print('              + ... and %d more' % (len(added) - 6))
            if dropped:
                print('    DROPPED %3d of your products -- they will NOT show on the site:'
                      % len(dropped))
                for pid in dropped[:6]:
                    print('              - %s' % pid)
                if len(dropped) > 6:
                    print('              - ... and %d more' % (len(dropped) - 6))
            else:
                print('    dropped   0 -- every one of your products is still here')
            print()
            print('  Nothing is deleted: your catalog is %s.' % saved)
            print('  Undo with:  python build_listings.py --restore')
            print('=' * 68)
            print()
        catalog = live
    else:
        catalog = args.products or live
        # Building the static pages from one catalog while the rest of the site
        # reads another leaves every baked card pointing at a product page that
        # says "Product not found". Refuse rather than produce that.
        if not args.check and os.path.abspath(catalog) != os.path.abspath(live):
            print('error: refusing to build store.html and index.html from a catalog that is')
            print('       not the live one (js/products.js).')
            print()
            print('       product.html, category.html and merchant.html read js/products.js in')
            print('       the browser. Baking different products into the two static pages would')
            print('       make every card link to a "Product not found" page.')
            print()
            print('       To preview it safely:')
            print('           python build_listings.py --products %s --check' % args.products)
            print('       To actually switch the whole site to it:')
            print('           python build_listings.py --products %s --install' % args.products)
            print('       and afterwards:')
            print('           python build_listings.py --restore')
            return 1

    try:
        products = load_products(catalog)
        cat_list = load_category_list(root)
        if cat_list is None:
            categories = load_categories(open(catalog, encoding='utf-8').read(), products, catalog)
        else:
            categories = [(c['id'], c['name']) for c in cat_list]
            # Each product shows its category's current name, so a rename in
            # the Categories tab reaches every card without re-saving each one.
            names = dict(categories)
            products = [dict(p, catLabel=names[p['cat']])
                        if isinstance(p, dict) and p.get('cat') in names else p
                        for p in products]
    except BuildError as exc:
        print('error: %s' % exc)
        return 1

    errors, warnings = validate(products, categories, strict_categories=cat_list is None)
    for w in warnings:
        print('warning: %s' % w)
    if errors:
        print()
        for x in errors:
            print('error: %s' % x)
        print('\n%d problem(s) found -- nothing was written.' % len(errors))
        return 1

    print('catalog: %s' % catalog)
    print('         %d products, %d categories, %d merchants\n'
          % (len(products),
             len(set(p['cat'] for p in products)),
             len(set(p['merchantSlug'] for p in products))))

    try:
        show = prices_shown(root)
        # Cards show the copies fetch_images.py keeps on the site; validation
        # above, and the mismatch check below, see the catalog as saved.
        local = read_local_images(root)
        shown = with_local_images(products, local)
        if cat_list is None:
            built = encode_pages([build_store(root, shown, show, categories),
                                  build_index(root, shown, show)])
        else:
            # A product left in a category the list lacks still gets a filter.
            filters = list(categories)
            for p in shown:
                if p.get('cat') and p['cat'] not in dict(filters):
                    filters.append((p['cat'], p.get('catLabel') or p['cat']))
            menus = menu_categories(cat_list)
            social = read_social(root)
            pages = ([build_store(root, shown, show, filters, menus),
                      build_index(root, shown, show, cat_list, local)] +
                     build_other_pages(root, menus, ('store.html', 'index.html')))
            built = encode_pages([(name, n, path, bake_org_profiles(bake_social(doc, social, name), social, name))
                                  for name, n, path, doc in pages])
    except BuildError as exc:
        print('error: %s' % exc)
        print('\nnothing was written.')
        return 1
    rows = [(name, n, write_if_changed(path, doc, args.check)) for name, n, path, doc in built]

    for name, n, state in rows:
        if n is None:                              # a page with only category links
            if state != 'unchanged':
                print('  %-19s category links  %s' % (name, state))
            continue
        print('  %-14s %3d products   %s%s'
              % (name, n, state, '   (empty)' if n == 0 else ''))

    if not args.check and all(state == 'unchanged' for _, _, state in rows):
        print('\nNothing to do -- these pages already matched the catalog.')
        print('(The catalog editor re-bakes them when you press Save, so after')
        print(' saving there is usually nothing left for this command to write.)')

    if args.check:
        print('\n--check: no files were written.')
        return 0

    # Final safety net: the cards we just baked must exist in the catalog the
    # browser reads, or the product pages will 404 on every one of them.
    missing = report_mismatch(root)
    if missing is None:
        print('\nwarning: js/products.js could not be read, so the pages could not be'
              '\n         cross-checked against it.')
    elif missing:
        print('\nERROR: the site is now inconsistent.')
        print('  %d product(s) are shown on store.html / index.html but are missing from'
              % len(missing))
        print('  js/products.js, so their product pages will say "Product not found":')
        for pid in missing[:8]:
            print('     %s' % pid)
        if len(missing) > 8:
            print('     ... and %d more' % (len(missing) - 8))
        print('\n  Fix it with:  python build_listings.py --restore')
        print('  or rebuild from the live catalog:  python build_listings.py')
        return 1

    print('\ndone. store.html and index.html match js/products.js,'
          '\nwhich the product, category and merchant pages read directly.')

    # If a backup is sitting there, a test catalog is still live. Say so every
    # single time, so nobody mistakes a test shop for lost products.
    if os.path.isfile(backup):
        try:
            n = len(load_products(backup))
        except BuildError:
            n = '?'
        print()
        print('-' * 68)
        print('  NOTE: a TEST catalog is currently live. Your real catalog')
        print('  (%s products) is waiting in js/products.backup.js.' % n)
        print('  Bring it back with:  python build_listings.py --restore')
        print('-' * 68)
    return 0


if __name__ == '__main__':
    sys.exit(main())
