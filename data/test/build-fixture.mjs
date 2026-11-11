// Rebuilds data/test/fixture-src from data/test/blank-src by merging data/test/fixture-deltas/* in order.
// The fixture is a made-up owner ("Lantern"); it never holds a real person's map.
// Usage: node data/test/build-fixture.mjs   (only when the fixture deltas or the merge rules change)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MERGE = path.join(HERE, '..', 'src', 'merge-delta.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-'));
fs.cpSync(path.join(HERE, 'blank-src'), path.join(tmp, 'src'), { recursive: true });
for (const f of fs.readdirSync(path.join(HERE, 'fixture-deltas')).filter(f => f.endsWith('.delta.txt')).sort()) {
  const r = spawnSync(process.execPath, [MERGE, path.join(HERE, 'fixture-deltas', f), '--root', tmp], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`merge of ${f} failed:\n${r.stdout}${r.stderr}`); process.exit(1); }
  console.log('merged ' + f);
}
const out = path.join(HERE, 'fixture-src');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(tmp, 'src'), out, { recursive: true });
fs.rmSync(path.join(out, 'fields.txt'), { force: true }); // tests rely on the fixture having no fields.txt
fs.rmSync(tmp, { recursive: true, force: true });
console.log('wrote ' + path.relative(process.cwd(), out));
