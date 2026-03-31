---
description: "Manage git worktrees - create/remove worktrees, start/stop infrastructure, check status."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

# /df:worktree

Run the dev-env CLI script and interpret its output.

## Locate Script

```bash
SCRIPT=$(find ~/.claude/plugins -name "dev-env.sh" 2>/dev/null | head -1)
[ -z "$SCRIPT" ] && [ -f "plugins/devflow/scripts/dev-env.sh" ] && SCRIPT="plugins/devflow/scripts/dev-env.sh"
[ -z "$SCRIPT" ] && { echo "ERROR: Could not locate dev-env.sh. Is the df plugin installed?" >&2; exit 2; }
```

## Actions

Parse the user's request and map to an action:

| User says | Action | Command |
|---|---|---|
| `create <branch>` | Create worktree + start infra | `bash "$SCRIPT" create <branch>` |
| `remove <name>` | Remove worktree + stop infra | `bash "$SCRIPT" remove <name>` |
| `up <name>` | Start infrastructure | `bash "$SCRIPT" up <name>` |
| `down <name>` | Stop infrastructure | `bash "$SCRIPT" down <name>` |
| `status <name>` | Show worktree status | `bash "$SCRIPT" status <name>` |
| `list` or no args | List all worktrees | `bash "$SCRIPT" list` |
| `switch <name>` | Switch to worktree | `bash "$SCRIPT" switch <name>` |

## When Script Needs Help

- **`remove` returns HAS_WARNINGS=true** - show warnings to user and ask for confirmation. If confirmed, run with `FORCE=true` env var.
- **`up`/`down` says "No scripts.up defined"** or "NEEDS_CLAUDE=true" - the project doesn't have custom scripts. Help by detecting the project type and running appropriate commands.
- **Script fails** - diagnose from error output, suggest fixes.

## Prerequisites

The script reads `.dev-env.yml` from the project root. If missing, tell user:

> No `.dev-env.yml` found. Create one with project configuration:
> ```yaml
> name: my-project
> worktrees:
>   dir: .worktrees
> repos:
>   - path: ./api
>   - path: ./frontend
> ```

## Context Refresh After Create/Remove

After a successful `create`, inject this message into the conversation so the LLM updates its working context immediately (without waiting for next session start):

```
WORKTREE ACTIVE: <branch-name>
Edit files in .worktrees/<branch-name>/, not on main/master.
All repos: <list repos from .dev-env.yml or detected repos>
```

After a successful `remove`, inject:

```
WORKTREE CLOSED: <branch-name>
Worktree removed. Back to working on main branch.
```

This mirrors what session-guard.js injects at SessionStart - the LLM gets updated context mid-session without needing a restart.

## Multi-repo Awareness

The script automatically handles multiple repos listed in `.dev-env.yml`. When creating a worktree, it creates one in each repo that has the branch. When removing, it cleans up all repos.
