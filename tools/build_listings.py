#!/usr/bin/env python3
"""Re-bake the product listings from js/products.js.

js/products.js is the single source of truth for the catalog. This script
writes that data into the listing pages as plain static HTML, so the pages stay
crawlable and keep working with JavaScript switched off — only the single
product.html detail page reads products.js at runtime.

Run it after any edit to js/products.js:

    python3 tools/build_listings.py

It rewrites, in place:
  - store.html            every product, the category filter, the ItemList JSON-LD
  - index.html            the featured rail and its JSON-LD
  - category-*.html       the products in that category
  - store-<merchant>.html one page per merchant (created/removed as needed)

Everything outside the list containers is left untouched.
"""
import glob
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# how many products the home page rail shows
FEATURED = 8

# every category that has a page on the site, in mega-menu order
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


# --------------------------------------------------------------- load catalog
def load_products():
    """Parse js/products.js. It is JSON objects one per line inside a JS array,
    so stripping the wrapper and the trailing commas is enough."""
    src = open(os.path.join(ROOT, 'js', 'products.js'), encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    body = src[src.index('['):src.rindex(']') + 1]
    body = re.sub(r',(\s*])', r'\1', body)
    return json.loads(body)


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
    """Attributes catalog.js reads for search, filtering, sorting and clicks."""
    attrs = [
        'data-cats="%s"' % e(p['cat']),
        'data-href="product.html?id=%s"' % e(p['id']),
        'data-name="%s"' % e(p['name']),
    ]
    if 'price' in p:
        attrs.append('data-price="%s"' % e('{:.2f}'.format(p['price'])))
    attrs.append('data-search="%s"' % e(search_blob(p)))
    return ' '.join(attrs)


def price_block(p, tag='h4', cls='heading-style-five font-second text-color-green'):
    """Products with no price (brand/landing pages) simply get no price line."""
    if 'price' not in p:
        return ''
    return ('<div class="product-price-wrap">'
            '<{tag} class="{cls}" fs-list-field="price">{v}</{tag}>'
            '</div>').format(tag=tag, cls=cls, v=e(money(p['price'])))


def grid_card(p):
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


def replace_inner(doc, open_tag_re, new_inner, label):
    """Swap the contents of the first <div> whose opening tag matches, keeping
    the tag itself and balancing nested divs."""
    m = re.search(open_tag_re, doc)
    if not m:
        sys.exit('  ! %s: container not found (%s)' % (label, open_tag_re))
    i = m.end()
    depth, tag = 1, re.compile(r'<(/?)div\b', re.I)
    while depth:
        t = tag.search(doc, i)
        if not t:
            sys.exit('  ! %s: unbalanced divs' % label)
        depth += -1 if t.group(1) else 1
        i = t.end()
    close = doc.find('>', i - 1) + 1
    return doc[:m.end()] + new_inner + doc[close - len('</div>'):]


GRID = r'<div class="product-grad-wrap w-dyn-items"[^>]*>'
SLIDER = r'<div class="swiper-wrapper w-dyn-items"[^>]*>'


def set_empty_state(doc, is_empty, container_re=None):
    """Webflow's "No items found." block is hidden by default; show it only
    when a listing genuinely has nothing in it.

    Must be anchored to the listing container: several of these blocks exist on
    every page (the mega-menu and footer collections have their own), and the
    product grid's is not the first one in the document.
    """
    anchor = re.search(container_re or GRID, doc)
    if not anchor:
        sys.exit('  ! set_empty_state: container not found')
    m = re.compile(r'<div class="w-dyn-empty( w-dyn-hide)?">').search(doc, anchor.end())
    if not m:
        return doc
    repl = '<div class="w-dyn-empty">' if is_empty else '<div class="w-dyn-empty w-dyn-hide">'
    return doc[:m.start()] + repl + doc[m.end():]


def list_elements(products):
    return [
        dict(
            {'@type': 'ListItem', 'position': i + 1,
             'item': dict(
                 {'@type': 'Product', 'name': p['name'], 'image': p['img'],
                  'category': p['catLabel'],
                  'url': 'product.html?id=' + p['id']},
                 **({'offers': {'@type': 'Offer', 'price': str(p['price']),
                                'priceCurrency': 'USD',
                                'seller': {'@type': 'Organization',
                                           'name': p['merchant']}}}
                    if 'price' in p else {}))})
        for i, p in enumerate(products)
    ]


def find_itemlist(node):
    """The ItemList is usually nested under a WebPage/CollectionPage wrapper
    that carries the page's own name, description and url. Only the list is
    ours to rewrite — the wrapper must survive."""
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


def replace_itemlist_ld(doc, products, _name=None):
    """Rewrite just the itemListElement of the page's ItemList, in place."""
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', doc, re.S):
        raw = m.group(1)
        if '"ItemList"' not in raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            sys.exit('  ! unparseable JSON-LD block')
        lst = find_itemlist(data)
        if lst is None:
            continue
        lst['itemListElement'] = list_elements(products)
        lst['numberOfItems'] = len(products)
        return doc[:m.start(1)] + json.dumps(data, ensure_ascii=False) + doc[m.end(1):]
    return doc


def category_radios(products):
    """Only offer a filter for categories that actually have products."""
    present = [(slug, label) for slug, label in SITE_CATEGORIES
               if any(p['cat'] == slug for p in products)]
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


def drop_year_sort(doc):
    """The catalog carries no dates, so the two Year sort options would be
    dead controls."""
    return re.sub(
        r'<a class="filter_dropdown_link helper w-inline-block" fs-list-field="year-(?:asc|desc)"'
        r' href="#">\s*<div>[^<]*</div>\s*</a>\s*', '', doc)


# --------------------------------------------------------------------- pages
def build_store(products):
    path = os.path.join(ROOT, 'store.html')
    doc = open(path, encoding='utf-8').read()
    doc = replace_inner(doc, GRID, ''.join(grid_card(p) for p in products), 'store.html grid')
    doc = replace_inner(doc, r'<div class="collection-list w-dyn-items"[^>]*>',
                        category_radios(products), 'store.html filters')
    doc = replace_itemlist_ld(doc, products, 'All Products')
    doc = drop_year_sort(doc)
    doc = set_empty_state(doc, not products)
    open(path, 'w', encoding='utf-8').write(doc)
    return 'store.html', len(products)


def build_index(products):
    path = os.path.join(ROOT, 'index.html')
    doc = open(path, encoding='utf-8').read()
    featured = products[:FEATURED]
    doc = replace_inner(doc, SLIDER, ''.join(slide_card(p) for p in featured),
                        'index.html featured rail')
    doc = replace_itemlist_ld(doc, featured, 'Featured Campus Products')
    open(path, 'w', encoding='utf-8').write(doc)
    return 'index.html', len(featured)


def build_categories(products):
    out = []
    for slug, label in SITE_CATEGORIES:
        path = os.path.join(ROOT, 'category-%s.html' % slug)
        if not os.path.exists(path):
            continue
        items = [p for p in products if p['cat'] == slug]
        doc = open(path, encoding='utf-8').read()
        doc = replace_inner(doc, GRID, ''.join(grid_card(p) for p in items),
                            os.path.basename(path))
        doc = set_empty_state(doc, not items)
        open(path, 'w', encoding='utf-8').write(doc)
        out.append((os.path.basename(path), len(items)))
    return out


def build_merchant_pages(products):
    """One page per merchant, generated from a store-page template. Pages for
    merchants no longer in the catalog are deleted."""
    merchants = {}
    for p in products:
        merchants.setdefault((p['merchantSlug'], p['merchant']), []).append(p)

    template_path = os.path.join(ROOT, 'tools', '_store_template.html')
    if not os.path.exists(template_path):
        sys.exit('  ! missing %s — run tools/make_store_template.py first' % template_path)
    template = open(template_path, encoding='utf-8').read()

    wanted = set()
    out = []
    for (slug, label), items in sorted(merchants.items()):
        name = 'store-%s.html' % slug
        wanted.add(name)
        doc = template
        doc = doc.replace('__STORE_NAME__', e(label))
        doc = doc.replace('__STORE_TITLE__', e('%s | MyCampusKorner' % label))
        doc = replace_inner(doc, GRID, ''.join(grid_card(p) for p in items), name)
        doc = replace_inner(doc, r'<div class="collection-list w-dyn-items"[^>]*>',
                            category_radios(items), name + ' filters')
        doc = drop_year_sort(doc)
        doc = set_empty_state(doc, not items)
        open(os.path.join(ROOT, name), 'w', encoding='utf-8').write(doc)
        out.append((name, len(items)))

    removed = []
    for path in glob.glob(os.path.join(ROOT, 'store-*.html')):
        if os.path.basename(path) not in wanted:
            os.remove(path)
            removed.append(os.path.basename(path))
    return out, removed


def main():
    products = load_products()
    print('catalog: %d products\n' % len(products))

    rows = [build_store(products), build_index(products)]
    rows += build_categories(products)
    merchant_rows, removed = build_merchant_pages(products)
    rows += merchant_rows

    for name, n in rows:
        flag = '   (empty)' if n == 0 else ''
        print('  %-38s %3d%s' % (name, n, flag))
    if removed:
        print('\n  removed stale store pages: %s' % ', '.join(sorted(removed)))
    print('\ndone.')


if __name__ == '__main__':
    main()
