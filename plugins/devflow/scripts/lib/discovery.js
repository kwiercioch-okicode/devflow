/**
 * discovery.js - Project detection utilities for devflow scripts.
 * Discovers review dimensions, multi-repo setup, worktrees, OpenSpec.
 * Zero external dependencies - Node.js built-ins only.
 */

'use strict';

const { readdirSync, existsSync, statSync, readFileSync } = require('node:fs');
const { join, basename } = require('node:path');
const { exec } = require('./git');

/**
 * Discover review dimensions from project .claude/ config.
 * Checks two locations:
 *   1. .claude/review-dimensions/*.md
 *   2. .claude/skills/review/prompts/*.md
 */
function discoverReviewDimensions(projectRoot) {
  const dimensions = [];

  const locations = [
    join(projectRoot, '.claude', 'review-dimensions'),
    join(projectRoot, '.claude', 'skills', 'review', 'prompts'),
  ];

  for (const dir of locations) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const name = file.replace('.md', '');
      const fullPath = join(dir, file);
      dimensions.push({ name, path: fullPath, source: dir });
    }
  }

  // Deduplicate by name (first found wins)
  const seen = new Set();
  return dimensions.filter(d => {
    if (seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  });
}

/**
 * Discover multi-repo setup.
 * Looks for sibling directories that are git repos.
 */
function discoverMultiRepo(projectRoot) {
  const repos = [];

  // Check both parent siblings and children for git repos
  const dirsToCheck = [join(projectRoot, '..'), projectRoot];

  for (const searchDir of dirsToCheck) {
    try {
      const entries = readdirSync(searchDir);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = join(searchDir, entry);
        try {
          const stat = statSync(fullPath);
          if (!stat.isDirectory()) continue;
          if (existsSync(join(fullPath, '.git'))) {
            // Avoid duplicates
            if (!repos.find(r => r.path === fullPath)) {
              repos.push({ name: entry, path: fullPath });
            }
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* dir not readable */ }
  }

  return {
    isMultiRepo: repos.length > 1,
    repos,
  };
}

/**
 * Discover active worktree context.
 */
function discoverWorktree(projectRoot) {
  const output = exec('git worktree list --porcelain', { cwd: projectRoot });
  if (!output) return { inWorktree: false, worktrees: [] };

  const worktrees = [];
  let current = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  if (current.path) worktrees.push(current);

  // Detect if we're inside a worktree (not the main one)
  const mainWorktree = worktrees[0];
  const inWorktree = mainWorktree && projectRoot !== mainWorktree.path;

  return {
    inWorktree,
    mainWorktreePath: mainWorktree ? mainWorktree.path : projectRoot,
    worktrees,
  };
}

/**
 * Discover OpenSpec setup.
 */
function discoverOpenSpec(projectRoot) {
  const openspecDir = join(projectRoot, 'openspec');
  if (!existsSync(openspecDir)) return { hasOpenSpec: false };

  const specsDir = join(openspecDir, 'specs');
  const changesDir = join(openspecDir, 'changes');

  return {
    hasOpenSpec: true,
    specsDir: existsSync(specsDir) ? specsDir : null,
    changesDir: existsSync(changesDir) ? changesDir : null,
  };
}

/**
 * Discover PR template.
 */
function discoverPrTemplate(projectRoot) {
  const locations = [
    join(projectRoot, '.claude', 'pr-template.md'),
    join(projectRoot, '.github', 'pull_request_template.md'),
    join(projectRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'),
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return { found: true, path: loc, content: readFileSync(loc, 'utf8') };
    }
  }

  return { found: false };
}

/**
 * Discover .dev-env.yml config.
 */
function discoverDevEnv(projectRoot) {
  const configPath = join(projectRoot, '.dev-env.yml');
  if (!existsSync(configPath)) return { hasDevEnv: false };

  return {
    hasDevEnv: true,
    configPath,
  };
}

module.exports = {
  discoverReviewDimensions,
  discoverMultiRepo,
  discoverWorktree,
  discoverOpenSpec,
  discoverPrTemplate,
  discoverDevEnv,
};
