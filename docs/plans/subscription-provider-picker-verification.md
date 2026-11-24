# Subscription providers in the normal model picker

Verified on 2026-11-24 against personal fork main after PR35 plus this change.

Antigravity, Kimi Code and cloud Qwen Code are shipped ACP definitions, visible
in the normal provider/model picker beside Codex and Claude without first
adding customAgents. Launch and login commands share the same pinned profile
source. Subscriptions remains the native account setup page, with updated
Russian and English guidance. Existing CLI and SDK operations are preserved.

Existing custom command/args/env/cwd overrides still take precedence and survive
plugin reload; removing an override restores the shipped definition. A matching
explicit profile inherits the shipped sign-in hint. Changed launches do not
inherit that hint and cannot use the standard subscription login shortcut.
Disable/enable uses the existing provider catalog path. No daemon wire changes
or migration are required; protocol remains 284.

## Automated checks

`pnpm exec turbo run test typecheck lint --filter=bb-plugin-provider-acp`:
10 successful tasks; 106 tests in 10 files passed. Three entry-point regression
cases also failed when automatic subscription registrations were temporarily
removed (missing provider registration), then passed after byte-exact restore.
The tests cover default login without Add, custom override persistence, login
rejection, and restoration. Removed the obsolete declaration-only assertion
that every shipped ACP agent must have a native skill-root resolver; actual
filesystem resolver tests remain intact.

The verification inventory still reports the pre-existing unmapped CLI family
`diagnostics`; this is not a whole-map pass.

## Isolated live verification

Own checkout/store and source CLI, server 21716 and daemon 29716; the user's
working desktop at 22028 was not restarted. Optimized dry-run build passed all
61 tasks. Private evidence: `.tmp/verify-provider-picker-20261124/`.

- With empty customAgents, CLI and SDK catalogs contain all three enabled
  providers and subscription list reports effective profiles ready for setup.
- Actual browser clicks opened the shared picker and its Antigravity/Qwen/Kimi
  tabs. Desktop and 390×844 layouts fit all provider icons; screenshots read.
- Missing `agy` produced CLI not found with the official installation link.
  Qwen discovery reported Not signed in. No fabricated model list or account
  authentication was shown.
- Disabling Kimi through CLI removed its tab after reload; re-enabled afterward.
- Russian and English subscription setup show Sign in directly, disabled until
  a connected machine is explicitly selected. An actual click without Add
  opened the native Antigravity login terminal; missing CLI remains a setup
  blocker, not a successful sign-in.
- SDK settings/reload preserved a nonstandard Kimi command, env and cwd; the
  standard login shortcut rejected it. Removing the override restored Kimi.

Actual Google/Kimi/Qwen OAuth and successful cloud model requests were not run:
these require the user's eligible account and installed native agents. Chromium
narrow-layout verification is not native iOS Safari verification.

Owned QA browser, server and daemon stopped; marked isolated data removed.
The user separately requested Art Sidebar Canvas installation in their running
IDE; that configuration is independent of this source change.
