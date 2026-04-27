---
description: Print the configured breakpoint catalog
---

Print the breakpoint catalog ui-responsive uses. If `.responsive/config.json` is absent, the default catalog (640/768/1024/1280) is shown with a `(default)` marker.

## Steps

1. **Run the catalog printer.**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/commands/cli.mjs" catalog
   ```
2. **Show the output verbatim** so the user sees breakpoint names + values, the configured `mobileSurfaces` globs, and the C3 threshold. If the CLI exits non-zero unexpectedly (e.g. malformed `.responsive/config.json`), surface stderr verbatim and stop.
3. **Recommend `/responsive:init`** if the user is on the default catalog and wants to customize.

## Output format

```
Breakpoints (default)|(from .responsive/config.json):
  mobile   = 640px
  tablet   = 768px
  desktop  = 1024px
  wide     = 1280px

Mobile surfaces: <comma-separated globs or `(none — C2 stays at info severity everywhere)`>
Min-width threshold for C3: <N>px
```

The catalog drives audit C1 (off-catalog breakpoints) and the SessionStart context injection — surface it directly when the user asks "what breakpoints are configured?"
