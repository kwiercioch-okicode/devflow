---
description: "Ship end-to-end: commit, review, PR in one flow. Thin orchestrator."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

# /df:ship

Ship end-to-end: commit, review, PR in one flow. Thin orchestrator that chains sub-commands sequentially.

**Announce at start:** "I'm using the df:ship command."

## Step 0 - Run ship-prepare.js

```bash
SCRIPT=$(find ~/.claude/plugins -name "ship-prepare.js" 2>/dev/null | head -1)
[ -z "$SCRIPT" ] && [ -f "plugins/devflow/scripts/ship-prepare.js" ] && SCRIPT="plugins/devflow/scripts/ship-prepare.js"
[ -z "$SCRIPT" ] && { echo "ERROR: Could not locate ship-prepare.js. Is the df plugin installed?" >&2; exit 2; }

SHIP_DATA=$(mktemp /tmp/ship-prepare-XXXXXX.json)
node "$SCRIPT" $ARGUMENTS > "$SHIP_DATA"
EXIT_CODE=$?
echo "SHIP_DATA=$SHIP_DATA"
echo "EXIT_CODE=$EXIT_CODE"
```

On non-zero exit: show stderr message and stop.

## Step 1 - Display Pipeline

Read `$SHIP_DATA` JSON. Display:

```
Ship Pipeline
=============
  Branch: <branch> -> <baseBranch>

| Step   | Status   | Reason                      | Args     |
|--------|----------|-----------------------------|----------|
| commit | will_run | 5 uncommitted files         | --auto   |
| review | will_run | code review                 | --committed |
| pr     | will_run | create pull request         | --draft  |

Warnings:
  - <any warnings>
```

If `context.onDefaultBranch` is true: show warning and stop. User needs a feature branch.

If any step is `blocked`: show reason and stop.

**If `--dry-run`:** display pipeline and stop. Clean up: `rm -f "$SHIP_DATA"`.

## Step 2 - Confirm

**If `--auto`:** proceed without asking.

**Otherwise:** ask user to confirm or cancel.

## Step 3 - Execute Pipeline

For each step with `status: "will_run"`, invoke the corresponding command via the Skill tool:

```
Step 1/3: Commit
  Invoking: /df:commit <args>
```

Invoke each command using the Skill tool:
- `skill: "df:commit", args: "<step.args>"`
- `skill: "df:review", args: "<step.args>"`
- `skill: "df:pr", args: "<step.args>"`

**Between review and pr:** read `.devflow/review-verdict.json`. If verdict is `CHANGES_REQUESTED`:
```
Review verdict: CHANGES REQUESTED (<critical> critical, <high> high)
Pipeline stopped. Fix findings and re-run /df:ship, or:
  1. Fix the issues
  2. /df:commit
  3. /df:ship --skip commit
```
Stop the pipeline. Do not create a PR.

If verdict is `APPROVED` or `APPROVED_WITH_NOTES`: continue to PR.

After each step, print result:
```
  [done] Step 1: committed a1b2c3d feat(auth): add PKCE flow
```

## Step 4 - Summary

```
Ship Pipeline Complete
======================
  commit: [done] a1b2c3d feat(auth): add PKCE flow
  review: [done] APPROVED WITH NOTES (2 medium)
  pr:     [done] https://github.com/.../pull/42

Deferred findings (2 medium):
  1. [medium] src/auth.ts:42 - Token in localStorage
  2. [medium] src/config.ts:10 - Hardcoded timeout
```

Clean up: `rm -f "$SHIP_DATA"`

## Arguments

| Flag | Description |
|---|---|
| `--skip step1,step2` | Skip specified steps (commit, review, pr) |
| `--auto` | Skip all confirmation prompts |
| `--dry-run` | Show pipeline plan without executing |
| `--draft` | Create PR as draft |

## DO NOT

- Skip steps marked `will_run` in the pipeline
- Create a PR when review verdict is CHANGES_REQUESTED
- Run steps in parallel - the pipeline is strictly sequential
- Invoke sub-commands via Agent tool - use the Skill tool
