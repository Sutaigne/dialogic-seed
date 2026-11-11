// Generates data/dialogic.graph.json from the text sources in data/src/.
// Usage: node data/src/generate.mjs [--root <dir>]   (dir holds src/; output lands in dir/dialogic.graph.json)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, pathsFor, loadSources, buildGraph, graphText } from './lib.mjs';

const { root } = parseArgs(process.argv.slice(2));
const P = pathsFor(root);
const src = loadSources(P);
if (src.errs.length) {
  console.error(`generate: ${src.errs.length} source error(s):`);
  for (const m of src.errs) console.error('  - ' + m);
  process.exit(1);
}
const g = buildGraph(src);
fs.writeFileSync(P.graph, graphText(g));

// One combined file for the claude.ai project's knowledge: the three map sources verbatim.
const kDir = path.join(root, 'knowledge');
fs.mkdirSync(kDir, { recursive: true });
const block = name => `==== ${name} ====\n` + fs.readFileSync(P[name.replace('.txt', '')], 'utf8').replace(/\s*$/, '\n');
fs.writeFileSync(path.join(kDir, 'dialogic-map.txt'), [
  `# DIALOGIC MAP: project knowledge. Generated from data/src (latest conversation ${g.meta.updated}).`,
  '# Do not edit. Claude Code regenerates this file after every merge; replace it in the project each time.',
  '# Three sections follow, each the exact contents of one source file. Line formats: first comment of each section, and DELTA-FORMAT.md.',
  '', block('threads.txt'), block('nodes.txt'), block('edges.txt'),
].join('\n'));
console.log('nodes', g.nodes.length, 'edges', g.edges.length, 'log', g.log.length, 'conversations', g.meta.conversations.length);
