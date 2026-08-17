/*
 * catalog.js — behavior only, no data loading.
 *
 * All CMS content is baked into the HTML at build time. This script wires up
 * the listing behaviors on top of that static markup: text search, category
 * radio filters, the sort dropdown, "Load More" paging, and making product
 * cards without their own link clickable (via data-href).
 *
 * Works from file:// too — nothing is fetched. Without JavaScript the pages
 * simply show every item, so nothing breaks.
 */
(function () {
  'use strict';

  function init() {
    // Cards that carry a target but no wrapping link become clickable.
    Array.prototype.slice.call(document.querySelectorAll('.w-dyn-item[data-href]')).forEach(function (item) {
      var card = item.querySelector('.product-card-wrap, .prodact-slider-cn-wrap');
      if (!card) return;
      card.style.cursor = 'pointer';
      card.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== card) {
          if (t.tagName === 'A') return; // real links win
          t = t.parentNode;
        }
        window.location.href = item.getAttribute('data-href');
      });
    });

    var itemsWrap = document.querySelector('.product-grad-wrap.w-dyn-items, .product-grad-wrap-copy.w-dyn-items');
    if (!itemsWrap) return;
    var listRoot = itemsWrap.parentNode;
    var entries = Array.prototype.slice.call(itemsWrap.children).filter(function (ch) {
      return ch.classList.contains('w-dyn-item');
    });
    if (!entries.length) return;

    var isBlogGrid = !!entries[0].querySelector('a.blog-card-wrap');
    var pageSize = isBlogGrid ? 6 : 8;
    // Related-posts grids bake only a few items and have no filter form: leave static.
    var form = document.querySelector('form[fs-list-element="filters"]');
    var pagination = listRoot.querySelector('.w-pagination-wrapper');
    var hasControls = form || entries.length > pageSize;
    if (!hasControls) return;

    var state = { q: '', cat: '', sort: '', shown: pageSize };

    function attr(el, name) { return el.getAttribute(name) || ''; }

    function matches(el) {
      if (state.q && attr(el, 'data-search').indexOf(state.q) === -1) return false;
      if (state.cat && attr(el, 'data-cats').split(/\s+/).indexOf(state.cat) === -1) return false;
      return true;
    }

    // Some catalog entries are brand or landing pages with no single price, so
    // they carry no data-price. They are not comparable on price and always
    // sort to the end rather than being treated as $0.
    function price(el) {
      var raw = el.getAttribute('data-price');
      if (raw === null || raw === '') return null;
      var n = parseFloat(raw);
      return isNaN(n) ? null : n;
    }

    function byPrice(dir) {
      return function (a, b) {
        var x = price(a), y = price(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x - y) * dir;
      };
    }

    var comparators = {
      'name-asc': function (a, b) { return attr(a, 'data-name').localeCompare(attr(b, 'data-name')); },
      'name-desc': function (a, b) { return attr(b, 'data-name').localeCompare(attr(a, 'data-name')); },
      'price-asc': byPrice(1),
      'price-desc': byPrice(-1)
    };

    var emptyState = null;
    for (var ch = listRoot.firstElementChild; ch; ch = ch.nextElementSibling) {
      if (ch.classList.contains('w-dyn-empty')) emptyState = ch;
    }

    function apply() {
      var ordered = entries.slice();
      if (comparators[state.sort]) {
        ordered.sort(comparators[state.sort]);
        ordered.forEach(function (el) { itemsWrap.appendChild(el); });
      }
      var visible = 0;
      ordered.forEach(function (el) {
        var ok = matches(el) && visible < state.shown;
        el.style.display = ok ? '' : 'none';
        if (ok) visible++;
      });
      var total = ordered.filter(matches).length;
      if (emptyState) emptyState.classList.toggle('w-dyn-hide', total > 0);
      if (pagination) pagination.style.display = (total > state.shown) ? '' : 'none';
    }

    if (pagination) {
      var prev = pagination.querySelector('.w-pagination-previous');
      if (prev) prev.style.display = 'none';
      var next = pagination.querySelector('.w-pagination-next');
      if (next) {
        next.addEventListener('click', function (ev) {
          ev.preventDefault();
          state.shown += pageSize;
          apply();
        });
      }
    }

    if (form) {
      form.addEventListener('submit', function (ev) { ev.preventDefault(); });

      var search = form.querySelector('input[fs-list-field="*"], input[type="text"]');
      if (search) {
        search.addEventListener('input', function () {
          state.q = search.value.trim().toLowerCase();
          state.shown = pageSize;
          apply();
        });
      }

      var radioBlock = form.querySelector('.filter_block');
      if (radioBlock) {
        radioBlock.addEventListener('click', function (ev) {
          var label = ev.target.closest ? ev.target.closest('label.radio-filter') : null;
          if (!label) return;
          var input = label.querySelector('input');
          state.cat = input && input.value !== 'Radio' ? input.value : '';
          state.shown = pageSize;
          Array.prototype.slice.call(radioBlock.querySelectorAll('label.radio-filter')).forEach(function (l) {
            l.classList.toggle('fs-cmsfilter_active', l === label);
          });
          apply();
        });
      }

      var sortLinks = form.querySelectorAll('a.filter_dropdown_link[fs-list-field]');
      var sortLabel = form.querySelector('[fs-list-element="dropdown-label"]');
      Array.prototype.slice.call(sortLinks).forEach(function (linkEl) {
        linkEl.addEventListener('click', function (ev) {
          ev.preventDefault();
          state.sort = linkEl.getAttribute('fs-list-field');
          Array.prototype.slice.call(sortLinks).forEach(function (l) {
            l.classList.toggle('w--current', l === linkEl);
          });
          if (sortLabel) sortLabel.textContent = linkEl.textContent.trim();
          var dropdown = linkEl.closest ? linkEl.closest('.w-dropdown') : null;
          if (dropdown) {
            var toggle = dropdown.querySelector('.w-dropdown-toggle');
            if (toggle && dropdown.querySelector('.w--open')) toggle.click();
          }
          apply();
        });
      });
    }

    apply();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
