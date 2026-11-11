# Knowledge handoff — how the map gets back to the claude.ai Project

The chat side reads the current map only from the Project's knowledge files. After every merge, Claude Code exports them and the owner replaces them in the Project by hand. Nothing here is edited by hand.

## Files in the Project's knowledge

| File | When it is there | Replaced |
|---|---|---|
| `chat/FIRST-CONVERSATION.md` | only before the first merge; it, plus a missing `dialogic-map.txt`, is how the chat side knows the first conversation is happening | deleted after the first merge |
| `out/knowledge/dialogic-map.txt` | from the first merge on: three sections, each the exact contents of a source file (`==== threads.txt ====`, `==== nodes.txt ====`, `==== edges.txt ====`) | every run: delete the old one, upload the new one (same name) |
| `docs/DELTA-FORMAT.md` | always | only when it changes |

Not uploaded: `mentions.txt`, `changelog.txt`, `fields.txt`, `conversations.txt`, `owner.txt`, the graph JSON. The chat side reasons about ids and relations; strength and history are the merge side's business and show in the viewer.

## How to produce them

```bash
node data/src/generate.mjs   # writes data/knowledge/dialogic-map.txt
node scripts/export.mjs      # copies it to out/knowledge/dialogic-map.txt and writes out/reports/run-summary.md
```

`out/` is git-ignored and recreated each run.

## Upload steps (claude.ai, phone or laptop)

1. Open the Project → knowledge.
2. Remove the existing `dialogic-map.txt` (first run: remove `FIRST-CONVERSATION.md`).
3. Upload the new `dialogic-map.txt`.
4. If `docs/DELTA-FORMAT.md` changed, replace it the same way.

## Limits

- Plain UTF-8 text, LF line endings: the chat side greps ids out of it, and `|`-separated lines are the ones the merge tool parses.
- Project knowledge is loaded into the model's context. Keep the file comfortably under ~200 KB (~50k tokens), roughly 1,500 edges. When it approaches that, split `edges.txt` into its own knowledge file before trimming anything.
- Ids are the contract. Never rename an id in the knowledge file; renames go through a delta (`remove` + `add`) so the changelog keeps the lineage.
