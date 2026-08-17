#!/usr/bin/env python3
"""Create tools/_store_template.html from an existing merchant store page.

Run this only when the store page design changes. build_listings.py stamps the
template out once per merchant, substituting __STORE_NAME__ / __STORE_TITLE__.

The sample store pages carried a logo image per store. The real merchants are
outside retailers whose logos we do not have and should not hotlink, so the
logo block is dropped and the merchant name stands on its own.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', '_store_template.html')


def main(src_name):
    src = os.path.join(ROOT, src_name)
    doc = open(src, encoding='utf-8').read()

    store = re.search(r'<title>([^|]+)\s*\|', doc)
    if not store:
        sys.exit('could not read the store name from <title>')
    store = store.group(1).strip()

    def sub(pattern, repl, label, flags=0):
        nonlocal doc
        new, n = re.subn(pattern, repl, doc, count=1, flags=flags)
        if not n:
            sys.exit('FAILED: ' + label)
        doc = new

    sub(r'<title>[^<]*</title>', '<title>__STORE_TITLE__</title>', 'title')

    # drop the logo image entirely — see module docstring
    sub(r'<div class="store-img-wrap">.*?</div>\s*', '', 'logo block', flags=re.S)

    sub(r'(<h1 style="font-weight: normal;">Explore <span style="color: var\(--_color---pr-green\);">)'
        + re.escape(store) + r'(</span> listings</h1>)',
        r'\1__STORE_NAME__\2', 'h1 store name')

    for prop, attr in (('og:title', 'property'), ('twitter:title', 'name')):
        doc = re.sub(rf'<meta content="[^"]*" {attr}="{re.escape(prop)}"/>',
                     f'<meta content="__STORE_TITLE__" {attr}="{prop}"/>', doc, count=1)

    open(OUT, 'w', encoding='utf-8').write(doc)
    print('wrote %s (from %s, store %r)' % (OUT, src_name, store))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'store-dormco.html')
