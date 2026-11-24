# Follow an agent's work

Agent Traces shows how long BB turns spend on tools, subagents, thinking, writing, and other phases. Open **Traces** in navigation to browse threads, or choose **Trace** from a thread's side panel. Select a turn to inspect its timeline, expand a subagent, and open a span to see its recorded output and arguments. Compare two turns to see how their timing and calls differ.

The terminal commands show a turn, list turns or commands, compare turns, and export a trace as OTLP or standalone HTML. The plugin can also send completed traces to an OTLP/HTTP collector you configure in its settings.

Agent Traces reads BB's recorded event history. Timing detail depends on what each provider reports; cost data and some provider details may not be available.
