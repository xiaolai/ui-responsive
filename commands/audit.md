---
description: Scan the project for responsive-design issues; advisory by default, --strict for CI
argument-hint: "[--changed-only|--full-repo] [--baseline <ref>] [--json|--markdown] [--strict [--severity warn|concern]]"
---

Run the ui-responsive audit. Default behavior is `--changed-only` against `origin/main` (or `main`). Per D-001 the audit is **advisory by default** — exit code is always 0 unless `--strict` is passed.

## Steps

1. **Run the audit.**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/commands/cli.mjs" audit $ARGUMENTS
   ```
2. **Report the result to the user verbatim.** Surface the file/line/check/severity/literal/suggestion list. Highlight `concern` findings first; `warn` is the default action threshold; `info` is informational only.
3. **Honor the exit code.** Default exit is 0. `--strict` exits non-zero on `warn` and above; `--strict --severity=concern` exits non-zero only on `concern`. If the CLI exits non-zero outside these documented `--strict` semantics (crash, missing path arg, unreadable config), surface stderr verbatim and stop.

## Output format

When run without `--json` or `--markdown`, the CLI prints:

- `Scanned <N> files (<mode>)`
- `Findings: <K> (<C> concern, <W> warn, <I> info)`
- `Stylesheets with @media: <X>/<Y>`
- One indented line per finding: `  <file>:<line>  [<severity>] <check>  <literal>  →  <suggestion>`

With `--json`: a single JSON object with `mode`, `baseline`, `filesScanned`, `findings[]`, `coverage`. With `--markdown`: heading + a single Findings table.

## Severity ranks

| Severity | Default `--strict` exits non-zero? | Examples |
|---|---|---|
| `info` | no | `100vh` on a non-mobile-flagged file |
| `warn` | yes | Fixed `width` ≥ 320px without `max-width`; off-catalog breakpoints |
| `concern` | yes | Stylesheet with no `@media` at all |
