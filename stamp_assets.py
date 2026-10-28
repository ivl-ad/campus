#!/usr/bin/env python3
"""
stamp_assets.py -- give every page's own scripts and stylesheets a
fingerprint of their content, so a changed file reaches browsers at once.

    python stamp_assets.py            update the pages
    python stamp_assets.py --check    report only; write nothing

Why this exists
---------------
The pages themselves are never cached (Cloudflare sends HTML with
max-age=0). Everything else is: the Cloudflare zone's "Browser Cache TTL"
gives every JavaScript file -- the site's code AND its data, js/products.js
included -- a 4-hour browser cache, and _headers gives the stylesheets a day.
So a deploy, or a Save in the editor, could take hours to reach someone who
had visited recently: in October 2026 a deploy looked like it had "changed
nothing" for exactly that reason.

A page that names js/catalog.js?v=<fingerprint> changes the moment
js/catalog.js does, and a browser fetches the new address at once, while
files that did not change keep their address and stay cached.

It touches only <script src="js/..."> and <link href="css/..."> (also with a
leading /) in the site's top-level pages. js/vendor/ is left alone: those
files carry their version in their name already and are cached for a year.

The GitHub Action runs this after every rebuild (an editor's Save changes a
data file; the stamps then change in the pages that load it). After editing
anything in js/ or css/ by hand, run it before pushing -- or let the Action,
which also runs on such pushes, do it a minute later.
"""

import argparse
import glob
import hashlib
import os
import re
import sys

REF = re.compile(r'(\b(?:src|href)=")(/?)((?:js|css)/[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")')


def fingerprint(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


def stamp(root, page, prints):
    src = open(page, encoding='utf-8', newline='').read()

    def fix(m):
        rel = m.group(3)
        if rel.startswith('js/vendor/') or rel.startswith('css/vendor/'):
            return m.group(0)
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            return m.group(0)                      # not ours to vouch for
        if rel not in prints:
            prints[rel] = fingerprint(path)
        return '%s%s%s?v=%s%s' % (m.group(1), m.group(2), rel, prints[rel], m.group(4))

    out = REF.sub(fix, src)
    return src, out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="Fingerprint the pages' scripts and stylesheets.")
    ap.add_argument('--root', default=here, help="site folder (default: this script's folder)")
    ap.add_argument('--check', action='store_true', help='report only; write nothing')
    args = ap.parse_args()
    root = os.path.abspath(args.root)

    prints, changed = {}, []
    for page in sorted(glob.glob(os.path.join(root, '*.html'))):
        before, after = stamp(root, page, prints)
        if before != after:
            changed.append(os.path.basename(page))
            if not args.check:
                with open(page, 'w', encoding='utf-8', newline='') as f:
                    f.write(after)

    print('stamped %d files; %d page(s) %s%s'
          % (len(prints), len(changed), 'would change' if args.check else 'updated',
             (': ' + ', '.join(changed)) if changed else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
