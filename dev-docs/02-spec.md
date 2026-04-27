# ui-responsive — v0.1 specification

Date: 2026-04-27
Status: scoping
Sibling-of: `ui-tokenize` (shares `lib/` patterns; diverges in stance)

---

## Architectural commitment

This plugin is **advisory**, not gating. Three rules, in order of importance:

1. **Never deny a tool call.** No PreToolUse hook. No `permissionDecision: "deny"` ever. The agent's edit always lands.
2. **Never silently rewrite.** No `updatedInput` mutations. The agent sees what it wrote.
3. **Surface findings as `additionalContext` after the write.** PostToolUse hook appends a structured warning report. The agent reads it on the next turn and decides what to do.

Why these rules: responsive design is a *layout-intent* concern (`width: 1200px` may be deliberate; missing `@media` may be fine for a fixed admin panel). There are no confidence-1.0 rewrites in this domain except one (`100vh → 100dvh` on mobile-flagged files), and even that's better as opt-in audit fix than auto-rewrite. A plugin that denies on heuristics gets disabled on day three. A plugin that whispers gets listened to.

This is the inverse of `ui-tokenize`'s rewrite-first stance, and the divergence is intentional.

## What it detects (v0.1: four checks)

The scanner is regex-only, by design. Each check has a clear precision contract.

### C1 — Hardcoded breakpoint values not matching the catalog

**Detect:** `@media (min-width: <N>px)` / `(max-width: <N>px)` where `<N>` is not in the configured breakpoint catalog.

**Why:** Off-catalog breakpoints (`801px`, `999px`) almost always indicate an LLM guess instead of using the design-system's named breakpoints. False positive rate is very low when a catalog is configured; the check is *suppressed entirely* when no catalog is found.

**Surface:** advisory. Suggestion includes the nearest catalog breakpoint.

### C2 — Bare `100vh` in CSS likely targeted at mobile

**Detect:** `100vh` in any CSS / SCSS / LESS / inline-style / styled-components literal.

**Why:** iOS Safari's address-bar collapse causes `100vh` to overflow the viewport. The `dvh` unit (dynamic viewport height) is the modern fix. The flag is *advisory* because not every project targets mobile, and `100vh` on a kiosk is fine.

**Surface:** advisory. Suggestion is `100dvh` with a link to a one-line explanation.

### C3 — Fixed `width` (not `max-width`) on block-level rules

**Detect:** `width: <N>(px|rem|em)` declarations *not* paired with `max-width` in the same rule, where the value is ≥ 320px (small enough widths are usually icons/buttons).

**Why:** Fixed widths on layout blocks break responsiveness. `max-width: <N>` + `width: 100%` is the responsive idiom. Threshold + pairing check holds the false-positive rate down.

**Surface:** advisory. Suggestion: `max-width: <same value>; width: 100%`.

### C4 — Stylesheets with fixed dimensions and zero `@media` rules

**Detect:** `.css` / `.scss` / `.less` files that contain at least one C3-style fixed width and zero `@media` rules.

**Why:** A stylesheet that styles full-page elements with no breakpoints at all is almost always non-responsive. The check fires *per file*, not per declaration, so noise stays bounded.

**Surface:** one finding per file. Suggestion: "consider adding `@media` rules for the configured breakpoints."

## What's deferred to v0.2

| Check | Reason for deferral |
|---|---|
| Tailwind arbitrary sizes inside flex/grid containers | Needs cross-line context (parent/child relationship); regex can't see it cleanly |
| Touch targets < 44×44 | Needs class-name → element-type inference; AST parse better suited |
| MUI/Chakra/styled-components `sx` props with fixed sizes | Needs JSX AST |
| `clamp()` recommendation for body font sizes | Needs prose-vs-UI distinction |
| Container query suggestions | Needs intent inference |

## What it does NOT do (explicit non-goals)

- **Not a gate.** Never blocks writes. Never returns non-zero exit by default. `--strict` is opt-in for CI users who explicitly want a gate.
- **Not a CSS linter.** Stylelint covers prefix support, vendor errors, shorthand consistency, etc. ui-responsive is *only* about responsiveness.
- **Not an accessibility tool.** Touch-target size is the closest it comes; broader a11y is out of scope.
- **Not a layout reviewer.** Doesn't comment on grid/flex choices, alignment, spacing.

## Configuration

`.responsive/config.json`:

```json
{
  "breakpoints": {
    "mobile": 640,
    "tablet": 768,
    "desktop": 1024,
    "wide": 1280
  },
  "mobileSurfaces": ["**/*.mobile.css", "src/mobile/**"],
  "minWidthThreshold": 320,
  "ignore": [],
  "disabled": false
}
```

All fields optional. If absent, sensible defaults apply (the four breakpoints above; `mobileSurfaces` empty so C2 fires everywhere; threshold 320px).

## Surfaces

Same surface set as `ui-tokenize` for v0.1:

- `.css`, `.scss`, `.less`, `.pcss`
- `.tsx`, `.jsx` inline `style={{}}` and styled-components / emotion / vanilla-extract template literals (best-effort regex)
- `.vue`, `.svelte`, `.astro` `<style>` blocks
- `.html` `<style>` blocks and `style="…"` attributes

## Outputs

| Where | Shape |
|---|---|
| PostToolUse hook | `{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "<finding report>" } }` — never deny |
| `/responsive:audit --json` | `{ mode, filesScanned, findings: [{file, line, check, severity, suggestion}], coverage: { mediaQueriesPerFile } }` |
| `/responsive:audit --markdown` | grouped tables: per-check, per-file |
| MCP `responsive__check_file` | structured finding list for one file |

## Severity

Three levels. All are advisory; severity drives sort order in reports, nothing else.

| Severity | Meaning | Examples |
|---|---|---|
| `info` | Notable but probably fine | `100vh` on a desktop-only file |
| `warn` | Likely a problem in responsive contexts | Fixed `width` ≥ 320px without `max-width` |
| `concern` | Almost certainly a problem | Stylesheet with no `@media` at all |

`--strict` mode treats `warn` and `concern` as gate failures (CI use only).
