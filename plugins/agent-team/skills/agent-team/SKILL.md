---
name: agent-team
description: Inspect the unique native subagents and observed lifecycle in a BB conversation.
---

Open **Агенты** in navigation, select a conversation, and read its latest turn's
team. CLI and plugin RPC use the same event reader:

```sh
bb agent-team show <thread-id> --json
bb agent-team history <thread-id> <agent-id> --json
bb agent-team history <thread-id> <agent-id> --before-seq <sequence> --json
bb agent-team history <thread-id> <agent-id> --details
```

The count uses native child turn lifecycle events, deduplicated by child agent
id. Delegation tool completion alone never proves an agent has finished. Missing
lifecycle or bounded history makes the exact running count unknown. Native
delegation events do not report the model, so the panel says it is unknown.
Tasks and results come from recorded delegation labels, summaries, and child
assistant messages. This panel reads state; it does not start or control agents.

Expand History on a card for recorded assistant messages, tools, outputs, and
lifecycle across that agent's rounds in the latest root turn. Native initial
user prompts are unavailable; do not invent them from task labels. History is
paged with the exclusive `nextBeforeSeq` cursor, at most 30 entries per page and
16,000 characters per entry. Truncation is explicit. Tool arguments and results
may contain private workspace data; inspect only the requested agent and keep
it local unless the user asks to share it. A changed root turn starts a new
history view rather than mixing messages from different turns.

The card's final result is the last recorded assistant message from the latest
successfully completed child turn. A running commentary or a failed turn is not
a final result. At most 16,000 characters are shown, with `resultTruncated`
explicit when shortened. Native events provide no final-message phase or
private reasoning, and the plugin makes no additional model calls.

UI history and human CLI history default to assistant text. Expand Activity and
technical details, or pass CLI `--details`, for tool calls, raw output, and
lifecycle events. `--json` continues to include the full bounded history page.
