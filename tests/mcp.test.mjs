// MCP server smoke tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
const SERVER = join(PLUGIN_ROOT, 'mcp', 'server.mjs');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ui-responsive-mcp-'));
  writeFileSync(join(root, 'package.json'), '{"name":"resp"}');
  return root;
}

async function callServer(cwd, messages, expectedCount) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('node', [SERVER], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = [];
    let buf = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectP(new Error(`timeout after ${responses.length}/${expectedCount}; buf=${buf.slice(0, 200)}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          responses.push(JSON.parse(line));
          if (responses.length >= expectedCount) {
            clearTimeout(timer);
            child.kill('SIGTERM');
            resolveP(responses);
          }
        } catch { /* skip malformed */ }
      }
    });
    child.on('exit', () => {
      clearTimeout(timer);
      if (responses.length < expectedCount) rejectP(new Error(`server exited; got ${responses.length}/${expectedCount}`));
      else resolveP(responses);
    });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
  });
}

test('MCP: initialize returns protocol version', async () => {
  const root = setup();
  try {
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ], 1);
    assert.equal(responses[0].result.protocolVersion, '2024-11-05');
    assert.equal(responses[0].result.serverInfo.name, 'ui-responsive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP: tools/list exposes the three read-only tools', async () => {
  const root = setup();
  try {
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ], 2);
    const names = responses[1].result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'responsive__check_file',
      'responsive__list_breakpoints',
      'responsive__suggest_dvh',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP: check_file returns findings for non-responsive CSS', async () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'bad.css'), '.x { width: 1200px; min-height: 100vh; }\n');
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'responsive__check_file', arguments: { path: 'bad.css' } } },
    ], 2);
    const text = responses[1].result.content[0].text;
    assert.ok(text.includes('100vh'), `expected 100vh in finding text, got: ${text}`);
    assert.ok(text.includes('1200px'), `expected 1200px in finding text, got: ${text}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP: list_breakpoints returns the default catalog with marker', async () => {
  const root = setup();
  try {
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'responsive__list_breakpoints', arguments: {} } },
    ], 2);
    const text = responses[1].result.content[0].text;
    assert.ok(text.includes('mobile') && text.includes('640'));
    assert.ok(text.includes('default'), `should mark default catalog, got: ${text}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP: suggest_dvh recommends dvh for vh values', async () => {
  const root = setup();
  try {
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'responsive__suggest_dvh', arguments: { value: '100vh' } } },
    ], 2);
    const text = responses[1].result.content[0].text;
    assert.ok(text.includes('100dvh'));
    assert.ok(text.toLowerCase().includes('ios'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP: suggest_dvh on bad input returns isError, not a fabricated suggestion', async () => {
  const root = setup();
  try {
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'responsive__suggest_dvh', arguments: { value: 'not-a-length' } } },
    ], 2);
    const result = responses[1].result;
    // Per format: isError when truly invalid; success with explanatory text when shape ok but unit unrecognized.
    const text = result.content[0].text;
    assert.ok(text.includes('not a recognized') || result.isError,
      `expected explicit recognition message, got: ${JSON.stringify(result)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP: unknown tool returns JSON-RPC error', async () => {
  const root = setup();
  try {
    const responses = await callServer(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'responsive__nope' } },
    ], 2);
    assert.ok(responses[1].error);
    assert.equal(responses[1].error.code, -32602);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
