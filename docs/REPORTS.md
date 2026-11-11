# Reports inventory

"Reports" in Dialogic are not separate documents. They are views generated from `data/src/` and surfaced in three places: inside the viewer, in console output, and in two exported files. Nothing is written by hand.

| Report | What it shows | Built by | Published where | Updated when |
|---|---|---|---|---|
| **The map** | 3D force graph; node size by strength; thread clusters; origin colours (oxblood owner / forest Claude / both shared); type, thread, origin, verify and Since filters | `build.mjs` from `data/dialogic.graph.json` | inside the viewer → the artifact in `SETTINGS.md` | every run (republish) |
| **Timeline** | bar under the map: one tick per conversation in the order they happened; Replay grows the map step by step; caption gives what that conversation added and returned to; Spotlight dims what it did not touch | viewer, from `byConv` and the order of `graph.log` | inside the viewer | every run |
| **Path** | "Trace a path from here" in the Detail panel: shortest chain of drawn links between two nodes, each hop with its label, type, origin and direction; routes through a thread only when no drawn chain exists | viewer | inside the viewer | every run |
| **Detail panel** | one node or edge: note, threads, field / subfield, strength, mentions, conversations, last seen, verify note | viewer (`src/viewer.js`) | inside the viewer | every run |
| **History drawer** | the append-only changelog, newest first, filterable by action and conversation | viewer, from `graph.log` (= `data/src/changelog.txt`) | inside the viewer | every run |
| **Share dock** | "what leads the conversations": proportional bars by Thread / Type / Field / Origin, metric Engagement / Mentions / Count, all conversations or one; per-conversation heatmap; click a row to dim the rest of the map. HIDE/SHOW strip under the map | viewer, from `byConv`, `field`, `strength` on each node/edge | inside the viewer | every run |
| **Verify flags** | count and list of nodes/edges with a non-`~` verifyNote (Claude inferences the owner has not confirmed) | `data/validate.mjs` console; viewer filter "verify" | console; inside the viewer | every run |
| **Unclassified nodes** | nodes with no `fields.txt` line | `data/validate.mjs` warning | console | every run (must be zero before build) |
| **Top 10 by strength, type/edge/origin/basis counts** | sanity summary | `data/validate.mjs` console | console; copied into `out/reports/run-summary.md` | every run |
| **Run summary** | counts (nodes, edges, conversations, latest conversation), delta applied, verify totals, unclassified, top 10 strength, field distribution | `scripts/export.mjs` | `out/reports/run-summary.md` (git-ignored; give the paragraph to the owner) | every run |
| **Knowledge file** | threads + nodes + edges verbatim, for the chat side | `data/src/generate.mjs` → `data/knowledge/dialogic-map.txt`; copied by `scripts/export.mjs` | `out/knowledge/dialogic-map.txt` → the owner uploads to the Project | every run (see `KNOWLEDGE-HANDOFF.md`) |
| **OPEN-THREADS.md** | working tracker: awaiting the owner, in flight, concerns, banked | hand-maintained by the session | repo | every run |

## Not reports, but easy to confuse

- `data/deltas/*.delta.txt` — the archived input blocks, one per merged conversation.
- `data/src/changelog.txt` — the source of the History drawer; append-only; never edited.

## Checking layout

`tools/shot.mjs` screenshots a URL with headless Chrome via CDP (set `CHROME` to a Chrome binary; in a cloud session see `docs/ENVIRONMENT.md`). Serve `dist/` first, e.g. `python -m http.server 8742 --directory dist`, then `CDP_URL=http://localhost:8742/dialogic-map.html node tools/shot.mjs 1280 900 out/shot.png`.
