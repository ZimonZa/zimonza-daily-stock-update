/* ═══════════════════════════════════════════════════════════════
   ZIMONZA — Midnight Zari effects
   Plain script, deferred, no imports. Adds the motion the stylesheet
   cannot do on its own: scroll reveals, counting numbers, and pausing
   the ambient animation when nobody is looking.

   Every effect here is opt-out under prefers-reduced-motion, and every
   observer disconnects once it has done its job.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Ambient drift costs nothing when the tab is hidden ───────
  function pauseAmbient() {
    document.documentElement.style.setProperty(
      '--zari-ambient-play', document.hidden ? 'paused' : 'running'
    );
    document.body.classList.toggle('zm-hidden-tab', document.hidden);
  }
  document.addEventListener('visibilitychange', pauseAmbient);

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    pauseAmbient();
    if (reduced) return;

    // ─── Reveal sections as they scroll in, once each ───────────
    var targets = document.querySelectorAll('.glass-card, .kpi-tile, .mrg-group-card, .pur-panel');
    if (targets.length && 'IntersectionObserver' in window) {
      // Anything already on screen at load is handled by the page-load
      // cascade in CSS; only reveal what is genuinely below the fold.
      var viewportBottom = window.innerHeight;
      var below = [];
      targets.forEach(function (node) {
        if (node.getBoundingClientRect().top > viewportBottom) {
          node.classList.add('zm-reveal');
          below.push(node);
        }
      });

      if (below.length) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);          // one shot, then let it go
          });
          if (!document.querySelectorAll('.zm-reveal:not(.is-in)').length) io.disconnect();
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
        below.forEach(function (node) { io.observe(node); });
      }
    }

    // ─── Count KPI numbers up on first sight ───────────────────
    countUp();
  });

  /**
   * Animate any .kpi-tile-value that holds a plain number.
   * Values carrying currency or units are left alone — a rupee total
   * ticking upward reads as a bug, not a flourish.
   */
  function countUp(root) {
    if (reduced) return;
    var nodes = (root || document).querySelectorAll('.kpi-tile-value:not([data-counted])');
    Array.prototype.forEach.call(nodes, function (node) {
      var raw = (node.textContent || '').trim();
      if (!/^\d{1,6}$/.test(raw)) { node.setAttribute('data-counted', 'skip'); return; }
      var target = parseInt(raw, 10);
      if (target < 3) { node.setAttribute('data-counted', 'skip'); return; }

      node.setAttribute('data-counted', '1');
      var start = null;
      var dur = Math.min(900, 240 + target * 6);

      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        // ease-out-cubic: fast then settling, so the final value is readable
        var eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
        else node.textContent = raw;
      }
      requestAnimationFrame(step);
    });
  }

  // Pages re-render their KPI strip after loading data
  window.zariCountUp = countUp;
})();
