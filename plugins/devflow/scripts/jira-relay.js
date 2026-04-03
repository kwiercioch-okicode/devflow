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
const { spawn } = require('node:child_process');
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

const activeJobs = new Map(); // issueKey → child process

function spawnClaude(issueKey, phase) {
  // Prevent duplicate runs for same ticket
  if (activeJobs.has(issueKey)) {
    log('WARN', `Already running for ${issueKey}, skipping`);
    return false;
  }

  const prompt = phase === 'plan'
    ? `Fetch Jira ticket ${issueKey}, analyze the codebase, generate an implementation plan, post it as a Jira comment, and transition the ticket to "Plan do akceptacji". Use the df:jira, df:plan skills. Work autonomously, no confirmations needed.`
    : `Implement the plan for Jira ticket ${issueKey}. Create a worktree, execute the plan, then ship (commit, review, PR). Post the PR link to Jira and transition to "PR gotowy". If review fails after 2 auto-fix attempts, transition to "Wymaga uwagi". Use df:worktree, df:execute, df:ship, df:jira skills. Work autonomously.`;
  log('INFO', `Spawning claude`, { issueKey, phase, prompt: prompt.slice(0, 80) + '...', cwd: PROJECT_CWD });

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash,Agent,Skill,LSP,mcp__atlassian__getJiraIssue,mcp__atlassian__addCommentToJiraIssue',
  ], {
    cwd: PROJECT_CWD,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  activeJobs.set(issueKey, { phase, pid: child.pid, startedAt: new Date().toISOString() });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.on('close', (code) => {
    activeJobs.delete(issueKey);
    log(code === 0 ? 'INFO' : 'ERROR', `Claude exited`, {
      issueKey, phase, code,
      stdout: stdout.slice(-500),
      stderr: stderr.slice(-500),
    });
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active: Object.fromEntries(activeJobs),
      config: { port: PORT, cwd: PROJECT_CWD, claudeBin: CLAUDE_BIN },
    }));
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
