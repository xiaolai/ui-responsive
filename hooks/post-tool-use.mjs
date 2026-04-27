#!/usr/bin/env node
// PostToolUse: scan the file the tool just wrote and emit advisory findings.
// Per D-001: never denies. Per D-003: fails silent on malformed input.

import { existsSync, readFileSync, readSync } from 'node:fs';
import { relative } from 'node:path';
import { findRepoRoot, findResponsiveRoot } from '../lib/paths.mjs';
import { readConfig } from '../lib/config.mjs';
import { buildMobileSurfaceMatcher, classifySurface, isExemptFile, scan } from '../lib/scanner.mjs';
import { postToolAdvisory } from '../lib/format.mjs';

const stdinBuf = readAllStdin();
let event;
try { event = JSON.parse(stdinBuf); }
catch { exitNoOutput(); }    // D-003: fail silent

const toolName = event.tool_name;
if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) exitNoOutput();

const targetFile = (event.tool_input && (event.tool_input.file_path || event.tool_input.path));
if (!targetFile || typeof targetFile !== 'string') exitNoOutput();

if (isExemptFile(targetFile)) exitNoOutput();
if (!classifySurface(targetFile)) exitNoOutput();

const root = findResponsiveRoot(targetFile) || findRepoRoot(targetFile) || process.cwd();
const config = readConfig(root);
if (config.disabled) exitNoOutput();

if (!existsSync(targetFile)) exitNoOutput();
let content;
try { content = readFileSync(targetFile, 'utf8'); }
catch { exitNoOutput(); }

const mobileMatcher = buildMobileSurfaceMatcher(config.mobileSurfaces);
const isMobileSurface = mobileMatcher(targetFile, relative(root, targetFile));
const knownBreakpoints = new Set(Object.values(config.breakpoints).map((v) => Number(v)).filter((n) => !Number.isNaN(n)));

const findings = scan(content, targetFile, {
  knownBreakpoints,
  isMobileSurface,
  minWidthThreshold: config.minWidthThreshold,
});

const payload = postToolAdvisory(relative(root, targetFile), findings);
if (!payload || !payload.hookSpecificOutput) exitNoOutput();
emit(payload);

function readAllStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  const buf = Buffer.alloc(65536);
  while (true) {
    let n;
    try { n = readSync(0, buf, 0, buf.length); }
    catch (err) { if (err.code === 'EAGAIN') continue; break; }
    if (!n) break;
    chunks.push(buf.subarray(0, n).toString('utf8'));
  }
  return chunks.join('');
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function exitNoOutput() {
  process.exit(0);
}
