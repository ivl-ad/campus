/*
 * listing-page.js — fills category.html and merchant.html from js/products.js.
 *
 * One page serves every product category (category.html?id=<slug>) and one
 * serves every merchant store (merchant.html?id=<merchantSlug>), the same way
 * product.html serves every product. The card and filter markup mirrors what
 * tools/build_listings.py bakes into store.html, so styling and the catalog.js
 * behaviors (search, radios, sort, Load More) are identical.
 *
 * Nothing is fetched: products.js is a plain script include, so this works
 * from file:// exactly like the rest of the site. It is included before
 * catalog.js so the cards exist by the time the listing behaviors initialise.
 */
(function () {
  'use strict';

  // The page's Function (functions/*.js) usually writes a fuller title and
  // description into the HTML itself. Only fill them in when it did not --
  // i.e. the page still has its template title -- so search engines, which
  // read the page after scripts run, see the same text either way.
  var TEMPLATE_TITLE = /^(Product|Category|Store|Article|Blog Category) \| MyCampusKorner$/;
  function headIsTemplate() { return TEMPLATE_TITLE.test(document.title); }

  // The built-in categories, in mega-menu order (same list as
  // build_listings.py SITE_CATEGORIES). Categories added in the editor live
  // in js/products.js as window.PRODUCT_CATEGORIES; see categories() below.
  var BUILT_IN = [
    ['dorm-living-essentials', 'Dorm & Living Essentials'],
    ['academic-essentials', 'Academic Essentials'],
    ['personal-lifestyle', 'Personal Lifestyle'],
    ['event-tickets-travel', 'Event Tickets & Travel'],
    ['financial-services', 'Financial Services'],
    ['laundry-cleaning', 'Laundry & Cleaning'],
    ['living-social-spaces', 'Living & Social Spaces'],
    ['bathroom', 'Bathroom'],
    ['kitchen-dining', 'Kitchen & Dining'],
    ['bedroom-study', 'Bedroom & Study']
  ];

  // Every category that has a page: the file's list, the built-in ones, then
  // any a product names that neither has (labelled from that product).
  // Read when needed, not at load, so script order cannot matter.
  function categories() {
    var out = [], seen = {};
    function add(id, label) {
      if (typeof id === 'string' && id && typeof label === 'string' && label && !seen[id]) {
        seen[id] = 1; out.push([id, label]);
      }
    }
    (window.PRODUCT_CATEGORIES || []).forEach(function (c) { if (c) add(c.id, c.label); });
    BUILT_IN.forEach(function (c) { add(c[0], c[1]); });
    (window.PRODUCTS || []).forEach(function (p) { if (p) add(p.cat, p.catLabel); });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function byId(id) { return document.getElementById(id); }

  function money(n) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function searchBlob(p) {
    var bits = [p.name, p.merchant, p.catLabel];
    if (p.price !== undefined) bits.push(money(p.price));
    return bits.join(' ').toLowerCase();
  }

  function dataAttrs(p) {
    var s = 'data-cats="' + esc(p.cat) + '" data-href="product.html?id=' + esc(p.id) +
      '" data-name="' + esc(p.name) + '"';
    if (p.price !== undefined) s += ' data-price="' + Number(p.price).toFixed(2) + '"';
    return s + ' data-search="' + esc(searchBlob(p)) + '"';
  }

  // No invented pricing: products without a price get no price line.
  function priceBlock(p) {
    if (p.price === undefined) return '';
    return '<div class="product-price-wrap">' +
      '<h4 class="heading-style-five font-second text-color-green" fs-list-field="price">' +
      esc(money(p.price)) + '</h4></div>';
  }

  function gridCard(p) {
    return '<div class="w-dyn-item" ' + dataAttrs(p) + ' role="listitem">' +
      '<div class="product-card-wrap">' +
      '<div class="product-img-wrap">' +
      '<img alt="' + esc(p.name) + '" class="full-img" loading="lazy" src="' + esc(p.img) + '"/>' +
      '</div>' +
      '<div class="product-cn-wrap">' +
      '<div class="review-main-wrap"><div class="offer-text-wrap">' + esc(p.merchant) + '</div></div>' +
      '<h2 class="text-size-medium font-second text-weight-normal text-style-2lines" fs-list-field="name">' + esc(p.name) + '</h2>' +
      priceBlock(p) +
      '<a class="dark-btn-wrap w-inline-block" href="product.html?id=' + esc(p.id) + '">' +
      '<div class="dark-btn-text">View product</div>' +
      '</a>' +
      '</div></div></div>';
  }

  // Only offer a filter for categories that actually have items here.
  function radios(items) {
    var out = '', n = 0;
    categories().forEach(function (c) {
      var present = items.some(function (p) { return p.cat === c[0]; });
      if (!present) return;
      out += '<div class="w-dyn-item" role="listitem">' +
        '<label class="radio-filter w-radio">' +
        '<input class="w-form-formradioinput hide w-radio-input" data-name="demo"' +
        ' fs-list-field="demo" fs-list-value="" id="radio-cat-' + n + '" name="demo"' +
        ' type="radio" value="' + esc(c[0]) + '"/>' +
        '<span class="w-form-label" for="radio">' + esc(c[1]) + '</span>' +
        '</label></div>';
      n++;
    });
    return out;
  }

  function toggleEmptyState(grid, hasItems) {
    for (var ch = grid.parentNode.firstElementChild; ch; ch = ch.nextElementSibling) {
      if (ch.classList.contains('w-dyn-empty')) {
        ch.classList.toggle('w-dyn-hide', hasItems);
      }
    }
  }

  function setMeta(selector, value) {
    var el = document.querySelector(selector);
    if (el) el.setAttribute('content', value);
  }

  function init() {
    var grid = byId('l-grid');
    if (!grid) return;
    var all = window.PRODUCTS || [];
    var id = new URLSearchParams(window.location.search).get('id');
    var radiosWrap = byId('l-radios');
    var items, label;

    if (radiosWrap) {
      // merchant.html — one page per store
      items = all.filter(function (p) { return p.merchantSlug === id; });
      label = items.length ? items[0].merchant : 'Store not found';
      radiosWrap.innerHTML = radios(items);
      var title = label + ' | MyCampusKorner';
      if (headIsTemplate()) {
        document.title = title;
        setMeta('meta[property="og:title"]', title);
        setMeta('meta[name="twitter:title"]', title);
      }
    } else {
      // category.html — one page per product category
      var cat = null;
      categories().forEach(function (c) { if (c[0] === id) cat = c; });
      label = cat ? cat[1] : 'Category not found';
      items = all.filter(function (p) { return p.cat === id; });
      if (headIsTemplate()) document.title = label + ' | MyCampusKorner';
    }

    var labelEl = byId('l-label');
    if (labelEl) labelEl.textContent = label;
    grid.innerHTML = items.map(gridCard).join('');
    toggleEmptyState(grid, items.length > 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
