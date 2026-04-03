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

// Status name (lowercase) → phase
const STATUS_PHASE_MAP = {
  'do realizacji': 'plan',
  'zaakceptowany': 'impl',
};

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

// --- Claude spawning ---

const activeJobs = new Map(); // issueKey → job info

function spawnClaude(issueKey, phase) {
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

Use this exact template for the plan (find it at plugins/devflow/templates/jira/plan-comment.md or use this structure):

# Plan implementacji | ${issueKey}

## Diagnoza
<co jest nie tak / co trzeba zrobic>

## OpenSpec
Rekomendacja: TAK / NIE
Powod: <nowa capability / behavioral change = TAK, bugfix / config = NIE>

## Environment
- Branch: ${ticketLower}-<short-description> (z staging)
- Repos: fotigo / api-fotigo / oba
- Worktree: <repo>/.worktrees/${ticketLower}-<short-description>

## Taski
### Group 1: <nazwa> [sonnet]
Depends on: none
- [ ] 1.1 Write test: <co testujemy>
- [ ] 1.2 Implement: <co zmieniamy> (plik:linia)
- [ ] 1.3 Verify: <komenda>

## E2E Test Plan
- [ ] <scenariusz 1 - happy path>
- [ ] <scenariusz 2 - edge case>

## Ryzyka
<niskie/srednie/wysokie - dlaczego>

This is a multi-repo project: api-fotigo (PHP backend) + fotigo (React frontend). Always branch from staging.

Save the plan to .devflow/plan-${ticketLower}.md, post it as a Jira comment on ${issueKey}, and transition the ticket to "Plan do akceptacji". Work autonomously, no confirmations needed.
${jiraInstructions}`
    : `Implement the plan for Jira ticket ${issueKey}. Read the plan from .devflow/plan-${ticketLower}.md.

Create worktree(s) from staging branch as specified in the plan. Execute the plan, then ship (commit, review with auto-fix up to 2 attempts, PR). Post the PR link to Jira and transition to "PR gotowy". If review fails after 2 auto-fix attempts, post the issue list and transition to "Wymaga uwagi".

This is a multi-repo project: api-fotigo (PHP backend) + fotigo (React frontend). Work autonomously.
${jiraInstructions}`;
  log('INFO', `Spawning claude`, { issueKey, phase, prompt: prompt.slice(0, 80) + '...', cwd: PROJECT_CWD });

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
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

    // Post session ID to Jira as comment (for interactive resume)
    if (sessionId && process.env.JIRA_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
      const phaseLabel = phase === 'plan' ? 'Planowanie' : 'Implementacja';
      const statusEmoji = code === 0 ? 'ok' : 'blad';
      const resumeCmd = `claude --resume ${sessionId}`;
      const commentText = `${phaseLabel} zakonczone (${statusEmoji}). Session: ${resumeCmd}`;

      const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
      const body = JSON.stringify({
        body: { type: 'doc', version: 1, content: [
          { type: 'paragraph', content: [{ type: 'text', text: commentText }] }
        ]}
      });

      const url = new URL(`/rest/api/3/issue/${issueKey}/comment`, process.env.JIRA_URL);
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      };

      const req = require('node:https').request(url, options, (res) => {
        log('INFO', `Session comment posted to ${issueKey}`, { sessionId, status: res.statusCode });
      });
      req.on('error', (err) => {
        log('WARN', `Failed to post session comment`, { issueKey, error: err.message });
      });
      req.write(body);
      req.end();
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
