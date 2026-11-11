# Dialogic

A living mind map, grown one conversation at a time. You talk with Claude in a claude.ai Project about whatever you keep returning to: books, people, places, ideas, work. At the end of each conversation Claude writes a small update to the map, Claude Code merges it, and your map (an offline 3D graph of everything you've talked about, sized by how often you come back to it) is republished as a private page you can open on any device.

This copy starts blank. Your first conversation builds it.

## Get started (once, about half an hour)

You need a claude.ai account with Projects and Claude Code, and a GitHub account. Google Drive is optional.

1. **Make your own copy of this repo** on GitHub ("Use this template", or fork it). Private is fine.
2. **Create a claude.ai Project** (any name, e.g. "Mind Map").
   - **Instructions:** paste the text from `chat/PROJECT-INSTRUCTIONS.md`, everything below the line.
   - **Knowledge:** upload `chat/FIRST-CONVERSATION.md` and `docs/DELTA-FORMAT.md`.
3. **Optional, the Drive inbox:** in Google Drive make a folder `Dialogic` with a folder `inbox` inside, and turn on the Google Drive connector in claude.ai. Map updates then go to Drive and you just say "merge the inbox". Without it, you copy and paste the update instead.
4. **Have the first conversation** in the Project. Say hello. Claude sees it's the first one, asks what the map should call you (any alias), and either follows your lead or asks the questions itself. When it's time, say "update the map".
5. **Merge it:** open Claude Code on your copy of the repo and say "merge the first delta" (paste the block, or "merge the inbox"). It builds your map, publishes it, gives you the link, and hands you a file called `dialogic-map.txt`.
6. **Swap the files in the Project's knowledge:** delete `FIRST-CONVERSATION.md` and upload `dialogic-map.txt`.

## After that, every conversation

Talk → "update the map" → in Claude Code, "merge the inbox" (or paste) → replace `dialogic-map.txt` in the Project with the new one.

## Where to read more

- How Claude Code runs a merge: `CLAUDE.md`
- The update format both sides share: `docs/DELTA-FORMAT.md`
- The whole loop as a flowchart: `docs/WORKFLOW.md`
- Setting up a Claude Code cloud environment for this repo: `docs/ENVIRONMENT.md`

Requires Node 22 or newer. No npm install for the normal run; the graph library is prebuilt in `vendor/`.

```bash
node data/src/generate.mjs && node data/validate.mjs && node data/test/run.mjs && node build.mjs && node scripts/export.mjs
```
