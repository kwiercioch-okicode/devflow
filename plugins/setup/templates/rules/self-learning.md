# Self-Learning

After sessions with corrections or surprising discoveries, capture learnings.

## When to Capture

- User corrected your approach or assumptions
- You discovered a non-obvious gotcha or trap
- A pattern worked unexpectedly well or failed unexpectedly
- You found a gap in existing skills or rules

## How to Capture

Append to `.claude/learnings/log.md`:

```markdown
## YYYY-MM-DD - <brief summary>
**Status:** ACTIVE
**Skill:** <skill name | rule:<name> | docs | new>
**Context:** <what you were doing>
**Learning:** <what was discovered>
**Action:** <specific change to make in that skill or rule>
```

**Skill field values:**
- Existing skill name: `selected-photos`, `backend-patterns`, `e2e-test-patterns`, etc.
- Process rule: `rule:test-first`, `rule:fact-check`, etc.
- Documentation: `docs`
- New skill needed: `new:<proposed-name>`

## Harvest Threshold

When log has 10+ ACTIVE entries, run `/df:harvest`. It groups entries by Skill and promotes each to the right file:
- Skill entry -> gotcha or pattern section in that skill's SKILL.md
- Rule entry -> update or create `.claude/rules/<name>.md`
- Docs entry -> `.claude/docs/traps.md` or relevant doc file
- New entry -> new skill candidate (requires confirmation)

Then marks promoted entries as PROMOTED.
