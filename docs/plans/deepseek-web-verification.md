# DeepSeek Web verification

Source work targets the optional `provider-deepseek-web` plugin on personal
fork main after PR37. It uses BB Browser Automation and the website's visible
UI. No private DeepSeek API, copied session token, local substitute model, or
fabricated usage receipt is involved. Manual sign-in was completed by the owner
in the isolated desktop browser. Credentials and browser profile data are not
part of this report or the patch.

## Isolated live checks

The owned QA desktop used the frozen PR36 core with separate server, daemon,
Electron user data, unmanaged fixture, and browser connection. Browser Automation
was also restored to the shipped PR36 artifact to check compatibility without
restarting the owner's working IDE. The fixture was inside the repository, but
workspace actions used its resolved directory rather than the repository root.

- A real website response reached a native BB thread: `QA продолжение успешно`.
- A real read returned `local-qa` from `qa-input.txt`. After browser input clicked
  **Подтвердить действия**, `qa-output.txt` contained that line followed by
  `DeepSeek web verified`. The website received the actual write receipt and
  returned a Russian final answer confirming the result.
- The full file preview was inspected before approval. UI reconnect reacquired
  the same dedicated tab and retained the pinned conversation URL.
- An SDK execution was cancelled while its real approval form was open. The
  form disappeared and `qa-cancelled.txt` was absent. This is separate from
  rejecting a command, which requires its own terminal receipt.

Live failures uncovered and repaired incomplete integration behavior: multiline
DevBrowser fill could submit the first paragraph; current Send/Stop controls
have no labels; virtualized messages keep a constant visible reply count; and
released bridge processes could not resume an existing website conversation.
A panel inspection also held the mutation lock and could reject a concurrent
real request; status reads now leave that lock free and skip browser inspection
while a mutation is active. The corresponding regression failed before repair.
Atomic textarea insertion, observed icon signatures, rendered message keys,
and validated bridge identities address those cases. Conversation changes are
checked before submission and across successful exchanges. Unknown layouts,
CAPTCHA, login, a user draft, malformed JSON, and uncertain submission stop the
operation rather than silently replacing context or resending it.

## Automated checks

The most recent completed plugin graph passed 73 DeepSeek tests plus typecheck,
lint and build. The Browser Automation suite passed 110 tests with one worker;
a preceding parallel run hit the existing runtime output-limit test's 5-second
timeout, so that full suite was repeated serially. Its caller-cancellation
regression failed on the original signal handling and passed after repair.
The released-bridge regression and the legacy Browser Automation cleanup
regression also failed on the original behavior before their repairs.

Tests use the public plugin harness, provider bridge harness, browser DOM
fixtures, and real temporary filesystem/process execution. They cover action
approval and denial, cancellation, argument and workspace identity reuse,
uncertain receipts, traversal/symlink refusal, process-group termination,
bounded output, conversation isolation, multiline drafts, virtualized replies,
and complete native tool receipts. No database mock or core wire change was
added. Native tool output and model continuations have separate explicit bounds.

Execution jobs acknowledge quickly and expose separate start/status/cancel
RPC. Native tools poll for the real terminal receipt; CLI and SDK callers can
inspect or cancel the same job. Normal form expiry remains ten minutes.
Cancellation-before-start leaves a tombstone; request arguments and ownership
are immutable, and a lost job after restart is refused rather than rerun.

The repository verification inventory currently stops at the pre-existing
unmapped `diagnostics` CLI family. That baseline was not rewritten to claim
exhaustive coverage. Chromium screenshots and browser input do not constitute
an iOS Safari or Ubuntu desktop pass.

## Execution job verification

The final short-RPC graph passed all 73 plugin tests, typecheck, lint and build.
A real native command approval stayed pending for 105 seconds, beyond the old
75-second HTTP timeout. Browser input clicked **Отклонить**; the native tool
received an actual exit-code-1 denial receipt, the website returned a Russian
final answer acknowledging the refusal, and `qa-denied.txt` remained absent.

CLI `execute` returned `running` immediately, `execution-status` reported the
same job, and `execution-cancel` returned `cancelled` after clearing its real
pending approval; its file was absent. A separate native website write request
was stopped through `bb thread stop` while awaiting approval. Its interaction
was removed and `qa-native-cancel.txt` remained absent. These checks ran against
the PR36 Browser Automation artifact, exercising the compatibility cleanup path.

The setup action was opened through the actual right-panel tab picker. Browser
input reconnected the same tab and refreshed its state. Desktop and 390px
Chromium screenshots were inspected; the compact view had no horizontal
overflow. An attempted live wrong-chat check stopped at the loading-page guard,
so the specifically pinned-URL rejection is covered by the focused driver and
server regressions, not misreported as that particular live pass.

Private evidence lives in `.tmp/verify-deepseek-web-20261124` and
`.tmp/toolchain/deepseek-*.log`; it includes account-specific browser and thread
content and is deliberately excluded from Git.
