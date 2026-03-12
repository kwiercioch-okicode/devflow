---
name: sync
description: Synchronize .claude/ configuration with current codebase. Detects drift, broken references, and missing coverage.
allowed-tools: Agent, Bash, Read, Write, Edit, Glob, Grep
---

# /cs:sync - Synchronize Configuration

You are the orchestrator for `claude-setup` synchronization. Your job is to compare the existing `.claude/` configuration against the current state of the codebase and propose targeted updates.

**This command is STATELESS** - no cache, no sync timestamps. You compare skills directly against code every time.

## Step 1: Read Current Configuration

Read all existing configuration:

```bash
# List all skills
find .claude/skills/ -name "SKILL.md" 2>/dev/null
# List all docs
find .claude/docs/ -name "*.md" 2>/dev/null
# List all agents
find .claude/agents/ -name "*.md" 2>/dev/null
# Read CLAUDE.md
cat CLAUDE.md 2>/dev/null
```

Read each file to understand what the current configuration claims about the project.

## Step 2: Diagnostics (Built-in Doctor)

Launch parallel agents to check 4 dimensions:

### Agent A: Broken References
For each skill and doc file, check:
- File paths mentioned in skills - do they still exist?
- Class/function names referenced - are they still in the code?
- Configuration values cited - do they match current configs?
- Commands documented - do they still work?

Output: list of broken references with file and line.

### Agent B: Drift Detection
Compare what skills describe vs what the code actually does:
- Has the pattern described in a skill changed in the code?
- Are there new modules/directories not covered by any skill?
- Have deleted modules left orphaned skills?
- Has the tech stack changed (new dependencies, removed dependencies)?

Output: list of drifts with before/after description.

### Agent C: Quality Check
Evaluate skill quality against research-backed criteria:
- Does the skill contain non-inferable information, or just generic knowledge?
- Is the skill specific enough (concrete examples) or too vague ("best practices")?
- Does the CLAUDE.md contain unnecessary architecture/structure descriptions?
- Are there duplicate skills covering the same domain?

Output: list of quality issues with suggested improvements.

### Agent D: Gotcha Validation
For each gotcha/workaround documented in skills:
- Is the workaround still present in the code?
- Has the underlying issue been fixed (making the gotcha obsolete)?
- Are there new workarounds in the code not captured in any skill?

Search for: TODO, HACK, FIXME, WORKAROUND, XXX comments that aren't in any skill.

Output: list of obsolete gotchas + new undocumented gotchas.

## Step 3: Present Proposals

Combine all findings into a prioritized list. Present EACH proposal one at a time to the user for acceptance:

### Format for each proposal:

```
[CATEGORY] description

  File: path/to/affected/skill.md
  Issue: what's wrong
  Proposed fix: what to change

  Apply? (Y/n)
```

Categories (in priority order):
1. **BROKEN** - references to non-existent files/symbols (fix immediately)
2. **OUTDATED** - gotchas for issues that were fixed (remove or update)
3. **DRIFT** - code changed but skill didn't follow (update skill)
4. **MISSING** - new code areas without skill coverage (create skill)
5. **QUALITY** - skill exists but is too generic or duplicated (improve)

### Rules for proposals:
- One proposal at a time, wait for user response
- If user rejects, move to next without arguing
- Creating new skills MUST follow Anthropic standard (SKILL.md + frontmatter)
- Editing existing skills uses Edit tool (targeted changes, not full rewrites)
- Never delete a skill without user confirmation

## Step 4: Apply Changes

For each accepted proposal:
- Edit existing files with surgical changes (Edit tool)
- Create new skills with proper structure
- Remove obsolete content
- Update CLAUDE.md generated section if needed

## Step 5: Summary

After all proposals are processed:
```
Sync complete:
  Applied: X changes
  Skipped: Y proposals

  Skills: A created, B updated, C unchanged
  Docs: D updated
  CLAUDE.md: [updated/unchanged]
```
