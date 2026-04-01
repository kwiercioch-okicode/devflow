---
description: "Generate structured implementation plan from any input - text, ticket URL, OpenSpec change, or file."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent, LSP]
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
| `ticket` | Invoke `skill: "df:jira", args: "fetch <TICKET-ID>"` to get title, description, and acceptance criteria |
| `url` | Fetch URL content. Use as requirements |

If `source.sourceError` is set, show it and stop.

If `project.openspecChange` is set, load the OpenSpec specs as additional context for the plan.

## Step 2 - Analyze and Plan

Explore the codebase to understand:
- Relevant files and modules (use **LSP goToDefinition/findReferences** for symbols, Grep for strings/config)
- Existing patterns and conventions (read 1-2 examples of similar code)
- Testing approach used (find existing test files for the same module)

Then generate a structured plan:

```markdown
# Plan: <title>

**Source:** <source type and reference>
**Branch:** <current branch>
**Repos:** <repo list if multi-repo>

## Tasks

### Group 1: <name> [sonnet]
Depends on: none

- [ ] 1.1 Write test: <failing test for expected behavior>
- [ ] 1.2 Implement: <specific task with clear deliverable> (`path/to/file.ts`)
- [ ] 1.3 Verify tests pass

### Group 2: <name> [opus]
Depends on: Group 1

- [ ] 2.1 Write test: <failing test>
- [ ] 2.2 Implement: <specific task> (`path/to/file.ts`)
- [ ] 2.3 Verify tests pass

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
- **Max 2-3 files per group.** If a group would touch 4+ files, split it. One file + its test = ideal group size.
- **Tag complexity** on each group: `[sonnet]` (default - pattern-based, CRUD, simple test) or `[opus]` (architecture, complex refactor, cross-cutting). df:execute uses this for model selection.

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
