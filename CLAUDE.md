# Dialogic — operating manual for Claude Code

Dialogic is a living mind map: an offline, single-file 3D force graph of works, people, concepts and threads, grown one conversation at a time. This repo is the **merge side**. Read this file, `SETTINGS.md`, then `docs/DELTA-FORMAT.md`, before touching anything. "The owner" is the person whose map this is; their alias is the root node (`data/src/owner.txt`).

## First run or ordinary run?

- **First run**: `data/src/owner.txt` does not exist and `data/src/nodes.txt` has no node lines. The map is blank and the delta in hand comes from the first conversation (`chat/FIRST-CONVERSATION.md`). It must carry `## owner`; the merge tool refuses it otherwise. Follow "The run" below, with the first-run steps marked **(first run)**.
- **Ordinary run**: everything else.

## The split of responsibilities

| Side | Does | Never does |
|---|---|---|
| **Chat side**: the owner's claude.ai Project (instructions = `chat/PROJECT-INSTRUCTIONS.md`, pasted by hand; knowledge = `dialogic-map.txt` and `docs/DELTA-FORMAT.md`, plus `chat/FIRST-CONVERSATION.md` before the first merge) | Holds the conversations. Reads the current map from project knowledge. Emits one fenced `@delta` block per conversation and saves it to the owner's storage inbox or gives it to the owner to paste. | Edits source files. Sets strength. |
| **Merge side**: this repo, any Claude Code session | Dry-runs and merges the delta into `data/src/`, appends the changelog, codifies new nodes (`data/src/fields.txt`), regenerates, validates, tests, rebuilds the viewer, republishes it to **the owner's artifact URL**, exports the knowledge file, which goes back to the Project by upload or by GitHub sync. | Writes map content (nodes, edges, notes, threads) that was not in a delta. Sets or edits strength. Rewrites past changelog lines. Creates a second artifact. |

Source of truth is `data/src/*.txt`. Everything else (`data/dialogic.graph.json`, `data/knowledge/`, `dist/`, `out/`) is generated.

## The run, in order

```bash
# 0. get the block and save it OUTSIDE data/deltas/ (the merge archives it there itself), e.g. <scratch>/<slug>.delta.txt
#    "merge the inbox" = the inbox folder in the owner's storage (see below); a pasted block works the same way
node data/src/merge-delta.mjs <delta-file> --dry-run   # show the owner the change list; stop on REFUSED
node data/src/merge-delta.mjs <delta-file>             # merge + append changelog + lock + archive + generate + validate
# 1. codify: add one line per NEW node to data/src/fields.txt  →  id | field | subfield
#    field = one of the 13 Wikipedia Contents/Categories headings verbatim (WIKI_FIELDS in data/src/lib.mjs);
#    reuse an existing subfield when one fits. The validator lists "unclassified". The owner's alias node: People and self / Self.
node data/src/generate.mjs      # MUST re-run after fields.txt changes; build.mjs does not regenerate
node data/validate.mjs          # must end "OK: all checks passed."
node data/test/run.mjs          # all pass on the frozen made-up fixture; real files are never touched
node build.mjs                  # dist/dialogic-map.html (~2 MB+, fonts + graph bundle inlined)
# 2. publish dist/dialogic-map.html with the Artifact tool:
#    ordinary run: update the artifact whose URL is in SETTINGS.md (read it once in the session first if the tool asks;
#    omit `capabilities` so the stored declaration carries forward).
#    (first run): SETTINGS.md has no artifact URL yet. Publish a NEW artifact (title "Dialogic", icon "map",
#    capabilities {sample: {}, mcp: {servers: [{server: "Hugging Face", tools: ["hub_repo_search"]}]}} so the Analyze
#    sheet runs on the owner's Claude account and can search public projects if they have that connector),
#    then write its URL into SETTINGS.md. This is the only time a new artifact is ever created.
node scripts/export.mjs         # out/knowledge/dialogic-map.txt + out/reports/run-summary.md
```

Then commit and push (a PR if the owner works that way), and get the map back to the Project the way `SETTINGS.md` says under `Map return`:

- **`upload`:** hand the owner **`out/knowledge/dialogic-map.txt`** as a downloadable file: they remove the old `dialogic-map.txt` from the Project's knowledge and upload the new one. If `docs/DELTA-FORMAT.md` changed, hand them that too.
- **`github-sync`:** hand over no file. The Project reads `data/knowledge/dialogic-map.txt` and `docs/DELTA-FORMAT.md` from this repo, one branch only (normally the default branch). Tell the owner which branch the merge is on; if it is on a PR, say plainly that the PR has to be merged before the Project can see the new map. Then: "press **Sync now** in the Project's knowledge".
- **Not set:** ask once ("do you upload the map to the Project by hand, or does the Project sync it from GitHub?"), write the answer into `SETTINGS.md`, and carry on. Hand upload is the safe answer for anyone who chats from a phone: when this was tried in November 2026, files a Project takes from GitHub did not show in the mobile app.

Also give **one paragraph** of what changed (counts added / modified / removed / reversed, the conversation's title, verify-flag totals, anything to review); `out/reports/run-summary.md` has the numbers.

**(first run)** also tell the owner, plainly:
1. their map's link (the new artifact URL);
2. in the Project's knowledge: **remove `FIRST-CONVERSATION.md`** and keep `DELTA-FORMAT.md`; then upload `dialogic-map.txt` (`upload`) or press Sync now once the merge is on the synced branch (`github-sync`);
3. from now on: talk, say "update the map", then tell Claude Code "merge the inbox" (or paste), then replace `dialogic-map.txt` or press Sync now;
4. recommended, if not done yet: connect **Hugging Face** in claude.ai (https://claude.ai/customize/connectors, how-to https://support.claude.com/en/articles/11176164) so Analyze recommends real public projects from a live search. Without it the picks come from memory and Analyze shows the same note with these links.

Update `OPEN-THREADS.md`: the `Live:` line (artifact URL and version number, v1 on the first run) and one line under `Banked`.

## The inbox (optional)

If the owner keeps an inbox, the chat side saves each delta as a plain text file in a folder `Dialogic/inbox` in their storage service, named `<date>-<slug>.delta.txt` (`-r2`, `-r3` for corrected blocks). Nothing polls it: the owner says "merge the inbox". Without an inbox, the owner pastes the block; everything else is the same. `SETTINGS.md` names the service under `Inbox service`.

Any storage service works if its connector can do four things: create a plain text file from the chat, and list a folder, download a file's exact bytes and move a file from Claude Code. Google Drive is the one this has been run with; its notes are at the end of this section.

- **Finding the inbox:** by the ids or paths in `SETTINGS.md`. If they are not set yet, find the top-level folder named `Dialogic`, then the lowercase `inbox` inside it, and write the service's name and both ids or paths (and `merged`, once created) into `SETTINGS.md`. Never search the storage for "inbox" by name alone.
- Only files named `*.delta.txt` that contain an `@delta` line are deltas. Anything else in the inbox is not merged; tell the owner it is there.
- **Read each file byte for byte.** Use the connector's raw download, not a tool that renders the file as text or Markdown: those can escape `>`, `#` and `~` and cut long files short. Before the dry-run, check that the first line starts with `@delta` and that the file holds no `\>`, `\#` or `\~`. If the connector cannot give exact bytes, do not merge from it: ask the owner to paste the block.
- Merge oldest first (delta date, then the file's creation time). Where an `-rN` file exists, use the highest N and skip the earlier ones. Every delta gets its own dry-run shown to the owner; codify, build and publish can happen once at the end.
- After a delta is merged, move its file (and any superseded `-rN` siblings) to `Dialogic/merged` (create the folder inside `Dialogic` on first use). Leave refused files in the inbox and tell the owner what the tool said.
- Nothing in the storage is ever edited, and the map is never written back to it.

**Google Drive:** list the folder with `search_files` (`parentId = '<inbox id>'`). Fetch each file with **`download_file_content`** and base64-decode it. Never use `read_file_content` for a delta: it returns Markdown with `\>`, `\#`, `\~` escapes and cuts off at 100,000 characters. Order ties by Drive `createdTime`. Move a merged file with `update_file` `parentId`.

## Refuse, and say why

- A delta that names an id that does not exist (the merge tool refuses; do not "fix" ids by guessing; ask the owner or the chat side for a corrected block).
- A first delta without `## owner`, or a later delta with one. The alias changes through a `modify` of the owner node's label.
- Any request to set, nudge or hand-edit `strength`, `score`, mentions or reweights outside a delta's `reweight` line.
- Editing or deleting past `changelog.txt` lines, or touching `changelog.lock` or `owner.txt`. A changed position is a new `reversed` entry that names the earlier one.
- Writing nodes, edges, notes or threads the owner did not state in a delta. Codification (`fields.txt`) is the one judgment call this side makes, and it is metadata, not content.
- Publishing to a second artifact URL once one is in `SETTINGS.md`, or publishing without a green validator.
- A delta whose `date | conversation` is already in `mentions.txt` (double count), unless the owner explicitly says `--force`.

## Conventions that are easy to miss

- `merge-delta.mjs` already runs generate + validate, but **codification happens after the merge**, so generate must run again before build.
- `verifyNote` starting with `~` is informational; any other non-empty verifyNote sets `verify: true`. Nodes have no origin field: for nodes the verifyNote alone carries the flag.
- Edge origins: `o` owner, `c` Claude's unconfirmed inference, `s` shared (Claude offered, the owner took it up).
- Themes come from `threads.txt`; `belongs-to` edges are generated, never written.
- Engagement counts live in `mentions.txt`; strength is `1 − e^(−score/2)` from `1 + ln(count)` per conversation with recency decay (details in `docs/DELTA-FORMAT.md`). Nothing sets it by hand.
- `build.mjs` and `scripts/export.mjs` refuse a blank map: there is nothing to publish before the first merge.
- The viewer (`src/viewer.*`, plus `src/analyze.js` for the Analyze sheet) is an ES5 IIFE; `build.mjs` inlines `vendor/graph-bundle.js` (prebuilt 3d-force-graph + three) and the fonts. Rebuilding the bundle needs `vendor/node_modules` (`npm ci` in `vendor/`, see `vendor/README.md`); the committed bundle is enough for normal runs.
- Tests run on `data/test/fixture-src`, a made-up map (owner "Lantern") built from `data/test/fixture-deltas/` by `data/test/build-fixture.mjs`. Rebuild it only when the merge rules change.
- Screenshots for checking layout: `tools/shot.mjs` (headless Chrome via CDP); see `docs/REPORTS.md`.
- Deltas are append-only history: `data/deltas/` keeps every merged block.

## Where things are

| Path | What |
|---|---|
| `SETTINGS.md` | the owner's artifact URL, how the map returns to the Project (`upload` or `github-sync`), and the inbox's service and folder ids (filled on the first run) |
| `chat/` | what the owner puts in the claude.ai Project: `PROJECT-INSTRUCTIONS.md` (instructions field), `FIRST-CONVERSATION.md` (knowledge, first conversation only) |
| `data/src/` | sources: `threads.txt nodes.txt edges.txt mentions.txt conversations.txt fields.txt changelog.txt changelog.lock owner.txt`; tools `generate.mjs merge-delta.mjs lib.mjs` |
| `data/validate.mjs`, `data/test/` | validator; tests on the made-up fixture; `blank-src/` is the empty starting state |
| `data/dialogic.graph.json` | generated graph (committed so the viewer can build without regenerating) |
| `data/knowledge/dialogic-map.txt` | generator's knowledge output (committed); `scripts/export.mjs` copies it to `out/knowledge/` |
| `src/`, `build.mjs`, `vendor/` | viewer source, builder, prebuilt bundle + fonts |
| `docs/` | `WORKFLOW.md` (order of operations), `DELTA-FORMAT.md` (the contract), `SCHEMA.md`, `REPORTS.md`, `KNOWLEDGE-HANDOFF.md`, `ENVIRONMENT.md` (cloud environment for Claude Code) |
| `OPEN-THREADS.md` | working tracker: awaiting the owner / in flight / banked |
| `out/` | export output (git-ignored) |
