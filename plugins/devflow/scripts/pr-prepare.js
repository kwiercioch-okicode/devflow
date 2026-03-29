#!/usr/bin/env node

/**
 * pr-prepare.js - Pre-compute data for PR creation.
 *
 * Outputs JSON with:
 * - structured commits
 * - diff stat
 * - remote state (branch exists? ahead/behind?)
 * - PR template discovery
 * - review verdict (if exists)
 *
 * Usage: node pr-prepare.js [--base <branch>] [--draft] [--auto]
 * Exit 0: success (JSON on stdout)
 * Exit 1: user error (message on stderr)
 * Exit 2: script error
 */

'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { checkGitState, detectBaseBranch, getCommitLog, getCommitCount, getDiffStat, getRemoteState } = require('./lib/git');
const { discoverMultiRepo, discoverPrTemplate } = require('./lib/discovery');

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    base: null,
    draft: args.includes('--draft'),
    auto: args.includes('--auto'),
  };

  const baseIdx = args.indexOf('--base');
  if (baseIdx !== -1 && args[baseIdx + 1]) {
    flags.base = args[baseIdx + 1];
  }

  return flags;
}

function loadReviewVerdict(cwd) {
  const verdictPath = join(cwd, '.devflow', 'review-verdict.json');
  if (!existsSync(verdictPath)) return null;

  try {
    return JSON.parse(readFileSync(verdictPath, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const flags = parseArgs(process.argv);
  const cwd = process.cwd();

  let gitState;
  try {
    gitState = checkGitState(cwd);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  const baseBranch = flags.base || detectBaseBranch(cwd);

  // Check we're not on the base branch
  if (gitState.currentBranch === baseBranch) {
    process.stderr.write(
      `Currently on '${baseBranch}' - create a feature branch first.\n` +
      'Use: /df:worktree create <branch-name>\n'
    );
    process.exit(1);
  }

  const commitCount = getCommitCount(cwd, { base: baseBranch });
  if (commitCount === 0) {
    process.stderr.write(`No commits found between '${baseBranch}' and '${gitState.currentBranch}'.\n`);
    process.exit(1);
  }

  const commits = getCommitLog(cwd, { base: baseBranch });
  const diffStat = getDiffStat(cwd, { base: baseBranch });
  const remoteState = getRemoteState(cwd);
  const prTemplate = discoverPrTemplate(cwd);
  const multiRepo = discoverMultiRepo(cwd);
  const verdict = loadReviewVerdict(cwd);

  // Count changed files from diff stat
  const diffLines = diffStat.split('\n').filter(Boolean);
  const summaryLine = diffLines[diffLines.length - 1] || '';
  const filesChangedMatch = summaryLine.match(/(\d+) files? changed/);
  const filesChanged = filesChangedMatch ? parseInt(filesChangedMatch[1], 10) : 0;

  const result = {
    flags,
    git: {
      branch: gitState.currentBranch,
      baseBranch,
      commitCount,
      commits: commits.map(c => ({ hash: c.shortHash, subject: c.subject, body: c.body })),
      diffStat,
      filesChanged,
      uncommittedChanges: gitState.uncommittedChanges,
      dirtyFileCount: gitState.dirtyFiles.length,
    },
    remote: {
      ...remoteState,
      needsPush: !remoteState.hasRemote || remoteState.ahead > 0,
    },
    prTemplate: prTemplate.found
      ? { found: true, path: prTemplate.path, content: prTemplate.content }
      : { found: false },
    review: verdict
      ? {
          hasVerdict: true,
          verdict: verdict.verdict,
          counts: verdict.counts,
          timestamp: verdict.timestamp,
        }
      : { hasVerdict: false },
    context: {
      multiRepo: multiRepo.isMultiRepo,
      repos: multiRepo.repos.map(r => r.name),
    },
    warnings: [],
  };

  // Warnings
  if (gitState.uncommittedChanges) {
    result.warnings.push(`${gitState.dirtyFiles.length} uncommitted file(s) - consider committing first`);
  }
  if (!verdict) {
    result.warnings.push('No review verdict found - consider running /df:review first');
  } else if (verdict.verdict === 'CHANGES_REQUESTED') {
    result.warnings.push(`Review verdict: CHANGES_REQUESTED (${verdict.counts.critical} critical, ${verdict.counts.high} high)`);
  }
  if (filesChanged > 500) {
    result.warnings.push(`Large PR: ${filesChanged} files changed - consider splitting`);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
