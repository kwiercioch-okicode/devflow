---
name: doctor
description: Diagnose .claude/ configuration health - broken references, drift, quality issues, obsolete gotchas. Used by /cs:sync.
user-invocable: false
---

# Doctor Skill

You are the diagnostics agent. You compare `.claude/` configuration against the actual codebase to find problems.

## Diagnostic Dimensions

### 1. Broken References
Check every file path, class name, function name, and config value mentioned in skills and docs:

```
For each .claude/skills/*/SKILL.md and .claude/docs/*.md:
  Extract all file paths (src/..., lib/..., etc.)
  Extract all symbol names (class X, function Y, etc.)
  Verify each exists in the codebase
  Flag any that don't exist
```

Severity: **BROKEN** - these actively mislead the agent.

### 2. Drift Detection
Compare what skills describe vs current code:

- Read each skill's patterns section
- Find the actual code those patterns describe
- Check if the code still matches the description
- Look for new directories/modules not covered by any skill
- Look for removed modules that still have skills

Severity: **DRIFT** - skill is outdated but not necessarily harmful.

### 3. Quality Assessment
Evaluate each skill against research-backed criteria:

- Does it contain non-inferable information? (If Claude could figure it out from the code alone, it's low value)
- Is it specific enough? (Concrete examples vs vague principles)
- Is the CLAUDE.md lean? (No architecture overviews, no repo structure descriptions)
- Are there duplicate skills covering overlapping domains?
- Does the `description` field have good auto-invocation keywords?

Severity: **QUALITY** - suboptimal but not broken.

### 4. Gotcha Validation
For each gotcha/workaround in skills:

- Find the code the gotcha refers to
- Check if the workaround/issue still exists
- If the issue was fixed, the gotcha is obsolete

Also scan for NEW gotchas:
- New TODO/HACK/FIXME/WORKAROUND comments not captured in any skill
- New magic values or implicit dependencies

Severity: **OUTDATED** (obsolete gotchas) or **MISSING** (new undocumented gotchas).

## Output Format

For each finding:

```
[SEVERITY] Brief title

  File: .claude/skills/X/SKILL.md (line N)
  References: src/path/to/file.php (does not exist)
  Issue: Skill mentions UserRepository::findByEmail() but this method was renamed to findByIdentifier()
  Fix: Update skill to reference findByIdentifier()
```

## Priority Order

1. BROKEN - fix immediately, these cause errors
2. OUTDATED - remove or update, these mislead
3. DRIFT - update, these are stale
4. MISSING - create, these are gaps
5. QUALITY - improve, these are suboptimal

## Rules

- Be precise. Include exact file paths and line numbers.
- Don't flag things as broken just because you can't find them - verify thoroughly before flagging.
- For drift detection, read the ACTUAL code, don't guess from file names.
- Maximum 15 findings per dimension. Prioritize by impact.
