# ui-responsive plugin instructions

This plugin is **advisory**, not gating. It scans CSS / SCSS / LESS / JSX-style files post-write and surfaces responsive-design findings as `additionalContext` on the next turn. It never blocks a tool call. It never silently rewrites.

This is the opposite stance from `ui-tokenize`, on purpose.

## Prerequisites

- Node.js ≥ 20 (pure ESM `.mjs`, no build step).
- Zero runtime dependencies; no `npm install` is required for the plugin itself.
- A git repository if you want `--changed-only` audit mode.

## Install

```bash
claude plugin install ui-responsive@xiaolai --scope project
```

Configure once (optional):

```
/responsive:init
```

This creates `.responsive/config.json` with default breakpoints (640 / 768 / 1024 / 1280). The plugin runs fine without it — defaults are sensible.

## Verify

```bash
npm test
```

Expected: 41 / 41 passing.

## What you should know as the agent

- **You will see PostToolUse advisory context** after writing a stylesheet that has responsive issues. Findings include the literal, the suggested rewrite, and a one-line explanation. Apply the suggestion if it fits the layout intent; ignore it if the literal was deliberate (e.g. `1200px` on a max-width container that's *already* a max-width container).

- **The plugin will never deny your tool call.** The edit always lands. If something looks like a deny, it's not from ui-responsive — check `ui-tokenize` or another gate.

- **The MCP tools are read-only:**
  - `responsive__check_file({ path })` — scan one file on demand
  - `responsive__list_breakpoints()` — see the configured catalog
  - `responsive__suggest_dvh({ value })` — get a vh→dvh recommendation with rationale

- **Use the configured breakpoints in `@media` queries.** `responsive__list_breakpoints` tells you their names and values. Off-catalog breakpoints (e.g. `min-width: 801px` when the catalog has 768) will be flagged as `warn`.

- **Prefer `100dvh` over `100vh`** on files that target mobile. The C2 check escalates from `info` to `warn` when the file matches a `mobileSurfaces` glob.

- **Pair fixed widths with `max-width`.** `width: 1200px` alone breaks responsiveness; `max-width: 1200px; width: 100%;` is the responsive idiom and won't be flagged.

- **Stylesheets that have fixed layout widths but no `@media` rules** get a file-level `concern` finding. Add at least one breakpoint or move sizing to `max-width`.

## When you should NOT change something the plugin flagged

- The literal is correct for a non-responsive context (kiosk display, fixed-width admin panel, print stylesheet).
- The fixed `width` is on a logo, icon, button, or other element where exact pixel size is part of the design.
- The breakpoint is intentionally off-catalog because you're targeting a specific device viewport not in the design system.

In these cases, ignore the advisory. The plugin won't penalize you for it; it will just keep flagging on future edits unless you suppress with `--suppressions <file>` (audit) or add to `.responsive/ignore`.

## Severity

| Severity | Default `--strict` exits non-zero? |
|---|---|
| `info` | no |
| `warn` | yes |
| `concern` | yes |

`--strict` is for CI users who explicitly opt in. Default audit always exits 0.

## Audit awareness

`/responsive:audit` is descriptive: it tells you what would have been flagged across the codebase. Coverage statistic (`stylesheets with @media` ratio) is informational only — never gates by default. Treat it as a trend, not a target.
