// Merge a map delta (see docs/DELTA-FORMAT.md) into the text sources in data/src/.
// Usage: node data/src/merge-delta.mjs <delta-file> [--dry-run] [--force] [--root <dir>]
// The delta may be the raw fenced block copied from chat; text outside ``` fences is ignored.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, pathsFor, loadSources, checkLock, lockFor, splitFields,
  TYPE, ROLE, ETYPE, ORIGIN, TRIGGERS, ID_RE, ROMAN_RE, DATE_RE,
  typeCode, roleCode, etypeCode, originCode, themeId, edgeRef, parseEdgeRef, currentFactors, buildAlias,
  threadLine, nodeLine, edgeLine, mentionLine, conversationLine, changeLine,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { root, flags, positional } = parseArgs(process.argv.slice(2));
const dry = flags.has('--dry-run'), force = flags.has('--force');
if (positional.length !== 1) { console.error('usage: node data/src/merge-delta.mjs <delta-file> [--dry-run] [--force] [--root <dir>]'); process.exit(2); }
const P = pathsFor(root);
const deltaFile = path.resolve(positional[0]);

const errors = [], warnings = [];
let curLine = 0;
const E = (msg, line = curLine) => errors.push(`${path.basename(deltaFile)}:${line}: ${msg}`);
const W = msg => warnings.push(`${path.basename(deltaFile)}:${curLine}: ${msg}`);
const finish = () => {
  if (warnings.length) { console.error('warnings:'); for (const w of warnings) console.error('  - ' + w); }
  if (errors.length) {
    console.error(`\nREFUSED: ${errors.length} error(s); nothing was written.`);
    for (const m of errors) console.error('  - ' + m);
    process.exit(1);
  }
};

// ---------- 1. extract and parse the block ----------
if (!fs.existsSync(deltaFile)) { console.error('no such file: ' + deltaFile); process.exit(2); }
const all = fs.readFileSync(deltaFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
const startIdx = all.findIndex(l => l.trim().startsWith('@delta'));
if (startIdx < 0) { E('no "@delta" line found', 1); finish(); }
let endIdx = all.length;
for (let i = startIdx + 1; i < all.length; i++) if (all[i].trim().startsWith('```')) { endIdx = i; break; }
const blockLines = all.slice(startIdx, endIdx);
while (blockLines.length && !blockLines[blockLines.length - 1].trim()) blockLines.pop();

const hf = splitFields(blockLines[0].trim().replace(/^@delta\s*/, ''));
curLine = startIdx + 1;
let dDate = hf[0], dConv = hf[1], dTitle = hf[2];
if (hf.length !== 3) E('header must be "@delta date | conversation | title"');
else {
  if (!DATE_RE.test(dDate)) E(`bad date "${dDate}" (want YYYY-MM-DD)`);
  if (!ID_RE.test(dConv)) E(`bad conversation id "${dConv}" (want kebab-case)`);
  if (!dTitle) E('missing conversation title');
}

const SECTIONS = { owner: 1, 'add-threads': 5, 'add-nodes': 8, 'add-edges': 7, modify: 5, remove: 3, reverse: [5, 6], reweight: [3, 4], touched: 2 };
// Sections the chat may emit out of habit; the tool writes the log itself and reads verify from verifyNotes.
const IGNORED = new Set(['changelog', 'log', 'verify']);
const sec = {};
let cur = null, skipping = false;
for (let i = 1; i < blockLines.length; i++) {
  const raw = blockLines[i], ln = startIdx + 1 + i;
  curLine = ln;
  const t = raw.trim();
  if (!t) continue;
  if (t.startsWith('## ')) {
    cur = t.slice(3).trim().toLowerCase();
    skipping = IGNORED.has(cur);
    if (skipping) { W(`section "${cur}" ignored: the merge tool writes the changelog and reads verify flags from verifyNote fields`); cur = null; continue; }
    if (!(cur in SECTIONS)) { E(`unknown section "${cur}"`); cur = null; } else sec[cur] ??= [];
    continue;
  }
  if (skipping) continue;
  if (t.startsWith('#')) continue;
  if (!cur) { E('content outside a known section'); continue; }
  const f = splitFields(t).map(s => (s === '-' ? '' : s));
  const want = [].concat(SECTIONS[cur]);
  if (!want.includes(f.length)) { E(`section ${cur}: expected ${want.join(' or ')} fields, got ${f.length} (a field may not contain "|")`); continue; }
  sec[cur].push({ line: ln, f });
}
if (!sec.touched) E('missing required "## touched" section', startIdx + 1);

// ---------- 2. load state, global refusals ----------
const src = loadSources(P);
curLine = 0;
for (const m of src.errs) E(`source error: ${m}`, 0);
const lockErr = checkLock(P);
if (lockErr) E(lockErr, 0);
const convKey = `${dDate} ${dConv}`;
const alreadyMerged = src.conversations.some(c => c.date + ' ' + c.id === convKey) || src.mentions.some(m => m.date + ' ' + m.conv === convKey);
if (alreadyMerged && !force) E(`conversation "${convKey}" is already merged (use --force to override)`, startIdx + 1);
const archivePath = path.join(P.deltas, `${dDate}-${dConv}.delta.txt`);
if (fs.existsSync(archivePath) && !force) E(`archive ${path.relative(root, archivePath)} already exists (use --force to override)`, startIdx + 1);
if (errors.length && (src.errs.length || lockErr)) { finish(); }

// ---------- 3. editable file wrappers ----------
class Ed {
  constructor(entries, ser) { this.entries = entries; this.ser = ser; this.ops = []; }
  find(rec) { return this.entries.find(e => e.rec === rec); }
  add(rec) { const raw = this.ser(rec); this.entries.push({ raw, rec }); this.ops.push({ op: '+', after: raw }); }
  addRaw(raw) { this.entries.push({ raw, rec: null }); this.ops.push({ op: '+', after: raw }); }
  modify(rec, fn) { const e = this.find(rec); const before = e.raw; fn(rec); e.raw = this.ser(rec); this.ops.push({ op: '~', before, after: e.raw }); }
  remove(rec) { const i = this.entries.findIndex(e => e.rec === rec); const [e] = this.entries.splice(i, 1); this.ops.push({ op: '-', before: e.raw }); }
  text() { return this.entries.length ? this.entries.map(e => e.raw).join('\n') + '\n' : ''; }
}
const F = src.files;
const files = {
  threads: new Ed(F.threads, threadLine), nodes: new Ed(F.nodes, nodeLine), edges: new Ed(F.edges, edgeLine),
  mentions: new Ed(F.mentions, mentionLine), conversations: new Ed(F.conversations, conversationLine), changelog: new Ed(F.changelog, changeLine),
};
const threadById = new Map(src.threads.map(t => [t.id, t]));
const nodeById = new Map(src.nodes.map(n => [n.id, n]));
const ekey = (s, t, ec) => `${s}>${t}:${ec}`;
const edgeByKey = new Map(src.edges.map(e => [ekey(e.source, e.target, e.etype), e]));
const themeIds = () => new Set([...threadById.keys()].map(themeId));

const SOURCE = convKey;
const newLog = [];
const logEntry = (action, target, before, after, reason, trigger) => newLog.push({ date: dDate, action, target, before, after, reason, trigger, source: SOURCE });
const newItems = [];            // refs that get an automatic mention of 1
const stats = { added: 0, modified: 0, removed: 0, reversed: 0, reweighted: 0, touched: 0 };
const removedNow = new Set(), changedRefs = new Set();
const factors = currentFactors(src.changelog, buildAlias(src.changelog));
const typeStr = n => (n.type === 'pe' ? `pe:${n.role}` : n.type);

const need = (name, v) => { if (!v) E(`missing ${name}`); return !!v; };
const trigOk = v => { if (!TRIGGERS.includes(v)) { E(`bad trigger "${v}" (one of ${TRIGGERS.join(', ')})`); return false; } return true; };
function parseNodeType(v) {
  const [tk, rk = ''] = v.split(':');
  const tc = typeCode(tk);
  if (!tc) { E(`bad node type "${v}"`); return null; }
  let role = '';
  if (tc === 'pe') { role = roleCode(rk); if (!role) { E(`person needs a role, e.g. pe:au (got "${v}")`); return null; } }
  else if (rk) { E(`only persons take a role (got "${v}")`); return null; }
  return { type: tc, role };
}
function parseThreadList(v) {
  const list = v.split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) { E('needs at least one thread'); return null; }
  let ok = true;
  for (const t of list) if (!threadById.has(t)) { E(`unknown thread "${t}"`); ok = false; }
  if (new Set(list).size !== list.length) { E('duplicate thread in list'); ok = false; }
  return ok ? list : null;
}
function checkNote(v) {
  if (!v) { E('note is empty'); return false; }
  if (v.length > 140) { E(`note is ${v.length} chars (max 140)`); return false; }
  return true;
}
// -> {kind:'node',rec,id} | {kind:'edge',rec,key} | null  (reports errors)
function resolve(ref, { allowTheme = false, allowBelongs = false } = {}) {
  if (ref.includes('>')) {
    const p = parseEdgeRef(ref);
    if (!p) { E(`bad edge ref "${ref}" (want "source > target : etype")`); return null; }
    if (p.etype === 'b' && !allowBelongs) { E(`belongs-to edges are generated from node threads and cannot be addressed: "${ref}"`); return null; }
    const key = ekey(p.source, p.target, p.etype);
    const rec = edgeByKey.get(key);
    if (!rec) { E(`no such edge "${ref}"`); return null; }
    return { kind: 'edge', rec, key };
  }
  if (themeIds().has(ref)) { if (allowTheme) return { kind: 'theme', id: ref }; E(`"${ref}" is a theme node (derived from threads.txt)`); return null; }
  const rec = nodeById.get(ref);
  if (!rec) { E(`no such node "${ref}"`); return null; }
  return { kind: 'node', rec, id: ref };
}
const refOf = r => (r.kind === 'edge' ? edgeRef(r.rec.source, r.rec.target, r.rec.etype) : r.id);
const edgeDesc = e => `${ETYPE[e.etype]}${e.label ? ` "${e.label}"` : ''}`;

// ---------- 4. apply sections in order ----------
for (const { line, f } of sec['add-threads'] || []) {
  curLine = line;
  const [id, title, summary, reason, trigger] = f;
  if (!ROMAN_RE.test(id)) { E(`thread id must be a Roman numeral, got "${id}"`); continue; }
  if (threadById.has(id)) { E(`thread ${id} already exists`); continue; }
  if (nodeById.has(themeId(id))) { E(`id ${themeId(id)} clashes with an existing node`); continue; }
  if (![need('title', title), need('summary', summary), need('reason', reason), trigOk(trigger)].every(Boolean)) continue;
  const rec = { id, title, summary };
  threadById.set(id, rec); files.threads.add(rec);
  logEntry('added', themeId(id), '', `thread ${id}: ${title}`, reason, trigger);
  newItems.push(themeId(id)); stats.added++;
}

for (const { line, f } of sec['add-nodes'] || []) {
  curLine = line;
  const [id, label, t, th, note, verifyNote, reason, trigger] = f;
  if (!ID_RE.test(id)) { E(`bad node id "${id}" (kebab-case)`); continue; }
  if (nodeById.has(id) || themeIds().has(id)) { E(`node id "${id}" already exists`); continue; }
  const ty = parseNodeType(t), threads = parseThreadList(th);
  const ok = [need('label', label), !!ty, !!threads, checkNote(note), need('reason', reason), trigOk(trigger)].every(Boolean);
  if (!ok) continue;
  const rec = { id, label, type: ty.type, role: ty.role, threads, note, verifyNote };
  nodeById.set(id, rec); files.nodes.add(rec);
  logEntry('added', id, '', `${label} [${TYPE[ty.type]}]`, reason, trigger);
  newItems.push(id); stats.added++;
}

for (const { line, f } of sec['add-edges'] || []) {
  curLine = line;
  const [ends, et, og, label, verifyNote, reason, trigger] = f;
  const m = /^(\S+)\s*>\s*(\S+)$/.exec(ends);
  if (!m) { E(`bad edge endpoints "${ends}" (want "source > target")`); continue; }
  const [, s, t] = m;
  const ec = etypeCode(et), oc = originCode(og);
  let ok = true;
  for (const [role, id] of [['source', s], ['target', t]]) {
    if (themeIds().has(id)) { E(`${role} "${id}" is a theme node; membership comes from node threads`); ok = false; }
    else if (removedNow.has(id)) { E(`${role} "${id}" was removed in this delta`); ok = false; }
    else if (!nodeById.has(id)) { E(`${role} node "${id}" does not exist`); ok = false; }
  }
  if (s === t) { E('edge cannot connect a node to itself'); ok = false; }
  if (!ec) { E(`bad edge type "${et}"`); ok = false; } else if (ec === 'b') { E('belongs-to edges are generated, not written'); ok = false; }
  if (!oc || og === '') { E(`bad or missing origin "${og}"`); ok = false; }
  if (!need('reason', reason) || !trigOk(trigger)) ok = false;
  if (ok && edgeByKey.has(ekey(s, t, ec))) { E(`edge ${s} > ${t} : ${ec} already exists`); ok = false; }
  if (!ok) continue;
  if (oc === 'c' && !verifyNote) W(`edge ${s} > ${t}: origin "c" (Claude's inference) should carry a verifyNote`);
  const rec = { source: s, target: t, etype: ec, origin: oc, basis: 'conversation', label, verifyNote };
  edgeByKey.set(ekey(s, t, ec), rec);
  if (!files.edges.entries.some(e => e.raw.startsWith('## ')) || [...files.edges.entries].reverse().find(e => e.raw.startsWith('## '))?.raw.trim() !== '## conversation') files.edges.addRaw('## conversation');
  files.edges.add(rec);
  logEntry('added', edgeRef(s, t, ec), '', edgeDesc(rec), reason, trigger);
  newItems.push(edgeRef(s, t, ec)); stats.added++;
}

function modifyItem(line, ref, field, after, reason, trigger, action, earlier) {
  curLine = line;
  const r = resolve(ref);
  if (!r) return;
  if (removedNow.has(refOf(r))) return E(`"${ref}" was removed in this delta`);
  if (!need('reason', reason) || !trigOk(trigger)) return;
  if (action === 'reversed' && !need('earlier position', earlier)) return;
  const finalReason = action === 'reversed' ? `${reason} (earlier position: ${earlier})` : reason;
  if (r.kind === 'node') {
    const n = r.rec;
    let old, nu, apply;
    switch (field) {
      case 'label': if (!need('label', after)) return; old = n.label; nu = after; apply = () => { n.label = after; }; break;
      case 'note': if (!checkNote(after)) return; old = n.note; nu = after; apply = () => { n.note = after; }; break;
      case 'verifyNote': old = n.verifyNote; nu = after; apply = () => { n.verifyNote = after; }; break;
      case 'threads': { const l = parseThreadList(after); if (!l) return; old = n.threads.join(','); nu = l.join(','); apply = () => { n.threads = l; }; break; }
      case 'type': { const ty = parseNodeType(after); if (!ty) return; old = typeStr(n); nu = ty.type === 'pe' ? `pe:${ty.role}` : ty.type; apply = () => { n.type = ty.type; n.role = ty.role; }; break; }
      default: return E(`bad node field "${field}" (label type threads note verifyNote)`);
    }
    if (old === nu) return W(`${ref} ${field}: unchanged, skipped`);
    files.nodes.modify(n, apply);
    logEntry(action, n.id, `${field}: ${old}`, `${field}: ${nu}`, finalReason, trigger);
    changedRefs.add(n.id);
  } else {
    const e = r.rec;
    const before = edgeRef(e.source, e.target, e.etype);
    let old, nu, apply;
    switch (field) {
      case 'label': old = e.label; nu = after; apply = () => { e.label = after; }; break;
      case 'verifyNote': old = e.verifyNote; nu = after; apply = () => { e.verifyNote = after; }; break;
      case 'origin': { const oc = originCode(after); if (!oc || after === '') return E(`bad origin "${after}"`); old = ORIGIN[e.origin]; nu = ORIGIN[oc]; apply = () => { e.origin = oc; }; break; }
      case 'type': {
        const ec = etypeCode(after);
        if (!ec) return E(`bad edge type "${after}"`);
        if (ec === 'b') return E('cannot change an edge to belongs-to');
        if (edgeByKey.has(ekey(e.source, e.target, ec)) && ec !== e.etype) return E(`edge ${e.source} > ${e.target} : ${ec} already exists`);
        old = ETYPE[e.etype]; nu = ETYPE[ec];
        apply = () => { edgeByKey.delete(r.key); e.etype = ec; edgeByKey.set(ekey(e.source, e.target, ec), e); };
        break;
      }
      default: return E(`bad edge field "${field}" (label origin type verifyNote)`);
    }
    if (old === nu) return W(`${ref} ${field}: unchanged, skipped`);
    files.edges.modify(e, apply);
    const target = edgeRef(e.source, e.target, e.etype);
    logEntry(action, target, `${field}: ${old}`, `${field}: ${nu}`, finalReason, trigger);
    changedRefs.add(target);
  }
  stats[action === 'reversed' ? 'reversed' : 'modified']++;
}
for (const { line, f } of sec.modify || []) modifyItem(line, f[0], f[1], f[2], f[3], f[4], 'modified');

for (const { line, f } of sec.remove || []) {
  curLine = line;
  const [ref, reason, trigger] = f;
  const r = resolve(ref);
  if (!r || !need('reason', reason) || !trigOk(trigger)) continue;
  if (r.kind === 'edge') {
    const e = r.rec, rf = edgeRef(e.source, e.target, e.etype);
    if (removedNow.has(rf)) { E(`"${ref}" already removed in this delta`); continue; }
    files.edges.remove(e); edgeByKey.delete(r.key); removedNow.add(rf);
    logEntry('removed', rf, edgeDesc(e), '', reason, trigger); stats.removed++;
  } else {
    const n = r.rec;
    if (n.id === src.owner) { E(`cannot remove the owner's root node "${n.id}"`); continue; }
    logEntry('removed', n.id, `${n.label} [${TYPE[n.type]}]`, '', reason, trigger); stats.removed++;
    for (const e of [...edgeByKey.values()].filter(x => x.source === n.id || x.target === n.id)) {
      const rf = edgeRef(e.source, e.target, e.etype);
      files.edges.remove(e); edgeByKey.delete(ekey(e.source, e.target, e.etype)); removedNow.add(rf);
      logEntry('removed', rf, edgeDesc(e), '', `endpoint removed: ${n.id}`, trigger); stats.removed++;
    }
    files.nodes.remove(n); nodeById.delete(n.id); removedNow.add(n.id);
  }
}

for (const { line, f } of sec.reverse || []) {
  const [ref, field, after, earlier, reason, trigger = 'change-of-mind'] = f;
  modifyItem(line, ref, field, after, reason, trigger, 'reversed', earlier);
}

for (const { line, f } of sec.reweight || []) {
  curLine = line;
  const [ref, factorS, reason, trigger = 'argument'] = f;
  const r = resolve(ref, { allowTheme: true });
  const factor = Number(factorS);
  if (!r) continue;
  if (!Number.isFinite(factor) || factor <= 0) { E(`factor must be a positive number, got "${factorS}"`); continue; }
  if (removedNow.has(refOf(r))) { E(`"${ref}" was removed in this delta`); continue; }
  if (!need('reason', reason) || !trigOk(trigger)) continue;
  const id = r.kind === 'edge' ? `${r.rec.source}>${r.rec.target}:${ETYPE[r.rec.etype]}` : r.id;
  const old = factors.has(id) ? factors.get(id) : 1;
  if (old === factor) { W(`${ref}: factor already ${factor}, skipped`); continue; }
  factors.set(id, factor);
  logEntry('reweighted', refOf(r), String(old), String(factor), reason, trigger); stats.reweighted++;
}

const touched = new Map(); // ref -> count
for (const { line, f } of sec.touched || []) {
  curLine = line;
  const [ref, countS] = f;
  const r = resolve(ref, { allowTheme: true });
  const count = Number(countS);
  if (!r) continue;
  if (!Number.isInteger(count) || count < 1) { E(`count must be a positive integer, got "${countS}"`); continue; }
  const rf = refOf(r);
  if (touched.has(rf)) { E(`"${ref}" listed twice in touched`); continue; }
  touched.set(rf, count);
}
stats.touched = touched.size;
for (const rf of changedRefs) if (!touched.has(rf)) { curLine = 0; W(`"${rf}" was modified but is not in touched`); }

// owner: named once, by the first delta on a blank map; it must be a project (pr) node.
let ownerNow = null;
{
  const lines = sec.owner || [];
  if (lines.length > 1) { curLine = lines[1].line; E('"## owner" takes exactly one line: the owner node id'); }
  else if (lines.length === 1) {
    curLine = lines[0].line;
    const id = lines[0].f[0];
    if (src.owner) E(`the owner is already "${src.owner}"; an alias change is a modify of that node's label`);
    else if (!nodeById.has(id)) E(`owner "${id}" is not a node (add it in ## add-nodes, type pr)`);
    else if (nodeById.get(id).type !== 'pr') E(`owner "${id}" must be type pr (project), got ${TYPE[nodeById.get(id).type]}`);
    else ownerNow = id;
  } else if (!src.owner) { curLine = startIdx + 1; E('this map has no owner yet: the first delta needs a "## owner" section naming the owner\'s alias node'); }
}

// whole-state consistency (catches anything the per-line checks could miss)
curLine = 0;
const themes = themeIds();
for (const n of nodeById.values()) for (const t of n.threads) if (!threadById.has(t)) E(`node ${n.id}: unknown thread ${t}`, 0);
for (const e of edgeByKey.values()) for (const id of [e.source, e.target]) if (!nodeById.has(id)) E(`edge ${edgeRef(e.source, e.target, e.etype)}: endpoint ${id} missing`, 0);
void themes;

finish();

// ---------- 5. ledger appends ----------
const mentionRefs = new Map(touched);
for (const rf of newItems) if (!mentionRefs.has(rf)) mentionRefs.set(rf, 1);
for (const [ref, count] of mentionRefs) files.mentions.add({ date: dDate, conv: dConv, ref, count });
if (!src.conversations.some(c => c.date === dDate && c.id === dConv)) files.conversations.add({ date: dDate, id: dConv, title: dTitle });
for (const c of newLog) files.changelog.add(c);

const archiveText = blockLines.join('\n') + '\n';
const out = {};
const names = { threads: P.threads, nodes: P.nodes, edges: P.edges, mentions: P.mentions, conversations: P.conversations, changelog: P.changelog };
for (const [k, ed] of Object.entries(files)) if (ed.ops.length) out[names[k]] = ed.text();
out[P.lock] = lockFor(Buffer.from(files.changelog.text()));
out[archivePath] = archiveText;
if (ownerNow) out[P.owner] = '# owner: root node id (written once by the first delta; never edit)\n' + ownerNow + '\n';

if (warnings.length) { console.error('warnings:'); for (const w of warnings) console.error('  - ' + w); }
const show = s => (s.length > 150 ? s.slice(0, 147) + '...' : s);
if (dry) {
  console.log(`DRY RUN: delta "${convKey}" (${dTitle}) would change:`);
  for (const [k, ed] of Object.entries(files)) {
    if (!ed.ops.length || k === 'changelog') continue;
    console.log(`\n${path.relative(root, names[k])}: ${ed.ops.filter(o => o.op === '+').length} added, ${ed.ops.filter(o => o.op === '~').length} modified, ${ed.ops.filter(o => o.op === '-').length} removed`);
    if (k === 'mentions') { console.log(`  (${ed.ops.length} mention lines appended)`); continue; }
    for (const o of ed.ops) {
      if (o.op === '+') console.log('  + ' + show(o.after));
      else if (o.op === '-') console.log('  - ' + show(o.before));
      else { console.log('  - ' + show(o.before)); console.log('  + ' + show(o.after)); }
    }
  }
  console.log(`\n${path.relative(root, P.changelog)}: ${newLog.length} lines would be appended:`);
  for (const c of newLog) console.log('  + ' + show(changeLine(c)));
  if (ownerNow) console.log(`\nwould set the owner (root node) to "${ownerNow}" in ${path.relative(root, P.owner)}`);
  console.log(`\nwould write ${path.relative(root, P.lock)} and archive to ${path.relative(root, archivePath)}`);
  console.log(`summary: ${JSON.stringify(stats)}`);
  process.exit(0);
}

writeAll(out);
console.log(`merged "${convKey}": ${JSON.stringify(stats)}`);
console.log(`archived to ${path.relative(root, archivePath)}`);
if (ownerNow) console.log(`owner set: ${ownerNow} (first delta; this map now has its root)`);

function writeAll(map) {
  const done = [];
  for (const [p, c] of Object.entries(map)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', c); done.push(p); }
  for (const p of done) fs.renameSync(p + '.tmp', p);
}

// ---------- 6. regenerate + validate ----------
const run = script => spawnSync(process.execPath, [script, '--root', root], { stdio: 'inherit' }).status;
console.log('\n-- generate --');
const g = run(path.join(HERE, 'generate.mjs'));
console.log('\n-- validate --');
const v = run(path.join(HERE, '..', 'validate.mjs'));
if (g === 0 && JSON.parse(fs.readFileSync(P.graph, 'utf8')).nodes.length) {
  const graph = JSON.parse(fs.readFileSync(P.graph, 'utf8'));
  console.log('\ntop 10 nodes by strength:');
  [...graph.nodes].sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1)).slice(0, 10)
    .forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n.strength.toFixed(3)}  ${n.id}  (${n.mentions} mentions, ${n.conversations} conv)`));
}
process.exit(g === 0 && v === 0 ? 0 : 1);
