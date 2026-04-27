// Repo / responsive-root resolution. Ported from ui-tokenize/lib/paths.mjs.
// Note: pure ESM imports (no require). Audit finding #2 from ui-tokenize taught
// us require() is undefined in `.mjs` files and silently returns null when wrapped
// in try/catch — exactly the kind of dead-branch bug a directory walker hides.

import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Find the nearest ancestor directory containing a `.responsive/` config dir.
 * If none exists, returns null.
 *
 * @param {string} startPath
 * @returns {string|null}
 */
export function findResponsiveRoot(startPath) {
  let dir = isDir(startPath) ? startPath : dirname(startPath);
  while (dir && dir !== '/' && dir !== '.') {
    if (existsSync(join(dir, '.responsive'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Find the nearest ancestor directory that looks like a project root
 * (package.json, deno.json, go.mod, .git).
 *
 * @param {string} startPath
 * @returns {string|null}
 */
export function findRepoRoot(startPath) {
  let dir = isDir(startPath) ? startPath : dirname(startPath);
  while (dir && dir !== '/' && dir !== '.') {
    for (const marker of ['package.json', 'deno.json', 'go.mod', '.git']) {
      if (existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * `<root>/.responsive` — created lazily by callers when they write to it.
 *
 * @param {string} root
 * @returns {string}
 */
export function responsiveDir(root) {
  return join(root, '.responsive');
}

function isDir(p) {
  try { return statSync(p).isDirectory(); }
  catch { return false; }
}
