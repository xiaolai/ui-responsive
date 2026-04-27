// PostToolUse + SessionStart hook smoke tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
const POST_TOOL_USE = join(PLUGIN_ROOT, 'hooks', 'post-tool-use.mjs');
const SESSION_START = join(PLUGIN_ROOT, 'hooks', 'session-start.mjs');

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'ui-responsive-hook-'));
  writeFileSync(join(root, 'package.json'), '{"name":"sample"}');
  return root;
}

function runHook(script, event, cwd) {
  return spawnSync('node', [script], {
    input: JSON.stringify(event),
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('SessionStart: emits breakpoint catalog into context', () => {
  const root = setupProject();
  try {
    const r = runHook(SESSION_START, { session_id: 'test', cwd: root }, root);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const ctx = out.hookSpecificOutput?.additionalContext || '';
    assert.ok(ctx.includes('mobile'), `expected catalog, got: ${ctx}`);
    assert.ok(ctx.includes('640'));
    // Per D-001: must advertise advisory stance so the agent doesn't expect a gate.
    assert.ok(ctx.includes('advisory'), `should advertise advisory stance, got: ${ctx}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PostToolUse: emits advisory context (NOT a deny) on findings', () => {
  const root = setupProject();
  try {
    const target = join(root, 'src', 'a.css');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '.layout { width: 1200px; min-height: 100vh; }\n');
    const event = {
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: target, content: '.layout { width: 1200px; min-height: 100vh; }\n' },
    };
    const r = runHook(POST_TOOL_USE, event, root);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    // Per D-001: PostToolUse must NEVER set permissionDecision.
    assert.equal(out.hookSpecificOutput?.permissionDecision, undefined,
      'PostToolUse must not set permissionDecision');
    assert.ok(out.hookSpecificOutput?.additionalContext, 'should emit additionalContext');
    assert.ok(out.hookSpecificOutput.additionalContext.includes('100vh'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PostToolUse: silent (no output) when no findings', () => {
  const root = setupProject();
  try {
    const target = join(root, 'src', 'good.css');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '.card { max-width: 1200px; width: 100%; }\n');
    const event = {
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: target, content: '.card { max-width: 1200px; width: 100%; }\n' },
    };
    const r = runHook(POST_TOOL_USE, event, root);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', `expected empty stdout on no findings, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PostToolUse: malformed event fails SILENT (D-003) — never a fake advisory, never a deny', () => {
  const root = setupProject();
  try {
    const r = spawnSync('node', [POST_TOOL_USE], {
      input: 'this is not json',
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', `bad input must produce no output, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PostToolUse: skips non-stylesheet files', () => {
  const root = setupProject();
  try {
    const target = join(root, 'README.md');
    writeFileSync(target, '# 100vh\n');
    const event = {
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: target, content: '# 100vh\n' },
    };
    const r = runHook(POST_TOOL_USE, event, root);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', `markdown file should be skipped, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PostToolUse: respects disabled flag in config', () => {
  const root = setupProject();
  try {
    mkdirSync(join(root, '.responsive'), { recursive: true });
    writeFileSync(join(root, '.responsive', 'config.json'), JSON.stringify({ disabled: true }));
    const target = join(root, 'a.css');
    writeFileSync(target, '.x { width: 1200px; min-height: 100vh; }\n');
    const event = {
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: target, content: '.x { width: 1200px; min-height: 100vh; }\n' },
    };
    const r = runHook(POST_TOOL_USE, event, root);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', `disabled config should silence the hook, got: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
