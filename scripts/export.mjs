// Export the hand-off files for the current map state.
// Usage: node scripts/export.mjs   (or: npm run export)
// Reads : data/dialogic.graph.json, data/knowledge/dialogic-map.txt, data/src/conversations.txt, data/src/fields.txt
// Writes: out/knowledge/dialogic-map.txt   (byte-identical copy of the knowledge file the owner uploads to the Project)
//         out/reports/run-summary.md       (counts, verify flags, top 10, distributions + a paragraph for the owner)
// out/ is deleted and recreated on every run. Paths resolve from this file, not the working directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => path.join(root, ...a);

const graph = JSON.parse(fs.readFileSync(p('data', 'dialogic.graph.json'), 'utf8'));
const knowledge = fs.readFileSync(p('data', 'knowledge', 'dialogic-map.txt'));
const convLines = fs.readFileSync(p('data', 'src', 'conversations.txt'), 'utf8')
  .split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
const fieldsTxt = fs.readFileSync(p('data', 'src', 'fields.txt'), 'utf8'); // read so a missing file fails loudly
const classified = new Set(fieldsTxt.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|')[0].trim()));

if (!convLines.length) { console.error('export: the map is blank: merge the first conversation\'s delta first'); process.exit(1); }
const nodes = graph.nodes, edges = graph.edges;
const [lDate, lId, ...lTitle] = convLines[convLines.length - 1].split('|').map(s => s.trim());
const latest = { date: lDate, id: lId, title: lTitle.join(' | ') };

const count = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
const table = (m, h1, h2) => {
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return `| ${h1} | ${h2} |\n|---|---|\n` + rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n');
};

const nodeVerify = nodes.filter(n => n.verify === true).length;
const edgeVerify = edges.filter(e => e.verify === true).length;
const unclassified = nodes.filter(n => n.type !== 'theme' && (n.field == null || !classified.has(n.id)));
const top10 = [...nodes].sort((a, b) => b.strength - a.strength || a.label.localeCompare(b.label)).slice(0, 10);

const paragraph = `Merged ${latest.title} (${latest.date}): ${nodes.length} nodes / ${edges.length} edges now across ${convLines.length} conversations; ` +
  `${nodeVerify} verify flags on nodes and ${edgeVerify} on edges; ${unclassified.length} unclassified.`;

const md = [
  '# Dialogic run summary',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## For the owner',
  '',
  paragraph,
  '',
  '## Counts',
  '',
  `- Nodes: ${nodes.length}`,
  `- Edges: ${edges.length}`,
  `- Conversations: ${convLines.length}`,
  `- Latest conversation: ${latest.date} | ${latest.id} | ${latest.title}`,
  '',
  '## Verify flags',
  '',
  `- Nodes: ${nodeVerify}`,
  `- Edges: ${edgeVerify}`,
  '',
  '## Unclassified nodes',
  '',
  unclassified.length ? unclassified.map(n => `- ${n.id}`).join('\n') : '0',
  '',
  '## Top 10 by strength',
  '',
  '| Label | Strength | Mentions | Conversations |',
  '|---|---|---|---|',
  ...top10.map(n => `| ${n.label} | ${n.strength} | ${n.mentions} | ${n.conversations} |`),
  '',
  '## Field distribution',
  '',
  table(count(nodes.filter(n => n.type !== 'theme'), n => n.field ?? '(none)'), 'Field', 'Nodes'),
  '',
  '## Node types',
  '',
  table(count(nodes, n => n.type), 'Type', 'Nodes'),
  '',
  '## Edge types',
  '',
  table(count(edges, e => e.type), 'Type', 'Edges'),
  '',
].join('\n');

const out = p('out');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'knowledge'), { recursive: true });
fs.mkdirSync(path.join(out, 'reports'), { recursive: true });
fs.writeFileSync(path.join(out, 'knowledge', 'dialogic-map.txt'), knowledge);
fs.writeFileSync(path.join(out, 'reports', 'run-summary.md'), md);
console.log('exported: out/knowledge/dialogic-map.txt, out/reports/run-summary.md');
console.log(paragraph);
