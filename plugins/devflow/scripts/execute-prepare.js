#!/usr/bin/env node

/**
 * execute-prepare.js - Pre-compute data for plan execution.
 *
 * Parses a plan file, extracts tasks with dependencies,
 * builds wave grouping for parallel dispatch.
 *
 * Usage: node execute-prepare.js [plan-file-path]
 * Exit 0: success (JSON on stdout)
 * Exit 1: user error (message on stderr)
 * Exit 2: script error
 */

'use strict';

const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { checkGitState, detectBaseBranch } = require('./lib/git');
const { discoverWorktree } = require('./lib/discovery');

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    planFile: args.find(a => !a.startsWith('--')) || null,
  };
}

/**
 * Find the most recent plan file in .devflow/
 */
function findLatestPlan(cwd) {
  const devflowDir = join(cwd, '.devflow');
  if (!existsSync(devflowDir)) return null;

  const plans = readdirSync(devflowDir)
    .filter(f => f.startsWith('plan-') && f.endsWith('.md'))
    .sort()
    .reverse();

  return plans.length > 0 ? join(devflowDir, plans[0]) : null;
}

/**
 * Parse a markdown plan into task groups with dependencies.
 */
function parsePlan(content) {
  const groups = [];
  let currentGroup = null;

  for (const line of content.split('\n')) {
    // Match group header: ### Group N: name
    const groupMatch = line.match(/^###\s+(?:Group\s+\d+:\s*)?(.+)/);
    if (groupMatch) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = {
        name: groupMatch[1].trim(),
        dependsOn: [],
        tasks: [],
      };
      continue;
    }

    // Match depends on line
    if (currentGroup && /^Depends on:/i.test(line)) {
      const deps = line.replace(/^Depends on:\s*/i, '').trim();
      if (deps.toLowerCase() !== 'none') {
        currentGroup.dependsOn = deps.split(',')
          .map(d => d.trim().replace(/^Group\s+\d+:\s*/i, ''))
          .filter(Boolean);
      }
      continue;
    }

    // Match task: - [ ] N.M description
    const taskMatch = line.match(/^-\s+\[[ x]\]\s+(?:(\d+\.\d+)\s+)?(.+)/);
    if (taskMatch && currentGroup) {
      currentGroup.tasks.push({
        id: taskMatch[1] || `${groups.length + 1}.${currentGroup.tasks.length + 1}`,
        description: taskMatch[2].trim(),
        done: line.includes('[x]'),
      });
    }
  }

  if (currentGroup) groups.push(currentGroup);
  return groups;
}

/**
 * Build waves from groups based on dependencies.
 */
function buildWaves(groups) {
  const waves = [];
  const completed = new Set();
  let remaining = [...groups];

  let safetyCounter = 0;
  const maxIterations = groups.length + 1;

  while (remaining.length > 0 && safetyCounter < maxIterations) {
    safetyCounter++;

    const ready = remaining.filter(g =>
      g.dependsOn.every(dep => completed.has(dep))
    );

    if (ready.length === 0) {
      // Circular dependency or missing dependency
      const stuck = remaining.map(g => `${g.name} (depends on: ${g.dependsOn.join(', ')})`);
      return {
        waves,
        error: `Circular or missing dependency detected. Stuck groups:\n${stuck.join('\n')}`,
      };
    }

    waves.push({
      waveNumber: waves.length + 1,
      groups: ready.map(g => ({
        name: g.name,
        tasks: g.tasks,
        taskCount: g.tasks.length,
        pendingTasks: g.tasks.filter(t => !t.done).length,
      })),
      parallelGroups: ready.length,
    });

    for (const g of ready) {
      completed.add(g.name);
    }

    remaining = remaining.filter(g => !completed.has(g.name));
  }

  return { waves, error: null };
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

  // Find plan file
  let planPath = flags.planFile;
  if (!planPath) {
    planPath = findLatestPlan(cwd);
  }

  let planContent = null;
  let planSource = 'conversation';

  if (planPath) {
    if (!existsSync(planPath)) {
      process.stderr.write(`Plan file not found: ${planPath}\n`);
      process.exit(1);
    }
    planContent = readFileSync(planPath, 'utf8');
    planSource = 'file';
  } else {
    // No plan file - will use conversation context
    planSource = 'conversation';
  }

  // Parse plan if we have content
  let groups = [];
  let waveResult = { waves: [], error: null };

  if (planContent) {
    groups = parsePlan(planContent);

    if (groups.length === 0) {
      process.stderr.write('No task groups found in plan. Expected ### Group headers with - [ ] tasks.\n');
      process.exit(1);
    }

    waveResult = buildWaves(groups);
  }

  const totalTasks = groups.reduce((sum, g) => sum + g.tasks.length, 0);
  const pendingTasks = groups.reduce((sum, g) => sum + g.tasks.filter(t => !t.done).length, 0);
  const worktree = discoverWorktree(cwd);

  const result = {
    planSource,
    planPath,
    groups,
    groupCount: groups.length,
    totalTasks,
    pendingTasks,
    completedTasks: totalTasks - pendingTasks,
    waves: waveResult.waves,
    waveCount: waveResult.waves.length,
    waveError: waveResult.error,
    project: {
      branch: gitState.currentBranch,
      baseBranch: detectBaseBranch(cwd),
      inWorktree: worktree.inWorktree,
    },
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
