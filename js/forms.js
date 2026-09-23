/*
 * forms.js — sends the newsletter and contact forms to our own endpoints
 * (/forms/newsletter, /forms/contact; see functions/_shared/forms.js).
 *
 * The forms already work without this file: each has a real action/method,
 * so with JavaScript off the browser posts it and comes back to the page.
 * This just keeps the visitor on the page and uses Webflow's own
 * "Thank you!" / "Oops!" boxes that sit next to every form.
 *
 * Also: contact-us.html?reason=partner preselects "Partnership" (the
 * "Become a Partner" links use it).
 */
(function () {
  'use strict';

  function isOurs(form) {
    var action = form.getAttribute('action') || '';
    return action.indexOf('/forms/') === 0;
  }

  function box(form, cls) {
    var wrap = form.parentNode;
    return wrap && wrap.querySelector(':scope > .' + cls);
  }

  // Capture on window runs before webflow.js sees the event, and before the
  // browser's own submit, so we fully own these forms.
  window.addEventListener('submit', function (evt) {
    var form = evt.target;
    if (!form || form.tagName !== 'FORM' || !isOurs(form) || !window.fetch) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();

    var button = form.querySelector('[type="submit"]');
    var label = button && button.value;
    var done = box(form, 'w-form-done');
    var fail = box(form, 'w-form-fail');
    if (button) { button.disabled = true; button.value = button.getAttribute('data-wait') || 'Please wait...'; }
    if (fail) fail.style.display = 'none';

    var data = {};
    new FormData(form).forEach(function (v, k) { if (typeof v === 'string') data[k] = v; });
    data.page = location.pathname + location.search;

    fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || 'Something went wrong.');
        });
      })
      .then(function () {
        form.reset();
        if (done) { form.style.display = 'none'; done.style.display = 'block'; }
        else if (button) { button.value = 'Thank you!'; return; }
        if (window.gtag) window.gtag('event', form.getAttribute('data-form-event') || 'generate_lead');
      })
      .catch(function (err) {
        if (fail) {
          var msg = fail.querySelector('div') || fail;
          msg.textContent = err.message || 'Oops! Something went wrong while submitting the form.';
          fail.style.display = 'block';
        } else {
          alert(err.message);
        }
      })
      .then(function () {
        if (button) { button.disabled = false; if (form.style.display !== 'none') button.value = label; }
      });
  }, true);

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // No-JS path lands back here with #form-sent / #form-error.
    var hash = location.hash;
    if (hash === '#form-sent' || hash === '#form-error') {
      Array.prototype.forEach.call(document.querySelectorAll('form[action^="/forms/"]'), function (form) {
        var el = box(form, hash === '#form-sent' ? 'w-form-done' : 'w-form-fail');
        if (el) { el.style.display = 'block'; if (hash === '#form-sent') form.style.display = 'none'; }
      });
    }

    var reason = new URLSearchParams(location.search).get('reason');
    var select = document.querySelector('form[action="/forms/contact"] select[name="reason"]');
    if (reason && select) {
      Array.prototype.forEach.call(select.options, function (o) {
        if (o.value.toLowerCase() === reason.toLowerCase()) select.value = o.value;
      });
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
})();
