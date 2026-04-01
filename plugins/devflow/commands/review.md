---
description: "Multi-dimension code review with prepare scripts and parallel dimension agents."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent, LSP]
---

# /df:review

Thin dispatcher - runs review-prepare.js, then delegates to review-orchestrator agent.

**Announce at start:** "I'm using the df:review command."

## Step 0 - Run review-prepare.js

> **VERBATIM** - Run this bash block exactly as written. Do not modify the commands.

```bash
SCRIPT=$(find ~/.claude/plugins -name "review-prepare.js" 2>/dev/null | head -1)
[ -z "$SCRIPT" ] && [ -f "plugins/devflow/scripts/review-prepare.js" ] && SCRIPT="plugins/devflow/scripts/review-prepare.js"
[ -z "$SCRIPT" ] && { echo "ERROR: Could not locate review-prepare.js. Is the df plugin installed?" >&2; exit 2; }

MANIFEST_FILE=$(mktemp /tmp/review-manifest-XXXXXX.json)
node "$SCRIPT" $ARGUMENTS --json > "$MANIFEST_FILE"
EXIT_CODE=$?
echo "MANIFEST_FILE=$MANIFEST_FILE"
echo "EXIT_CODE=$EXIT_CODE"
```

On non-zero exit: show stderr message and stop.

**Do NOT read the manifest file into the main context.** The orchestrator will read it.

## Step 1 - Dry Run Check

Only if `--dry-run` was passed:

Read the manifest file and display a summary table:
```
Review Plan (dry run - no agents dispatched)

  Base branch:    <base>
  Changed files:  <count>
  Dimensions:     <active> active, <skipped> skipped

| Dimension | Files | Status |
|-----------|-------|--------|
| security  | 5     | active |
| tests     | 3     | active |
| naming    | 0     | skipped |

Uncovered files: <list or "none">
Over-broad dimensions: <list or "none">
```

Clean up: `rm -f "$MANIFEST_FILE"`. Stop here.

## Step 2 - Spawn Orchestrator

Locate the review-orchestrator agent: Glob for `**/agents/review-orchestrator.md` in `~/.claude/plugins` and current directory.

Spawn a single Agent with the orchestrator's content as prompt, appending:
```
MANIFEST_FILE: <the temp file path from Step 0>
```

The orchestrator handles everything from here: reading the manifest, dispatching dimension agents in parallel, collecting findings, writing verdict JSON.

## Arguments

| Flag | Description |
|---|---|
| `--base <branch>` | Base branch for comparison (default: auto-detect) |
| `--committed` | Review committed changes vs base (default) |
| `--staged` | Review staged changes only |
| `--working` | Review unstaged working changes |
| `--dimensions <a,b,c>` | Review only specified dimensions |
| `--dry-run` | Show review plan without dispatching agents |

## Dimension Discovery

The prepare script discovers dimensions from the project's `.claude/` config:
1. `.claude/review-dimensions/*.md`
2. `.claude/skills/review/prompts/*.md`

If no dimensions found, the review cannot run. Tell the user to create dimension files or run `/cs:init` to generate them.

## DO NOT

- Read the manifest file content into the main conversation context
- Run dimension reviews yourself - the orchestrator agent handles that
- Skip the prepare script and parse git output directly
