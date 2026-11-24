# ACP providers

Status: **2026-09-05: 2 passed, 4 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Enable provider-acp; use installed/authenticated test ACP executables. Provider choices come from current host discovery and custom configuration.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/provider-acp/package.json`
- `plugins/provider-acp/server.ts`

## Feature recipes

| Feature                          | Drive                                                                                              | Observable success                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Discovery and configuration      | Inspect built-in discovery and add a harmless custom ACP config using its schema.                  | Installed/configured providers appear with accurate health; malformed config fails explicitly.                 |
| Model and reasoning discovery    | Open pickers and refresh a provider’s live catalog.                                                | Available models and reasoning match capabilities without hardcoded historical names.                          |
| Turn lifecycle                   | Run thread-lifecycle, streaming, tool interaction, stop, and follow-up with the test ACP provider. | Protocol events map to correct thread state and supported permission behavior.                                 |
| Steer and queue                  | Steer while active, then send a queued follow-up; inspect actual provider session events.          | Cancellation/continuation semantics match the current ACP adapter; late updates do not reopen a finished turn. |
| Permissions and questions        | Exercise declared permission modes and native/fallback interactions.                               | Unsupported modes are rejected; approval and answer boundaries reach the active provider session.              |
| Skills, authentication, failures | Resolve a native skill, test missing login/executable and a broken ACP process.                    | Skills and health follow host capability; failure remains inspectable with a recoverable thread state.         |

## Subscription setup

In isolated source QA, enable provider-acp and open its plugin settings.
Follow Open subscription connections to the Subscriptions page; also exercise
the sidebar entry. Native terminal opening must be checked on that page, since
the generic plugin-settings host can decline terminal navigation.
Check Russian and English, desktop and narrow layouts. Add each subscription
profile and reload; custom agents must remain intact. Sign-in stays disabled
until an explicit connected machine is chosen. Check the same list/add/login
path through `bb acp subscriptions --help` and `sdk.plugins.callRpc`.

Sign-in creates a terminal on the chosen machine with the documented native
command. Repeated and concurrent requests must reuse a running terminal; an
exited terminal permits a new one. A declined or failed panel navigation must
preserve the terminal receipt without reporting successful authentication.
Offline machines and altered launch command/env/cwd must fail before creating
a terminal. Do not read credential files or log browser authorization codes.

Actual authentication and a real model task require the user's eligible account
and native agent. Report these separately from terminal setup. Missing `agy`,
network/package failures, or unavailable accounts are blocked checks, not an
OAuth pass. Restore only the isolated store's profiles and terminals.

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

## Maintenance notes

- Custom agents use an unprefixed slug in id; BB prefixes it with acp-. Discover the resulting provider ID from the live catalog before spawning. Configure through plugin config provider-acp customAgents and restore the original string afterward. Source: `plugins/provider-acp/src/agents.ts:9`.
