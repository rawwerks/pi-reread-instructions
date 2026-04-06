# pi-reread-instructions

Pi extension package that re-inserts `AGENTS.md` / `CLAUDE.md` into context every _N_ completed final assistant replies.

## Why

This was inspired by recent Claude Code leak analysis suggesting that `CLAUDE.md` is re-included during prompt assembly:

- [Claude Code Source Code Leak](https://superframeworks.com/articles/claude-code-source-code-leak)
- [How Claude Code Builds a System Prompt](https://www.dbreunig.com/2026/04/04/how-claude-code-builds-a-system-prompt.html)

If that helps Claude Code stay anchored to project instructions, it may be useful for pi too.

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

Install from npm:

```bash
pi install npm:pi-reread-instructions
```

Or install directly from the public GitHub repo:

```bash
pi install git:github.com/rawwerks/pi-reread-instructions
```

For a local checkout during development:

```bash
pi install /absolute/path/to/pi-reread-instructions
```

If you want a direct editable symlink instead of a package install:

```bash
cd /path/to/pi-reread-instructions
./install.sh
```

That creates this symlink:

```bash
~/.pi/agent/extensions/agents-reread.ts -> /path/to/pi-reread-instructions/agents-reread.ts
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
- The package is published on npm as `pi-reread-instructions`.
- The package exposes the extension through the `pi` manifest in `package.json`.
- Maintainer workflow lives in [DEVELOPING.md](./DEVELOPING.md).
