#!/usr/bin/env node

/**
 * review-gate.js - PreToolUse hook for Bash
 * Blocks PR creation if no review verdict exists or verdict has critical/high findings.
 *
 * Reads tool input from stdin (JSON with tool_input.command).
 * Exits 0 to allow, exits 2 to block with message on stdout.
 */

'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const command = data?.tool_input?.command || '';

  // Only check gh pr create
  if (!/\bgh\s+pr\s+create\b/.test(command)) {
    process.exit(0);
  }

  // Find review verdict
  const cwd = process.cwd();
  const verdictPath = join(cwd, '.devflow', 'review-verdict.json');

  if (!existsSync(verdictPath)) {
    process.stdout.write(
      'BLOCKED: No review verdict found. Run /df:review before creating a PR.\n' +
      'To skip: create PR manually with `gh pr create` outside of Claude Code.'
    );
    process.exit(2);
  }

  let verdict;
  try {
    verdict = JSON.parse(readFileSync(verdictPath, 'utf8'));
  } catch {
    process.stdout.write('BLOCKED: Review verdict file is corrupt. Re-run /df:review.');
    process.exit(2);
  }

  if (verdict.verdict === 'CHANGES_REQUESTED') {
    const { critical = 0, high = 0 } = verdict.counts || {};
    process.stdout.write(
      `BLOCKED: Review verdict is CHANGES_REQUESTED (${critical} critical, ${high} high).\n` +
      'Fix the findings and re-run /df:review, or address with /df:commit.'
    );
    process.exit(2);
  }

  // APPROVED or APPROVED_WITH_NOTES - allow
  process.exit(0);
}

main();
