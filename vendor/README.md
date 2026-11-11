# vendor/

- `graph-bundle.js` is a prebuilt IIFE of `entry.js` (3d-force-graph 1.80.1, three 0.186.1, three-spritetext 1.10.0), made with esbuild 0.28.2. It exposes `window.ForceGraph3D`, `window.THREE` and `window.SpriteText`.
- `build.mjs` inlines `graph-bundle.js` and `fonts/` into `dist/dialogic-map.html`, so **no install is needed for normal runs**.
- `package.json` + `package-lock.json` pin the exact versions. `node_modules/` is git-ignored.

## Rebuilding the bundle (only to change library versions or `entry.js`)

```bash
cd vendor && npm ci && npx esbuild entry.js --bundle --minify --outfile=graph-bundle.js
```

No extra flag is needed: esbuild's default output for `--bundle` without `--format` is already an IIFE for the browser platform.

Verified 2026-11-07 from a clean copy (`npm ci`, then the command above writing to a temp file): output 1,596,594 bytes vs 1,596,370 committed (+0.01%), same opening bytes. It is not byte-identical (224 bytes longer), so rebuilding changes `graph-bundle.js` and therefore `dist/dialogic-map.html`; only rebuild on purpose.
