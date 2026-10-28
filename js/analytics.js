/*
 * analytics.js -- the site's own visit counter (no cookies, nothing stored on
 * the visitor's device, no third party).
 *
 * Tells /hit (functions/hit.js) which page was opened and the address of the
 * page that linked here, and, when a visitor follows a link out of the site,
 * which retailer it went to: a product's "Buy" button (by product id), a
 * partner logo (by partner name) or any other link (by site name). The server
 * only adds 1 to daily totals -- see functions/_shared/stats.js. The numbers
 * are in the editor under Analytics.
 *
 * A browser the team uses can be left out of the counts from that page
 * ("Don't count this browser"), which sets the flag read below.
 */
(function () {
  'use strict';
  if (!/^https?:$/.test(location.protocol) || navigator.webdriver) return;
  try { if (localStorage.getItem('mckNoStats') === '1') return; } catch (e) { /* storage off: count */ }

  function send(data) {
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/hit', new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* fall through */ }
    try {
      fetch('/hit', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } });
    } catch (e) { /* a lost count is fine */ }
  }

  var here = { p: location.pathname, q: location.search };
  send({ t: 'pv', p: here.p, q: here.q, r: document.referrer });

  function outbound(ev) {
    if (ev.type === 'auxclick' && ev.button !== 1) return;       // middle click only
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || !/^https?:$/.test(a.protocol) || a.host === location.host) return;
    var hit = { t: 'out', p: here.p, q: here.q, u: a.href, k: 'link' };
    if (a.id === 'p-buy') {
      hit.k = 'product';
      try { hit.id = new URLSearchParams(location.search).get('id') || ''; } catch (e) { /* none */ }
    } else if (a.classList.contains('partner-box')) {
      hit.k = 'partner';
      hit.n = a.title || (a.querySelector('img') || {}).alt || '';
    }
    send(hit);
  }
  document.addEventListener('click', outbound, true);
  document.addEventListener('auxclick', outbound, true);
})();
