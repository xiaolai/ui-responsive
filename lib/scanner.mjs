// Regex-based responsive-design scanner. Four checks for v0.1.
// Per D-002: regex-only. Per D-001: every finding is advisory; severity is metadata
// for sort order, never dispatch.

import { extname } from 'node:path';
import { globToRegExpStr } from './ignore.mjs';

/**
 * @typedef {object} Finding
 * @property {string} check          - "C1" | "C2" | "C3" | "C4"
 * @property {"info"|"warn"|"concern"} severity
 * @property {number} line           - 1-based; 0 = file-level finding (C4)
 * @property {number} column         - 1-based; 0 when line=0
 * @property {string} literal        - what we matched (e.g. "100vh", "@media (min-width: 801px)")
 * @property {string} suggestion     - what to do instead
 * @property {string} explanation    - one-line why
 */

const CSS_LIKE_EXTS = new Set(['.css', '.scss', '.less', '.pcss']);
const STYLE_EMBED_EXTS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.astro', '.html', '.htm']);
const TS_EMBED_EXTS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs']);

/**
 * Classify a file as one of: 'css' (full stylesheet), 'embed' (style-block-bearing
 * template), or null (skip). C4 only fires on 'css'.
 *
 * @param {string} filePath
 */
export function classifySurface(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (CSS_LIKE_EXTS.has(ext)) return 'css';
  if (STYLE_EMBED_EXTS.has(ext)) return 'embed';
  if (TS_EMBED_EXTS.has(ext)) return 'embed';
  return null;
}

/**
 * Skip token-source files and config dirs entirely.
 *
 * @param {string} filePath
 */
export function isExemptFile(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes('/.responsive/')) return true;
  if (lower.includes('/.tokenize/')) return true;
  if (/(^|\/)tokens\.(json|css|ts|js|mjs)$/.test(lower)) return true;
  return false;
}

const VH_100_RE = /\b100vh\b/g;
const MEDIA_QUERY_RE = /@media[^{]*\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)\s*\)/g;
const FIXED_WIDTH_RE = /(^|[\s;{])width\s*:\s*(-?\d+(?:\.\d+)?)(px|rem|em)\s*(?:!important)?\s*;/g;
const RULE_BLOCK_RE = /([^{}]+)\{([^{}]*)\}/g;
const ANY_MEDIA_RE = /@media\b/;

/**
 * Run all four checks against `content`. Returns the merged finding list,
 * sorted by line then check id (deterministic order for tests).
 *
 * @param {string} content
 * @param {string} filePath
 * @param {object} [opts]
 * @param {Set<number>} [opts.knownBreakpoints]   - configured breakpoint pixel values; if absent, C1 is suppressed
 * @param {boolean} [opts.isMobileSurface]        - if false, C2 demotes to info; if true, C2 stays advisory
 * @param {number} [opts.minWidthThreshold]       - C3 threshold in px; default 320
 * @returns {Finding[]}
 */
export function scan(content, filePath, opts = {}) {
  if (isExemptFile(filePath)) return [];
  const surface = classifySurface(filePath);
  if (!surface) return [];

  /** @type {Finding[]} */
  const findings = [];

  scanC1(content, opts.knownBreakpoints, findings);
  scanC2(content, !!opts.isMobileSurface, findings);
  scanC3(content, opts.minWidthThreshold ?? 320, findings);
  if (surface === 'css') scanC4(content, findings);

  findings.sort((a, b) => (a.line - b.line) || a.check.localeCompare(b.check));
  return findings;
}

/**
 * C1 — `@media` breakpoint values not in the configured catalog.
 * Suppressed entirely if no catalog is configured (knownBreakpoints undefined or empty).
 */
function scanC1(content, knownBreakpoints, out) {
  if (!knownBreakpoints || knownBreakpoints.size === 0) return;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    MEDIA_QUERY_RE.lastIndex = 0;
    let m;
    while ((m = MEDIA_QUERY_RE.exec(lines[i]))) {
      const value = parseFloat(m[2]);
      const unit = m[3];
      const px = unit === 'px' ? value : unit === 'rem' || unit === 'em' ? Math.round(value * 16) : value;
      if (!knownBreakpoints.has(px)) {
        const nearest = nearestBreakpoint(px, knownBreakpoints);
        out.push({
          check: 'C1',
          severity: 'warn',
          line: i + 1,
          column: m.index + 1,
          literal: m[0],
          suggestion: `Use the catalog breakpoint ${nearest}px (configured) instead of ${px}px.`,
          explanation: 'Off-catalog breakpoint values fragment the design system.',
        });
      }
    }
  }
}

/**
 * C2 — bare `100vh`. Always advisory; severity escalates from `info` to `warn`
 * when the file is in a configured mobileSurfaces glob.
 */
function scanC2(content, isMobileSurface, out) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    VH_100_RE.lastIndex = 0;
    let m;
    while ((m = VH_100_RE.exec(lines[i]))) {
      out.push({
        check: 'C2',
        severity: isMobileSurface ? 'warn' : 'info',
        line: i + 1,
        column: m.index + 1,
        literal: '100vh',
        suggestion: '100dvh',
        explanation: 'iOS Safari address-bar collapse causes 100vh to overflow the viewport on mobile.',
      });
    }
  }
}

/**
 * C3 — fixed `width: <N>px` ≥ threshold without a paired `max-width` in the
 * same rule body. Walks rule blocks, not raw lines, so the "paired" check works.
 */
function scanC3(content, threshold, out) {
  RULE_BLOCK_RE.lastIndex = 0;
  let block;
  while ((block = RULE_BLOCK_RE.exec(content))) {
    const body = block[2];
    const bodyStart = block.index + block[1].length + 1;        // index of `{`'s body
    const hasMaxWidth = /(^|[\s;{])max-width\s*:/.test(body);
    if (hasMaxWidth) continue;
    FIXED_WIDTH_RE.lastIndex = 0;
    let w;
    while ((w = FIXED_WIDTH_RE.exec(body))) {
      const value = parseFloat(w[2]);
      const unit = w[3];
      const px = unit === 'px' ? value : unit === 'rem' || unit === 'em' ? value * 16 : value;
      if (Math.abs(px) < threshold) continue;
      const absIndex = bodyStart + w.index + w[1].length;
      const { line, column } = posFromIndex(content, absIndex);
      out.push({
        check: 'C3',
        severity: 'warn',
        line,
        column,
        literal: `width: ${w[2]}${w[3]}`,
        suggestion: `max-width: ${w[2]}${w[3]}; width: 100%;`,
        explanation: 'Fixed widths break responsive layouts; pair with max-width or use max-width directly.',
      });
    }
  }
}

/**
 * C4 — file-level: any C3-style fixed width AND zero `@media` rules in the file.
 * Only fires for full stylesheets (caller checks surface === 'css').
 */
function scanC4(content, out) {
  if (ANY_MEDIA_RE.test(content)) return;
  // Reuse C3's logic to know if there's at least one offender, threshold 320 baked in here.
  RULE_BLOCK_RE.lastIndex = 0;
  let block;
  let hasFixedLayoutWidth = false;
  while ((block = RULE_BLOCK_RE.exec(content))) {
    const body = block[2];
    if (/(^|[\s;{])max-width\s*:/.test(body)) continue;
    FIXED_WIDTH_RE.lastIndex = 0;
    let w;
    while ((w = FIXED_WIDTH_RE.exec(body))) {
      const value = parseFloat(w[2]);
      const unit = w[3];
      const px = unit === 'px' ? value : unit === 'rem' || unit === 'em' ? value * 16 : value;
      if (Math.abs(px) >= 320) { hasFixedLayoutWidth = true; break; }
    }
    if (hasFixedLayoutWidth) break;
  }
  if (!hasFixedLayoutWidth) return;
  out.push({
    check: 'C4',
    severity: 'concern',
    line: 0,
    column: 0,
    literal: '(file-level)',
    suggestion: 'Add @media rules at the configured breakpoints, or move layout sizing to max-width.',
    explanation: 'Stylesheet has fixed layout widths but no @media rules — likely non-responsive.',
  });
}

/**
 * @param {string} content
 * @param {number} index
 * @returns {{line: number, column: number}}
 */
function posFromIndex(content, index) {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') { line++; lastNl = i; }
  }
  return { line, column: index - lastNl };
}

function nearestBreakpoint(px, knownBreakpoints) {
  let best = null;
  let bestDist = Infinity;
  for (const v of knownBreakpoints) {
    const d = Math.abs(v - px);
    if (d < bestDist) { bestDist = d; best = v; }
  }
  return best;
}

/**
 * Compile mobileSurfaces globs to a single matcher predicate.
 * Used by callers to compute `isMobileSurface` per file.
 *
 * @param {string[]} globs
 * @returns {(absPath: string, relPath: string) => boolean}
 */
export function buildMobileSurfaceMatcher(globs) {
  if (!Array.isArray(globs) || globs.length === 0) return () => false;
  const regs = globs.map((g) => {
    let p = g;
    let rooted = false;
    if (p.startsWith('/')) { rooted = true; p = p.slice(1); }
    return new RegExp(globToRegExpStr(p, rooted, false));
  });
  return (_abs, rel) => regs.some((re) => re.test(rel.replace(/\\/g, '/')));
}
