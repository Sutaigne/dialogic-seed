// Validates the graph JSON and (by default) its text sources. No dependencies. Node 22+.
// Usage: node data/validate.mjs [--root <dir>] [graph.json]
//   With an explicit graph.json only the graph-level checks run (no source / lock / staleness checks).
import fs from 'node:fs';
import { WIKI_FIELDS, parseArgs, pathsFor, loadSources, buildGraph, graphText, checkLock, buildAlias, removedIds, refToId, ID_RE, LOG_TRIGGERS, ACTIONS } from './src/lib.mjs';

const { root, positional } = parseArgs(process.argv.slice(2));
const P = pathsFor(root);
const graphOnly = positional.length > 0;
const file = positional[0] || P.graph;
const g = JSON.parse(fs.readFileSync(file, 'utf8'));

const NODE_TYPES = new Set(['theme', 'person', 'work', 'place', 'concept', 'project', 'paper', 'school']);
const EDGE_TYPES = new Set(['wrote', 'influenced', 'parallels', 'critiques', 'belongs-to', 'applies-to']);
const ORIGINS = new Set(['owner', 'claude', 'shared']);
const BASES = new Set(['index-d', 'cross-link', 'index', 'conversation']);
const ROLES = new Set(['author', 'artist', 'ruler', 'scholar', 'other']);

const errors = [];
const err = m => errors.push(m);
const warnings = [];
const warn = m => warnings.push(m);

const threadIds = new Set((g.threads || []).map(t => t.id));
const nodeIds = new Set();
const degree = new Map();

for (const n of g.nodes || []) {
  if (nodeIds.has(n.id)) err(`duplicate node id: ${n.id}`);
  nodeIds.add(n.id);
  degree.set(n.id, 0);
  if (!NODE_TYPES.has(n.type)) err(`node ${n.id}: bad type ${n.type}`);
  if (n.field != null && !WIKI_FIELDS.includes(n.field)) err(`node ${n.id}: bad field ${n.field}`);
  if (n.type !== 'theme' && !ID_RE.test(n.id)) err(`node ${n.id}: id is not kebab-case`);
  if (n.type === 'person' && !ROLES.has(n.role)) err(`node ${n.id}: bad or missing role ${n.role}`);
  if (!Array.isArray(n.threads) || n.threads.length < 1) err(`node ${n.id}: needs >=1 thread`);
  else for (const t of n.threads) if (!threadIds.has(t)) err(`node ${n.id}: unknown thread ${t}`);
  if (typeof n.note !== 'string' || !n.note) err(`node ${n.id}: missing note`);
  else {
    if (/[\r\n]/.test(n.note)) err(`node ${n.id}: note has line break`);
    if (n.note.length > 140) err(`node ${n.id}: note ${n.note.length} chars (>140)`);
  }
  if (n.verify && !(n.verifyNote || '').trim()) err(`node ${n.id}: verify without verifyNote`);
  if (n.strength != null && !(n.strength >= 0 && n.strength <= 1)) err(`node ${n.id}: strength out of [0,1]: ${n.strength}`);
}

const edgeIds = new Set();
const triples = new Set();
for (const e of g.edges || []) {
  if (edgeIds.has(e.id)) err(`duplicate edge id: ${e.id}`);
  edgeIds.add(e.id);
  const stable = `${e.source}>${e.target}:${e.type}`;
  if (e.id !== stable) err(`edge ${e.id}: id does not match stable form ${stable}`);
  if (triples.has(stable)) err(`duplicate edge (source,target,type): ${stable}`);
  triples.add(stable);
  if (!nodeIds.has(e.source)) err(`edge ${e.id}: missing source ${e.source}`);
  if (!nodeIds.has(e.target)) err(`edge ${e.id}: missing target ${e.target}`);
  if (!EDGE_TYPES.has(e.type)) err(`edge ${e.id}: bad type ${e.type}`);
  if (!ORIGINS.has(e.origin)) err(`edge ${e.id}: bad origin ${e.origin}`);
  if (!BASES.has(e.basis)) err(`edge ${e.id}: bad basis ${e.basis}`);
  if (e.verify && !(e.verifyNote || '').trim()) err(`edge ${e.id}: verify without verifyNote`);
  if (e.type === 'belongs-to') {
    if (e.strength != null) err(`edge ${e.id}: belongs-to must have strength null`);
  } else if (e.strength != null && !(e.strength >= 0 && e.strength <= 1)) err(`edge ${e.id}: strength out of [0,1]: ${e.strength}`);
  if (degree.has(e.source)) degree.set(e.source, degree.get(e.source) + 1);
  if (degree.has(e.target)) degree.set(e.target, degree.get(e.target) + 1);
}

for (const [id, d] of degree) if (d === 0) err(`orphan node (degree 0): ${id}`);
if (g.meta && g.meta.rootNode) {
  const rn = (g.nodes || []).find(n => n.id === g.meta.rootNode);
  if (!rn) err(`rootNode missing: ${g.meta.rootNode}`);
  else if (rn.type !== 'project') err(`rootNode ${rn.id} must be type project, got ${rn.type}`);
} else if ((g.nodes || []).length) err('map has nodes but no owner (data/src/owner.txt): the first delta must carry "## owner"');

// ---- log (graph-level) ----
const log = g.log || [];
const removed = new Set(log.filter(c => c.action === 'removed').map(c => c.target));
const alias = buildAlias(log.map(c => ({ ...c, target: c.target })));
log.forEach((c, i) => {
  const at = `log[${i}]`;
  if (!ACTIONS.includes(c.action)) err(`${at}: bad action ${c.action}`);
  if (!LOG_TRIGGERS.includes(c.trigger)) err(`${at}: bad trigger ${c.trigger}`);
  if (c.target === '*') return;
  if (!nodeIds.has(c.target) && !edgeIds.has(c.target) && !removed.has(c.target) && !alias.has(c.target)) {
    err(`${at}: target ${c.target} does not exist and was never removed`);
  }
});

// ---- source-level checks ----
if (!graphOnly) {
  const src = loadSources(P);
  for (const m of src.errs) err(m);
  const lockErr = checkLock(P);
  if (lockErr) err(lockErr);

  const srcAlias = buildAlias(src.changelog);
  const srcRemoved = removedIds(src.changelog);
  for (const m of src.mentions) {
    const id0 = refToId(m.ref);
    const loc = `mentions.txt:${m.line}`;
    if (!id0) { err(`${loc}: bad ref "${m.ref}"`); continue; }
    const id = srcAlias.get(id0) ?? id0;
    if (id.endsWith(':belongs-to')) err(`${loc}: belongs-to edges cannot be mentioned (${m.ref})`);
    else if (!nodeIds.has(id) && !edgeIds.has(id) && !srcRemoved.has(id) && !srcRemoved.has(id0)) err(`${loc}: ref "${m.ref}" matches no node or edge (and was never removed)`);
  }
  // fields.txt: orphans and unclassified nodes are warnings only (merges add nodes before they are classified)
  const orphans = src.fields.filter(f => !nodeIds.has(f.id)).map(f => f.id);
  if (orphans.length) warn(`fields.txt: ${orphans.length} id(s) match no node: ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? ', ...' : ''}`);
  const classified = new Set(src.fields.map(f => f.id));
  const unclassified = (g.nodes || []).filter(n => n.type !== 'theme' && !classified.has(n.id)).map(n => n.id);
  if (unclassified.length) warn(`unclassified: ${unclassified.length} nodes (no fields.txt line): ${unclassified.slice(0, 10).join(', ')}${unclassified.length > 10 ? ', ...' : ''}`);
  const seenConv = new Set();
  for (const c of src.conversations) {
    const k = c.date + ' ' + c.id;
    if (seenConv.has(k)) err(`conversations.txt:${c.line}: duplicate conversation ${k}`);
    seenConv.add(k);
  }
  for (const m of src.mentions) if (!seenConv.has(m.date + ' ' + m.conv)) { err(`mentions.txt:${m.line}: conversation "${m.date} ${m.conv}" not in conversations.txt`); break; }

  // staleness: graph must equal what the generator would produce now
  if (!errors.length && file === P.graph) {
    if (fs.readFileSync(file, 'utf8') !== graphText(buildGraph(src))) err('graph JSON is stale: rerun node data/src/generate.mjs');
  }
}

const tally = (arr, key) => {
  const m = {};
  for (const x of arr) m[x[key]] = (m[x[key]] || 0) + 1;
  return m;
};
console.log(`nodes: ${g.nodes.length}  edges: ${g.edges.length}  threads: ${g.threads.length}  log: ${log.length}`);
console.log('node types:', tally(g.nodes, 'type'));
console.log('edge types:', tally(g.edges, 'type'));
console.log('origins:   ', tally(g.edges, 'origin'));
console.log('basis:     ', tally(g.edges, 'basis'));
console.log(`verify flags: nodes ${g.nodes.filter(n => n.verify).length}, edges ${g.edges.filter(e => e.verify).length}`);

for (const m of warnings) console.log('WARNING: ' + m);
if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const m of errors) console.error('  - ' + m);
  process.exit(1);
}
if (!(g.nodes || []).length) console.log('\nBlank map: no conversations merged yet.');
console.log('\nOK: all checks passed.');
