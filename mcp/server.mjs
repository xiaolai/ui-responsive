#!/usr/bin/env node
// Minimal MCP stdio server exposing read-only responsive__* tools.
// JSON-RPC 2.0 over stdin/stdout, line-delimited.
// Per D-001: every tool is read-only. The agent cannot mutate config or rules through MCP.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { findRepoRoot, findResponsiveRoot, responsiveDir } from '../lib/paths.mjs';
import { defaultConfig, readConfig } from '../lib/config.mjs';
import { buildMobileSurfaceMatcher, classifySurface, isExemptFile, scan } from '../lib/scanner.mjs';

const PROTOCOL_VERSION = '2024-11-05';

const cwd = process.cwd();
const root = findResponsiveRoot(cwd) || findRepoRoot(cwd) || cwd;

const TOOLS = [
  {
    name: 'responsive__check_file',
    description: 'Scan a single file for responsive-design findings (advisory). Returns a list of {check, severity, line, literal, suggestion, explanation}.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or repo-relative file path to scan' },
      },
      required: ['path'],
    },
  },
  {
    name: 'responsive__list_breakpoints',
    description: 'List the configured breakpoint catalog (name → pixel width). Reads .responsive/config.json or returns the default catalog.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'responsive__suggest_dvh',
    description: 'Recommend whether a vh value should become dvh, with a one-line explanation. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'A CSS length like "100vh" or "50vh"' },
      },
      required: ['value'],
    },
  },
];

const handlers = {
  'initialize':       handleInitialize,
  'tools/list':       handleToolsList,
  'tools/call':       handleToolsCall,
  'notifications/initialized': () => null,
};

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  Promise.resolve(dispatch(req)).then((result) => {
    if (result === null) return;
    if (req.id === undefined) return;
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch((err) => {
    process.stdout.write(JSON.stringify(errorResponse(req?.id, -32000, err.message)) + '\n');
  });
});

async function dispatch(req) {
  const handler = handlers[req.method];
  if (!handler) return errorResponse(req.id, -32601, `Method not found: ${req.method}`);
  try {
    return handler(req);
  } catch (err) {
    return errorResponse(req.id, -32603, `Internal error: ${err.message}`);
  }
}

function handleInitialize(req) {
  return {
    jsonrpc: '2.0',
    id: req.id,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'ui-responsive', version: '0.1.0' },
    },
  };
}

function handleToolsList(req) {
  return { jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } };
}

function handleToolsCall(req) {
  const { name, arguments: args = {} } = req.params || {};
  /** @type {(args: object) => object} */
  let impl;
  switch (name) {
    case 'responsive__check_file':       impl = checkFile; break;
    case 'responsive__list_breakpoints': impl = listBreakpoints; break;
    case 'responsive__suggest_dvh':      impl = suggestDvh; break;
    default: return errorResponse(req.id, -32602, `Unknown tool: ${name}`);
  }
  // Tool failures returned as CallToolResult with isError so the agent can read the
  // error and self-correct (per MCP spec). JSON-RPC errors reserved for protocol failures.
  try {
    const content = impl(args);
    return { jsonrpc: '2.0', id: req.id, result: { content: [content] } };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      },
    };
  }
}

// --------------------------------------------------------------------------------
// Tool implementations
// --------------------------------------------------------------------------------

function checkFile({ path }) {
  if (!path || typeof path !== 'string') throw new Error('path is required');
  const abs = resolve(root, path);
  if (!existsSync(abs)) throw new Error(`file not found: ${abs}`);
  if (isExemptFile(abs)) return textContent(`${path} is exempt (config or token-source file).`);
  if (!classifySurface(abs)) return textContent(`${path} is not a stylesheet or template surface; nothing to scan.`);
  const config = readConfig(root);
  const content = readFileSync(abs, 'utf8');
  const knownBreakpoints = new Set(Object.values(config.breakpoints).map(Number).filter((n) => !Number.isNaN(n)));
  const mobileMatcher = buildMobileSurfaceMatcher(config.mobileSurfaces);
  const findings = scan(content, abs, {
    knownBreakpoints,
    isMobileSurface: mobileMatcher(abs, relative(root, abs)),
    minWidthThreshold: config.minWidthThreshold,
  });
  if (findings.length === 0) {
    return textContent(`${path} — no findings.`);
  }
  const lines = findings.map((f) => {
    const where = f.line === 0 ? '(file-level)' : `line ${f.line}`;
    return `• ${where} [${f.severity}] ${f.check}: ${f.literal}\n  Suggest: ${f.suggestion}\n  Why: ${f.explanation}`;
  });
  return textContent(`${path} — ${findings.length} finding(s)\n\n${lines.join('\n')}`);
}

function listBreakpoints() {
  const cfgPath = join(responsiveDir(root), 'config.json');
  const isDefault = !existsSync(cfgPath);
  const config = readConfig(root);
  const cat = config.breakpoints && Object.keys(config.breakpoints).length > 0
    ? config.breakpoints
    : defaultConfig().breakpoints;
  const lines = Object.entries(cat)
    .sort((a, b) => a[1] - b[1])
    .map(([name, px]) => `${name.padEnd(8)} = ${px}px`);
  const source = isDefault
    ? '(default — no .responsive/config.json found)'
    : '(from .responsive/config.json)';
  return textContent(`${lines.join('\n')}\n\nSource: ${source}`);
}

function suggestDvh({ value }) {
  if (!value || typeof value !== 'string') throw new Error('value is required');
  const m = /^(\d+(?:\.\d+)?)\s*vh$/i.exec(value.trim());
  if (!m) {
    return textContent(`"${value}" is not a recognized vh length. Pass values like "100vh" or "50vh".`);
  }
  const n = m[1];
  return textContent(`Suggest: ${n}dvh\n\nWhy: iOS Safari's address-bar collapse causes 100vh (and other vh values) to overflow the visible viewport. Use dvh (dynamic viewport height) for layouts that should match the visible area on mobile. svh / lvh are also options for static small / large viewport sizing.`);
}

function textContent(text) {
  return { type: 'text', text };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
