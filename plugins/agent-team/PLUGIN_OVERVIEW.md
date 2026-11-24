# See native subagents and their results

Agent Team adds **Agents** to BB navigation. Select a conversation to inspect native subagents recorded in its latest turn, including their tasks, lifecycle, and results. Expand **History** to read recorded assistant messages across follow-up rounds; **Activity and technical details** reveals tool summaries and recorded tool output. The view refreshes from BB events and does not start agent work.

Use `bb agent-team show <thread-id>` or `bb agent-team history <thread-id> <agent-id>` to read the same information from a terminal. The plugin reports when event history is missing or truncated. It shows only events BB recorded for native delegation, not independent threads or workflow workers without those events.
