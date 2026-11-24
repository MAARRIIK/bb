# Composer readability and queue assignment

Verified on 25 November 2026, based on personal-fork PR #38 (`fb17ee13`).

The separate queue-assignment helper bar is removed. **Send options → В очередь с моделью** opens the existing assignment form; its short explanation appears only inside the menu. The arrow remains available with an empty draft, with a disabled item explaining that text is required. Opening or cancelling the form does not send a request or switch the running provider.

Queued text now shows a three-line preview with localized expand/collapse controls. Actions occupy their own space beside the text. The drawer measures its content and grows up to its 300–360 px cap, then scrolls. Git change summaries and merge-base controls use foreground contrast.

## Implementation and existing interfaces

Core passes the action to the first-party composer through private browser-only plumbing recorded in `docs/api_to_audit.md`. No server, daemon protocol, database or public SDK contract changed. Assignment still uses the existing `threads.queuedMessages.create` SDK path and the existing `bb thread queue create --provider ... --model ... --permission-mode ... --provider-switch-policy manual|recent-messages` CLI command. Submission locking, cancellation and attachment handling are shared with the existing assignment flow.

## Automated verification

- A single Turbo graph ran the affected app and shared UI tests: **302 passed**, seven files. Coverage includes desktop/touch, idle/running, empty/nonempty drafts, cancellation and reopening with fresh form values, draft and attachment preservation, measured resizing, constrained-height inline editing and queue ordering.
- A single Turbo graph completed **20 tasks** for app/shared UI/composer/Git typecheck, lint, build and bundled-plugin preparation. Existing warning-only compiler/bundler diagnostics remain; no errors.
- `git diff --check` passed.

Private logs: `.tmp/toolchain/composer-readability-final-tests-4.log` and `.tmp/toolchain/composer-readability-final-build-3.log`.

## Live isolated QA

The QA instance used separate marked data and ports 21716/29716/9229, with the same frozen PR #36 backend as the running personal IDE. Only the compiled app and first-party composer/Git frontend assets were updated. Codex Theme 0.2.3 had all seven settings enabled. A synthetic Git repository reproduced **32 changed files, +4415 / -0** and a long branch name; no user repository state or screenshot was copied into the fixture. Echo was a local canary, not a real LLM.

Observed baseline: a 65 px queued row was clipped inside a 55 px viewport; Git summary foreground alpha was 0.65. After the change, a short queue had equal client/scroll heights of **127 px**, and Git foreground was opaque `rgb(205, 214, 244)`.

Passed through real browser input:

- Desktop 1280×1000 and constrained 1280×700: helper bar absent, arrow accessible with empty draft, disabled explanation visible; nonempty menu includes model assignment and existing Save draft / Send later actions.
- Assignment opens after the menu closes. Cancellation preserves the draft and uploaded file. Changing reasoning to low, cancelling and reopening restores the initial medium selection. The app root is neither inert nor aria-hidden while the assignment form is settled open.
- Mobile Chromium 390×844 with touch: Send options uses the persistent bottom drawer; model assignment opens its own scrollable drawer. The app root stays accessible and horizontal document overflow remains zero.
- Expanded mobile queue reaches the **300 px** cap and scrolls its full 402 px content inside a 236 px viewport. The desktop short queue has no unnecessary scroll clipping.
- The scheduled canary queue item was byte-for-byte unchanged after menu and cancellation checks. No prompt was dispatched by these interactions.

Evidence is private under `.tmp/verify-composer-readability-20261125/`, including desktop/menu/mobile screenshots. Native iOS Safari was not run; mobile evidence is Chromium emulation.

## Working IDE delivery

The checked frontend assets were delivered with backups under `.tmp/personal-bb-launch/composer-readability-20261125/`. The actual Electron window was reloaded and inspected: the helper bar is absent, the 24 px menu arrow is available during the active turn, Git text is opaque and there is no horizontal overflow. The frozen checkout's source remains clean, and its server launch identity remained unchanged. Electron, server, daemon and running turns were not stopped.
