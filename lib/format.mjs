// Output formatters for hooks, MCP, and the audit CLI.

/**
 * @typedef {import('./scanner.mjs').Finding} Finding
 */

/**
 * PostToolUse advisory output. Always appends `additionalContext`; never sets
 * permissionDecision. Returns an empty object when there are no findings, which
 * the caller can detect and exit-no-output for.
 *
 * @param {string} relFile
 * @param {Finding[]} findings
 * @returns {object}
 */
export function postToolAdvisory(relFile, findings) {
  if (findings.length === 0) return {};
  const lines = findings.map(formatFindingLine);
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `[ui-responsive] ${findings.length} advisory finding(s) in ${relFile}:\n\n${lines.join('\n')}`,
    },
  };
}

/**
 * SessionStart catalog injection: tell the agent which breakpoints exist.
 *
 * @param {Object<string, number>} breakpoints
 * @param {boolean} isDefault   true if no .responsive/config.json was found
 * @returns {object}
 */
export function sessionStartCatalog(breakpoints, isDefault) {
  const entries = Object.entries(breakpoints)
    .sort((a, b) => a[1] - b[1])
    .map(([name, px]) => `  ${name.padEnd(8)} = ${px}px`);
  const source = isDefault
    ? '(default catalog — no .responsive/config.json found)'
    : '(from .responsive/config.json)';
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[ui-responsive] Breakpoint catalog ${source}:\n${entries.join('\n')}\n\nThis plugin is advisory: it never blocks tool calls. It surfaces responsive-design findings as PostToolUse context for you to consider. Use the configured breakpoints in @media queries; bare 100vh and unpaired fixed widths will be flagged as warnings.`,
    },
  };
}

function formatFindingLine(f) {
  const where = f.line === 0 ? '(file-level)' : `line ${f.line}`;
  return `• ${where} [${f.severity}] ${f.check}: ${f.literal}\n  Suggest: ${f.suggestion}\n  Why: ${f.explanation}`;
}

/**
 * Markdown report for `/responsive:audit --markdown`.
 *
 * @param {object} payload
 */
export function markdownReport(payload) {
  const { findings, filesScanned, mode, baseline, coverage } = payload;
  const lines = [];
  lines.push('# ui-responsive audit');
  lines.push('');
  lines.push(`- Mode: ${mode}${baseline ? ` (vs \`${baseline}\`)` : ''}`);
  lines.push(`- Files scanned: ${filesScanned}`);
  lines.push(`- Findings: ${findings.length}`);
  if (coverage) {
    lines.push(`- Stylesheets with @media: ${coverage.filesWithMediaQueries}/${coverage.totalStylesheets}`);
  }
  lines.push('');
  if (findings.length === 0) {
    lines.push('No findings.');
    return lines.join('\n');
  }
  lines.push('## Findings');
  lines.push('');
  lines.push('| File | Line | Check | Severity | Literal | Suggestion |');
  lines.push('|------|------|-------|----------|---------|------------|');
  for (const f of findings) {
    const where = f.line === 0 ? '—' : String(f.line);
    lines.push(`| \`${f.file}\` | ${where} | ${f.check} | ${f.severity} | \`${f.literal}\` | ${f.suggestion} |`);
  }
  return lines.join('\n');
}
