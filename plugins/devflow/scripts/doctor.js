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

  // Find devflow hooks.json - check cache and marketplaces (only devflow, not all plugins)
  const homePlugins = join(process.env.HOME || '', '.claude', 'plugins');
  let devflowHooksPath = null;
  let devflowHooksSource = null;

  const candidates = [
    // Local dev
    join(cwd, 'plugins', 'devflow', 'hooks', 'hooks.json'),
    // Marketplace
    join(homePlugins, 'marketplaces', 'devflow', 'plugins', 'devflow', 'hooks', 'hooks.json'),
    // Old marketplace name
    join(homePlugins, 'marketplaces', 'claude-setup', 'plugins', 'devflow', 'hooks', 'hooks.json'),
  ];

  // Also check cache - find devflow specifically
  const cacheDir = join(homePlugins, 'cache', 'devflow');
  if (existsSync(cacheDir)) {
    try {
      // Walk cache/devflow/df/<version>/hooks/hooks.json
      for (const sub of readdirSync(cacheDir)) {
        const subPath = join(cacheDir, sub);
        try {
          for (const ver of readdirSync(subPath)) {
            candidates.push(join(subPath, ver, 'hooks', 'hooks.json'));
          }
        } catch { /* not a dir */ }
      }
    } catch { /* skip */ }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      devflowHooksPath = candidate;
      devflowHooksSource = candidate.replace(homePlugins + '/', '').replace(cwd + '/', '');
      break;
    }
  }

  if (!devflowHooksPath) {
    results.hooks.push(check('devflow hooks.json', false, 'Not found - is the df plugin installed?'));
  } else {
    try {
      const hooksFile = JSON.parse(readFileSync(devflowHooksPath, 'utf8'));
      const hooksObj = hooksFile.hooks || {};

      // Count hooks and collect script commands
      let hookCount = 0;
      const scriptCommands = [];

      for (const event of Object.keys(hooksObj)) {
        const matchers = hooksObj[event];
        if (Array.isArray(matchers)) {
          for (const matcher of matchers) {
            for (const h of (matcher.hooks || [])) {
              hookCount++;
              if (h.command) scriptCommands.push({ command: h.command, event });
            }
          }
        }
      }

      results.hooks.push(check('devflow hooks.json', true, `${hookCount} hooks in ${devflowHooksSource}`));

      // Resolve CLAUDE_PLUGIN_ROOT to the hooks.json parent dir (minus /hooks/hooks.json)
      const pluginRoot = join(devflowHooksPath, '..', '..');

      // Check each hook script exists
      for (const sc of scriptCommands) {
        const scriptMatch = sc.command.match(/node\s+"([^"]+)"/);
        if (scriptMatch) {
          const rawPath = scriptMatch[1];
          const resolvedPath = rawPath.replace('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
          const scriptName = require('node:path').basename(resolvedPath);
          const scriptExists = existsSync(resolvedPath);
          results.hooks.push(check(
            scriptName,
            scriptExists,
            scriptExists ? `${sc.event} - OK` : `Script not found: ${resolvedPath}`
          ));
        }
      }
    } catch (err) {
      results.hooks.push(check('devflow hooks.json', false, `Parse error: ${err.message}`));
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

  // --- Process Rules ---

  const rulesDir = join(cwd, '.claude', 'rules');
  const expectedRules = ['test-first', 'brainstorming', 'drift-check', 'self-review', 'stop-and-ask', 'minimal-blast-radius', 'verify-before-done', 'security-first', 'fact-check', 'explain-before-coding', 'use-lsp-first', 'self-learning', 'e2e-coverage'];
  results.rules = [];

  if (!existsSync(rulesDir)) {
    results.rules.push(check('.claude/rules/', false, 'Directory not found - run /cs:init to generate process rules'));
  } else {
    const foundRules = readdirSync(rulesDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
    results.rules.push(check('.claude/rules/', true, `${foundRules.length} rules found`));

    for (const rule of expectedRules) {
      const found = foundRules.includes(rule);
      results.rules.push(check(
        rule,
        found,
        found ? 'OK' : 'Missing - run /cs:init or create manually'
      ));
    }

    // Check for custom project rules (not in expected list)
    const customRules = foundRules.filter(r => !expectedRules.includes(r));
    if (customRules.length > 0) {
      results.rules.push(check('custom rules', true, customRules.join(', ')));
    }
  }

  // Check CLAUDE.md references rules
  const claudeMd = join(cwd, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, 'utf8');
    const refsRules = content.includes('.claude/rules') || content.includes('@.claude/rules');
    results.rules.push(check(
      'CLAUDE.md references rules',
      refsRules,
      refsRules ? 'OK' : 'CLAUDE.md does not reference .claude/rules/ - rules may not be loaded'
    ));
  }

  // --- Learnings ---

  const learningsPath = join(cwd, '.claude', 'learnings', 'log.md');
  if (existsSync(learningsPath)) {
    const content = readFileSync(learningsPath, 'utf8');
    const activeCount = (content.match(/\*\*Status:\*\* ACTIVE/gi) || []).length;
    const totalCount = (content.match(/^## \d{4}-\d{2}-\d{2}/gm) || []).length;

    results.rules.push(check(
      'learnings log',
      true,
      `${totalCount} entries (${activeCount} ACTIVE)`
    ));

    if (activeCount >= 10) {
      results.rules.push(check(
        'harvest threshold',
        false,
        `${activeCount} ACTIVE learnings - run harvest to promote into skills/rules`
      ));
    }
  } else {
    results.rules.push(check('learnings log', true, 'Not found (no learnings captured yet)'));
  }

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
