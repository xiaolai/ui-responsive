// Audit CLI integration tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
const CLI = join(PLUGIN_ROOT, 'commands', 'cli.mjs');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ui-responsive-audit-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 't@t.x'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: root });
  writeFileSync(join(root, 'package.json'), '{"name":"resp-test"}');
  return root;
}

function runCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}

test('audit --full-repo on responsive code: no findings, exit 0', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'good.css'),
      '.card { max-width: 1200px; width: 100%; padding: 16px; }\n' +
      '@media (min-width: 768px) { .card { padding: 24px; } }\n');
    const r = runCli(['audit', '--full-repo'], root);
    assert.equal(r.status, 0, `expected 0, got status=${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
    assert.ok(/Findings: 0/.test(r.stdout), `expected 0 findings, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit --full-repo on non-responsive code: findings reported, exit 0 by default', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'bad.css'),
      '.layout { width: 1200px; min-height: 100vh; }\n');
    const r = runCli(['audit', '--full-repo'], root);
    // Default mode is advisory: exit 0 even with findings.
    assert.equal(r.status, 0, `default audit should exit 0, got: ${r.stderr}`);
    assert.ok(r.stdout.includes('100vh'), `expected 100vh report, got: ${r.stdout}`);
    assert.ok(r.stdout.includes('1200px'), `expected width report, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit --strict gates on warn+ findings (exit 1)', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'bad.css'), '.layout { width: 1200px; }\n');   // warn + concern (file-level no @media)
    const r = runCli(['audit', '--full-repo', '--strict'], root);
    assert.equal(r.status, 1, `--strict should exit 1, got status=${r.status}, stdout=${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit --strict --severity=concern gates only on concern', () => {
  const root = setup();
  try {
    // Pure C2 100vh on a non-mobile file → severity info; no warn or concern.
    writeFileSync(join(root, 'soft.css'), '.hero { min-height: 100vh; max-width: 100%; }\n');
    const r = runCli(['audit', '--full-repo', '--strict', '--severity=concern'], root);
    assert.equal(r.status, 0, `info-only findings with --severity=concern should exit 0, got: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit --json shape: mode, findings, coverage', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'bad.css'), '.x { width: 1200px; }\n');
    const r = runCli(['audit', '--full-repo', '--json'], root);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.mode, 'full-repo');
    assert.ok(Array.isArray(payload.findings));
    assert.ok(payload.findings.length >= 1);
    assert.ok('coverage' in payload);
    assert.ok('totalStylesheets' in payload.coverage);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit --markdown: produces a Markdown table', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'bad.css'), '.x { width: 1200px; }\n');
    const r = runCli(['audit', '--full-repo', '--markdown'], root);
    assert.ok(r.stdout.includes('# ui-responsive audit'));
    assert.ok(r.stdout.includes('| File | Line | Check |'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit --baseline rejects shell metacharacters (defense in depth from ui-tokenize lesson)', () => {
  const root = setup();
  try {
    writeFileSync(join(root, '.gitignore'), '');
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { cwd: root });
    const sentinel = join(root, '.shell-injection-canary');
    const malicious = `HEAD; touch ${sentinel}`;
    const r = runCli(['audit', '--changed-only', '--baseline', malicious], root);
    assert.ok(!existsSync(sentinel), 'shell injection succeeded — sentinel was created');
    assert.ok(r.stderr.includes('rejected unsafe baseline') || r.stderr.includes('cannot diff'),
      `expected rejection warning, got stderr: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit honors .gitignore (lesson from ui-tokenize finding #7)', () => {
  const root = setup();
  try {
    mkdirSync(join(root, 'generated'), { recursive: true });
    writeFileSync(join(root, 'generated', 'noisy.css'), '.x { width: 1200px; min-height: 100vh; }\n');
    writeFileSync(join(root, '.gitignore'), 'generated/\n');
    const r = runCli(['audit', '--full-repo'], root);
    assert.ok(!r.stdout.includes('noisy.css'), `should skip ignored generated/, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('init creates .responsive/config.json with defaults', () => {
  const root = setup();
  try {
    const r = runCli(['init'], root);
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(root, '.responsive', 'config.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('catalog prints the default breakpoints when no config exists', () => {
  const root = setup();
  try {
    const r = runCli(['catalog'], root);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('mobile') && r.stdout.includes('640'));
    assert.ok(r.stdout.includes('(default)'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
