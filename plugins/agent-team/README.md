# Agent Team

Adds **Агенты** to BB navigation. Select a conversation to see unique native
subagents in its latest turn, their tasks, observed lifecycle, and results.
The panel refreshes from recorded BB events over the existing SDK realtime
connection. It does not depend on Agent Traces.

`bb agent-team show <thread-id> --json` and the discoverable `current` plugin RPC
use the same reader as the UI. Reads scan at most 500 turn-start events and
2,000 subsequent relevant events; at most 100 agents are returned. Truncation
and missing lifecycle are explicit, and the exact count becomes unknown.

Native agents are deduplicated by `childRef`, not delegation calls. Status comes
from nested child turns; a completed wait/send-input tool is not agent completion.
The model is unknown because native delegation events do not provide it. Labels
and recorded summaries are bounded, rendered as plain text, and never executed.

This initial panel covers recorded native delegation events in the latest turn.
It does not discover independent BB threads or workflow workers lacking those
events, infer missing models, or control worker execution.

Expand **History / История** on an agent card to read its recorded assistant
messages, tool calls and results, and lifecycle across follow-up rounds in that
root turn. Initial user prompts are not supplied by these native events, so the
panel explicitly reports their absence. Reasoning content is not shown.
Recorded tools can contain workspace files or command output; history stays in
the local BB interface and is not sent to an external service.

```sh
bb agent-team history <thread-id> <agent-id> --json
bb agent-team history <thread-id> <agent-id> --before-seq <sequence> --json
```

History uses the same discoverable `history` RPC as the UI. Each page returns at
most 30 entries in chronological order, each bounded to 16,000 characters with
an explicit truncation flag. `nextBeforeSeq` is the exclusive cursor for older
entries. Reads filter event types and the latest root's sequence interval at
the SDK boundary; the public event API has no child-turn scope filter, so the
bounded result is matched against recorded `parentToolCallId` links locally.
The lifecycle index scans at most 2,000 events and a history page scans at most
1,000 events, using the API's 100-row page maximum. Missing lifecycle or scan
limits are explicit. The UI retains at most 600 loaded entries and resets
history when the conversation, agent, or root turn changes.

The optional activity view shows short tool summaries, with exact commands
and outputs under **Technical details / Технические подробности**. A completed
tool replaces its started row when both are available. The required
`summary: { ru, en }`, `itemId`, and `phase` fields
are generated from recorded tool metadata and conservative command patterns;
no additional model request is made. A failed command is described as an
attempt or failure, and Python or unknown scripts are not assumed to change
files. Summaries do not claim that checks passed or files changed solely from
a command name. JSON retains exact bounded `text` and truncation metadata.

The primary card now shows **Итог / Final result**: the last recorded assistant
message from the agent's latest successfully completed child turn. Native events
do not identify a special final-message phase, so no such phase is invented.
Commentary from a running or failed turn is not presented as a final answer.
The result retains up to 16,000 characters with an explicit `resultTruncated`
flag. Missing, running, and failed outcomes have distinct placeholders.

History defaults to recorded assistant messages across rounds. Commands, tool
outputs, and lifecycle events are behind **Activity and technical details**.
This does not expose private model reasoning or generate a new summary. Human
CLI history likewise defaults to assistant text; pass `--details` for tools and
lifecycle, or `--json` for the full bounded page.

Install from a source checkout with `bb plugin install ./plugins/agent-team --yes`.
Build and verify through Turbo before installing. The plugin stays enabled
across IDE launches; no agent execution is started by opening its page.
