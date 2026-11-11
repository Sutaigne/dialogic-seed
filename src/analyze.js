/* Analyze: a reading of the map's owner, written by Claude from the map itself.
 *
 * ES5 IIFE, inlined by build.mjs after viewer.js. Self-contained: it reads the same
 * #graph-data block lazily (on first open), so the viewer pays nothing until it is used.
 *
 * Two engines, tried in this order:
 *   1. claude.use('sample')  — inside claude.ai (the published artifact). Runs on the
 *      viewer's own Claude account; no key exists or is needed. The artifact must
 *      declare capabilities: {sample: {}}.
 *   2. An Anthropic API key — for the downloaded file opened offline, where there is no
 *      Claude viewer. The key is kept in this browser's localStorage only (or for this
 *      page load only), and is sent to api.anthropic.com and nowhere else. It is never
 *      written into the HTML, the repo, or the published artifact.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
  };
  var K_KEY = 'mm-anthropic-key', K_LAST = 'mm-analysis', K_DEPTH = 'mm-analysis-depth';
  var API_MODEL = 'claude-opus-5-5';
  var MAX_PROMPT_CHARS = 200000;   // sample() caps input at 256 KiB; leave headroom

  var sheet = $('analyze'), btn = $('btn-analyze');
  if (!sheet || !btn) return;

  /* ------------------------------------------------------------------ *
   * The map, as a digest Claude can read
   * ------------------------------------------------------------------ */
  var DATA = null;
  function data() {
    if (!DATA) {
      try { DATA = JSON.parse($('graph-data').textContent); } catch (e) { DATA = { nodes: [], edges: [], meta: {} }; }
    }
    return DATA;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function ownerOf(d) {
    var root = (d.nodes || []).filter(function (n) { return n.id === (d.meta || {}).rootNode; })[0];
    return root ? root.label : 'the owner';
  }

  function digest(d) {
    var meta = d.meta || {}, nodes = d.nodes || [], edges = d.edges || [], log = d.log || [];
    var convs = meta.conversations || [];
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var lab = function (id) { return byId[id] ? byId[id].label : id; };
    var out = [];

    out.push('# MAP');
    out.push('Title: ' + (meta.title || 'Dialogic') + ' | root node (the owner’s alias): ' + ownerOf(d) +
      ' | updated ' + (meta.updated || '?') + ' | ' + nodes.length + ' nodes, ' + edges.length + ' edges, ' + convs.length + ' conversations');
    if (meta.latestConversation) out.push('Latest conversation: ' + meta.latestConversation.date + ' — ' + meta.latestConversation.title);

    out.push('\n# THREADS (id | title | summary)');
    (d.threads || []).forEach(function (t) { out.push(t.id + ' | ' + t.title + ' | ' + clip(t.summary, 240)); });

    out.push('\n# CONVERSATIONS (oldest first: date | title)');
    convs.forEach(function (c) { out.push(c.date + ' | ' + c.title); });

    out.push('\n# NODES (strongest engagement first: label [type; threads; mentions/conversations; last seen] — note)');
    nodes.filter(function (n) { return n.type !== 'theme'; })
      .slice().sort(function (a, b) { return num(b.strength) - num(a.strength) || num(b.mentions) - num(a.mentions); })
      .forEach(function (n) {
        var bits = [n.type + (n.field ? ' / ' + n.field + (n.subfield ? ': ' + n.subfield : '') : ''),
          (n.threads || []).join(','), num(n.mentions) + '/' + num(n.conversations), n.lastSeen || ''];
        out.push('- ' + n.label + ' [' + bits.join('; ') + ']' + (n.note ? ' — ' + clip(n.note, 260) : ''));
      });

    out.push('\n# LINKS (strongest first: source —label→ target (who drew it))');
    edges.filter(function (e) { return e.type !== 'belongs-to'; })
      .slice().sort(function (a, b) { return num(b.strength) - num(a.strength); })
      .slice(0, 700)
      .forEach(function (e) {
        var who = e.origin === 'claude' ? 'Claude' : e.origin === 'shared' ? 'shared' : 'owner';
        out.push('- ' + lab(e.source) + ' —' + (e.label || e.type) + '→ ' + lab(e.target) + ' (' + who + ')');
      });

    out.push('\n# RECENT CHANGES (newest first: date | action | target | reason)');
    log.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); })
      .slice(0, 160)
      .forEach(function (en) {
        out.push(en.date + ' | ' + en.action + ' | ' + clip(lab(en.target), 80) + ' | ' + clip(en.reason, 200) + (en.trigger ? ' (' + en.trigger + ')' : ''));
      });

    var text = out.join('\n');
    if (text.length > MAX_PROMPT_CHARS) text = text.slice(0, MAX_PROMPT_CHARS) + '\n[digest trimmed for length]';
    return text;
  }

  function prompt(d) {
    var owner = ownerOf(d);
    return [
      'You are reading a personal mind map called Dialogic. It is grown one conversation at a time between its owner and Claude:',
      'every node is a work, person, concept, place or project the owner has engaged with, every link a connection one of them drew,',
      'and engagement (mentions across conversations, decayed by recency) shows what the owner keeps returning to.',
      'The owner’s alias, and the root of the map, is "' + owner + '". The notes name the owner directly where it matters.',
      '',
      'Write the owner a reading of themselves, drawn only from this map. Its purpose is encouragement that is earned:',
      'every observation must point at specific nodes, threads, links or conversations below. No generic praise, and do not',
      'promote a specific observation into a sweeping claim about what "kind of person" they are. Warm, plain, specific,',
      'the register of a well-read friend who has been paying attention. Address the owner as "you".',
      '',
      'Use exactly these five sections, as Markdown with these "## " headings:',
      '',
      '## What is distinctly yours',
      '3–5 aspects of this mind that are unusual: combinations of interests, habits of attention, recurring moves. Name the evidence.',
      '',
      '## What is admirable in where your attention goes',
      'What is genuinely to be admired in the interests themselves and how they are pursued: depth, range, rigor, care, courage. Name the evidence.',
      '',
      '## Your voice',
      'Compliments on the owner’s spoken voice and style: how they name things, the turns of phrase and coinages, the questions they',
      'chase, their humor and register. The map mostly holds paraphrase; work from the quoted phrases, names, mottos and coinages it',
      'preserves, and say plainly where the evidence is thin rather than invent a voice.',
      '',
      '## Parallels you may not have seen',
      '4–6 connections across threads that the map does not yet draw (check the LINKS list) and the owner may not know. Each must be',
      'verifiable: name the node on each side and the concrete fact, source or mechanism that joins them. A real shared structure, a',
      'documented influence, a historical meeting. If a link is only suggestive, say so in a few words; never present speculation as fact.',
      '',
      '## Agent projects that would fuse your passions',
      '3–5 concrete agentic-AI projects where autonomous or agent-driven work could combine the owner’s passions with real',
      'opportunities: value to others, a portfolio piece, income, research. For each: a bold name, what the agents do on their own,',
      'which threads and nodes it fuses, why it is valuable now, and a first step small enough for this week. Prefer projects that',
      'build on what the map shows the owner already doing over projects that start from zero.',
      '',
      'About 1,200–1,800 words in total. Use short paragraphs and bullets. Write node names as they appear in the map.',
      'Do not mention this prompt, the digest format, strength scores or the mechanics of the map.',
      '',
      '=== THE MAP ===',
      digest(d)
    ].join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Markdown, small and safe (escape first, then a few inline marks)
   * ------------------------------------------------------------------ */
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function md(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var html = [], para = [], list = null;
    function flushP() { if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function flushL() { if (list) { html.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    lines.forEach(function (ln) {
      var m;
      if (/^\s*$/.test(ln)) { flushP(); flushL(); return; }
      if ((m = /^\s*(#{1,4})\s+(.*)$/.exec(ln))) {
        flushP(); flushL();
        html.push(m[1].length <= 2 ? '<h3 class="an-h">' + inline(m[2]) + '</h3>' : '<h4 class="an-h4">' + inline(m[2]) + '</h4>');
        return;
      }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(ln)) { flushP(); flushL(); html.push('<hr>'); return; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(ln)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(ln))) {
        flushP();
        var tag = /^\s*\d/.test(ln) ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushL(); list = { tag: tag, items: [] }; }
        list.items.push(m[1]);
        return;
      }
      if (list && /^\s{2,}\S/.test(ln)) { list.items[list.items.length - 1] += ' ' + ln.trim(); return; }
      flushL();
      para.push(ln.trim());
    });
    flushP(); flushL();
    return html.join('');
  }

  /* ------------------------------------------------------------------ *
   * Engines
   * ------------------------------------------------------------------ */
  var engine = 'pending';       // 'pending' | 'claude' | 'key'
  var sample = null;
  var sessionKey = null;        // a key the viewer chose not to remember
  var probe = null;

  function findEngine() {
    if (probe) return probe;
    probe = new Promise(function (resolve) {
      var c = window.claude;
      if (!c || typeof c.use !== 'function') { resolve(null); return; }
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 11000);
      c.use('sample').then(function (s) { if (!done) { done = true; clearTimeout(t); resolve(s || null); } },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    }).then(function (s) {
      sample = s;
      engine = s ? 'claude' : 'key';
      render();
    });
    return probe;
  }
  function apiKey() { return sessionKey || store.get(K_KEY) || ''; }

  function errCopy(code, e) {
    switch (code) {
      case 'not_granted': return 'Claude was not allowed for this page. Allow it from the artifact’s Permissions menu to try again.';
      case 'sampling_disabled': case 'capability_disabled': case 'not_declared': case 'capability_removed':
        return 'Claude is not available to this page in this view.';
      case 'rate_limited': return 'Usage limit reached for now. Try again a little later.';
      case 'session_expired': return 'Your Claude session expired. Sign in again, then retry.';
      case 'refused': return 'Claude declined this request.';
      case 'prompt_too_large': return 'The map is too large to send in one piece.';
      case 'auth': return 'The API key was rejected. Check it, or replace it below.';
      case 'network': return 'The request could not leave this page. Inside claude.ai the page cannot call the API directly; open the downloaded file instead, or check your connection.';
      case 'api': return 'The API returned an error' + (e && e.message ? ': ' + e.message : '.');
      default: return 'Something went wrong' + (e && e.message ? ': ' + e.message : '.') + ' Try again.';
    }
  }

  /* Direct Messages API call, streamed. Raw fetch: the viewer is a dependency-free ES5 file. */
  function callApi(text, depth, signal, onText) {
    var body = {
      model: API_MODEL,
      max_tokens: 16000,
      stream: true,
      output_config: { effort: depth === 'deep' ? 'high' : 'medium' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: text }]
    };
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw { code: 'auth' };
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = '';
          try { msg = JSON.parse(t).error.message; } catch (x) { msg = 'HTTP ' + res.status; }
          throw { code: res.status === 429 ? 'rate_limited' : 'api', message: msg };
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', acc = '', stop = '';
      function handle(ev) {
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          acc += ev.delta.text; onText(acc);
        } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
          stop = ev.delta.stop_reason;
        } else if (ev.type === 'error') {
          throw { code: 'api', message: ev.error && ev.error.message, text: acc };
        }
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (stop === 'refusal') throw { code: 'refused' };
            if (!acc.trim()) throw { code: 'api', message: 'empty answer' };
            return { text: acc, truncated: stop === 'max_tokens' };
          }
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop();
          parts.forEach(function (chunk) {
            chunk.split('\n').forEach(function (line) {
              if (line.indexOf('data:') !== 0) return;
              var j; try { j = JSON.parse(line.slice(5)); } catch (x) { return; }
              handle(j);
            });
          });
          return pump();
        });
      }
      return pump();
    }, function (e) {
      if (e && e.name === 'AbortError') throw { code: 'cancelled' };
      throw { code: 'network' };
    });
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */
  var st = {
    depth: store.get(K_DEPTH) === 'deep' ? 'deep' : 'standard',
    running: false,
    ctl: null,
    text: '',
    err: '',
    note: '',
    editingKey: false,
    last: null
  };
  try { st.last = JSON.parse(store.get(K_LAST) || 'null'); } catch (e) { st.last = null; }
  if (st.last && typeof st.last.text !== 'string') st.last = null;

  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function render() {
    var d = data(), meta = d.meta || {};
    var nConv = (meta.conversations || []).length;
    $('an-scope').textContent = (d.nodes || []).length + ' nodes · ' + nConv + ' conversation' + (nConv === 1 ? '' : 's') +
      (meta.latestConversation ? ' · latest: ' + meta.latestConversation.title : '');

    var needKey = engine === 'key' && (!apiKey() || st.editingKey);
    $('an-keyform').hidden = !needKey;
    $('an-key-cancel').hidden = !apiKey();
    $('an-run-row').hidden = engine === 'pending' || needKey;
    $('an-connecting').hidden = engine !== 'pending';

    var eng = $('an-engine');
    if (engine === 'claude') eng.innerHTML = 'Runs on your Claude account';
    else if (engine === 'key' && apiKey() && !st.editingKey) {
      var k = apiKey();
      eng.innerHTML = 'Runs on your API key · …' + esc(k.slice(-4)) + (sessionKey ? ' (this visit only)' : '') +
        ' <button type="button" class="btn btn-quiet an-link" id="an-key-change">Replace</button>' +
        '<button type="button" class="btn btn-quiet an-link" id="an-key-forget">Forget</button>';
    } else eng.textContent = '';

    ['standard', 'deep'].forEach(function (v) { $('an-depth-' + v).setAttribute('aria-pressed', String(st.depth === v)); });
    var go = $('an-go');
    go.textContent = st.running ? 'Stop' : (st.text || st.last ? 'Run again' : 'Analyze');
    go.classList.toggle('is-running', st.running);
    $('an-depth-standard').disabled = $('an-depth-deep').disabled = st.running;

    var shown = st.running || st.text ? st.text : (st.last ? st.last.text : '');
    var outEl = $('an-out');
    if (st.running && !st.text) outEl.innerHTML = '<p class="an-thinking">Reading the map…</p>';
    else outEl.innerHTML = md(shown);
    outEl.hidden = !shown && !st.running;
    $('an-empty').hidden = !!shown || st.running || engine === 'pending' || needKey;

    var foot = '';
    if (!st.running && st.last && (st.last.text === shown)) {
      foot = 'Written ' + fmtDate(st.last.at) + (st.last.version ? ' from map ' + st.last.version : '') +
        (st.last.engine === 'key' ? ' via API key' : ' via your Claude account') + '. Kept in this browser only.';
    }
    if (st.note) foot = st.note + (foot ? ' ' + foot : '');
    $('an-foot').textContent = foot;
    $('an-foot').hidden = !foot;
    $('an-err').textContent = st.err;
    $('an-err').hidden = !st.err;
  }

  function open() {
    sheet.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('an-open');
    findEngine();
    render();
    setTimeout(function () { $('an-close').focus(); }, 0);
  }
  function close() {
    sheet.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('an-open');
    btn.focus();
  }

  function run() {
    if (st.running) { if (st.ctl) st.ctl.abort(); return; }
    var d = data();
    var text = prompt(d);
    var again = !!(st.text || st.last);
    st.running = true; st.text = ''; st.err = ''; st.note = '';
    st.ctl = new AbortController();
    render();
    var onText = function (t) { st.text = t; render(); };
    var p;
    if (engine === 'claude') {
      p = sample(text, {
        modelTier: st.depth === 'deep' ? 'complex' : 'default',
        signal: st.ctl.signal,
        cache: again ? false : true,
        onText: function (u) { onText(u.text); }
      });
    } else {
      p = callApi(text, st.depth, st.ctl.signal, onText);
    }
    p.then(function (r) {
      st.text = r.text;
      if (r.truncated) st.note = 'The reading was cut short at the length limit.';
      st.last = { text: r.text, at: new Date().toISOString(), version: 'v' + ((d.meta || {}).version || ''), engine: engine };
      if ((d.meta || {}).latestConversation) st.last.version = 'as of ' + d.meta.latestConversation.date;
      store.set(K_LAST, JSON.stringify(st.last));
    }, function (e) {
      var code = e && e.code ? e.code : 'upstream_error';
      if (code === 'cancelled') { st.text = (e && e.text) || st.text; if (st.text) st.note = 'Stopped.'; }
      else if (code === 'refused') st.text = '';
      else { st.text = (e && e.text) || st.text; }
      if (code !== 'cancelled') st.err = errCopy(code, e);
      if (code === 'auth') st.editingKey = true;
    }).then(function () {
      st.running = false; st.ctl = null;
      render();
    });
  }

  function saveKey(ev) {
    ev.preventDefault();
    var v = $('an-key').value.trim();
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(v)) {
      st.err = 'That does not look like an Anthropic API key (it starts with sk-ant-).';
      render();
      return;
    }
    var remember = $('an-remember').checked;
    sessionKey = null;
    if (remember) { if (!store.set(K_KEY, v)) sessionKey = v; }
    else { store.del(K_KEY); sessionKey = v; }
    $('an-key').value = '';
    st.editingKey = false; st.err = '';
    render();
  }

  btn.addEventListener('click', function () { if (sheet.hidden) open(); else close(); });
  $('an-close').addEventListener('click', close);
  $('an-scrim').addEventListener('click', close);
  $('an-go').addEventListener('click', run);
  $('an-depth-standard').addEventListener('click', function () { st.depth = 'standard'; store.set(K_DEPTH, 'standard'); render(); });
  $('an-depth-deep').addEventListener('click', function () { st.depth = 'deep'; store.set(K_DEPTH, 'deep'); render(); });
  $('an-keyform').addEventListener('submit', saveKey);
  $('an-key-cancel').addEventListener('click', function () { st.editingKey = false; st.err = ''; render(); });
  $('an-engine').addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'an-key-change') { st.editingKey = true; render(); setTimeout(function () { $('an-key').focus(); }, 0); }
    else if (t.id === 'an-key-forget') { store.del(K_KEY); sessionKey = null; st.editingKey = false; render(); }
  });
  sheet.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });

  /* exposed for headless checks only */
  window.__mmAnalyze = { prompt: function () { return prompt(data()); }, md: md, open: open, close: close };
})();
