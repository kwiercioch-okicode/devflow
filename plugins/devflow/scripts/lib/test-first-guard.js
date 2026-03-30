#!/usr/bin/env node

/**
 * test-first-guard.js - PreToolUse hook for Edit/Write
 * Reminds to write tests before production code.
 * Injects context warning (does not block).
 *
 * Reads tool input from stdin (JSON with tool_input).
 * Exit 0 always (context injection, not blocking).
 * Writes warning to stdout if applicable.
 */

'use strict';

const { extname } = require('node:path');

const PRODUCTION_EXTENSIONS = new Set([
  '.php', '.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte',
  '.py', '.rb', '.go', '.java', '.rs',
]);

const TEST_PATTERNS = [/test/i, /spec/i, /\.test\./, /\.spec\./, /Test\.php$/, /__tests__/];
const CONFIG_PATTERNS = [/config/i, /\.env/, /docker/i, /webpack/i, /vite/i, /tsconfig/i, /package\.json/, /\.css$/, /\.scss$/, /\.md$/];

// User-facing file patterns - changes here may need E2E tests
const USER_FACING_PATTERNS = [
  /Handler\.php$/,      // PHP command/query handlers
  /Controller\.php$/,   // PHP controllers
  /routes?\.(php|ts|tsx|js)$/i,  // route files
  /\/pages\//,          // Next.js / React pages dir
  /\/views\//,          // view files
  /Page\.(tsx|jsx|ts|js)$/, // React page components
  /Modal\.(tsx|jsx|ts|js)$/, // Modal components
  /Wizard\.(tsx|jsx|ts|js)$/, // Wizard components
  /Form\.(tsx|jsx|ts|js)$/,  // Form components
];

function isProductionFile(filePath) {
  if (!filePath) return false;
  const ext = extname(filePath);
  if (!PRODUCTION_EXTENSIONS.has(ext)) return false;
  if (TEST_PATTERNS.some(p => p.test(filePath))) return false;
  if (CONFIG_PATTERNS.some(p => p.test(filePath))) return false;
  return true;
}

function isTestFile(filePath) {
  return TEST_PATTERNS.some(p => p.test(filePath));
}

function isUserFacingFile(filePath) {
  return USER_FACING_PATTERNS.some(p => p.test(filePath));
}

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

  const filePath = data?.tool_input?.file_path || '';

  // If editing a test file - that's good, no warning
  if (isTestFile(filePath)) {
    process.exit(0);
  }

  if (!isProductionFile(filePath)) {
    process.exit(0);
  }

  const e2eNote = isUserFacingFile(filePath)
    ? ' If this is a user-facing change, also add an E2E task to tasks.md (see e2e-coverage rule).'
    : '';

  process.stdout.write(
    'TEST-FIRST REMINDER: Editing production code. ' +
    'Ensure a failing test exists before writing production code.' +
    e2eNote
  );
  process.exit(0);
}

main();
