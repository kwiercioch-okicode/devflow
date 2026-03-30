---
description: "Harvest learnings - promote ACTIVE entries from .claude/learnings/log.md to skill gotchas, rules, or docs."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

# /df:harvest

Harvest accumulated learnings - promote ACTIVE entries from the learnings log into the skills they belong to.

**Announce at start:** "I'm using the df:harvest command."

## Step 0 - Read the Log

Read `.claude/learnings/log.md`.

If the file does not exist:
```
Nothing to harvest - .claude/learnings/log.md not found.
Start capturing learnings and run /df:harvest when you have enough.
```
Stop.

Count ACTIVE entries. If fewer than 3:
```
Only N ACTIVE entries - not enough to harvest yet.
Threshold is 10 (doctor warns above this). Come back later.
```
Stop.

## Step 1 - Group by Skill

Each entry has a `**Skill:**` field. Group ACTIVE entries by that value:

| Skill field value | Target file |
|---|---|
| `<skill-name>` (e.g. `selected-photos`) | `.claude/skills/<skill-name>/SKILL.md` - gotcha or pattern section |
| `rule:<name>` (e.g. `rule:fact-check`) | `.claude/rules/<name>.md` - update or create |
| `docs` | `.claude/docs/traps.md` |
| `new:<name>` | New skill candidate - requires explicit user approval |

For entries **without** a Skill field (old format): classify based on Learning content using the same table, propose a Skill assignment.

Display the harvest plan before touching anything:

```
Found N ACTIVE entries to harvest:

  selected-photos    3 entries  -> .claude/skills/selected-photos/SKILL.md
  rule:fact-check    2 entries  -> .claude/rules/fact-check.md
  docs               1 entry    -> .claude/docs/traps.md
  new:crystal-albums 1 entry    -> new skill (needs approval)

Proceed? (y/n)
```

Wait for user confirmation before proceeding.

## Step 2 - Promote One by One

Process entries grouped by skill - all entries for one skill together, then move to next skill.

For each entry, show:
```
---
Skill: selected-photos
Entry: 2026-03-15 - ImageService returns null on empty album
Context: Calling ImageService::getFirst() on empty album
Learning: Returns null, not empty array - callers must null-check
Action: Add gotcha to SKILL.md

Proposed addition to .claude/skills/selected-photos/SKILL.md:
---
> Gotcha: ImageService::getFirst() returns null on empty album (not empty array).
> Always null-check before iterating.

-> Apply? [y/n/skip]
```

On `y`:
1. Edit the target skill/rule file with the proposed addition
2. Change `**Status:** ACTIVE` to `**Status:** PROMOTED` in `log.md`

On `skip`: leave ACTIVE, move to next entry.

Process one entry at a time - never batch.

For **new skill candidates**: show the proposed skill path and a skeleton (name, description, one gotcha). Require `y` before creating the file.

## Step 3 - Summary

After all entries:

```
Harvest complete
===============
  Promoted:  N entries
  Skipped:   N entries
  Remaining ACTIVE: N

Skills strengthened:
  - .claude/skills/selected-photos/SKILL.md  (+2 gotchas)
  - .claude/rules/fact-check.md              (+1 pattern)
  - .claude/learnings/log.md                 (N -> PROMOTED)
```

If remaining ACTIVE >= 10: "Still above threshold - consider another harvest pass."

## DO NOT

- Auto-promote without showing the proposed addition and getting approval
- Batch multiple entries into one edit
- Delete entries from `log.md` - only change status to PROMOTED
- Create new skill files without explicit user approval
- Add learnings to CLAUDE.md directly - they belong in skill files
- Modify anything before Step 1 confirmation
