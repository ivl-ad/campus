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
 * (search, filters, Load More) initialise.
 */
(function () {
  'use strict';

  var POSTS = window.BLOG_POSTS || [];
  var CATS = window.BLOG_CATEGORIES || [];

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

    document.title = p.name + ' | MyCampusKorner';
    setText('b-tag', p.catLabel);
    setText('b-title', p.name);
    setText('b-date', p.dateLabel);

    // Byline: either the visible author list or the hidden empty variant,
    // both exactly as the baked pages had them.
    var authors = byId('b-authors');
    if (authors) {
      if (p.authors && p.authors.length) {
        authors.innerHTML = '<div class="blog-authors-wrap w-dyn-items" role="list">' +
          p.authors.map(function (a) {
            return '<div class="w-dyn-item" role="listitem">' +
              '<div class="text-size-small font-second op-80">' + esc(a) + '</div></div>';
          }).join('') +
          '</div><div class="w-dyn-empty w-dyn-hide"><div>No items found.</div></div>';
      } else {
        var wrap = byId('b-byline');
        if (wrap) wrap.style.display = 'none';
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
    if (content) content.innerHTML = p.contentHTML;

    var rail = byId('b-related');
    if (rail) {
      rail.innerHTML = (p.related || []).map(function (id) {
        var r = find(POSTS, id);
        return r ? card(r) : '';
      }).join('');
    }
  }

  function renderCategory() {
    var grid = byId('c-grid');
    var cat = find(CATS, pageId());
    var items = [];
    if (cat) {
      document.title = cat.label + ' | MyCampusKorner';
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
