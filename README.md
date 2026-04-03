# devflow

Claude Code plugin marketplace for SDLC automation and project configuration.

Two plugins in one marketplace:

- **df** (devflow) - SDLC workflow: plan, execute, commit, review, PR, version, ship. With guardrail hooks and worktree management.
- **cs** (setup) - Generate and maintain `.claude/` configuration from codebase analysis.

**Docs:** https://kwiercioch-okicode.github.io/devflow/

## Installation

### Via Claude Code UI

1. Open Claude Code and run `/plugin`
2. Go to **Marketplaces** -> **Add marketplace** -> enter `kwiercioch-okicode/devflow`
3. Go to **Discover**, select the plugin you want, then **Install**

### Command line

```
/plugin marketplace add kwiercioch-okicode/devflow
/plugin install df@devflow
/plugin install cs@devflow
```

## df plugin (devflow)

| Skill | Description |
|---|---|
| `/df:worktree` | Worktree management (create, remove, up, down, status) |
| `/df:plan` | Generate structured implementation plan from any input |
| `/df:execute` | Wave-based plan execution with dependency tracking |
| `/df:commit` | Smart commit with style detection |
| `/df:review` | Multi-dimension code review with prepare scripts |
| `/df:pr` | Auto-generated PR description |
| `/df:version` | Semantic versioning + changelog |
| `/df:ship` | Full SDLC pipeline: plan -> execute -> commit -> review -> PR. With ticket ID: Jira-driven automation |
| `/df:doctor` | Guardrails health check |
| `/df:jira` | Jira integration: fetch ticket, post plans/results, transition statuses |

### Jira-driven SDLC Pipeline

`/df:ship` supports fully autonomous, Jira-driven development:

```
Jira ticket (Backlog)
    |-- move to "Do realizacji" --> webhook fires
    |
    v
Claude: fetch ticket -> analyze -> plan -> post to Jira
    |
    v
Jira: "Plan do akceptacji" (human reviews plan)
    |-- move to "Zaakceptowany" --> webhook fires
    |
    v
Claude: worktree -> execute -> commit -> review -> PR -> post to Jira
    |
    v
Jira: "PR gotowy" (human merges)
```

**Components:**
- `jira-relay.js` - HTTP server receiving Jira webhooks, spawns `claude -p`
- Cloudflare Tunnel - exposes local relay to Jira Cloud
- Jira Automation - 2 rules sending webhooks on status transitions
- Plan template - structured comment with diagnosis, environment, tasks, E2E test plan

**Usage:** `jira-relay-start` (shell alias) starts tunnel + relay. Create ticket in Jira CA project, move to "Do realizacji".

### Guardrail Hooks

Five hooks (`plugins/devflow/hooks/hooks.json`) that enforce workflow rules without relying on LLM behavior:

| Hook | Event | Type | Description |
|---|---|---|---|
| `session-guard.js` | SessionStart | injection | Detects active worktrees and injects context |
| `branch-guard.js` | PreToolUse (Bash) | blocking | Blocks commits and pushes to main/master |
| `review-gate.js` | PreToolUse (Bash) | blocking | Blocks PR creation without review verdict |
| `test-first-guard.js` | PreToolUse (Edit/Write) | injection | Reminds to write failing test before production code |
| `openspec-guard.js` | PreToolUse (Edit/Write) | injection | Reminds to create OpenSpec proposal for behavioral changes |

### Prepare Scripts

Every skill that touches git has a JS prepare script that pre-computes data and returns JSON. The LLM never parses raw git output - scripts do the dirty work. Zero npm dependencies.

## cs plugin (setup)

| Command | Description |
|---|---|
| `/cs:init` | Generate `.claude/` configuration from codebase |
| `/cs:sync` | Synchronize config with current codebase state |
| `/cs:harvest` | Promote learnings from log to skills/rules/docs |
| `/cs:doctor` | Diagnose `.claude/` configuration health |

### Templates

`/cs:init` uses templates to generate project-specific skills:

| Template | Generated skill | Detects |
|---|---|---|
| `CLAUDE.md.template` | `CLAUDE.md` | Decision framework, code standards |
| `review-prompts/*.template` | `.claude/skills/review/prompts/` | Review dimensions |
| `git-workflow.md.template` | `.claude/skills/git-workflow/` | Multi-repo, pre-commit hooks, branch conventions |

## Design

See [design document](docs/plans/2026-03-29-devflow-plugin-design.md) for architecture decisions, skill details, and phased delivery plan.
