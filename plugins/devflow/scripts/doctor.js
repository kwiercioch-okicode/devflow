#!/usr/bin/env node

/**
 * doctor.js - Guardrails health check.
 * Verifies hooks are installed, dimensions discovered, verdict gates working.
 *
 * Usage: node doctor.js
 * Exit 0: success (report on stdout)
 */

'use strict';

const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { exec } = require('./lib/git');
const { discoverReviewDimensions, discoverMultiRepo, discoverWorktree, discoverOpenSpec, discoverDevEnv } = require('./lib/discovery');

function check(name, pass, detail) {
  return { name, pass, detail };
}

function main() {
  const cwd = process.cwd();
  const results = { hooks: [], discovery: [], verdicts: [], warnings: [] };

  // --- Hooks ---

  // Find installed plugin hooks - search recursively in known locations
  const pluginDirs = [];
  const homePlugins = join(process.env.HOME || '', '.claude', 'plugins');

  function findHooksRecursive(dir, depth = 0) {
    if (depth > 5 || !existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      if (entries.includes('hooks.json') && dir.endsWith('hooks')) {
        const hooksPath = join(dir, 'hooks.json');
        const name = dir.replace(homePlugins, '').replace(/\/hooks$/, '').replace(/^\//, '');
        pluginDirs.push({ name: name || 'devflow', path: hooksPath });
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          if (require('node:fs').statSync(fullPath).isDirectory()) {
            findHooksRecursive(fullPath, depth + 1);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  if (existsSync(homePlugins)) {
    findHooksRecursive(homePlugins);
  }

  // Check local plugin hooks
  const localHooks = join(cwd, 'plugins', 'devflow', 'hooks', 'hooks.json');
  if (existsSync(localHooks)) {
    pluginDirs.push({ name: 'local-devflow', path: localHooks });
  }

  if (pluginDirs.length === 0) {
    results.hooks.push(check('hooks.json', false, 'No devflow hooks found'));
  } else {
    for (const pd of pluginDirs) {
      try {
        const hooks = JSON.parse(readFileSync(pd.path, 'utf8'));
        // Count hooks in nested format: { hooks: { EventName: [{ hooks: [...] }] } }
        let hookCount = 0;
        const hooksObj = hooks.hooks || {};
        for (const event of Object.keys(hooksObj)) {
          const matchers = hooksObj[event];
          if (Array.isArray(matchers)) {
            for (const matcher of matchers) {
              hookCount += (matcher.hooks || []).length;
            }
          }
        }
        results.hooks.push(check(`hooks.json (${pd.name})`, true, `${hookCount} hooks configured`));

        // Check each hook script exists
        for (const h of (hooks.hooks || [])) {
          const scriptMatch = h.command.match(/node\s+"([^"]+)"/);
          if (scriptMatch) {
            const scriptPath = scriptMatch[1].replace('${PLUGIN_DIR}', join(cwd, 'plugins', 'devflow'));
            const scriptExists = existsSync(scriptPath);
            results.hooks.push(check(
              `${h.description || h.event}`,
              scriptExists,
              scriptExists ? scriptPath : `Script not found: ${scriptPath}`
            ));
          }
        }
      } catch {
        results.hooks.push(check(`hooks.json (${pd.name})`, false, 'Failed to parse'));
      }
    }
  }

  // --- Discovery ---

  const dimensions = discoverReviewDimensions(cwd);
  results.discovery.push(check(
    'review dimensions',
    dimensions.length > 0,
    dimensions.length > 0
      ? `${dimensions.length} found: ${dimensions.map(d => d.name).join(', ')}`
      : 'None found in .claude/review-dimensions/ or .claude/skills/review/prompts/'
  ));

  const multiRepo = discoverMultiRepo(cwd);
  results.discovery.push(check(
    'multi-repo',
    true,
    multiRepo.isMultiRepo
      ? `${multiRepo.repos.length} repos: ${multiRepo.repos.map(r => r.name).join(', ')}`
      : 'Single repo'
  ));

  const worktree = discoverWorktree(cwd);
  results.discovery.push(check(
    'worktrees',
    true,
    worktree.inWorktree
      ? `In worktree (${worktree.worktrees.length} total)`
      : `Main worktree (${worktree.worktrees.length - 1} active worktrees)`
  ));

  const openspec = discoverOpenSpec(cwd);
  results.discovery.push(check(
    'OpenSpec',
    true,
    openspec.hasOpenSpec ? 'Detected' : 'Not found'
  ));

  const devEnv = discoverDevEnv(cwd);
  results.discovery.push(check(
    '.dev-env.yml',
    true,
    devEnv.hasDevEnv ? 'Found' : 'Not found'
  ));

  // --- Verdict Files ---

  const verdictPath = join(cwd, '.devflow', 'review-verdict.json');
  if (existsSync(verdictPath)) {
    try {
      const v = JSON.parse(readFileSync(verdictPath, 'utf8'));
      results.verdicts.push(check(
        'review-verdict.json',
        true,
        `${v.verdict} (${v.timestamp || 'no timestamp'})`
      ));
    } catch {
      results.verdicts.push(check('review-verdict.json', false, 'Corrupt file'));
    }
  } else {
    results.verdicts.push(check('review-verdict.json', true, 'Not present (no review run yet)'));
  }

  // --- gh CLI ---

  const ghStatus = exec('gh auth status 2>&1');
  results.discovery.push(check(
    'gh CLI',
    ghStatus !== null && !ghStatus.includes('not logged'),
    ghStatus ? 'Authenticated' : 'Not authenticated or not installed'
  ));

  // --- Output ---

  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  process.exit(0);
}

main();
