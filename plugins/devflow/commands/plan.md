---
description: "Generate structured implementation plan from any input - text, ticket URL, OpenSpec change, or file."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

# /df:plan

Generate a structured implementation plan from any input source.

**Announce at start:** "I'm using the df:plan command."

## Step 0 - Run plan-prepare.js

```bash
SCRIPT=$(find ~/.claude/plugins -name "plan-prepare.js" 2>/dev/null | head -1)
[ -z "$SCRIPT" ] && [ -f "plugins/devflow/scripts/plan-prepare.js" ] && SCRIPT="plugins/devflow/scripts/plan-prepare.js"
[ -z "$SCRIPT" ] && { echo "ERROR: Could not locate plan-prepare.js. Is the df plugin installed?" >&2; exit 2; }

PLAN_DATA=$(mktemp /tmp/plan-prepare-XXXXXX.json)
node "$SCRIPT" $ARGUMENTS > "$PLAN_DATA"
EXIT_CODE=$?
echo "PLAN_DATA=$PLAN_DATA"
echo "EXIT_CODE=$EXIT_CODE"
```

On non-zero exit: show stderr message and stop.

## Step 1 - Load Source

Read `$PLAN_DATA` JSON. Based on `sourceType`:

| Type | Action |
|---|---|
| `conversation` | Use the current conversation context - user already described what to build |
| `text` | Use `source.text` as requirements |
| `file` | Use `source.content` as requirements (plan file, spec, etc.) |
| `ticket` | Fetch ticket via `jira` CLI or `gh issue view`. Use title + description as requirements |
| `url` | Fetch URL content. Use as requirements |

If `source.sourceError` is set, show it and stop.

If `project.openspecChange` is set, load the OpenSpec specs as additional context for the plan.

## Step 2 - Analyze and Plan

Explore the codebase to understand:
- Relevant files and modules
- Existing patterns and conventions
- Testing approach used

Then generate a structured plan:

```markdown
# Plan: <title>

**Source:** <source type and reference>
**Branch:** <current branch>
**Repos:** <repo list if multi-repo>

## Tasks

### Group 1: <name>
Depends on: none

- [ ] 1.1 <specific task with clear deliverable>
- [ ] 1.2 <specific task>

### Group 2: <name>
Depends on: Group 1

- [ ] 2.1 <specific task>
- [ ] 2.2 <specific task>

## Dependency Graph

Group 1 ──→ Group 2 ──→ Group 3
              ↗
Group 4 ────┘
```

## Plan Quality Rules

- Each task must have a **clear deliverable** (files to create/modify, behavior to implement)
- No vague tasks ("improve performance", "refactor code") - be specific
- Test tasks BEFORE implementation tasks in each group
- Dependency graph must be explicit - what runs parallel vs sequential
- If multi-repo, mark which repo each task targets

## Step 3 - Present and Confirm

Display the plan. Ask user:
- **approve** - save plan and optionally start execution
- **edit** - modify specific parts
- **cancel** - discard

On approve, save to `.devflow/plan-<branch>-<timestamp>.md`.

**Worktree check:** If `project.worktrees` shows the current branch is `main`, `master`, or `staging`, prompt:
```
You're on a protected branch. Start this work in an isolated worktree?

  /df:worktree create <suggested-branch-name>

This keeps main clean and lets you run infrastructure in isolation.
[y to create / n to continue on current branch]
```

Derive `<suggested-branch-name>` from the plan title (kebab-case, max 30 chars).

If user confirms: invoke `skill: "df:worktree", args: "create <branch-name>"`, then continue.

If user wants to execute immediately, invoke `/df:execute`.

## Arguments

| Flag | Description |
|---|---|
| `--from-file <path>` | Read requirements from file |
| `--from-url <url>` | Read requirements from URL |
| (positional) | Ticket ID, file path, URL, or text description |

## DO NOT

- Generate a plan without understanding the codebase first
- Create tasks without clear deliverables
- Skip the dependency graph
- Start implementation without user approval of the plan
