#!/usr/bin/env node

/**
 * ship-prepare.js - Pre-compute pipeline steps for ship orchestrator.
 *
 * Detects context and determines which steps to run/skip.
 *
 * Usage: node ship-prepare.js [--skip step1,step2] [--auto] [--dry-run] [--draft]
 * Exit 0: success (JSON on stdout)
 * Exit 1: user error (message on stderr)
 */

'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { checkGitState, detectBaseBranch, exec } = require('./lib/git');

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    skip: [],
    auto: args.includes('--auto'),
    dryRun: args.includes('--dry-run'),
    draft: args.includes('--draft'),
  };

  const skipIdx = args.indexOf('--skip');
  if (skipIdx !== -1 && args[skipIdx + 1]) {
    flags.skip = args[skipIdx + 1].split(',').map(s => s.trim());
  }

  return flags;
}

const VALID_STEPS = ['commit', 'review', 'pr'];

function main() {
  const flags = parseArgs(process.argv);
  const cwd = process.cwd();

  // Validate skip values
  const invalidSkips = flags.skip.filter(s => !VALID_STEPS.includes(s));
  if (invalidSkips.length > 0) {
    process.stderr.write(
      `Unknown skip values: ${invalidSkips.join(', ')}\n` +
      `Valid steps: ${VALID_STEPS.join(', ')}\n`
    );
    process.exit(1);
  }

  let gitState;
  try {
    gitState = checkGitState(cwd);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  const baseBranch = detectBaseBranch(cwd);

  // Check gh CLI
  const ghAuth = exec('gh auth status', { cwd });
  const ghAvailable = ghAuth !== null;

  // Check review verdict
  const verdictPath = join(cwd, '.devflow', 'review-verdict.json');
  let verdict = null;
  if (existsSync(verdictPath)) {
    try {
      verdict = JSON.parse(readFileSync(verdictPath, 'utf8'));
    } catch { /* corrupt */ }
  }

  // Build steps
  const steps = [];

  // Commit
  const hasUncommitted = gitState.uncommittedChanges;
  steps.push({
    name: 'commit',
    skill: 'df:commit',
    status: flags.skip.includes('commit') ? 'skipped'
      : hasUncommitted ? 'will_run'
      : 'skipped',
    reason: flags.skip.includes('commit') ? 'in skip set'
      : hasUncommitted ? `${gitState.dirtyFiles.length} uncommitted files`
      : 'no uncommitted changes',
    args: flags.auto ? '--auto' : '',
  });

  // Review
  steps.push({
    name: 'review',
    skill: 'df:review',
    status: flags.skip.includes('review') ? 'skipped' : 'will_run',
    reason: flags.skip.includes('review') ? 'in skip set' : 'code review',
    args: '--committed',
  });

  // PR
  steps.push({
    name: 'pr',
    skill: 'df:pr',
    status: flags.skip.includes('pr') ? 'skipped'
      : !ghAvailable ? 'blocked'
      : 'will_run',
    reason: flags.skip.includes('pr') ? 'in skip set'
      : !ghAvailable ? 'gh CLI not authenticated'
      : 'create pull request',
    args: [flags.auto ? '--auto' : '', flags.draft ? '--draft' : ''].filter(Boolean).join(' '),
  });

  const result = {
    flags,
    context: {
      branch: gitState.currentBranch,
      baseBranch,
      onDefaultBranch: gitState.currentBranch === baseBranch,
      uncommittedFiles: gitState.dirtyFiles.length,
      ghAvailable,
      hasVerdict: verdict !== null,
      verdict: verdict ? verdict.verdict : null,
    },
    steps,
    summary: {
      willRun: steps.filter(s => s.status === 'will_run').length,
      skipped: steps.filter(s => s.status === 'skipped').length,
      blocked: steps.filter(s => s.status === 'blocked').length,
    },
  };

  // Warnings
  result.warnings = [];
  if (result.context.onDefaultBranch) {
    result.warnings.push(`On default branch '${baseBranch}' - create a feature branch first`);
  }
  if (invalidSkips.length > 0) {
    result.warnings.push(`Unknown skip values ignored: ${invalidSkips.join(', ')}`);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
