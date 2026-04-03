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

// --- Config ---

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3333;

const cwdIdx = args.indexOf('--cwd');
const PROJECT_CWD = cwdIdx !== -1 ? args[cwdIdx + 1] : process.cwd();

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const WEBHOOK_SECRET = process.env.JIRA_WEBHOOK_SECRET || null;

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

// Status name (lowercase) → phase
const STATUS_PHASE_MAP = {
  'do realizacji': 'plan',
  'zaakceptowany': 'impl',
};

// --- Jira API helper ---

function postJiraComment(issueKey, text) {
  if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) return;

  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const body = JSON.stringify({
    body: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text }] }
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

  if (!toStatus) return { error: 'No status transition found' };

  const phase = STATUS_PHASE_MAP[toStatus.toLowerCase()];
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
    const url = new URL(`/rest/api/3/issue/${issueKey}?fields=summary,description`, process.env.JIRA_URL);
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
          resolve(`${summary}\n${desc}`.slice(0, 500));
        } catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.setTimeout(5000, () => { req.destroy(); resolve(''); });
    req.end();
  });
}

function triageComplexity(issueKey) {
  return new Promise(async (resolve) => {
    // Fetch ticket description via REST API (no MCP needed)
    const ticketText = await fetchTicketDescription(issueKey);

    if (!ticketText) {
      log('WARN', `No ticket text for ${issueKey}, defaulting to moderate`);
      resolve('moderate');
      return;
    }

    const triagePrompt = `Classify this Jira ticket complexity. Reply with ONLY ONE WORD.

Ticket ${issueKey}:
${ticketText}

Rules:
- trivial: typo, config change, 1 line fix
- simple: bugfix, 1-3 files, pattern exists in codebase
- moderate: new feature, 3-5 files, new tests needed
- complex: architecture change, cross-cutting, 5+ files

Reply ONLY: trivial, simple, moderate, or complex`;

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
      let result = 'moderate'; // default fallback
      try {
        const json = JSON.parse(stdout);
        const text = (json.result || json.text || stdout).toLowerCase().trim();
        const match = text.match(/\b(trivial|simple|moderate|complex)\b/);
        if (match) result = match[1];
      } catch {
        // Try raw text
        const match = stdout.toLowerCase().match(/\b(trivial|simple|moderate|complex)\b/);
        if (match) result = match[1];
      }
      log('INFO', `Triage result for ${issueKey}`, { complexity: result, models: COMPLEXITY_MODELS[result] });
      resolve(result);
    });

    child.on('error', () => {
      log('WARN', `Triage failed for ${issueKey}, defaulting to moderate`);
      resolve('moderate');
    });

    // Timeout after 30s
    setTimeout(() => {
      child.kill();
      log('WARN', `Triage timeout for ${issueKey}, defaulting to moderate`);
      resolve('moderate');
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

Example good: "Fotograf otwiera sesję prywatną z 5 wybranymi zdjęciami, zakładka 'Zdjęcia do przekazania' pokazuje liczbę 3 (bo 2 są wykluczone)"
Example bad: "deliverable_photos_count zwraca 3 z API response"

## Ryzyka
<niskie/średnie/wysokie - dlaczego>

## OpenSpec
Rekomendacja: TAK / NIE
Powód: <dlaczego - nowa funkcjonalność / zmiana zachowania = TAK, bugfix / config = NIE>

## Environment
- Branch: ${ticketLower}-<short-description> (z staging)
- Repos: fotigo / api-fotigo / oba
- Worktree: <repo>/.worktrees/${ticketLower}-<short-description>

This is a multi-repo project: api-fotigo (PHP backend) + fotigo (React frontend). Always branch from staging.

Save the plan to .devflow/plan-${ticketLower}.md, post it as a Jira comment on ${issueKey}, and transition the ticket to "Plan do akceptacji". Work autonomously, no confirmations needed.
${jiraInstructions}`
    : `Implement the plan for Jira ticket ${issueKey}. Read the plan from .devflow/plan-${ticketLower}.md.

Steps in STRICT order:
1. Check if worktree already exists (it may from a previous run). If yes, use it. If not, create from staging.
2. Write failing tests first (test-first approach)
3. Implement the fixes/features as specified in the plan
4. Run tests and verify they pass
5. Commit changes with conventional commit message (in the worktree, not main repo)
6. Push the branch to origin
7. Run code review (use the df:review skill or review the code yourself)
8. Create PR via gh CLI (gh pr create --base staging)
9. LAST STEP: Post the PR link to Jira and transition ticket status

CRITICAL: Step 7 (review) MUST happen before step 8 (PR). The review-gate hook will block PR creation without a review verdict in .devflow/review-verdict.json.

This is a multi-repo project: api-fotigo (PHP backend) + fotigo (React frontend). Work autonomously.
${jiraInstructions}`;
  // Triage: haiku classifies complexity, then route to right model
  const complexity = await triageComplexity(issueKey);
  const models = COMPLEXITY_MODELS[complexity] || COMPLEXITY_MODELS.moderate;
  const model = phase === 'plan' ? models.plan : models.impl;
  const modelArgs = ['--model', model];

  log('INFO', `Spawning claude`, { issueKey, phase, complexity, model, cwd: PROJECT_CWD });

  // Post start comment to Jira
  if (process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    const phaseLabel = phase === 'plan' ? 'planowanie' : 'implementacj\u0119';
    const startText = `Claude rozpocz\u0105\u0142 ${phaseLabel} [${complexity}/${model}]...`;
    postJiraComment(issueKey, startText);
  }

  const maxTurns = phase === 'plan' ? ['--max-turns', '30'] : ['--max-turns', '80'];

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    ...modelArgs,
    ...maxTurns,
    '--output-format', 'json',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash,Agent,Skill,LSP',
  ], {
    cwd: PROJECT_CWD,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const job = {
    phase,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    lastActivity: '',
    stdoutLines: 0,
    stderrSize: 0,
  };
  activeJobs.set(issueKey, job);

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

    // Post end comment to Jira
    {
      const phaseLabel = phase === 'plan' ? 'Planowanie' : 'Implementacja';
      const status = code === 0 ? 'zako\u0144czone' : 'B\u0141\u0104D';
      const resumePart = sessionId ? ` | claude --resume ${sessionId}` : '';
      postJiraComment(issueKey, `${phaseLabel} ${status}${resumePart}`);
    }

    // macOS notification
    if (process.platform === 'darwin') {
      const title = code === 0 ? `${issueKey}: ${phase} done` : `${issueKey}: ${phase} failed`;
      const msg = sessionId ? `claude --resume ${sessionId}` : 'Check Jira for details';
      exec(`osascript -e 'display notification "${msg}" with title "${title}"'`, { cwd: PROJECT_CWD });
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
        pid: job.pid,
        duration: `${mins}m${secs}s`,
        lastActivity: job.lastActivity,
        outputLines: job.stdoutLines,
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active, totalActive: activeJobs.size }));
    return;
  }

  // Webhook endpoint
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
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

      const spawned = spawnClaude(result.issueKey, result.phase);

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
  console.log(`\nStatus mapping:`);
  for (const [status, phase] of Object.entries(STATUS_PHASE_MAP)) {
    console.log(`  "${status}" → --phase ${phase}`);
  }
  console.log(`\nWaiting for webhooks...\n`);
});
