(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */
  var DATA = JSON.parse(document.getElementById('graph-data').textContent);
  var META = DATA.meta || {};
  var THREADS = DATA.threads || [];
  var ROOT = META.rootNode;
  var LOG = Array.isArray(DATA.log) ? DATA.log : [];
  var CONVS = Array.isArray(META.conversations) ? META.conversations : [];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var cssRoot = getComputedStyle(document.documentElement);
  var cv = function (name, fb) { return (cssRoot.getPropertyValue(name) || '').trim() || fb; };
  var BONE = cv('--bone', '#EFE7D8');
  var INK = cv('--ink', '#15181D');
  var OX = cv('--oxblood', '#7A2230');
  var FO = cv('--forest', '#2C4A38');

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* Node type palette: restrained. */
  var TYPES = [
    { id: 'theme',   name: 'Theme',          color: INK },
    { id: 'person',  name: 'Person',         color: '#9B3B48' },
    { id: 'work',    name: 'Work',           color: '#4A6E57' },
    { id: 'place',   name: 'Place',          color: '#B08A3E' },
    { id: 'concept', name: 'Concept',        color: '#5E7380' },
    { id: 'project', name: 'Project',        color: '#C0652F' },
    { id: 'paper',   name: 'Research paper', color: '#84708A' },
    { id: 'school',  name: 'School',         color: '#7A6A3A' }
  ];
  var TYPE_BY_ID = {};
  /* any node type the palette does not know still gets a filter + legend entry */
  (function () {
    var spare = ['#6B6F4E', '#8C5A3C', '#4F6A6A'], k = 0;
    (DATA.nodes || []).forEach(function (n) {
      if (!TYPES.some(function (t) { return t.id === n.type; })) {
        TYPES.push({ id: n.type, name: n.type.charAt(0).toUpperCase() + n.type.slice(1), color: spare[k++ % spare.length] });
      }
    });
  })();
  TYPES.forEach(function (t) { TYPE_BY_ID[t.id] = t; });
  var ACTIONS = ['added', 'modified', 'removed', 'reweighted', 'reversed'];
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var OWNER_NAME = (function () {
    var r = (DATA.nodes || []).filter(function (n) { return n.id === ROOT; })[0];
    return r ? r.label : 'Owner';
  })();
  var ORIGINS = [
    { id: 'owner',  name: OWNER_NAME },
    { id: 'claude', name: 'Claude' },
    { id: 'shared', name: 'Shared' }
  ];
  var EDGE_TYPES = ['wrote', 'influenced', 'parallels', 'critiques', 'applies-to', 'belongs-to'];

  var nodes = DATA.nodes.map(function (n) {
    return Object.assign({}, n, { deg: 0, threads: n.threads && n.threads.length ? n.threads : [] });
  });
  var byId = new Map(nodes.map(function (n) { return [n.id, n]; }));
  var links = DATA.edges.filter(function (e) { return byId.has(e.source) && byId.has(e.target); })
    .map(function (e) {
      var l = Object.assign({}, e);
      l.sid = e.source; l.tid = e.target;
      if (l.id == null || l.id === '') l.id = e.source + '>' + e.target + ':' + e.type;
      return l;
    });
  var linkById = new Map(links.map(function (l) { return [l.id, l]; }));
  var HAS_STR = nodes.some(function (n) { return isNum(n.strength); });
  var HAS_EDGE_STR = links.some(function (l) { return isNum(l.strength); });
  var strSorted = nodes.filter(function (n) { return isNum(n.strength) && n.type !== 'theme'; })
    .map(function (n) { return n.strength; }).sort(function (a, b) { return a - b; });
  var STRONG_T = strSorted.length ? strSorted[Math.floor(strSorted.length * 0.85)] : 2;
  links.forEach(function (l) { byId.get(l.sid).deg++; byId.get(l.tid).deg++; });
  var adj = new Map(nodes.map(function (n) { return [n.id, []]; }));
  links.forEach(function (l) {
    adj.get(l.sid).push({ l: l, other: l.tid, out: true });
    adj.get(l.tid).push({ l: l, other: l.sid, out: false });
  });

  /* True conversation order = first appearance in the append-only log.
     META.conversations is sorted by date then id, which is not the order things happened in. */
  var CONV_ORDER = [], CONV_BY_ID = {}, CONV_IDX = {};
  CONVS.forEach(function (c) { CONV_BY_ID[c.id] = c; });
  (function () {
    var seen = {};
    LOG.forEach(function (en) {
      var src = String(en.source || '');
      var id = src.slice(src.indexOf(' ') + 1);
      if (id && !seen[id] && CONV_BY_ID[id]) { seen[id] = true; CONV_ORDER.push(id); }
    });
    CONVS.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = true; CONV_ORDER.push(c.id); } });
    CONV_ORDER.forEach(function (id, i) { CONV_IDX[id] = i; });
  })();
  var LASTC = Math.max(0, CONV_ORDER.length - 1);
  var HAS_TIME = CONV_ORDER.length > 1;
  function convSpan(it) {
    var f = null, l = null;
    Object.keys(it.byConv || {}).forEach(function (k) {
      var i = CONV_IDX[k];
      if (i == null) return;
      if (f == null || i < f) f = i;
      if (l == null || i > l) l = i;
    });
    return [f, l];
  }
  nodes.forEach(function (n) {
    var sp = convSpan(n);
    n._first = sp[0] == null ? 0 : sp[0];
    n._last = sp[1] == null ? n._first : sp[1];
  });
  links.forEach(function (l) {
    var sp = convSpan(l);
    var ends = Math.max(byId.get(l.sid)._first, byId.get(l.tid)._first);
    /* structural links carry no ledger: they exist as soon as both ends do */
    l._first = sp[0] == null ? ends : Math.max(sp[0], ends);
    l._last = sp[1] == null ? LASTC : sp[1];
  });
  var CONV_STATS = CONV_ORDER.map(function (id, i) {
    var st = { nodes: 0, links: 0, back: 0 };
    nodes.forEach(function (n) {
      if (n._first === i) st.nodes++;
      else if (n._first < i && n.byConv && n.byConv[id] > 0) st.back++;
    });
    links.forEach(function (l) { if (l.type !== 'belongs-to' && l._first === i) st.links++; });
    return st;
  });
  /* the dozen strongest ideas keep a readable label at any zoom */
  var TOP_IDS = new Set(nodes.filter(function (n) { return n.type !== 'theme' && isNum(n.strength); })
    .sort(function (a, b) { return b.strength - a.strength || a.label.localeCompare(b.label); })
    .slice(0, 12).map(function (n) { return n.id; }));

  var threadIndex = {};
  THREADS.forEach(function (t, i) { threadIndex[t.id] = i; });
  nodes.forEach(function (n) {
    var ti = threadIndex[n.threads[0]];
    n._ti = ti == null ? 0 : ti;
  });

  var sortedDeg = nodes.map(function (n) { return n.deg; }).sort(function (a, b) { return a - b; });
  var HUB_DEG = Math.max(5, sortedDeg[Math.floor(sortedDeg.length * 0.85)] || 5);

  function displayLabel(n) {
    if (n.type === 'theme' && n.label.charAt(0) !== '§') return '§ ' + (n.threads[0] || '') + '  ' + n.label;
    return n.label;
  }
  function alwaysLabel(n) {
    return n.type === 'theme' || n.id === ROOT || n.deg >= HUB_DEG ||
      (S.size === 'strength' && isNum(n.strength) && n.strength >= STRONG_T);
  }

  /* sizes */
  var REL = 3.5;
  function nodeVal(n) {
    if (S.size === 'strength' && HAS_STR) {
      var v2 = 2 + 14 * (isNum(n.strength) ? n.strength : 0);
      if (n.type === 'theme') v2 = Math.max(v2 * 2, 16);
      if (n.id === ROOT) v2 = Math.max(v2 * 3.5, 34);
      return v2;
    }
    var v = 1 + 3 * Math.sqrt(n.deg);
    if (n.type === 'theme') v *= 2;
    if (n.id === ROOT) v *= 3.5;
    return v;
  }
  function edgeStr(l) {
    return l.basis !== 'index' && l.type !== 'belongs-to' && isNum(l.strength) ? Math.max(0, Math.min(1, l.strength)) : null;
  }
  function loadSize() {
    try { var v = window.localStorage.getItem('mm-size-by'); if (v === 'strength' || v === 'conn') return v; } catch (e) { /* storage unavailable */ }
    return HAS_STR ? 'strength' : 'conn';
  }
  function loadInk() {
    try { var v = window.localStorage.getItem('mm-ink'); if (v === 'recency' || v === 'even') return v; } catch (e) { /* storage unavailable */ }
    return 'even';
  }
  function saveInk(v) { try { window.localStorage.setItem('mm-ink', v); } catch (e) { /* storage unavailable */ } }
  function saveSize(v) { try { window.localStorage.setItem('mm-size-by', v); } catch (e) { /* storage unavailable */ } }
  function loadShare() {
    var d = { group: 'thread', metric: 'engagement', scope: '', expanded: {} };
    try {
      var v = JSON.parse(window.localStorage.getItem('mm-share') || 'null');
      if (v && typeof v === 'object') {
        if (v.group === 'thread' || v.group === 'type' || v.group === 'field' || v.group === 'origin') d.group = v.group;
        if (v.metric === 'engagement' || v.metric === 'mentions' || v.metric === 'count') d.metric = v.metric;
        if (typeof v.scope === 'string' && CONVS.some(function (c) { return c.id === v.scope; })) d.scope = v.scope;
        if (Array.isArray(v.expanded)) v.expanded.forEach(function (k) { if (typeof k === 'string') d.expanded[k] = true; });
      }
    } catch (e) { /* storage unavailable */ }
    return d;
  }
  function saveShare() {
    try {
      window.localStorage.setItem('mm-share', JSON.stringify({ group: S.share.group, metric: S.share.metric, scope: S.share.scope, expanded: Object.keys(S.share.expanded) }));
    } catch (e) { /* storage unavailable */ }
  }
  function radius(n) { return Math.cbrt(nodeVal(n)) * REL; }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = reduceMQ.matches;
  var phoneMQ = window.matchMedia('(max-width: 760px)');
  var deskMQ = window.matchMedia('(hover: hover) and (pointer: fine)');
  var desk = false;        // desktop profile active (mouse/trackpad)
  var hoverNode = null;

  var S = {
    types: new Set(TYPES.map(function (t) { return t.id; })),
    threads: new Set(THREADS.map(function (t) { return t.id; })),
    origins: new Set(ORIGINS.map(function (o) { return o.id; })),
    convOnly: false,
    verifyOnly: false,
    since: '',
    sel: null,
    mode: 'cluster',
    size: HAS_STR ? loadSize() : 'conn',
    hAct: 'all',
    share: loadShare(),
    focus: null,
    upto: LASTC,      // timeline cursor: index into CONV_ORDER; later items are hidden
    spot: false,      // spotlight: dim everything the cursor conversation did not touch
    ink: HAS_TIME ? loadInk() : 'even',
    pathFrom: null,   // node id waiting for a second pick
    path: null        // { nodes: [ids], links: [link], set: Set, lset: Set }
  };
  var FAR = false;     // camera is far enough that only the big labels are worth drawing
  function curConv() { return CONV_ORDER[S.upto]; }
  function inCur(it) { var c = curConv(); return !!(c && it.byConv && it.byConv[c] > 0); }
  function isNew(n) { return HAS_TIME && n._first === S.upto; }
  var focusNodes = new Set(); // origin focus: nodes touching a visible link of that origin
  var visN = new Map();
  var visL = new Map();
  var selN = new Set();
  var G = null;
  var objs = new Map();
  var fitOnStop = true;

  function nodeVisible(n) {
    if (!S.types.has(n.type)) return false;
    if (n._first > S.upto) return false;
    if (S.since && n.type !== 'theme' && n.id !== ROOT && n.lastSeen && n.lastSeen < S.since) return false;
    for (var i = 0; i < n.threads.length; i++) if (S.threads.has(n.threads[i])) return true;
    return n.threads.length === 0;
  }
  function computeVis() {
    nodes.forEach(function (n) { visN.set(n.id, nodeVisible(n)); });
    links.forEach(function (l) {
      visL.set(l.id, !!(visN.get(l.sid) && visN.get(l.tid) && l._first <= S.upto && S.origins.has(l.origin) && (!S.convOnly || l.basis !== 'index') &&
        !(S.since && l.lastSeen && l.lastSeen < S.since)));
    });
    focusNodes = new Set();
    if (S.focus && S.focus.by === 'origin') {
      links.forEach(function (l) {
        if (visL.get(l.id) && l.type !== 'belongs-to' && l.origin === S.focus.key) { focusNodes.add(l.sid); focusNodes.add(l.tid); }
      });
    }
    selN = new Set();
    if (S.sel) {
      (adj.get(S.sel) || []).forEach(function (a) { if (visL.get(a.l.id)) selN.add(a.other); });
    }
  }
  function focusDimsNode(n) {
    var f = S.focus;
    if (!f) return false;
    if (f.by === 'thread') return n.threads.indexOf(f.key) < 0;
    if (f.by === 'type') return n.type !== f.key;
    if (f.by === 'field') {
      if (n.type === 'theme' || (n.field || NONE) !== f.key) return true;
      return f.sub != null && n.subfield !== f.sub;
    }
    if (f.by === 'origin') return !focusNodes.has(n.id);
    return false;
  }
  function focusDimsLink(l) {
    var f = S.focus;
    if (!f) return false;
    if (f.by === 'origin' && (l.type === 'belongs-to' || l.origin !== f.key)) return true;
    return focusDimsNode(byId.get(l.sid)) && focusDimsNode(byId.get(l.tid));
  }
  function dimNode(n) {
    if (S.path) return !S.path.set.has(n.id);
    if (focusDimsNode(n)) return true;
    if (S.spot && !S.sel && !inCur(n)) return true;
    if (S.sel && n.id !== S.sel && !selN.has(n.id)) return true;
    if (S.verifyOnly && n.id !== S.sel && !n.verify) return true;
    return false;
  }
  function touchesSel(l) {
    if (S.path) return S.path.lset.has(l.id);
    return S.sel && (l.sid === S.sel || l.tid === S.sel);
  }
  function dimLink(l) {
    if (S.path) return !S.path.lset.has(l.id);
    if (focusDimsLink(l)) return true;
    if (S.spot && !S.sel && !inCur(l)) return true;
    if (S.sel && !touchesSel(l)) return true;
    if (S.verifyOnly && !l.verify && !touchesSel(l)) return true;
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Accessors for 3d-force-graph
   * ------------------------------------------------------------------ */
  var nodeVisibility = function (n) { return !!visN.get(n.id); };
  function mixHex(hex, to, f) {
    var a = parseInt(hex.replace('#', ''), 16), b = parseInt(to.replace('#', ''), 16);
    var ch = function (sh) { return Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f); };
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  /* Recency ink: the longer since an idea was last returned to (counted in conversations up to the cursor), the paler it prints. */
  function fadeOf(n) {
    if (S.ink !== 'recency' || n.type === 'theme' || n.id === ROOT) return 0;
    var last = n._first;
    for (var i = Math.min(S.upto, n._last); i > n._first; i--) { if (n.byConv[CONV_ORDER[i]] > 0) { last = i; break; } }
    var gap = Math.max(0, S.upto - last);
    return 0.62 * (1 - Math.pow(0.5, gap / 3));
  }
  var nodeColor = function (n) {
    var c = (TYPE_BY_ID[n.type] || {}).color || '#888888';
    if (dimNode(n)) return hexA(c, 0.13);
    var f = fadeOf(n);
    return f > 0.01 ? mixHex(c, BONE, f) : c;
  };
  var linkVisibility = function (l) { return !!visL.get(l.id); };
  var BASE_ALPHA = { 'index': 0.3, 'index-d': 0.85, 'cross-link': 0.9, 'conversation': 0.85 };
  var linkColor = function (l) {
    var base = l.origin === 'claude' ? FO : OX;
    var a = BASE_ALPHA[l.basis] != null ? BASE_ALPHA[l.basis] : 0.8;
    var es = edgeStr(l);
    if (es != null) a *= 0.7 + 0.3 * es;
    if (dimLink(l)) a = 0.05;
    else if (touchesSel(l)) a = l.basis === 'index' ? 0.75 : 1;
    return hexA(base, a);
  };
  var linkWidth = function (l) {
    var w = l.basis === 'index' ? 0 : (l.basis === 'cross-link' ? 1.5 : 0.9);
    var es = edgeStr(l);
    if (es != null) w *= 0.75 + 0.55 * es;
    if (touchesSel(l) && !dimLink(l)) w = S.path ? Math.max(w, 0.9) + 1.3 : (l.basis === 'index' ? 0.5 : w + 0.5);
    return w;
  };
  var arrowLen = function (l) {
    if (dimLink(l) || !visL.get(l.id)) return 0;
    return l.basis === 'index' ? 3.4 : 5.2;
  };
  var arrowColor = function (l) { return l.origin === 'owner' ? OX : FO; };
  var particles = function (l) {
    if (reduce || l.origin !== 'shared' || l.basis === 'index') return 0;
    if (dimLink(l) || !visL.get(l.id)) return 0;
    return 2;
  };

  function tipNode(n) {
    var t = TYPE_BY_ID[n.type];
    return '<div class="tt"><span class="tt-name">' + esc(displayLabel(n)) + '</span><span class="tt-meta">' +
      esc(t ? t.name : n.type) + (n.role ? ' · ' + esc(n.role) : '') + ' · ' + n.deg + ' links' +
      (isNum(n.strength) ? ' · strength ' + n.strength.toFixed(2) : '') +
      (n.verify ? ' · <em class="tt-ox">verify</em>' : '') + '</span></div>';
  }
  function tipLink(l) {
    var a = byId.get(l.sid), b = byId.get(l.tid);
    var oc = l.origin === 'claude' ? 'tt-fo' : (l.origin === 'owner' ? 'tt-ox' : '');
    return '<div class="tt"><span class="tt-name">' + esc(l.label || l.type) + '</span><span class="tt-meta">' +
      esc(a.label) + ' → ' + esc(b.label) + '<br>' + esc(l.type) + ' · <em class="' + oc + '">' + esc(l.origin) + '</em> · ' + esc(l.basis) +
      (isNum(l.strength) ? ' · strength ' + l.strength.toFixed(2) : '') +
      (l.verify ? ' · <em class="tt-ox">verify</em>' : '') + '</span></div>';
  }

  /* ------------------------------------------------------------------ *
   * Sprites: labels, verify rings, root ring
   * ------------------------------------------------------------------ */
  function ringTexture(color, dashed, double) {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var x = c.getContext('2d');
    x.strokeStyle = color;
    x.lineCap = 'round';
    function ring(r, w, dash) {
      x.lineWidth = w;
      x.setLineDash(dash || []);
      x.beginPath();
      x.arc(128, 128, r, 0, Math.PI * 2);
      x.stroke();
    }
    if (double) { ring(110, 5); ring(124, 3); }
    else ring(116, dashed ? 9 : 6, dashed ? [26, 20] : null);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  var TEX_VERIFY = null, TEX_ROOT = null;

  function buildNodeObject(n) {
    var g = new THREE.Group();
    var r = radius(n);
    var o = { g: g, r: r, label: null, halo: null, ring: null, glow: null, th: 0, bx: 0, by: 0, k: 1 };
    if (n.verify) {
      TEX_VERIFY = TEX_VERIFY || ringTexture(OX, true, false);
      var h = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_VERIFY, transparent: true, depthWrite: false }));
      h.scale.set(r * 3.1, r * 3.1, 1);
      g.add(h);
      o.halo = h;
    }
    if (n.id === ROOT) {
      TEX_ROOT = TEX_ROOT || ringTexture(INK, false, true);
      var rr = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_ROOT, transparent: true, depthWrite: false }));
      rr.scale.set(r * 3.5, r * 3.5, 1);
      g.add(rr);
      o.ring = rr;
    }
    var th = n.id === ROOT ? 9 : (n.type === 'theme' ? 7 : 5.4);
    var s = new SpriteText(displayLabel(n), th, INK);
    s.fontFace = "'Newsreader', Georgia, serif";
    s.fontWeight = 'italic 500'; // SpriteText builds ctx.font as weight + size + face
    s.backgroundColor = hexA(BONE, 0.72);
    s.padding = [2, 1];
    s.material.depthWrite = false;
    o.th = th; o.bx = s.scale.x; o.by = s.scale.y; o.py = r * (n.verify ? 1.75 : 1.25);
    s.position.set(0, o.py + th * 0.65, 0);
    s.visible = false;
    g.add(s);
    o.label = s;
    objs.set(n.id, o);
    applySprite(n, o);
    return g;
  }

  function bigLabel(n) { return n.type === 'theme' || n.id === ROOT || TOP_IDS.has(n.id); }
  function wantLabel(n) {
    if (!visN.get(n.id)) return false;
    if (S.path) return S.path.set.has(n.id);
    if (S.sel) return n.id === S.sel || selN.has(n.id) || (alwaysLabel(n) && !dimNode(n) && (!FAR || bigLabel(n)));
    if (S.spot) return inCur(n) && (isNew(n) || bigLabel(n) || !FAR);
    if (FAR) return bigLabel(n);
    return alwaysLabel(n) || TOP_IDS.has(n.id);
  }
  var TEX_GLOW = null;
  function glowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var gr = x.createRadialGradient(64, 64, 6, 64, 64, 64);
    gr.addColorStop(0, hexA(OX, 0.5));
    gr.addColorStop(0.45, hexA(OX, 0.2));
    gr.addColorStop(1, hexA(OX, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  var glows = new Set();
  function applySprite(n, o) {
    var dim = dimNode(n);
    var wantGlow = isNew(n) && !!visN.get(n.id) && !dim && n.type !== 'theme';
    if (wantGlow && !o.glow) {
      TEX_GLOW = TEX_GLOW || glowTexture();
      o.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, transparent: true, depthWrite: false }));
      o.glow.scale.set(o.r * 5.2, o.r * 5.2, 1);
      o.glow.renderOrder = -1;
      o.g.add(o.glow);
    }
    if (o.glow) {
      o.glow.visible = wantGlow;
      if (wantGlow) glows.add(o); else glows.delete(o);
    }
    o.label.visible = wantLabel(n);
    o.label.material.opacity = dim ? 0.2 : 1;
    if (o.halo) o.halo.material.opacity = dim ? 0.18 : 1;
    if (o.ring) o.ring.material.opacity = dim ? 0.2 : 1;
  }
  function updateSprites() {
    glows.clear();
    nodes.forEach(function (n) {
      var o = objs.get(n.id);
      if (o) applySprite(n, o);
    });
    scaleLabels();
    updateWashes();
  }

  /* ------------------------------------------------------------------ *
   * Depth: fog toward the paper, labels that hold their size, thread washes
   * ------------------------------------------------------------------ */
  var GRAPH_R = 90 + 12 * Math.sqrt(nodes.length);
  var camDist = 0;
  function scaleLabels() {
    if (!camDist) return;
    nodes.forEach(function (n) {
      var o = objs.get(n.id);
      if (!o || !o.label || !o.label.visible) return;
      var k = 1;
      if (S.path) k = Math.max(1, Math.min(2.8, camDist / 420));
      else if (n.type === 'theme' || n.id === ROOT) k = Math.max(1, Math.min(3.4, camDist / 420));
      else if (TOP_IDS.has(n.id) || n.id === S.sel) k = Math.max(1, Math.min(2.6, camDist / 520));
      else if (S.spot && isNew(n)) k = Math.max(1, Math.min(1.9, camDist / 620));
      if (Math.abs(k - o.k) < 0.04) return;
      o.k = k;
      o.label.scale.set(o.bx * k, o.by * k, 1);
      o.label.position.y = o.py + o.th * 0.65 * k;
    });
  }
  var camT = 0;
  function onCamera(force) {
    if (!G) return;
    var now = Date.now();
    if (!force && now - camT < 90) return;
    camT = now;
    var cam = G.camera().position, t = G.controls().target || { x: 0, y: 0, z: 0 };
    var dx = cam.x - t.x, dy = cam.y - t.y, dz = cam.z - t.z;
    camDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var fog = G.scene().fog;
    if (fog) { fog.near = Math.max(1, camDist - GRAPH_R * 0.15); fog.far = camDist + GRAPH_R * 2.6; }
    var far = camDist > 780;
    if (far !== FAR) { FAR = far; updateSprites(); }
    else scaleLabels();
  }
  /* one faint ink wash behind each thread's cluster, like a stain in the paper */
  var washes = [], TEX_WASH = null;
  function washTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, hexA(INK, 0.1));
    gr.addColorStop(0.55, hexA(INK, 0.045));
    gr.addColorStop(1, hexA(INK, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function buildWashes() {
    TEX_WASH = washTexture();
    THREADS.forEach(function (t, i) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_WASH, transparent: true, depthWrite: false, depthTest: false }));
      sp.renderOrder = -5;
      sp.visible = false;
      G.scene().add(sp);
      washes.push({ id: t.id, ti: i, sp: sp });
    });
  }
  function updateWashes() {
    if (!washes.length) return;
    washes.forEach(function (w) {
      var sx = 0, sy = 0, sz = 0, c = 0, mem = [];
      nodes.forEach(function (n) {
        if (n._ti !== w.ti || n.x == null || !visN.get(n.id)) return;
        sx += n.x; sy += n.y; sz += n.z; c++; mem.push(n);
      });
      if (c < 3 || !S.threads.has(w.id) || S.mode !== 'cluster' || S.path) { w.sp.visible = false; return; }
      sx /= c; sy /= c; sz /= c;
      var d2 = 0;
      mem.forEach(function (n) { d2 += (n.x - sx) * (n.x - sx) + (n.y - sy) * (n.y - sy) + (n.z - sz) * (n.z - sz); });
      var rms = Math.sqrt(d2 / c);
      w.sp.position.set(sx, sy, sz);
      w.sp.scale.set(rms * 4.2, rms * 4.2, 1);
      w.sp.material.opacity = S.sel || S.spot || S.focus ? 0.45 : 1;
      w.sp.visible = true;
    });
  }
  /* newly revealed nodes swell into place; glows breathe */
  var pops = [], animOn = false;
  function popIn(ids) {
    if (reduce || !G) return;
    var t0 = Date.now();
    ids.forEach(function (id) {
      var n = byId.get(id);
      if (n && n.__threeObj) { n.__threeObj.scale.set(0.01, 0.01, 0.01); pops.push({ n: n, t0: t0 + Math.random() * 380 }); }
    });
    kick();
  }
  function kick() { if (!animOn) { animOn = true; requestAnimationFrame(frame); } }
  function frame() {
    var now = Date.now(), live = false;
    pops = pops.filter(function (p) {
      var u = (now - p.t0) / 620;
      if (u < 0) { live = true; return true; }
      if (u >= 1 || !p.n.__threeObj) { if (p.n.__threeObj) p.n.__threeObj.scale.set(1, 1, 1); return false; }
      var e = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2); /* ease-out with a small overshoot */
      p.n.__threeObj.scale.set(e, e, e);
      live = true;
      return true;
    });
    if (glows.size && !reduce) {
      var b = 1 + 0.09 * Math.sin(now / 520);
      glows.forEach(function (o) { if (o.glow) o.glow.scale.set(o.r * 5.2 * b, o.r * 5.2 * b, 1); });
      live = true;
    }
    if (live) requestAnimationFrame(frame); else animOn = false;
  }

  /* ------------------------------------------------------------------ *
   * Layout forces
   * ------------------------------------------------------------------ */
  var anchors = [];
  (function () {
    var N = Math.max(THREADS.length, 1);
    var AR = 90 + 12 * Math.sqrt(nodes.length);
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var y = 1 - (i + 0.5) / N * 2;
      var rr = Math.sqrt(1 - y * y);
      var th = i * golden;
      anchors.push({ x: Math.cos(th) * rr * AR, y: y * AR, z: Math.sin(th) * rr * AR });
    }
  })();

  function makeClusterForce() {
    var ns = [];
    function force(alpha) {
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i], a = anchors[n._ti];
        if (!a || n.x == null) continue;
        var k = (n.type === 'theme' ? 0.14 : 0.05) * alpha;
        n.vx += (a.x - n.x) * k;
        n.vy += (a.y - n.y) * k;
        n.vz += (a.z - n.z) * k;
      }
    }
    force.initialize = function (arr) { ns = arr; };
    return force;
  }

  var RAD = 62;
  var hop = new Map();
  (function bfs() {
    if (!byId.has(ROOT)) return;
    hop.set(ROOT, 0);
    var q = [ROOT];
    while (q.length) {
      var id = q.shift();
      (adj.get(id) || []).forEach(function (a) {
        if (!hop.has(a.other)) { hop.set(a.other, hop.get(id) + 1); q.push(a.other); }
      });
    }
    var max = 0;
    hop.forEach(function (d) { if (d > max) max = d; });
    nodes.forEach(function (n) { if (!hop.has(n.id)) hop.set(n.id, max + 1); });
  })();

  function makeRadialForce() {
    var ns = [];
    function force(alpha) {
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        if (n.id === ROOT || n.x == null) continue;
        var target = (hop.get(n.id) || 1) * RAD;
        var r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        if (r < 1e-3) { n.vx += (Math.random() - 0.5) * 4; n.vy += (Math.random() - 0.5) * 4; n.vz += (Math.random() - 0.5) * 4; continue; }
        var f = (target - r) * 0.2 * alpha / r;
        n.vx += n.x * f; n.vy += n.y * f; n.vz += n.z * f;
      }
    }
    force.initialize = function (arr) { ns = arr; };
    return force;
  }

  function setMode(mode) {
    S.mode = mode;
    $('btn-mode-cluster').setAttribute('aria-pressed', String(mode === 'cluster'));
    $('btn-mode-radial').setAttribute('aria-pressed', String(mode === 'radial'));
    var root = byId.get(ROOT);
    if (mode === 'radial') {
      G.d3Force('cluster', null);
      G.d3Force('radial', makeRadialForce());
      if (root) { root.fx = 0; root.fy = 0; root.fz = 0; }
    } else {
      G.d3Force('radial', null);
      G.d3Force('cluster', makeClusterForce());
      if (root) { root.fx = undefined; root.fy = undefined; root.fz = undefined; }
    }
    fitOnStop = true;
    G.d3ReheatSimulation();
    updateWashes();
  }

  /* ------------------------------------------------------------------ *
   * Camera
   * ------------------------------------------------------------------ */
  function flyTo(n) {
    if (!G || n.x == null) return;
    var cam = G.camera().position;
    var dx = cam.x - n.x, dy = cam.y - n.y, dz = cam.z - n.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) { dx = 0; dy = 0; dz = 1; len = 1; }
    var dist = 230 + radius(n) * 3;
    var ox = 0, oy = 0, oz = 0;
    if (phoneMQ.matches && isOpen('detail')) {
      /* the bottom sheet covers the lower part of the canvas: slide the view so the node sits in the visible upper part */
      var m = G.camera().matrixWorld.elements;
      var k = dist * 0.15;
      ox = -m[4] * k; oy = -m[5] * k; oz = -m[6] * k;
    }
    G.cameraPosition(
      { x: n.x + dx / len * dist + ox, y: n.y + dy / len * dist + oy, z: n.z + dz / len * dist + oz },
      { x: n.x + ox, y: n.y + oy, z: n.z + oz },
      reduce ? 0 : 1000
    );
  }

  /* ------------------------------------------------------------------ *
   * Refresh
   * ------------------------------------------------------------------ */
  function bump() {
    computeVis();
    if (G) {
      G.nodeVisibility(nodeVisibility).nodeColor(nodeColor)
        .linkVisibility(linkVisibility).linkColor(linkColor).linkWidth(linkWidth)
        .linkDirectionalArrowLength(arrowLen).linkDirectionalArrowColor(arrowColor)
        .linkDirectionalParticles(particles);
      updateSprites();
      if (glows.size) kick();
    }
    refreshCounts();
    if (S.sel) renderDetail();
    renderShare();
  }

  /* ------------------------------------------------------------------ *
   * Panels
   * ------------------------------------------------------------------ */
  var filtersEl = $('filters'), detailEl = $('detail'), historyEl = $('history'), shareEl = $('share');
  var PANELS = {
    filters: { el: filtersEl, btn: $('btn-filters') },
    detail: { el: detailEl, btn: $('btn-detail') },
    history: { el: historyEl, btn: $('btn-history') },
    share: { el: shareEl, btn: $('share-bar') }  /* the bar under the map is the only Share toggle */
  };
  function setPanel(which, open) {
    var p = PANELS[which];
    p.el.classList.toggle('is-collapsed', !open);
    p.btn.setAttribute('aria-expanded', String(open));
    if (which === 'share') {
      /* the in-flow bar above the dock is the second toggle; keep it in step (open state is never persisted) */
      var bar = $('share-bar');
      bar.setAttribute('aria-expanded', String(open));
      bar.querySelector('.sb-chev').textContent = open ? '\u25be' : '\u25b4';
      bar.querySelector('.sb-lbl').textContent = open ? 'Hide Share' : 'Show Share';
      renderShare();
    }
    if (open && phoneMQ.matches) {
      Object.keys(PANELS).forEach(function (k) { if (k !== which) setPanel(k, false); });
    }
  }
  function isOpen(which) { return !PANELS[which].el.classList.contains('is-collapsed'); }

  /* ------------------------------------------------------------------ *
   * Detail panel
   * ------------------------------------------------------------------ */
  function swatch(origin) {
    if (origin === 'owner') return '<span class="sw" title="' + esc(OWNER_NAME) + '"><i class="ox"></i><i class="ox"></i></span>';
    if (origin === 'claude') return '<span class="sw" title="Claude"><i class="fo"></i><i class="fo"></i></span>';
    return '<span class="sw" title="Shared"><i class="ox"></i><i class="fo"></i></span>';
  }
  function threadName(id) {
    for (var i = 0; i < THREADS.length; i++) if (THREADS[i].id === id) return THREADS[i].title;
    return '';
  }
  /* ---- change log helpers ---- */
  function parseEdgeRef(t) {
    var m = /^(.+?)>(.+?):([A-Za-z-]+)$/.exec(String(t));
    return m ? { s: m[1], t: m[2], type: m[3] } : null;
  }
  function edgeEnds(target) {
    var l = linkById.get(target);
    if (l) return { s: l.sid, t: l.tid, type: l.type };
    return parseEdgeRef(target);
  }
  var logRows = LOG.map(function (en, i) { return { en: en, i: i }; })
    .sort(function (a, b) {
      var da = String(a.en.date || ''), db = String(b.en.date || '');
      return da < db ? 1 : da > db ? -1 : b.i - a.i;
    }).map(function (r) { return r.en; });
  var logByNode = new Map();
  logRows.forEach(function (en) {
    var tg = String(en.target == null ? '' : en.target);
    var ids = [];
    if (byId.has(tg)) ids.push(tg);
    else {
      var ee = edgeEnds(tg);
      if (ee) { if (byId.has(ee.s)) ids.push(ee.s); if (ee.t !== ee.s && byId.has(ee.t)) ids.push(ee.t); }
    }
    ids.forEach(function (id) {
      if (!logByNode.has(id)) logByNode.set(id, []);
      logByNode.get(id).push(en);
    });
  });
  function targetLabel(target) {
    var tg = String(target == null ? '' : target);
    if (tg === '*') return 'The whole map';
    var n = byId.get(tg);
    if (n) return displayLabel(n);
    var ee = edgeEnds(tg);
    if (ee) {
      var a = byId.get(ee.s), b = byId.get(ee.t);
      return (a ? a.label : ee.s) + ' → ' + (b ? b.label : ee.t) + ' (' + ee.type + ')';
    }
    return tg;
  }
  /* node id a log target resolves to when clicked: the node itself, or an edge's source */
  function targetNodeId(target) {
    var tg = String(target == null ? '' : target);
    if (byId.has(tg)) return tg;
    var ee = edgeEnds(tg);
    return ee && byId.has(ee.s) ? ee.s : null;
  }
  function histEntryHtml(en, o) {
    var act = String(en.action || '');
    var h = '<li class="h-item h-' + esc(act) + '"><div class="h-top"><span class="h-date">' + esc(en.date) + '</span><span class="h-act">' + esc(act) + '</span></div>';
    if (o.showTarget) {
      var nid = targetNodeId(en.target);
      var lbl = esc(targetLabel(en.target));
      h += '<div class="h-target">' + (nid
        ? '<button type="button" data-hnode="' + esc(nid) + '">' + lbl + '</button>'
        : '<span>' + lbl + '</span>') + '</div>';
    }
    if (en.before || en.after) {
      h += '<p class="h-ba">' + (en.before ? '<span class="h-before">' + esc(en.before) + '</span>' : '') +
        (en.before && en.after ? ' <span class="h-arrow">→</span> ' : '') +
        (en.after ? '<span class="h-after">' + esc(en.after) + '</span>' : '') + '</p>';
    }
    if (en.reason) h += '<p class="h-reason">' + esc(en.reason) + '</p>';
    var meta = [en.trigger, en.source].filter(Boolean).map(esc).join(' · ');
    if (meta) h += '<div class="h-meta">' + meta + '</div>';
    return h + '</li>';
  }
  var HIST_SHORT = 5, histShowAll = false, histFor = null;

  function strengthRow(n) {
    if (!isNum(n.strength)) return '';
    var parts = [];
    if (n.mentions != null) parts.push(esc(n.mentions) + ' mention' + (n.mentions === 1 ? '' : 's'));
    if (n.conversations != null) parts.push(esc(n.conversations) + ' conversation' + (n.conversations === 1 ? '' : 's'));
    if (n.lastSeen) parts.push('last seen ' + esc(n.lastSeen));
    if (isNum(n.weight) && n.weight !== 1) parts.push('weight ×' + esc(n.weight));
    var pct = Math.round(Math.max(0, Math.min(1, n.strength)) * 100);
    return '<div class="d-strength"><div class="ds-top"><span class="mono">Strength</span><span class="mono ds-num">' + n.strength.toFixed(2) + '</span></div>' +
      '<div class="ds-bar" role="img" aria-label="Strength ' + n.strength.toFixed(2) + ' of 1"><i style="width:' + pct + '%"></i></div>' +
      (parts.length ? '<p class="ds-meta mono">' + parts.join(' · ') + '</p>' : '') + '</div>';
  }
  function renderDetail() {
    var body = $('detail-body');
    if (!S.sel) {
      body.innerHTML = '<p class="empty-state">Select a node to read its note and trace its connections. Esc clears the selection.</p>';
      return;
    }
    var n = byId.get(S.sel);
    var t = TYPE_BY_ID[n.type];
    var h = '';
    if (S.pathFrom) {
      h += '<div class="path-box"><p class="path-hint">Tracing from <b>' + esc(displayLabel(byId.get(S.pathFrom))) + '</b>. Pick the second node: click it on the map or search for it.</p>' +
        '<button id="btn-path-cancel" class="btn btn-quiet" type="button">Cancel</button></div>';
    }
    if (S.path) {
      var P = S.path;
      h += '<div class="path-box"><div class="conn-head mono"><span>Path</span><span>' + P.links.length + (P.links.length === 1 ? ' step' : ' steps') + '</span></div><ol class="path-list">';
      P.nodes.forEach(function (id, i) {
        h += '<li><button type="button" data-fly="' + esc(id) + '">' + esc(displayLabel(byId.get(id))) + '</button></li>';
        var l = P.links[i];
        if (l) h += '<li class="path-edge">' + swatch(l.origin) + '<span>' + (l.sid === id ? '↓' : '↑') + ' ' + esc(l.label || l.type) + ' · ' + esc(l.type) + ' · ' + esc(l.origin) + (l.verify ? ' · <em>verify</em>' : '') + '</span></li>';
      });
      h += '</ol><p class="note">Shortest route through the links now showing. ↓ follows a link’s direction, ↑ runs against it.' +
        (P.structural ? ' No chain of drawn links joins these two, so this route passes through a thread.' : '') + '</p>' +
        '<button id="btn-path-clear" class="btn btn-quiet" type="button">Clear path</button></div>';
    }
    if (S.pathMiss) {
      h += '<div class="path-box"><p class="path-hint">No route between <b>' + esc(displayLabel(byId.get(S.pathMiss.a))) + '</b> and <b>' + esc(displayLabel(n)) + '</b> through the links now showing.</p></div>';
    }
    h += '<h2 class="d-name">' + esc(displayLabel(n)) + '</h2>';
    h += '<p class="d-meta"><span>' + esc(t ? t.name : n.type) + '</span>';
    if (n.role) h += '<span>' + esc(n.role) + '</span>';
    h += '<span>' + n.deg + ' connections</span></p>';
    h += '<p class="d-meta">' + n.threads.map(function (id) {
      return '<span class="th">§ ' + esc(id) + ' ' + esc(threadName(id)) + '</span>';
    }).join('') + '</p>';
    if (n.note) h += '<p class="d-note">' + esc(n.note) + '</p>';
    if (n.field) h += '<p class="d-meta"><span>Field</span><span>' + esc(n.field) + ' \u203a ' + esc(n.subfield || '') + '</span></p>';
    h += strengthRow(n);
    if (n.verify) {
      h += '<p class="d-verify"><span class="tag-verify">Verify</span></p>';
      if (n.verifyNote) h += '<p class="verify-note">' + esc(n.verifyNote) + '</p>';
    }
    if (!S.pathFrom) h += '<button id="btn-path" class="btn btn-block d-path" type="button">Trace a path from here</button>';
    var groups = {};
    var total = 0;
    (adj.get(n.id) || []).forEach(function (a) {
      if (!visL.get(a.l.id)) return;
      (groups[a.l.type] = groups[a.l.type] || []).push(a);
      total++;
    });
    h += '<div class="conn-head mono"><span>Connections</span><span>' + total + '</span></div>';
    if (!total) h += '<p class="note">No visible connections under the current filters.</p>';
    var order = EDGE_TYPES.concat(Object.keys(groups).filter(function (k) { return EDGE_TYPES.indexOf(k) < 0; }));
    order.forEach(function (type) {
      var list = groups[type];
      if (!list) return;
      list.sort(function (a, b) { return byId.get(a.other).label.localeCompare(byId.get(b.other).label); });
      h += '<div class="conn-group"><h3><span>' + esc(type) + '</span><span>' + list.length + '</span></h3>';
      list.forEach(function (a) {
        var o = byId.get(a.other);
        h += '<div class="conn">' + swatch(a.l.origin) +
          '<button type="button" data-id="' + esc(o.id) + '">' + esc(displayLabel(o)) + '</button>' +
          '<div class="el">' + (a.out ? '→' : '←') + ' ' + esc(a.l.label || a.l.type) + ' · ' + esc(a.l.origin) +
          (edgeStr(a.l) != null ? ' · ' + a.l.strength.toFixed(2) : '') +
          (a.l.verify ? ' · <em>verify</em>' : '') + '</div></div>';
      });
      h += '</div>';
    });
    var hist = LOG.length ? (logByNode.get(n.id) || []) : null;
    if (hist) {
      if (histFor !== n.id) { histFor = n.id; histShowAll = false; }
      h += '<div class="conn-head mono"><span>History</span><span>' + hist.length + '</span></div>';
      if (!hist.length) h += '<p class="note">Nothing logged for this node yet.</p>';
      else {
        var shown = histShowAll ? hist : hist.slice(0, HIST_SHORT);
        h += '<ol class="hist-list hist-mini">' + shown.map(function (en) {
          return histEntryHtml(en, { showTarget: en.target !== n.id });
        }).join('') + '</ol>';
        if (hist.length > HIST_SHORT) {
          h += '<button id="btn-hist-more" class="btn btn-quiet" type="button" aria-expanded="' + histShowAll + '">' +
            (histShowAll ? 'Show fewer' : 'Show all ' + hist.length) + '</button>';
        }
      }
    }
    h += '<button id="btn-clear" class="btn d-clear" type="button">Clear selection</button>';
    body.innerHTML = h;
    var c = $('btn-clear');
    if (c) c.addEventListener('click', clearSelection);
    var pb = $('btn-path');
    if (pb) pb.addEventListener('click', function () { S.pathFrom = S.sel; S.path = null; S.pathMiss = null; bump(); renderDetail(); });
    var pc = $('btn-path-cancel');
    if (pc) pc.addEventListener('click', function () { S.pathFrom = null; renderDetail(); });
    var px = $('btn-path-clear');
    if (px) px.addEventListener('click', function () { S.path = null; bump(); renderDetail(); });
    var m = $('btn-hist-more');
    if (m) m.addEventListener('click', function () { histShowAll = !histShowAll; renderDetail(); });
  }

  $('detail-body').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-id], button[data-hnode], button[data-fly]') : null;
    if (!b) return;
    if (b.hasAttribute('data-fly')) { var fn = byId.get(b.getAttribute('data-fly')); if (fn) flyTo(fn); return; }
    var n = byId.get(b.getAttribute('data-id') || b.getAttribute('data-hnode'));
    if (n) selectNode(n.id, true);
  });

  function bfsPath(a, b, structural) {
    var prev = new Map([[a, null]]), q = [a];
    while (q.length && !prev.has(b)) {
      var id = q.shift();
      (adj.get(id) || []).forEach(function (x) {
        if (prev.has(x.other) || !visL.get(x.l.id)) return;
        if (!structural && x.l.type === 'belongs-to') return;
        prev.set(x.other, { from: id, l: x.l });
        q.push(x.other);
      });
    }
    if (!prev.has(b)) return null;
    var ns = [b], ls = [], cur = b;
    while (prev.get(cur)) { var p = prev.get(cur); ls.unshift(p.l); ns.unshift(p.from); cur = p.from; }
    return { nodes: ns, links: ls };
  }
  /* shortest chain of drawn links between two nodes; only if there is none does it route through a thread */
  function tracePath(a, b) {
    S.pathFrom = null; S.path = null; S.pathMiss = null;
    computeVis();
    var r = bfsPath(a, b, false) || bfsPath(a, b, true);
    if (r) {
      r.set = new Set(r.nodes);
      r.lset = new Set(r.links.map(function (l) { return l.id; }));
      r.structural = r.links.some(function (l) { return l.type === 'belongs-to'; });
      S.path = r;
    } else S.pathMiss = { a: a, b: b };
    S.sel = b;
    fitOnStop = false;
    bump();
    renderDetail();
    setPanel('detail', true);
    if (r && G) G.zoomToFit(reduce ? 0 : 900, 90, function (n) { return r.set.has(n.id); });
    else flyTo(byId.get(b));
  }
  function selectNode(id, fly) {
    var n = byId.get(id);
    if (!n) return;
    if (!nodeVisible(n)) revealNode(n);
    if (S.pathFrom && S.pathFrom !== id && byId.has(S.pathFrom)) { tracePath(S.pathFrom, id); return; }
    S.path = null; S.pathMiss = null;
    S.sel = id;
    fitOnStop = false;
    bump();
    renderDetail();
    setPanel('detail', true);
    if (fly) flyTo(n);
  }
  function clearSelection() {
    if (!S.sel && !S.path && !S.pathFrom) return;
    S.path = null; S.pathFrom = null; S.pathMiss = null;
    S.sel = null;
    bump();
    renderDetail();
  }

  /* ------------------------------------------------------------------ *
   * Filters UI
   * ------------------------------------------------------------------ */
  function mkCheck(id, html, count, checked) {
    return '<label class="chk"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="box"></span>' +
      html + '<span class="cnt" id="' + id + '-cnt">' + (count == null ? '' : count) + '</span></label>';
  }
  function buildFilters() {
    var tc = {};
    nodes.forEach(function (n) { tc[n.type] = (tc[n.type] || 0) + 1; });
    $('f-types').innerHTML = TYPES.map(function (t) {
      return mkCheck('f-type-' + t.id, '<span class="dot" style="background:' + t.color + '"></span><span class="txt">' + esc(t.name) + '</span>', tc[t.id] || 0, true);
    }).join('');
    var thc = {};
    nodes.forEach(function (n) { n.threads.forEach(function (id) { thc[id] = (thc[id] || 0) + 1; }); });
    $('f-threads').innerHTML = THREADS.map(function (t) {
      return mkCheck('f-thread-' + t.id, '<span class="txt"><span class="num">§ ' + esc(t.id) + '</span>' + esc(t.title) + '</span>', thc[t.id] || 0, true);
    }).join('');
    var oc = {};
    links.forEach(function (l) { oc[l.origin] = (oc[l.origin] || 0) + 1; });
    $('f-origins').innerHTML = ORIGINS.map(function (o) {
      return mkCheck('f-origin-' + o.id, swatch(o.id) + '<span class="txt">' + o.name + '</span>', oc[o.id] || 0, true);
    }).join('');
    $('cnt-basis').textContent = links.filter(function (l) { return l.basis !== 'index'; }).length + '/' + links.length;
    $('cnt-verify').textContent = nodes.filter(function (n) { return n.verify; }).length + '+' + links.filter(function (l) { return l.verify; }).length;

    $('lg-types').innerHTML = TYPES.map(function (t) {
      return '<li><svg class="lg-svg" viewBox="0 0 44 24" aria-hidden="true"><circle cx="22" cy="12" r="6" fill="' + t.color + '"/></svg><span>' + esc(t.name) + '</span></li>';
    }).join('');

    TYPES.forEach(function (t) {
      $('f-type-' + t.id).addEventListener('change', function (e) {
        e.target.checked ? S.types.add(t.id) : S.types.delete(t.id); onFilter();
      });
    });
    THREADS.forEach(function (t) {
      $('f-thread-' + t.id).addEventListener('change', function (e) {
        e.target.checked ? S.threads.add(t.id) : S.threads.delete(t.id); onFilter();
      });
    });
    ORIGINS.forEach(function (o) {
      $('f-origin-' + o.id).addEventListener('change', function (e) {
        e.target.checked ? S.origins.add(o.id) : S.origins.delete(o.id); onFilter();
      });
    });
    if (CONVS.length) {
      $('sec-since').hidden = false;
      $('f-since').innerHTML = '<option value="">All</option>' + CONVS.map(function (c) {
        return '<option value="' + esc(c.date) + '">' + esc(c.date) + ' · ' + esc(c.title || c.id || '') + '</option>';
      }).join('');
      $('f-since').addEventListener('change', function (e) { S.since = e.target.value; onFilter(); });
    }
    $('f-basis').addEventListener('change', function (e) { S.convOnly = e.target.checked; onFilter(); });
    $('f-verify').addEventListener('change', function (e) { S.verifyOnly = e.target.checked; onFilter(); });
  }
  function syncFilterUI() {
    TYPES.forEach(function (t) { $('f-type-' + t.id).checked = S.types.has(t.id); });
    THREADS.forEach(function (t) { $('f-thread-' + t.id).checked = S.threads.has(t.id); });
    $('f-since').value = S.since;
  }
  /* a history click may target something the filters hide; widen them just enough to show it */
  function revealNode(n) {
    S.types.add(n.type);
    if (n._first > S.upto) { stopPlay(); S.upto = LASTC; syncTimeline(); }
    n.threads.forEach(function (t) { S.threads.add(t); });
    if (S.since && n.lastSeen && n.lastSeen < S.since && n.type !== 'theme' && n.id !== ROOT) S.since = '';
    syncFilterUI();
  }
  function setInk(mode, persist) {
    S.ink = mode === 'recency' ? 'recency' : 'even';
    $('btn-ink-even').setAttribute('aria-pressed', String(S.ink === 'even'));
    $('btn-ink-recency').setAttribute('aria-pressed', String(S.ink === 'recency'));
    if (persist) saveInk(S.ink);
    if (G) bump();
  }

  /* ------------------------------------------------------------------ *
   * Timeline: step or replay the map conversation by conversation
   * ------------------------------------------------------------------ */
  var playT = null;
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function buildTimeline() {
    if (!HAS_TIME) return;
    $('timeline').hidden = false;
    $('tl-ticks').innerHTML = CONV_ORDER.map(function (id, i) {
      var c = CONV_BY_ID[id];
      return '<button type="button" class="tl-tick" data-i="' + i + '" title="' + esc(c.date + ' · ' + c.title) + '" aria-label="' + esc('Conversation ' + (i + 1) + ' of ' + CONV_ORDER.length + ': ' + c.title) + '"><i></i></button>';
    }).join('');
    $('tl-ticks').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-i]') : null;
      if (!b) return;
      stopPlay();
      setUpto(+b.getAttribute('data-i'), true);
    });
    $('tl-play').addEventListener('click', function () { if (playT) stopPlay(); else startPlay(); });
    $('tl-spot').addEventListener('click', function () { S.spot = !S.spot; bump(); syncTimeline(); });
    $('tl-now').addEventListener('click', function () { stopPlay(); setUpto(LASTC, true); });
    syncTimeline();
  }
  function syncTimeline() {
    if (!HAS_TIME || !$('tl-ticks').children.length) return;
    Array.prototype.forEach.call($('tl-ticks').children, function (b, i) {
      b.classList.toggle('is-on', i <= S.upto);
      if (i === S.upto) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    var c = CONV_BY_ID[curConv()], st = CONV_STATS[S.upto];
    $('tl-title').textContent = c.title;
    $('tl-meta').textContent = (S.upto + 1) + ' / ' + CONV_ORDER.length + ' · ' + c.date + ' · +' + plural(st.nodes, 'node') + ' · +' + plural(st.links, 'link') +
      (st.back ? ' · ' + st.back + ' returned to' : '');
    $('tl-play').textContent = playT ? 'Pause' : 'Replay';
    $('tl-play').setAttribute('aria-pressed', String(!!playT));
    $('tl-spot').setAttribute('aria-pressed', String(S.spot));
    $('tl-now').hidden = S.upto >= LASTC;
    var cur = $('tl-ticks').children[S.upto];
    if (cur && cur.scrollIntoView && $('tl-ticks').scrollWidth > $('tl-ticks').clientWidth) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function setUpto(i, anim) {
    i = Math.max(0, Math.min(LASTC, i));
    var prev = S.upto;
    S.upto = i;
    var gone = function (id) { return byId.get(id)._first > i; };
    if (S.path && S.path.nodes.some(gone)) S.path = null;
    if (S.pathFrom && gone(S.pathFrom)) S.pathFrom = null;
    if (S.sel && gone(S.sel)) { S.sel = null; S.path = null; S.pathMiss = null; }
    bump();
    renderDetail();
    runSearch();
    syncTimeline();
    if (anim && i > prev) popIn(nodes.filter(function (n) { return n._first > prev && n._first <= i && visN.get(n.id); }).map(function (n) { return n.id; }));
  }
  function stopPlay() {
    if (!playT) return;
    clearInterval(playT);
    playT = null;
    syncTimeline();
  }
  function startPlay() {
    if (!G) return;
    S.sel = null; S.path = null; S.pathFrom = null; S.pathMiss = null;
    fitOnStop = false;
    G.zoomToFit(reduce ? 0 : 700, 50);
    if (S.upto >= LASTC) {
      S.upto = -1;
      setUpto(0, true);
    }
    playT = setInterval(function () {
      if (S.upto >= LASTC) { stopPlay(); return; }
      setUpto(S.upto + 1, true);
    }, 2100);
    syncTimeline();
  }

  function setSize(mode, persist) {
    if (mode === 'strength' && !HAS_STR) mode = 'conn';
    S.size = mode;
    $('btn-size-conn').setAttribute('aria-pressed', String(mode === 'conn'));
    $('btn-size-strength').setAttribute('aria-pressed', String(mode === 'strength'));
    $('lg-size-text').textContent = mode === 'strength' ? 'Size = strength (how often you return to it)' : 'Size = number of connections';
    if (persist) saveSize(mode);
    if (G) {
      /* a fresh accessor makes the graph rebuild node objects so rings and labels follow the new radius */
      G.nodeVal(nodeVal).nodeThreeObject(function (n) { return buildNodeObject(n); });
      bump();
    }
  }
  function refreshCounts() { /* static totals; visibility feedback comes from the canvas */ }
  function onFilter() {
    if (S.sel && !nodeVisible(byId.get(S.sel))) S.sel = null;
    bump();
    renderDetail();
    runSearch();
  }

  /* ------------------------------------------------------------------ *
   * Share dock: what leads the conversations
   * ------------------------------------------------------------------ */
  var SHARE_GROUPS = [
    { id: 'thread', name: 'Thread' },
    { id: 'type', name: 'Type' },
    { id: 'field', name: 'Field' },
    { id: 'origin', name: 'Origin' }
  ];
  var SHARE_METRICS = [
    { id: 'engagement', name: 'Engagement' },
    { id: 'mentions', name: 'Mentions' },
    { id: 'count', name: 'Count' }
  ];
  var NONE = '__none';   // key of the Unclassified field row
  var SEP = '\u0001';    // joins field and subfield in composite keys
  var shWidths = {};     // last drawn bar width per row key, so bars animate from where they were

  function shareValue(it, scope, metric) {
    if (scope) {
      var c = it.byConv ? it.byConv[scope] : 0;
      if (!(c > 0)) return null;
      if (metric === 'engagement') return 1 + Math.log(c);
      if (metric === 'mentions') return c;
      return 1;
    }
    if (metric === 'engagement') return isNum(it.strength) ? it.strength : null;
    if (metric === 'mentions') return isNum(it.mentions) ? it.mentions : null;
    return 1;
  }
  function shareLabel(group, key) {
    if (group === 'thread') return '§ ' + key + '  ' + threadName(key);
    if (group === 'type') return (TYPE_BY_ID[key] || {}).name || key;
    if (group === 'field') return key === NONE ? 'Unclassified' : key;
    var o = ORIGINS.filter(function (x) { return x.id === key; })[0];
    return o ? o.name : key;
  }
  /* group: thread | type | field | origin. Counts only what the filters leave visible.
     Field rows carry .subs (subfield rows, share of the total). */
  function shareCompute(group, metric, scope) {
    var acc = {}, cnt = {}, subAcc = {}, shown = 0, all = 0;
    function add(key, v) { acc[key] = (acc[key] || 0) + v; cnt[key] = (cnt[key] || 0) + 1; }
    if (group === 'origin') {
      links.forEach(function (l) {
        if (l.type === 'belongs-to') return;
        all++;
        if (!visL.get(l.id)) return;
        shown++;
        var v = shareValue(l, scope, metric);
        if (v > 0) add(l.origin, v);
      });
    } else {
      nodes.forEach(function (n) {
        if (n.type === 'theme') return;
        all++;
        if (!visN.get(n.id)) return;
        shown++;
        var v = shareValue(n, scope, metric);
        if (!(v > 0)) return;
        if (group === 'type') { add(n.type, v); return; }
        if (group === 'field') {
          var fk = n.field || NONE;
          add(fk, v);
          if (n.field) {
            var sa = subAcc[fk] || (subAcc[fk] = {}), sk = n.subfield || 'Other';
            var se = sa[sk] || (sa[sk] = { v: 0, c: 0 });
            se.v += v; se.c++;
          }
          return;
        }
        var ts = n.threads.filter(function (t) { return S.threads.has(t); });
        ts.forEach(function (t) { add(t, v / ts.length); });
      });
    }
    var total = 0;
    var rows = Object.keys(acc).map(function (k) {
      total += acc[k];
      return { key: k, label: shareLabel(group, k), value: acc[k], count: cnt[k], subs: [] };
    });
    rows.sort(function (a, b) { return (a.key === NONE) - (b.key === NONE) || b.value - a.value || a.label.localeCompare(b.label); });
    rows.forEach(function (r) {
      r.share = total > 0 ? r.value / total : 0;
      var sa = subAcc[r.key];
      if (sa) {
        r.subs = Object.keys(sa).map(function (sk) {
          return { key: r.key, sub: sk, label: sk, value: sa[sk].v, count: sa[sk].c, share: total > 0 ? sa[sk].v / total : 0 };
        }).sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
      }
    });
    return { rows: rows, total: total, shown: shown, all: all };
  }
  /* rows as drawn: field rows, with the subfield rows of expanded fields right after them */
  function shareFlat(res, group) {
    var out = [];
    res.rows.forEach(function (r) {
      out.push(r);
      if (group === 'field' && S.share.expanded[r.key]) r.subs.forEach(function (s) { s.isSub = true; out.push(s); });
    });
    return out;
  }
  function fmtPct(share) {
    var p = share * 100;
    if (share > 0 && p < 1) return '<1%';
    return Math.round(p) + '%';
  }
  function fmtRaw(v, metric) { return metric === 'engagement' ? v.toFixed(1) : String(Math.round(v)); }
  function shareMarker(group, key) {
    if (group === 'type') return '<span class="sh-dot" style="background:' + ((TYPE_BY_ID[key] || {}).color || '#888888') + '"></span>';
    if (group === 'origin') {
      if (key === 'owner') return '<span class="sh-dot" style="background:var(--oxblood)"></span>';
      if (key === 'claude') return '<span class="sh-dot" style="background:var(--forest)"></span>';
      return '<span class="sh-dot ring"></span>';
    }
    return '';
  }
  function shareFootnote(sh) {
    var item = sh.group === 'origin' ? 'link' : 'node';
    var split = sh.group === 'thread' ? ' A node in two threads counts half to each.' : '';
    var tail = sh.group === 'field'
      ? ' Fields follow Wikipedia’s Contents/Categories headings. Claude assigned one field and subfield per node by subject, so read them as inferred, not as your statements.'
      : '';
    if (sh.scope) {
      if (sh.metric === 'engagement') return 'In one conversation, engagement per ' + item + ' is 1 + ln(mentions).' + split + tail;
      if (sh.metric === 'mentions') return 'Mentions sums how often each ' + item + ' came up in this conversation.' + split + tail;
      return 'Count tallies the ' + item + 's that came up in this conversation, one each.' + split + tail;
    }
    if (sh.metric === 'engagement') return 'Engagement sums ' + item + ' strength: mentions, distinct conversations and recency.' + split + tail;
    if (sh.metric === 'mentions') return 'Mentions sums how often each ' + item + ' came up across all conversations.' + split + tail;
    return 'Count tallies the ' + item + 's, one each.' + split + tail;
  }

  function buildShare() {
    var sh = S.share;
    $('sh-group').innerHTML = SHARE_GROUPS.map(function (g) {
      return '<button type="button" class="btn" data-g="' + g.id + '" aria-pressed="' + (sh.group === g.id) + '">' + g.name + '</button>';
    }).join('');
    $('sh-metric').innerHTML = SHARE_METRICS.map(function (m) {
      return '<button type="button" class="btn" data-m="' + m.id + '" aria-pressed="' + (sh.metric === m.id) + '">' + m.name + '</button>';
    }).join('');
    $('sh-scope').innerHTML = '<option value="">All conversations</option>' + CONVS.slice().reverse().map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.date) + ' · ' + esc(c.title || c.id || '') + '</option>';
    }).join('');
    $('sh-scope').value = sh.scope;
    $('sh-scope-field').hidden = !CONVS.length;

    $('sh-group').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-g]') : null;
      if (!b || sh.group === b.getAttribute('data-g')) return;
      sh.group = b.getAttribute('data-g');
      S.focus = null; shWidths = {};
      saveShare();
      bump();
    });
    $('sh-metric').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-m]') : null;
      if (!b || sh.metric === b.getAttribute('data-m')) return;
      sh.metric = b.getAttribute('data-m');
      saveShare();
      renderShare();
    });
    $('sh-scope').addEventListener('change', function (e) {
      sh.scope = e.target.value;
      saveShare();
      renderShare();
    });
    $('sh-rows').addEventListener('click', function (e) {
      var tw = e.target.closest ? e.target.closest('button[data-tw]') : null;
      if (tw) {
        var fk = tw.getAttribute('data-tw');
        if (sh.expanded[fk]) delete sh.expanded[fk]; else sh.expanded[fk] = true;
        saveShare();
        renderShare();
        var again = $('sh-rows').querySelector('button[data-tw]');
        Array.prototype.forEach.call($('sh-rows').querySelectorAll('button[data-tw]'), function (x) { if (x.getAttribute('data-tw') === fk) again = x; });
        if (again) again.focus();
        return;
      }
      var b = e.target.closest ? e.target.closest('button[data-key]') : null;
      if (!b) return;
      var key = b.getAttribute('data-key');
      var sub = b.hasAttribute('data-sub') ? b.getAttribute('data-sub') : null;
      var f = S.focus;
      var same = f && f.by === sh.group && f.key === key && (f.sub == null ? null : f.sub) === sub;
      S.focus = same ? null : { by: sh.group, key: key, sub: sub };
      bump();
    });
    $('sh-clear').addEventListener('click', function () { S.focus = null; bump(); });
  }

  function renderShare() {
    if (!shareEl) return;
    var sh = S.share;
    var res = shareCompute(sh.group, sh.metric, sh.scope);
    /* teaser on the bar while the dock is hidden: the current leader, same numbers as the first bar */
    var lead = res.rows.length ? res.rows[0] : null;
    $('sb-tease').textContent = lead && !isOpen('share')
      ? lead.label.replace(/\s+/g, ' ') + ' leads \u00b7 ' + fmtPct(lead.share) : '';
    if (!isOpen('share')) return;
    var rows = res.rows;
    var flat = shareFlat(res, sh.group);
    var itemWord = sh.group === 'origin' ? 'links' : 'nodes';
    var isField = sh.group === 'field';

    Array.prototype.forEach.call($('sh-group').children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-g') === sh.group)); });
    Array.prototype.forEach.call($('sh-metric').children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-m') === sh.metric)); });
    if ($('sh-scope').value !== sh.scope) $('sh-scope').value = sh.scope;
    $('sh-clear').hidden = !S.focus;

    var top = 0;
    rows.forEach(function (r) { if (r.value > top) top = r.value; });
    var targets = [], wkeys = [];
    var f = S.focus;
    $('sh-rows').innerHTML = rows.length ? flat.map(function (r, i) {
      var isSub = !!r.isSub;
      var w = top > 0 ? r.value / top * 100 : 0;
      var wk = isSub ? r.key + SEP + r.sub : r.key;
      targets.push(w); wkeys.push(wk);
      var pressed = !!(f && f.by === sh.group && f.key === r.key && (isSub ? f.sub === r.sub : f.sub == null));
      var tip = r.label.replace(/\s+/g, ' ') + (isSub ? ' (' + (r.key) + ')' : '') + ' · ' + fmtRaw(r.value, sh.metric) + ' ' + sh.metric + ' · ' + fmtPct(r.share) + ' · ' + r.count + ' ' + itemWord;
      var start = reduce ? w : (shWidths[wk] || 0);
      var name = sh.group === 'thread'
        ? '<span class="num">§ ' + esc(r.key) + '</span>' + esc(threadName(r.key))
        : esc(r.label);
      var cls = 'sh-row' + (i === 0 ? ' lead' : '') + (isSub ? ' sh-sub' : '') + (r.key === NONE && isField ? ' none' : '');
      var btn = '<button type="button" class="' + cls + '" data-key="' + esc(r.key) + '"' + (isSub ? ' data-sub="' + esc(r.sub) + '"' : '') +
        ' aria-pressed="' + pressed + '" title="' + esc(tip) + '">' +
        '<span class="sh-lbl">' + shareMarker(sh.group, r.key) + '<span class="sh-name">' + name + '</span></span>' +
        '<span class="sh-bar"><i style="width:' + start.toFixed(2) + '%"></i></span>' +
        '<span class="sh-val"><b>' + fmtPct(r.share) + '</b><em>' + fmtRaw(r.value, sh.metric) + '</em></span></button>';
      if (!isField) return btn;
      var lead;
      if (isSub || r.key === NONE) lead = '<span class="sh-tw-gap"></span>';
      else {
        var open = !!sh.expanded[r.key];
        lead = '<button type="button" class="sh-tw" data-tw="' + esc(r.key) + '" aria-expanded="' + open + '" aria-label="' +
          (open ? 'Hide' : 'Show') + ' subfields of ' + esc(r.label) + '">' + (open ? '▾' : '▸') + '</button>';
      }
      return '<div class="sh-line' + (isSub ? ' sh-sub' : '') + '">' + lead + btn + '</div>';
    }).join('') : '<p class="note">Nothing to count with the current filters.</p>';
    shWidths = {};
    wkeys.forEach(function (k, i) { shWidths[k] = targets[i]; });
    if (rows.length && !reduce) {
      var fills = $('sh-rows').querySelectorAll('.sh-bar i');
      requestAnimationFrame(function () {
        Array.prototype.forEach.call(fills, function (el, i) { if (targets[i] != null) el.style.width = targets[i].toFixed(2) + '%'; });
      });
    }

    var cn = $('sh-count');
    cn.hidden = res.shown >= res.all;
    cn.textContent = 'Counting ' + res.shown + ' of ' + res.all + ' ' + itemWord + ' (filters applied)';
    $('sh-foot').textContent = shareFootnote(sh);

    /* by-conversation heat table: mirrors the rows above; each cell is the row's share inside that one conversation */
    var showB = !sh.scope && CONVS.length >= 2 && rows.length > 0;
    $('sh-b').hidden = !showB;
    $('sh-body').classList.toggle('no-b', !showB);
    if (!showB) { $('sh-heat').innerHTML = ''; return; }
    var cols = CONVS.map(function (c) {
      var r = shareCompute(sh.group, sh.metric, c.id), m = {};
      r.rows.forEach(function (x) {
        m[x.key] = x.share;
        x.subs.forEach(function (s) { m[x.key + SEP + s.sub] = s.share; });
      });
      return { c: c, m: m };
    });
    var ckey = function (r) { return r.isSub ? r.key + SEP + r.sub : r.key; };
    var mx = 0;
    flat.forEach(function (r) { cols.forEach(function (col) { mx = Math.max(mx, col.m[ckey(r)] || 0); }); });
    var head = '<tr><th class="hr"></th>' + cols.map(function (col) {
      var full = col.c.date + ' · ' + (col.c.title || col.c.id);
      return '<th class="hc" scope="col" title="' + esc(full) + '"><span class="hd">' + esc(col.c.date) + '</span><span class="ht">' + esc(col.c.title || col.c.id) + '</span></th>';
    }).join('') + '</tr>';
    var body = flat.map(function (r) {
      var rl = r.label.replace(/\s+/g, ' ');
      return '<tr' + (r.isSub ? ' class="sh-sub"' : '') + '><th class="hr" scope="row" title="' + esc(rl) + '"><span>' + esc(r.label) + '</span></th>' + cols.map(function (col) {
        var v = col.m[ckey(r)] || 0;
        var tip = esc(rl + ' · ' + (col.c.title || col.c.id) + ' · ' + (v > 0 ? fmtPct(v) : 'none'));
        if (!(v > 0)) return '<td class="nil" title="' + tip + '">–</td>';
        var a = mx > 0 ? 0.85 * v / mx : 0;
        return '<td class="' + (a > 0.5 ? 'hot' : '') + '" style="background:' + hexA(OX, a.toFixed(3)) + '" title="' + tip + '">' + fmtPct(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('sh-heat').innerHTML = '<table class="heat"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */
  var searchEl = $('search'), resEl = $('search-results');
  var results = [], active = -1;
  function closeResults() {
    results = []; active = -1;
    resEl.hidden = true; resEl.innerHTML = '';
    searchEl.setAttribute('aria-expanded', 'false');
  }
  function runSearch() {
    var q = searchEl.value.trim().toLowerCase();
    if (!q) { closeResults(); return; }
    results = nodes.filter(function (n) { return visN.get(n.id) && (n.label.toLowerCase().indexOf(q) >= 0 || displayLabel(n).toLowerCase().indexOf(q) >= 0); })
      .sort(function (a, b) {
        var as = a.label.toLowerCase().indexOf(q) === 0 ? 0 : 1, bs = b.label.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        return as - bs || b.deg - a.deg;
      }).slice(0, 8);
    active = results.length ? 0 : -1;
    if (!results.length) {
      resEl.innerHTML = '<li class="empty">No visible node matches.</li>';
    } else {
      resEl.innerHTML = results.map(function (n, i) {
        return '<li><button type="button" data-i="' + i + '" class="' + (i === active ? 'is-active' : '') + '">' + esc(displayLabel(n)) + '<span>' + esc((TYPE_BY_ID[n.type] || {}).name || n.type) + '</span></button></li>';
      }).join('');
    }
    resEl.hidden = false;
    searchEl.setAttribute('aria-expanded', 'true');
  }
  function pick(i) {
    var n = results[i];
    if (!n) return;
    searchEl.value = '';
    closeResults();
    selectNode(n.id, true);
  }
  function highlightActive() {
    var bs = resEl.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('is-active', i === active);
  }
  searchEl.addEventListener('input', runSearch);
  searchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); pick(active >= 0 ? active : 0); }
    else if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); active = (active + 1) % results.length; highlightActive(); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); active = (active - 1 + results.length) % results.length; highlightActive(); }
    else if (e.key === 'Escape' && (searchEl.value || results.length)) { e.stopPropagation(); searchEl.value = ''; closeResults(); }
  });
  resEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-i]') : null;
    if (b) pick(parseInt(b.getAttribute('data-i'), 10));
  });

  /* ------------------------------------------------------------------ *
   * Header
   * ------------------------------------------------------------------ */
  function buildHeader() {
    if (META.title) { $('title').textContent = META.title; }
    var lc = META.latestConversation;
    var latest = lc ? (typeof lc === 'object' ? (lc.date || '') : String(lc).split(' ')[0]) : (CONVS.length ? CONVS[CONVS.length - 1].date : '');
    $('subtitle').textContent = nodes.length + ' nodes · ' + links.length + ' edges' +
      (CONVS.length ? ' · conversations: ' + CONVS.length + (latest ? ' · latest ' + latest : '') : '') +
      ' · ' + THREADS.length + ' threads' + (META.version ? ' · v' + META.version : '');
    var rn = byId.get(ROOT);
    $('root-name').textContent = rn ? rn.label : 'the root';
    if ($('legend-owner')) $('legend-owner').textContent = OWNER_NAME;
    $('threadnav').innerHTML = THREADS.map(function (t) {
      return '<button type="button" data-th="' + esc(t.id) + '" title="' + esc(t.summary || t.title) + '"><b>§ ' + esc(t.id) + '</b>' + esc(t.title) + '</button>';
    }).join('');
    $('threadnav').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-th]') : null;
      if (!b) return;
      var id = b.getAttribute('data-th');
      var th = nodes.filter(function (n) { return n.type === 'theme' && n.threads[0] === id; })[0];
      if (th) selectNode(th.id, true);
    });
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */
  function init() {
    var el = $('graph');
    var rect = el.getBoundingClientRect();
    computeVis();
    G = ForceGraph3D({ controlType: 'orbit' })(el)
      .width(Math.max(rect.width, 200)).height(Math.max(rect.height, 200))
      .backgroundColor(BONE)
      .showNavInfo(false)
      .graphData({ nodes: nodes, links: links })
      .nodeId('id')
      .nodeRelSize(REL)
      .nodeVal(nodeVal)
      .nodeResolution(14)
      .nodeOpacity(1)
      .nodeColor(nodeColor)
      .nodeVisibility(nodeVisibility)
      .nodeLabel(tipNode)
      .nodeThreeObject(buildNodeObject)
      .nodeThreeObjectExtend(true)
      .linkOpacity(1)
      .linkColor(linkColor)
      .linkWidth(linkWidth)
      .linkVisibility(linkVisibility)
      .linkLabel(tipLink)
      .linkHoverPrecision(5)
      .linkDirectionalArrowLength(arrowLen)
      .linkDirectionalArrowColor(arrowColor)
      .linkDirectionalArrowRelPos(0.56)
      .linkDirectionalParticles(particles)
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor(function () { return FO; })
      .enableNodeDrag(false)
      .warmupTicks(40)
      .cooldownTime(12000)
      .onNodeClick(function (n) { selectNode(n.id, true); })
      .onNodeHover(function (n) { hoverNode = n || null; if (desk) syncCursor(); })
      .onBackgroundClick(function () { clearSelection(); });

    G.d3Force('charge').strength(-70);
    G.d3Force('link').distance(function (l) { return l.type === 'belongs-to' ? 36 : 56; });
    G.d3AlphaDecay(0.02);
    G.d3Force('cluster', makeClusterForce());

    G.scene().fog = new THREE.Fog(BONE, 1, 6000);
    buildWashes();
    var ctl = G.controls();
    if (ctl && ctl.addEventListener) ctl.addEventListener('change', function () { onCamera(false); });

    computeVis();
    bump();

    setupDesktop(el, ctl);
    el.addEventListener('pointerdown', function () { fitOnStop = false; });
    el.addEventListener('wheel', function () { fitOnStop = false; }, { passive: true });
    var spritesReady = false, ticks = 0;
    G.onEngineTick(function () {
      if (!spritesReady && objs.size >= nodes.length) { spritesReady = true; updateSprites(); }
      if (++ticks % 12 === 0) { updateWashes(); onCamera(true); }
    });
    G.onEngineStop(function () {
      if (fitOnStop) { fitOnStop = false; G.zoomToFit(reduce ? 0 : 700, 50); }
      updateWashes();
      setTimeout(function () { onCamera(true); }, reduce ? 50 : 800);
    });
    setTimeout(function () { if (fitOnStop) G.zoomToFit(0, 50); onCamera(true); }, 1400);
    /* the layout keeps spreading for a while: keep the frame tight until it settles or the reader takes over */
    [3200, 5600, 8400].forEach(function (ms) {
      setTimeout(function () { if (fitOnStop) { G.zoomToFit(reduce ? 0 : 500, 50); setTimeout(function () { onCamera(true); }, 600); } }, ms);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) G.width(r.width).height(r.height);
      }).observe(el);
    }
    window.addEventListener('resize', function () {
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) G.width(r.width).height(r.height);
    });
  }

  /* ------------------------------------------------------------------ *
   * Desktop profile (mouse / trackpad); touch keeps the stock controls
   * ------------------------------------------------------------------ */
  var deskCtl = null, deskEl = null, deskBase = null, hintEl = null, hintTouch = '', dragging = false, wheelRe = false;
  var HINT_DESK = 'Drag to orbit &middot; scroll zooms to pointer &middot; shift-drag pans &middot; double-click fits';

  function syncCursor() {
    if (!deskEl) return;
    var c = desk ? (dragging ? 'grabbing' : hoverNode ? 'pointer' : 'grab') : '';
    deskEl.style.cursor = c;
    var cv = deskEl.querySelector('canvas');
    if (cv) cv.style.cursor = c;
  }
  function applyDesk() {
    var c = deskCtl;
    if (!c) return;
    var on = deskMQ.matches;
    if (on && !deskBase) {
      deskBase = { zoomSpeed: c.zoomSpeed, zoomToCursor: c.zoomToCursor, enableDamping: c.enableDamping, dampingFactor: c.dampingFactor, screenSpacePanning: c.screenSpacePanning, middle: c.mouseButtons ? c.mouseButtons.MIDDLE : undefined, pan: c.mouseButtons ? c.mouseButtons.RIGHT : undefined };
    }
    desk = on;
    if (on) {
      if ('zoomToCursor' in c) c.zoomToCursor = true;
      if ('enableDamping' in c) { c.enableDamping = !reduce; c.dampingFactor = 0.1; }
      if ('screenSpacePanning' in c) c.screenSpacePanning = true;
      if ('zoomSpeed' in c) c.zoomSpeed = 2.5;        // one 100-delta notch is about 12% of the distance
      if (c.mouseButtons && deskBase.pan !== undefined) c.mouseButtons.MIDDLE = deskBase.pan;   // middle-drag pans like right-drag
    } else if (deskBase) {
      c.zoomToCursor = deskBase.zoomToCursor; c.enableDamping = deskBase.enableDamping; c.dampingFactor = deskBase.dampingFactor;
      c.screenSpacePanning = deskBase.screenSpacePanning; c.zoomSpeed = deskBase.zoomSpeed;
      if (c.mouseButtons) c.mouseButtons.MIDDLE = deskBase.middle;
    }
    if (hintEl) hintEl.innerHTML = on ? HINT_DESK : hintTouch;
    syncCursor();
  }
  /* wheel events: lines to pixels, trackpad pinch boosted, mouse spikes clamped; the controls scale by deltaY themselves */
  function wheelNorm(e) {
    if (!desk || e._dlg) return;
    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 33; else if (e.deltaMode === 2) d *= 400;
    if (e.ctrlKey) d *= 5;
    d = Math.max(-240, Math.min(240, d));
    if (d === e.deltaY && e.deltaMode === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var ne = new WheelEvent('wheel', { deltaY: d, deltaMode: 0, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true });
    ne._dlg = true;
    e.target.dispatchEvent(ne);
  }
  /* smooth keyboard camera nudge: orbit angles in radians, zoom as a distance factor */
  function nudge(dTheta, dPhi, zoom) {
    if (!G || !deskCtl) return;
    var cam = G.camera(), tg = deskCtl.target, t0 = null, done = 0, dur = reduce ? 0 : 220;
    fitOnStop = false;
    function step(now) {
      if (t0 === null) t0 = now;
      var p = dur ? Math.min(1, (now - t0) / dur) : 1, k = 1 - (1 - p) * (1 - p), f = k - done;
      done = k;
      var v = cam.position.clone().sub(tg);
      if (dTheta) v.applyAxisAngle(cam.up, dTheta * f);
      if (dPhi) {
        var ax = new THREE.Vector3().crossVectors(v, cam.up).normalize();
        var w = v.clone().applyAxisAngle(ax, dPhi * f);
        if (Math.abs(w.clone().normalize().dot(cam.up)) < 0.985) v = w;   // stop short of the poles
      }
      if (zoom) v.multiplyScalar(Math.pow(zoom, f));
      cam.position.copy(tg).add(v);
      if (!deskCtl.enableDamping) deskCtl.update();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function deskKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || !G) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    var k = e.key, a = e.shiftKey ? 0.36 : 0.12, z = e.shiftKey ? 0.6 : 0.8;
    if (k === 'ArrowLeft') nudge(a, 0, 0);
    else if (k === 'ArrowRight') nudge(-a, 0, 0);
    else if (k === 'ArrowUp') nudge(0, a, 0);
    else if (k === 'ArrowDown') nudge(0, -a, 0);
    else if (k === '+' || k === '=') nudge(0, 0, z);
    else if (k === '-' || k === '_') nudge(0, 0, 1 / z);
    else if (k === 'f' || k === 'F' || k === '0') { fitOnStop = false; G.zoomToFit(reduce ? 0 : 700, 50); }
    else return;
    e.preventDefault();
  }
  function setupDesktop(el, ctl) {
    deskCtl = ctl; deskEl = el;
    if (!ctl) return;
    hintEl = $('hint');
    if (hintEl) hintTouch = hintEl.innerHTML;
    el.addEventListener('wheel', wheelNorm, true);
    el.addEventListener('pointerdown', function (e) {
      if (desk && e.pointerType === 'mouse' && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) { dragging = true; syncCursor(); }
    });
    window.addEventListener('pointerup', function () { if (dragging) { dragging = false; syncCursor(); } });
    el.addEventListener('dblclick', function (e) {
      if (!desk) return;
      if (hoverNode) selectNode(hoverNode.id, true);
      else { fitOnStop = false; G.zoomToFit(reduce ? 0 : 700, 50); }
    });
    if (deskMQ.addEventListener) deskMQ.addEventListener('change', applyDesk);
    else if (deskMQ.addListener) deskMQ.addListener(applyDesk);
    applyDesk();
  }

  function resetView() {
    S.types = new Set(TYPES.map(function (t) { return t.id; }));
    S.threads = new Set(THREADS.map(function (t) { return t.id; }));
    S.origins = new Set(ORIGINS.map(function (o) { return o.id; }));
    S.convOnly = false; S.verifyOnly = false; S.sel = null; S.since = ''; S.focus = null;
    stopPlay();
    S.upto = LASTC; S.spot = false; S.path = null; S.pathFrom = null; S.pathMiss = null;
    syncTimeline();
    TYPES.forEach(function (t) { $('f-type-' + t.id).checked = true; });
    THREADS.forEach(function (t) { $('f-thread-' + t.id).checked = true; });
    ORIGINS.forEach(function (o) { $('f-origin-' + o.id).checked = true; });
    $('f-basis').checked = false; $('f-verify').checked = false; $('f-since').value = '';
    searchEl.value = ''; closeResults();
    bump(); renderDetail();
    G.zoomToFit(reduce ? 0 : 800, 50);
  }

  function wire() {
    $('btn-filters').addEventListener('click', function () { setPanel('filters', !isOpen('filters')); });
    $('btn-detail').addEventListener('click', function () { setPanel('detail', !isOpen('detail')); });
    $('btn-filters-close').addEventListener('click', function () { setPanel('filters', false); });
    $('btn-detail-close').addEventListener('click', function () { setPanel('detail', false); });
    $('btn-mode-cluster').addEventListener('click', function () { setMode('cluster'); });
    $('btn-mode-radial').addEventListener('click', function () { setMode('radial'); });
    $('btn-reset').addEventListener('click', resetView);
    $('btn-size-conn').addEventListener('click', function () { setSize('conn', true); });
    $('btn-size-strength').addEventListener('click', function () { setSize('strength', true); });
    $('btn-ink-even').addEventListener('click', function () { setInk('even', true); });
    $('btn-ink-recency').addEventListener('click', function () { setInk('recency', true); });
    $('share-bar').addEventListener('click', function () { setPanel('share', !isOpen('share')); });
    $('btn-history').addEventListener('click', function () { setPanel('history', !isOpen('history')); });
    $('btn-history-close').addEventListener('click', function () { setPanel('history', false); });
    $('hist-filter').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      S.hAct = b.getAttribute('data-act');
      renderHistory();
    });
    $('hist-list').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-hnode]') : null;
      if (!b) return;
      selectNode(b.getAttribute('data-hnode'), true);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') clearSelection();
      else if (desk) deskKey(e);
    });
    var onReduce = function (e) { reduce = e.matches; if (G) bump(); applyDesk(); };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReduce);
  }

  function renderHistory() {
    var counts = { all: logRows.length };
    ACTIONS.forEach(function (a) { counts[a] = 0; });
    logRows.forEach(function (en) { counts[en.action] = (counts[en.action] || 0) + 1; });
    var acts = ['all'].concat(ACTIONS.filter(function (a) { return counts[a]; }));
    Object.keys(counts).forEach(function (k) { if (acts.indexOf(k) < 0 && counts[k]) acts.push(k); });
    if (acts.indexOf(S.hAct) < 0) S.hAct = 'all';
    $('hist-count').textContent = logRows.length ? '· ' + logRows.length : '';
    $('hist-filter').innerHTML = acts.map(function (a) {
      return '<button type="button" class="btn chip" data-act="' + esc(a) + '" aria-pressed="' + (S.hAct === a) + '">' + esc(a) + ' ' + counts[a] + '</button>';
    }).join('');
    var rows = S.hAct === 'all' ? logRows : logRows.filter(function (en) { return en.action === S.hAct; });
    $('hist-list').innerHTML = rows.length
      ? rows.map(function (en) { return histEntryHtml(en, { showTarget: true }); }).join('')
      : '<li class="note">No entries.</li>';
  }

  buildHeader();
  buildFilters();
  if (HAS_STR) {
    $('sizeby-wrap').hidden = false;
    if (HAS_EDGE_STR) $('lg-strength').hidden = false;
    setSize(S.size, false);
  }
  if (LOG.length) { $('btn-history').hidden = false; renderHistory(); }
  buildShare();
  buildTimeline();
  if (HAS_TIME) { $('inkby-wrap').hidden = false; $('lg-glow').hidden = false; }
  wire();
  setInk(S.ink, false);
  renderDetail();
  if (phoneMQ.matches) { setPanel('filters', false); setPanel('detail', false); }
  setPanel('share', false); /* starts as its one-line teaser so the map gets the room; the bar under the map opens it */

  var fontsReady = Promise.race([
    (document.fonts && document.fonts.load
      ? Promise.all([
          document.fonts.load("italic 400 28px 'Newsreader'"),
          document.fonts.load("400 14px 'Newsreader'"),
          document.fonts.load("400 10px 'IBM Plex Mono'")
        ])
      : Promise.resolve()).catch(function () {}),
    new Promise(function (r) { setTimeout(r, 1500); })
  ]);
  fontsReady.then(init);

  window.__mm = { S: S, select: selectNode, setSize: setSize, setUpto: setUpto, play: startPlay, stop: stopPlay, order: CONV_ORDER, get graph() { return G; } };
})();
