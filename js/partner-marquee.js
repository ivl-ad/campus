/*
 * partner-marquee.js — turns js/partners.js into the scrolling logo strip.
 *
 * index.html ships the strip (.logo-marquee-main-wrap) with twelve
 * MyCampusKorner wordmarks. This runs just before the page's marquee script
 * starts the scroll and, if there are partners, swaps the boxes for their
 * logos, each linking to its partner:
 *
 *   0 partners   nothing changes -- the wordmark strip stays exactly as it was
 *   1 partner    every box shows that one logo
 *   2+ partners  all of them in order, then the list starts again. Whole
 *                rounds are repeated until the strip has at least the twelve
 *                boxes it always had and spans the screen, so the loop never
 *                shows a gap or breaks the order at the seam
 *   many         more than span the screen: listed once, and the marquee
 *                simply loops it
 *
 * The scroll keeps the original speed per box, and pauses on hover (desktop)
 * so a logo is easy to click.
 *
 * Logos come in every shape -- wide wordmarks, square icons -- so each one is
 * sized to the same visual area rather than the same width or height.
 *
 * /admin/ draws its live preview of the strip with this same file.
 */
(function () {
  'use strict';

  var BASE_BOXES = 12;     // boxes in the original strip
  var BASE_DURATION = 40;  // its data-marquee-duration (seconds) for those twelve

  // Fractions of the box width. A logo covers the area of a square AREA wide;
  // MAX_W and MAX_H keep very wide or very tall logos off the box edges.
  var AREA = 0.3, MAX_W = 0.7, MAX_H = 0.42;

  function linkFor(p) {
    var u = String(p.url || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  function fit(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return;    // shape unknown: the CSS max-width/max-height caps apply
    var r = w / h;
    var width = Math.min(AREA * Math.sqrt(r), MAX_W, MAX_H * r);
    img.style.width = (width * 100).toFixed(2) + '%';
    img.style.height = 'auto';
  }

  // Capture phase, on the strip, because load does not bubble -- and this way
  // it also covers the copy the marquee script clones after we are done.
  function onLoad(ev) {
    if (ev.target && ev.target.classList && ev.target.classList.contains('partner-logo')) {
      fit(ev.target);
    }
  }

  function box(p, repeat) {
    var href = linkFor(p);
    var el = document.createElement(href ? 'a' : 'div');
    el.className = 'logo-marquee-box partner-box';
    if (href) {
      el.href = href;
      el.target = '_blank';
      el.rel = 'noopener';
    }
    if (p.name) el.title = p.name;
    if (repeat) {
      // Later rounds are visual only: read and tab through each partner once.
      el.setAttribute('aria-hidden', 'true');
      if (href) el.tabIndex = -1;
    }
    var img = document.createElement('img');
    img.className = 'partner-logo';
    img.alt = p.name || '';
    img.decoding = 'async';
    img.src = String(p.logo).trim();
    el.appendChild(img);
    return el;
  }

  /*
   * Fill wrap's [data-marquee-list] with partner boxes. Returns false (and
   * touches nothing) when there are no usable partners, otherwise
   * {partners, rounds, boxes}. opts.width overrides the width the strip has
   * to span (the admin preview passes its own).
   */
  function render(wrap, partners, opts) {
    var list = wrap && wrap.querySelector('[data-marquee-list]');
    if (!list) return false;
    var items = (partners || []).filter(function (p) {
      return p && String(p.logo || '').trim();
    });
    if (!items.length) return false;

    wrap.addEventListener('load', onLoad, true);
    list.textContent = '';
    items.forEach(function (p) { list.appendChild(box(p, false)); });

    var rounds = Math.ceil(BASE_BOXES / items.length);
    var boxWidth = list.firstChild.getBoundingClientRect().width;
    var span = (opts && opts.width) ||
               Math.max(window.innerWidth || 0, (window.screen && window.screen.width) || 0);
    if (boxWidth > 0) rounds = Math.max(rounds, Math.ceil(span / (boxWidth * items.length)));
    for (var i = 1; i < rounds; i++) {
      items.forEach(function (p) { list.appendChild(box(p, true)); });
    }

    var boxes = list.children.length;
    wrap.setAttribute('data-marquee-duration', String(Math.round(BASE_DURATION * boxes / BASE_BOXES)));
    wrap.setAttribute('data-marquee-pause-hover', 'true');
    wrap.classList.add('has-partners');
    return { partners: items.length, rounds: rounds, boxes: boxes };
  }

  window.PartnerMarquee = { render: render, fit: fit };

  // On the home page: swap the strip now, before the marquee script clones it.
  var strip = document.querySelector('.logo-marquee-main-wrap');
  if (strip && Array.isArray(window.PARTNERS)) render(strip, window.PARTNERS);
})();
