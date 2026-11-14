# Knowledge handoff — how the map gets back to the claude.ai Project

The chat side reads the current map only from the Project's knowledge files. After every merge the new map has to reach the Project, and there are two ways. `SETTINGS.md` records which one this map uses (`Map return`). Nothing here is edited by hand.

| | `github-sync` | `upload` |
|---|---|---|
| For | owners who chat at a laptop or PC | owners who chat on a phone (works anywhere) |
| After each merge | press **Sync now** in the Project's knowledge | delete the old `dialogic-map.txt`, upload the new one |
| Needs | the merge to be on the branch the Project syncs | the file Claude Code hands over |

## Files in the Project's knowledge

| File | When it is there | Replaced |
|---|---|---|
| `chat/FIRST-CONVERSATION.md` | only before the first merge; it, plus a missing or blank `dialogic-map.txt`, is how the chat side knows the first conversation is happening | removed after the first merge |
| `dialogic-map.txt` | three sections, each the exact contents of a source file (`==== threads.txt ====`, `==== nodes.txt ====`, `==== edges.txt ====`). With `upload` it is `out/knowledge/dialogic-map.txt`, there from the first merge on. With `github-sync` it is `data/knowledge/dialogic-map.txt`, there from setup (blank until the first merge) | every run |
| `docs/DELTA-FORMAT.md` | always | only when it changes |

Not in knowledge: `mentions.txt`, `changelog.txt`, `fields.txt`, `conversations.txt`, `owner.txt`, the graph JSON. The chat side reasons about ids and relations; strength and history are the merge side's business and show in the viewer.

## How the file is produced

```bash
node data/src/generate.mjs   # writes data/knowledge/dialogic-map.txt (committed; this is the file GitHub sync reads)
node scripts/export.mjs      # copies it to out/knowledge/dialogic-map.txt (the file handed over for upload) and writes out/reports/run-summary.md
```

`out/` is git-ignored and recreated each run.

## GitHub sync (`github-sync`)

Setup, once, at a laptop: in the Project's knowledge choose GitHub, pick the owner's copy of this repo, and tick `chat/FIRST-CONVERSATION.md`, `docs/DELTA-FORMAT.md` and `data/knowledge/dialogic-map.txt`. The Project must not be shared: GitHub files can only be added to a private Project. A private repo works once Claude has been given access to it on GitHub.

After the first merge: remove `FIRST-CONVERSATION.md` from the Project. After every merge: **Sync now**.

What to know:

- Sync is a button, not a background job. Until it is pressed the Project still holds the previous map, and a conversation started in between will build its update on old ids.
- Sync reads one branch, normally the default branch. A merge that is still on a pull request is not visible to the Project; merge the pull request first.
- When this was tried in November 2026, files a Project takes from GitHub did not appear in the claude.ai mobile app, so a conversation started on a phone had no map. To check on your own phone: open the Project there and ask Claude whether it can see `DELTA-FORMAT.md`. If it cannot, use `upload`.
- The files show in the Project with their paths (`data/knowledge/dialogic-map.txt`). The chat instructions expect that.

## Upload by hand (`upload`)

1. Open the Project → knowledge.
2. Remove the existing `dialogic-map.txt` (first run: remove `FIRST-CONVERSATION.md`).
3. Upload the new `dialogic-map.txt`.
4. If `docs/DELTA-FORMAT.md` changed, replace it the same way.

Use one way or the other, not both: two copies of the map in knowledge, one synced and one uploaded, will drift apart.

## Limits

- Plain UTF-8 text, LF line endings: the chat side greps ids out of it, and `|`-separated lines are the ones the merge tool parses.
- Project knowledge is loaded into the model's context. Keep the file comfortably under ~200 KB (~50k tokens), roughly 1,500 edges. When it approaches that, split `edges.txt` into its own knowledge file before trimming anything.
- Ids are the contract. Never rename an id in the knowledge file; renames go through a delta (`remove` + `add`) so the changelog keeps the lineage.
