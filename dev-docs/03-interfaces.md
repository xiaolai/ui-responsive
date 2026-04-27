# ui-responsive — interfaces

Date: 2026-04-27

JSON shapes for hooks, MCP, and the audit CLI. These are the contract surfaces; everything else is implementation.

## 1. PostToolUse hook output

Always advisory. Returns `additionalContext` only — never `permissionDecision`.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "[ui-responsive] 2 advisory finding(s) in <file>:\n\n• line 12: 100vh — consider 100dvh on mobile-targeted files (info)\n• line 18: width: 1200px — consider max-width: 1200px; width: 100%; (warn)"
  }
}
```

When no findings: hook exits 0 with no output. The agent sees nothing.

When stdin is malformed: hook exits 0 with no output (advisory plugins fail *silent*, not closed — the security argument doesn't apply when there's no gate).

## 2. MCP tools (all read-only)

| Tool | Returns |
|---|---|
| `responsive__check_file({ path })` | finding list for one file |
| `responsive__list_breakpoints()` | configured breakpoint catalog |
| `responsive__suggest_dvh({ value })` | rewrite suggestion for `vh` → `dvh` |

### `responsive__check_file`

Input:
```json
{ "path": "src/components/Hero.css" }
```

Output:
```json
{
  "type": "text",
  "text": "src/components/Hero.css — 2 finding(s)\n\n• line 12 [info] 100vh\n  Suggest: 100dvh (iOS viewport bug)\n• line 18 [warn] width: 1200px without max-width\n  Suggest: max-width: 1200px; width: 100%;"
}
```

### `responsive__list_breakpoints`

Output:
```json
{
  "type": "text",
  "text": "mobile  = 640px\ntablet  = 768px\ndesktop = 1024px\nwide    = 1280px\n\nSource: .responsive/config.json"
}
```

If catalog is absent, the text says so explicitly so the agent doesn't make up names.

## 3. Audit JSON

`/responsive:audit --json`:

```json
{
  "mode": "full-repo" | "changed-only",
  "baseline": "origin/main",
  "filesScanned": 42,
  "findings": [
    {
      "file": "src/Hero.css",
      "line": 12,
      "column": 3,
      "check": "C2",
      "severity": "info",
      "literal": "100vh",
      "suggestion": "100dvh",
      "explanation": "iOS Safari address-bar collapse causes 100vh to overflow"
    }
  ],
  "coverage": {
    "filesWithMediaQueries": 18,
    "filesWithoutMediaQueries": 24,
    "totalStylesheets": 42
  }
}
```

`coverage` is descriptive only — never gates by default.

## 4. Audit exit codes

| Mode | Exit |
|---|---|
| Default | 0 always (advisory) |
| `--strict` | 1 if any `warn` or `concern` finding |
| `--strict --severity=concern` | 1 if any `concern` finding only |

CI users opt in. Default users get a report.

## 5. Configuration file

`.responsive/config.json` — see `02-spec.md §Configuration`. All fields optional; defaults baked into `lib/config.mjs`.

## 6. Hook events subscribed

| Event | Why |
|---|---|
| `SessionStart` | Inject breakpoint catalog into agent context (so the agent knows the names) |
| `PostToolUse` | Scan written file; emit advisory `additionalContext` |

No `PreToolUse`. Intentional. See `02-spec.md §Architectural commitment`.
