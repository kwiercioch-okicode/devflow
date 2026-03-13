---
description: "Generate .claude/ configuration from codebase analysis. Creates CLAUDE.md, skills, agents, and review dimensions."
---

# /cs:init - Generate .claude/ Configuration

You are the orchestrator for `claude-setup` initialization. Your job is to generate a complete `.claude/` configuration tailored to this specific project. Focus on NON-INFERABLE details only - things an AI agent cannot discover by reading the code itself.

**Do NOT generate:**
- Repository structure descriptions (agent will discover these)
- Tech stack overviews (agent will read config files)
- Generic best practices (agent already knows them)

**DO generate:**
- Anomalies, workarounds, and non-standard patterns
- Domain-specific business rules and workflows
- Gotchas, implicit dependencies, magic values
- Repeating project-specific patterns that should be skills
- Review dimensions tailored to the detected stack

## Step 1: Quick Scan (Script)

Run the stack detection script to get a zero-cost project profile:

```bash
node ${CLAUDE_SKILL_DIR}/../scripts/detect-stack.js $ARGUMENTS
```

Read the output carefully. This tells you what stack you're working with.

## Step 2: Check Existing Configuration

Check if `.claude/` already exists in the project:

```bash
ls -la .claude/ 2>/dev/null
ls -la .claude/skills/ 2>/dev/null
ls -la .claude/docs/ 2>/dev/null
ls -la CLAUDE.md 2>/dev/null
```

**If `.claude/` exists:** Switch to MERGE MODE.
- Read all existing skills, CLAUDE.md, docs
- Generate new configuration as proposals
- For each conflict, ask the user: "Your existing [X] vs my generated [X] - which to keep, or merge?"
- Never overwrite without confirmation

**If `.claude/` does not exist:** Proceed with full generation.

## Step 3: CLAUDE.md Behavioral Framework

Read the template from `${CLAUDE_SKILL_DIR}/../templates/CLAUDE.md.template`.

**If CLAUDE.md does not exist:** Write the template to the project root as `CLAUDE.md`.

**If CLAUDE.md already exists (MERGE MODE):**
- Compare the existing CLAUDE.md against the template section by section
- Identify missing framework sections (Decision Framework, Planning, Verification, Subagents, Code Standards, Lessons)
- For each missing section, propose adding it: "Your CLAUDE.md is missing [section]. Add it? (Y/n)"
- Preserve all existing project-specific content (OpenSpec blocks, custom rules, etc.)
- Do NOT replace existing sections that already cover the same topic - only add what's missing

## Step 4: Deep Scan with Parallel Agents

Launch 4 agents IN PARALLEL. Each agent has a specific mission:

### Agent 1: "What is non-standard?"
Search for anomalies, workarounds, and surprising patterns:
- Comments containing TODO, HACK, FIXME, WORKAROUND, XXX
- Unusual file structures or naming that deviates from framework conventions
- Legacy code patterns mixed with modern ones
- Custom abstractions that wrap standard library features
- Configuration that overrides framework defaults

Output: list of anomalies with file paths and explanations.

### Agent 2: "What are the domain rules?"
Search for business logic and domain knowledge:
- Entity names, value objects, aggregates
- Validation rules, state machines, workflows
- Domain-specific terminology (especially where code names differ from user-facing names)
- Business constraints encoded in code
- Authorization rules and access patterns

Output: domain model summary with rules and constraints.

### Agent 3: "What are the traps?"
Search for things that would trip up an AI agent:
- Implicit dependencies between modules
- Magic values, hardcoded constants with non-obvious meaning
- Custom tooling and build commands
- Environment-specific behavior
- Files that look standard but have custom behavior
- Test setup that requires specific infrastructure (Docker, databases, external services)

Output: list of traps with severity and mitigation.

### Agent 4: "What patterns repeat?"
Search for recurring implementation patterns:
- How handlers/controllers are structured
- How components are organized
- How tests are written (fixtures, assertions, mocking patterns)
- How errors are handled
- How data flows through the system
- API endpoint patterns

Output: list of patterns with 2-3 concrete examples each.

## Step 5: Ecosystem Check

Check what tools and plugins are already installed:

```bash
# Check Claude Code plugins
ls ~/.claude/plugins/ 2>/dev/null
# Check MCP servers in settings
cat ~/.claude/settings.json 2>/dev/null | grep -o '"[^"]*"' | head -20
# Check CLI tools
which gh docker kubectl terraform 2>/dev/null
```

Compare against the known tool registry:

| Tool | Category | Detect | Suggest When |
|------|----------|--------|-------------|
| superpowers | Productivity | ~/.claude/plugins/superpowers | always |
| playwright | Testing | @playwright/test in package.json OR MCP | has E2E tests or frontend |
| context7 | Context | MCP server list | has dependencies with complex APIs |
| atlassian | Integrations | MCP server list | JIRA ticket IDs in commits |
| github CLI | Integrations | `which gh` | always for git projects |

For each suggested tool not yet installed, ask: "Install [tool]? It would help with [reason]. (Y/n)"

If the user confirms, provide the installation command.

## Step 6: Generate Output

Using the combined results from all agents, generate:

### 6a. `.claude/docs/` - Project Context
Create concise docs files:
- `project-context.md` - stack profile, key directories, custom tooling
- `domain-model.md` - entities, rules, workflows (from Agent 2)
- `tooling.md` - build commands, test commands, dev setup, installed tools

### 6b. `.claude/skills/` - Domain Skills
For each significant pattern or domain area discovered, create a skill:
- Follow Anthropic standard: `skills/skill-name/SKILL.md` with YAML frontmatter
- `name`: lowercase, hyphens, max 64 chars
- `description`: keywords for auto-invocation - WHEN to use this skill
- Content: gotchas, rules, concrete examples from THIS project
- Do NOT create skills for things Claude already knows (generic React, generic PHP)
- Each skill must contain at least one project-specific gotcha or pattern

### 6c. `.claude/agents/` - Specialized Agents
Create agents only if the project genuinely needs them (e.g., separate frontend/backend repos, complex deployment).

### 6d. `.claude/skills/review/` - Review Skill
Generate the multi-dimension review skill with 6 base dimensions adapted to the detected stack:

Create `skills/review/SKILL.md` as the orchestrator that:
- Dispatches parallel agents for each dimension
- Collects findings with severity levels (critical/high/medium/low/info)
- Produces a consolidated report with verdict

Create `skills/review/prompts/` with one file per dimension:
- `security.md` - adapted to stack (e.g., SQL injection for PHP, XSS for React)
- `tests.md` - adapted to testing tools found (PHPUnit patterns, Jest patterns)
- `architecture.md` - adapted to framework conventions
- `performance.md` - adapted to stack bottlenecks (N+1 for SQL, re-renders for React)
- `naming.md` - adapted to conventions found in code
- `error-handling.md` - adapted to error patterns in the project

### 6e. Update CLAUDE.md
Add project-specific content between the `<!-- GENERATED -->` markers:
- Links to `.claude/docs/` files
- Non-inferable details discovered by agents
- Custom build/test/deploy commands
- Integration notes for detected tools

## Step 7: Summary

Present to the user:
1. What was generated (list all files created/modified)
2. Suggestions for manual additions:
   - "Add legacy constraints that aren't visible in code"
   - "Add business rules only you know"
   - "Add custom environment setup instructions"
   - "Add any 'don't touch X because Y' rules"
3. If in merge mode: summary of what was kept, replaced, or merged

**Remember: quality over quantity. 3 excellent skills beat 10 mediocre ones.**
