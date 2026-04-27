// Atomic JSON write + strict read helpers. Identical to ui-tokenize/lib/json-io.mjs;
// the two plugins could share via npm if/when either grows other consumers.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write `doc` as JSON to `path` atomically: write to a tmp sibling, then rename.
 * The rename is atomic on POSIX/macOS/Linux; concurrent readers see either the
 * old or the new file, never a partial write.
 *
 * @param {string} path
 * @param {any} doc
 */
export function atomicWriteJson(path, doc) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, path);
}

/**
 * Read a JSON file, returning `fallback` only when the file is missing.
 * Throws on parse error so the caller can refuse to overwrite a corrupted file
 * with a fresh fallback (silent overwriting is the failure mode this guards).
 *
 * @param {string} path
 * @param {any} fallback
 * @returns {any}
 */
export function readJsonStrict(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`malformed JSON at ${path}: ${err.message}`);
  }
}
