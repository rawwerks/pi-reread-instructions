# Developing pi-reread-instructions

## Verify changes

Run the automated regression tests with:

```bash
bun test
```

`bun run check` is currently the same as `bun test`.

Inspect the npm package contents with:

```bash
bun run pack:dry-run
```

## Package smoke test

Use a clean temp agent dir so you test package installation rather than your existing local symlink setup:

```bash
TMP_AGENT_DIR="$(mktemp -d)/agent"
PI_CODING_AGENT_DIR="$TMP_AGENT_DIR" pi install /absolute/path/to/pi-reread-instructions
PI_CODING_AGENT_DIR="$TMP_AGENT_DIR" pi list
```

## Maintainer setup

This repo uses a repo-local pre-commit hook at `.githooks/pre-commit` that runs `gitleaks git --staged` to block secrets from being committed.

Enable it in this clone with:

```bash
git config --local core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

## Why this is separate from README

`README.md` is user-facing install/usage documentation for the extension.

Hook setup, package verification, and test workflow are maintainer-facing development concerns, so they live here instead of the README.
