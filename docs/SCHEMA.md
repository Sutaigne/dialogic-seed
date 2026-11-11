# Graph schema — `data/dialogic.graph.json`

Canonical data. The viewer reads it; nothing else is the source of truth.

```jsonc
{
  "meta": {
    "title": "Dialogic",
    "version": "2.0.0",
    "updated": "2026-01-24",            // date of the latest conversation ("" on a blank map)
    "source": "data/src",
    "rootNode": "lantern",               // the owner's alias node, from data/src/owner.txt (null on a blank map)
    "latestConversation": { "date": "2026-01-24", "id": "clocks-and-crumb", "title": "Clocks and crumb" },
    "conversations": [ /* {date, id, title}, oldest first */ ]
  },
  "threads": [
    { "id": "I", "title": "Stars & navigation", "summary": "one line" }   // ids are Roman numerals, I upward
  ],
  "nodes": [
    {
      "id": "harrison",                // kebab-case, unique, stable
      "label": "John Harrison",        // display name
      "type": "person",                // theme | person | work | place | concept | project | paper | school
      "role": "other",                 // person only: author | artist | ruler | scholar | other
      "threads": ["I", "III"],         // >=1; first entry = primary cluster
      "note": "Clockmaker; spent decades on sea clocks that solved longitude.",  // ONE line, <=140 chars
      "verify": false,                 // true if any fact on this node is Claude's unconfirmed inference
      "verifyNote": ""                 // why, when verify is true
    }
  ],
  "edges": [
    {
      "id": "lantern>polaris:applies-to",
      "source": "lantern",
      "target": "polaris",
      "type": "applies-to",            // wrote | influenced | parallels | critiques | belongs-to | applies-to
      "origin": "owner",               // owner | claude | shared
      "basis": "conversation",         // conversation for everything a delta adds (index-d, cross-link, index are accepted for imported maps)
      "label": "first star learned",
      "verify": false,
      "verifyNote": ""
    }
  ],
  "log": [ /* the changelog, one entry per change */ ]
}
```

## Strength fields (generated, on every node and edge)
- `mentions`, `conversations`, `lastSeen`: totals from `mentions.txt`; `strength`, `score`, `weight` derive from them.
- `byConv`: conversation id -> mention count in that conversation, from `mentions.txt` (only counts > 0; `{}` when none, and for structural belongs-to edges).

## Fields (`field`, `subfield`; source `data/src/fields.txt`)
- Every non-theme node carries `field` and `subfield` (strings), or `null` when unclassified. Theme nodes are always `null`.
- `fields.txt` lines: `id | field | subfield`. `#` lines are comments. The file is optional; a missing file means every node is `null`.
- `field` must be one of the 13 top-level headings of Wikipedia:Contents/Categories, verbatim: General reference; Culture and the arts; Geography and places; Health and fitness; History and events; Human activities; Mathematics and logic; Natural and physical sciences; People and self; Philosophy and thinking; Religion and belief systems; Society and social sciences; Technology and applied sciences. (`WIKI_FIELDS` in `data/src/lib.mjs`.) `subfield` is free text.
- One primary field per node. Assigned by Claude Code by subject and maintained at merge time. These are inferred classifications, not the owner's statements.
- Wrong column count, empty field or subfield, a duplicate id, or an unknown field name is an error. An id that matches no node, or a node with no line, is only a validator warning (merges add nodes before they are classified). `fields.txt` is not part of the knowledge file.

## Rules
- **Theme nodes**: one per thread (`theme-i`, `theme-ii`, ...), type `theme`. Other nodes link to their thread's theme node with `belongs-to` edges (`basis: index`, `origin: shared`), generated, never written.
- **Root**: the owner's alias node, type `project`, named by the first delta's `## owner` section and stored in `data/src/owner.txt`. It cannot be removed; the alias changes through a `modify` of its label.
- **Origin**: `owner` = the owner said it; `claude` = Claude's inference the owner did not confirm (carries a verifyNote); `shared` = Claude offered it and the owner took it up.
- No invented facts. Anything that is Claude's inference, or any number or citation not independently certain, gets `verify: true` with a reason.
- Every edge's `source` and `target` must exist in `nodes`. No duplicate ids.
