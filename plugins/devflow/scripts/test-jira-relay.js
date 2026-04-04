#!/usr/bin/env node

/**
 * E2E scenario tests for jira-relay.js
 *
 * Tests the relay server by starting it on a random port with mocked
 * Claude binary and Jira API, then exercising scenarios via HTTP.
 *
 * Output: SCENARIOS_PASSED: X/Y (metric for autoresearch)
 *
 * THIS FILE IS THE VERIFY HARNESS - DO NOT MODIFY DURING AUTORESEARCH.
 */

'use strict';

const http = require('node:http');
const { spawn, execSync } = require('node:child_process');
const { join } = require('node:path');
const { mkdirSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const os = require('node:os');

// --- Test infrastructure ---

const RELAY_SCRIPT = join(__dirname, 'jira-relay.js');
const TEST_CWD = join(os.tmpdir(), `jira-relay-test-${Date.now()}`);
const MOCK_CLAUDE = join(TEST_CWD, 'mock-claude.sh');
const PORT = 13333 + Math.floor(Math.random() * 1000);

let relayProcess = null;
const results = [];

function setup() {
  mkdirSync(join(TEST_CWD, '.devflow'), { recursive: true });
  mkdirSync(join(TEST_CWD, '.git'), { recursive: true }); // fake git repo

  // Write relay-config.json
  writeFileSync(join(TEST_CWD, '.devflow', 'relay-config.json'), JSON.stringify({
    baseBranch: 'staging',
    repos: 'test-repo',
    testCommand: 'echo ok',
    prBase: 'staging',
  }));

  // Mock claude binary that just exits 0 and outputs JSON
  writeFileSync(MOCK_CLAUDE, '#!/bin/bash\nsleep 0.3\necho \'{"result":"done","session_id":"test-session-123"}\'\nexit 0\n');
  execSync(`chmod +x "${MOCK_CLAUDE}"`);

  // Write a fake plan file for impl phase outcome validation
  writeFileSync(join(TEST_CWD, '.devflow', 'plan-test-1.md'), '# Test plan');
}

function cleanup() {
  if (relayProcess) {
    relayProcess.kill('SIGTERM');
    relayProcess = null;
  }
  try { rmSync(TEST_CWD, { recursive: true, force: true }); } catch {}
}

function startRelay(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CLAUDE_BIN: MOCK_CLAUDE,
      JIRA_URL: 'https://test.atlassian.net',
      JIRA_EMAIL: 'test@test.com',
      JIRA_API_TOKEN: 'fake-token',
      ...extraEnv,
    };

    relayProcess = spawn('node', [RELAY_SCRIPT, '--port', String(PORT), '--cwd', TEST_CWD], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Relay startup timeout'));
    }, 5000);

    relayProcess.stdout.on('data', (chunk) => {
      if (!started && chunk.toString().includes('Waiting for webhooks')) {
        started = true;
        clearTimeout(timeout);
        // Give it a moment to bind
        setTimeout(() => resolve(), 100);
      }
    });

    relayProcess.on('error', reject);
    relayProcess.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Relay exited with code ${code}`));
      }
    });
  });
}

function stopRelay() {
  return new Promise((resolve) => {
    if (!relayProcess) return resolve();
    relayProcess.on('exit', () => resolve());
    relayProcess.kill('SIGTERM');
    relayProcess = null;
    setTimeout(resolve, 500); // fallback
  });
}

function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 3000,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: data, json: parsed });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// --- Scenarios ---

async function runScenarios() {
  // --- HTTP endpoint tests ---

  await scenario('GET /health returns 200 with status ok', async () => {
    const res = await httpRequest('GET', '/health');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'ok', `body: ${res.body}`);
    assert(typeof res.json?.uptime === 'number', 'no uptime');
  });

  await scenario('GET /status returns 200 with activeJobs structure', async () => {
    const res = await httpRequest('GET', '/status');
    assert(res.status === 200, `status ${res.status}`);
    assert(typeof res.json?.totalActive === 'number', `no totalActive: ${res.body}`);
    assert(typeof res.json?.active === 'object', 'no active object');
  });

  await scenario('GET /unknown returns 404', async () => {
    const res = await httpRequest('GET', '/unknown');
    assert(res.status === 404, `status ${res.status}`);
  });

  await scenario('POST /unknown returns 404', async () => {
    const res = await httpRequest('POST', '/unknown', { test: true });
    assert(res.status === 404, `status ${res.status}`);
  });

  // --- Webhook payload parsing ---

  await scenario('POST /webhook with valid plan status returns spawned', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-1' },
      transition: { to_status: 'Do realizacji' },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'spawned', `not spawned: ${res.body}`);
    assert(res.json?.phase === 'plan', `wrong phase: ${res.json?.phase}`);
    // Wait for mock claude to finish
    await new Promise(r => setTimeout(r, 1000));
  });

  await scenario('POST /webhook with valid impl status returns spawned', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-2' },
      transition: { to_status: 'Zaakceptowany' },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'spawned', `not spawned: ${res.body}`);
    assert(res.json?.phase === 'impl', `wrong phase: ${res.json?.phase}`);
    await new Promise(r => setTimeout(r, 1000));
  });

  await scenario('POST /webhook with Jira standard format (changelog)', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-3', fields: { status: { name: 'Do realizacji' } } },
      changelog: { items: [{ field: 'status', toString: 'Do realizacji' }] },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'spawned', `not spawned: ${res.body}`);
    assert(res.json?.phase === 'plan', `wrong phase: ${res.json?.phase}`);
    await new Promise(r => setTimeout(r, 1000));
  });

  await scenario('POST /webhook with status from fields fallback', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-4', fields: { status: { name: 'Zaakceptowany' } } },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'spawned', `not spawned: ${res.body}`);
    assert(res.json?.phase === 'impl', `wrong phase: ${res.json?.phase}`);
    await new Promise(r => setTimeout(r, 1000));
  });

  await scenario('POST /webhook with invalid JSON returns 400', async () => {
    const res = await httpRequest('POST', '/webhook', 'not json{{{');
    assert(res.status === 400, `status ${res.status}`);
  });

  await scenario('POST /webhook with no issue key returns 400', async () => {
    const res = await httpRequest('POST', '/webhook', { foo: 'bar' });
    assert(res.status === 400, `status ${res.status}`);
  });

  await scenario('POST /webhook with unknown status returns 200 ignored', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-5' },
      transition: { to_status: 'Nieznany Status' },
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'ignored', `not ignored: ${res.body}`);
  });

  await scenario('POST /webhook duplicate job returns already_running', async () => {
    // Spawn a job that takes a while
    const res1 = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-900' },
      transition: { to_status: 'Do realizacji' },
    });
    assert(res1.json?.status === 'spawned', `first not spawned: ${res1.body}`);

    // Immediately try same ticket
    const res2 = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-900' },
      transition: { to_status: 'Do realizacji' },
    });
    assert(res2.json?.status === 'already_running', `second not blocked: ${res2.body}`);

    await new Promise(r => setTimeout(r, 1000));
  });

  await scenario('GET /status shows active job during execution', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-901' },
      transition: { to_status: 'Do realizacji' },
    });
    assert(res.json?.status === 'spawned', `not spawned: ${res.body}`);

    // Immediately check status
    const status = await httpRequest('GET', '/status');
    assert(status.json?.totalActive >= 1, `no active jobs: ${status.body}`);

    await new Promise(r => setTimeout(r, 1000));
  });

  // --- Prompt quality checks ---

  await scenario('Plan prompt includes Polish characters instruction', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Polish') || src.includes('polsk'), 'no Polish instruction in plan prompt');
    assert(src.includes('Diagnoza'), 'no Diagnoza section in plan template');
    assert(src.includes('Taski'), 'no Taski section');
    assert(src.includes('E2E Test Plan') || src.includes('E2E'), 'no E2E section');
    assert(src.includes('Ryzyka'), 'no Ryzyka section');
    assert(src.includes('Environment'), 'no Environment section');
  });

  await scenario('Impl prompt includes review step', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('CODE REVIEW') || src.includes('review'), 'no review step in impl prompt');
    assert(src.includes('Security') || src.includes('security'), 'no security in review');
    assert(src.includes('review-verdict') || src.includes('verdict'), 'no verdict file');
  });

  await scenario('Impl prompt has resume logic for existing worktrees', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('worktree already has commits') || src.includes('previous run'), 'no resume logic');
    assert(src.includes('gh pr list'), 'no PR check in resume');
  });

  await scenario('Status mapping covers all expected Jira statuses', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes("'do realizacji'"), 'missing do realizacji mapping');
    assert(src.includes("'zaakceptowany'"), 'missing zaakceptowany mapping');
  });

  await scenario('Triage routes to correct models by complexity', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('trivial'), 'no trivial routing');
    assert(src.includes('simple'), 'no simple routing');
    assert(src.includes('moderate'), 'no moderate routing');
    assert(src.includes('complex'), 'no complex routing');
    assert(src.includes('haiku'), 'no haiku for triage');
  });

  await scenario('Outcome validation posts PR link on success', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('PR:') || src.includes('prUrl'), 'no PR link posting');
    assert(src.includes("'PR gotowy'") || src.includes('PR gotowy'), 'no PR gotowy transition');
  });

  await scenario('Failure outcome transitions to Wymaga uwagi', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Wymaga uwagi'), 'no Wymaga uwagi transition');
  });

  await scenario('Session ID extracted and posted in Jira comment', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('session_id'), 'no session_id extraction');
    assert(src.includes('resume'), 'no resume command in comment');
  });

  await scenario('macOS notification sent on completion', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('osascript') || src.includes('notification'), 'no macOS notification');
  });

  // --- Error handling and robustness ---

  await scenario('POST /webhook with empty body returns 400', async () => {
    const res = await httpRequest('POST', '/webhook', '');
    assert(res.status === 400, `status ${res.status}`);
  });

  await scenario('POST /webhook with issue key but no status returns error', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST-902' },
    });
    // Should return 200 with ignored (has issue key but no valid status)
    assert(res.status === 200, `status ${res.status}`);
    assert(res.json?.status === 'ignored', `not ignored: ${res.body}`);
  });

  await scenario('Relay survives rapid sequential webhooks', async () => {
    // Fire 5 webhooks rapidly for different tickets
    const promises = [];
    for (let i = 100; i < 105; i++) {
      promises.push(httpRequest('POST', '/webhook', {
        issue: { key: `TEST-${i}` },
        transition: { to_status: 'Do realizacji' },
      }));
    }
    const results = await Promise.all(promises);
    const spawned = results.filter(r => r.json?.status === 'spawned').length;
    assert(spawned === 5, `only ${spawned}/5 spawned`);
    await new Promise(r => setTimeout(r, 2000));
  });

  await scenario('Webhook secret validation rejects unauthorized', async () => {
    // This tests the code path - relay was started without secret so it should accept all
    // Verify the code handles the secret check path
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('WEBHOOK_SECRET'), 'no webhook secret support');
    assert(src.includes('401') || src.includes('Unauthorized'), 'no 401 response for bad secret');
  });

  await scenario('Impl prompt instructs max 2 fix attempts on failure', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('max 2 attempts') || src.includes('max 2'), 'no retry limit in impl prompt');
  });

  await scenario('Plan prompt includes OpenSpec recommendation section', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('OpenSpec'), 'no OpenSpec section in plan prompt');
    assert(src.includes('Rekomendacja') || src.includes('TAK') || src.includes('NIE'), 'no OpenSpec recommendation');
  });

  await scenario('Relay loads project config from .devflow/relay-config.json', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('relay-config.json'), 'no relay-config.json loading');
    assert(src.includes('baseBranch'), 'no baseBranch config');
    assert(src.includes('prBase'), 'no prBase config');
  });

  await scenario('Relay logs to .devflow/jira-relay.log', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('jira-relay.log'), 'no log file');
    assert(src.includes('appendFileSync'), 'no file append for logging');
  });

  // --- Observability and error recovery ---

  await scenario('Impl prompt tells Claude not to call Jira API directly', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // Claude should NOT call Jira in impl phase - relay handles it
    assert(src.includes('relay will handle Jira') || src.includes('Do NOT try to call Jira'), 'impl prompt missing relay delegation');
  });

  await scenario('Plan prompt tells Claude to post plan as Jira comment', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('post it as a Jira comment') || src.includes('Jira comment'), 'plan prompt missing Jira comment instruction');
  });

  await scenario('Relay handles concurrent webhooks for different tickets', async () => {
    // Fire 3 webhooks for different tickets simultaneously
    const [r1, r2, r3] = await Promise.all([
      httpRequest('POST', '/webhook', { issue: { key: 'CONC-1' }, transition: { to_status: 'Do realizacji' } }),
      httpRequest('POST', '/webhook', { issue: { key: 'CONC-2' }, transition: { to_status: 'Do realizacji' } }),
      httpRequest('POST', '/webhook', { issue: { key: 'CONC-3' }, transition: { to_status: 'Zaakceptowany' } }),
    ]);
    assert(r1.json?.status === 'spawned', `CONC-1 not spawned: ${r1.body}`);
    assert(r2.json?.status === 'spawned', `CONC-2 not spawned: ${r2.body}`);
    assert(r3.json?.status === 'spawned', `CONC-3 not spawned: ${r3.body}`);
    await new Promise(r => setTimeout(r, 2000));
  });

  await scenario('Health endpoint includes activeJobs count', async () => {
    const res = await httpRequest('GET', '/health');
    assert(typeof res.json?.activeJobs === 'object', `no activeJobs in health: ${res.body}`);
  });

  await scenario('Outcome validation handles exec errors gracefully', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // exec calls for gh/git should be wrapped or have fallbacks
    assert(src.includes('2>/dev/null') || src.includes('catch'), 'no error suppression in exec calls');
  });

  await scenario('Impl prompt specifies all 10 required steps', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // Check that the prompt mentions steps 1-10
    for (let i = 1; i <= 10; i++) {
      assert(src.includes(`${i}.`) || src.includes(`${i}. `), `missing step ${i} in impl prompt`);
    }
  });

  await scenario('Triage prompt has clear complexity criteria', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('trivial:') || src.includes('trivial -'), 'no trivial criteria');
    assert(src.includes('simple:') || src.includes('simple -'), 'no simple criteria');
    assert(src.includes('moderate:') || src.includes('moderate -'), 'no moderate criteria');
    assert(src.includes('complex:') || src.includes('complex -'), 'no complex criteria');
  });

  // --- Robustness: error recovery, limits, shutdown ---

  await scenario('Relay has graceful shutdown handler', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('SIGTERM') || src.includes('graceful'), 'no graceful shutdown');
    assert(src.includes('SIGINT'), 'no SIGINT handler');
  });

  await scenario('Relay has request body size limit', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('MAX_BODY_SIZE') || src.includes('too large') || src.includes('413'), 'no body size limit');
  });

  await scenario('Outcome exec calls are wrapped in try/catch', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // The outcome validation block should have try/catch around exec calls
    const outcomeSection = src.slice(src.indexOf('Find PR by'));
    assert(outcomeSection.includes('try {') && outcomeSection.includes('catch'), 'exec calls not wrapped in try/catch');
  });

  await scenario('Relay handles osascript failure gracefully', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // osascript call should not crash relay if it fails (e.g. on Linux)
    // Check it's inside the platform check at minimum
    assert(src.includes("process.platform === 'darwin'"), 'osascript not guarded by platform check');
  });

  // --- Prompt quality: deeper checks ---

  await scenario('Plan prompt has good/bad E2E scenario examples', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Example good') || src.includes('example good'), 'no good E2E example');
    assert(src.includes('Example bad') || src.includes('example bad'), 'no bad E2E example');
  });

  await scenario('Impl prompt specifies what to do when tests fail', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('step fails') || src.includes('tests fail'), 'no test failure handling instruction');
  });

  await scenario('Plan prompt saves plan to .devflow/plan-<ticket>.md', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('.devflow/plan-'), 'no plan file path in prompt');
  });

  await scenario('Impl prompt reads plan from .devflow/plan-<ticket>.md', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Read the plan') || src.includes('.devflow/plan-'), 'impl prompt missing plan read instruction');
  });

  await scenario('Triage timeout prevents hanging', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('setTimeout') && src.includes('30000'), 'no triage timeout');
  });

  await scenario('Jira comment includes complexity and model info', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('complexity') && src.includes('model'), 'start comment missing complexity/model');
  });

  await scenario('Triage defaults to moderate on unknown complexity', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // Multiple fallback points should default to moderate
    const moderateCount = (src.match(/moderate/g) || []).length;
    assert(moderateCount >= 3, `only ${moderateCount} moderate references, expected >=3 fallbacks`);
  });

  await scenario('osascript wrapped in try/catch', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    const osascriptIdx = src.indexOf('osascript');
    const surrounding = src.slice(Math.max(0, osascriptIdx - 400), osascriptIdx + 100);
    assert(surrounding.includes('try {') || surrounding.includes('try{'), 'osascript not in try/catch');
  });

  // --- Security ---

  await scenario('No command injection via issue key in exec calls', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // Issue key should be validated or quoted in exec calls
    // Check that issueKey goes through parsePayload which extracts from JSON
    assert(src.includes('data?.issue?.key'), 'issue key not safely extracted');
    // exec calls should use quoted paths
    assert(!src.includes('exec(`git ' + '${issueKey}'), 'raw issueKey in exec - injection risk');
  });

  await scenario('No secrets logged in plain text', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // JIRA_API_TOKEN should not appear in log() calls
    const logCalls = src.split('\n').filter(l => l.includes('log('));
    for (const line of logCalls) {
      assert(!line.includes('JIRA_API_TOKEN'), `token in log: ${line.trim()}`);
      assert(!line.includes('API_TOKEN'), `token in log: ${line.trim()}`);
    }
  });

  await scenario('Webhook response does not leak internal paths', async () => {
    // Send invalid webhook, check response doesn't expose server internals
    const res = await httpRequest('POST', '/webhook', { issue: { key: 'SEC-1' }, transition: { to_status: 'Unknown' } });
    assert(!res.body.includes(TEST_CWD), 'response leaks internal path');
    assert(!res.body.includes('/Users/'), 'response leaks user path');
  });

  await scenario('Issue key format is validated', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('data?.issue?.key'), 'no safe issue key extraction');
    // Should have regex validation for PROJECT-123 format
    assert(src.includes('[A-Z]') && src.includes('\\d+'), 'no issue key format validation regex');
  });

  await scenario('Malicious issue key is rejected', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: '"; rm -rf /' },
      transition: { to_status: 'Do realizacji' },
    });
    // Should be rejected (400) because key doesn't match [A-Z]+-\d+ format
    assert(res.status === 400, `malicious key not rejected: ${res.status} ${res.body}`);
  });

  await scenario('Issue key with spaces is rejected', async () => {
    const res = await httpRequest('POST', '/webhook', {
      issue: { key: 'TEST 1' },
      transition: { to_status: 'Do realizacji' },
    });
    assert(res.status === 400, `key with spaces not rejected: ${res.status}`);
  });

  // --- Prompt completeness: deeper validation ---

  await scenario('Impl prompt includes worktree creation from baseBranch', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Create worktree') || src.includes('worktree'), 'no worktree instruction');
    assert(src.includes('baseBranch') || src.includes('PROJECT_CONFIG.baseBranch'), 'no baseBranch reference');
  });

  await scenario('Impl prompt includes git push with -u flag', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('push -u') || src.includes('push -u origin'), 'no -u flag in push instruction');
  });

  await scenario('Impl prompt includes gh pr create with --base', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('gh pr create') || src.includes('pr create'), 'no gh pr create');
    assert(src.includes('--base') || src.includes('prBase'), 'no --base in PR creation');
  });

  await scenario('Plan prompt transition target is Plan do akceptacji', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Plan do akceptacji'), 'wrong transition target in plan prompt');
  });

  await scenario('Relay uses --dangerously-skip-permissions flag', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('--dangerously-skip-permissions'), 'missing --dangerously-skip-permissions');
    assert(src.includes('--allow-dangerously-skip-permissions'), 'missing --allow-dangerously-skip-permissions');
  });

  await scenario('Relay uses --output-format json for session ID extraction', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes("'--output-format', 'json'") || src.includes('"--output-format"'), 'no --output-format json');
  });

  await scenario('Claude process has timeout protection', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('PROCESS_TIMEOUT') || src.includes('processTimer'), 'no process timeout');
    assert(src.includes('clearTimeout'), 'timeout not cleared on normal exit');
    assert(src.includes('SIGTERM') || src.includes('SIGKILL'), 'no kill on timeout');
  });

  await scenario('GET /logs returns recent log entries', async () => {
    const res = await httpRequest('GET', '/logs');
    assert(res.status === 200, `status ${res.status}`);
    // Should have at least some log content from startup
    assert(res.body.length > 0, 'empty log response');
  });

  await scenario('GET /logs?lines=5 limits output', async () => {
    const res = await httpRequest('GET', '/logs?lines=5');
    assert(res.status === 200, `status ${res.status}`);
    const lineCount = res.body.split('\n').filter(Boolean).length;
    assert(lineCount <= 5, `too many lines: ${lineCount}`);
  });

  await scenario('Status endpoint includes complexity and model per job', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // Status response should include complexity and model
    assert(src.includes("job.complexity") || src.includes("complexity:"), 'no complexity in status');
    assert(src.includes("job.model") || src.includes("model:"), 'no model in status');
  });

  await scenario('Plan timeout is shorter than impl timeout', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes("15 * 60") || src.includes("15*60"), 'no plan-specific timeout');
    assert(src.includes("60 * 60") || src.includes("60*60"), 'no impl-specific timeout');
  });

  await scenario('Status endpoint includes uptime and config', async () => {
    const res = await httpRequest('GET', '/status');
    assert(typeof res.json?.uptime === 'number', `no uptime: ${res.body}`);
    assert(typeof res.json?.config === 'object', `no config: ${res.body}`);
    assert(typeof res.json?.config?.jiraConfigured === 'boolean', 'no jiraConfigured flag');
  });

  await scenario('Relay warns about missing Jira credentials on startup', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('Jira credentials not configured') || src.includes('credentials'), 'no startup Jira warning');
  });

  // --- Enhanced triage ---

  await scenario('Triage prompt asks for quality score', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('QUALITY') && src.includes('1-5'), 'triage prompt missing quality score');
  });

  await scenario('Triage prompt asks for scope (which repo)', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('SCOPE'), 'triage prompt missing scope');
  });

  await scenario('Low quality ticket is rejected with Jira comment', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('quality') && (src.includes('Wymaga uwagi') || src.includes('wymaga')), 'no quality gate rejection');
  });

  await scenario('Duplicate detection checks existing PRs before spawn', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // Should check for existing PR/worktree BEFORE spawning Claude
    assert(src.includes('detectDuplicate') || src.includes('existingPr') || src.includes('duplicate'), 'no duplicate detection before spawn');
  });

  await scenario('Triage result includes scope in job object', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('job.scope') || src.includes("scope:"), 'no scope in job');
  });

  await scenario('Triage start comment includes scope info', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('scope') && src.includes('postJiraComment'), 'start comment missing scope');
  });

  await scenario('Relay cleans up worktree after successful impl', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    assert(src.includes('worktree remove') || src.includes('worktree cleanup'), 'no worktree cleanup in relay');
    assert(src.includes('Worktree cleaned up') || src.includes('Worktree cleanup'), 'no cleanup log message');
  });

  await scenario('PR detection searches sub-repos not just PROJECT_CWD', async () => {
    const src = require('node:fs').readFileSync(RELAY_SCRIPT, 'utf8');
    // gh pr list must run from actual git repo dirs, not Docker root
    assert(src.includes('readdirSync') || src.includes('sub-repo') || src.includes('findGitRepos') || src.includes('.git'), 'PR detection does not search sub-repos');
  });
}

// --- Main ---

async function main() {
  setup();

  try {
    await startRelay();
    await runScenarios();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
  } finally {
    await stopRelay();
    cleanup();
  }

  // Print results
  const passed = results.filter(r => r.pass).length;
  const total = results.length;

  console.log('\n=== Jira Relay E2E Scenarios ===');
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${r.name}${r.error ? ` - ${r.error}` : ''}`);
  }
  console.log(`\nSCENARIOS_PASSED: ${passed}/${total}`);
  console.log(passed); // raw metric for autoresearch
}

main();
