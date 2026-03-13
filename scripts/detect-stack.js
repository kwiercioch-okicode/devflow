#!/usr/bin/env node

/**
 * detect-stack.js - Zero-dependency stack detection script
 * Reads config files (package.json, composer.json, etc.) and outputs a stack profile.
 * Usage: node detect-stack.js [project-path]
 */

const fs = require('fs');
const path = require('path');

const projectPath = process.argv[2] || process.cwd();

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function countFiles(dir, extensions, maxDepth = 5) {
  const counts = {};
  extensions.forEach(ext => counts[ext] = 0);

  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext in counts) counts[ext]++;
      }
    }
  }

  walk(dir, 0);
  return counts;
}

function detectFrontend() {
  const pkg = readJson(path.join(projectPath, 'package.json'));
  if (!pkg) return null;

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const result = { type: null, language: null, framework: null, ui: null, stateManagement: null, bundler: null };

  // Language
  if (allDeps['typescript'] || fileExists(path.join(projectPath, 'tsconfig.json'))) {
    result.language = 'typescript';
  } else {
    result.language = 'javascript';
  }

  // Framework
  if (allDeps['react'] || allDeps['react-dom']) {
    result.type = 'react';
    if (allDeps['next']) result.framework = 'next.js';
    else if (allDeps['gatsby']) result.framework = 'gatsby';
    else if (allDeps['remix'] || allDeps['@remix-run/react']) result.framework = 'remix';
    else result.framework = 'react';
  } else if (allDeps['vue']) {
    result.type = 'vue';
    if (allDeps['nuxt'] || allDeps['nuxt3']) result.framework = 'nuxt';
    else result.framework = 'vue';
  } else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) {
    result.type = 'svelte';
    result.framework = allDeps['@sveltejs/kit'] ? 'sveltekit' : 'svelte';
  } else if (allDeps['@angular/core']) {
    result.type = 'angular';
    result.framework = 'angular';
  }

  // UI library
  if (allDeps['antd']) result.ui = 'ant-design';
  else if (allDeps['@mui/material'] || allDeps['@material-ui/core']) result.ui = 'material-ui';
  else if (allDeps['@chakra-ui/react']) result.ui = 'chakra-ui';
  else if (allDeps['tailwindcss']) result.ui = 'tailwind';
  else if (allDeps['bootstrap'] || allDeps['react-bootstrap']) result.ui = 'bootstrap';

  // State management
  if (allDeps['@tanstack/react-query'] || allDeps['react-query']) result.stateManagement = 'react-query';
  else if (allDeps['redux'] || allDeps['@reduxjs/toolkit']) result.stateManagement = 'redux';
  else if (allDeps['zustand']) result.stateManagement = 'zustand';
  else if (allDeps['mobx']) result.stateManagement = 'mobx';
  else if (allDeps['pinia']) result.stateManagement = 'pinia';

  // Bundler
  if (allDeps['vite']) result.bundler = 'vite';
  else if (allDeps['webpack'] || allDeps['webpack-cli']) result.bundler = 'webpack';
  else if (allDeps['esbuild']) result.bundler = 'esbuild';
  else if (allDeps['turbopack'] || allDeps['@vercel/turbopack']) result.bundler = 'turbopack';

  return result.type ? result : null;
}

function detectBackend() {
  // PHP
  const composer = readJson(path.join(projectPath, 'composer.json'));
  if (composer) {
    const allDeps = { ...composer.require, ...composer['require-dev'] };
    const result = { type: 'php', language: 'php', framework: null, version: null };

    // PHP version
    if (allDeps['php']) result.version = allDeps['php'];

    // Framework
    if (allDeps['mezzio/mezzio'] || allDeps['mezzio/mezzio-router']) result.framework = 'mezzio';
    else if (allDeps['laravel/framework']) result.framework = 'laravel';
    else if (allDeps['symfony/framework-bundle'] || allDeps['symfony/http-kernel']) result.framework = 'symfony';
    else if (allDeps['slim/slim']) result.framework = 'slim';
    else if (allDeps['laminas/laminas-mvc']) result.framework = 'laminas-mvc';

    return result;
  }

  // Python
  if (fileExists(path.join(projectPath, 'requirements.txt')) ||
      fileExists(path.join(projectPath, 'pyproject.toml')) ||
      fileExists(path.join(projectPath, 'setup.py'))) {
    const result = { type: 'python', language: 'python', framework: null };
    const pyproject = readJson(path.join(projectPath, 'pyproject.toml'));

    // Try to detect framework from requirements.txt
    try {
      const reqs = fs.readFileSync(path.join(projectPath, 'requirements.txt'), 'utf-8');
      if (reqs.includes('django')) result.framework = 'django';
      else if (reqs.includes('fastapi')) result.framework = 'fastapi';
      else if (reqs.includes('flask')) result.framework = 'flask';
    } catch {}

    return result;
  }

  // Go
  if (fileExists(path.join(projectPath, 'go.mod'))) {
    const result = { type: 'go', language: 'go', framework: null };
    try {
      const gomod = fs.readFileSync(path.join(projectPath, 'go.mod'), 'utf-8');
      if (gomod.includes('github.com/gin-gonic/gin')) result.framework = 'gin';
      else if (gomod.includes('github.com/gofiber/fiber')) result.framework = 'fiber';
      else if (gomod.includes('github.com/labstack/echo')) result.framework = 'echo';
    } catch {}
    return result;
  }

  // Rust
  if (fileExists(path.join(projectPath, 'Cargo.toml'))) {
    return { type: 'rust', language: 'rust', framework: null };
  }

  // Node.js backend
  const pkg = readJson(path.join(projectPath, 'package.json'));
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps['express']) return { type: 'node', language: 'javascript', framework: 'express' };
    if (allDeps['fastify']) return { type: 'node', language: 'javascript', framework: 'fastify' };
    if (allDeps['@nestjs/core']) return { type: 'node', language: 'typescript', framework: 'nestjs' };
    if (allDeps['hono']) return { type: 'node', language: 'typescript', framework: 'hono' };
  }

  return null;
}

function detectDatabase() {
  const databases = [];

  // From composer.json
  const composer = readJson(path.join(projectPath, 'composer.json'));
  if (composer) {
    const deps = { ...composer.require, ...composer['require-dev'] };
    if (deps['doctrine/orm'] || deps['doctrine/dbal']) databases.push('mysql');
    if (deps['ext-pdo_mysql'] || deps['ext-mysqli']) databases.push('mysql');
    if (deps['ext-pdo_pgsql']) databases.push('postgresql');
    if (deps['ext-pdo_sqlite']) databases.push('sqlite');
  }

  // From package.json
  const pkg = readJson(path.join(projectPath, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['mysql2'] || deps['mysql']) databases.push('mysql');
    if (deps['pg'] || deps['postgres']) databases.push('postgresql');
    if (deps['better-sqlite3'] || deps['sqlite3']) databases.push('sqlite');
    if (deps['mongoose'] || deps['mongodb']) databases.push('mongodb');
    if (deps['redis'] || deps['ioredis']) databases.push('redis');
    if (deps['prisma'] || deps['@prisma/client']) databases.push('prisma');
    if (deps['drizzle-orm']) databases.push('drizzle');
    if (deps['typeorm']) databases.push('typeorm');
  }

  // Docker compose
  try {
    const files = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    for (const file of files) {
      const composePath = path.join(projectPath, file);
      if (fileExists(composePath)) {
        const content = fs.readFileSync(composePath, 'utf-8');
        if (content.includes('mysql') || content.includes('mariadb')) databases.push('mysql');
        if (content.includes('postgres')) databases.push('postgresql');
        if (content.includes('redis')) databases.push('redis');
        if (content.includes('mongo')) databases.push('mongodb');
        break;
      }
    }
  } catch {}

  return [...new Set(databases)];
}

function detectTesting() {
  const testing = [];

  const pkg = readJson(path.join(projectPath, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['jest'] || deps['@jest/core']) testing.push('jest');
    if (deps['vitest']) testing.push('vitest');
    if (deps['@playwright/test'] || deps['playwright']) testing.push('playwright');
    if (deps['cypress']) testing.push('cypress');
    if (deps['mocha']) testing.push('mocha');
    if (deps['@testing-library/react']) testing.push('testing-library');
  }

  const composer = readJson(path.join(projectPath, 'composer.json'));
  if (composer) {
    const deps = { ...composer.require, ...composer['require-dev'] };
    if (deps['phpunit/phpunit']) testing.push('phpunit');
    if (deps['pestphp/pest']) testing.push('pest');
    if (deps['codeception/codeception']) testing.push('codeception');
  }

  if (fileExists(path.join(projectPath, 'pytest.ini')) ||
      fileExists(path.join(projectPath, 'pyproject.toml'))) {
    testing.push('pytest');
  }

  return testing;
}

function detectInfra() {
  const infra = [];

  if (fileExists(path.join(projectPath, 'Dockerfile')) ||
      fileExists(path.join(projectPath, 'docker-compose.yml')) ||
      fileExists(path.join(projectPath, 'docker-compose.yaml')) ||
      fileExists(path.join(projectPath, 'compose.yml'))) {
    infra.push('docker');
  }

  if (fileExists(path.join(projectPath, 'serverless.yml')) ||
      fileExists(path.join(projectPath, 'serverless.ts'))) {
    infra.push('serverless');
  }

  if (fileExists(path.join(projectPath, 'terraform')) ||
      fileExists(path.join(projectPath, 'main.tf'))) {
    infra.push('terraform');
  }

  // CI/CD
  if (fileExists(path.join(projectPath, '.github', 'workflows'))) infra.push('github-actions');
  if (fileExists(path.join(projectPath, '.gitlab-ci.yml'))) infra.push('gitlab-ci');
  if (fileExists(path.join(projectPath, 'Jenkinsfile'))) infra.push('jenkins');
  if (fileExists(path.join(projectPath, '.circleci'))) infra.push('circleci');

  return infra;
}

function detectMonorepo() {
  // Check for common monorepo patterns
  if (fileExists(path.join(projectPath, 'lerna.json'))) return 'lerna';
  if (fileExists(path.join(projectPath, 'pnpm-workspace.yaml'))) return 'pnpm-workspaces';
  if (fileExists(path.join(projectPath, 'turbo.json'))) return 'turborepo';
  if (fileExists(path.join(projectPath, 'nx.json'))) return 'nx';

  const pkg = readJson(path.join(projectPath, 'package.json'));
  if (pkg && pkg.workspaces) return 'yarn-workspaces';

  return null;
}

function getDirectoryStructure(maxDepth = 2) {
  const structure = [];

  function walk(dir, depth, prefix) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'vendor')
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        structure.push(`${prefix}${entry.name}/`);
        walk(path.join(dir, entry.name), depth + 1, prefix + '  ');
      }
    }
  }

  walk(projectPath, 0, '');
  return structure;
}

// Main execution
const profile = {
  path: projectPath,
  frontend: detectFrontend(),
  backend: detectBackend(),
  databases: detectDatabase(),
  testing: detectTesting(),
  infra: detectInfra(),
  monorepo: detectMonorepo(),
  fileCounts: countFiles(projectPath, ['.js', '.ts', '.tsx', '.jsx', '.php', '.py', '.go', '.rs', '.vue', '.svelte']),
  directories: getDirectoryStructure(),
};

// Output as JSON
console.log(JSON.stringify(profile, null, 2));
