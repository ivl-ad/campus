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
import html
import json
import os
import re
import shutil
import sys

# how many products the home page rail shows
FEATURED = 8

# every category the site has a page for, in mega-menu order.
# Must stay in step with the CATEGORIES list in js/listing-page.js.
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


def load_products(path, quiet=False):
    """The list in a products.js file (`window.PRODUCTS = [...]`)."""
    if not os.path.isfile(path):
        raise BuildError('catalog not found: %s' % path)
    return extract_array(open(path, encoding='utf-8').read(), 'PRODUCTS', path, quiet)


def validate(products):
    """Return (errors, warnings). Errors stop the build; warnings do not."""
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

        cat = p.get('cat')
        if cat and cat not in CATEGORY_LABEL:
            errors.append('%s: unknown category "%s".\n    Valid: %s'
                          % (where, cat, ', '.join(CATEGORY_LABEL)))
        elif cat and p.get('catLabel') and p['catLabel'] != CATEGORY_LABEL[cat]:
            warnings.append('%s: catLabel "%s" does not match "%s" for cat "%s"'
                            % (where, p['catLabel'], CATEGORY_LABEL[cat], cat))

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


def category_radios(products):
    """Only offer a filter for categories that actually have products."""
    present = [(slug, label) for slug, label in SITE_CATEGORIES
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
            item = {'@type': 'Product', 'name': p['name'], 'image': p['img'],
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


# Both pages are built in memory first and written only when both succeeded,
# so a problem in one never leaves the other half-updated.
def build_store(root, products, show_prices=False):
    path = os.path.join(root, 'store.html')
    doc = open(path, encoding='utf-8', newline='').read()
    doc = replace_inner(doc, GRID, ''.join(grid_card(p) for p in products), 'store.html grid')
    doc = replace_inner(doc, RADIOS, category_radios(products), 'store.html category filter')
    doc = replace_itemlist_ld(doc, products, 'store.html', show_prices)
    doc = set_empty_state(doc, not products)
    return 'store.html', len(products), path, doc


def build_index(root, products, show_prices=False):
    path = os.path.join(root, 'index.html')
    doc = open(path, encoding='utf-8', newline='').read()
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
    except BuildError as exc:
        print('error: %s' % exc)
        return 1

    errors, warnings = validate(products)
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
        built = encode_pages([build_store(root, products, show), build_index(root, products, show)])
    except BuildError as exc:
        print('error: %s' % exc)
        print('\nnothing was written.')
        return 1
    rows = [(name, n, write_if_changed(path, doc, args.check)) for name, n, path, doc in built]

    for name, n, state in rows:
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
