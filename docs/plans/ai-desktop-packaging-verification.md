# AI desktop packaging and default profile

25 November 2026. Based on personal-fork main after PR #39 (`495f21e`).
The release version is **0.50.2**. This report distinguishes local stage-build
verification from hosted release publication.

## Result and causes

The running development IDE used a frozen old backend with a newer frontend and
several manually installed plugins. It did not prove that a clean package would
contain the same features. Agent Team and DeepSeek Web were missing from the
bundled registry; Memory and Browser Automation were optional installs. Community
themes/icons/traces lived in local Git caches. Runtime copying omitted theme and
license files. A theme's install hook also does not run during automatic builtin
reconciliation, so it could not set the fresh profile's palette.

AI now bundles these sources at fixed revisions, retains their original authors
and licenses, and enables the personal profile automatically. A server-owned,
atomic appearance seed sets Codex only if no saved appearance row exists. An
explicit choice of the default or a custom palette is retained. Codex's seven
layout options default on; saved overrides remain authoritative. Provider login
sessions, cookies, credentials and the user's database are not packaged.

Visible desktop/app branding and icons say AI. Internal workspace names, `bb`
commands, provider IDs, wire protocols and existing data formats remain stable.
The separate app identity is `dev.maarriik.ai`; nightly adds `.nightly`. Default
runtime profiles are `~/.ai-ide` and `~/.ai-ide-nightly`, with ports
39886/39887 and 39986/39987 respectively. Explicit source QA settings are kept.

## Packaging and update contracts

Existing electron-builder tasks produce macOS arm64 DMG/ZIP and native Linux
DEB/AppImage. The Debian package/executable is `ai-ide`, with a separate nightly
name, and does not own `/usr/bin/bb`. Linux desktop-entry identity matches the
Electron identity. Local builds never publish. The manual personal workflow uses
macOS arm64 and Ubuntu x64 runners, stores artifacts by default, and only
publishes when explicitly selected in MAARRIIK/bb. The inherited upstream desktop
jobs are guarded against running in the personal fork.

Both updater implementations use MAARRIIK/bb feeds. ARM64 Linux metadata filenames
are recognized for local feed generation. The hosted workflow currently publishes
x64 Linux; ARM64 installer availability does not establish a hosted ARM64 update
channel. Debian upgrades use the package manager. Unsigned local macOS artifacts
were tested; signed/notarized automatic updates are not claimed.

The desktop shell always rebuilds its source-commit metadata. Expensive runtime
and plugin tasks retain Turbo caching. See [build and update commands](../ai-desktop.md).

## Automated evidence

- **534 unique passing tests across 30 affected files**, in focused sequential
  Turbo runs after fixing stale branding expectations. Coverage includes real
  SQLite fresh/repeated appearance seeding, explicit palette preservation,
  actual runtime theme/license copying and escape rejection, release config,
  native architecture selection, ARM64/x64 version feeds, desktop recovery,
  onboarding, updates, plugin controls, root-page title and layout constraints.
- The full native build/typecheck/lint graph completed **80 tasks**; final
  affected typecheck/lint completed **12 tasks** after later UI and release fixes.
- Both workflow files were parsed and their repository guards inspected.
- `git diff --check` passed. No daemon protocol or database migration changed.

Private log names under `.tmp/verify-ai-packaging-20261125/` include
`native-build-checks-2.log`, `final-lint-types.log`, `native-tests-2.log`,
`native-tests-app-all-final.log`, `native-tests-plugin-detail-final.log`,
`native-release-tests-final-2.log`, `final-style-tests.log` and `test-counts.json`.
Passing owner-file reruns supersede the earlier failures recorded in those logs.

## Actual packaged applications

macOS stage build:

- Generated the DMG, ZIP, blockmaps and desktop-version feed.
- `hdiutil verify` accepted the DMG checksum. Mounted read-only; its application
  name was AI and bundle ID `dev.maarriik.ai`.
- Launched **AI.app from the DMG**, with fresh owned data, separate Electron state
  and default AI ports. Server and daemon connected successfully.
- **49 plugins installed; all 39 enabled plugins running**, with no path-source
  dependencies. The fresh palette was `plugin:codex-theme:codex`.
- A real authenticated Codex **gpt-6-luna / medium** turn returned
  `AI_PACKAGE_QA_OK`. Its response appeared in the native window. The Trace
  message action opened and rendered the bundled trace panel through the current
  SDK; the composer exposed its model-assignment menu.

Ubuntu stage build:

- Built natively in an owned **Ubuntu 24.04 ARM64** Docker environment, not by
  cross-compiling macOS native modules.
- Generated AppImage and DEB. Installed the actual DEB through apt and started the
  installed `/usr/bin/ai-ide` under Xvfb as a non-root user.
- Packaged Electron/native-module and offline npm checks passed. `dpkg` reported
  package `ai-ide`, architecture `arm64`; the installed executable reported ARM64.
- **49 plugins installed; all 39 enabled plugins running**, including the nine
  personal-profile additions, all from bundled sources. Codex was the fresh
  palette and all seven layout options defaulted on.
- The Agents page opened on a fresh profile. Missing provider sign-in was shown
  explicitly; an installed provider was not treated as authenticated.

These checks do not establish native physical Ubuntu GPU behavior, a completed
hosted x64 build, or signed macOS updates. Stage-build version 0.50.1 was used for
the initial Debian installation; release rebuild/upgrade evidence and exact main
commit are recorded separately with the final artifacts and private handoff.

The user's existing IDE, server, daemon and data were preserved throughout.
Screenshots, model output and inventories stay private in the evidence directory.
