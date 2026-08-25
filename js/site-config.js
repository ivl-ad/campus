/*
 * site-config.js — hardcoded site-wide switches.
 *
 * Loaded first in <head>, before anything paints, so a page renders in its
 * final state with no flash of content that is meant to be hidden. Flip a
 * value here and every page picks it up — no other file needs editing.
 */

/* ---------------------------------------------------------------- prices ---
 * Show every product price across the site, or hide them all.
 *
 *   true  = prices visible (product cards, the home page rail, and the
 *           product detail page)
 *   false = every price hidden
 *
 * Hiding is presentational only: the catalog keeps its price data, so the
 * "sort by price" control on the listing pages still works.
 */
var SHOW_PRICES = false;


(function () {
  'use strict';
  window.SHOW_PRICES = SHOW_PRICES;
  // css/site-custom.css keys off this class on <html>.
  if (!SHOW_PRICES) {
    document.documentElement.className += ' prices-hidden';
  }
})();
