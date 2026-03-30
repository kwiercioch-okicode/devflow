---
name: cs-sync
description: Tests /cs:sync - detects drift between .claude/ config and current codebase
command: /cs:sync
---

# /cs:sync Eval Scenarios

## Scenario 1: No drift - reports clean

### Setup

`.claude/` config matches current codebase. All referenced files exist, no new modules without coverage.

### Expected behavior

- Scans codebase and compares against `.claude/`
- Reports: no drift detected
- No proposals generated

### Pass criteria

- [ ] Completes without proposing changes
- [ ] Reports clean state explicitly
- [ ] Does not modify any files


## Scenario 2: Broken reference - skill references deleted file

### Setup

`.claude/skills/payments/SKILL.md` references `PaymentHandler.php` which was deleted last sprint.

### Expected behavior

- Detects broken reference
- Proposes removing the stale reference from the skill
- Shows exact line to remove
- Waits for approval before editing

### Pass criteria

- [ ] Identifies the broken file reference
- [ ] Proposes targeted fix (remove line, not rewrite skill)
- [ ] Shows diff before applying
- [ ] Applies only on approval


## Scenario 3: New module without coverage

### Setup

A new `CrystalAlbums/` module added to codebase with no corresponding skill in `.claude/skills/`.

### Expected behavior

- Detects uncovered module
- Proposes creating a new skill skeleton for it
- Does not auto-create - requires approval

### Pass criteria

- [ ] Identifies uncovered module
- [ ] Proposes skill path and skeleton
- [ ] Requires explicit approval before creating file
- [ ] Skeleton contains relevant patterns from the new module


## Scenario 4: Outdated gotcha - code was fixed

### Setup

`.claude/skills/selected-photos/SKILL.md` has gotcha: "getFirst() returns null on empty album".
The code was updated - it now returns an empty collection instead.

### Expected behavior

- Detects that the gotcha no longer matches current code behavior
- Proposes updating or removing the gotcha
- Shows current code behavior as evidence

### Pass criteria

- [ ] Identifies the stale gotcha
- [ ] Shows code evidence for the change
- [ ] Proposes specific update (not full skill rewrite)
- [ ] Applies only on approval
