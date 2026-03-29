#!/usr/bin/env node

/**
 * plan-prepare.js - Pre-compute context for plan generation.
 *
 * Detects input source (text, file, URL) and pre-fetches relevant data.
 * Outputs JSON with source content, project context, and constraints.
 *
 * Usage: node plan-prepare.js [source] [--from-file <path>] [--from-url <url>]
 * Exit 0: success (JSON on stdout)
 * Exit 1: user error (message on stderr)
 * Exit 2: script error
 */

'use strict';

const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, basename } = require('node:path');
const { checkGitState, detectBaseBranch } = require('./lib/git');
const { discoverMultiRepo, discoverWorktree, discoverOpenSpec } = require('./lib/discovery');

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    fromFile: null,
    fromUrl: null,
    source: null,
  };

  const fileIdx = args.indexOf('--from-file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    flags.fromFile = args[fileIdx + 1];
  }

  const urlIdx = args.indexOf('--from-url');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    flags.fromUrl = args[urlIdx + 1];
  }

  // Remaining args as source text
  const skip = new Set();
  if (fileIdx !== -1) { skip.add(fileIdx); skip.add(fileIdx + 1); }
  if (urlIdx !== -1) { skip.add(urlIdx); skip.add(urlIdx + 1); }
  const remaining = args.filter((_, i) => !skip.has(i));
  if (remaining.length > 0) {
    flags.source = remaining.join(' ');
  }

  return flags;
}

function detectSourceType(flags) {
  if (flags.fromFile) return 'file';
  if (flags.fromUrl) return 'url';
  if (flags.source) {
    // Check if source looks like a Jira ticket
    if (/^[A-Z]+-\d+$/.test(flags.source)) return 'ticket';
    // Check if source is a file path
    if (existsSync(flags.source)) return 'file';
    // Check if source is a URL
    if (/^https?:\/\//.test(flags.source)) return 'url';
    return 'text';
  }
  return 'conversation';
}

function loadFileSource(path) {
  if (!existsSync(path)) {
    return { error: `File not found: ${path}` };
  }
  return {
    content: readFileSync(path, 'utf8'),
    path,
    name: basename(path),
  };
}

function detectOpenSpecChange(cwd, source) {
  const openspec = discoverOpenSpec(cwd);
  if (!openspec.hasOpenSpec || !openspec.changesDir) return null;

  // Check if source mentions an openspec change
  if (!existsSync(openspec.changesDir)) return null;

  const changes = readdirSync(openspec.changesDir).filter(d => {
    const fullPath = join(openspec.changesDir, d);
    try { return require('node:fs').statSync(fullPath).isDirectory(); } catch { return false; }
  });

  if (source) {
    const match = changes.find(c => source.includes(c));
    if (match) {
      const changePath = join(openspec.changesDir, match);
      const specs = [];
      const specsDir = join(changePath, 'specs');
      if (existsSync(specsDir)) {
        for (const f of readdirSync(specsDir).filter(f => f.endsWith('.md'))) {
          specs.push({
            name: f,
            content: readFileSync(join(specsDir, f), 'utf8'),
          });
        }
      }
      return { name: match, path: changePath, specs };
    }
  }

  return null;
}

function main() {
  const flags = parseArgs(process.argv);
  const cwd = process.cwd();
  const sourceType = detectSourceType(flags);

  let gitState;
  try {
    gitState = checkGitState(cwd);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  // Load source content based on type
  let sourceContent = null;
  let sourceError = null;

  switch (sourceType) {
    case 'file': {
      const path = flags.fromFile || flags.source;
      const result = loadFileSource(path);
      if (result.error) {
        sourceError = result.error;
      } else {
        sourceContent = result;
      }
      break;
    }
    case 'ticket':
      // Ticket ID detected - LLM will fetch via jira CLI or gh
      sourceContent = { ticketId: flags.source };
      break;
    case 'url':
      // URL detected - LLM will fetch
      sourceContent = { url: flags.fromUrl || flags.source };
      break;
    case 'text':
      sourceContent = { text: flags.source };
      break;
    case 'conversation':
      // No source provided - plan from conversation context
      sourceContent = { fromConversation: true };
      break;
  }

  const baseBranch = detectBaseBranch(cwd);
  const multiRepo = discoverMultiRepo(cwd);
  const worktree = discoverWorktree(cwd);
  const openspec = discoverOpenSpec(cwd);
  const openspecChange = detectOpenSpecChange(cwd, flags.source || flags.fromFile);

  const result = {
    sourceType,
    source: sourceContent,
    sourceError,
    project: {
      branch: gitState.currentBranch,
      baseBranch,
      multiRepo: multiRepo.isMultiRepo,
      repos: multiRepo.repos.map(r => r.name),
      inWorktree: worktree.inWorktree,
      hasOpenSpec: openspec.hasOpenSpec,
      openspecChange,
    },
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
