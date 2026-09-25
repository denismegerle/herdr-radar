# Harness changes to Radar

Upstream: https://github.com/hhdebb/herdr-radar (MIT). Fork: https://github.com/denismegerle/herdr-radar.
Base: `v1.3.15` (`4b3b82d237a0d9c86aec70366219ce1c8807b0f7`); changes live on `custom`.
The harness superproject pins an exact fork commit; a new upstream release does not auto-update installations.

Differences from upstream:
- Generate exactly two selectable rows per agent: live title with the workspace label inline on the first pane, then a subdued `$task` (published by `denismegerle.auto-title`). Upstream's separate group header and trailing blank spacer were attached to the first/last pane and made selection highlight three rows. Keep task layout during config repair and appearance changes; clear stale `$gap` metadata.
- Honor `HERDR_CONFIG_PATH`, including the repo config on both macOS and Windows, while keeping plugin settings under Herdr's per-machine config directory.
- Repair already-installed managed blocks on a fresh machine so a shared repo config gets that OS's tab-bar command (`cat` on macOS, `type` on Windows). Run regression tests on macOS and Windows in the fork's CI.

To update: first add `git remote add upstream https://github.com/hhdebb/herdr-radar.git` if the checkout lacks that remote (submodule clones do not inherit remotes). Then `git fetch upstream`, review the upstream manifest, launch/build hooks and dependency changes, merge the desired upstream tag into `custom`, run `npm run check && npm test && npm run prove`, verify the `$task` row and config path tests, push `custom`, then advance the harness submodule pin. Never run `git submodule update --remote` blindly. Do not `plugin install` over a linked checkout.

The generated tab-bar command includes a machine-local cache path. When a second machine starts Radar, its first-run setup rewrites that block for the new OS and user; expect a local `herdr/config.toml` diff there. Do not commit the generated change from Windows back into the shared baseline. A future version should make that command genuinely cross-platform if a portable path is available.

The generated config block is owned by Radar. Keep hand-written `[ui.sidebar.agents]`, `[ui.sidebar.spaces]`, `[ui.sidebar.agents.rows_by_agent]` and `tab_bar_right` out of `herdr/config.toml`. The daemon writes the managed blocks on first start; `node bin/configure.js --apply` can prepare them without starting Herdr. Radar writes its config atomically: **do not hardlink** the live Herdr config to the repo copy to work around an old server environment; the replace breaks hardlinks. Restart the server only at a safe time.
