import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  historyInputSchema,
  teamContract,
  type HistoryEntry,
} from "./contract.js";
import { historyEntries, historyPage } from "./history.js";
import { currentTeam, eventsSchema, type TeamEvent } from "./team.js";

const eventTypes = [
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/delegation/progress",
  "item/delegation/completed",
] as const;

export default function agentTeam(bb: BbPluginApi): void {
  const watched = new Set<string>();
  const readWindow = async (threadId: string) => {
    watched.add(threadId);
    if (watched.size > 64) watched.delete(watched.values().next().value ?? "");
    let beforeSeq: string | undefined;
    let root: TeamEvent | undefined;
    for (let page = 0; page < 5 && !root; page++) {
      const starts = eventsSchema.parse(
        await bb.sdk.threads.events.list({
          threadId,
          order: "desc",
          limit: "100",
          types: ["turn/started"],
          ...(beforeSeq ? { beforeSeq } : {}),
        }),
      );
      root = starts.find((event) => !event.data.parentToolCallId);
      if (root || starts.length < 100) break;
      beforeSeq = String(starts.at(-1)?.seq ?? 0);
    }
    if (!root)
      return { rows: [], root: null, truncated: beforeSeq !== undefined };
    const rows = [root];
    let afterSeq = String(root.seq);
    for (let page = 0; page < 20; page++) {
      const events = eventsSchema.parse(
        await bb.sdk.threads.events.list({
          threadId,
          afterSeq,
          order: "asc",
          limit: "100",
          types: eventTypes,
        }),
      );
      rows.push(...events);
      if (events.length < 100) return { rows, root, truncated: false };
      afterSeq = String(events.at(-1)?.seq ?? root.seq);
    }
    return { rows, root, truncated: true };
  };
  const read = async (threadId: string) => {
    const window = await readWindow(threadId);
    return currentTeam(window.rows, window.truncated);
  };
  const readHistory = async (input: {
    threadId: string;
    agentId: string;
    beforeSeq: number | null;
  }) => {
    const window = await readWindow(input.threadId);
    const root =
      window.rows.findLast(
        (event) =>
          event.type === "turn/started" && !event.data.parentToolCallId,
      ) ?? window.root;
    const turnId = root?.scope.turnId ?? null;
    if (!root || (input.beforeSeq !== null && input.beforeSeq <= root.seq))
      return historyPage({
        turnId,
        agentId: input.agentId,
        entries: [],
        scannedBeforeSeq: null,
        moreScannable: false,
        incompleteLifecycle: window.truncated,
      });
    const lifecycle = window.rows.filter((event) => event.seq >= root.seq);
    const entries: HistoryEntry[] = [];
    let beforeSeq = input.beforeSeq;
    for (let page = 0; page < 10; page++) {
      const values = await bb.sdk.threads.events.list({
        threadId: input.threadId,
        afterSeq: String(root.seq),
        ...(beforeSeq === null ? {} : { beforeSeq: String(beforeSeq) }),
        order: "desc",
        limit: "100",
        types: [
          "turn/started",
          "turn/completed",
          "item/started",
          "item/completed",
        ],
      });
      entries.push(...historyEntries(values, lifecycle, input.agentId));
      beforeSeq = values.at(-1)?.seq ?? null;
      const more = values.length === 100;
      if (!more || entries.length > 30 || page === 9)
        return historyPage({
          turnId,
          agentId: input.agentId,
          entries,
          scannedBeforeSeq: beforeSeq,
          moreScannable: more,
          incompleteLifecycle: window.truncated,
        });
    }
    throw new Error("History scan did not settle");
  };
  bb.rpc.register(
    teamContract,
    { current: ({ threadId }) => read(threadId), history: readHistory },
    {
      experimental_discoverable: true,
      experimental_description:
        "Observed native agents and bounded recorded history in the conversation's latest turn, deduplicated by agent id.",
    },
  );
  const relevantEvents = new Set<string>(eventTypes);
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: ({ id, changes, metadata }) => {
      if (!id || !watched.has(id)) return;
      if (
        changes.some((change) => change !== "events-appended") ||
        !metadata?.eventTypes ||
        metadata.eventTypes.some((type) => relevantEvents.has(type))
      )
        bb.rpc.experimental_invalidate([`team:${id}`]);
    },
  });
  bb.onDispose(unsubscribe);
  bb.cli.register(
    defineCli({
      name: "agent-team",
      summary: "Inspect observed native agents in a conversation",
      commands: {
        history: cliCommand({
          summary:
            "Read recorded child messages, tools, results, and lifecycle",
          positionals: [
            {
              name: "thread",
              description: "BB conversation id",
              required: true,
            },
            { name: "agent", description: "Native agent id", required: true },
          ],
          options: {
            json: { type: "boolean", description: "Emit JSON" },
            "before-seq": {
              type: "string",
              description: "Read entries before this event sequence",
            },
            details: {
              type: "boolean",
              description: "Include recorded tools and lifecycle details",
            },
          },
          async run(input) {
            const cursor = input.options["before-seq"];
            const parsed = historyInputSchema.parse({
              threadId: input.positionals.thread,
              agentId: input.positionals.agent,
              beforeSeq:
                cursor === undefined
                  ? null
                  : /^\d+$/.test(cursor)
                    ? Number(cursor)
                    : Number.NaN,
            });
            const result = await readHistory(parsed);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : [
                    "Initial user prompts are not provided by the native lifecycle events.",
                    ...result.entries
                      .filter((entry) => input.options.details || entry.kind === "assistant")
                      .map(
                        (entry) =>
                          `[${entry.seq}] ${new Date(entry.timestamp).toISOString()}\n${entry.kind === "assistant" ? entry.text : `${entry.summary.en}\n${entry.text}`}${entry.truncated ? "\n[truncated]" : ""}`,
                      ),
                    ...(result.nextBeforeSeq === null
                      ? []
                      : [`Continue: --before-seq ${result.nextBeforeSeq}`]),
                    ...(result.truncated
                      ? ["Bounded history may be incomplete."]
                      : []),
                  ].join("\n\n"),
            };
          },
        }),
        show: cliCommand({
          summary:
            "Show the latest turn's unique agents and observed lifecycle",
          positionals: [
            {
              name: "thread",
              description: "BB conversation id",
              required: true,
            },
          ],
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const result = await read(input.positionals.thread!);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : [
                    `Running: ${result.runningCount ?? "unknown"} (${result.knownRunningCount} confirmed, ${result.unknownCount} unknown)`,
                    ...result.members.map(
                      (member) =>
                        `${member.id} · ${member.status} · ${member.model ?? "model unknown"}\n${member.task}${member.result ? `\n${member.result}` : ""}`,
                    ),
                    ...(result.truncated
                      ? ["History limit reached; counts are incomplete."]
                      : []),
                  ].join("\n"),
            };
          },
        }),
      },
    }),
  );
}
