#!/usr/bin/env node

/**
 * branch-guard.js - PreToolUse hook for Bash
 * Blocks git commit/push to protected branches (main, master, staging).
 *
 * Reads the tool input from stdin (JSON with tool_input.command).
 * Exits 0 to allow, exits 2 to block with message on stdout.
 */

'use strict';

const PROTECTED_BRANCHES = ['main', 'master', 'staging'];

// Patterns that indicate a commit or push on a protected branch
// NOTE: git merge is intentionally NOT blocked - merging feature branches
// into staging/main is a normal workflow operation
const DANGEROUS_PATTERNS = [
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
];

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    // Can't parse - allow through
    process.exit(0);
  }

  const command = data?.tool_input?.command || '';

  // Check if command is a dangerous git operation
  const isDangerous = DANGEROUS_PATTERNS.some(p => p.test(command));
  if (!isDangerous) {
    process.exit(0);
  }

  // Get current branch
  const { execSync } = require('node:child_process');
  let branch;
  try {
    branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  } catch {
    // Not in a git repo - allow through
    process.exit(0);
  }

  if (PROTECTED_BRANCHES.includes(branch)) {
    // Check if it's a push to a specific branch (might be pushing from a feature branch)
    const pushToOtherBranch = /\bgit\s+push\s+\S+\s+(?!main|master|staging)\S+/.test(command);
    if (pushToOtherBranch) {
      process.exit(0);
    }

    process.stdout.write(
      `BLOCKED: Cannot ${command.includes('push') ? 'push' : 'commit'} on protected branch '${branch}'. ` +
      `Create a worktree first: /df:worktree create <branch-name>`
    );
    process.exit(2);
  }

  process.exit(0);
}

main();
