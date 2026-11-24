# Durable workflows

Status: **2026-09-05: 6 passed, 2 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

Enable Workflows for a disposable project thread; bb workflows --help. Use short synthetic agents and thread-scoped artifacts.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/workflows/package.json`
- `plugins/workflows/src/server.ts`
- `plugins/workflows/src/app.tsx`

## Feature recipes

| Feature                           | Drive                                                                                                         | Observable success                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Validate and inputs               | Validate/run scripts by saved name, workspace file and inline source with literal meta and schema-valid args. | All entry points resolve the intended script and reject malformed metadata/arguments before dispatch.              |
| Agent steps and structured output | Run sequential agent steps with output schemas and inspect parent/worker links.                               | Outputs satisfy the declared contract or show a specific validation failure; children belong to the run.           |
| Parallel, pipeline, barriers      | Run a small fan-out and pipeline with phase barriers and dependencies.                                        | Independent work overlaps while dependencies receive only completed required results.                              |
| Live progress and completion      | Emit the exact returned preview directive once; inspect phase/call cards, status and bounded history pages.   | UI and CLI agree on durable progress and final completion; child links open the correct threads.                   |
| Stop and timeout                  | Stop a running fixture and exercise a short configured timeout.                                               | Run and active children settle under the documented cancellation policy without orphaned work.                     |
| Resume and cache                  | Resume a terminal run unchanged, then edit a later step and resume again.                                     | Only the causally safe unchanged prefix is reused; changed/downstream work runs live with correct inputs.          |
| Failures, limits, retention       | Trigger a child failure and configured limits; inspect history and hidden-worker retention.                   | Run failure is durable and inspectable; limits prevent uncontrolled dispatch and retained records remain coherent. |
| Sandbox and tool boundary         | Attempt unsupported filesystem/network/clock/shell access in workflow JS and a permitted agent tool call.     | Script sandbox rejects unsupported direct capabilities; supported work occurs through declared agent steps.        |

## Independent worker worktrees

In isolated QA, run a fan-out with explicit provider/model/reasoning tuples and
`workspace: {type: "worktree", baseBranch: "refs/heads/main"}`. Require distinct
worker environment IDs and paths on the origin machine, user-held workspaces,
and unique marker files absent from the origin. Check UI workspace labels and
worker navigation, CLI history and RPC view. Use more than three concurrent
workers where machine/provider capacity permits; verify limits separately.

Wait for worker archival/maintenance and confirm the user-held workspaces and
changes remain. Resume unchanged to reuse results without creating workspaces;
change workspace mode or branch to require live work. Invalid inputs or failed
provisioning must fail without falling back to the origin folder. Stop an active
fixture and confirm no new worker starts after cancellation; retain its already
created workspace. Legacy stored options default to shared and retain cache keys.
Clean up only the run's explicit environments and Git fixtures via normal core
operations. Real model work and synthetic harness tests are separate evidence.

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

## Maintenance notes

- Workflow CLI run/validate/status/history require explicit BB project+thread context. After launcher env clears inherited context, restore only IDs resolved from the synthetic source store. File paths/cwd must be inside the origin workspace. Source: `plugins/workflows/src/cli.ts:39`.
