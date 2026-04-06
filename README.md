# pi-reread-agents-md

Standalone pi extension that re-inserts `AGENTS.md` / `CLAUDE.md` into context every _N_ completed final agent replies, without modifying the pi upstream repo.

## Behavior

- Default interval: `3`
- Configurable via `PI_AGENTS_REREAD_EVERY`
- Counts only assistant messages with `stopReason: "stop"`
- Tool-use substeps do not increment the counter
- Reinsertion happens after the matching final assistant reply and before the next user message
- Searches for context files in:
  - `~/.pi/agent/AGENTS.md` or `CLAUDE.md`
  - the current project and its ancestor directories
- Writes proof markers into the session JSONL as custom entries:
  - `agents-reread-delivery`
  - `agents-reread-payload-proof`
- Appends a hidden custom message of type `agents-reread-context` when it injects a refresh

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

Set the default interval with an environment variable:

```bash
export PI_AGENTS_REREAD_EVERY=3
```

The extension also accepts `AGENTS_REREAD_EVERY` as a fallback.

Set it to any positive integer. `0` or a negative number disables the refresh.

## Slash command

The extension registers:

```text
/agents-reread
/agents-reread status
/agents-reread off
/agents-reread default
/agents-reread <positive-integer>
```

Notes:
- `/agents-reread` without args shows status
- `/agents-reread <positive-integer>` changes the interval for the current session
- `/agents-reread off` disables refreshes for the current session
- `/agents-reread default` resets the current session back to the env/default interval

## Session-log proof

When a refresh is injected, the extension records custom entries in the session JSONL. You can inspect them with:

```bash
rg -n 'agents-reread-(delivery|payload-proof)|agents-reread-context' ~/.pi/agent/sessions
```

## Notes

- This repo is intentionally standalone and uses only Node built-ins.
- The extension does not require editing or vendoring pi upstream.
