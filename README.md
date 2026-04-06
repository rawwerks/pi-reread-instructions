# pi-reread-agents-md

Standalone pi extension that re-inserts `AGENTS.md` / `CLAUDE.md` into model context every _N_ completed agent turns, without modifying the pi upstream repo.

## Behavior

- Default interval: `3`
- Configurable via `PI_AGENTS_REREAD_EVERY`
- Counts completed assistant turns, not top-level prompts
- If the threshold is hit on a tool-using turn, the refresh is injected before the next provider request in the same agent run
- Searches for context files in:
  - `~/.pi/agent/AGENTS.md` or `CLAUDE.md`
  - the current project and its ancestor directories
- Writes proof markers into the session JSONL as custom entries:
  - `agents-reread-delivery`
  - `agents-reread-payload-proof`

## Install

```bash
cd ~/Documents/GitHub
# after cloning this repo
~/Documents/GitHub/pi-reread-agents-md/install.sh
```

That creates this symlink:

```bash
~/.pi/agent/extensions/agents-reread.ts -> ~/Documents/GitHub/pi-reread-agents-md/agents-reread.ts
```

## Configuration

```bash
export PI_AGENTS_REREAD_EVERY=3
```

Set it to any positive integer. `0` or a negative number disables the refresh.

## Session-log proof

When a refresh is injected, the extension records custom entries in the session JSONL. You can inspect them with:

```bash
rg -n 'agents-reread-(delivery|payload-proof)' ~/.pi/agent/sessions
```

## Notes

- This repo is intentionally standalone and uses only Node built-ins.
- The extension does not require editing or vendoring pi upstream.
