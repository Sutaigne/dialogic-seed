# Workflow — order of operations

One conversation, start to finish. Deltas go out through the Google Drive inbox (or a paste); the map comes back as a file the owner uploads to the Project by hand. Nothing runs on a timer: the merge side starts when the owner says "merge the inbox" or pastes a block.

```mermaid
flowchart TD
    subgraph CHAT["Chat side: claude.ai Project"]
        A0{"FIRST-CONVERSATION.md in knowledge<br/>and no dialogic-map.txt?"}
        A0 -- "yes" --> F1["First conversation:<br/>alias, seeds, threads<br/>(Claude leads if the owner is quiet)"]
        A0 -- "no" --> A["Ordinary conversation"]
        F1 --> B["Owner: 'update the map'"]
        A --> B
        B --> C["Chat prints the @delta block"]
        C --> D["Saved to Drive Dialogic/inbox,<br/>or the owner copies it"]
    end

    D --> E

    subgraph CODE["Merge side: Claude Code"]
        E["Owner: 'merge the inbox' / pastes"] --> G["Dry-run, show the owner the change list"]
        G -- "REFUSED" --> R["Report the errors.<br/>File stays in inbox."]
        G -- "clean" --> H["Merge, codify new nodes (fields.txt),<br/>generate, validate, test, build"]
        H --> I{"Artifact URL in SETTINGS.md?"}
        I -- "no (first run)" --> I1["Publish a new artifact,<br/>record its URL"]
        I -- "yes" --> I2["Republish to the same URL"]
        I1 --> J["Move the delta to Dialogic/merged,<br/>commit, push"]
        I2 --> J
    end

    R -. "chat fixes the block, saves it as -r2" .-> D

    J --> K["Claude Code hands the owner dialogic-map.txt"]
    K --> L["Owner replaces dialogic-map.txt in the Project<br/>(first run: and deletes FIRST-CONVERSATION.md)"]
    L --> A0
```

## The owner's touch points per conversation

**"update the map"**, **"merge the inbox"** (or paste), replace `dialogic-map.txt` in the Project.

## Notes

- Several conversations can pile up in the inbox before a merge. They are merged oldest first, each with its own dry-run; build, publish and commit happen once at the end.
- A corrected block is a new file with `-r2` (then `-r3`) before `.delta.txt`. The highest number wins.
- The map never travels through Drive: Drive's text reader truncates long files and Markdown-escapes `#`, `>` and `~`, which would corrupt ids. The chat side reads the map only from project knowledge.
- The Project's instructions field is pasted by hand from `chat/PROJECT-INSTRUCTIONS.md`; `docs/DELTA-FORMAT.md` is re-uploaded only when it changes.

Details: the run itself is in `CLAUDE.md`; the delta contract is `docs/DELTA-FORMAT.md`; the upload is `docs/KNOWLEDGE-HANDOFF.md`.
