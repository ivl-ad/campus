#!/usr/bin/env python3
"""Re-bake the blog listings and the About page team from their data files.

The twin of build_listings.py (which does the products). Run by the GitHub
Action after every save from the admin editor, or by hand:

    python build_content.py            # update blog.html, index.html, about.html
    python build_content.py --check    # report what would change, write nothing

It rewrites, in place, only the containers it owns:
  - blog.html    every published post's card (newest first) and the category
                 filter (only categories that have a published post)
  - index.html   the three newest published posts in the "Real campus advice"
                 section (the product rail there belongs to build_listings.py)
  - about.html   the "Meet the team" cards, and the people in its JSON-LD;
                 the section hides itself while the team list is empty

Source files: js/blogs.js (Blog tab) and js/team.js (Team tab). Posts marked
hidden are drafts and are left out everywhere. blog-post.html and
blog-category.html need no baking -- they read js/blogs.js in the browser.

Everything outside those containers is left byte-for-byte alone, so running it
twice in a row changes nothing the second time. If the data has a problem,
nothing is written and the problems are listed instead.
"""
import argparse
import json
import os
import re
import sys

from build_listings import (BuildError, encode_pages, extract_array, replace_inner,
                            set_empty_state, write_if_changed)

SITE = 'https://mycampuskorner.com'
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]*$')

BLOG_GRID = r'<div class="product-grad-wrap w-dyn-items"[^>]*>'
BLOG_RADIOS = r'<div class="collection-list w-dyn-items"[^>]*>'
HOME_SLOTS = ('one', 'second', 'three')
TEAM_GRID = r'<div class="team-grid" data-team-grid="">'
TEAM_SECTION = re.compile(r'<section class="section bg-color-of-wh team-section" data-team-section=""( hidden="")?>')


def home_slot(slot):
    # The list inside each of the three fixed card slots on the home page.
    return r'(?<=<div class="real-card-wrap %s w-dyn-list">\n)<div class="w-dyn-items" role="list">' % slot


# --------------------------------------------------------------- reading data
def load_blog(root):
    path = os.path.join(root, 'js', 'blogs.js')
    if not os.path.isfile(path):
        raise BuildError('not found: js/blogs.js')
    src = open(path, encoding='utf-8').read()
    return extract_array(src, 'BLOG_CATEGORIES', 'js/blogs.js'), extract_array(src, 'BLOG_POSTS', 'js/blogs.js')


def load_team(root):
    path = os.path.join(root, 'js', 'team.js')
    if not os.path.isfile(path):
        return []                      # before the first Team save
    return extract_array(open(path, encoding='utf-8').read(), 'TEAM', 'js/team.js')


def published(posts):
    """Visible posts, newest first (id breaks ties so the order is stable)."""
    live = [p for p in posts if isinstance(p, dict) and not p.get('hidden')]
    return sorted(live, key=lambda p: (-(p.get('dateMs') or 0), p.get('id') or ''))


# ---------------------------------------------------------------- validation
def validate(categories, posts, team):
    errors, warnings = [], []
    seen = {}
    for n, p in enumerate(posts, 1):
        where = 'post #%d' % n
        if not isinstance(p, dict):
            errors.append('%s: not an object' % where)
            continue
        if p.get('id'):
            where = 'post #%d (%s)' % (n, p['id'])
        pid = p.get('id')
        if not pid:
            errors.append('%s: missing "id"' % where)
        elif not SLUG.match(str(pid)):
            errors.append('%s: id must be lowercase letters, numbers and dashes' % where)
        elif pid in seen:
            errors.append('%s: duplicate id -- also used by post #%d' % (where, seen[pid]))
        else:
            seen[pid] = n
        for field in ('id', 'name', 'cat', 'catLabel', 'img', 'dateLabel', 'excerpt', 'author', 'contentHTML'):
            if field in p and p[field] is not None and not isinstance(p[field], str):
                errors.append('%s: "%s" must be text' % (where, field))
        if p.get('related') is not None and not (isinstance(p['related'], list) and
                                                  all(isinstance(r, str) for r in p['related'])):
            errors.append('%s: "related" must be a list of post ids' % where)
        if p.get('hidden'):
            continue
        for field in ('name', 'cat', 'catLabel', 'img', 'dateLabel'):
            if not p.get(field):
                errors.append('%s: missing "%s"' % (where, field))
        if not isinstance(p.get('dateMs'), (int, float)) or isinstance(p.get('dateMs'), bool):
            errors.append('%s: dateMs must be a number' % where)
    ids = set(seen)
    team_ids = set(t.get('id') for t in team if isinstance(t, dict))
    for p in posts:
        if not isinstance(p, dict) or p.get('hidden'):
            continue
        for r in p.get('related') or []:
            if r not in ids:
                warnings.append('post %s: related post "%s" does not exist (skipped on the page)' % (p.get('id'), r))
        if p.get('author') and p['author'] not in team_ids:
            warnings.append('post %s: author "%s" is not on the team list (byline hidden)' % (p.get('id'), p['author']))

    tseen = {}
    for n, t in enumerate(team, 1):
        where = 'team member #%d' % n
        if not isinstance(t, dict):
            errors.append('%s: not an object' % where)
            continue
        if not t.get('name'):
            errors.append('%s: missing "name"' % where)
        for field in ('id', 'name', 'role', 'photo', 'bio', 'link'):
            if field in t and t[field] is not None and not isinstance(t[field], str):
                errors.append('%s: "%s" must be text' % (where, field))
        tid = t.get('id')
        if not tid or not SLUG.match(str(tid)):
            errors.append('%s: id must be lowercase letters, numbers and dashes' % where)
        elif tid in tseen:
            errors.append('%s: duplicate id -- also used by #%d' % (where, tseen[tid]))
        else:
            tseen[tid] = n
    return errors, warnings


# ------------------------------------------------------------------- markup
def esc(s):
    """Escape for HTML text and double-quoted attributes. Apostrophes stay as
    they are, matching the markup Webflow exported."""
    return (str(s).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def blog_card(p):
    search = ('%s %s %s' % (p['name'], p.get('excerpt', ''), p['catLabel'])).lower()
    return (
        '<div class="w-dyn-item" data-cats="{cat}" data-date="{date}" data-name="{name}" '
        'data-search="{search}" role="listitem">\n'
        '<a class="blog-card-wrap w-inline-block" href="blog-post.html?id={id}">\n'
        '<div class="blog-img-wrap"><img alt="{name}" class="full-img" loading="lazy" src="{img}"/></div>\n'
        '<div class="blog-cn-wrap">\n'
        '<div class="blog-categories-main-wrap">\n'
        '<div class="blog-tag-wrap">{catLabel}</div>\n'
        '<div class="blog-tag-wrap hide w-dyn-bind-empty" fs-list-field="demo"></div>\n'
        '</div>\n'
        '<h3 class="text-size-medium font-second text-weight-normal text-style-2lines" fs-list-field="name">{name}</h3>\n'
        '<p class="text-size-small op-80 text-style-3lines">{excerpt}</p>\n'
        '</div>\n'
        '</a>\n'
        '</div>'
    ).format(cat=esc(p['cat']), date=int(p['dateMs']), name=esc(p['name']), search=esc(search),
             id=esc(p['id']), img=esc(p['img']), catLabel=esc(p['catLabel']),
             excerpt=esc(p.get('excerpt', '')))


def blog_radios(categories, live):
    used = set(p['cat'] for p in live)
    out = []
    for i, c in enumerate([c for c in categories if c.get('id') in used]):
        out.append(
            '<div class="w-dyn-item" role="listitem"><label class="radio-filter w-radio">'
            '<input class="w-form-formradioinput hide w-radio-input" data-name="demo" fs-list-field="demo"'
            ' fs-list-value="" id="radio-cat-%d" name="demo" type="radio" value="%s"/>'
            '<span class="w-form-label" for="radio">%s</span></label></div>'
            % (i, esc(c['id']), esc(c.get('label') or c['id'])))
    return ''.join(out)


def home_card(p, slot):
    return (
        '<div class="w-dyn-item" role="listitem">\n'
        '<a class="real-card-wrap {slot} w-inline-block" href="blog-post.html?id={id}">\n'
        '<div class="real-card-img-wrap"><img alt="{name}" class="full-img" loading="lazy" src="{img}"/>\n'
        '<div class="real-card-tag">\n'
        '<div class="text-size-small font-second">{catLabel}</div>\n'
        '</div>\n'
        '</div>\n'
        '<div class="real-card-cn">\n'
        '<h3 class="heading-style-three text-weight-normal">{name}</h3>\n'
        '</div>\n'
        '</a>\n'
        '</div>'
    ).format(slot=slot, id=esc(p['id']), name=esc(p['name']), img=esc(p['img']),
             catLabel=esc(p['catLabel']))


def link_label(url):
    u = url.lower()
    if u.startswith('mailto:'):
        return 'Email'
    for host, label in (('linkedin.', 'LinkedIn'), ('instagram.', 'Instagram'), ('tiktok.', 'TikTok'),
                        ('facebook.', 'Facebook'), ('youtube.', 'YouTube'), ('x.com', 'X'),
                        ('twitter.', 'X'), ('threads.', 'Threads')):
        if host in u:
            return label
    return 'Website'


def initials(name):
    parts = [w for w in re.split(r'\s+', name.strip()) if w]
    return ''.join(w[0] for w in (parts[:1] + parts[-1:] if len(parts) > 1 else parts)).upper()


def team_card(t):
    name = t['name']
    photo = (t.get('photo') or '').strip()
    if photo:
        pic = '<div class="team-photo"><img alt="%s" loading="lazy" src="%s"/></div>' % (esc(name), esc(photo))
    else:
        pic = '<div aria-hidden="true" class="team-photo team-initials">%s</div>' % esc(initials(name))
    paras = [p.strip() for p in re.split(r'\n\s*\n', (t.get('bio') or '').strip()) if p.strip()]
    bio = ''.join('<p>%s</p>' % '<br/>'.join(esc(line) for line in para.split('\n')) for para in paras)
    link = (t.get('link') or '').strip()
    out = ['<article class="team-card" id="team-%s">' % esc(t['id']), pic, '<div class="team-card-body">']
    if t.get('role'):
        out.append('<div class="team-role">%s</div>' % esc(t['role']))
    out.append('<h3 class="team-name">%s</h3>' % esc(name))
    if bio:
        out.append('<div class="team-bio">%s</div>' % bio)
    if link:
        extra = '' if link.lower().startswith('mailto:') else ' rel="noopener me" target="_blank"'
        out.append('<a class="team-link" href="%s"%s>%s <span aria-hidden="true">↗</span></a>'
                   % (esc(link), extra, link_label(link)))
    out.append('</div>')
    out.append('</article>')
    return '\n'.join(out)


def absolute(url):
    url = (url or '').strip()
    if not url or re.match(r'^https?://', url):
        return url
    return SITE + '/' + url.lstrip('/')


def team_jsonld(doc, team):
    """Point the About page's Organization at its people (founder / employee)."""
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', doc, re.S):
        raw = m.group(1)
        if '"AboutPage"' not in raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise BuildError('about.html: the JSON-LD block is not valid JSON (%s)' % exc)
        org = data.get('mainEntity')
        if not isinstance(org, dict):
            return doc
        people = {'founder': [], 'employee': []}
        for t in team:
            person = {'@type': 'Person', 'name': t['name']}
            if t.get('role'):
                person['jobTitle'] = t['role']
            if t.get('photo'):
                person['image'] = absolute(t['photo'])
            person['url'] = SITE + '/about#team-' + t['id']
            if re.match(r'^https?://', t.get('link') or ''):
                person['sameAs'] = [t['link']]
            people['founder' if re.search(r'founder', t.get('role') or '', re.I) else 'employee'].append(person)
        for key, lst in people.items():
            if lst:
                org[key] = lst
            else:
                org.pop(key, None)
        # "<" escaped, so no value can close the <script> it sits in.
        return (doc[:m.start(1)] + '\n' + json.dumps(data, indent=2, ensure_ascii=False).replace('<', '\\u003c') +
                '\n' + doc[m.end(1):])
    return doc


# --------------------------------------------------------------------- pages
def read(root, name):
    path = os.path.join(root, name)
    if not os.path.isfile(path):
        raise BuildError('%s not found in %s' % (name, root))
    return path, open(path, encoding='utf-8', newline='').read()


# Each builder returns (name, count, path, new_doc); main() writes only once
# every page has been built, so a problem in one page never leaves another
# half-updated.
def build_blog(root, categories, live):
    path, doc = read(root, 'blog.html')
    doc = replace_inner(doc, BLOG_GRID, '\n\n' + ''.join(blog_card(p) for p in live), 'blog.html grid')
    doc = replace_inner(doc, BLOG_RADIOS, '\n\n' + blog_radios(categories, live), 'blog.html category filter')
    doc = set_empty_state(doc, not live, BLOG_GRID)
    return 'blog.html', len(live), path, doc


def build_home(root, live):
    path, doc = read(root, 'index.html')
    for i, slot in enumerate(HOME_SLOTS):
        p = live[i] if i < len(live) else None
        doc = replace_inner(doc, home_slot(slot), '\n\n' + home_card(p, slot) if p else '',
                            'index.html blog card "%s"' % slot)
        doc = set_empty_state(doc, False, home_slot(slot))   # never show "No items found."
    return 'index.html', min(len(live), len(HOME_SLOTS)), path, doc


def build_about(root, team):
    path, doc = read(root, 'about.html')
    if not re.search(TEAM_GRID, doc) or not TEAM_SECTION.search(doc):
        raise BuildError('about.html: the "Meet the team" section is missing '
                         '(<section ... data-team-section=""> with <div class="team-grid" data-team-grid="">)')
    doc = replace_inner(doc, TEAM_GRID, ('\n' + '\n'.join(team_card(t) for t in team) + '\n') if team else '',
                        'about.html team')
    doc = TEAM_SECTION.sub('<section class="section bg-color-of-wh team-section" data-team-section=""%s>'
                           % ('' if team else ' hidden=""'), doc, count=1)
    doc = team_jsonld(doc, team)
    return 'about.html', len(team), path, doc


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description='Re-bake the blog listings and the About page team.')
    ap.add_argument('--root', default=here, help="site folder (default: this script's folder)")
    ap.add_argument('--check', action='store_true', help='report what would change and write nothing')
    args = ap.parse_args()
    root = os.path.abspath(args.root)

    try:
        categories, posts = load_blog(root)
        team = load_team(root)
    except BuildError as exc:
        print('error: %s' % exc)
        return 1

    errors, warnings = validate(categories, posts, team)
    for w in warnings:
        print('warning: %s' % w)
    if errors:
        print()
        for x in errors:
            print('error: %s' % x)
        print('\n%d problem(s) found -- nothing was written.' % len(errors))
        return 1

    live = published(posts)
    print('blog:  %d posts (%d published, %d drafts), %d categories'
          % (len(posts), len(live), len(posts) - len(live), len(categories)))
    print('team:  %d people\n' % len(team))

    try:
        built = encode_pages([build_blog(root, categories, live),
                              build_home(root, live),
                              build_about(root, team)])
    except BuildError as exc:
        print('error: %s' % exc)
        print('\nnothing was written.')
        return 1

    for name, n, path, doc in built:
        print('  %-12s %3d items   %s' % (name, n, write_if_changed(path, doc, args.check)))
    if args.check:
        print('\n--check: no files were written.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
