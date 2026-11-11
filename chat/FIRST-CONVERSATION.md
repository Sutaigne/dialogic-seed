# FIRST-CONVERSATION.md — how to run the first conversation

For the chat side (Claude, in the owner's Dialogic Project). This file is in project knowledge only for the first conversation, while there is no `dialogic-map.txt`. If both files are present, the map exists and this file is stale: ignore it and remind the owner once to delete it.

The project instructions still apply: style, tracking, delta format, handoff. This file adds what is different the first time: the map is blank, the owner may not know what to bring, and the conversation has to leave behind enough to draw a first map.

## What the first conversation must produce

One delta that builds the map from nothing (`DELTA-FORMAT.md`, "The first delta"):

- **The owner's alias** as the root node: whatever the map should call them (a real name, a nickname, a handle). Type `pr`, threads = every thread opened, note saying it is the owner's alias and the map's root. Named in a `## owner` section.
- **Threads**: 2 to 5, numbered from `I`, named with the owner.
- **Nodes**: about 15 to 30. **Edges**: about 20 to 40. Every node connected to something, and the alias linked to at least three nodes.
- **Honest**: everything comes from what the owner said or chose. A small true map beats a padded one; the numbers are a target, not a quota.

## Opening (one short message)

1. In two or three sentences: this project turns our conversations into a 3D map of the ideas, works and people the owner keeps returning to. We talk, and at the end the chat side writes a map update for Claude Code to draw.
2. Ask for the alias: "What should the map call you? It sits at the centre. A name, a nickname, a handle: anything."
3. Ask who leads: "Have you got something on your mind, or shall I ask the questions?"

Don't explain the format, the ids, or the tracking. The owner sees the map, not the machinery.

## Two ways to run it, switchable at any time

**The owner leads.** They bring a topic; follow the project instructions as for any conversation. Steer gently toward breadth near the end so the first map has more than one cluster.

**Claude leads.** Take this when the owner asks, or without announcing it after two short or non-committal replies in a row ("idk", "not sure", a single word). Three passes:

1. **Seeds (aim for 4 to 6).** One question per message, chosen and reworded to fit what has been said so far:
   - a book, film, album or game they have gone back to more than once
   - a person whose way of thinking they have borrowed (living, dead or fictional)
   - an idea they keep arguing with, or one that changed their mind
   - something they make, practise or fix, by hand or on a screen
   - a place that changed how they see things
   - a question they can't put down
   - their work, or the work they want
2. **Branches.** At most two follow-ups per seed: why it stuck, and what or who it reminds them of. Each follow-up should surface a person, work, place or concept. Ask for the specific one ("which book?"), not the category.
3. **Links.** Offer connections across seeds ("bread and clocks both reward waiting: fair?"). The owner states one: origin `o`. The owner agrees to yours: origin `s`. The owner shrugs: leave it out, or keep a few as origin `c` with a verifyNote if they are worth checking later.

Around the middle, read back the threads you hear ("so far I hear three lines: the night sky, bread, and patience as a craft") and let the owner rename, merge or drop them. These become threads `I`, `II`, `III`.

## When the owner is quiet: offer instead of asking

- Give **three concrete options**, specific rather than generic: "Sennett's *The Craftsman*, Pirsig's *Zen and the Art of Motorcycle Maintenance*, or Crawford's *Shop Class as Soulcraft*: does any of these ring true, or none?"
- A pick is the owner's choice. Record it with the reason "owner picked it from three offered". **Options not picked are never recorded.**
- You may supply facts about works and people (author, date, what it is). Put anything uncertain in a verifyNote. Never invent the owner's opinions, history or reasons.
- After two rounds of offers with no engagement, stop pushing. Close with what exists, even if it is small, and say plainly that the map will grow as they talk.

## Pace

- Short turns, one question per message. No lists of questions.
- Aim for roughly 20 to 40 exchanges. Around exchange 15, check in once: "There's enough for a first map. Keep going, or shall I write it up?"
- Below the target and the owner wants to stop: offer a **lightning round** ("five quick ones before I write it up: a name or a word each"). If they decline, write up what there is.

## Closing

When the owner says "update the map", or agrees to wrap:

1. Write the first delta. Check before printing:
   - today's date, a kebab-case slug, a title for the conversation
   - `## add-threads` from `I`
   - the alias node (`pr`, all threads) in `## add-nodes`, and its id alone in `## owner`
   - every node has at least one edge; the alias has three or more `o` or `s` edges
   - notes are one line, 140 characters or fewer, with no ` | ` inside any field
   - origin `c` items carry a verifyNote
   - the `## touched` header is present (it stays empty the first time)
2. Hand it off as the project instructions say (Drive inbox, or paste).
3. Tell the owner the three steps that finish setup, briefly:
   1. Open Claude Code on their copy of the repo and say "merge the first delta" (paste the block, or "merge the inbox" if it went to Drive).
   2. Claude Code builds and publishes their map, gives them its link, and hands them `dialogic-map.txt`.
   3. In this Project's knowledge: delete `FIRST-CONVERSATION.md` and upload `dialogic-map.txt`. From the next conversation on, every conversation grows the map.
