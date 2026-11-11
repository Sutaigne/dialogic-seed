// Pipeline tests. No framework. Runs everything on temp copies of data/src; the real files must not change.
// Usage: node data/test/run.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(DATA, 'src');
const GEN = path.join(SRC, 'generate.mjs'), MERGE = path.join(SRC, 'merge-delta.mjs'), VAL = path.join(DATA, 'validate.mjs');
const EXAMPLE = path.join(DATA, 'test', 'sample.delta.txt');
// Frozen made-up map (owner "Lantern"), built by data/test/build-fixture.mjs, so real merges never break the tests.
const FIXTURE = path.join(DATA, 'test', 'fixture-src');
const BLANK = path.join(DATA, 'test', 'blank-src');
const FIRST = path.join(DATA, 'test', 'fixture-deltas', '2026-01-10-first-light.delta.txt');
const REAL_GRAPH = path.join(DATA, 'dialogic.graph.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmap-test-'));

const run = (script, args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const hashTree = dir => {
  const h = crypto.createHash('sha256');
  const walk = d => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else { h.update(path.relative(dir, p)); h.update(fs.readFileSync(p)); } } };
  if (fs.existsSync(dir)) walk(dir);
  return h.digest('hex');
};
const realState = () => hashTree(SRC) + crypto.createHash('sha256').update(fs.readFileSync(REAL_GRAPH)).digest('hex') + hashTree(path.join(DATA, 'deltas'));

let n = 0;
const fresh = () => {
  const root = path.join(TMP, 'r' + ++n);
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(FIXTURE, path.join(root, 'src'), { recursive: true });
  if (run(GEN, ['--root', root]).code !== 0) throw new Error('baseline generate failed');
  return root;
};
const freshBlank = () => {
  const root = path.join(TMP, 'r' + ++n);
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(BLANK, path.join(root, 'src'), { recursive: true });
  if (run(GEN, ['--root', root]).code !== 0) throw new Error('blank generate failed');
  return root;
};
const graphOf = root => JSON.parse(fs.readFileSync(path.join(root, 'dialogic.graph.json'), 'utf8'));
// delta files live outside the data root so they never count as a change to it
const writeDelta = (root, text) => { const f = path.join(TMP, `in-${n}-${Math.random().toString(36).slice(2)}.delta.txt`); fs.writeFileSync(f, text); return f; };
const merge = (root, file, ...flags) => run(MERGE, [file, '--root', root, ...flags]);
const validate = root => run(VAL, ['--root', root]);

const realBefore = realState();
const results = [];
const test = (name, fn) => {
  try { fn(); results.push([name, true]); console.log('PASS  ' + name); }
  catch (e) { results.push([name, false]); console.log('FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
};
const ok = (c, msg) => { if (!c) throw new Error(msg); };

test('full sample delta merges, validates, and lands in the graph', () => {
  const root = fresh();
  const before = graphOf(root);
  const r = merge(root, EXAMPLE);
  ok(r.code === 0, 'merge exit ' + r.code + '\n' + r.out);
  const g = graphOf(root);
  ok(g.nodes.some(x => x.id === 'goldberg-variations'), 'new node missing');
  ok(g.nodes.some(x => x.id === 'theme-iv'), 'theme-iv missing');
  ok(g.edges.some(x => x.id === 'sennett>harrison:influenced' && x.basis === 'conversation'), 'new edge missing');
  ok(g.edges.some(x => x.id === 'goldberg-variations>theme-iv:belongs-to'), 'belongs-to for new node missing');
  ok(!g.edges.some(x => x.id === 'polaris>sobel-longitude:parallels'), 'removed edge still present');
  ok(g.edges.find(x => x.id === 'kitchen-as-lab>sourdough:applies-to').label === 'proving ground', 'edge label not modified');
  ok(g.nodes.find(x => x.id === 'sourdough').note.startsWith('Bread leavened by a starter; its flavour'), 'reverse not applied');
  ok(g.log.length === before.log.length + 9, `log grew by ${g.log.length - before.log.length}, want 9`);
  ok(g.log.some(x => x.action === 'reversed' && x.reason.includes('earlier position')), 'reversal does not name earlier position');
  ok(g.meta.latestConversation.id === 'night-sky-bread' && g.meta.updated === '2026-02-07', 'meta not updated');
  ok(g.nodes.find(x => x.id === 'wild-yeast').mentions === 4, 'touched count not recorded');
  ok(fs.existsSync(path.join(root, 'deltas', '2026-02-07-night-sky-bread.delta.txt')), 'delta not archived');
  ok(validate(root).code === 0, 'validator failed after merge');
});

test('dry run changes nothing', () => {
  const root = fresh();
  const h = hashTree(root);
  const r = merge(root, EXAMPLE, '--dry-run');
  ok(r.code === 0, 'exit ' + r.code + '\n' + r.out);
  ok(/DRY RUN/.test(r.out) && /would be appended/.test(r.out), 'dry-run did not print the plan');
  ok(hashTree(root) === h, 'files changed during dry run');
});

test('duplicate re-merge is refused and writes nothing', () => {
  const root = fresh();
  ok(merge(root, EXAMPLE).code === 0, 'first merge failed');
  const h = hashTree(root);
  const r = merge(root, EXAMPLE);
  ok(r.code !== 0 && /already merged/.test(r.out), 'second merge not refused:\n' + r.out);
  ok(hashTree(root) === h, 'files changed on refused merge');
});

test('delta with a bad ref is refused, nothing written, all errors listed', () => {
  const root = fresh();
  const h = hashTree(root);
  const bad = fs.readFileSync(EXAMPLE, 'utf8').replace('wild-yeast | note |', 'no-such-node | note |').replace('open-crumb | 1', 'ghost-node | 1');
  const r = merge(root, writeDelta(root, bad));
  ok(r.code !== 0, 'bad delta accepted');
  ok(/no such node "no-such-node"/.test(r.out) && /no such node "ghost-node"/.test(r.out), 'not all errors listed:\n' + r.out);
  ok(/\.delta\.txt:\d+:/.test(r.out), 'no line numbers');
  ok(hashTree(root) === h, 'files changed on refused merge');
});

test('hand-edited changelog is refused by merge and validator', () => {
  const root = fresh();
  const f = path.join(root, 'src', 'changelog.txt');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Owner chose the alias Lantern', 'Owner hand-edited the alias'));
  const h = hashTree(root);
  const r = merge(root, EXAMPLE);
  ok(r.code !== 0 && /changelog/.test(r.out) && /edited/.test(r.out), 'merge not refused:\n' + r.out);
  ok(hashTree(root) === h, 'files changed on refused merge');
  const v = validate(root);
  ok(v.code !== 0 && /changelog/.test(v.out), 'validator did not catch the edit');
});

test('appended-but-unlocked changelog line fails validation', () => {
  const root = fresh();
  fs.appendFileSync(path.join(root, 'src', 'changelog.txt'), '2026-01-30 | reweighted | harrison | 2 | 3 | sneaky | argument | x\n');
  ok(validate(root).code !== 0, 'validator accepted unlocked append');
});

test('reweight changes strength (and 1 resets it)', () => {
  const root = fresh();
  const e0 = graphOf(root).nodes.find(x => x.id === 'harrison'), s0 = e0.strength;
  const d = '@delta 2026-11-20 | harrison-again | Harrison again\n\n## reweight\nharrison | 3 | Owner: "Harrison matters most"\n\n## touched\nharrison | 1\n';
  const r = merge(root, writeDelta(root, d));
  ok(r.code === 0, 'exit ' + r.code + '\n' + r.out);
  const e = graphOf(root).nodes.find(x => x.id === 'harrison');
  ok(e.strength > s0, `strength did not rise (${s0} -> ${e.strength})`);
  ok(e.weight === 3 && e.conversations === e0.conversations + 1, `weight ${e.weight}, conversations ${e.conversations}`);
  const d2 = '@delta 2026-11-21 | harrison-reset | Reset\n\n## reweight\nharrison | 1 | Owner: back to normal\n\n## touched\n';
  ok(merge(root, writeDelta(root, d2)).code === 0, 'reset merge failed');
  ok(graphOf(root).nodes.find(x => x.id === 'harrison').weight === 1, 'reset to 1 not applied');
});

test('removing a node removes and logs its edges', () => {
  const root = fresh();
  const d = '@delta 2026-11-22 | drop-polaris | Drop Polaris\n\n## remove\npolaris | Owner rejected it outright | change-of-mind\n\n## touched\n';
  const r = merge(root, writeDelta(root, d));
  ok(r.code === 0, 'exit ' + r.code + '\n' + r.out);
  const g = graphOf(root);
  ok(!g.nodes.some(x => x.id === 'polaris'), 'node still present');
  ok(!g.edges.some(x => x.source === 'polaris' || x.target === 'polaris'), 'edges still present');
  ok(g.log.some(x => x.action === 'removed' && x.reason === 'endpoint removed: polaris'), 'edge removals not logged');
});

test('edge type change keeps its history (alias) and validates', () => {
  const root = fresh();
  const s0 = graphOf(root).edges.find(x => x.id === 'kitchen-as-lab>sourdough:applies-to').strength;
  const d = '@delta 2026-11-23 | retype | Retype\n\n## modify\nkitchen-as-lab > sourdough : a | type | parallels | Owner: it is a parallel | argument\n\n## touched\nkitchen-as-lab > sourdough : p | 1\n';
  const r = merge(root, writeDelta(root, d));
  ok(r.code === 0, 'exit ' + r.code + '\n' + r.out);
  const e = graphOf(root).edges.find(x => x.id === 'kitchen-as-lab>sourdough:parallels');
  ok(e && e.conversations === 2 && e.strength > s0, 'history not carried to new edge id');
});

test('fenced block with surrounding prose is accepted', () => {
  const root = fresh();
  const text = 'Here is the delta from chat:\n\n```\n' + fs.readFileSync(EXAMPLE, 'utf8') + '```\n\nLet me know if that looks right.\n';
  const r = merge(root, writeDelta(root, text), '--dry-run');
  ok(r.code === 0, 'exit ' + r.code + '\n' + r.out);
});

test('byConv gives per-conversation counts that sum to mentions', () => {
  const root = fresh();
  const r = merge(root, EXAMPLE);
  ok(r.code === 0, 'merge exit ' + r.code + ' ' + r.out);
  const g = graphOf(root);
  const ec = g.nodes.find(x => x.id === 'wild-yeast');
  ok(ec.byConv['night-sky-bread'] === 3 && ec.byConv['first-light'] === 1 && ec.mentions === 4, 'wild-yeast byConv: ' + JSON.stringify(ec.byConv));
  for (const n of g.nodes) {
    const s = Object.values(n.byConv).reduce((a, b) => a + b, 0);
    ok(s === n.mentions, n.id + ': byConv sum ' + s + ' != mentions ' + n.mentions);
  }
});

test('without fields.txt the graph generates and nodes have field null', () => {
  const root = fresh();
  ok(!fs.existsSync(path.join(root, 'src', 'fields.txt')), 'fixture unexpectedly has fields.txt');
  const g = graphOf(root);
  ok(g.nodes.every(n => n.field === null && n.subfield === null), 'a node has a non-null field');
  const v = validate(root);
  ok(v.code === 0, 'validator failed without fields.txt:\n' + v.out);
  ok(/unclassified: \d+ nodes/.test(v.out), 'no unclassified warning:\n' + v.out);
});

test('fields.txt assigns field/subfield; orphans only warn; merge still works', () => {
  const root = fresh();
  const id = graphOf(root).nodes.find(x => x.type !== 'theme').id;
  const f = path.join(root, 'src', 'fields.txt');
  fs.writeFileSync(f, '# id | field | subfield\n' + id + ' | Culture and the arts | Poetry\nno-such-node | History and events | Antiquity\n');
  ok(run(GEN, ['--root', root]).code === 0, 'generate failed');
  const n = graphOf(root).nodes.find(x => x.id === id);
  ok(n.field === 'Culture and the arts' && n.subfield === 'Poetry', 'field not applied: ' + n.field + ' / ' + n.subfield);
  const v = validate(root);
  ok(v.code === 0, 'validator failed:\n' + v.out);
  ok(/no-such-node/.test(v.out), 'orphan not mentioned:\n' + v.out);
  const r = merge(root, EXAMPLE);
  ok(r.code === 0, 'merge with unclassified new nodes failed\n' + r.out);
});

test('a bad field name fails the validator', () => {
  const root = fresh();
  const id = graphOf(root).nodes.find(x => x.type !== 'theme').id;
  fs.writeFileSync(path.join(root, 'src', 'fields.txt'), id + ' | Not a Wikipedia field | Poetry\n');
  const v = validate(root);
  ok(v.code !== 0 && /unknown field/.test(v.out), 'bad field accepted:\n' + v.out);
});

test('generator is deterministic (two runs byte-identical)', () => {
  const root = fresh();
  const f = path.join(root, 'dialogic.graph.json');
  const a = fs.readFileSync(f);
  ok(run(GEN, ['--root', root]).code === 0, 'generate failed');
  ok(Buffer.compare(a, fs.readFileSync(f)) === 0, 'outputs differ');
});

test('blank map: first delta without "## owner" is refused, nothing written', () => {
  const root = freshBlank();
  const h = hashTree(root);
  const d = fs.readFileSync(FIRST, 'utf8').replace('## owner\nlantern\n', '');
  const r = merge(root, writeDelta(root, d));
  ok(r.code !== 0 && /no owner yet/.test(r.out), 'ownerless first delta accepted:\n' + r.out);
  ok(hashTree(root) === h, 'files changed on refused merge');
});

test('blank map: first delta sets the owner as root and validates', () => {
  const root = freshBlank();
  ok(validate(root).code === 0, 'blank map does not validate');
  const r = merge(root, FIRST);
  ok(r.code === 0, 'first merge failed\n' + r.out);
  const g = graphOf(root);
  ok(g.meta.rootNode === 'lantern' && g.nodes.find(x => x.id === 'lantern').type === 'project', 'root not set: ' + g.meta.rootNode);
  ok(fs.readFileSync(path.join(root, 'src', 'owner.txt'), 'utf8').includes('lantern'), 'owner.txt not written');
  ok(validate(root).code === 0, 'validator failed after first merge');
});

test('owner is set once, must be a pr node, and cannot be removed', () => {
  const root = fresh();
  const again = '@delta 2026-11-24 | new-owner | New owner\n\n## owner\nharrison\n\n## touched\n';
  const r1 = merge(root, writeDelta(root, again));
  ok(r1.code !== 0 && /already "lantern"/.test(r1.out), 'second owner accepted:\n' + r1.out);
  const blank = freshBlank();
  const notPr = fs.readFileSync(FIRST, 'utf8').replace('## owner\nlantern', '## owner\npolaris');
  const r2 = merge(blank, writeDelta(blank, notPr));
  ok(r2.code !== 0 && /must be type pr/.test(r2.out), 'non-pr owner accepted:\n' + r2.out);
  const drop = '@delta 2026-11-25 | drop-root | Drop root\n\n## remove\nlantern | gone | change-of-mind\n\n## touched\n';
  const r3 = merge(root, writeDelta(root, drop));
  ok(r3.code !== 0 && /cannot remove the owner/.test(r3.out), 'root removal accepted:\n' + r3.out);
});

test('real data files were not touched by the tests', () => {
  ok(realState() === realBefore, 'data/src, graph or deltas changed during the run');
});

fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
