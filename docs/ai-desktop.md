# AI desktop packages

AI is the personal desktop distribution from `MAARRIIK/bb`. Workspace package
names and the internal `bb` CLI remain unchanged. The installer uses application
ID `dev.maarriik.ai`, displays `AI`, and installs the Linux desktop executable
and Debian package as `ai-ide`. Nightly uses `dev.maarriik.ai.nightly`,
`AI Nightly`, and `ai-ide-nightly`. Neither Debian package owns `/usr/bin/bb`.
AI's owned server uses `~/.ai-ide`, server port `39886`, and daemon port `39887`.

## Local builds

Use Node.js 22.19 or newer and pnpm 9.15.0. Run from the repository root:

```sh
pnpm install --frozen-lockfile
```

On an Apple Silicon Mac, build a DMG for installation and a ZIP for updates:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec turbo run desktop:build --filter=@bb/desktop --output-logs=new-only
pnpm --dir apps/desktop run desktop:version-feed
```

Open the DMG in `apps/desktop/release/` and drag `AI.app` to `/Applications`.
The unsigned build requires manual approval in macOS Privacy & Security after
its first launch. A downloaded unsigned build may be blocked by Gatekeeper.
For reliable macOS automatic updates, sign and notarize every release with a
consistent Apple Developer identity.

On Ubuntu, build a Debian package and an AppImage for the machine's native
architecture:

```sh
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop --output-logs=new-only
pnpm --dir apps/desktop run desktop:version-feed
sudo apt install ./apps/desktop/release/AI-*.deb
ai-ide
```

Use an Ubuntu x64 builder for the x64 release. Native Ubuntu arm64 builds are
also supported for local manual installation; the published CI channel targets
x64. ARM64 automatic updates are not configured by this workflow. Explicit architecture selection is available when the builder
and native dependencies support that target:

```sh
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop --output-logs=new-only -- --x64
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop --output-logs=new-only -- --arm64
```

Build one architecture per clean output directory; remove previous installer
artifacts before switching architectures. Cross-building from macOS does not
verify Linux native dependencies or Debian installation. For an isolated local
launch, set `BB_DESKTOP_USER_DATA_DIR` when using the existing packaged app
launcher; the normal installed AI profile remains separate from upstream bb.

## Repeatable CI and publication

The manual **Build AI Desktop** workflow builds macOS arm64 DMG/ZIP on
`macos-15` and Ubuntu x64 DEB/AppImage on `ubuntu-22.04`. Its jobs typecheck and
test the desktop and launcher, smoke-test the packaged app, and install the
actual Debian package. The Ubuntu baseline fixes the build environment's glibc
version. The macOS runner labels are documented in the
[GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Choose `latest` or `nightly`, optionally set a version override, and run the
workflow. The default stores downloadable workflow artifacts without publishing.
With GitHub CLI:

```sh
gh workflow run build-ai-desktop.yml --repo MAARRIIK/bb --ref main -f release_channel=latest -f publish=false
```

To publish a release, choose a new version and explicitly enable `publish`:

```sh
gh workflow run build-ai-desktop.yml --repo MAARRIIK/bb --ref main -f release_channel=latest -f version=0.50.2 -f publish=true
```

The publication job only runs in `MAARRIIK/bb`. It creates the immutable
`desktop-v<version>` release, then refreshes `desktop-latest` or
`desktop-nightly` with the complete artifact set. An existing versioned release
is rejected. Both channels need unique versions; prereleases use `nightly`.
The inherited upstream desktop workflow is disabled in the personal fork.
Local packaging always uses `--publish never`.

The complete optional macOS signing secret set is `MACOS_CERTIFICATE_P12`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`, and
`APPLE_TEAM_ID`. `MACOS_CERTIFICATE_NAME` optionally selects an identity.
Missing all signing secrets produces unsigned installers; a partial set fails
the build. Unsigned installers can be published for manual installation, but
that does not establish working macOS automatic updates.

## Updates

Both the desktop update checker and electron-updater use only these fork feeds:

- `https://github.com/MAARRIIK/bb/releases/download/desktop-latest/`
- `https://github.com/MAARRIIK/bb/releases/download/desktop-nightly/`

Keep the generated `latest-mac.yml` or `nightly-mac.yml`, ZIP, DMG, blockmaps,
and `desktop-version.json` together. Linux uses the matching `*-linux.yml`,
AppImage, and `desktop-version-linux.json`. A native ARM64 local build instead
reads `latest-linux-arm64.yml` or `nightly-linux-arm64.yml` when generating its
local version JSON. Publish the x64 CI feed to the shared update channel. The
updater replaces a writable x64 AppImage. A Debian installation checks the fork version feed and is upgraded by
installing the newer DEB with `sudo apt install ./AI-<version>-<arch>.deb`.
There is no apt repository or automatic DEB replacement in this workflow.

Until the first successful publication, these feed URLs can return 404. A
release needs both platform jobs to pass before the moving channel is updated.

## Included personal profile

A fresh AI installation automatically installs and enables Agent Team, Agent
Traces, agent icons, Codex Theme, Lavender, Memory, Browser Automation, DeepSeek
Web, and workflows alongside the existing Codex, Claude Code, Pi and ACP
providers. Codex Theme is selected when no appearance has been saved; its seven layout
options default on. Saved user choices survive updates.
Queue assignment, provider switching, usage limits, language preferences and
retained worker worktrees are core features in this same source tree.

The four community plugins are vendored at fixed commits. Each source directory
contains its original license and a `SOURCE.md` identifying the origin and local
adaptations; packaging preserves these notices. No user data, API keys, browser
cookies or provider login sessions are bundled. Qwen/Kimi/Antigravity and other
ACP agents still need their supported CLI and sign-in; DeepSeek Web needs manual
sign-in in AI's browser. An enabled provider is not proof of authentication.

The desktop shell is rebuilt on each invocation so its About panel can identify
the actual source commit; expensive runtime and plugin builds retain Turbo caching.
