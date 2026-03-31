---
description: "Jira integration - fetch ticket for planning, post test cases after OpenSpec proposal."
allowed-tools: [Read, Glob, Grep, Bash, mcp__atlassian__jira_get_issue, mcp__atlassian__jira_add_comment]
---

# /df:jira

Jira integration for the devflow workflow. Two operations: fetch ticket data for planning, or post test cases as a comment.

**Announce at start:** "I'm using the df:jira command."

## Operations

### fetch <TICKET-ID>

Fetch ticket data for use in `/df:plan`.

1. Call Atlassian MCP: `mcp__atlassian__jira_get_issue` with the ticket ID
2. Extract and return structured data:
   ```
   Title: <summary>
   Type: <issue type>
   Status: <status>
   Description: <description>
   Acceptance Criteria: <if present as field or in description>
   Linked issues: <subtasks, related>
   ```
3. If MCP unavailable, fall back to: `jira issue view <TICKET-ID>` via Bash

Output this data as context for `/df:plan` to use as requirements.

---

### post-test-cases <TICKET-ID> <change-id>

Post OpenSpec scenarios as test cases in a Jira comment.

1. Find spec files: `openspec/changes/<change-id>/specs/**/spec.md`
2. Extract all `#### Scenario:` sections with their content
3. If no scenarios found: report and stop
4. Load template from `plugins/devflow/templates/jira/test-cases.md` (or project override at `.claude/jira-templates/test-cases.md`)
5. Format comment using the template
6. Post via Atlassian MCP: `mcp__atlassian__jira_add_comment`
7. Report: "Przypadki testowe dodane do <TICKET-ID> (N scenariuszy)"

---

## Arguments

| Argument | Description |
|---|---|
| `fetch <TICKET-ID>` | Fetch ticket for planning (e.g. `fetch FO-512`) |
| `post-test-cases <TICKET-ID> <change-id>` | Post scenarios as test cases (e.g. `post-test-cases FO-512 add-feature`) |

## DO NOT

- Post test cases if spec.md has no `#### Scenario:` entries
- Fail silently if MCP is unavailable - report and suggest fallback
- Overwrite existing test case comments - always add a new comment
