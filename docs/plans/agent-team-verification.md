# Agent team navigation and recorded history

Verified on 2026-11-24 in the personal PR36 desktop plus the new `agent-team`
plugin. The separate **Агенты** navigation entry provides a conversation picker,
a count of observed running native subagents, deduplicated member cards, and
a prominent **Итог** block with the last recorded assistant message from the
latest successfully completed child turn, and an inline **История** view.
Running and failed turns never promote commentary to a final result. Native
events have no distinct final-message phase; this limitation is explicit. The same read operations are available through
`bb agent-team show/history` and discoverable `current`/`history` plugin RPC.

Lifecycle comes from child turns linked by parentToolCallId, not completion of
a delegation tool. Reusing childRef for a new task keeps one member. Missing
lifecycle and scan limits make the exact count unknown. Native events do not
provide model identity or the initial prompts; the UI says so explicitly.
The view covers the latest root turn of the selected conversation, including
all recorded rounds of its agents, rather than unrelated BB worker threads.

History defaults to recorded assistant messages. Tools and status events stay
in a collapsed activity section, with
30 entries per page, 16,000 characters per entry and explicit truncation.
Earlier pages preserve chronological ordering and do not mix agents or turns.
All content is rendered as text; history never executes commands. Reads use
server event type/sequence predicates and bounded pagination (API page cap 100).
No core wire, database migration or public SDK member was added.

## Checks

Turbo test/typecheck/lint/build passed; 26 tests in two files passed. The shared graph also passed 57 DeepSeek Web
tests, without treating those as live website verification. The history
isolation regression failed when the child-turn membership guard was removed
(parent content incorrectly appeared), then passed after byte-exact restoration.
Private logs: `.tmp/toolchain/deepseek-agent-team-checks-8.log`,
`agent-history-negative.log`, `agent-history-restored.log`.

Live checks in the owner's running IDE used actual native agent events and the
matching personal CLI. The module is enabled and running from this checkout.
The live source revealed and fixed two integration errors before delivery:
reasoning summary arrays were parsed as delegation strings, and event requests
exceeded the server's 100-row limit. Stored data was not rewritten.

- CLI returned three unique members despite repeated delegation rounds.
- Live result blocks matched all three actual native final replies. Human CLI
  history showed assistant text; `--details` retained tool and status records.
- Opening history left activity and raw tool details collapsed by default.
- Active count matched the live team: three working during reviews, then zero
  when all helpers completed. Parent-agent activity is not included.
- Actual browser input switched between the development conversation and a
  second conversation, with separate counts and cards.
- History opened on a real card and loaded earlier records through the button;
  SDK/CLI returned 30-entry pages and an earlier cursor. Replay of recorded
  events produced separate histories for all three native agents.
- Desktop and 390px layouts were inspected; screenshots were read. This is
  Chromium verification, not a native iOS Safari pass.
- Russian and English text are implemented. Provider model names remain unknown
  rather than inferred from the parent. No agent was started merely to inflate
  the counter; live transitions came from actual implementation and reviews.

Private evidence lives under `.tmp/personal-bb-launch/agent-team-*` and
`agent-history-*`. It includes private thread content and is not committed.
The plugin remains installed in the working IDE; it does not require restarting
Electron or the server. Install another checkout with
`bb plugin install ./plugins/agent-team --yes` after building the plugin.
