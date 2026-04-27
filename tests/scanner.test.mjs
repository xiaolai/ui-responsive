// Unit tests for the four v0.1 checks. Each check has a positive case (must fire),
// a negative case (must NOT fire), and a precision-keeper case (a near-match that
// would be a false positive if regex were sloppy).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { scan } from '../lib/scanner.mjs';

const KNOWN = new Set([640, 768, 1024, 1280]);

// --------------------------------------------------------------------------------
// C1 — off-catalog breakpoints
// --------------------------------------------------------------------------------

test('C1: off-catalog breakpoint flagged with nearest suggestion', () => {
  const css = '@media (min-width: 801px) { .x { color: red; } }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: KNOWN });
  assert.equal(f.length, 1);
  assert.equal(f[0].check, 'C1');
  assert.equal(f[0].severity, 'warn');
  assert.ok(f[0].suggestion.includes('768'), `expected nearest 768, got: ${f[0].suggestion}`);
});

test('C1: catalog breakpoint NOT flagged', () => {
  const css = '@media (min-width: 768px) { .x { color: red; } }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: KNOWN });
  assert.equal(f.filter((x) => x.check === 'C1').length, 0);
});

test('C1: suppressed entirely when no catalog configured', () => {
  const css = '@media (min-width: 801px) { .x { color: red; } }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C1').length, 0);
});

test('C1: rem unit normalized to px', () => {
  const css = '@media (min-width: 50.5rem) { .x { color: red; } }\n';   // 50.5*16 = 808
  const f = scan(css, 'x.css', { knownBreakpoints: KNOWN });
  assert.equal(f.filter((x) => x.check === 'C1').length, 1);
});

// --------------------------------------------------------------------------------
// C2 — bare 100vh
// --------------------------------------------------------------------------------

test('C2: 100vh flagged with dvh suggestion', () => {
  const css = '.hero { min-height: 100vh; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  const c2 = f.filter((x) => x.check === 'C2');
  assert.equal(c2.length, 1);
  assert.equal(c2[0].suggestion, '100dvh');
});

test('C2: severity escalates from info to warn on mobile surfaces', () => {
  const css = '.hero { min-height: 100vh; }\n';
  const fInfo = scan(css, 'x.css', { knownBreakpoints: new Set(), isMobileSurface: false });
  assert.equal(fInfo.find((x) => x.check === 'C2').severity, 'info');
  const fWarn = scan(css, 'x.css', { knownBreakpoints: new Set(), isMobileSurface: true });
  assert.equal(fWarn.find((x) => x.check === 'C2').severity, 'warn');
});

test('C2: 50vh NOT flagged (only the iOS-buggy 100vh case)', () => {
  const css = '.hero { min-height: 50vh; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C2').length, 0);
});

test('C2: 1100vh (would-be substring match) NOT flagged', () => {
  const css = '.hero { min-height: 1100vh; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C2').length, 0);
});

// --------------------------------------------------------------------------------
// C3 — fixed width without max-width
// --------------------------------------------------------------------------------

test('C3: fixed width >= threshold without max-width is flagged', () => {
  const css = '.card { width: 1200px; padding: 16px; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  const c3 = f.filter((x) => x.check === 'C3');
  assert.equal(c3.length, 1);
  assert.ok(c3[0].suggestion.includes('max-width: 1200px'), `got: ${c3[0].suggestion}`);
});

test('C3: width < threshold (icon-sized) NOT flagged', () => {
  const css = '.icon { width: 24px; height: 24px; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C3').length, 0);
});

test('C3: width paired with max-width NOT flagged', () => {
  const css = '.card { max-width: 1200px; width: 1200px; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C3').length, 0);
});

test('C3: rem widths normalized via *16 against threshold', () => {
  // 25rem = 400px > 320px threshold → flagged
  const css = '.card { width: 25rem; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C3').length, 1);
});

// --------------------------------------------------------------------------------
// C4 — file-level: fixed widths AND zero @media
// --------------------------------------------------------------------------------

test('C4: stylesheet with fixed widths and no @media → file-level concern', () => {
  const css = '.layout { width: 1200px; }\n.card { width: 600px; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  const c4 = f.filter((x) => x.check === 'C4');
  assert.equal(c4.length, 1);
  assert.equal(c4[0].severity, 'concern');
  assert.equal(c4[0].line, 0);
});

test('C4: stylesheet with @media does NOT fire C4', () => {
  const css = '.layout { width: 1200px; }\n@media (min-width: 768px) { .layout { width: 100%; } }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: KNOWN });
  assert.equal(f.filter((x) => x.check === 'C4').length, 0);
});

test('C4: stylesheet with no large fixed widths does NOT fire C4', () => {
  const css = '.icon { width: 24px; }\n';
  const f = scan(css, 'x.css', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C4').length, 0);
});

test('C4: only fires for full stylesheets, not embed surfaces', () => {
  const css = '.layout { width: 1200px; }\n.card { width: 600px; }\n';
  const f = scan(css, 'x.tsx', { knownBreakpoints: new Set() });
  assert.equal(f.filter((x) => x.check === 'C4').length, 0);
});

// --------------------------------------------------------------------------------
// Exempt files
// --------------------------------------------------------------------------------

test('Exempt: .responsive/ files return no findings', () => {
  const css = '.x { width: 1200px; min-height: 100vh; }';
  const f = scan(css, '/proj/.responsive/x.css', { knownBreakpoints: new Set() });
  assert.equal(f.length, 0);
});

test('Exempt: tokens.json returns no findings', () => {
  const css = '{"foo": "100vh"}';
  const f = scan(css, '/proj/tokens.json', { knownBreakpoints: new Set() });
  assert.equal(f.length, 0);
});
