---
description: "Jira integration - fetch ticket for planning, post test cases after OpenSpec proposal, post E2E results with screenshots."
allowed-tools: [Read, Glob, Grep, Bash, mcp__atlassian__getJiraIssue, mcp__atlassian__addCommentToJiraIssue]
---

# /df:jira

Jira integration for the devflow workflow. Two operations: fetch ticket data for planning, or post test cases as a comment.

**Announce at start:** "I'm using the df:jira command."

## Operations

### fetch <TICKET-ID>

Fetch ticket data for use in `/df:plan`.

1. Call Atlassian MCP: `mcp__atlassian__getJiraIssue` with the ticket ID
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
6. Post via Atlassian MCP: `mcp__atlassian__addCommentToJiraIssue`
7. Report: "Przypadki testowe dodane do <TICKET-ID> (N scenariuszy)"

---

---

### post-test-results <TICKET-ID> <spec-file>

Run Playwright tests and post results + screenshots to Jira as visual proof.

**Before running:** Check if tests have explicit `page.screenshot()` calls at key steps.
`--screenshot=on` only captures the final test state - if multiple tests end on the same screen,
all screenshots look identical and provide no useful visual proof.
Tests should capture key moments explicitly:
```ts
await page.screenshot({ path: 'test-results/step-pricing-settings.png' });
// interact...
await page.screenshot({ path: 'test-results/step-modal-open.png' });
```
If tests lack explicit screenshots, warn: "Screenshoty moga byc nierozroznialne - dodaj page.screenshot() przy kluczowych krokach."

1. Run tests:
   ```bash
   npx playwright test <spec-file> \
     --reporter=json \
     --screenshot=on \
     --output=test-results/ \
     > /tmp/pw-results.json 2>/tmp/pw-stderr.txt
   ```
   JSON goes to stdout → `/tmp/pw-results.json`. Stderr (progress output) to `/tmp/pw-stderr.txt`.

2. Parse `/tmp/pw-results.json` - for each test extract:
   - Test title (should match OpenSpec scenario name)
   - Status: passed / failed / skipped
   - Duration
   - Screenshot paths: explicit screenshots saved via `page.screenshot()` take priority over
     auto-captured end-of-test screenshots (from `attachments` array where `name === "screenshot"`)

3. Build results table for Jira comment:
   ```
   h2. Wyniki testow E2E

   *Uruchomiono:* YYYY-MM-DD HH:MM
   *Wynik:* N/M PASS | spec-file

   ||Scenariusz||Status||Czas||
   |Uzytkownik z folderem widzi oplate|{color:green}PASS{color}|1.2s|
   |Uzytkownik bez folderu - cena sesji|{color:green}PASS{color}|0.9s|
   |Gosc bez pakietu nie moze pobrac|{color:red}FAIL{color}|0.4s|

   _Playwright | df:jira post-test-results_
   ```

4. Post comment via `mcp__atlassian__addCommentToJiraIssue`

5. Attach screenshots via Jira REST API (Atlassian MCP has no file upload tool).
   Requires env vars in `~/.claude/settings.json`: `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
   For each screenshot file found in step 2:
   ```bash
   curl -s -X POST \
     "${JIRA_URL}/rest/api/3/issue/<TICKET-ID>/attachments" \
     -H "X-Atlassian-Token: no-check" \
     -H "Authorization: Basic $(echo -n "${JIRA_EMAIL}:${JIRA_API_TOKEN}" | base64)" \
     -F "file=@<screenshot-path>;type=image/png"
   ```
   If env vars missing: report "Brak JIRA_URL/JIRA_EMAIL/JIRA_API_TOKEN w ~/.claude/settings.json - screenshoty w test-results/ wymagaja recznego uploadu przez Jira UI" and stop.

6. Report: "Wyniki dodane do <TICKET-ID> (N/M PASS, M screenshotow zalaczonych)"

---

## Arguments

| Argument | Description |
|---|---|
| `fetch <TICKET-ID>` | Fetch ticket for planning (e.g. `fetch FO-512`) |
| `post-test-cases <TICKET-ID> <change-id>` | Post scenarios as test cases (e.g. `post-test-cases FO-512 add-feature`) |
| `post-test-results <TICKET-ID> <spec-file>` | Run E2E + post results + screenshots (e.g. `post-test-results FO-512 e2e-tests/fo-512.spec.ts`) |

## DO NOT

- Post test cases if spec.md has no `#### Scenario:` entries
- Fail silently if MCP is unavailable - report and suggest fallback
- Overwrite existing test case comments - always add a new comment
- Skip screenshots even when all tests pass - visual proof is the point
