---
description: "Create PR with auto-generated structured description from commits and diff."
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

# /df:pr

Create a pull request with auto-generated description from commits and diff.

**Announce at start:** "I'm using the df:pr command."

## Step 0 - Run pr-prepare.js

```bash
SCRIPT=$(find ~/.claude/plugins -name "pr-prepare.js" 2>/dev/null | head -1)
[ -z "$SCRIPT" ] && [ -f "plugins/devflow/scripts/pr-prepare.js" ] && SCRIPT="plugins/devflow/scripts/pr-prepare.js"
[ -z "$SCRIPT" ] && { echo "ERROR: Could not locate pr-prepare.js. Is the df plugin installed?" >&2; exit 2; }

PR_DATA=$(mktemp /tmp/pr-prepare-XXXXXX.json)
node "$SCRIPT" $ARGUMENTS > "$PR_DATA"
EXIT_CODE=$?
echo "PR_DATA=$PR_DATA"
echo "EXIT_CODE=$EXIT_CODE"
```

On non-zero exit: show stderr message and stop.

## Step 1 - Read and Analyze

Read `$PR_DATA` JSON. Display context:

```
PR context:
  Branch:     <branch> -> <baseBranch>
  Commits:    <commitCount>
  Files:      <filesChanged> changed
  Remote:     <needs push? ahead by N>
  Review:     <verdict or "no review">
  Template:   <found at path or "none">
```

Show any warnings from `warnings` array.

## Step 2 - Generate PR Title and Body

**Title:** Short (under 70 chars), derived from commits:
- Single commit: use commit subject
- Multiple commits: summarize the feature/change

**Body:** If PR template found, fill it in. Otherwise use:

```markdown
## Summary
<2-3 bullet points summarizing what and why>

## Changes
<grouped list of changes by area>

## Review
<verdict summary if review was run, or "No automated review run">

## Test plan
<what was tested, how to verify>
```

Include review verdict summary if `review.hasVerdict` is true.

## Step 3 - Push if Needed

If `remote.needsPush` is true:
```bash
git push -u origin <branch>
```

## Step 4 - Present and Confirm

Display the full PR title and body.

**If `--auto`:** create PR immediately.
**If `--draft`:** add `--draft` flag.
**Otherwise:** ask user to confirm, edit, or cancel.

## Step 5 - Create PR

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

Add `--draft` if flagged. Display the PR URL.

Clean up: `rm -f "$PR_DATA"`

## Arguments

| Flag | Description |
|---|---|
| `--base <branch>` | Target branch (default: auto-detect) |
| `--draft` | Create as draft PR |
| `--auto` | Skip confirmation prompt |

## DO NOT

- Create a PR without running pr-prepare.js first
- Push to remote without checking if it's needed
- Include the full diff in the PR body
- Skip displaying warnings (uncommitted changes, no review, large PR)
