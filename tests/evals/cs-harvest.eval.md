---
name: cs-harvest
description: Tests /cs:harvest - promotes ACTIVE learnings from log to skills/rules/docs
command: /cs:harvest
---

# /cs:harvest Eval Scenarios

## Scenario 1: Empty log - stops early

### Setup

`.claude/learnings/log.md` does not exist.

### Expected behavior

- Reports: "Nothing to harvest - .claude/learnings/log.md not found."
- Stops immediately, no further action

### Pass criteria

- [ ] Stops without error
- [ ] Clear message that log is missing
- [ ] No files modified


## Scenario 2: Below threshold - stops early

### Setup

`.claude/learnings/log.md` exists with 2 ACTIVE entries.

```markdown
## 2026-03-01 - example learning
**Status:** ACTIVE
**Skill:** selected-photos
**Context:** testing
**Learning:** something
**Action:** update SKILL.md
```

### Expected behavior

- Reports: "Only 2 ACTIVE entries - not enough to harvest yet."
- Stops, no promotion attempted

### Pass criteria

- [ ] Stops without modifying any files
- [ ] Shows count of ACTIVE entries
- [ ] Mentions threshold of 10


## Scenario 3: Happy path - groups by skill, promotes one by one

### Setup

`.claude/learnings/log.md` with 4 ACTIVE entries across 2 skills:

```markdown
## 2026-03-01 - API returns null
**Status:** ACTIVE
**Skill:** selected-photos
**Context:** calling getFirst() on empty album
**Learning:** returns null, not empty array
**Action:** add gotcha to SKILL.md

## 2026-03-02 - fixture ID collision
**Status:** ACTIVE
**Skill:** e2e-test-patterns
**Context:** running fixtures in parallel
**Learning:** use unique ID_PREFIX per ticket
**Action:** add to fixture rules section

## 2026-03-05 - method signature wrong
**Status:** ACTIVE
**Skill:** rule:fact-check
**Context:** assumed API signature from memory
**Learning:** always read source before using method
**Action:** strengthen fact-check rule

## 2026-03-10 - modal overlay timing
**Status:** ACTIVE
**Skill:** e2e-test-patterns
**Context:** modal not visible when clicking
**Learning:** wait for overlay animation before asserting
**Action:** add to anti-patterns
```

### Expected behavior

- Groups entries: selected-photos (1), e2e-test-patterns (2), rule:fact-check (1)
- Displays harvest plan before touching anything
- Waits for user confirmation (y/n)
- Processes one entry at a time with proposed addition shown
- On approval: edits target file, marks entry as PROMOTED in log
- Summary shows promoted/skipped counts and files modified

### Pass criteria

- [ ] Shows grouped plan (3 groups) before any file edits
- [ ] Waits for confirmation before proceeding
- [ ] Shows exact proposed addition for each entry
- [ ] Processes entries per skill group, not randomly
- [ ] After each approval: target SKILL.md contains the new gotcha
- [ ] After each approval: log.md entry status changed to PROMOTED
- [ ] Never batches multiple edits in one step
- [ ] Final summary lists all modified files


## Scenario 4: New skill candidate - requires explicit approval

### Setup

`.claude/learnings/log.md` with 3 ACTIVE entries including one `new:` skill:

```markdown
## 2026-03-01 - crystal albums integration pattern
**Status:** ACTIVE
**Skill:** new:crystal-albums
**Context:** implementing lab order submission
**Learning:** Crystal API requires signed S3 URLs, not direct upload
**Action:** create new skill for crystal-albums integration
```

### Expected behavior

- Identifies `new:crystal-albums` as requiring a new skill file
- Proposes path `.claude/skills/crystal-albums/SKILL.md` with skeleton
- Shows skeleton content before creating
- Requires explicit `y` before creating the file
- Does NOT create the file on skip

### Pass criteria

- [ ] Shows proposed skill path and skeleton before creating
- [ ] Requires explicit approval (not auto-created)
- [ ] On approval: creates file with correct frontmatter and one gotcha
- [ ] On skip: no file created, entry stays ACTIVE
