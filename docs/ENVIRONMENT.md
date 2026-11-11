# Cloud environment for Claude Code

Claude Code on the web runs each session in a cloud container set up by an *environment* (network rules, variables, a setup script). Environments belong to your claude.ai account. This repo needs very little: the scripts use only Node built-ins and the graph library is committed prebuilt.

Ask Claude Code in a session on this repo to "set up a cloud environment for this repo" and it will propose these settings for your approval, or enter them yourself in the environment settings:

- **Network:** limited, with package registries and MCP servers allowed (the Google Drive connector is an MCP server). No extra hosts: GitHub goes through the session's proxy and the fonts are inlined.
- **Secrets:** none.
- **Variables:** `CHROME=/usr/local/bin/chrome-nosandbox` (only for `tools/shot.mjs` layout screenshots).
- **Setup script:**

```bash
#!/bin/bash
# Dialogic needs no npm install: the scripts use only Node built-ins and
# vendor/graph-bundle.js is committed prebuilt.
# tools/shot.mjs (layout screenshots) needs a Chrome that runs as root.
if [ -x /opt/pw-browsers/chromium ]; then
  printf '#!/bin/sh\nexec /opt/pw-browsers/chromium --no-sandbox "$@"\n' > /usr/local/bin/chrome-nosandbox
  chmod +x /usr/local/bin/chrome-nosandbox
fi
node --version
```

The Artifact tool and the Google Drive connector are account connections, not environment settings: turn on Google Drive in claude.ai if you use the Drive inbox.
