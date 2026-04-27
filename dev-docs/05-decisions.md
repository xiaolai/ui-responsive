# ui-responsive — decisions log

Date: 2026-04-27

This log captures decisions that materially shape the plugin's contract. Each entry has a Why so future-me can verify it's still load-bearing before changing the code that depends on it.

---

## D-001 — Never gate. Always advise.

The plugin emits `additionalContext` from `PostToolUse` and never `permissionDecision: "deny"`. There is no `PreToolUse` hook at all.

**Why:** Responsive design is a layout-intent concern, not a literal-substitution concern. `width: 1200px` may be a deliberate max-width container; missing `@media` may be fine for a fixed admin panel. Heuristic-based denies on judgment calls produce false positives that erode trust faster than the true positives build it. ui-tokenize earns the right to deny because it has confidence-1.0 rewrites; this plugin has none.

**How to apply:** any new check must work as advice, not as a block. If a check would only be useful as a gate, it doesn't belong in this plugin.

## D-002 — Regex-only scanner in v0.1; AST in v0.2

Same pattern as ui-tokenize R-08. Pure Node ESM, zero runtime deps. AST scanners (oxc-parser) deferred until they unlock checks the regex layer can't approximate.

**Why:** Faster to ship, smaller install footprint, the four v0.1 checks fit regex cleanly. Two v0.2 checks (Tailwind-in-flex, touch-target) need AST and are explicitly out of scope until then.

**How to apply:** if a proposed check needs cross-line context that regex can't see, defer to v0.2 — don't bend regex to fit it.

## D-003 — Hooks fail SILENT on malformed input, not closed

`PostToolUse` exits 0 with no output when stdin is malformed.

**Why:** ui-tokenize's audit (finding #4) flagged hooks failing open as a security gap, and the fix was to fail closed. That argument applies *only when there's a gate*. ui-responsive has no gate. Failing closed here would mean… nothing, since there's nothing to deny. The right behavior on garbage input is to stay silent — emitting fake advisory text on a corrupted event would be worse than emitting nothing.

**How to apply:** anywhere the plugin would emit advice, validate the input first. Bad input → emit nothing. Good input → emit advice.

## D-004 — Per-PID NDJSON ledger; same shape as ui-tokenize

Reuse the proven concurrency-free pattern: `<root>/.responsive/ledger/<pid>.ndjson` per-process append; compaction at SessionStart and `/responsive:metrics`.

**Why:** ui-tokenize R-13 settled this pattern after Codex audit critique #11; no need to re-litigate. Different event types (`finding-surfaced`, `finding-acknowledged`) but same file shape and locking discipline.

**How to apply:** never write `session.json` directly; always go through `appendEvent()` and compact lazily.

## D-005 — Catalog of breakpoints is OWN config; no coupling to ui-tokenize

The breakpoint catalog lives in `.responsive/config.json`, not pulled from `.tokenize/catalog.json`.

**Why:** Shipping ui-responsive shouldn't require installing ui-tokenize. Some projects use Tailwind defaults, some have CSS variables, some have no system at all. Defaults shipped with the plugin (640/768/1024/1280) cover the common case; users can override.

**How to apply:** if v0.2+ wants to integrate with ui-tokenize, it should be opt-in (a config flag like `"breakpointSource": "ui-tokenize"`), not mandatory.

## D-006 — `--strict` is opt-in for CI, not default

Default audit exit code is 0 regardless of findings. `--strict` makes it gate.

**Why:** Same reasoning as D-001 at a coarser granularity. CI gates that fire on heuristics get disabled. Users who want the gate can opt in; the rest get a useful report without breakage.

**How to apply:** never default to non-zero exit; never advertise the gate as the primary feature.

## D-007 — Severity drives sort order, never dispatch

Severity (`info` / `warn` / `concern`) is metadata for the report, not a behavior switch.

**Why:** A check's severity should be evident from the check itself. Branching code on severity invites "but this case is special" exceptions and the system loses its predictability.

**How to apply:** scanner sets severity once per check definition. Reporters sort by severity. Nothing else reads it except `--strict --severity=<level>`.

## D-008 — License: ISC

Matches the family direction (vmark, ui-tokenize moved to ISC). Public-domain-equivalent simplicity.

**Why:** Reduces friction for downstream consumers; permissive without MIT's slightly heavier preamble.

**How to apply:** LICENSE file ships verbatim from ui-tokenize's; package.json + plugin.json + marketplace.json all say `ISC`.
