---
description: Scaffold .responsive/config.json with default breakpoints
---

Create the ui-responsive config file at `.responsive/config.json` so the plugin knows your project's breakpoints, mobile-targeted file globs, and fixed-width threshold.

## Steps

1. **Run init.**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/commands/cli.mjs" init
   ```
2. **Surface the result to the user** verbatim. If the config already exists, the CLI says so and exits — do not overwrite. If the CLI exits non-zero unexpectedly (any case other than the existing-config message), surface stderr verbatim and stop.
3. **Suggest next steps:** `/responsive:catalog` to verify the breakpoints are right; `/responsive:audit` to scan the codebase.

## Output format

On success:

- `✓ Created .responsive/config.json with default breakpoints (640/768/1024/1280).`
- A short list of editable fields (`breakpoints`, `mobileSurfaces`, `minWidthThreshold`)

If config exists:

- `✓ Config already exists: .responsive/config.json`
- `  Edit it directly to customize breakpoints, mobileSurfaces, threshold.`
