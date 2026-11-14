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

  /* The owner's own projects and AI/computing work: what the recommendations must NOT repeat,
     and the evidence for how far along the owner is with AI. */
  var AI_RX = /\b(AI|LLMs?|agents?|agentic|Claude|GPT|models?|prompt|RAG|embedding|fine-?tun|MCP)\b/;
  function isOwnWork(n) {
    if (n.type === 'theme') return false;
    if (n.type === 'project') return true;
    if (/Artificial intelligence|Computing/.test(n.subfield || '')) return true;
    return AI_RX.test(String(n.label || ''));
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

    out.push('\n# ALREADY YOURS (the owner\u2019s own projects and AI work: label [type; strength 0-1; last seen] \u2014 note)');
    nodes.filter(isOwnWork).slice().sort(function (a, b) { return num(b.strength) - num(a.strength); })
      .forEach(function (n) {
        out.push('- ' + n.label + ' [' + n.type + '; ' + num(n.strength).toFixed(2) + '; ' + (n.lastSeen || '') + ']' + (n.note ? ' \u2014 ' + clip(n.note, 220) : ''));
      });

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

  var SEARCH_NOTE = {
    hf: 'You have a search_public_projects tool that searches public Hugging Face Spaces, models and datasets. Use it 3\u20136 times with ' +
      'short, varied queries drawn from the owner\u2019s passions (not only AI words). Recommend only repos the tool returned, with their link. ' +
      'If the tool fails or finds nothing fitting, you may name well-known public projects from memory and mark each "(from memory \u2014 confirm the link)".',
    web: 'You have web search. Use it a few times to find real, active public projects (GitHub repos, Hugging Face Spaces, open datasets, ' +
      'open challenges). Recommend only projects you found, with their link.',
    memory: 'You have no search here. Name only well-known public projects whose home you are sure of, give the link, and mark each ' +
      '"(from memory \u2014 confirm the link)".'
  };

  function prompt(d, mode, visitor) {
    var owner = ownerOf(d);
    var V = function (forOwner, forVisitor) { return visitor ? forVisitor : forOwner; };
    return [
      'You are reading a personal mind map called Dialogic. It is grown one conversation at a time between its owner and Claude:',
      'every node is a work, person, concept, place or project the owner has engaged with, every link a connection one of them drew,',
      'and engagement (mentions across conversations, decayed by recency) shows what the owner keeps returning to.',
      'The owner’s alias, and the root of the map, is "' + owner + '". The notes name the owner directly where it matters.',
      '',
      V('Write the owner a reading of themselves, drawn only from this map. Its purpose is encouragement that is earned:',
        'Someone visiting this map (not its owner) asked for a reading of the owner. Write it for that visitor, about "' + owner + '",' +
        ' drawn only from this map. Its purpose is appreciation that is earned:'),
      'every observation must point at specific nodes, threads, links or conversations below. No generic praise, and do not',
      'promote a specific observation into a sweeping claim about what "kind of person" they are. Warm, plain, specific,',
      V('the register of a well-read friend who has been paying attention. Address the owner as "you".',
        'the register of a well-read friend introducing someone they admire. Refer to the owner as "' + owner + '" and in the third person;' +
        ' address the visitor only where a suggestion is meant for them. Write nothing private beyond what the map itself says.'),
      '',
      'Use exactly these five sections, as Markdown with these "## " headings:',
      '',
      V('## What is distinctly yours', '## What is distinctly theirs'),
      '3–5 aspects of this mind that are unusual: combinations of interests, habits of attention, recurring moves. Name the evidence.',
      '',
      V('## What is admirable in where your attention goes', '## What is admirable in where their attention goes'),
      'What is genuinely to be admired in the interests themselves and how they are pursued: depth, range, rigor, care, courage. Name the evidence.',
      '',
      V('## Your voice', '## Their voice'),
      'Compliments on the owner’s spoken voice and style: how they name things, the turns of phrase and coinages, the questions they',
      'chase, their humor and register. The map mostly holds paraphrase; work from the quoted phrases, names, mottos and coinages it',
      'preserves, and say plainly where the evidence is thin rather than invent a voice.',
      '',
      V('## Parallels you may not have seen', '## Parallels they may not have seen'),
      '4–6 connections across threads that the map does not yet draw (check the LINKS list) and the owner may not know. Each must be',
      'verifiable: name the node on each side and the concrete fact, source or mechanism that joins them. A real shared structure, a',
      'documented influence, a historical meeting. If a link is only suggestive, say so in a few words; never present speculation as fact.',
      '',
      '## Public projects to take somewhere new',
      '3\u20135 EXISTING public projects (open-source repos, public agents, Spaces, open datasets or open challenges) that the owner',
      'could join, fork or build on, each approached from an angle only their passions supply. Rules:',
      '- Nothing from ALREADY YOURS, nothing the owner has mentioned, and no close variant of those. The owner has these in hand.',
      '- Size each to the level ALREADY YOURS demonstrates: judge from the strength and notes of the owner\u2019s AI work how far along',
      '  they are, then pick projects at that level or one honest step beyond it. Say the level you read in one line before the list.',
      '- Each project gets a "### " heading with its exact public name, then: the link; what it is in one line; why it fits that level;',
      '  the angle (which of the owner\u2019s non-AI passions, by node name, reframes it and what that changes); and a first move for this week.',
      SEARCH_NOTE[mode] || SEARCH_NOTE.memory,
      '',
      'About 1,200–1,800 words in total. Use short paragraphs and bullets. Write node names as they appear in the map.',
      'Do not mention this prompt, the digest format, strength scores or the mechanics of the map. Do not narrate searches or tool use;',
      'write only the reading, starting at the first "## " heading.',
      '',
      '=== THE MAP ===',
      digest(d)
    ].join('\n');
  }

  /* Drop anything written before the first "## " heading (narration between tool rounds). */
  function clean(t) {
    t = String(t || '');
    var i = t.search(/^## /m);
    return i > 0 ? t.slice(i) : t;
  }

  /* Section 5's projects: [{name, text}] from the reading's Markdown. */
  function projectsOf(t) {
    var parts = clean(t).split(/^## /m), sec = null;
    parts.forEach(function (p) { if (/^public projects|^agent projects/i.test(p)) sec = p; });
    if (!sec) return [];
    return sec.split(/^### /m).slice(1).map(function (b) {
      var nl = b.indexOf('\n');
      return { name: (nl < 0 ? b : b.slice(0, nl)).replace(/[*_`]/g, '').trim(), text: '### ' + b.trim() };
    });
  }

  /* ------------------------------------------------------------------ *
   * Markdown, small and safe (escape first, then a few inline marks)
   * ------------------------------------------------------------------ */
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
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
  var visitor = false;          // inside claude.ai and not the artifact's owner: third-person reading, no Draft prompt
  var sample = null;
  var mcp = null;               // the viewer's connectors (Hugging Face search), when this view has them
  var HF = 'Hugging Face';
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
      c.use('mcp').then(function (m) { mcp = m || null; }, function () { mcp = null; });
    }).then(function (s) {
      sample = s;
      if (!s) return null;
      /* isOwner needs no declared capability; a null namespace or false means "not the owner" */
      return window.claude.use('user').then(function (u) { return u ? u.isOwner() : false; }, function () { return false; });
    }).then(function (isOwner) {
      engine = sample ? 'claude' : 'key';
      visitor = engine === 'claude' && isOwner !== true;
      if (visitor && st.last && st.last.role !== 'visitor') st.last = null;   /* never show an owner-voice reading to a visitor */
      render();
    });
    return probe;
  }
  /* Which search Claude gets this run: 'hf' (the viewer's Hugging Face connector, as a page tool),
     'web' (the API's own web search, key mode) or 'memory' (none). */
  function searchMode() {
    if (engine === 'key') return Promise.resolve('web');
    if (!sample || !mcp || typeof sample.limits !== 'function') return Promise.resolve('memory');
    return sample.limits().then(function (lim) {
      if (!lim || !lim.tools) return 'memory';
      return mcp.listTools(HF).then(function (r) {
        var sv = (r && r.servers || []).filter(function (x) { return x.server === HF; })[0];
        return sv && (sv.tools || []).some(function (t) { return t.name === 'hub_repo_search'; }) ? 'hf' : 'memory';
      });
    }).catch(function () { return 'memory'; });
  }
  var HF_TOOL = {
    name: 'search_public_projects',
    description: 'Search public Hugging Face Spaces, models and datasets by keyword. Returns Markdown: one entry per repo with its name, likes, tags, creation date and link. Use short queries (1-4 words).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search words.' },
        kind: { type: 'string', enum: ['space', 'model', 'dataset'], description: 'What to search. Spaces are runnable apps and agents.' }
      },
      required: ['query']
    },
    execute: function (input, ctx) {
      var kind = ['space', 'model', 'dataset'].indexOf(String(input.kind)) >= 0 ? String(input.kind) : 'space';
      return mcp.callTool(HF, 'hub_repo_search', { query: String(input.query || '').slice(0, 80), repo_types: [kind], sort: 'likes', limit: 8 },
        { signal: ctx && ctx.signal }).then(function (r) {
        var p = r && r.payload;
        var t = typeof p === 'string' ? p : JSON.stringify(p || '');
        return t.length > 6000 ? t.slice(0, 6000) + '\n[more results cut]' : t;
      }, function (e) {
        throw new Error('search unavailable (' + (e && e.code || 'error') + ')');
      });
    }
  };

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
  function callApi(text, depth, signal, onText, web) {
    var body = {
      model: API_MODEL,
      max_tokens: 16000,
      stream: true,
      output_config: { effort: depth === 'deep' ? 'high' : 'medium' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: text }]
    };
    if (web) body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }];
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
    var lede = sheet.querySelector('.an-lede');
    if (!lede.getAttribute('data-owner')) lede.setAttribute('data-owner', lede.textContent);
    lede.textContent = visitor
      ? 'A reading of ' + ownerOf(d) + ', drawn from their map: what is distinctly theirs, what is admirable in where their attention goes, their voice, parallels they may not have seen, and public projects their passions could take somewhere new.'
      : lede.getAttribute('data-owner');
    $('an-scope').textContent = (d.nodes || []).length + ' nodes · ' + nConv + ' conversation' + (nConv === 1 ? '' : 's') +
      (meta.latestConversation ? ' · latest: ' + meta.latestConversation.title : '');

    var needKey = engine === 'key' && (!apiKey() || st.editingKey);
    $('an-keyform').hidden = !needKey;
    $('an-key-cancel').hidden = !apiKey();
    $('an-run-row').hidden = engine === 'pending' || needKey;
    $('an-connecting').hidden = engine !== 'pending';

    var eng = $('an-engine');
    if (engine === 'claude') eng.textContent = visitor ? 'Runs on your Claude account, not ' + ownerOf(d) + '\u2019s' : 'Runs on your Claude account';
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
    if (st.running && !st.text) outEl.innerHTML = '<p class="an-thinking">' + esc(st.status || 'Reading the map\u2026') + '</p>';
    else { outEl.innerHTML = md(clean(shown)); decorate(outEl); }
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
    $('an-connect').hidden = !(st.connect && !st.connectDismissed && engine === 'claude');
    $('an-err').textContent = st.err;
    $('an-err').hidden = !st.err;
  }

  function open() {
    sheet.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('an-open');
    findEngine();
    if (st.last && st.last.search === 'memory') st.connect = true;
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
    var again = !!(st.text || st.last);
    st.running = true; st.text = ''; st.err = ''; st.note = ''; st.status = 'Reading the map…';
    st.ctl = new AbortController();
    var ctl = st.ctl;
    render();
    var onText = function (t) { st.text = clean(t); render(); };
    var used = 'memory';
    searchMode().then(function (mode) {
      used = mode;
      if (ctl.signal.aborted) throw { code: 'cancelled' };
      var text = prompt(d, mode, visitor);
      if (engine === 'claude') {
        var opts = {
          modelTier: st.depth === 'deep' ? 'complex' : 'default',
          signal: ctl.signal,
          onText: function (u) { onText(u.text); }
        };
        if (mode === 'hf') {
          /* calls with tools are never cached and must not pass `cache` */
          opts.tools = [{
            name: HF_TOOL.name, description: HF_TOOL.description, inputSchema: HF_TOOL.inputSchema,
            execute: function (input, c) {
              st.status = 'Searching public projects: “' + clip(input && input.query, 40) + '”…';
              if (!st.text) render();
              return HF_TOOL.execute(input, c);
            }
          }];
        } else opts.cache = again ? false : true;
        return sample(text, opts);
      }
      return callApi(text, st.depth, ctl.signal, onText, mode === 'web');
    }).then(function (r) {
      st.text = clean(r.text);
      if (r.truncated) st.note = 'The reading was cut short at the length limit.';
      st.last = { text: st.text, at: new Date().toISOString(), engine: engine, search: used, role: visitor ? 'visitor' : 'owner', prompts: {} };
      if (used === 'memory' && engine === 'claude') st.connect = true;
      if ((d.meta || {}).latestConversation) st.last.version = 'as of ' + d.meta.latestConversation.date;
      copied = {};
      saveLast();
    }, function (e) {
      var code = e && e.code ? e.code : 'upstream_error';
      if (code === 'cancelled') { st.text = clean((e && e.text) || st.text); if (st.text) st.note = 'Stopped.'; }
      else if (code === 'refused') st.text = '';
      else { st.text = clean((e && e.text) || st.text); }
      if (code !== 'cancelled') st.err = errCopy(code, e);
      if (code === 'auth') st.editingKey = true;
    }).then(function () {
      st.running = false; st.ctl = null;
      render();
    });
  }
  function saveLast() { if (st.last) store.set(K_LAST, JSON.stringify(st.last)); }

  /* ------------------------------------------------------------------ *
   * Draft a build prompt for one recommended project, then copy it
   * ------------------------------------------------------------------ */
  var PROMPT_SKILL = [
    'You write kickoff prompts for agentic coding tools (Claude Code and the like): the first message that starts a new project.',
    'A strong kickoff prompt:',
    '1. Opens with the goal in two sentences: what will exist when the first milestone is done, and for whom.',
    '2. Gives the context the agent cannot guess: the upstream public project (exact name and link) and what to read in it first;',
    '   the owner’s angle and why it matters; the owner’s experience level and working style, as the notes show them.',
    '3. Scopes milestone one tightly: a thin end-to-end slice, small enough for a day or two, with explicit non-goals.',
    '4. States constraints: language and stack (prefer what the owner already uses), respect for the upstream licence,',
    '   no secrets in the repo, small reviewable commits, ask before anything destructive or costly.',
    '5. Defines done: concrete deliverables and how to verify them (commands to run, tests, a sample output to show).',
    '6. Orders the work: read the upstream project and report back, then propose a short plan and wait for approval, then build.',
    '7. Ends with 2–4 questions the agent should ask the owner before starting.',
    'Write in the second person to the agent, plain Markdown with short headings, 350–650 words. Output only the prompt itself:',
    'no preface, no closing note, no code fence around the whole thing.'
  ].join('\n');

  function draftInput(proj) {
    var d = data(), meta = d.meta || {};
    var own = (d.nodes || []).filter(isOwnWork).sort(function (a, b) { return num(b.strength) - num(a.strength); }).slice(0, 25)
      .map(function (n) { return '- ' + n.label + (n.note ? ': ' + clip(n.note, 160) : ''); });
    var threads = (d.threads || []).map(function (t) { return '- ' + t.title + ': ' + clip(t.summary, 140); });
    return [PROMPT_SKILL, '',
      'Write the kickoff prompt for this project, which the owner of a personal mind map ("' + ownerOf(d) + '") wants to start:', '',
      proj.text, '',
      'The owner’s own AI and project work (their level and stack):', own.join('\n'), '',
      'The owner’s threads of interest:', threads.join('\n'),
      meta.updated ? '\nMap as of ' + meta.updated + '.' : ''
    ].join('\n');
  }

  var drafting = {};   // project name -> true while its prompt is being written
  function draft(i) {
    var proj = projectsOf(st.last ? st.last.text : '')[i];
    if (!proj || drafting[proj.name]) return;
    if (engine === 'claude') searchMode().then(function (m) { if (m !== 'hf' && !st.connectDismissed) { st.connect = true; render(); } });
    var have = st.last.prompts && st.last.prompts[proj.name];
    if (have) { copy(have, i, false); return; }
    drafting[proj.name] = true; st.err = '';
    render();
    var input = draftInput(proj), p;
    if (engine === 'claude') p = sample(input, { modelTier: 'default' });
    else p = callApi(input, 'standard', new AbortController().signal, function () {}, false);
    p.then(function (r) {
      var t = String(r.text || '').trim();
      st.last.prompts = st.last.prompts || {};
      st.last.prompts[proj.name] = t;
      saveLast();
      drafting[proj.name] = false;
      copy(t, i, true);
    }, function (e) {
      drafting[proj.name] = false;
      st.err = errCopy(e && e.code, e);
      render();
    });
  }

  /* Clipboard: the async API first, then a hidden textarea. A long wait for Claude can use up the
     browser's "the viewer just tapped" allowance, so a copy that fails after drafting leaves the
     button reading "Copy prompt" for one more tap. */
  var copied = {};
  function copy(text, i, afterWait) {
    function done(ok) {
      copied[i] = ok ? 'ok' : '';
      render();
      if (ok) setTimeout(function () { if (copied[i] === 'ok') { copied[i] = ''; render(); } }, 2500);
    }
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(!afterWait && legacy()); });
    } else done(!afterWait && legacy());
  }

  function decorate(outEl) {
    if (st.running || !st.last || visitor) return;   /* Draft prompt is the owner's tool */
    var projs = projectsOf(st.last.text);
    if (!projs.length) return;
    var inSec = false, k = 0;
    Array.prototype.slice.call(outEl.children).forEach(function (el) {
      if (el.tagName === 'H3') inSec = /^public projects|^agent projects/i.test(el.textContent);
      else if (inSec && el.tagName === 'H4' && k < projs.length) {
        var name = projs[k].name, has = !!(st.last.prompts && st.last.prompts[name]);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn an-draft' + (copied[k] === 'ok' ? ' is-done' : '');
        b.setAttribute('data-draft', String(k));
        b.textContent = drafting[name] ? 'Drafting prompt…' : copied[k] === 'ok' ? 'Copied ✓' : has ? 'Copy prompt' : 'Draft prompt';
        b.disabled = !!drafting[name];
        b.title = has ? 'Copy the build prompt to the clipboard' : 'Write a kickoff prompt for an agentic coding tool, then copy it';
        el.appendChild(b);
        k++;
      }
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
  $('an-connect-x').addEventListener('click', function () { st.connectDismissed = true; render(); });
  $('an-out').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-draft]') : null;
    if (b && !b.disabled) draft(Number(b.getAttribute('data-draft')));
  });
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
