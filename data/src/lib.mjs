// Shared library for the living-map pipeline: parsing, serialising, strength.
// Used by generate.mjs, merge-delta.mjs and validate.mjs. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..');

export const TYPE = { pr: 'project', co: 'concept', pe: 'person', wo: 'work', pl: 'place', pa: 'paper', sch: 'school' };
export const ROLE = { au: 'author', ar: 'artist', ru: 'ruler', sc: 'scholar', ot: 'other' };
export const ETYPE = { w: 'wrote', i: 'influenced', p: 'parallels', c: 'critiques', b: 'belongs-to', a: 'applies-to' };
export const ORIGIN = { o: 'owner', c: 'claude', s: 'shared' };
export const TRIGGERS = ['new-connection', 'reading', 'argument', 'change-of-mind', 'correction'];
export const LOG_TRIGGERS = [...TRIGGERS, 'seed'];
export const ACTIONS = ['added', 'modified', 'removed', 'reweighted', 'reversed'];
export const BASES = ['index-d', 'cross-link', 'index', 'conversation'];

const invert = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const TYPE_BY_NAME = invert(TYPE), ROLE_BY_NAME = invert(ROLE), ETYPE_BY_NAME = invert(ETYPE), ORIGIN_BY_NAME = invert(ORIGIN);

// code-or-name -> code (or undefined)
export const typeCode = s => (TYPE[s] ? s : TYPE_BY_NAME[s]);
export const roleCode = s => (ROLE[s] ? s : ROLE_BY_NAME[s]);
export const etypeCode = s => (ETYPE[s] ? s : ETYPE_BY_NAME[s]);
export const originCode = s => (s === '' ? 's' : ORIGIN[s] ? s : ORIGIN_BY_NAME[s]);

export const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ROMAN_RE = /^[IVXLCDM]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const themeId = t => 'theme-' + t.toLowerCase();

// ---------- args / paths ----------
export function parseArgs(argv) {
  const flags = new Set(), positional = [];
  let root = process.env.MINDMAP_DATA || DEFAULT_ROOT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = argv[++i];
    else if (a.startsWith('--')) flags.add(a);
    else positional.push(a);
  }
  return { root: path.resolve(root), flags, positional };
}

export function pathsFor(root) {
  const src = path.join(root, 'src');
  return {
    root, src,
    threads: path.join(src, 'threads.txt'),
    nodes: path.join(src, 'nodes.txt'),
    edges: path.join(src, 'edges.txt'),
    mentions: path.join(src, 'mentions.txt'),
    fields: path.join(src, 'fields.txt'),
    owner: path.join(src, 'owner.txt'),
    conversations: path.join(src, 'conversations.txt'),
    changelog: path.join(src, 'changelog.txt'),
    lock: path.join(src, 'changelog.lock'),
    graph: path.join(root, 'dialogic.graph.json'),
    deltas: path.join(root, 'deltas'),
  };
}

// ---------- refs ----------
export const edgeRef = (s, t, ec) => `${s} > ${t} : ${ec}`;
export const edgeId = (s, t, ename) => `${s}>${t}:${ename}`;
// 'a > b : applies-to' | 'a > b : a' -> {source,target,etype(code)} | null
export function parseEdgeRef(str) {
  const m = /^(\S+)\s*>\s*(\S+)\s*:\s*(\S+)$/.exec(str.trim());
  if (!m) return null;
  const ec = etypeCode(m[3]);
  return ec ? { source: m[1], target: m[2], etype: ec } : null;
}
// Any ref (node id, edge ref, or stable edge id) -> canonical id used in the graph, or null.
export function refToId(ref) {
  const r = ref.trim();
  if (r === '*') return '*';
  if (r.includes('>') && r.includes(':') && !r.includes(' ')) { // stable id form a>b:name
    const m = /^([^>\s]+)>([^:\s]+):(\S+)$/.exec(r);
    if (m && ETYPE_BY_NAME[m[3]]) return r;
  }
  if (r.includes('>')) {
    const e = parseEdgeRef(r);
    return e ? edgeId(e.source, e.target, ETYPE[e.etype]) : null;
  }
  return ID_RE.test(r) ? r : null;
}

// ---------- line files ----------
export const splitFields = line => line.split('|').map(s => s.trim());
const empty = s => (s === '-' ? '' : s);
const dash = s => (s === '' || s == null ? '-' : s);

export function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
}

// entries: [{raw, rec|null, line}]; kind-specific parse(fields, raw, ctx) -> rec | {header}
function loadEntries(file, parse, errs, ctx = {}) {
  const text = readText(file);
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  const name = path.basename(file);
  const entries = [];
  lines.forEach((raw, i) => {
    const e = { raw, rec: null, line: i + 1 };
    entries.push(e);
    if (!raw.trim()) return;
    if (raw.startsWith('#') && !(ctx.headers && raw.startsWith('## '))) return;
    const res = parse(raw, ctx, msg => { errs.push(`${name}:${i + 1}: ${msg}`); });
    if (res && res.header) return;
    if (res) { e.rec = res; e.rec.line = i + 1; }
  });
  return entries;
}

function parseThreadLine(raw, _c, err) {
  const f = splitFields(raw);
  if (f.length !== 3) return err(`expected 3 fields (id | title | summary), got ${f.length}`);
  if (!ROMAN_RE.test(f[0])) return err(`thread id must be a Roman numeral: ${f[0]}`);
  return { id: f[0], title: f[1], summary: f[2] };
}

function parseNodeLine(raw, _c, err) {
  const f = splitFields(raw);
  if (f.length < 5 || f.length > 6) return err(`expected 5-6 fields, got ${f.length}`);
  const [id, label, t, th, note, vn = ''] = f;
  const [tk, rk = ''] = t.split(':');
  const tc = typeCode(tk);
  if (!tc) return err(`node ${id}: bad type ${t}`);
  let role = '';
  if (tc === 'pe') {
    role = roleCode(rk);
    if (!role) return err(`node ${id}: bad or missing role in ${t}`);
  }
  return { id, label, type: tc, role, threads: th.split(',').map(s => s.trim()).filter(Boolean), note, verifyNote: empty(vn) };
}

function parseEdgeLine(raw, ctx, err) {
  if (raw.startsWith('## ')) { ctx.basis = raw.slice(3).trim(); return { header: true }; }
  const f = splitFields(raw);
  if (f.length < 2 || f.length > 5) return err(`expected 2-5 fields, got ${f.length}`);
  const m = /^(\S+)\s*>\s*(\S+)$/.exec(f[0]);
  if (!m) return err(`bad edge endpoints: ${f[0]}`);
  const ec = etypeCode(f[1]);
  if (!ec) return err(`bad edge type ${f[1]}`);
  const oc = originCode(empty(f[2] || ''));
  if (!oc) return err(`bad origin ${f[2]}`);
  if (!ctx.basis) return err('edge before any ## basis header');
  return { source: m[1], target: m[2], etype: ec, origin: oc, basis: ctx.basis, label: empty(f[3] || ''), verifyNote: empty(f[4] || '') };
}

function parseMentionLine(raw, _c, err) {
  const f = splitFields(raw);
  if (f.length !== 4) return err(`expected 4 fields (date | conversation | ref | count), got ${f.length}`);
  if (!DATE_RE.test(f[0])) return err(`bad date ${f[0]}`);
  const count = Number(f[3]);
  if (!Number.isInteger(count) || count < 1) return err(`bad count ${f[3]}`);
  return { date: f[0], conv: f[1], ref: f[2], count };
}

export const WIKI_FIELDS = [
  'General reference', 'Culture and the arts', 'Geography and places', 'Health and fitness', 'History and events',
  'Human activities', 'Mathematics and logic', 'Natural and physical sciences', 'People and self', 'Philosophy and thinking',
  'Religion and belief systems', 'Society and social sciences', 'Technology and applied sciences',
];

function parseFieldLine(raw, ctx, err) {
  const f = splitFields(raw);
  if (f.length !== 3) { err(`expected 3 fields (id | field | subfield), got ${f.length}`); return null; }
  const [id, field, sub] = f;
  if (!id) { err('empty id'); return null; }
  if (!field) { err(`node ${id}: empty field`); return null; }
  if (!sub) { err(`node ${id}: empty subfield`); return null; }
  if (!WIKI_FIELDS.includes(field)) { err(`node ${id}: unknown field "${field}"`); return null; }
  if (ctx.seen.has(id)) { err(`duplicate id ${id}`); return null; }
  ctx.seen.add(id);
  return { id, field, subfield: sub };
}

function parseConversationLine(raw, _c, err) {
  const f = splitFields(raw);
  if (f.length !== 3) return err(`expected 3 fields (date | id | title), got ${f.length}`);
  if (!DATE_RE.test(f[0])) return err(`bad date ${f[0]}`);
  return { date: f[0], id: f[1], title: f[2] };
}

function parseChangeLine(raw, _c, err) {
  const f = splitFields(raw);
  if (f.length !== 8) return err(`expected 8 fields, got ${f.length}`);
  const [date, action, target, before, after, reason, trigger, source] = f;
  if (!DATE_RE.test(date)) return err(`bad date ${date}`);
  if (!ACTIONS.includes(action)) return err(`bad action ${action}`);
  if (!LOG_TRIGGERS.includes(trigger)) return err(`bad trigger ${trigger}`);
  return { date, action, target, before: empty(before), after: empty(after), reason: empty(reason), trigger, source: empty(source) };
}

// owner.txt: the root node id, written once by the first delta's "## owner" section. Missing file = blank map.
export function readOwner(P) {
  const line = readText(P.owner).split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#'));
  return line || null;
}

export function loadSources(P) {
  const errs = [];
  const owner = readOwner(P);
  if (owner && !ID_RE.test(owner)) errs.push(`owner.txt: bad owner id "${owner}"`);
  const files = {
    threads: loadEntries(P.threads, parseThreadLine, errs),
    nodes: loadEntries(P.nodes, parseNodeLine, errs),
    edges: loadEntries(P.edges, parseEdgeLine, errs, { headers: true }),
    mentions: loadEntries(P.mentions, parseMentionLine, errs),
    conversations: loadEntries(P.conversations, parseConversationLine, errs),
    changelog: loadEntries(P.changelog, parseChangeLine, errs),
    fields: loadEntries(P.fields, parseFieldLine, errs, { seen: new Set() }), // optional: a missing file reads as empty
  };
  const recs = k => files[k].filter(e => e.rec).map(e => e.rec);
  return {
    errs, files, owner,
    threads: recs('threads'), nodes: recs('nodes'), edges: recs('edges'),
    mentions: recs('mentions'), conversations: recs('conversations'), changelog: recs('changelog'), fields: recs('fields'),
  };
}

// ---------- serialisers ----------
export const threadLine = t => [t.id, t.title, t.summary].join(' | ');
export const nodeLine = n => {
  const f = [n.id, n.label, n.type === 'pe' ? `pe:${n.role}` : n.type, n.threads.join(','), n.note];
  if (n.verifyNote) f.push(n.verifyNote);
  return f.join(' | ');
};
export const edgeLine = e => {
  const f = [`${e.source} > ${e.target}`, e.etype, e.origin, dash(e.label), dash(e.verifyNote)];
  while (f.length > 3 && f[f.length - 1] === '-') f.pop();
  return f.join(' | ');
};
export const mentionLine = m => [m.date, m.conv, m.ref, m.count].join(' | ');
export const conversationLine = c => [c.date, c.id, c.title].join(' | ');
export const changeLine = c => [c.date, c.action, c.target, dash(c.before), dash(c.after), dash(c.reason), c.trigger, dash(c.source)].join(' | ');

// ---------- changelog lock ----------
// Lock content: "lines=<N> sha256=<hex>" over the first N lines (bytes) of changelog.txt.
export function lockFor(buf) {
  let n = 0;
  for (const b of buf) if (b === 10) n++;
  return `lines=${n} sha256=${crypto.createHash('sha256').update(buf).digest('hex')}\n`;
}
export function checkLock(P) {
  if (!fs.existsSync(P.lock)) return 'changelog.lock is missing';
  if (!fs.existsSync(P.changelog)) return 'changelog.txt is missing';
  const m = /^lines=(\d+) sha256=([0-9a-f]{64})\s*$/.exec(fs.readFileSync(P.lock, 'utf8'));
  if (!m) return 'changelog.lock is malformed';
  const want = Number(m[1]);
  const buf = fs.readFileSync(P.changelog);
  let n = 0, end = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) { n++; if (n === want) { end = i + 1; break; } }
  if (n < want) return `changelog.txt has fewer lines than the lock records (${n} < ${want}): a past entry was removed`;
  const h = crypto.createHash('sha256').update(buf.subarray(0, end)).digest('hex');
  if (h !== m[2]) return `changelog.txt does not match changelog.lock: a past entry was edited (first ${want} lines differ)`;
  if (end < buf.length) return 'changelog.txt has lines appended after the last merge (not covered by changelog.lock)';
  return null;
}

// ---------- aliases, reweights, removed ----------
// Edge type changes alter the edge id; earlier refs are aliased to the new id.
export function buildAlias(changelog) {
  const alias = new Map();
  for (const c of changelog) {
    if ((c.action !== 'modified' && c.action !== 'reversed') || !c.before.startsWith('type: ')) continue;
    const t = parseEdgeRef(c.target);
    const oldName = c.before.slice(6).trim();
    if (!t || !etypeCode(oldName)) continue;
    const oldId = edgeId(t.source, t.target, ETYPE[etypeCode(oldName)]);
    const newId = refToId(c.target);
    for (const [k, v] of alias) if (v === oldId) alias.set(k, newId);
    alias.set(oldId, newId);
  }
  return alias;
}
export const removedIds = changelog => new Set(changelog.filter(c => c.action === 'removed').map(c => refToId(c.target)).filter(Boolean));

export function currentFactors(changelog, alias) {
  const m = new Map();
  for (const c of changelog) {
    if (c.action !== 'reweighted') continue;
    const id = refToId(c.target);
    if (!id) continue;
    const f = Number(c.after);
    if (Number.isFinite(f)) m.set(alias.get(id) ?? id, f);
  }
  return m;
}

// ---------- graph ----------
const r3 = x => Math.round(x * 1000) / 1000;
const dayDiff = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;

export function latestConversation(src) {
  const all = new Map();
  for (const c of src.conversations) all.set(c.date + ' ' + c.id, { date: c.date, id: c.id, title: c.title });
  for (const m of src.mentions) if (!all.has(m.date + ' ' + m.conv)) all.set(m.date + ' ' + m.conv, { date: m.date, id: m.conv, title: m.conv });
  const list = [...all.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { list, latest: list[list.length - 1] || null };
}

export function buildGraph(src) {
  const threads = src.threads.map(t => ({ id: t.id, title: t.title, summary: t.summary }));
  const nodes = threads.map(t => ({
    id: themeId(t.id), label: `§ ${t.id} ${t.title}`, type: 'theme', threads: [t.id], note: t.summary, verify: false, verifyNote: '', field: null, subfield: null,
  }));
  const fieldOf = new Map((src.fields || []).map(f => [f.id, f]));
  for (const r of src.nodes) {
    const n = { id: r.id, label: r.label, type: TYPE[r.type] };
    if (r.type === 'pe') n.role = ROLE[r.role];
    n.threads = r.threads.slice();
    n.note = r.note;
    n.verify = r.verifyNote !== '' && !r.verifyNote.startsWith('~');
    n.verifyNote = r.verifyNote.replace(/^~/, '');
    const fl = fieldOf.get(r.id);
    n.field = fl ? fl.field : null;
    n.subfield = fl ? fl.subfield : null;
    nodes.push(n);
  }
  const edges = [];
  for (const e of src.edges) {
    edges.push({
      id: edgeId(e.source, e.target, ETYPE[e.etype]), source: e.source, target: e.target, type: ETYPE[e.etype],
      origin: ORIGIN[e.origin], basis: e.basis, label: e.label,
      verify: e.verifyNote !== '' && !e.verifyNote.startsWith('~'), verifyNote: e.verifyNote.replace(/^~/, ''),
    });
  }
  for (const r of src.nodes) for (const t of r.threads) {
    edges.push({ id: edgeId(r.id, themeId(t), 'belongs-to'), source: r.id, target: themeId(t), type: 'belongs-to', origin: 'shared', basis: 'index', label: '', verify: false, verifyNote: '' });
  }

  // strength
  const alias = buildAlias(src.changelog);
  const factors = currentFactors(src.changelog, alias);
  const { list: convs, latest } = latestConversation(src);
  const per = new Map(); // id -> Map(convKey -> {count,date})
  for (const m of src.mentions) {
    const id0 = refToId(m.ref);
    if (!id0) continue;
    const id = alias.get(id0) ?? id0;
    if (!per.has(id)) per.set(id, new Map());
    const cm = per.get(id), key = m.date + ' ' + m.conv;
    cm.set(key, { count: (cm.get(key)?.count || 0) + m.count, date: m.date });
  }
  const decorate = (item, structural) => {
    if (structural) return Object.assign(item, { strength: null, score: null, mentions: 0, conversations: 0, lastSeen: null, byConv: {}, weight: null });
    const cm = per.get(item.id);
    const factor = factors.has(item.id) ? factors.get(item.id) : 1;
    let sum = 0, mentions = 0, lastSeen = null;
    const byConv = {};
    if (cm) for (const [key, { count, date }] of [...cm.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
      if (count > 0) byConv[key.slice(key.indexOf(' ') + 1)] = (byConv[key.slice(key.indexOf(' ') + 1)] || 0) + count;
      const age = latest ? Math.max(0, dayDiff(latest.date, date)) : 0;
      const w = 0.3 + 0.7 * Math.pow(0.5, age / 180);
      sum += w * (1 + Math.log(count));
      mentions += count;
      if (!lastSeen || date > lastSeen) lastSeen = date;
    }
    const score = factor * sum;
    return Object.assign(item, {
      strength: r3(1 - Math.exp(-score / 2)), score: r3(score), mentions, conversations: cm ? cm.size : 0, lastSeen, byConv, weight: factor,
    });
  };
  nodes.forEach(n => decorate(n, false));
  edges.forEach(e => decorate(e, e.type === 'belongs-to'));

  const log = src.changelog.map(c => ({
    date: c.date, action: c.action, target: c.target === '*' ? '*' : (refToId(c.target) ?? c.target),
    before: c.before, after: c.after, reason: c.reason, trigger: c.trigger, source: c.source,
  }));

  return {
    meta: {
      title: 'Dialogic', version: '2.0.0', updated: latest ? latest.date : '', source: 'data/src',
      rootNode: src.owner || null, latestConversation: latest, conversations: convs,
    },
    threads, nodes, edges, log,
  };
}

export const graphText = g => JSON.stringify(g, null, 2) + '\n';

// ---------- helpers ----------
export function writeAtomic(files) { // {path: content}
  const tmps = [];
  try {
    for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', c); tmps.push(p); }
  } catch (e) { for (const p of tmps) try { fs.unlinkSync(p + '.tmp'); } catch {} throw e; }
  for (const p of tmps) fs.renameSync(p + '.tmp', p);
}
