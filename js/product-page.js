/*
 * product-page.js — fills product.html from js/products.js.
 *
 * One page serves every product. Which one is chosen by the `id` query
 * parameter, e.g. product.html?id=tara-4-pc-bath-accessory-set. Ids come from
 * the catalog and are permalinks, so they must stay stable once published.
 *
 * Nothing is fetched: products.js is a plain script include, so this works
 * from file:// exactly like the rest of the site. It also owns the Swiper for
 * the related-products rail, because that has to be initialised after the
 * slides exist rather than at parse time.
 */
(function () {
  'use strict';

  // The page's Function (functions/*.js) usually writes a fuller title and
  // description into the HTML itself. Only fill them in when it did not --
  // i.e. the page still has its template title -- so search engines, which
  // read the page after scripts run, see the same text either way.
  var TEMPLATE_TITLE = /^(Product|Category|Store|Article|Blog Category) \| MyCampusKorner$/;
  function headIsTemplate() { return TEMPLATE_TITLE.test(document.title); }

  var SWIPER_OPTS = {
    spaceBetween: 16,
    slidesPerView: 'auto',
    navigation: { nextEl: '.swiper-btn-next', prevEl: '.swiper-btn-prev' },
    breakpoints: { 768: { spaceBetween: 20 }, 992: { spaceBetween: 24 } }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "$1,299.00" -- the same figure the baked store cards (build_listings.py)
  // and the category pages (listing-page.js) show.
  function money(n) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function byId(id) { return document.getElementById(id); }

  function setText(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
  }

  /*
   * Copy for the "About this product" section.
   *
   * A catalog entry may carry its own `desc` string in js/products.js — add one
   * to any product and it is used verbatim. Without it, fall back to a sentence
   * built only from what the catalog actually knows (name, category, merchant)
   * rather than inventing specifications the retailer never stated.
   */
  function describe(p) {
    if (p.desc) return p.desc;
    return p.name + ' is one of our ' + p.catLabel + ' picks for campus life, ' +
      'available from ' + p.merchant + '. Head to ' + p.merchant +
      ' for the full specifications, current price and availability.';
  }

  /* Related rail: same category first, topped up with anything else so the
     rail never looks broken for a category that only holds one or two items. */
  function relatedTo(product, all, want) {
    var same = all.filter(function (p) { return p.cat === product.cat && p.id !== product.id; });
    var rest = all.filter(function (p) { return p.cat !== product.cat; });
    return same.concat(rest).slice(0, want);
  }

  function slide(p) {
    var price = p.price === undefined ? '' :
      '<div class="product-price-wrap">' +
        '<h4 class="heading-style-five font-second text-color-green">' + esc(money(p.price)) + '</h4>' +
      '</div>';
    return '' +
      '<div class="swiper-slide w-dyn-item" data-cats="' + esc(p.cat) + '"' +
        ' data-href="product.html?id=' + esc(p.id) + '"' +
        ' data-name="' + esc(p.name) + '"' +
        (p.price === undefined ? '' : ' data-price="' + esc(Number(p.price).toFixed(2)) + '"') +
        ' role="listitem">' +
        '<div class="prodact-slider-cn-wrap">' +
          '<div class="product-img-wrap">' +
            '<img alt="' + esc(p.name) + '" class="full-img" loading="lazy" src="' + esc(p.img) + '"/>' +
          '</div>' +
          '<div class="prodact-slider-cn">' +
            '<div class="review-main-wrap">' +
              '<div class="offer-text-wrap">' + esc(p.merchant) + '</div>' +
            '</div>' +
            '<h3 class="text-size-medium font-second text-weight-normal text-style-2lines">' + esc(p.name) + '</h3>' +
            price +
            '<a class="pr-btn-wrap w-variant-fc58d251-c396-31a8-d55a-a5f36995ac5d w-inline-block"' +
              ' data-wf--pr-btn-wrap--variant="three" href="product.html?id=' + esc(p.id) + '">' +
              '<div class="pr-btn-text">View product</div>' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function fillHead(p) {
    if (!headIsTemplate()) return;    // the Function already wrote this page's head
    var title = p.name + ' | MyCampusKorner';
    document.title = title;
    var pairs = [
      ['meta[name="description"]', 'content', p.name + ', available at ' + p.merchant + '.'],
      ['meta[property="og:title"]', 'content', title],
      ['meta[name="twitter:title"]', 'content', title],
      ['meta[property="og:description"]', 'content', p.name + ', available at ' + p.merchant + '.'],
      ['meta[name="twitter:description"]', 'content', p.name + ', available at ' + p.merchant + '.'],
      ['meta[property="og:image"]', 'content', p.img],
      ['meta[name="twitter:image"]', 'content', p.img]
    ];
    pairs.forEach(function (t) {
      var el = document.querySelector(t[0]);
      if (el) el.setAttribute(t[1], t[2]);
    });

    var ld = byId('p-jsonld');
    if (ld) {
      // Only reached when the page is served without its Function (which
      // writes this markup server-side). Same rule: a price is stated only
      // when the site shows prices, and no stock level is ever claimed.
      var data = window.SHOW_PRICES && typeof p.price === 'number' ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        image: p.img,
        category: p.catLabel,
        url: location.href,
        brand: { '@type': 'Brand', name: p.merchant },
        offers: {
          '@type': 'Offer',
          price: String(p.price),
          priceCurrency: 'USD',
          url: p.url,
          seller: { '@type': 'Organization', name: p.merchant }
        }
      } : {
        '@context': 'https://schema.org',
        '@type': 'ItemPage',
        name: p.name,
        url: location.href,
        primaryImageOfPage: { '@type': 'ImageObject', url: p.img }
      };
      ld.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    }
  }

  function notFound() {
    setText('p-name', 'Product not found');
    setText('p-category', '');
    var wrap = byId('p-price-wrap');
    if (wrap) wrap.style.display = 'none';
    var buy = byId('p-buy');
    if (buy) {
      buy.setAttribute('href', 'store.html');
      buy.removeAttribute('target');
      setText('p-buy-text', 'Browse all products');
    }
    var img = byId('p-image');
    if (img) img.style.display = 'none';
    var store = byId('p-store-link');
    if (store) store.style.display = 'none';
    var about = byId('p-about');
    if (about) about.style.display = 'none';
  }

  // The photo fills its panel (object-fit: contain, see #p-image in
  // product.html), so a small image is blown up and looks blurry. With
  // IMAGE_ENLARGE_LIMIT (js/site-config.js) above 0 it is enlarged at most
  // that many times instead: its inset grows until the space it is fitted
  // into is exactly the capped size, so it sits centred and smaller. The
  // panel itself never changes size, so nothing around it moves.
  function capPhoto(img) {
    var limit = Number(window.IMAGE_ENLARGE_LIMIT) || 0;
    img.style.padding = '';
    if (limit <= 0 || !img.naturalWidth || !img.naturalHeight) return;
    var cs = window.getComputedStyle(img);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var w = img.clientWidth - padX, h = img.clientHeight - padY;
    if (w <= 0 || h <= 0) return;
    if (Math.min(w / img.naturalWidth, h / img.naturalHeight) <= limit) return;
    var cw = img.naturalWidth * limit, ch = img.naturalHeight * limit;
    img.style.padding = ((img.clientHeight - ch) / 2) + 'px ' + ((img.clientWidth - cw) / 2) + 'px';
  }

  // Again whenever the panel changes size (a resize, or the narrow layout,
  // where the photo stacks under the text). The panel, not the photo: the
  // photo's own inner size changes with every capPhoto(), the panel's never.
  function watchPhoto(img) {
    var panel = img.parentNode;
    if (window.ResizeObserver && panel) {
      new ResizeObserver(function () { capPhoto(img); }).observe(panel);
    } else {
      window.addEventListener('resize', function () { capPhoto(img); });
    }
  }

  // A category renamed in the Categories tab (js/categories.js) shows its
  // new name at once, before each of its products has been saved again.
  function relabel() {
    var names = {};
    (window.CATEGORIES || []).forEach(function (c) { if (c && c.id && c.name) names[c.id] = c.name; });
    (window.PRODUCTS || []).forEach(function (p) { if (p && names[p.cat]) p.catLabel = names[p.cat]; });
  }

  function init() {
    relabel();
    var all = window.PRODUCTS || [];
    var id = new URLSearchParams(window.location.search).get('id');
    var product = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { product = all[i]; break; }
    }

    if (!product) {
      notFound();
      return;
    }

    setText('p-category', product.catLabel);
    setText('p-name', product.name);
    setText('p-description', describe(product));

    // No invented pricing: when the catalog has no price the line is removed
    // rather than filled with a placeholder.
    var priceWrap = byId('p-price-wrap');
    if (product.price === undefined) {
      if (priceWrap) priceWrap.style.display = 'none';
    } else {
      setText('p-price', money(product.price));
    }

    var buy = byId('p-buy');
    // Only a real web address becomes the Buy link (never "javascript:" etc.).
    if (buy) buy.setAttribute('href', /^https?:\/\//i.test(product.url || '') ? product.url : 'store.html');
    setText('p-buy-text', 'Buy at ' + product.merchant);

    var storeLink = byId('p-store-link');
    if (storeLink) storeLink.setAttribute('href', 'merchant.html?id=' + product.merchantSlug);
    setText('p-store-name', product.merchant);

    var img = byId('p-image');
    if (img) {
      img.addEventListener('load', function () { capPhoto(img); });
      img.setAttribute('src', product.img);
      img.setAttribute('alt', product.name);
      watchPhoto(img);
    }

    var rail = byId('p-related');
    if (rail) {
      rail.innerHTML = relatedTo(product, all, 8).map(slide).join('');
    }

    fillHead(product);

    if (typeof Swiper !== 'undefined') {
      new Swiper('.myswiper', SWIPER_OPTS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
