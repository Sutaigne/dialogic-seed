/* Dialogic guide: a walk-through the first time the map is opened, and a one-page reference card from then on.
   Layered over the viewer. It only drives the real UI: it clicks the real panel buttons and calls the hooks on
   window.__mm. Everything is prefixed guide- so it cannot collide with the viewer.
   The "?" button at the top left of the map opens the card; the card's last line starts the walk-through again.
   Add #guide=off to the page address to keep the walk-through from opening by itself (screenshots, embeds);
   it also stays shut when a script is driving the browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var mq = function (q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; };
  var phoneMQ = mq('(max-width: 640px)');
  var deskMQ = mq('(hover: hover) and (pointer: fine)');
  var reduceMQ = mq('(prefers-reduced-motion: reduce)');
  var MARGIN = 12;     // keep the card this far from the viewport edge
  var GAP = 14;        // space between the cutout and the card
  var PAD = 6;         // cutout padding around the target
  var SEEN_KEY = 'mm-guide';

  var PANELS = {
    filters: { el: 'filters', btn: 'btn-filters' },
    detail: { el: 'detail', btn: 'btn-detail' },
    history: { el: 'history', btn: 'btn-history' },
    share: { el: 'share', btn: 'share-bar' }
  };

  var list = [], idx = -1, active = false;
  var saved = null, cleanup = null, timers = [], rafPending = false;
  var rootEl, shieldEl, holeEl, cardEl, launchEl, refEl;

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function mm() { return window.__mm; }
  function gdata() {
    var g = mm() && mm().graph;
    return g && g.graphData ? g.graphData() : { nodes: [], links: [] };
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = []; }
  function visible(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
  function sec(id) { var e = $(id); return e && e.closest ? e.closest('.sec') : e; }
  function shown(id) { var e = $(id); return !!e && !e.hidden; }
  function tap(cap) { var w = deskMQ.matches ? 'click' : 'tap'; return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
  function rootName() { return ($('root-name') && $('root-name').textContent) || 'the root'; }
  function hasTimeline() { return !!mm() && !!mm().setTimeline && (shown('btn-timeline') || shown('timeline')); }

  function panelOpen(k) {
    var e = $(PANELS[k].el);
    return !!e && !e.classList.contains('is-collapsed');
  }
  function setPanelOpen(k, open) {
    var b = $(PANELS[k].btn);
    if (b && !b.hidden && panelOpen(k) !== open) b.click();
  }

  /* the node the viewer itself ranks first: highest strength (not a theme), else most connections */
  function topNode() {
    var ns = gdata().nodes.filter(function (n) { return n.type !== 'theme'; });
    var withStr = ns.filter(function (n) { return isNum(n.strength); });
    var pool = withStr.length ? withStr : ns;
    var key = withStr.length ? 'strength' : 'deg';
    var best = null;
    pool.forEach(function (n) {
      if (!best || (n[key] || 0) > (best[key] || 0) ||
          ((n[key] || 0) === (best[key] || 0) && String(n.label).localeCompare(String(best.label)) < 0)) best = n;
    });
    return best ? { node: best, byStrength: withStr.length > 0 } : null;
  }
  /* bring the whole map back into view (selecting a node flies the camera to it) */
  function fit() {
    var g = mm() && mm().graph;
    if (g && g.zoomToFit) g.zoomToFit(reduceMQ.matches ? 0 : 700, 50);
  }
  function selectTop() {
    var t = topNode();
    if (t && mm() && mm().select) mm().select(t.node.id, true);
    return function () { var b = $('btn-clear'); if (b) b.click(); fit(); };
  }

  /* whether this browser has already been shown the walk-through; null when storage cannot remember anything
     (blocked, or silently dropping what is written), in which case it must not open by itself on every visit */
  function seen() {
    try {
      var ls = window.localStorage;
      ls.setItem(SEEN_KEY + '-probe', '1');
      var ok = ls.getItem(SEEN_KEY + '-probe') === '1';
      ls.removeItem(SEEN_KEY + '-probe');
      return ok ? ls.getItem(SEEN_KEY) === 'seen' : null;
    } catch (e) { return null; }
  }
  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, 'seen'); } catch (e) { /* storage unavailable */ }
  }

  /* ------------------------------------------------------------------ *
   * Walk-through steps. body is a string, an array of paragraphs, or a function returning either.
   * target: function returning an element, an array of elements, or null.
   * panel: the panel the step needs open (a name, or a function returning one or null).
   * enter: runs when the step shows; may return a function that undoes it.
   * skip: function returning true when the feature is not on this map yet.
   * ------------------------------------------------------------------ */
  var STEPS = [
    {
      title: 'Welcome to Dialogic',
      body: function () {
        var g = gdata();
        var convs = mm() && mm().order ? mm().order.length : 0;
        return [
          'Dialogic is a living mind map of works, people, ideas and threads, grown one conversation at a time.',
          'This map holds ' + plural(g.nodes.length, 'node') + ' and ' + plural(g.links.length, 'link') + (convs ? ' from ' + plural(convs, 'conversation') : '') + '.',
          'The walk-through takes about a minute. Skip it whenever you like: the ? button at the top left of the map brings it back.'
        ];
      }
    },
    {
      title: 'Moving around',
      target: function () { return $('graph'); },
      prefer: ['inside'],
      body: function () {
        return deskMQ.matches
          ? 'Drag to orbit, scroll to zoom toward the pointer, and shift-drag to pan. Click a node to select it. Double-click empty space to fit the whole map.'
          : 'Drag to turn the map and pinch to zoom. Tap a node to select it.';
      }
    },
    {
      title: 'A node and its note',
      panel: 'detail',
      target: function () { return $('detail'); },
      skip: function () { return !topNode(); },
      enter: selectTop,
      body: function () {
        var t = topNode();
        var name = t ? t.node.label : 'A node';
        var p1 = name + ' is selected. It is ' + (t && t.byStrength ? 'the strongest idea on the map.' : 'the most connected node on the map.');
        var p2 = 'Detail shows its note, threads, links and change history.' + (t && t.byStrength
          ? ' Strength runs from 0 to 1. It grows when a conversation returns to the idea, fades slowly with age, and is never set by hand.' : '');
        return [p1, p2];
      }
    },
    {
      title: 'Find and filter',
      panel: 'filters',
      target: function () { return sec('search'); },
      body: function () {
        return [
          'Find: type part of a node’s name, then press Enter or pick a result to fly to it.',
          'Further down this panel, untick a node type or a thread to hide it, or narrow the links by who drew them. Verify flags only leaves what is still unconfirmed.'
        ];
      }
    },
    {
      title: 'Globes and Orbits',
      panel: function () { return phoneMQ.matches ? null : 'filters'; },
      target: function () { return phoneMQ.matches ? $('graph') : $('globes-wrap'); },
      prefer: ['inside'],
      skip: function () { return !$('globes-wrap') || !mm() || !mm().setGlobes; },
      enter: function () {
        var m = mm(), was = m.S && m.S.globes;
        if (!m.S || m.S.mode !== 'cluster') return null;
        m.setGlobes('on', false);
        fit();
        return function () { m.setGlobes(was, false); };
      },
      body: function () {
        return [
          'A globe gathers each thread’s nodes. A deeper globe is a thread returned to more often.',
          'Filters, Layout, Globes: On shows them over the map, as now. Only leaves just the globes and how they connect. Orbits sets them circling ' + rootName() + ', the most returned-to on the closest ring.'
        ];
      }
    },
    {
      title: 'Timeline',
      target: function () { return $('timeline'); },
      prefer: ['top'],
      skip: function () { return !hasTimeline() || !mm().order || mm().order.length < 2; },
      enter: function () {
        var m = mm(), wasOpen = !!m.timelineOpen, last = m.order.length - 1, t = null;
        var b = $('btn-clear'); if (b) b.click();
        fit();
        m.setTimeline(true);
        if (!reduceMQ.matches) {
          /* play the last few conversations back, so the bar is seen doing its work */
          var i = Math.max(0, last - 3);
          if (m.stop) m.stop();
          m.setUpto(i, false);
          t = setInterval(function () {
            if (i >= last) { clearInterval(t); return; }
            i++;
            m.setUpto(i, true);
          }, 900);
          timers.push(t);
        }
        return function () {
          if (t) clearInterval(t);
          if (m.stop) m.stop();
          m.setUpto(last, false);
          if (!wasOpen) m.setTimeline(false);
        };
      },
      body: function () {
        return [
          'Each tick is one conversation, oldest to newest. ' + tap(true) + ' a tick to see the map as it stood then, or press Replay to watch it grow.',
          'Spotlight dims everything the conversation on show did not touch. The Timeline button at the bottom left of the map opens this bar, and the × at its right end hides it again.'
        ];
      }
    },
    {
      title: 'Path',
      panel: 'detail',
      target: function () { return $('btn-path') || $('detail'); },
      skip: function () { return !topNode() || gdata().nodes.length < 3; },
      enter: selectTop,
      body: function () {
        return [
          'Trace a path from here finds the shortest chain of links between two nodes.',
          'Press it, then pick the second node on the map or through Find. Each hop shows its label, who drew it and which way it points.'
        ];
      }
    },
    {
      title: 'History',
      panel: 'history',
      target: function () { return $('history'); },
      skip: function () { return !shown('btn-history'); },
      body: function () {
        return 'History is the change log: every addition, change, removal and reversal, newest first. Filter by action, and ' + tap() + ' an entry to find it on the map.';
      }
    },
    {
      title: 'Share',
      panel: 'share',
      target: function () { return $('share'); },
      prefer: ['top'],
      skip: function () { return !$('share') || !shown('share-bar'); },
      body: function () {
        return [
          'Share shows what leads the conversations, grouped by Thread, Type, Field or Origin. Metric is Engagement, Mentions or Count, and Scope narrows it to one conversation.',
          tap(true) + ' a row to focus it on the map. The bar under the map opens and closes Share.'
        ];
      }
    },
    {
      title: 'Analyze',
      target: function () { return $('btn-analyze'); },
      prefer: ['bottom'],
      skip: function () { return !shown('btn-analyze'); },
      body: function () {
        return [
          'Analyze writes a reading drawn from the map: what is distinctive in it, the voice, parallels not yet drawn, and public projects worth a look. It runs on a Claude account, and only when Analyze is pressed inside it.',
          'That is the tour. The ? button at the top left of the map keeps a one-page guide, and this walk-through, within reach.'
        ];
      }
    }
  ];

  /* ------------------------------------------------------------------ *
   * Reference card rows: [label, text]. A row is left out when its feature is not on this map yet.
   * ------------------------------------------------------------------ */
  function refRows() {
    var rows = [];
    rows.push(['Move', deskMQ.matches
      ? 'Drag to orbit · scroll to zoom · shift-drag to pan · double-click to fit'
      : 'Drag to turn · pinch to zoom · tap a node']);
    rows.push(['Read', tap(true) + ' a node: its note, links and history open in Detail']);
    rows.push(['Find', 'Filters, Find: search a node by name']);
    rows.push(['Filter', 'Filters: hide node types or threads, or narrow links by who drew them']);
    if ($('globes-wrap')) rows.push(['Globes', 'Filters, Layout, Globes: On, Only, Orbits']);
    if (hasTimeline()) rows.push(['Time', 'Timeline, bottom left of the map: step through the conversations, Replay, Spotlight']);
    rows.push(['Path', 'Detail, Trace a path from here: the shortest chain between two nodes']);
    var more = [];
    if (shown('btn-history')) more.push('History: every change');
    if (shown('share-bar')) more.push('Share, under the map: what leads');
    if (shown('btn-analyze')) more.push('Analyze: a reading of the map');
    if (more.length) rows.push(['More', more.join(' · ')]);
    return rows;
  }

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function build() {
    rootEl = el('div', 'guide-root'); rootEl.id = 'guide-root'; rootEl.hidden = true;
    shieldEl = el('div', 'guide-shield'); shieldEl.id = 'guide-shield';
    holeEl = el('div', 'guide-hole'); holeEl.id = 'guide-hole'; holeEl.hidden = true;
    cardEl = el('div', 'guide-card'); cardEl.id = 'guide-card';
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-modal', 'true');
    cardEl.setAttribute('aria-labelledby', 'guide-title');
    rootEl.appendChild(shieldEl);
    rootEl.appendChild(holeEl);
    rootEl.appendChild(cardEl);
    document.body.appendChild(rootEl);

    var area = $('graph-area') || document.body;
    launchEl = el('button', 'guide-launch', '?');
    launchEl.id = 'guide-launch';
    launchEl.type = 'button';
    launchEl.title = 'Guide: how to use the map';
    launchEl.setAttribute('aria-label', 'Guide: how to use the map');
    launchEl.setAttribute('aria-expanded', 'false');
    launchEl.setAttribute('aria-controls', 'guide-ref');
    launchEl.addEventListener('click', function () { if (refOpen()) closeRef(true); else openRef(); });
    area.appendChild(launchEl);

    refEl = el('div', 'guide-ref'); refEl.id = 'guide-ref'; refEl.hidden = true;
    refEl.setAttribute('role', 'dialog');
    refEl.setAttribute('aria-labelledby', 'guide-ref-title');
    area.appendChild(refEl);
    document.addEventListener('pointerdown', function (e) {
      if (refOpen() && !refEl.contains(e.target) && e.target !== launchEl) closeRef(false);
    }, true);
  }

  function refOpen() { return !!refEl && !refEl.hidden; }
  function openRef() {
    if (active) return;
    refEl.innerHTML = '';
    var head = el('div', 'guide-ref-head');
    var h = el('h2', 'guide-ref-title', 'Guide'); h.id = 'guide-ref-title';
    var x = el('button', 'guide-btn guide-btn-quiet guide-x', '×'); x.type = 'button'; x.id = 'guide-ref-close';
    x.setAttribute('aria-label', 'Close the guide');
    x.addEventListener('click', function () { closeRef(true); });
    head.appendChild(h); head.appendChild(x);
    refEl.appendChild(head);
    var dl = el('dl', 'guide-rows');
    refRows().forEach(function (r) {
      var row = el('div', 'guide-row');
      row.appendChild(el('dt', null, r[0]));
      row.appendChild(el('dd', null, r[1]));
      dl.appendChild(row);
    });
    refEl.appendChild(dl);
    var go = el('button', 'guide-btn guide-ref-tour', 'Take the walk-through'); go.type = 'button'; go.id = 'guide-ref-tour';
    go.addEventListener('click', function () { closeRef(false); start(); });
    refEl.appendChild(go);
    refEl.hidden = false;
    launchEl.setAttribute('aria-expanded', 'true');
    try { x.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeRef(refocus) {
    if (!refOpen()) return;
    refEl.hidden = true;
    launchEl.setAttribute('aria-expanded', 'false');
    if (refocus) { try { launchEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function renderCard(step, i) {
    var n = list.length;
    var isLast = i === n - 1;
    var body = typeof step.body === 'function' ? step.body() : step.body;
    if (typeof body === 'string') body = [body];
    cardEl.innerHTML = '';
    cardEl.appendChild(el('p', 'guide-count', (i + 1) + ' / ' + n));
    var h = el('h2', 'guide-title', step.title); h.id = 'guide-title';
    cardEl.appendChild(h);
    body.forEach(function (t) { cardEl.appendChild(el('p', 'guide-body', t)); });
    var act = el('div', 'guide-actions');
    var back = el('button', 'guide-btn', 'Back'); back.type = 'button'; back.id = 'guide-back';
    back.disabled = i === 0;
    back.addEventListener('click', prev);
    var next = el('button', 'guide-btn guide-btn-primary', isLast ? 'Finish' : 'Next'); next.type = 'button'; next.id = 'guide-next';
    next.addEventListener('click', advance);
    act.appendChild(back); act.appendChild(next);
    if (!isLast) {
      var skip = el('button', 'guide-btn guide-btn-quiet', 'Skip'); skip.type = 'button'; skip.id = 'guide-skip';
      skip.addEventListener('click', function () { stop(); });
      act.appendChild(skip);
    }
    cardEl.appendChild(act);
    cardEl.scrollTop = 0;
    next.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ *
   * Panels and scrolling
   * ------------------------------------------------------------------ */
  function panelOf(step) { return (typeof step.panel === 'function' ? step.panel() : step.panel) || null; }
  function ensurePanels(step) {
    var phone = phoneMQ.matches;
    var need = panelOf(step);
    /* close first, then open, so on a phone the one panel we want ends up open */
    Object.keys(PANELS).forEach(function (k) {
      if (k === need) return;
      var transient = k === 'history' || k === 'share';
      if (phone || transient) setPanelOpen(k, false);
    });
    if (need) setPanelOpen(need, true);
  }
  function scrollInto(first) {
    var anc = first && first.closest ? first.closest('.panel') : null;
    if (!anc || !visible(anc) || first === anc) return;
    var head = anc.querySelector('.panel-head');
    var headH = head ? head.offsetHeight : 0;
    var ar = anc.getBoundingClientRect(), r = first.getBoundingClientRect();
    var want = phoneMQ.matches ? headH + 10 : Math.max(headH + 10, (ar.height - r.height) / 2);
    anc.scrollTop += (r.top - ar.top) - want;
  }

  /* ------------------------------------------------------------------ *
   * Measuring and placing
   * ------------------------------------------------------------------ */
  function targetEls(step) {
    var t = step.target ? step.target() : null;
    if (!t) return [];
    if (!t.length || t.nodeType) t = [t];
    return Array.prototype.filter.call(t, visible);
  }
  function unionRect(els) {
    var u = null;
    els.forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (!u) u = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      else {
        u.left = Math.min(u.left, r.left); u.top = Math.min(u.top, r.top);
        u.right = Math.max(u.right, r.right); u.bottom = Math.max(u.bottom, r.bottom);
      }
    });
    return u;
  }
  function overlapArea(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function holeRect(els) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var u = unionRect(els);
    if (!u) return null;
    var anc = els[0].closest ? els[0].closest('.panel') : null;
    var l = u.left - PAD, t = u.top - PAD, r = u.right + PAD, b = u.bottom + PAD;
    if (anc) {
      var ar = anc.getBoundingClientRect();
      t = Math.max(t, ar.top); b = Math.min(b, ar.bottom);
    }
    l = Math.max(0, l); t = Math.max(0, t); r = Math.min(vw, r); b = Math.min(vh, b);
    var maxH = phoneMQ.matches ? vh * 0.5 : vh - 2 * MARGIN;
    if (b - t > maxH) b = t + maxH;
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }

  function placeCard(hr, step) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = cardEl.style;
    s.left = s.top = s.right = s.bottom = '';
    if (phoneMQ.matches) {
      /* bottom sheet; flips to the top when the target sits under it */
      s.bottom = 'max(16px, env(safe-area-inset-bottom, 0px))';
      s.top = 'auto';
      if (hr) {
        var cr = cardEl.getBoundingClientRect();
        var o1 = overlapArea(cr, hr);
        if (o1 > 0) {
          s.bottom = 'auto';
          s.top = 'max(12px, env(safe-area-inset-top, 0px))';
          var o2 = overlapArea(cardEl.getBoundingClientRect(), hr);
          if (o2 >= o1) { s.top = 'auto'; s.bottom = 'max(16px, env(safe-area-inset-bottom, 0px))'; }
        }
      }
      return;
    }
    var cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
    var x, y;
    if (!hr) {
      x = (vw - cw) / 2; y = (vh - ch) / 2;
    } else {
      var wide = hr.width > vw * 0.55;
      var order = step.prefer ? step.prefer.concat(['right', 'left', 'bottom', 'top']) :
        (wide ? ['bottom', 'top', 'right', 'left'] : ['right', 'left', 'bottom', 'top']);
      var pos = null;
      for (var k = 0; k < order.length && !pos; k++) {
        var p = order[k], cx, cy;
        if (p === 'right') { cx = hr.right + GAP; cy = clamp(hr.top, MARGIN, vh - ch - MARGIN); if (cx + cw <= vw - MARGIN) pos = [cx, cy]; }
        else if (p === 'left') { cx = hr.left - GAP - cw; cy = clamp(hr.top, MARGIN, vh - ch - MARGIN); if (cx >= MARGIN) pos = [cx, cy]; }
        else if (p === 'bottom') { cy = hr.bottom + GAP; cx = clamp(hr.left, MARGIN, vw - cw - MARGIN); if (cy + ch <= vh - MARGIN) pos = [cx, cy]; }
        else if (p === 'top') { cy = hr.top - GAP - ch; cx = clamp(hr.left, MARGIN, vw - cw - MARGIN); if (cy >= MARGIN) pos = [cx, cy]; }
        else if (p === 'inside') { if (hr.width >= cw + 48 && hr.height >= ch + 48) pos = [hr.left + 24, hr.top + 24]; }
      }
      if (!pos) pos = [hr.left + 24, hr.top + 24];
      x = pos[0]; y = pos[1];
    }
    s.left = clamp(x, MARGIN, Math.max(MARGIN, vw - cw - MARGIN)) + 'px';
    s.top = clamp(y, MARGIN, Math.max(MARGIN, vh - ch - MARGIN)) + 'px';
  }

  function measure() {
    if (!active || idx < 0) return;
    var step = list[idx];
    var els = targetEls(step);
    var hr = els.length ? holeRect(els) : null;
    if (hr) {
      holeEl.hidden = false;
      holeEl.style.left = hr.left + 'px';
      holeEl.style.top = hr.top + 'px';
      holeEl.style.width = hr.width + 'px';
      holeEl.style.height = hr.height + 'px';
      shieldEl.classList.remove('is-dim');
    } else {
      holeEl.hidden = true;
      shieldEl.classList.add('is-dim');
    }
    placeCard(hr, step);
  }
  function scheduleMeasure() {
    if (rafPending) return;
    rafPending = true;
    (window.requestAnimationFrame || setTimeout)(function () { rafPending = false; measure(); });
  }

  /* ------------------------------------------------------------------ *
   * Flow
   * ------------------------------------------------------------------ */
  function runCleanup() {
    clearTimers();
    var c = cleanup; cleanup = null;
    if (c) { try { c(); } catch (e) { /* the viewer may already be reset */ } }
  }
  function show(i) {
    runCleanup();
    idx = clamp(i, 0, list.length - 1);
    var step = list[idx];
    ensurePanels(step);
    if (step.enter) cleanup = step.enter() || null;
    var els = targetEls(step);
    if (els.length) scrollInto(els[0]);
    renderCard(step, idx);
    measure();
    /* panels and the canvas settle after a click; measure again */
    later(measure, 120);
    later(measure, 350);
    later(measure, 700);
  }
  function advance() { if (idx >= list.length - 1) stop(); else show(idx + 1); }
  function prev() { if (idx > 0) show(idx - 1); }

  function saveState() {
    saved = {};
    Object.keys(PANELS).forEach(function (k) { saved[k] = panelOpen(k); });
  }
  function restoreState() {
    if (!saved) return;
    Object.keys(saved).forEach(function (k) { if (!saved[k]) setPanelOpen(k, false); });
    Object.keys(saved).forEach(function (k) { if (saved[k]) setPanelOpen(k, true); });
    saved = null;
  }

  function start() {
    if (active || !mm() || !mm().graph) return;
    list = STEPS.filter(function (s) { return !(s.skip && s.skip()); });
    if (!list.length) return;
    closeRef(false);
    saveState();
    active = true;
    rootEl.hidden = false;
    launchEl.hidden = true;
    show(0);
  }
  /* Skip, Finish and Esc all end here: the walk-through has been offered, so it will not open by itself again. */
  function stop() {
    if (!active) return;
    runCleanup();
    active = false;
    idx = -1;
    rootEl.hidden = true;
    holeEl.hidden = true;
    restoreState();
    markSeen();
    launchEl.hidden = false;
    try { launchEl.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function onKey(e) {
    var k = e.key;
    if (!active) {
      if (k === 'Escape' && refOpen()) { e.preventDefault(); e.stopPropagation(); closeRef(true); }
      return;
    }
    var tag = e.target && e.target.tagName;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); return; }
    if (k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); advance(); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); prev(); return; }
    if (k === 'Enter' && tag !== 'BUTTON') { e.preventDefault(); advance(); return; }
    if (k === 'Tab') {
      var fs = Array.prototype.filter.call(cardEl.querySelectorAll('button'), function (b) { return !b.disabled; });
      if (!fs.length) return;
      var first = fs[0], last = fs[fs.length - 1];
      var cur = document.activeElement;
      if (!cardEl.contains(cur)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
  }

  /* Opens by itself once per browser: only when storage can remember that it did, no script is driving the page,
     and the address does not say #guide=off. */
  function shouldAutoStart() {
    var hash = String(window.location.hash || '');
    if (/guide=off/.test(hash)) return false;
    if (/guide=tour/.test(hash)) return true;
    if (window.navigator && window.navigator.webdriver) return false;
    return seen() === false;
  }

  function init() {
    build();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    /* a short wait lets the first layout and fonts settle before the walk-through opens */
    if (shouldAutoStart()) setTimeout(start, 700);
  }

  var tries = 0;
  (function poll() {
    if (window.__mm && window.__mm.graph) { init(); return; }
    if (++tries > 300) return;
    setTimeout(poll, 100);
  })();

  window.__guide = { start: start, stop: stop, open: openRef, close: closeRef, get active() { return active; } };
})();
