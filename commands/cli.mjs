#!/usr/bin/env node
// Unified CLI for /responsive:* slash commands.
// Subcommands: init, audit, catalog.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findRepoRoot, findResponsiveRoot, responsiveDir } from '../lib/paths.mjs';
import { defaultConfig, readConfig } from '../lib/config.mjs';
import { atomicWriteJson } from '../lib/json-io.mjs';
import { loadIgnore, globToRegExpStr } from '../lib/ignore.mjs';
import { buildMobileSurfaceMatcher, classifySurface, isExemptFile, scan } from '../lib/scanner.mjs';
import { markdownReport } from '../lib/format.mjs';

// Defense-in-depth allowlist for git refs (audit-finding #1 from ui-tokenize).
const GIT_REF_RE = /^[A-Za-z0-9._/@~^{}\-]+$/;

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;     // kept for parity with ui-tokenize layout in case starters land later

const args = process.argv.slice(2);
const subcommand = args[0];

try {
  switch (subcommand) {
    case 'init':    await cmdInit(args.slice(1)); break;
    case 'audit':   await cmdAudit(args.slice(1)); break;
    case 'catalog': await cmdCatalog(args.slice(1)); break;
    default:
      printUsage();
      process.exit(2);
  }
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}

// --------------------------------------------------------------------------------
// init
// --------------------------------------------------------------------------------

async function cmdInit(_rest) {
  const root = findResponsiveRoot(process.cwd()) || findRepoRoot(process.cwd()) || process.cwd();
  const dir = responsiveDir(root);
  const cfgPath = join(dir, 'config.json');
  if (existsSync(cfgPath)) {
    log(`✓ Config already exists: ${relative(root, cfgPath)}`);
    log(`  Edit it directly to customize breakpoints, mobileSurfaces, threshold.`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(cfgPath, defaultConfig());
  log(`✓ Created ${relative(root, cfgPath)} with default breakpoints (640/768/1024/1280).`);
  log('');
  log('Edit this file to:');
  log('  • match your design system\'s named breakpoints');
  log('  • list mobile-targeted file globs in `mobileSurfaces` (escalates 100vh from info → warn there)');
  log('  • adjust `minWidthThreshold` (px) for the fixed-width check');
  log('');
  log('Next: /responsive:catalog to confirm; /responsive:audit to scan.');
}

// --------------------------------------------------------------------------------
// catalog
// --------------------------------------------------------------------------------

async function cmdCatalog(_rest) {
  const root = findResponsiveRoot(process.cwd()) || findRepoRoot(process.cwd()) || process.cwd();
  const cfgPath = join(responsiveDir(root), 'config.json');
  const isDefault = !existsSync(cfgPath);
  const config = readConfig(root);
  const cat = config.breakpoints;
  log(`Breakpoints ${isDefault ? '(default)' : `(from ${relative(root, cfgPath)})`}:`);
  for (const [name, px] of Object.entries(cat).sort((a, b) => a[1] - b[1])) {
    log(`  ${name.padEnd(8)} = ${px}px`);
  }
  log('');
  log(`Mobile surfaces: ${config.mobileSurfaces.length === 0 ? '(none — C2 stays at info severity everywhere)' : config.mobileSurfaces.join(', ')}`);
  log(`Min-width threshold for C3: ${config.minWidthThreshold}px`);
}

// --------------------------------------------------------------------------------
// audit
// --------------------------------------------------------------------------------

async function cmdAudit(rest) {
  const flags = parseFlags(rest);
  const root = findResponsiveRoot(process.cwd()) || findRepoRoot(process.cwd()) || process.cwd();
  const config = readConfig(root);

  const baseline = flags.baseline ?? defaultBaseline();
  const useChangedLines = flags.changedOnly !== false && !flags.fullRepo;
  const changedLineMap = useChangedLines ? changedLineRanges(root, baseline) : null;
  const files = useChangedLines
    ? [...changedLineMap.keys()].map((p) => join(root, p))
    : walkAllFiles(root, config);

  const suppressions = readSuppressionsFile(flags.suppressions, root);
  const knownBreakpoints = new Set(Object.values(config.breakpoints).map(Number).filter((n) => !Number.isNaN(n)));
  const mobileMatcher = buildMobileSurfaceMatcher(config.mobileSurfaces);

  /** @type {Array<{file: string} & import('../lib/scanner.mjs').Finding>} */
  const findings = [];
  let totalScanned = 0;
  let filesWithMediaQueries = 0;
  let totalStylesheets = 0;

  for (const file of files) {
    if (isExemptFile(file)) continue;
    if (!classifySurface(file)) continue;
    if (suppressions.matches(file)) continue;
    totalScanned++;
    let content;
    try { content = readFileSync(file, 'utf8'); }
    catch { continue; }
    if (file.match(/\.(css|scss|less|pcss)$/)) {
      totalStylesheets++;
      if (/@media\b/.test(content)) filesWithMediaQueries++;
    }
    const fileFindings = scan(content, file, {
      knownBreakpoints,
      isMobileSurface: mobileMatcher(file, relative(root, file)),
      minWidthThreshold: config.minWidthThreshold,
    });
    const changedLines = useChangedLines ? changedLineMap.get(relative(root, file)) : null;
    for (const f of fileFindings) {
      // file-level findings (line=0) always pass the changed-line filter; they're
      // not anchored to a specific edit.
      if (useChangedLines && f.line !== 0 && !(changedLines && changedLines.has(f.line))) continue;
      findings.push({ file: relative(root, file), ...f });
    }
  }

  const coverage = { filesWithMediaQueries, filesWithoutMediaQueries: totalStylesheets - filesWithMediaQueries, totalStylesheets };

  if (flags.json) {
    process.stdout.write(JSON.stringify({
      mode: useChangedLines ? 'changed-only' : 'full-repo',
      baseline,
      filesScanned: totalScanned,
      findings,
      coverage,
    }, null, 2) + '\n');
  } else if (flags.markdown) {
    log(markdownReport({ mode: useChangedLines ? 'changed-only' : 'full-repo', baseline, filesScanned: totalScanned, findings, coverage }));
  } else {
    log(`Scanned ${totalScanned} files (${useChangedLines ? 'changed-only vs ' + baseline : 'full-repo'}).`);
    log(`Findings: ${findings.length} (${countSeverity(findings, 'concern')} concern, ${countSeverity(findings, 'warn')} warn, ${countSeverity(findings, 'info')} info).`);
    log(`Stylesheets with @media: ${filesWithMediaQueries}/${totalStylesheets}.`);
    log('');
    for (const f of findings) {
      const where = f.line === 0 ? '(file)' : `${f.line}`;
      log(`  ${f.file}:${where}  [${f.severity}] ${f.check}  ${f.literal}  →  ${f.suggestion}`);
    }
  }

  // Exit code: advisory by default; --strict gates on warn+ (or finer with --severity).
  if (flags.strict) {
    const minSev = flags.severity || 'warn';
    const order = { info: 0, warn: 1, concern: 2 };
    const min = order[minSev] ?? 1;
    const offenders = findings.filter((f) => (order[f.severity] ?? 0) >= min);
    if (offenders.length > 0) process.exit(1);
  }
}

// --------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------

function defaultBaseline() {
  try {
    const remoteHead = execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (remoteHead) return 'origin/main';
  } catch { /* fall through */ }
  return 'main';
}

function changedLineRanges(root, baseline) {
  /** @type {Map<string, Set<number>>} */
  const out = new Map();
  if (typeof baseline !== 'string' || !GIT_REF_RE.test(baseline)) {
    process.stderr.write(`[ui-responsive] WARN: rejected unsafe baseline "${baseline}". Falling back to full-repo scan.\n`);
    return new Map();
  }
  let diff;
  try {
    diff = execFileSync('git', ['diff', '--unified=0', '--no-color', baseline, '--', '.'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (err) {
    process.stderr.write(`[ui-responsive] WARN: cannot diff against ${baseline}: ${err.message}\nFalling back to full-repo scan.\n`);
    return new Map();
  }
  let currentFile = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      if (!out.has(currentFile)) out.set(currentFile, new Set());
    } else if (line.startsWith('@@') && currentFile) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const start = parseInt(m[1], 10);
      const count = m[2] != null ? parseInt(m[2], 10) : 1;
      const set = out.get(currentFile);
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return out;
}

function walkAllFiles(root, config) {
  const out = [];
  const ignore = loadIgnore(root, config.ignore);
  walkDir(root, root, out, ignore);
  return out;
}

function walkDir(dir, root, out, ignore) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (ignore && ignore.isIgnored(full)) continue;
    if (e.isDirectory()) {
      if (existsSync(join(full, 'package.json')) && full !== root) continue;
      walkDir(full, root, out, ignore);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}

function readSuppressionsFile(path, root) {
  if (!path) return { matches: () => false };
  const abs = resolve(root, path);
  if (!existsSync(abs)) return { matches: () => false };
  let lines;
  try { lines = readFileSync(abs, 'utf8').split(/\r?\n/); }
  catch { return { matches: () => false }; }
  const patterns = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((raw) => {
      let p = raw;
      let rooted = false;
      if (p.startsWith('/')) { rooted = true; p = p.slice(1); }
      return new RegExp(globToRegExpStr(p, rooted, false));
    });
  return {
    matches(file) {
      const rel = relative(root, file).replace(/\\/g, '/');
      return patterns.some((re) => re.test(rel));
    },
  };
}

function parseFlags(rest) {
  const flags = {
    json: false,
    markdown: false,
    fullRepo: false,
    changedOnly: true,
    baseline: null,
    suppressions: null,
    strict: false,
    severity: null,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') flags.json = true;
    else if (a === '--markdown') flags.markdown = true;
    else if (a === '--full-repo') { flags.fullRepo = true; flags.changedOnly = false; }
    else if (a === '--changed-only') flags.changedOnly = true;
    else if (a === '--baseline') flags.baseline = rest[++i];
    else if (a.startsWith('--baseline=')) flags.baseline = a.split('=')[1];
    else if (a === '--suppressions') flags.suppressions = rest[++i];
    else if (a.startsWith('--suppressions=')) flags.suppressions = a.split('=')[1];
    else if (a === '--strict') flags.strict = true;
    else if (a === '--severity') flags.severity = rest[++i];
    else if (a.startsWith('--severity=')) flags.severity = a.split('=')[1];
  }
  return flags;
}

function countSeverity(findings, sev) {
  return findings.filter((f) => f.severity === sev).length;
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function printUsage() {
  process.stdout.write([
    'Usage: ui-responsive <subcommand> [options]',
    '',
    'Subcommands:',
    '  init                                     Scaffold .responsive/config.json with default breakpoints',
    '  catalog                                  Print the configured breakpoint catalog',
    '  audit [--changed-only|--full-repo]       Scan for responsive findings (advisory by default)',
    '        [--baseline <ref>] [--json|--markdown]',
    '        [--suppressions <file>]',
    '        [--strict [--severity warn|concern]]',
    '',
  ].join('\n'));
}
