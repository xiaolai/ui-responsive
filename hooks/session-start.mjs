#!/usr/bin/env node
// SessionStart: inject the breakpoint catalog into the agent's context once at
// session start so it knows the names. Always advisory — D-001.

import { existsSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, findResponsiveRoot, responsiveDir } from '../lib/paths.mjs';
import { defaultConfig, readConfig } from '../lib/config.mjs';
import { sessionStartCatalog } from '../lib/format.mjs';

const stdinBuf = readAllStdin();
let event;
try { event = JSON.parse(stdinBuf); }
catch { exitNoOutput(); }   // D-003: fail silent on bad input (no gate; no fake advisory)

const cwd = (event && event.cwd) || process.cwd();
const root = findResponsiveRoot(cwd) || findRepoRoot(cwd) || cwd;
const config = readConfig(root);
if (config.disabled) exitNoOutput();

const isDefault = !existsSync(join(responsiveDir(root), 'config.json'));
const cat = config.breakpoints && Object.keys(config.breakpoints).length > 0
  ? config.breakpoints
  : defaultConfig().breakpoints;

emit(sessionStartCatalog(cat, isDefault));

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
