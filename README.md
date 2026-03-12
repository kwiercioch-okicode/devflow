# claude-setup

Auto-generate and maintain `.claude/` configuration from your codebase.

Scans your project for **non-inferable details** - anomalies, domain rules, gotchas, and patterns that an AI agent can't discover by reading code alone - and generates tailored skills, agents, and review dimensions.

Based on [ETH Zurich research](https://www.infoq.com/news/2026/03/agents-context-file-value-review/) showing that generic context files degrade AI performance, while non-inferable details provide real value.

## Installation

### Via Claude Code UI

1. Launch Claude Code and run `/plugin`
2. Go to **Marketplaces → Add marketplace**
3. Enter `kwiercioch-okicode/claude-setup`
4. Go to **Discover**, select **claude-setup**, then **Install**

### Command line

```
/plugin marketplace add kwiercioch-okicode/claude-setup
/plugin install claude-setup@claude-setup
```

## Commands

### `/cs:init`

Generate complete `.claude/` configuration from codebase analysis.

```bash
/cs:init              # current directory
/cs:init ./my-project # specific path
```

**What it generates:**
- `CLAUDE.md` - behavioral decision framework (template-based)
- `.claude/docs/` - project context, domain model, tooling
- `.claude/skills/` - domain-specific skills with gotchas and patterns
- `.claude/agents/` - specialized agents (if needed)
- `.claude/skills/review/` - multi-dimension code review tailored to your stack

**What it does NOT generate:**
- Repository structure descriptions (agent discovers these)
- Tech stack overviews (agent reads config files)
- Generic best practices (agent already knows them)

**If `.claude/` already exists:** merges intelligently, proposing each change for your approval.

### `/cs:sync`

Synchronize configuration with current codebase state.

```bash
/cs:sync
```

Runs diagnostics (built-in doctor) and proposes targeted fixes:
- **Broken references** - skills referencing deleted files/symbols
- **Outdated gotchas** - workarounds for issues that were fixed
- **Drift** - code changed but skills didn't follow
- **Missing coverage** - new modules without skills
- **Quality issues** - skills that are too generic or duplicated

Each proposal presented one at a time for your approval. Stateless - no cache or sync state files.

### `/cs:learn`

Learn from the current conversation session.

```bash
/cs:learn
```

Analyzes the session for:
- **Corrections** - things the user told you to do differently
- **Gotchas** - bugs caused by missing context
- **Patterns** - recurring approaches that worked
- **New knowledge** - facts about the project discovered during work

Proposes updates to skills, CLAUDE.md, and docs. Each change requires your approval.

## Generated Review

`/cs:init` creates a `/review` skill with 6 base dimensions:

| Dimension | What it checks |
|---|---|
| security | Vulnerabilities adapted to your stack |
| tests | Coverage and quality for your test framework |
| architecture | Structural issues for your framework |
| performance | Bottlenecks specific to your stack |
| naming | Consistency with your project's conventions |
| error-handling | Missing/incorrect error handling patterns |

```bash
/review                    # review current branch changes
/review do staging         # compare against specific branch
/review last 3 commits     # natural language scope
```

Output: consolidated report with severity table and verdict.

Add custom dimensions by creating files in `.claude/skills/review/prompts/`.

## Ecosystem Detection

During `/cs:init`, the plugin detects installed tools and suggests missing ones:

```
 Installed: superpowers, playwright MCP
 Suggested: context7 (you have React+PHP, useful for library docs)
 Suggested: atlassian MCP (detected JIRA ticket IDs in commits)

Install context7? (Y/n)
```

Extend the registry with `.claude/setup-registry.json`:

```json
[
  {
    "name": "custom-mcp",
    "category": "Integrations",
    "detect": "grep -q 'custom-mcp' ~/.claude/settings.json",
    "suggest_when": "always",
    "install": "claude mcp add custom-mcp -- npx custom-mcp"
  }
]
```

## Architecture

```
/cs:init
  |
  +- [script] detect-stack.js (zero deps, reads config files)
  |
  +- [parallel agents] Deep scan (anomalies, domain, traps, patterns)
  |
  +- [agent] Ecosystem check
  |
  +- [agent] Compositor (combines findings into skills, docs, review)
  |
  +- [output] Summary + suggestions for manual additions
```

- Zero external dependencies (scripts use Node.js built-ins only)
- Intelligence lives in prompts, not scripts
- Scripts handle mechanical work only (file listing, JSON parsing)

## Philosophy

- **Non-inferable only** - don't tell AI what it can discover from code
- **Quality over quantity** - 3 excellent skills > 10 generic ones
- **User in control** - every change requires approval
- **Stateless sync** - no cache files, no state tracking
- **Simple over complete** - 3 commands, not 10

## License

MIT
