---
name: cs-init
description: Tests /cs:init - generates .claude/ configuration from codebase analysis
command: /cs:init
---

# /cs:init Eval Scenarios

## Scenario 1: Fresh project - generates full config

### Setup

Project with PHP backend + React frontend, no existing `.claude/` directory.

### Expected behavior

- Detects tech stack (PHP, React, TypeScript)
- Scans for domain rules and patterns
- Generates CLAUDE.md with decision framework
- Generates `.claude/rules/` with all 13 process rules from templates
- Generates `.claude/skills/` with project-specific skills
- Generates `.claude/docs/` with traps and domain model
- Does NOT add inferred/obvious things (file structure, git history)

### Pass criteria

- [ ] CLAUDE.md created with Process Rules section referencing `.claude/rules/`
- [ ] All 13 rule files present in `.claude/rules/`
- [ ] At least one project-specific skill generated
- [ ] Skills contain non-inferable domain knowledge only
- [ ] No duplicate of what's already readable from code


## Scenario 2: Existing config - merges intelligently

### Setup

Project with existing `.claude/` directory containing custom skills.

### Expected behavior

- Detects existing config
- Merges new findings without overwriting custom content
- Adds missing rules without touching existing ones
- Reports what was added vs what was skipped

### Pass criteria

- [ ] Existing custom skills preserved
- [ ] Missing rules added
- [ ] No content overwritten without confirmation
- [ ] Summary shows added vs skipped items


## Scenario 3: Multi-repo project - covers all repos

### Setup

Project with `api-fotigo/` (PHP) and `fotigo/` (React) repos detected.

### Expected behavior

- Detects both repos from `.dev-env.yml` or sibling directories
- Generates skills covering both PHP and React patterns
- git-workflow skill includes multi-repo commit instructions

### Pass criteria

- [ ] Skills cover both PHP and React domains
- [ ] git-workflow skill mentions both repos
- [ ] No single-repo assumptions in generated config
