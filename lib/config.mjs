// Read .responsive/config.json (breakpoints, mobile surfaces, threshold, ignore).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { responsiveDir } from './paths.mjs';

/**
 * @typedef {object} ResponsiveConfig
 * @property {Object<string, number>} breakpoints   - name → pixel width
 * @property {string[]} mobileSurfaces              - globs for files where C2 (vh) fires; empty = everywhere
 * @property {number} minWidthThreshold             - C3 only flags widths >= this (px)
 * @property {string[]} ignore                      - additional ignore globs
 * @property {boolean} disabled                     - global kill switch
 */

const DEFAULT_BREAKPOINTS = {
  mobile: 640,
  tablet: 768,
  desktop: 1024,
  wide: 1280,
};

/** @returns {ResponsiveConfig} */
export function defaultConfig() {
  return {
    breakpoints: { ...DEFAULT_BREAKPOINTS },
    mobileSurfaces: [],
    minWidthThreshold: 320,
    ignore: [],
    disabled: false,
  };
}

/**
 * Read the config for the project containing `workingFile`.
 * Missing file → defaults. Malformed file → defaults + warning to stderr.
 *
 * @param {string} workingFile
 * @returns {ResponsiveConfig}
 */
export function readConfig(workingFile) {
  const path = join(responsiveDir(workingFile), 'config.json');
  if (!existsSync(path)) return defaultConfig();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    return mergeConfig(defaultConfig(), parsed);
  } catch (err) {
    process.stderr.write(`[ui-responsive] WARN: malformed ${path}: ${err.message}\n`);
    return defaultConfig();
  }
}

function mergeConfig(base, override) {
  return {
    breakpoints: {
      ...base.breakpoints,
      ...(override.breakpoints && typeof override.breakpoints === 'object' ? override.breakpoints : {}),
    },
    mobileSurfaces: Array.isArray(override.mobileSurfaces) ? override.mobileSurfaces : base.mobileSurfaces,
    minWidthThreshold: typeof override.minWidthThreshold === 'number' ? override.minWidthThreshold : base.minWidthThreshold,
    ignore: Array.isArray(override.ignore) ? override.ignore : base.ignore,
    disabled: !!override.disabled,
  };
}
