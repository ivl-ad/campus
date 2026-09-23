/*
 * blog-page.js — fills blog-post.html and blog-category.html from js/blogs.js.
 *
 * One page serves every article (blog-post.html?id=<slug>) and one serves
 * every blog category (blog-category.html?id=<slug>), the same way
 * product.html serves every product. Ids come from blogs.js and are
 * permalinks, so they must stay stable once published.
 *
 * Nothing is fetched: blogs.js is a plain script include, so this works from
 * file:// exactly like the rest of the site. It is included before
 * catalog.js so the cards exist by the time the listing behaviors
 * (search, filters, Load More) initialise. blog-post.html also includes
 * js/team.js, so a post's author can be shown with their role.
 */
(function () {
  'use strict';

  // The page's Function (functions/*.js) usually writes a fuller title and
  // description into the HTML itself. Only fill them in when it did not --
  // i.e. the page still has its template title -- so search engines, which
  // read the page after scripts run, see the same text either way.
  var TEMPLATE_TITLE = /^(Product|Category|Store|Article|Blog Category) \| MyCampusKorner$/;
  function headIsTemplate() { return TEMPLATE_TITLE.test(document.title); }

  // Posts marked hidden in the editor are drafts: they are never shown.
  var POSTS = (window.BLOG_POSTS || []).filter(function (p) { return !p.hidden; });
  var CATS = window.BLOG_CATEGORIES || [];
  var TEAM = window.TEAM || [];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function byId(id) { return document.getElementById(id); }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function pageId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  // Same blob the baked cards carried, so text search behaves identically.
  function searchBlob(p) {
    return (p.name + ' ' + p.excerpt + ' ' + p.catLabel).toLowerCase();
  }

  function card(p) {
    return '<div class="w-dyn-item" data-cats="' + esc(p.cat) +
      '" data-date="' + p.dateMs + '" data-name="' + esc(p.name) +
      '" data-search="' + esc(searchBlob(p)) + '" role="listitem">' +
      '<a class="blog-card-wrap w-inline-block" href="blog-post.html?id=' + esc(p.id) + '">' +
      '<div class="blog-img-wrap"><img alt="' + esc(p.name) + '" class="full-img" loading="lazy" src="' + esc(p.img) + '"/></div>' +
      '<div class="blog-cn-wrap">' +
      '<div class="blog-categories-main-wrap">' +
      '<div class="blog-tag-wrap">' + esc(p.catLabel) + '</div>' +
      '<div class="blog-tag-wrap hide w-dyn-bind-empty" fs-list-field="demo"></div>' +
      '</div>' +
      '<h3 class="text-size-medium font-second text-weight-normal text-style-2lines" fs-list-field="name">' + esc(p.name) + '</h3>' +
      '<p class="text-size-small op-80 text-style-3lines">' + esc(p.excerpt) + '</p>' +
      '</div>' +
      '</a>' +
      '</div>';
  }

  // CONTINUE READING: the posts chosen in the editor, then the newest in the
  // same category, then the newest overall -- always three when there are.
  function relatedFor(p) {
    var out = [], seen = {};
    seen[p.id] = true;
    (p.related || []).forEach(function (id) {
      var r = find(POSTS, id);
      if (r && !seen[id]) { out.push(r); seen[id] = true; }
    });
    var rest = POSTS.filter(function (x) { return !seen[x.id]; }).sort(function (a, b) {
      return ((b.cat === p.cat) - (a.cat === p.cat)) || (b.dateMs - a.dateMs);
    });
    while (out.length < 3 && rest.length) out.push(rest.shift());
    return out;
  }

  function bylineItems(p) {
    var person = p.author ? find(TEAM, p.author) : null;
    if (person) {
      return [
        '<a class="text-size-small font-second op-80 blog-author-link" href="about.html#team-' +
          esc(person.id) + '">' + esc(person.name) + (person.role ? ',' : '') + '</a>'
      ].concat(person.role ? ['<div class="text-size-small font-second op-80">' + esc(person.role) + '</div>'] : []);
    }
    return (p.authors || []).map(function (a) {
      return '<div class="text-size-small font-second op-80">' + esc(a) + '</div>';
    });
  }

  /*
   * The article body. It is cleaned when it is saved in the editor
   * (functions/api/blog.js); this second pass rebuilds it here from an
   * allowlist before it reaches the page, so even a hand-edited or damaged
   * js/blogs.js can never run script on the site. DOMParser documents are
   * inert (nothing loads or runs), and only allowlisted elements and
   * attributes are copied into the live page -- no HTML string is re-parsed.
   */
  var OK_TAGS = { P: 1, BR: 1, H2: 1, H3: 1, H4: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, S: 1, SUP: 1,
    SUB: 1, A: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, HR: 1, IMG: 1, FIGURE: 1, FIGCAPTION: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1, CODE: 1, PRE: 1 };
  var DROP_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1,
    APPLET: 1, TEMPLATE: 1, SVG: 1, MATH: 1, NOSCRIPT: 1, XMP: 1, NOEMBED: 1, NOFRAMES: 1,
    PLAINTEXT: 1, TEXTAREA: 1, SELECT: 1, FORM: 1, INPUT: 1, BUTTON: 1, LINK: 1, META: 1,
    BASE: 1, TITLE: 1 };
  var OK_ATTRS = { A: { href: 1, title: 1, target: 1, rel: 1 },
    IMG: { src: 1, alt: 1, width: 1, height: 1, loading: 1 },
    TD: { colspan: 1, rowspan: 1 }, TH: { colspan: 1, rowspan: 1 }, OL: { start: 1 } };
  var SAFE_URL = /^(https?:\/\/|mailto:|tel:|#|\/(?![\/\\])|[a-z0-9-]+\.html(?:[?#]|$)|images\/)/i;

  function safeArticle(html) {
    var frag = document.createDocumentFragment();
    if (!html || !window.DOMParser) return frag;
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + html + '</body>', 'text/html');
    (function copy(from, to) {
      for (var n = from.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = String(n.tagName).toUpperCase();
        if (DROP_TAGS[tag]) continue;
        if (!OK_TAGS[tag]) { copy(n, to); continue; }        // unknown wrapper: keep its text
        var el = document.createElement(tag.toLowerCase());
        var ok = OK_ATTRS[tag] || {};
        for (var i = 0; i < n.attributes.length; i++) {
          var a = n.attributes[i], name = a.name.toLowerCase();
          if (!ok[name]) continue;
          if ((name === 'href' || name === 'src') && !SAFE_URL.test(String(a.value).trim())) continue;
          el.setAttribute(name, a.value);
        }
        if (tag === 'A' && /^https?:/i.test(el.getAttribute('href') || '') &&
            el.getAttribute('target') === '_blank' && !/noopener/.test(el.getAttribute('rel') || '')) {
          el.setAttribute('rel', ((el.getAttribute('rel') || '') + ' noopener').trim());
        }
        copy(n, el);
        to.appendChild(el);
      }
    })(doc.body, frag);
    return frag;
  }

  function setText(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
  }

  function toggleEmptyState(grid, hasItems) {
    for (var ch = grid.parentNode.firstElementChild; ch; ch = ch.nextElementSibling) {
      if (ch.classList.contains('w-dyn-empty')) {
        ch.classList.toggle('w-dyn-hide', hasItems);
      }
    }
  }

  function renderPost() {
    var p = find(POSTS, pageId());
    if (!p) {
      document.title = 'Article not found | MyCampusKorner';
      setText('b-title', 'Article not found');
      var missingImg = byId('b-hero-img');
      if (missingImg) missingImg.style.display = 'none';
      var byline = byId('b-byline');
      if (byline) byline.style.display = 'none';
      return;
    }

    if (headIsTemplate()) document.title = p.name + ' | MyCampusKorner';
    // The category tag links to that category's page (the only way readers
    // reach one besides the blog filters).
    var tag = byId('b-tag');
    if (tag) {
      tag.textContent = '';
      var catLink = document.createElement('a');
      catLink.className = 'blog-tag-link';
      catLink.href = 'blog-category.html?id=' + encodeURIComponent(p.cat);
      catLink.textContent = p.catLabel;
      tag.appendChild(catLink);
    }
    setText('b-title', p.name);
    setText('b-date', p.dateLabel);

    // Byline: either the visible author list or the hidden empty variant,
    // both exactly as the baked pages had them.
    var authors = byId('b-authors');
    if (authors) {
      var items = bylineItems(p);
      if (items.length) {
        authors.innerHTML = '<div class="blog-authors-wrap w-dyn-items" role="list">' +
          items.map(function (html) {
            return '<div class="w-dyn-item" role="listitem">' + html + '</div>';
          }).join('') +
          '</div><div class="w-dyn-empty w-dyn-hide"><div>No items found.</div></div>';
      } else {
        var wrap = byId('b-byline');
        if (wrap) {
          wrap.style.display = 'none';
          // and the dot that separates it from the date
          var dot = wrap.previousElementSibling;
          if (dot && dot.classList.contains('blog-head-dot')) dot.style.display = 'none';
        }
        authors.innerHTML = '<div class="blog-authors-wrap w-dyn-items" role="list">' +
          '<div class="w-dyn-item" role="listitem">' +
          '<div class="text-size-small font-second op-80 w-dyn-bind-empty"></div></div>' +
          '</div><div class="w-dyn-empty"><div>No items found.</div></div>';
      }
    }

    var img = byId('b-hero-img');
    if (img) {
      img.setAttribute('src', p.img);
      img.setAttribute('alt', p.name);
    }

    var content = byId('b-content');
    if (content) {
      content.textContent = '';
      content.appendChild(safeArticle(p.contentHTML));
    }

    var rail = byId('b-related');
    if (rail) {
      rail.innerHTML = relatedFor(p).map(card).join('');
    }
  }

  function renderCategory() {
    var grid = byId('c-grid');
    var cat = find(CATS, pageId());
    var items = [];
    if (cat) {
      if (headIsTemplate()) document.title = cat.label + ' | MyCampusKorner';
      setText('c-title', cat.label);
      items = POSTS.filter(function (p) { return p.cat === cat.id; })
        .sort(function (a, b) { return b.dateMs - a.dateMs; });
      grid.innerHTML = items.map(card).join('');
    } else {
      document.title = 'Category not found | MyCampusKorner';
      setText('c-title', 'Category not found');
    }
    toggleEmptyState(grid, items.length > 0);
  }

  function init() {
    if (byId('b-content')) {
      renderPost();
    } else if (byId('c-grid')) {
      renderCategory();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
