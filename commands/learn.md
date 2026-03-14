---
description: "Learn from the current session. Analyzes corrections, patterns, and gotchas discovered during work to update skills and configuration."
---

# /cs:learn - Learn From This Session

You are the learning agent for `claude-setup`. Analyze the current conversation and propose targeted updates to `.claude/` configuration.

## Step 1: Analyze Conversation

Review the entire conversation history, looking for 4 types of learnings:

### Type A: User Corrections
Patterns: "no not that", "instead do...", "don't...", "that's wrong because..."
These are the HIGHEST VALUE learnings - the user is telling you something non-inferable.

Extract: what was wrong, correct approach, WHY (if explained).

### Type B: Discovered Gotchas
Things that went wrong because of missing context:
- Bugs caused by implicit dependencies
- Failed approaches due to non-obvious constraints
- Unexpected behavior from the codebase
- Environment-specific issues encountered

Extract: trigger, root cause, resolution, related codebase area.

### Type C: Repeating Patterns
Things done multiple times suggesting a project-specific pattern:
- Same type of file created the same way
- Same approach applied to similar problems
- Consistent structure followed across changes

Extract: pattern, when it applies, what makes it project-specific.

### Type D: New Knowledge
Facts about the project learned during the session:
- How custom tooling works
- Business rules discovered in code
- Relationships between modules
- Environment setup requirements

## Step 2: Match to Configuration

For each learning, determine where it belongs:

| Learning Type | Target |
|---|---|
| Correction about a skill's domain | Update existing skill (add gotcha) |
| Correction about general behavior | Update CLAUDE.md (add to Lessons) |
| Gotcha in a covered domain | Update existing skill |
| Gotcha in uncovered domain | Create new skill |
| Pattern that matches a skill | Update existing skill (add example) |
| Pattern in new domain | Create new skill |
| New knowledge about project | Update `.claude/docs/` |

## Step 3: Present Learnings One by One

Present learnings ONE AT A TIME. Wait for user response before showing the next one.

NEVER dump all learnings at once. NEVER show full code upfront.

### First, show the count:

```
/cs:learn — N learnings found
```

### Then immediately show the first learning:

```
[1/N] [skill-name]: [one-line description]
   → [target file path] ([action: new gotcha / new entry / new skill])
   [2-3 sentences explaining what this learning captures and why it matters.
   Enough context to decide without seeing the code.]

   Apply (a) | Review code (r) | Skip (s)
```

### Rules:
- **2-3 sentence context** — explain WHAT the learning says and WHY it matters, not what happened in the session
- **No "From this session:"** — never explain the session context
- **No code** — code only appears on `r` request
- **Wait for response** — do NOT show `[2/N]` until user responds to `[1/N]`

### User actions per learning:
- **`a`** — apply this learning immediately, then show next
- **`r`** — show review detail (see Step 4), then ask again
- **`s`** — skip this learning, show next

## Step 4: Review Detail (on `r` request)

When user asks to review, show where the change goes and collapsed code:

```
[N/M] [skill-name]: [one-line description]
   → [target file path]

   After: "[section name where it goes]"

   + ### [heading of new content]
   + [2-3 sentence summary of the gotcha/pattern]
   + [key rule or constraint in one line]
   +
   + [N lines of code]

   Show full code? (y) | Apply (a) | Skip (s)
```

Rules for review detail:
- **"After:"** — show WHERE in the file the content goes (after which section/heading)
- **Summary lines** — 2-3 sentences describing the learning, NOT the full text
- **Code is collapsed** — show `[N lines of code]` count, expand only on `y`
- **Actions** — show full code (y), apply (a), or skip (s)

## Step 5: Apply Changes

When applying learnings:

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

### Quality filters (CRITICAL — apply BEFORE presenting any learning):

Every learning MUST pass the **non-inferable test**: would a competent developer using this stack already know this? If yes, skip it.

**SKIP these — they are generic knowledge, not project-specific:**
- UI/UX common sense (tooltips disappear on hover-out, modals block interaction, etc.)
- Framework basics (React re-renders on state change, useEffect cleanup, etc.)
- Language fundamentals (null checks, async/await patterns, type narrowing, etc.)
- General best practices (error handling, input validation, accessibility, etc.)

**KEEP these — they are non-inferable without reading THIS project's code:**
- Project-specific conventions ("we use CopyableField component, not custom click-to-copy")
- Hidden dependencies between modules that aren't obvious from imports
- Business rules encoded in code that contradict intuition
- Workarounds for known bugs in project's specific dependency versions
- Environment/deployment quirks unique to this setup

Also skip:
- Learnings that are session-specific with no future value
- Learnings already captured in existing skills
- Combine related learnings into a single proposal

## Step 6: Final Summary

```
/cs:learn complete
  Found: N learnings (A corrections, B gotchas, C patterns, D knowledge)
  Applied: M | Skipped: K

  Updated: [file1], [file2]
  Created: [file1]
```
