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

  function money(n) {
    return '$' + Number(n).toFixed(2);
  }

  function byId(id) { return document.getElementById(id); }

  function setText(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
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
    var title = p.name + ' | MyCampusKorner';
    document.title = title;
    var pairs = [
      ['meta[name="description"]', 'content', p.name + ' — available at ' + p.merchant + '.'],
      ['meta[property="og:title"]', 'content', title],
      ['meta[name="twitter:title"]', 'content', title],
      ['meta[property="og:description"]', 'content', p.name + ' — available at ' + p.merchant + '.'],
      ['meta[name="twitter:description"]', 'content', p.name + ' — available at ' + p.merchant + '.'],
      ['meta[property="og:image"]', 'content', p.img],
      ['meta[name="twitter:image"]', 'content', p.img]
    ];
    pairs.forEach(function (t) {
      var el = document.querySelector(t[0]);
      if (el) el.setAttribute(t[1], t[2]);
    });

    var ld = byId('p-jsonld');
    if (ld) {
      var data = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        image: p.img,
        category: p.catLabel,
        url: location.href
      };
      if (p.price !== undefined) {
        data.offers = {
          '@type': 'Offer',
          price: String(p.price),
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: p.url,
          seller: { '@type': 'Organization', name: p.merchant }
        };
      }
      ld.textContent = JSON.stringify(data);
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
  }

  function init() {
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

    // No invented pricing: when the catalog has no price the line is removed
    // rather than filled with a placeholder.
    var priceWrap = byId('p-price-wrap');
    if (product.price === undefined) {
      if (priceWrap) priceWrap.style.display = 'none';
    } else {
      setText('p-price', money(product.price));
    }

    var buy = byId('p-buy');
    if (buy) buy.setAttribute('href', product.url);
    setText('p-buy-text', 'Buy at ' + product.merchant);

    var storeLink = byId('p-store-link');
    if (storeLink) storeLink.setAttribute('href', 'store-' + product.merchantSlug + '.html');
    setText('p-store-name', product.merchant);

    var img = byId('p-image');
    if (img) {
      img.setAttribute('src', product.img);
      img.setAttribute('alt', product.name);
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
