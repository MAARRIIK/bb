# Pi provider

Status: **2026-09-05: 2 passed, 3 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Installed/authenticated Pi RPC executable on the disposable host; inspect current plugin configuration and host discovery.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/provider-pi/package.json`
- `plugins/provider-pi/server.ts`
- `plugins/provider-pi/src/api-connections.tsx`
- `plugins/provider-pi/src/api-providers.ts`
- `plugins/provider-pi/src/api-providers-contract.ts`
- `plugins/provider-pi/src/cli.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| API connections | In Pi plugin settings, save dummy keys for each preset globally and for a disposable project, switch language and reload, remove the project override; compare `bb pi api-providers --json`, the read-only preset RPC and `bb machine env list --project <id> --json`. Inspect catalog through an isolated Pi agent directory; do not send dummy keys to inference APIs. | Global/project writes use the encrypted environment owner, saved values stay masked, deleting an override restores inheritance. The draft clears on service/scope change and after success. Native Pi credentials retain priority; saving and listing do not claim remote authentication. English/Russian changes update mounted plugin UI. Repeat at compact width; Chromium does not prove Safari. |
| Discovery and options | Refresh models/reasoning, select a supported model, and start a short turn. | Catalog and execution agree; unsupported permission modes are not presented as supported. |
| RPC lifecycle | Exercise streaming, tool output, follow-up, stop, error and restart. | RPC events produce correct thread state and recoverable failures. |
| Fork and compact | Fork a synthetic conversation and compact each branch as supported. | Branch context and subsequent continuation stay independent and preserve supported history. |
| Skills and overrides | Resolve a native skill and use documented executable/environment overrides on the disposable host. | Only configured overrides affect discovery/execution; malformed settings fail at the boundary. |
| Maintenance | Inspect version, install status, and authentication with the CLI available then unavailable. | Health reports actual capability and actionable failures. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
