---
name: learn
description: Learn from the current session. Analyzes corrections, patterns, and gotchas discovered during work to update skills and configuration.
allowed-tools: Agent, Read, Write, Edit, Glob, Grep
---

# /cs:learn - Learn From This Session

You are the learning agent for `claude-setup`. Your job is to analyze the current conversation and propose targeted updates to `.claude/` configuration based on what happened during this session.

## Step 1: Analyze Conversation

Review the entire conversation history, looking for 4 types of learnings:

### Type A: User Corrections
Patterns: "no not that", "instead do...", "don't...", "that's wrong because..."
These are the HIGHEST VALUE learnings - the user is telling you something non-inferable.

For each correction, extract:
- What was attempted
- What was wrong about it
- What the correct approach is
- WHY (if the user explained the reason)

### Type B: Discovered Gotchas
Things that went wrong because of missing context:
- Bugs caused by implicit dependencies
- Failed approaches due to non-obvious constraints
- Unexpected behavior from the codebase
- Environment-specific issues encountered

For each gotcha, extract:
- What triggered it
- What the root cause was
- How it was resolved
- Which part of the codebase it relates to

### Type C: Repeating Patterns
Things done multiple times in the session that suggest a pattern:
- Same type of file created in the same way
- Same commands run repeatedly
- Same approach applied to similar problems
- Consistent structure followed across changes

For each pattern, extract:
- What the pattern is (with concrete examples from this session)
- When it applies
- What makes it project-specific (vs generic knowledge)

### Type D: New Knowledge
Facts about the project learned during the session:
- How custom tooling works
- Business rules discovered in code
- Relationships between modules not documented elsewhere
- Environment setup requirements

## Step 2: Match to Configuration

For each learning found, determine where it belongs:

| Learning Type | Target |
|---|---|
| Correction about a skill's domain | Update existing skill (add gotcha) |
| Correction about general behavior | Update CLAUDE.md (add to Lessons) |
| Gotcha in a covered domain | Update existing skill |
| Gotcha in uncovered domain | Create new skill |
| Pattern that matches a skill | Update existing skill (add example) |
| Pattern in new domain | Create new skill |
| New knowledge about project | Update `.claude/docs/` |

## Step 3: Present Proposals

Present EACH proposal one at a time. User accepts or rejects each individually.

### For updating an existing skill:

```
LEARN: Add gotcha to skill [skill-name]

  From this session: [brief description of what happened]

  Proposed addition to .claude/skills/[skill-name]/SKILL.md:
  ---
  [the exact text to add, in context of where it goes in the file]
  ---

  Apply? (Y/n)
```

### For creating a new skill:

```
LEARN: Create new skill [skill-name]

  From this session: [what triggered this, with examples]

  Proposed .claude/skills/[skill-name]/SKILL.md:
  ---
  name: [name]
  description: [description with auto-invocation keywords]
  ---

  [skill content with gotchas, patterns, examples from this session]

  Create? (Y/n)
```

### For updating CLAUDE.md:

```
LEARN: Add lesson to CLAUDE.md

  From this session: [what happened]

  Proposed addition to Lessons section:
  ---
  ## [Context]
  **Trigger:** [what happened]
  **Rule:** [what to do differently, as if/then]
  **Example:** [concrete example]
  ---

  Apply? (Y/n)
```

### For updating docs:

```
LEARN: Update .claude/docs/[filename]

  From this session: [what was discovered]

  Proposed change:
  ---
  [the change]
  ---

  Apply? (Y/n)
```

## Rules

### Skill creation MUST follow Anthropic standard:
- Directory: `.claude/skills/[name]/`
- File: `SKILL.md` with YAML frontmatter (`name`, `description`)
- `name`: lowercase, hyphens only, max 64 chars
- `description`: specific keywords for when Claude should auto-invoke
- Content: non-inferable only. No generic knowledge.

### Skill editing:
- Use Edit tool for targeted changes (not full file rewrites)
- Add new content in appropriate section (gotchas with gotchas, patterns with patterns)
- Preserve existing content - append, don't replace

### Quality filters:
- Skip learnings that are generic (Claude already knows them)
- Skip learnings that are session-specific with no future value
- Skip learnings already captured in existing skills
- Combine related learnings into a single proposal

## Step 4: Summary

```
Learning complete:
  Analyzed: X corrections, Y gotchas, Z patterns
  Proposed: N changes
  Applied: M changes
  Skipped: K proposals

  Skills updated: [list]
  Skills created: [list]
  CLAUDE.md: [updated/unchanged]
  Docs: [updated/unchanged]
```
