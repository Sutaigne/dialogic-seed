// Build the single-file offline viewer.
// Usage: node build.mjs [path-to-graph.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const rd = (p, enc = 'utf8') => fs.readFileSync(path.join(root, p), enc);

let graphPath = process.argv[2];
if (!graphPath) {
  const def = path.join(root, 'data', 'dialogic.graph.json');
  graphPath = def;
} else {
  graphPath = path.resolve(graphPath);
}
if (!fs.existsSync(graphPath)) { console.error('[build] graph not found: ' + graphPath); process.exit(1); }

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); // validates JSON
if (!graph.nodes.length) { console.error('[build] the map is blank: merge the first conversation\'s delta before building'); process.exit(1); }
const ids = new Set(graph.nodes.map(n => n.id));
const bad = graph.edges.filter(e => !ids.has(e.source) || !ids.has(e.target));
if (bad.length) { console.error('[build] edges with unknown endpoints: ' + bad.map(e => e.id).join(', ')); process.exit(1); }

const dupIds = graph.edges.map(e => e.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dupIds.length) { console.error('[build] duplicate edge ids: ' + [...new Set(dupIds)].join(', ')); process.exit(1); }

const font = (family, style, weight, file) => {
  const b64 = rd('vendor/fonts/' + file, null).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
};
const fontCss = [
  font('Newsreader', 'normal', '300 500', 'newsreader-roman.woff2'),
  font('Newsreader', 'italic', '300 500', 'newsreader-italic.woff2'),
  font('IBM Plex Mono', 'normal', '400', 'plex400.woff2'),
  font('IBM Plex Mono', 'normal', '500', 'plex500.woff2'),
].join('\n');

// The output has no <meta charset>, so keep every byte ASCII (non-ASCII becomes \uXXXX,
// valid inside JS strings/regex/comments and JSON strings).
const BS = String.fromCharCode(92);
const ascii = s => s.replace(/[^\u0000-\u007f]/g, c => BS + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
// keep inline <script> bodies from terminating early
const safeJs = s => ascii(s.split('</script').join('<' + BS + '/script').split('<!--').join('<' + BS + '!--'));
const safeJson = s => ascii(s.split('<').join(BS + 'u003c'));

const out = [
  '<title>Dialogic</title>',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<style>\n' + fontCss + '\n' + rd('src/viewer.css') + '\n</style>',
  rd('src/viewer.html'),
  '<script type="application/json" id="graph-data">' + safeJson(JSON.stringify(graph)) + '</script>',
  '<script>' + safeJs(rd('vendor/graph-bundle.js')) + '</script>',
  '<script>' + safeJs(rd('src/viewer.js')) + '</script>',
  '<script>' + safeJs(rd('src/analyze.js')) + '</script>',
  '',
].join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const dest = path.join(root, 'dist', 'dialogic-map.html');
fs.writeFileSync(dest, out);
const kb = fs.statSync(dest).size / 1024;
console.log(`[build] graph: ${path.relative(root, graphPath)} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
if (graph.log) console.log(`[build] v${graph.meta && graph.meta.version}: ${graph.log.length} log entries, ${(graph.meta.conversations || []).length} conversations`);
console.log(`[build] wrote ${path.relative(root, dest)} - ${kb.toFixed(0)} KB (${(kb / 1024).toFixed(2)} MB)`);
