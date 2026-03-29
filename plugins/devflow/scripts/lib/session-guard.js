#!/usr/bin/env node

/**
 * session-guard.js - SessionStart hook
 * Detects active worktrees and injects context into conversation.
 *
 * Outputs a message that Claude sees at session start, reminding
 * about active worktrees and enforcing work in .worktrees/ directory.
 */

'use strict';

const { execSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main() {
  // Find all git repos in current directory and parent
  const cwd = process.cwd();
  const repos = [];

  // Check if cwd is a git repo
  if (exec('git rev-parse --is-inside-work-tree')) {
    repos.push({ name: require('node:path').basename(cwd), path: cwd });
  }

  // Check for .dev-env.yml to find multi-repo setup
  const devEnvPaths = [
    join(cwd, '.dev-env.yml'),
    join(cwd, '..', '.dev-env.yml'),
  ];

  for (const devEnvPath of devEnvPaths) {
    if (existsSync(devEnvPath)) {
      const content = readFileSync(devEnvPath, 'utf8');
      const pathMatches = content.match(/path:\s*\.\/(\S+)/g);
      if (pathMatches) {
        const parentDir = require('node:path').dirname(devEnvPath);
        for (const match of pathMatches) {
          const repoPath = match.replace(/path:\s*\.\//, '');
          const fullPath = join(parentDir, repoPath);
          if (existsSync(join(fullPath, '.git'))) {
            const name = require('node:path').basename(fullPath);
            if (!repos.find(r => r.name === name)) {
              repos.push({ name, path: fullPath });
            }
          }
        }
      }
      break;
    }
  }

  if (repos.length === 0) {
    process.exit(0);
  }

  // Check each repo for worktrees
  const warnings = [];

  for (const repo of repos) {
    const branch = exec(`git -C "${repo.path}" branch --show-current`);
    const worktreeOutput = exec(`git -C "${repo.path}" worktree list`);

    if (!worktreeOutput) continue;

    const worktreeLines = worktreeOutput.split('\n').filter(line => {
      // Skip the main worktree line
      return line.includes('[') && !line.startsWith(repo.path + ' ');
    });

    if (worktreeLines.length > 0) {
      const wtDetails = worktreeLines.map(line => {
        const match = line.match(/^(\S+)\s+\S+\s+\[(.+)\]/);
        return match ? `  ${match[1]}  [${match[2]}]` : `  ${line.trim()}`;
      }).join('\n');

      warnings.push(
        `WORKTREE GUARD: ${repo.name} is on branch '${branch}' with active worktrees:\n` +
        wtDetails + '\n' +
        '-> Edit files in .worktrees/<name>/, not on main branch.'
      );
    }
  }

  if (warnings.length > 0) {
    process.stdout.write(warnings.join('\n'));
  }

  process.exit(0);
}

main();
