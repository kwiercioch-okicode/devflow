#!/usr/bin/env node

/**
 * jira-relay.js - Webhook relay for Jira → Claude Code automation.
 *
 * Listens for Jira webhook events (status transitions) and spawns
 * `claude -p` with the appropriate /df:ship phase.
 *
 * Usage:
 *   node jira-relay.js [--port 3333] [--cwd /path/to/project]
 *
 * Jira Automation sends POST to: http://<tunnel>/webhook
 *
 * Expected payload (Jira Automation webhook body):
 *   {
 *     "issue": { "key": "FO-512" },
 *     "transition": { "to_status": "Plan Approved" }
 *   }
 *
 * Or standard Jira webhook payload:
 *   {
 *     "issue": { "key": "FO-512", "fields": { "status": { "name": "Plan Approved" } } },
 *     "changelog": { "items": [{ "field": "status", "toString": "Plan Approved" }] }
 *   }
 *
 * Status → Phase mapping:
 *   "Ready for Claude"  → plan
 *   "Plan Approved"     → impl
 *   "Changes Requested" → fix
 *
 * Environment:
 *   JIRA_WEBHOOK_SECRET - optional shared secret for signature verification
 *   CLAUDE_BIN          - path to claude binary (default: "claude")
 */

'use strict';

const http = require('node:http');
const { spawn, execSync: exec } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, appendFileSync } = require('node:fs');

// --- Process-level error protection ---
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] [ERROR] Uncaught exception: ${err.message}`);
});
process.on('unhandledRejection', (err) => {
  console.error(`[${new Date().toISOString()}] [ERROR] Unhandled rejection: ${err}`);
});

// --- Config ---

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3333;

const cwdIdx = args.indexOf('--cwd');
const PROJECT_CWD = cwdIdx !== -1 ? args[cwdIdx + 1] : process.cwd();

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const WEBHOOK_SECRET = process.env.JIRA_WEBHOOK_SECRET || null;

// Load project-specific config from .devflow/relay-config.json
let PROJECT_CONFIG = {
  baseBranch: 'main',
  repos: '',
  testCommand: 'npm test',
  prBase: 'main',
};
try {
  const configPath = join(PROJECT_CWD, '.devflow', 'relay-config.json');
  const loaded = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'));
  PROJECT_CONFIG = { ...PROJECT_CONFIG, ...loaded };
} catch { /* no config, use defaults */ }

// Load Jira env vars from ~/.claude/settings.json if not in environment
if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
  try {
    const settingsPath = join(require('node:os').homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(require('node:fs').readFileSync(settingsPath, 'utf8'));
    const env = settings.env || {};
    if (!process.env.JIRA_URL && env.JIRA_URL) process.env.JIRA_URL = env.JIRA_URL;
    if (!process.env.JIRA_EMAIL && env.JIRA_EMAIL) process.env.JIRA_EMAIL = env.JIRA_EMAIL;
    if (!process.env.JIRA_API_TOKEN && env.JIRA_API_TOKEN) process.env.JIRA_API_TOKEN = env.JIRA_API_TOKEN;
  } catch { /* settings not found or invalid */ }
}

// Warn if Jira credentials are still missing after all loading attempts
if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
  console.warn('[WARN] Jira credentials not configured. Comments and transitions will be skipped.');
  console.warn('       Set JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN in env or ~/.claude/settings.json');
}

// Status name (lowercase) -> phase
// Status prefix -> phase mapping. Matches any status starting with the prefix.
// E.g. "01-Plan", "01-Custom Plan Name" both match prefix "01".
const STATUS_PREFIX_MAP = {
  '01': 'plan',
  '03': 'impl',
};

// Status transition targets (used by relay for Jira transitions)
const TRANSITION_TARGETS = {
  planReview: '02-Plan Review',
  prReady: '04-PR Ready',
  blocked: '05-Blocked',
  done: '06-Done',
};

function matchStatusPhase(status) {
  const s = status.trim();
  // Prefix match: "01-Plan" -> extract "01", look up in map
  const prefixMatch = s.match(/^(\d{2})\b/);
  if (prefixMatch) {
    return STATUS_PREFIX_MAP[prefixMatch[1]] || null;
  }
  return null;
}

// --- Jira API helper ---

const COMMENT_PREFIX = '\u{1F916} [Claude] ';

function postJiraComment(issueKey, text) {
  if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) return;

  const prefixedText = `${COMMENT_PREFIX}${text}`;
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const body = JSON.stringify({
    body: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: prefixedText }] }
    ]}
  });

  const url = new URL(`/rest/api/3/issue/${issueKey}/comment`, process.env.JIRA_URL);
  const mod = url.protocol === 'https:' ? require('node:https') : require('node:http');
  const req = mod.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
  }, (res) => {
    log('INFO', `Jira comment posted to ${issueKey}`, { status: res.statusCode });
  });
  req.on('error', (err) => {
    log('WARN', `Failed to post Jira comment`, { issueKey, error: err.message });
  });
  req.write(body);
  req.end();
}

function transitionJiraTicket(issueKey, targetStatus) {
  if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) return;

  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const mod = require('node:https');

  // First get available transitions
  const getUrl = new URL(`/rest/api/3/issue/${issueKey}/transitions`, process.env.JIRA_URL);
  const getReq = mod.request(getUrl, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
  }, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => {
      try {
        const json = JSON.parse(d);
        const transition = json.transitions?.find(t =>
          t.name.toLowerCase() === targetStatus.toLowerCase() ||
          t.to?.name?.toLowerCase() === targetStatus.toLowerCase()
        );
        if (!transition) {
          log('WARN', `Transition "${targetStatus}" not found for ${issueKey}`, {
            available: json.transitions?.map(t => t.name),
          });
          return;
        }
        // Do transition
        const postUrl = new URL(`/rest/api/3/issue/${issueKey}/transitions`, process.env.JIRA_URL);
        const postReq = mod.request(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
        }, (postRes) => {
          log('INFO', `Jira transition ${issueKey} -> ${targetStatus}`, { status: postRes.statusCode });
        });
        postReq.on('error', (err) => {
          log('WARN', `Failed to transition ${issueKey}`, { error: err.message });
        });
        postReq.write(JSON.stringify({ transition: { id: transition.id } }));
        postReq.end();
      } catch (err) {
        log('WARN', `Failed to parse transitions for ${issueKey}`, { error: err.message });
      }
    });
  });
  getReq.on('error', (err) => {
    log('WARN', `Failed to get transitions for ${issueKey}`, { error: err.message });
  });
  getReq.end();
}

// --- Logging ---

const LOG_DIR = join(PROJECT_CWD, '.devflow');
const LOG_FILE = join(LOG_DIR, 'jira-relay.log');

function log(level, msg, data) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch { /* ignore log write errors */ }
}

// --- Payload parsing ---

function parsePayload(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { error: 'Invalid JSON' };
  }

  const issueKey = data?.issue?.key;
  if (!issueKey) return { error: 'No issue key found' };

  // Validate issue key format to prevent injection (Jira keys are always PROJECT-123)
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
    return { error: `Invalid issue key format: ${issueKey.slice(0, 20)}` };
  }

  // Try Jira Automation format first
  let toStatus = data?.transition?.to_status;

  // Fall back to standard Jira webhook format
  if (!toStatus && data?.changelog?.items) {
    const statusChange = data.changelog.items.find(i => i.field === 'status');
    toStatus = statusChange?.toString;
  }

  // Fall back to current status
  if (!toStatus) {
    toStatus = data?.issue?.fields?.status?.name;
  }

  if (!toStatus) return { error: 'No status transition found', issueKey };

  // Prefix-based matching: "01-Plan" -> prefix "01" -> phase "plan"
  const phase = matchStatusPhase(toStatus);
  if (!phase) return { error: `Unknown status: ${toStatus}`, issueKey, toStatus };

  return { issueKey, toStatus, phase };
}

// --- Complexity triage ---

const COMPLEXITY_MODELS = {
  trivial:  { plan: 'sonnet', impl: 'sonnet' },
  simple:   { plan: 'sonnet', impl: 'sonnet' },
  moderate: { plan: 'opus',   impl: 'sonnet' },
  complex:  { plan: 'opus',   impl: 'opus' },
};

function fetchTicketDescription(issueKey) {
  return new Promise((resolve) => {
    if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
      resolve('');
      return;
    }
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    const url = new URL(`/rest/api/3/issue/${issueKey}?fields=summary,description,comment`, process.env.JIRA_URL);
    const mod = url.protocol === 'https:' ? require('node:https') : require('node:http');
    const req = mod.request(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const summary = json.fields?.summary || '';
          const desc = json.fields?.description?.content?.map(b =>
            b.content?.map(c => c.text || '').join('')
          ).join('\n') || '';
          // Extract last 3 human comments (filter out relay/bot comments)
          // Filter out Claude/relay comments (all prefixed with COMMENT_PREFIX)
          const comments = (json.fields?.comment?.comments || [])
            .map(c => c.body?.content?.map(b => b.content?.map(t => t.text || '').join('')).join('\n') || '')
            .filter(text => text && !text.includes('[Claude]'))
            .slice(-3)
            .join('\n---\n');
          const commentSection = comments ? `\nRecent comments:\n${comments}` : '';
          resolve(`${summary}\n${desc}${commentSection}`.slice(0, 800));
        } catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(5000, () => { req.destroy(); resolve(''); });
    req.end();
  });
}

function triageTicket(issueKey) {
  const DEFAULT_RESULT = { complexity: 'moderate', quality: 5, scope: 'unknown' };

  return new Promise(async (resolve) => {
    // Fetch ticket description via REST API (no MCP needed)
    const ticketText = await fetchTicketDescription(issueKey);

    if (!ticketText) {
      log('WARN', `No ticket text for ${issueKey}, defaulting to moderate`);
      resolve(DEFAULT_RESULT);
      return;
    }

    const repoList = PROJECT_CONFIG.repos || 'unknown';

    const triagePrompt = `Analyze this Jira ticket. Reply with EXACTLY 3 lines, nothing else.

Ticket ${issueKey}:
${ticketText}

Reply format (3 lines, no extra text):
QUALITY: <1-5>
COMPLEXITY: <trivial|simple|moderate|complex>
SCOPE: <which repo from: ${repoList}>

Rules:
- QUALITY 1-5: how well-defined is the ticket? 1=no info, 3=basic description, 5=detailed with acceptance criteria
- COMPLEXITY: trivial=typo/config/1-line, simple=bugfix/1-3 files, moderate=feature/3-5 files, complex=architecture/5+ files
- SCOPE: which repository this ticket affects most. If unclear, say "both" or "unknown"`;

    const child = spawn(CLAUDE_BIN, [
      '-p', triagePrompt,
      '--model', 'haiku',
      '--output-format', 'json',
    ], {
      cwd: PROJECT_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });

    child.on('close', () => {
      const result = { ...DEFAULT_RESULT };
      try {
        const json = JSON.parse(stdout);
        const text = (json.result || json.text || stdout).toLowerCase().trim();

        const complexityMatch = text.match(/\b(trivial|simple|moderate|complex)\b/);
        if (complexityMatch) result.complexity = complexityMatch[1];

        const qualityMatch = text.match(/quality:\s*(\d)/);
        if (qualityMatch) result.quality = parseInt(qualityMatch[1], 10);

        const scopeMatch = text.match(/scope:\s*(.+)/i);
        if (scopeMatch) result.scope = scopeMatch[1].trim().slice(0, 50);
      } catch {
        const text = stdout.toLowerCase();
        const complexityMatch = text.match(/\b(trivial|simple|moderate|complex)\b/);
        if (complexityMatch) result.complexity = complexityMatch[1];
      }
      log('INFO', `Triage result for ${issueKey}`, result);
      resolve(result);
    });

    child.on('error', () => {
      log('WARN', `Triage failed for ${issueKey}, defaulting to moderate`);
      resolve(DEFAULT_RESULT);
    });

    // Timeout after 30s
    setTimeout(() => {
      child.kill();
      log('WARN', `Triage timeout for ${issueKey}, defaulting to moderate`);
      resolve(DEFAULT_RESULT);
    }, 30000);
  });
}

// --- Claude spawning ---

const activeJobs = new Map(); // issueKey → job info

async function spawnClaude(issueKey, phase) {
  // Prevent duplicate runs for same ticket
  if (activeJobs.has(issueKey)) {
    log('WARN', `Already running for ${issueKey}, skipping`);
    return false;
  }

  // Reserve slot immediately to prevent race conditions with concurrent webhooks
  const job = {
    phase,
    pid: null,
    startedAt: new Date().toISOString(),
    lastActivity: 'triage...',
    stdoutLines: 0,
    stderrSize: 0,
  };
  activeJobs.set(issueKey, job);

  const ticketLower = issueKey.toLowerCase();

  const jiraInstructions = `
IMPORTANT: Do NOT use Atlassian MCP tools (they require OAuth which is unavailable in headless mode).
Use Jira REST API via curl instead. Env vars JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN are available.

Fetch ticket: curl -s -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64)" "$JIRA_URL/rest/api/3/issue/${issueKey}"
Post comment: curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64)" "$JIRA_URL/rest/api/3/issue/${issueKey}/comment" -d '{"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}}'
Get transitions: curl -s -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64)" "$JIRA_URL/rest/api/3/issue/${issueKey}/transitions"
Do transition: curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64)" "$JIRA_URL/rest/api/3/issue/${issueKey}/transitions" -d '{"transition":{"id":"<ID>"}}'`;

  const prompt = phase === 'plan'
    ? `Fetch Jira ticket ${issueKey}, analyze the codebase, generate an implementation plan.

REVISION CHECK: If .devflow/plan-${ticketLower}.md already exists, this is a REVISION request.
In revision mode:
1. Read the existing plan (.devflow/plan-${ticketLower}.md)
2. Fetch comments from Jira to read previous feedback: use the "Fetch ticket" curl command below (it includes comments)
3. Identify what the reviewer wants changed based on their comments
4. Generate a NEW plan that addresses the feedback while keeping what was correct
5. Overwrite .devflow/plan-${ticketLower}.md with the revised plan

IMPORTANT: Write the plan in Polish with proper Polish characters (ą, ę, ś, ć, ź, ż, ł, ó, ń).

Use this exact template structure:

# Plan implementacji | ${issueKey}

## Diagnoza
<co jest nie tak / co trzeba zrobić - techniczny opis z plikami i liniami>

## Taski
### Group 1: <nazwa> [sonnet]
Depends on: none
- [ ] 1.1 Write test: <co testujemy>
- [ ] 1.2 Implement: <co zmieniamy> (plik:linia)
- [ ] 1.3 Verify: <komenda>

## E2E Test Plan
Write scenarios from USER perspective, behavioral language, no technical terms:
- [ ] <co użytkownik robi i co widzi - happy path>
- [ ] <co użytkownik robi i co widzi - edge case>

Example good: "User opens the page with 5 selected items, the counter shows 3 (because 2 are excluded)"
Example bad: "API returns count=3 from the endpoint"

## Ryzyka
<niskie/średnie/wysokie - dlaczego>

## OpenSpec
Rekomendacja: TAK / NIE
Powód: <dlaczego - nowa funkcjonalność / zmiana zachowania = TAK, bugfix / config = NIE>

## Environment
- Branch: ${ticketLower}-<short-description> (from ${PROJECT_CONFIG.baseBranch})
- Worktree: <repo>/.worktrees/${ticketLower}-<short-description>
${PROJECT_CONFIG.repos ? `- Repos: ${PROJECT_CONFIG.repos}` : ''}

Save the plan to .devflow/plan-${ticketLower}.md, post it as a Jira comment on ${issueKey}, and transition the ticket to "02-Plan Review". Work autonomously, no confirmations needed.
${jiraInstructions}`
    : `You are an autonomous implementation agent. Your job is to implement a Jira ticket END TO END: code, commit, push, and PR. You MUST NOT stop until ALL steps are done.

Read the plan: .devflow/plan-${ticketLower}.md

CHECKPOINT SYSTEM: After completing each step, write a checkpoint file:
echo '{"step":N,"branch":"<branch-name>","status":"done"}' > .devflow/checkpoint-${ticketLower}.json
(where N is the step number you just completed). This lets the relay know your progress.

IMPORTANT: If a checkpoint file already exists, read it first and SKIP to the next incomplete step.
If the worktree already has commits from a previous run, check if PR exists (gh pr list --head <branch>). If PR exists, you are done.

DO ALL OF THESE IN ORDER - DO NOT STOP EARLY:
1. Create worktree from ${PROJECT_CONFIG.baseBranch} (or use existing one) -> checkpoint step 1
2. Write tests -> checkpoint step 2
3. Implement the fix/feature -> checkpoint step 3
4. Run tests (${PROJECT_CONFIG.testCommand}) -> checkpoint step 4
5. CODE REVIEW - review every changed file checking:
   - Security: SQL injection, XSS, secrets in code, input validation
   - Naming: clear, consistent, domain-appropriate names
   - Error handling: proper error boundaries, no swallowed errors
   - Test coverage: are edge cases covered? missing scenarios?
   - Correctness: does the code match the plan? any logic bugs?
   Write findings as a list. Be critical. -> checkpoint step 5
6. FIX review findings - fix all issues found in step 5. Re-run tests after fixes. -> checkpoint step 6
7. Write review verdict to .devflow/review-verdict.json:
   {"verdict":"APPROVED|NEEDS_WORK","findings":[...],"fixed":[...]} -> checkpoint step 7
8. git add + git commit (include review summary in commit body) -> checkpoint step 8
9. git push -u origin <branch> -> checkpoint step 9
10. gh pr create --base ${PROJECT_CONFIG.prBase} --title "<title>" --body "<body with review findings and fixes>" -> checkpoint step 10

YOU ARE NOT DONE UNTIL STEP 10 IS COMPLETE AND CHECKPOINT SHOWS STEP 10.
The relay will handle Jira updates and worktree cleanup after you finish.
Do NOT try to call Jira API yourself. Just create the PR.
If a step fails, try to fix it (max 2 attempts). If still failing, push what you have and write checkpoint with current step.

${PROJECT_CONFIG.repos ? `Project repos: ${PROJECT_CONFIG.repos}` : ''}`;
  // Duplicate detection: check if PR already exists for this ticket in any sub-repo
  const ticketId = issueKey.toLowerCase();
  let existingPr = '';
  const { readdirSync: readdir, existsSync: exists } = require('node:fs');
  const dupCheckDirs = [];
  if (exists(join(PROJECT_CWD, '.git'))) dupCheckDirs.push(PROJECT_CWD);
  try {
    for (const e of readdir(PROJECT_CWD, { withFileTypes: true })) {
      if (e.isDirectory() && exists(join(PROJECT_CWD, e.name, '.git'))) {
        dupCheckDirs.push(join(PROJECT_CWD, e.name));
      }
    }
  } catch { /* readdir failed */ }
  for (const dir of dupCheckDirs) {
    if (existingPr) break;
    try {
      const allPrs = exec(`gh pr list --state open --json url,headRefName 2>/dev/null`, { cwd: dir }).toString().trim();
      const prs = JSON.parse(allPrs || '[]');
      const duplicate = prs.find(pr => pr.headRefName.toLowerCase().includes(ticketId));
      if (duplicate) existingPr = duplicate.url;
    } catch { /* gh not available */ }
  }

  if (existingPr) {
    log('INFO', `Duplicate PR found for ${issueKey}`, { pr: existingPr });
    postJiraComment(issueKey, `PR ju\u017C istnieje: ${existingPr}`);
    activeJobs.delete(issueKey);
    return false;
  }

  // Triage: haiku classifies complexity, quality, and scope in one call
  const triage = await triageTicket(issueKey);
  const { complexity, quality, scope } = triage;
  const models = COMPLEXITY_MODELS[complexity] || COMPLEXITY_MODELS.moderate;
  const model = phase === 'plan' ? models.plan : models.impl;
  const modelArgs = ['--model', model];

  // Quality gate (plan phase only - impl tickets already passed human approval)
  if (phase === 'plan') {
    if (quality <= 1) {
      // Block: ticket has almost no information
      log('WARN', `Ticket ${issueKey} quality too low`, { quality });
      postJiraComment(issueKey, `Ticket wymaga opisu (quality: ${quality}/5). Dodaj co trzeba zrobi\u0107.`);
      transitionJiraTicket(issueKey, TRANSITION_TARGETS.blocked);
      activeJobs.delete(issueKey);
      return false;
    }
    if (quality <= 2) {
      // Warning: proceed but note low quality in Jira
      log('INFO', `Ticket ${issueKey} low quality, proceeding with warning`, { quality });
      postJiraComment(issueKey, `Uwaga: ticket ma niewiele informacji (quality: ${quality}/5). Plan mo\u017Ce by\u0107 niedok\u0142adny.`);
    }
  }

  job.complexity = complexity;
  job.model = model;
  job.scope = scope;
  log('INFO', `Spawning claude`, { issueKey, phase, complexity, quality, scope, model, cwd: PROJECT_CWD });

  // Post start comment to Jira
  if (process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    const phaseLabel = phase === 'plan' ? 'planowanie' : 'implementacj\u0119';
    const startText = `Claude rozpocz\u0105\u0142 ${phaseLabel} [${complexity}/${model}] | scope: ${scope}`;
    postJiraComment(issueKey, startText);
  }

  const maxBudget = phase === 'plan' ? ['--max-budget-usd', '3'] : ['--max-budget-usd', '10'];

  // Stop hook for impl phase: prevents Claude from stopping before step 10
  const stopHookScript = join(__dirname, 'stop-hook-check.sh');
  const stopHookSettings = phase === 'impl' ? [
    '--settings', JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'command',
            command: `bash "${stopHookScript}"`,
            timeout: 5000,
          }],
        }],
      },
    }),
  ] : [];

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    ...modelArgs,
    ...maxBudget,
    ...stopHookSettings,
    '--output-format', 'json',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash,Agent,Skill,LSP',
    '--allow-dangerously-skip-permissions',
    '--dangerously-skip-permissions',
  ], {
    cwd: PROJECT_CWD,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  job.pid = child.pid;
  job.lastActivity = 'running...';

  // Process timeout: kill Claude if it runs too long
  const PROCESS_TIMEOUT = phase === 'plan' ? 15 * 60 * 1000 : 60 * 60 * 1000; // 15min plan, 60min impl
  const processTimer = setTimeout(() => {
    log('WARN', `Claude process timeout for ${issueKey}`, { phase, timeout: PROCESS_TIMEOUT });
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000); // Force kill after 5s
  }, PROCESS_TIMEOUT);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const lines = chunk.toString().split('\n').filter(Boolean);
    if (lines.length > 0) {
      job.lastActivity = lines[lines.length - 1].slice(0, 200);
      job.stdoutLines += lines.length;
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    job.stderrSize += chunk.length;
  });

  child.on('close', (code) => {
    clearTimeout(processTimer);
    activeJobs.delete(issueKey);

    // Extract session ID from JSON output
    let sessionId = null;
    try {
      const json = JSON.parse(stdout);
      sessionId = json.session_id || null;
    } catch { /* not JSON or no session_id */ }

    log(code === 0 ? 'INFO' : 'ERROR', `Claude exited`, {
      issueKey, phase, code, sessionId,
      stdout: stdout.slice(-500),
      stderr: stderr.slice(-500),
    });

    // Discover git repos for PR detection and recovery
    const { readdirSync: _readdir, existsSync: _exists } = require('node:fs');
    const gitRepoDirs = [];
    if (_exists(join(PROJECT_CWD, '.git'))) gitRepoDirs.push(PROJECT_CWD);
    try {
      for (const e of _readdir(PROJECT_CWD, { withFileTypes: true })) {
        if (e.isDirectory() && _exists(join(PROJECT_CWD, e.name, '.git'))) {
          gitRepoDirs.push(join(PROJECT_CWD, e.name));
        }
      }
    } catch { /* readdir failed */ }

    // Validate outcome and post end comment to Jira
    {
      const phaseLabel = phase === 'plan' ? 'Planowanie' : 'Implementacja';
      const resumeCmd = sessionId ? `claude --resume ${sessionId}` : '';
      let outcome;

      if (code !== 0) {
        outcome = 'B\u0141\u0104D';
      } else if (phase === 'plan') {
        // Check if plan file was created
        const planPath = join(PROJECT_CWD, '.devflow', `plan-${issueKey.toLowerCase()}.md`);
        outcome = require('node:fs').existsSync(planPath) ? 'zako\u0144czone' : 'NIEPE\u0141NE (brak planu)';
      } else if (phase === 'impl') {
        const ticketId = issueKey.toLowerCase();
        let prUrl = '';

        // First: check checkpoint for PR URL (most reliable)
        try {
          const cpPath = join(PROJECT_CWD, '.devflow', `checkpoint-${ticketId}.json`);
          const cp = JSON.parse(require('node:fs').readFileSync(cpPath, 'utf8'));
          if (cp.step >= 10 && cp.pr) {
            prUrl = cp.pr;
            log('INFO', `PR found via checkpoint for ${issueKey}`, { pr: prUrl });
          }
        } catch { /* no checkpoint or no PR in it */ }

        // Fallback: search sub-repos via gh CLI

        // Search each git repo for PR matching ticket ID
        for (const repoDir of gitRepoDirs) {
          if (prUrl) break;
          try {
            const allPrs = exec(`gh pr list --state open --json url,headRefName 2>/dev/null`, { cwd: repoDir }).toString().trim();
            const prs = JSON.parse(allPrs || '[]');
            const match = prs.find(pr => pr.headRefName.toLowerCase().includes(ticketId));
            if (match) prUrl = match.url;
          } catch { /* gh not available */ }

          // Also check worktrees for branch name
          if (!prUrl) {
            try {
              const worktrees = exec(`git -C "${repoDir}" worktree list --porcelain 2>/dev/null`).toString();
              const branchMatch = worktrees.match(/branch refs\/heads\/([^\n]*${ticketId.replace('-', '.')}[^\n]*)/i);
              if (branchMatch) {
                const branch = branchMatch[1];
                const branchPr = exec(`gh pr list --head "${branch}" --json url --jq ".[0].url" 2>/dev/null`, { cwd: repoDir }).toString().trim();
                if (branchPr) prUrl = branchPr;
              }
            } catch { /* git/gh not available */ }
          }
        }

        if (prUrl) {
          outcome = 'zako\u0144czone';
          job.prUrl = prUrl;
        } else {
          // Check if worktree with ticket ID exists in any sub-repo
          let hasNewCommit = false;
          for (const repoDir of gitRepoDirs) {
            try {
              if (exec(`git -C "${repoDir}" worktree list 2>/dev/null`).toString().includes(ticketId)) {
                hasNewCommit = true;
                break;
              }
            } catch { /* git not available */ }
          }
          outcome = hasNewCommit ? 'NIEPE\u0141NE (commit jest, brak PR)' : 'NIEPE\u0141NE (brak commitu i PR)';
        }
      } else {
        outcome = code === 0 ? 'zako\u0144czone' : 'B\u0141\u0104D';
      }

      const comment = `${phaseLabel}: ${outcome}${resumeCmd ? ` | ${resumeCmd}` : ''}`;
      postJiraComment(issueKey, comment);
      log('INFO', `Outcome`, { issueKey, phase, outcome });

      // If impl succeeded with PR, post PR link, transition Jira, cleanup worktree
      if (phase === 'impl' && outcome.startsWith('zako')) {
        if (job.prUrl) {
          postJiraComment(issueKey, `PR: ${job.prUrl}`);
        }
        // Transition to "PR gotowy"
        transitionJiraTicket(issueKey, TRANSITION_TARGETS.prReady);

        // Worktree cleanup: find and remove worktree for this ticket
        const ticketWt = issueKey.toLowerCase();
        try {
          const wtList = exec(`git -C "${PROJECT_CWD}" worktree list --porcelain 2>/dev/null`).toString();
          const wtMatch = wtList.match(new RegExp(`worktree\\s+([^\\n]*${ticketWt.replace('-', '.')}[^\\n]*)`, 'i'));
          if (wtMatch) {
            const wtPath = wtMatch[1];
            exec(`git -C "${PROJECT_CWD}" worktree remove "${wtPath}" --force 2>/dev/null`);
            log('INFO', `Worktree cleaned up for ${issueKey}`, { path: wtPath });
          }
        } catch (err) {
          log('WARN', `Worktree cleanup failed for ${issueKey}`, { error: err.message });
        }
      }
      // If impl incomplete, try relay-side recovery before giving up
      if (phase === 'impl' && !outcome.startsWith('zako')) {
        // Read checkpoint to understand progress
        let checkpoint = null;
        try {
          const cpPath = join(PROJECT_CWD, '.devflow', `checkpoint-${issueKey.toLowerCase()}.json`);
          checkpoint = JSON.parse(require('node:fs').readFileSync(cpPath, 'utf8'));
          log('INFO', `Checkpoint for ${issueKey}`, checkpoint);
        } catch { /* no checkpoint */ }

        // Relay-side push fallback: if code is committed but not pushed
        if (checkpoint && checkpoint.step >= 8 && checkpoint.branch) {
          for (const repoDir of gitRepoDirs) {
            try {
              // Check if branch exists locally
              const branches = exec(`git -C "${repoDir}" branch --list "${checkpoint.branch}" 2>/dev/null`).toString().trim();
              if (branches) {
                // Check if branch is on remote
                const remote = exec(`git -C "${repoDir}" ls-remote --heads origin "${checkpoint.branch}" 2>/dev/null`).toString().trim();
                if (!remote) {
                  log('INFO', `Relay pushing branch ${checkpoint.branch} from ${repoDir}`);
                  exec(`git -C "${repoDir}" push -u origin "${checkpoint.branch}" 2>/dev/null`);
                  checkpoint.step = Math.max(checkpoint.step, 9);
                }
              }
            } catch { /* push failed */ }
          }
        }

        // Relay-side PR creation fallback: if pushed but no PR
        if (checkpoint && checkpoint.step >= 9 && checkpoint.branch) {
          let relayPrUrl = '';
          for (const repoDir of gitRepoDirs) {
            if (relayPrUrl) break;
            try {
              const existing = exec(`gh pr list --head "${checkpoint.branch}" --json url --jq ".[0].url" 2>/dev/null`, { cwd: repoDir }).toString().trim();
              if (existing) {
                relayPrUrl = existing;
              } else {
                const prOut = exec(`gh pr create --base "${PROJECT_CONFIG.prBase}" --title "fix(${issueKey}): relay-created PR" --body "Relay created this PR because Claude did not complete step 10." --head "${checkpoint.branch}" 2>/dev/null`, { cwd: repoDir }).toString().trim();
                if (prOut) relayPrUrl = prOut;
                log('INFO', `Relay created PR for ${issueKey}`, { pr: relayPrUrl });
              }
            } catch { /* pr create failed */ }
          }

          if (relayPrUrl) {
            outcome = 'zako\u0144czone';
            job.prUrl = relayPrUrl;
            postJiraComment(issueKey, `PR (relay fallback): ${relayPrUrl}`);
            transitionJiraTicket(issueKey, TRANSITION_TARGETS.prReady);
            log('INFO', `Relay recovered ${issueKey} via PR fallback`);
          }
        }

        // Auto-resume: if still incomplete and we have a session ID, retry
        const MAX_RESUME_RETRIES = 2;
        const resumeCount = job.resumeCount || 0;
        if (!outcome.startsWith('zako') && sessionId && resumeCount < MAX_RESUME_RETRIES) {
          log('INFO', `Auto-resuming ${issueKey} (attempt ${resumeCount + 1}/${MAX_RESUME_RETRIES})`, { sessionId, checkpoint });
          const resumeStep = checkpoint ? checkpoint.step + 1 : 'unknown';
          postJiraComment(issueKey, `Auto-resume ${resumeCount + 1}/${MAX_RESUME_RETRIES}: kontynuuj\u0119 od kroku ${resumeStep}`);

          // Re-spawn with --resume instead of new prompt
          const resumeChild = spawn(CLAUDE_BIN, [
            '--resume', sessionId,
            '-p', `You stopped early. Continue from step ${resumeStep}. Check .devflow/checkpoint-${issueKey.toLowerCase()}.json for progress. Complete ALL remaining steps up to step 10.`,
            '--max-budget-usd', '5',
            '--output-format', 'json',
            '--allow-dangerously-skip-permissions',
            '--dangerously-skip-permissions',
          ], {
            cwd: PROJECT_CWD,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
          });

          // Track resume in activeJobs
          const resumeJob = { ...job, pid: resumeChild.pid, resumeCount: resumeCount + 1, lastActivity: 'auto-resume...' };
          activeJobs.set(issueKey, resumeJob);

          let resumeStdout = '';
          resumeChild.stdout.on('data', (c) => { resumeStdout += c; });
          resumeChild.on('close', () => {
            // Re-run outcome validation after resume (recursive through same flow)
            activeJobs.delete(issueKey);
            log('INFO', `Resume completed for ${issueKey}`);
            // Note: for simplicity, we don't recurse - just check PR one more time
            let finalPrUrl = '';
            for (const repoDir of gitRepoDirs) {
              if (finalPrUrl) break;
              try {
                const allPrs = exec(`gh pr list --state open --json url,headRefName 2>/dev/null`, { cwd: repoDir }).toString().trim();
                const prs = JSON.parse(allPrs || '[]');
                const match = prs.find(pr => pr.headRefName.toLowerCase().includes(issueKey.toLowerCase()));
                if (match) finalPrUrl = match.url;
              } catch {}
            }
            if (finalPrUrl) {
              postJiraComment(issueKey, `PR (po resume): ${finalPrUrl}`);
              transitionJiraTicket(issueKey, TRANSITION_TARGETS.prReady);
            } else {
              postJiraComment(issueKey, `NIEPE\u0141NE po ${resumeCount + 1} resume. ${sessionId ? `claude --resume ${sessionId}` : ''}`);
              transitionJiraTicket(issueKey, TRANSITION_TARGETS.blocked);
            }
          });
          return; // Don't transition yet - wait for resume
        }

        // Final: if still incomplete after all recovery, transition to Wymaga uwagi
        if (!outcome.startsWith('zako')) {
          transitionJiraTicket(issueKey, TRANSITION_TARGETS.blocked);
        }
      }
    }

    // macOS notification
    if (process.platform === 'darwin') {
      try {
        const phaseLabel = phase === 'plan' ? 'Planowanie' : 'Implementacja';
        const title = code === 0 ? `${issueKey}: ${phaseLabel}` : `${issueKey}: B\u0141\u0104D`;
        const msg = sessionId ? `claude --resume ${sessionId}` : 'Sprawd\u017A Jir\u0119';
        exec(`osascript -e 'display notification "${msg}" with title "${title}"'`, { cwd: PROJECT_CWD });
      } catch { /* osascript not available */ }
    }
  });

  child.on('error', (err) => {
    activeJobs.delete(issueKey);
    log('ERROR', `Failed to spawn claude`, { issueKey, error: err.message });
  });

  return true;
}

// --- HTTP Server ---

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeJobs: Object.fromEntries(activeJobs),
      uptime: process.uptime(),
    }));
    return;
  }

  // Recent logs
  if (req.method === 'GET' && (req.url === '/logs' || req.url?.startsWith('/logs?'))) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const lines = parseInt(url.searchParams.get('lines') || '50', 10);
    let logContent = '';
    try {
      const fullLog = require('node:fs').readFileSync(LOG_FILE, 'utf8');
      const logLines = fullLog.split('\n').filter(Boolean);
      logContent = logLines.slice(-Math.min(lines, 200)).join('\n');
    } catch { logContent = '(no log file yet)'; }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(logContent);
    return;
  }

  // Status
  if (req.method === 'GET' && req.url === '/status') {
    const now = Date.now();
    const active = {};
    for (const [key, job] of activeJobs) {
      const durationSec = Math.round((now - new Date(job.startedAt).getTime()) / 1000);
      const mins = Math.floor(durationSec / 60);
      const secs = durationSec % 60;
      active[key] = {
        phase: job.phase,
        complexity: job.complexity || 'unknown',
        model: job.model || 'unknown',
        pid: job.pid,
        duration: `${mins}m${secs}s`,
        lastActivity: job.lastActivity,
        outputLines: job.stdoutLines,
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active,
      totalActive: activeJobs.size,
      uptime: Math.round(process.uptime()),
      config: {
        baseBranch: PROJECT_CONFIG.baseBranch,
        prBase: PROJECT_CONFIG.prBase,
        jiraConfigured: !!(process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
      },
    }));
    return;
  }

  // Webhook endpoint
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    let bodyTooLarge = false;
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) bodyTooLarge = true;
    });
    req.on('end', async () => {
      if (bodyTooLarge) {
        log('WARN', 'Webhook body too large', { size: body.length });
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', reason: 'Payload too large' }));
        return;
      }
      // Optional: verify webhook secret
      if (WEBHOOK_SECRET) {
        const token = req.headers['x-webhook-secret'] || req.headers['authorization'];
        if (token !== WEBHOOK_SECRET && token !== `Bearer ${WEBHOOK_SECRET}`) {
          log('WARN', 'Unauthorized webhook attempt');
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }
      }

      const result = parsePayload(body);

      if (result.error) {
        log('WARN', `Webhook rejected: ${result.error}`, { issueKey: result.issueKey });
        res.writeHead(result.issueKey ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ignored', reason: result.error }));
        return;
      }

      const spawned = await spawnClaude(result.issueKey, result.phase);

      log('INFO', `Webhook processed`, {
        issueKey: result.issueKey,
        status: result.toStatus,
        phase: result.phase,
        spawned,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: spawned ? 'spawned' : 'already_running',
        issueKey: result.issueKey,
        phase: result.phase,
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  log('INFO', `Jira relay listening`, { port: PORT, cwd: PROJECT_CWD });
  console.log(`\nJira Relay Server`);
  console.log(`=================`);
  console.log(`  Port:    ${PORT}`);
  console.log(`  CWD:     ${PROJECT_CWD}`);
  console.log(`  Claude:  ${CLAUDE_BIN}`);
  console.log(`  Secret:  ${WEBHOOK_SECRET ? 'configured' : 'none (open)'}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /webhook  - Jira webhook receiver`);
  console.log(`  GET  /health   - Health check`);
  console.log(`  GET  /status   - Active jobs`);
  console.log(`\nStatus mapping (prefix-based):`);
  for (const [prefix, phase] of Object.entries(STATUS_PREFIX_MAP)) {
    console.log(`  "${prefix}-*" -> --phase ${phase}`);
  }
  console.log(`\nWaiting for webhooks...\n`);
});

// --- Graceful shutdown ---
function gracefulShutdown(signal) {
  log('INFO', `Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    log('INFO', 'HTTP server closed');
    if (activeJobs.size > 0) {
      log('WARN', `${activeJobs.size} active jobs still running, waiting...`);
      // Don't kill child processes - let them finish
    }
    process.exit(0);
  });
  // Force exit after 30s if graceful shutdown hangs
  setTimeout(() => {
    log('WARN', 'Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
