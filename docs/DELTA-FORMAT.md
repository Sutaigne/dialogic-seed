# Map delta format (v1.3)

The contract between the chat project (which writes deltas) and Claude Code (which merges them).
Source of truth: `data/src/`. Everything else is generated.

**New in v1.3:** `modify` and `reverse` take a thread ref (the Roman numeral) with the fields `title` and `summary`, so a thread can be renamed through a delta and the change is logged.

**In the chat project** the three map files arrive as one generated file, `dialogic-map.txt`, with `==== threads.txt ====`, `==== nodes.txt ====` and `==== edges.txt ====` sections holding each file verbatim. Claude Code regenerates it (`data/knowledge/dialogic-map.txt`) after every merge. Before the first merge there is no `dialogic-map.txt`: the map is blank, and the first delta builds it from nothing (see **The first delta** below).

## Files in `data/src/`

| File | Holds | Who edits |
|---|---|---|
| `threads.txt` | `id | title | summary`, one per line. Ids are Roman numerals (I, II, … IX, X …). | merge tool |
| `nodes.txt` | `id | label | type[:role] | threads | note | verifyNote` | merge tool |
| `edges.txt` | `source > target | etype | origin | label | verifyNote`, under `## index-d`, `## cross-link`, `## index`, `## conversation` headers (header = basis) | merge tool |
| `conversations.txt` | `date | id | title`, one per merged conversation | merge tool (append only) |
| `mentions.txt` | `date | conversation | ref | count` — the engagement ledger strength is computed from | merge tool (append only) |
| `changelog.txt` | `date | action | target | before | after | reason | trigger | source` | merge tool (append only) |
| `changelog.lock` | sha256 + line count of `changelog.txt` at last merge, to catch hand edits | merge tool |
| `owner.txt` | the owner's root node id, written once by the first delta's `## owner` section | merge tool (once) |

Empty field = `-` or nothing. A field may not contain ` | `.
`verifyNote` starting with `~` is an informational note, not a verify flag. Any other non-empty verifyNote sets `verify: true`.

### Codes
- **Node type**: `pe` person · `wo` work · `co` concept · `pl` place · `pa` research paper · `pr` project (the owner's own; the owner's alias node is also `pr`) · `sch` school / movement / category. Themes come from `threads.txt` only.
- **Role** (persons): `au` author · `ar` artist · `ru` ruler · `sc` scholar · `ot` other. Written `pe:au`.
- **Edge type**: `w` wrote · `i` influenced · `p` parallels · `c` critiques · `a` applies-to · (`b` belongs-to is generated from node threads, never written).
- **Origin**: `o` the owner drew it · `c` Claude proposed it · `s` built together (Claude offered it and the owner took it up).
- Full names (`person`, `parallels`, `owner`) are accepted anywhere a code is.

### Refs
- A **node ref** is its id: `wild-yeast`.
- An **edge ref** is `source > target : etype`: `kitchen-as-lab > sourdough : a`. Source, target and type identify an edge; there is at most one edge per triple.
- A **thread ref** is its Roman numeral: `III`. Only `modify` and `reverse` take one. Everywhere else a thread is addressed through its theme node, `theme-iii` (`touched`, `reweight`). A thread cannot be removed.

## The delta block

One fenced block per conversation. Sections may be omitted when empty, except `## touched`.

```
@delta 2026-02-07 | night-sky-bread | Night sky and bread

## add-threads
IV | Music & time | Practice, repetition and variation in music. | Owner opened a new line of thought on music | new-connection

## add-nodes
goldberg-variations | Goldberg Variations | wo | IV,III | Bach's aria with thirty variations; the owner's long practice piece. | - | Owner named it as the piece they practise | reading

## add-edges
goldberg-variations > slow-craft | p | o | thirty variations, one patience | - | Owner: practising it is slow craft in sound | new-connection
sennett > harrison | i | c | - | Claude's link from Sennett's craftsman to Harrison; owner didn't confirm | Claude proposal, unconfirmed | argument

## modify
wild-yeast | note | Yeast caught from flour and air; the owner's starter is three years old. | Owner gave the starter's age | new-connection
kitchen-as-lab > sourdough : a | label | proving ground | Owner reframed the relation | argument
III | title | Slow work | Owner asked for plain thread names | new-connection

## remove
polaris > sobel-longitude : p | Owner dropped this as a reach | change-of-mind

## reverse
sourdough | note | Bread leavened by a starter; its flavour comes from time more than from the recipe. | Sourdough is a recipe to perfect | Owner accepted the correction | correction

## reweight
sennett | 2 | Owner: "Sennett is the one I'd keep if I could keep one"

## touched
wild-yeast | 3
open-crumb | 1
kitchen-as-lab > sourdough : a | 2
sourdough | 1
```

### Section rules
- **owner**: one line, the id of the owner's alias node. Only in the first delta (see below); refused once the map has an owner. To change the alias later, `modify` that node's `label`.
- **add-threads**: `id | title | summary | reason | trigger`. Id = the next Roman numeral after the highest one in the threads section of `dialogic-map.txt`; an id already taken is refused. Creates the theme node `theme-<lowercase numeral>`.
- **add-nodes**: `id | label | type | threads | note | verifyNote | reason | trigger`. Id must be new (check the nodes section first; an existing id is refused), kebab-case. Note ≤ 140 chars, one line.
- **add-edges**: `source > target | etype | origin | label | verifyNote | reason | trigger`. Both ends must exist (or be added in the same delta). Lands under `## conversation`.
- **modify**: `ref | field | after | reason | trigger`. Node fields: `label type threads note verifyNote`. Edge fields: `label origin type verifyNote`. Thread fields: `title summary` (neither may be empty). The merge tool records `before` itself from the files. A thread change is logged against its theme node (`theme-iii`), whose label and note are rebuilt from the thread line, so they always match.
- **remove**: `ref | reason | trigger`. Removing a node also removes its edges, each logged.
- **reverse**: `ref | field | after | earlier position | reason [| trigger]`. Like modify, logged as `reversed` with the earlier position named. Trigger defaults to `change-of-mind`.
- **reweight**: `ref | factor | reason [| trigger]` (trigger defaults to `argument`). Only when the owner says outright that something matters more or less. Factor multiplies strength score; latest reweight wins; `1` resets.
- **touched**: `ref | count`. If the delta changes an edge type, use the new type here. Every existing node or edge that came up with real engagement, including everything modified. A thread rename is the exception: it is housekeeping and needs no line here; list `theme-<numeral>` only if the thread itself was discussed. Count = substantive mentions in this conversation. New items need not be listed; they get 1 automatically.
- **Ignored sections**: `## changelog`, `## log` and `## verify` are skipped with a warning. The tool writes the log itself, and verify comes from verifyNote fields.
- **Trigger** is one of: `new-connection` · `reading` · `argument` · `change-of-mind` · `correction`.
- Items that are Claude's inference rather than the owner's statement: a non-empty verifyNote giving the reason; edges also carry origin `c`. Nodes have no origin field, so for nodes the verifyNote alone carries the flag.

## The first delta

The map starts blank: no threads, no nodes, no owner. The first conversation's delta builds all of it, and must:

- add the threads it uses, starting at `I`;
- add one node for the owner's alias: kebab-case id, type `pr`, every thread the conversation opened, a note saying it is the owner's alias and the map's root;
- name that node in a `## owner` section (the merge tool refuses a first delta without one, writes `data/src/owner.txt`, and the viewer centres the map on it);
- keep the `## touched` header even though it is empty (everything is new; new items get 1 automatically).

```
@delta 2026-01-10 | first-light | First light

## add-threads
I | Stars & navigation | Finding position: the pole star, longitude and the clocks that solved it. | Owner's first topic | new-connection

## add-nodes
lantern | Lantern | pr | I | The owner's alias and the root of this map. | - | Owner chose the alias Lantern | new-connection
polaris | Polaris | co | I | The pole star; the fixed point for finding latitude in the north. | - | Owner: the first star they learned to find | new-connection

## add-edges
lantern > polaris | a | o | first star learned | - | Owner's own story | new-connection

## owner
lantern

## touched
```

A full first delta from a made-up conversation is in `data/test/fixture-deltas/2026-01-10-first-light.delta.txt`.

## What the merge tool does

`node data/src/merge-delta.mjs <delta-file> [--dry-run] [--force]`

1. Parses the whole block and checks every ref, id, code and field **before writing anything**. Any error → nothing written, all errors listed.
2. Refuses a first delta (blank map) without `## owner`, and any later `## owner`.
3. Refuses a delta whose `date | conversation` is already in `mentions.txt` (prevents double counting), unless `--force`.
4. Refuses if `changelog.txt` no longer matches `changelog.lock` (a past entry was edited).
5. Applies adds, modifies, removes and reverses to `threads.txt`, `nodes.txt`, `edges.txt`.
6. Appends `mentions.txt` (touched + 1 for each new item) and `changelog.txt` (one entry per change, `before` taken from the files, `source` = `<date> <conversation>`). Updates the lock.
7. Archives the delta to `data/deltas/<date>-<conversation>.delta.txt`.
8. Runs the generator and the validator, prints a summary.

## Strength (computed by the generator, never set by hand)

For every node and non-structural edge, from `mentions.txt`:

- Each conversation that touched it contributes `1 + ln(count)`, so a second conversation outweighs extra mentions inside one tangent.
- Each contribution is decayed by recency: `w = 0.3 + 0.7 × 0.5^(age / 180 days)`, where age runs from that conversation to the **latest conversation in the ledger** (not the wall clock, so builds are reproducible). Old ideas fade toward 30%, never to zero.
- `score = reweight × Σ w × contribution`, then `strength = 1 − e^(−score / 2)` (0 to 1).
- Output per item: `strength`, `score`, `mentions`, `conversations`, `lastSeen`, `weight`.
