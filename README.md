# ui-responsive

A Claude Code plugin that flags non-responsive CSS patterns as **advisory context**, not as a blocker. Sibling to `ui-tokenize`; deliberately the inverse stance.

## What

When the agent writes a CSS / SCSS / LESS / JSX-style file, ui-responsive scans for four patterns and surfaces findings as PostToolUse `additionalContext`:

1. **C1** — `@media` breakpoint values that don't match the configured catalog (e.g. `801px` when the catalog has 768/1024).
2. **C2** — bare `100vh` (the iOS Safari address-bar bug). Suggests `100dvh`.
3. **C3** — fixed `width` ≥ 320px without a paired `max-width`. Suggests `max-width: <N>; width: 100%;`.
4. **C4** — file-level: a stylesheet that has fixed layout widths and zero `@media` rules.

Plus an MCP server with three read-only tools (`responsive__check_file`, `responsive__list_breakpoints`, `responsive__suggest_dvh`) and an audit CLI.

## Why

Responsive design is a *layout-intent* concern, not a *literal-substitution* concern. `width: 1200px` may be a deliberate max-width container; missing `@media` may be fine on a fixed admin page; `100vh` on a kiosk is correct. There are no confidence-1.0 rewrites in this domain.

A plugin that *denies* on heuristics gets disabled on day three. A plugin that *whispers* gets listened to. So:

- **No `PreToolUse` hook.** The agent's edit always lands.
- **No silent rewrites.** The agent sees what it wrote.
- **PostToolUse appends advisory context** the agent reads on the next turn and decides what to do with.
- **`--strict` is opt-in for CI.** Default audit always exits 0.

This is the inverse of `ui-tokenize`'s rewrite-first stance, on purpose. Same internals (catalog discovery, NDJSON ledger pattern, ESM-zero-deps); different user-visible behavior.

## How

### Install

```bash
claude plugin install ui-responsive@xiaolai --scope project
```

> **Install fails with "Plugin not found in marketplace 'xiaolai'"?** Your local marketplace clone is stale. Run `claude plugin marketplace update xiaolai` and retry — `plugin install` does not auto-refresh.

### Configure (optional)

```
/responsive:init
```

Creates `.responsive/config.json` with default breakpoints (640 / 768 / 1024 / 1280). Edit it to match your design system, list mobile-targeted file globs in `mobileSurfaces`, or adjust the C3 threshold:

```json
{
  "breakpoints": { "sm": 640, "md": 768, "lg": 1024, "xl": 1280 },
  "mobileSurfaces": ["src/mobile/**", "**/*.mobile.css"],
  "minWidthThreshold": 320,
  "ignore": [],
  "disabled": false
}
```

The plugin works without this file — defaults are sensible for the common case.

### Use

After install, every `Write`/`Edit`/`MultiEdit` to a stylesheet is scanned post-write. Findings appear as `additionalContext` for the agent's next turn. No tool calls are blocked.

| Command | Purpose |
|---|---|
| `/responsive:catalog` | Print the configured breakpoint catalog |
| `/responsive:audit [--changed-only\|--full-repo] [--baseline <ref>] [--json\|--markdown]` | Scan; advisory by default |
| `/responsive:audit --strict [--severity warn\|concern]` | CI mode — exits non-zero on findings at or above the severity floor |

### Severity

| Severity | Meaning | Default `--strict` exits non-zero? |
|---|---|---|
| `info` | Notable but probably fine (e.g. `100vh` on a non-mobile file) | no |
| `warn` | Likely a problem in responsive contexts | yes |
| `concern` | Almost certainly a problem (e.g. stylesheet with no `@media` at all) | yes |

### Verify

```bash
npm test
```

41 / 41 passing.

## Status

v0.1 — pre-release. Four checks for v0.1; two more (Tailwind-in-flex, touch-target size) deferred to v0.2 because they need cross-line context that regex can't see cleanly.

See `dev-docs/02-spec.md` for the architectural commitment, the four checks, and what's explicitly out of scope. See `dev-docs/05-decisions.md` for the eight decisions that shape the plugin's contract.

## License

[ISC License](LICENSE) — free to use, copy, modify, and distribute.
