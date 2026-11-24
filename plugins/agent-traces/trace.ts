import { oneLine, record, text, type Json } from "./util.js";

export const TRACE_CHANNEL = "agent-traces.changed";

export const TRACE_EVENT_TYPES = [
  "client/turn/requested",
  "turn/started",
  "turn/input/accepted",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
  "system/interaction/lifecycle",
  "provider/error",
  "system/error",
  "system/thread/interrupted",
] as const;

export const SPAN_KINDS = [
  "command",
  "tool",
  "read",
  "edit",
  "search",
  "web",
  "subagent",
  "background",
  "thread",
  "waiting",
  "compaction",
  "startup",
  "error",
] as const;
export const STATUSES = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const;
export const ACTIVITY_KINDS = ["thinking", "writing"] as const;

export type SpanKind = (typeof SPAN_KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface Span {
  id: string;
  parentId: string | null;
  kind: SpanKind;
  name: string;
  detail: string;
  start: number;
  end: number | null;
  status: Status;
  background: boolean;
  tokens: number | null;
  exitCode: number | null;
  error: string | null;
  launchedBy: string | null;
  seq: number;
  endSeq: number | null;
  chatSeq: number | null;
}

export interface Activity {
  id: string;
  lane: string | null;
  kind: ActivityKind;
  start: number;
  end: number | null;
}

export interface Turn {
  id: string;
  index: number;
  prompt: string;
  sender: string | null;
  start: number;
  end: number | null;
  status: Status;
  spans: Span[];
  activity: Activity[];
  requestSeq: number | null;
  firstSeq: number;
  lastSeq: number;
}

export interface TraceEvent {
  seq: number;
  createdAt: number;
  type: string;
  scope: { kind: string; turnId?: string };
  data: unknown;
}

const MAX_TEXT = 160;
const MAX_ERROR = 300;
const MAX_COMMAND = 1_000;
const MIN_STARTUP_MS = 300;
const STALE_MS = 6 * 60 * 60 * 1_000;
const SKIPPED_ITEMS = new Set(["userMessage", "plan", "planSteps"]);
const ACTIVITY_ITEMS: Record<string, ActivityKind> = {
  reasoning: "thinking",
  agentMessage: "writing",
};
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

interface Request {
  prompt: string;
  sender: string | null;
  seq: number;
  at: number;
}
type TurnState = Omit<Turn, "spans" | "activity"> & {
  spanIds: string[];
  activityIds: string[];
  messages: Array<{ seq: number; at: number }>;
  lastAt: number;
};

function clipCommand(value: string): string {
  const command = value.trim();
  return command.length > MAX_COMMAND
    ? `${command.slice(0, MAX_COMMAND - 1)}…`
    : command;
}

function clip(value: string, max = MAX_TEXT): string {
  return oneLine(value, max);
}

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function itemStatus(value: unknown): Status {
  if (value === "pending") return "running";
  if (value === "failed" || value === "interrupted") return value;
  return "completed";
}

function unwrapCommand(command: unknown): string {
  const raw = Array.isArray(command)
    ? command.map(text).join(" ")
    : text(command);
  const wrapped = /^\/bin\/(?:ba|z)?sh -lc (["'])([\s\S]*)\1$/.exec(raw.trim());
  return wrapped ? wrapped[2] : raw;
}

const SETUP_COMMANDS = new Set([
  "cd",
  "export",
  "set",
  "source",
  ".",
  "mkdir",
  "true",
  ":",
]);
const SHELL_KEYWORDS = new Set([
  "for",
  "while",
  "until",
  "if",
  "case",
  "do",
  "then",
  "{",
  "(",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC =
  /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const UNTERMINATED_HEREDOC =
  /<<-?[ \t]*(['"]?)[A-Za-z_][A-Za-z0-9_]*\1([^\n]*)\n[\s\S]*$/;
const HEREDOC_WORD = "<<…";
const THREAD_MESSAGE_PREFIX = /^\s*\[bb message from thread:([^\]\s]+)\]\s*/;
const SYSTEM_MESSAGE_PREFIX = /^\s*\[bb system\]\s*/;
export const BB_SENDER = "bb";

function writesFile(words: string[]): boolean {
  if (words[0] === "tee") return true;
  if (words[0] === "cat" && words.includes(HEREDOC_WORD)) return true;
  return (
    ["cat", "echo", "printf"].includes(words[0]) &&
    words.some((word) => word.startsWith(">"))
  );
}

export function shellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    const next = command[index + 1];
    if (char === "'") {
      const close = command.indexOf(char, index + 1);
      const end = close === -1 ? command.length : close;
      word += command.slice(index + 1, end);
      inWord = true;
      index = end;
    } else if (char === '"') {
      let end = index + 1;
      for (; end < command.length && command[end] !== '"'; end++) {
        if (command[end] === "\\" && '"\\$`'.includes(command[end + 1] ?? "x"))
          end++;
        word += command[end] ?? "";
      }
      inWord = true;
      index = end;
    } else if ((char === "$" && next === "(") || char === "`") {
      let depth = 0;
      let end = index;
      for (; end < command.length; end++) {
        const current = command[end];
        if (
          char === "`"
            ? current === "`" && end > index
            : current === ")" && --depth === 0
        )
          break;
        if (char !== "`" && current === "(") depth++;
      }
      word += command.slice(index, end + 1);
      inWord = true;
      index = end;
    } else if (char === "\\") {
      if (next !== "\n") {
        word += next ?? "";
        inWord = true;
      }
      index++;
    } else if (char === "&" && (command[index - 1] === ">" || next === ">")) {
      word += char;
      inWord = true;
    } else if (char === "\n" || char === ";" || char === "&" || char === "|") {
      endCommand();
      if ((char === "&" || char === "|") && next === char) index++;
    } else if (/\s/.test(char)) {
      endWord();
    } else if (
      (char === "(" || char === ")" || char === "{" || char === "}") &&
      !inWord
    ) {
      endCommand();
    } else {
      word += char;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

export function commandWords(command: string): string[] {
  for (const words of shellCommands(
    command
      .replace(HEREDOC, `${HEREDOC_WORD}$3`)
      .replace(UNTERMINATED_HEREDOC, `${HEREDOC_WORD}$2`),
  )) {
    const meaningful = words.filter((word) => !ASSIGNMENT.test(word));
    const program = meaningful[0];
    if (
      !program ||
      program.startsWith("-") ||
      SETUP_COMMANDS.has(program) ||
      writesFile(meaningful)
    )
      continue;
    return SHELL_KEYWORDS.has(program) || program.endsWith("()")
      ? []
      : meaningful;
  }
  return [];
}

function programOf(command: string): string {
  const [program] = commandWords(command);
  return (program && basename(program)) || "shell";
}

type Description = Pick<Span, "kind" | "name" | "detail"> & {
  background?: boolean;
};

function describe(item: Json): Description {
  const title = text(record(item.presentation).title);
  switch (item.type) {
    case "commandExecution": {
      const command = unwrapCommand(item.command);
      return {
        kind: "command",
        name: programOf(command),
        detail: clipCommand(command),
      };
    }
    case "fileRead":
      return {
        kind: "read",
        name: "Read",
        detail: basename(text(item.path)) || title,
      };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes
        .map((change) => basename(text(record(change).path)))
        .filter(Boolean);
      return {
        kind: "edit",
        name: "Edit",
        detail: clip(paths.join(", ")) || title,
      };
    }
    case "search":
      return {
        kind: "search",
        name: "Search",
        detail: clip(text(item.query) || title),
      };
    case "webSearch":
      return {
        kind: "web",
        name: "Web search",
        detail: clip(text(item.query) || title),
      };
    case "webFetch":
      return {
        kind: "web",
        name: "Web fetch",
        detail: clip(text(item.url) || title),
      };
    case "contextCompaction":
      return {
        kind: "compaction",
        name: "Compaction",
        detail: "Compacting the context",
      };
    case "delegation":
      return {
        kind: "subagent",
        name: clip(text(item.label)) || "Subagent",
        detail: item.background === true ? "background subagent" : "subagent",
        background: item.background === true,
      };
    case "backgroundTask":
      return {
        kind: "background",
        name: "Background",
        detail: clip(text(item.description) || title),
        background: true,
      };
    case "toolCall": {
      const tool = text(item.tool) || "tool";
      if (SUBAGENT_TOOLS.has(tool)) {
        const args = record(item.arguments);
        const background = args.run_in_background === true;
        return {
          kind: "subagent",
          name: clip(text(args.description) || title) || "Subagent",
          detail: background ? "background subagent" : "subagent",
          background,
        };
      }
      return {
        kind: "tool",
        name: tool,
        detail: clip(title || text(item.server)),
      };
    }
    default: {
      const label = record(record(item.presentation).label);
      return {
        kind: "tool",
        name: text(label.completed) || text(item.type) || "tool",
        detail: clip(title),
      };
    }
  }
}

function describeInteraction(payload: Json): Pick<Span, "name" | "detail"> {
  const kind = text(payload.kind);
  const label = record(record(payload.presentation).label);
  if (kind === "user_question") {
    const [first] = Array.isArray(payload.questions)
      ? payload.questions.map(record)
      : [];
    return {
      name: "Question",
      detail: clip(
        text(first?.prompt) ||
          text(first?.shortLabel) ||
          "The agent asked you a question",
      ),
    };
  }
  const fallback =
    kind.includes("permission") || kind.includes("approval")
      ? "Approval"
      : "Waiting for you";
  return {
    name: clip(text(payload.title) || fallback),
    detail: clip(text(label.pending) || kind.replace(/_/g, " ")),
  };
}

function errorOf(item: Json): string | null {
  const error = item.error;
  const message =
    typeof error === "string" ? error : text(record(error).message);
  return message ? clip(message, MAX_ERROR) : null;
}

export class TraceBuilder {
  lastSeq = 0;
  private lastEventAt = 0;
  private readonly turns = new Map<string, TurnState>();
  private readonly rootTurn = new Map<string, string>();
  private readonly turnParent = new Map<string, string>();
  private readonly spans = new Map<string, Span>();
  private readonly spanTurn = new Map<string, string>();
  private readonly activities = new Map<string, Activity>();
  private readonly requests = new Map<string, Request>();
  private readonly pendingTokens = new Map<string, number>();
  private readonly runningAgents = new Set<string>();
  private readonly via = new Map<string, string>();
  private activeTurn: string | null = null;

  apply(events: readonly TraceEvent[]): void {
    for (const event of events) {
      if (event.seq <= this.lastSeq) continue;
      this.lastSeq = event.seq;
      this.lastEventAt = Math.max(this.lastEventAt, event.createdAt);
      this.fold(event);
    }
  }

  snapshot(now?: number): Turn[] {
    const stale = now !== undefined && now - this.lastEventAt > STALE_MS;
    return [...this.turns.values()].map(
      ({ spanIds, activityIds, messages, lastAt, ...turn }) => {
        const end = turn.end ?? (stale ? lastAt : null);
        const close = <T extends { start: number; end: number | null }>(
          item: T,
          background: boolean,
        ): T =>
          item.end !== null || end === null || (background && !stale)
            ? item
            : { ...item, end: Math.max(item.start, end) };
        return {
          ...turn,
          end,
          status: turn.end === null && stale ? "interrupted" : turn.status,
          spans: spanIds.flatMap((id) => {
            const stored = this.spans.get(id);
            if (!stored) return [];
            const span = close(stored, stored.background);
            const closed = span !== stored;
            const after = span.end ?? span.start;
            const reply = messages.find((message) => message.at >= after);
            return [
              {
                ...span,
                parentId: this.subagentLane(this.via.get(id) ?? ""),
                status: closed ? "interrupted" : span.status,
                error: closed
                  ? (span.error ?? "Never reported finishing")
                  : span.error,
                chatSeq: reply?.seq ?? turn.requestSeq,
              },
            ];
          }),
          activity: activityIds.flatMap((id) => {
            const activity = this.activities.get(id);
            if (!activity) return [];
            return [
              close(
                {
                  ...activity,
                  lane: this.subagentLane(this.via.get(id) ?? ""),
                },
                false,
              ),
            ];
          }),
        };
      },
    );
  }

  private fold(event: TraceEvent): void {
    const data = record(event.data);
    const turnId = event.scope.turnId;
    switch (event.type) {
      case "client/turn/requested": {
        const input = Array.isArray(data.input) ? data.input : [];
        const raw =
          input.map((part) => text(record(part).text)).find(Boolean) ?? "";
        const prefix = THREAD_MESSAGE_PREFIX.exec(raw);
        const system = prefix ? null : SYSTEM_MESSAGE_PREFIX.exec(raw);
        const requestId = text(data.requestId);
        if (requestId) {
          this.requests.set(requestId, {
            prompt: clip(raw.slice((prefix ?? system)?.[0].length ?? 0)),
            sender:
              text(data.senderThreadId) ||
              prefix?.[1] ||
              (system ? BB_SENDER : null),
            seq: event.seq,
            at: event.createdAt,
          });
        }
        return;
      }
      case "turn/started":
        if (turnId) this.startTurn(turnId, text(data.parentToolCallId), event);
        return;
      case "turn/input/accepted": {
        const turn = turnId ? this.turns.get(turnId) : undefined;
        const request = this.requests.get(text(data.clientRequestId));
        if (turn && request && turn.requestSeq === null)
          this.acceptRequest(turn, request, event);
        return;
      }
      case "turn/completed": {
        const turn = turnId ? this.turns.get(turnId) : undefined;
        if (!turn) return;
        this.touch(turn, event.seq, event.createdAt);
        turn.end = event.createdAt;
        turn.status = itemStatus(data.status);
        if (this.activeTurn === turn.id) this.activeTurn = null;
        return;
      }
      case "item/started":
      case "item/completed":
      case "item/backgroundTask/progress":
      case "item/backgroundTask/completed":
        this.foldItem(turnId, record(data.item), event);
        return;
      case "system/interaction/lifecycle":
        this.foldInteraction(turnId, record(data.interaction), event);
        return;
      case "provider/error":
        this.addMarker(turnId, event, {
          name: "Provider error",
          detail: [text(data.message), text(data.detail)]
            .filter(Boolean)
            .join(": "),
          status: "failed",
        });
        return;
      case "system/error":
        this.addMarker(turnId, event, {
          name: "bb error",
          detail: text(data.message) || text(data.code),
          status: "failed",
        });
        return;
      case "system/thread/interrupted":
        this.addMarker(turnId, event, {
          name: "Stopped",
          detail:
            text(data.reason) === "manual-stop"
              ? "Stopped by hand"
              : text(data.reason),
          status: "interrupted",
        });
        return;
    }
  }

  private touch(turn: TurnState, seq: number, at: number): void {
    if (turn.end === null) turn.lastSeq = Math.max(turn.lastSeq, seq);
    turn.lastAt = Math.max(turn.lastAt, at);
  }

  private turnFor(turnId: string | undefined): TurnState | undefined {
    const root = turnId ? this.rootTurn.get(turnId) : this.activeTurn;
    return root ? this.turns.get(root) : undefined;
  }

  private startTurn(
    turnId: string,
    parentToolCallId: string,
    event: TraceEvent,
  ): void {
    const parentTurn = parentToolCallId
      ? (this.spanTurn.get(parentToolCallId) ?? this.activeTurn ?? undefined)
      : undefined;
    if (parentTurn) {
      this.rootTurn.set(turnId, parentTurn);
      this.turnParent.set(turnId, parentToolCallId);
      return;
    }
    if (this.turns.has(turnId)) return;
    this.rootTurn.set(turnId, turnId);
    this.activeTurn = turnId;
    this.turns.set(turnId, {
      id: turnId,
      index: this.turns.size + 1,
      prompt: "",
      sender: null,
      start: event.createdAt,
      end: null,
      status: "running",
      requestSeq: null,
      firstSeq: event.seq,
      lastSeq: event.seq,
      spanIds: [],
      activityIds: [],
      messages: [],
      lastAt: event.createdAt,
    });
  }

  private acceptRequest(
    turn: TurnState,
    request: Request,
    event: TraceEvent,
  ): void {
    turn.prompt = request.prompt;
    turn.sender = request.sender;
    turn.requestSeq = request.seq;
    this.touch(turn, request.seq, request.at);
    const previous = [...this.turns.values()].find(
      (other) => other.index === turn.index - 1,
    );
    const from = Math.max(request.at, previous?.end ?? -Infinity);
    if (turn.start - from < MIN_STARTUP_MS) return;
    const id = `startup:${turn.id}`;
    this.spans.set(id, {
      ...this.blankSpan(id, request.seq),
      kind: "startup",
      name: "Starting",
      detail: "Getting the agent ready for the prompt",
      start: from,
      end: turn.start,
      status: "completed",
      endSeq: event.seq,
    });
    this.spanTurn.set(id, turn.id);
    turn.spanIds.unshift(id);
    turn.start = from;
  }

  private blankSpan(id: string, seq: number): Span {
    return {
      id,
      parentId: null,
      kind: "tool",
      name: "",
      detail: "",
      start: 0,
      end: null,
      status: "running",
      background: false,
      tokens: null,
      exitCode: null,
      error: null,
      launchedBy: null,
      seq,
      endSeq: null,
      chatSeq: null,
    };
  }

  private addSpan(turn: TurnState, span: Span): void {
    this.spans.set(span.id, span);
    this.spanTurn.set(span.id, turn.id);
    turn.spanIds.push(span.id);
  }

  private addMarker(
    turnId: string | undefined,
    event: TraceEvent,
    marker: Pick<Span, "name" | "detail" | "status">,
  ): void {
    const turn = this.turnFor(turnId);
    if (!turn) return;
    this.touch(turn, event.seq, event.createdAt);
    this.addSpan(turn, {
      ...this.blankSpan(`marker:${event.seq}`, event.seq),
      kind: "error",
      ...marker,
      detail: clip(marker.detail, MAX_ERROR),
      error: clip(marker.detail, MAX_ERROR) || null,
      start: event.createdAt,
      end: event.createdAt,
      endSeq: event.seq,
    });
  }

  private foldInteraction(
    turnId: string | undefined,
    interaction: Json,
    event: TraceEvent,
  ): void {
    const interactionId = text(interaction.id);
    if (!interactionId) return;
    const id = `interaction:${interactionId}`;
    const status = text(interaction.status);
    const waiting = status === "pending" || status === "resolving";
    const existing = this.spans.get(id);
    if (existing) {
      if (waiting || existing.end !== null) return;
      const turn = this.turns.get(this.spanTurn.get(id) ?? "");
      if (turn) this.touch(turn, event.seq, event.createdAt);
      existing.end = Math.max(event.createdAt, existing.start);
      existing.endSeq = event.seq;
      existing.status = status === "resolved" ? "completed" : "interrupted";
      existing.error =
        status === "resolved" ? null : text(interaction.statusReason) || status;
      return;
    }
    const turn = this.turnFor(turnId);
    if (status !== "pending" || !turn) return;
    this.touch(turn, event.seq, event.createdAt);
    this.addSpan(turn, {
      ...this.blankSpan(id, event.seq),
      kind: "waiting",
      ...describeInteraction(record(interaction.payload)),
      start: event.createdAt,
    });
  }

  private foldItem(
    turnId: string | undefined,
    item: Json,
    event: TraceEvent,
  ): void {
    const id = text(item.id);
    const type = text(item.type);
    if (!id || SKIPPED_ITEMS.has(type)) return;
    const parentToolCallId =
      text(item.parentToolCallId) ||
      (turnId && this.turnParent.get(turnId)) ||
      "";
    const root = turnId
      ? this.rootTurn.get(turnId)
      : (this.spanTurn.get(id) ?? this.spanTurn.get(parentToolCallId));
    const turn = root ? this.turns.get(root) : undefined;
    if (!turn) return;
    this.touch(turn, event.seq, event.createdAt);

    if (type in ACTIVITY_ITEMS) {
      this.foldActivity(
        turn,
        id,
        ACTIVITY_ITEMS[type],
        parentToolCallId,
        event,
      );
      return;
    }
    if (type === "backgroundTask" && item.taskType === "local_agent") {
      this.foldSubagentTask(parentToolCallId, item, event);
      return;
    }
    if (event.type === "item/backgroundTask/progress") return;

    const finished = event.type !== "item/started";
    const existing = this.spans.get(id);
    if (existing) {
      if (!finished) return;
      if (this.runningAgents.has(id)) existing.background = true;
      else this.finish(existing, item, event);
      return;
    }
    const { background = false, ...description } = describe(item);
    const launcher = parentToolCallId
      ? this.spans.get(parentToolCallId)
      : undefined;
    if (parentToolCallId) this.via.set(id, parentToolCallId);
    const span: Span = {
      ...this.blankSpan(id, event.seq),
      parentId: this.subagentLane(parentToolCallId),
      ...description,
      background,
      start: event.createdAt,
      tokens: this.pendingTokens.get(id) ?? null,
      launchedBy:
        background && launcher && launcher.kind !== "subagent"
          ? launcher.id
          : null,
    };
    this.pendingTokens.delete(id);
    this.addSpan(turn, span);
    if (finished) this.finish(span, item, event);
  }

  private finish(span: Span, item: Json, event: TraceEvent): void {
    span.end = Math.max(event.createdAt, span.start);
    span.endSeq = event.seq;
    span.status = itemStatus(item.status);
    if (typeof item.exitCode === "number") span.exitCode = item.exitCode;
    span.error = errorOf(item) ?? span.error;
  }

  private foldActivity(
    turn: TurnState,
    id: string,
    kind: ActivityKind,
    parentToolCallId: string,
    event: TraceEvent,
  ): void {
    const lane = this.subagentLane(parentToolCallId);
    const existing = this.activities.get(id);
    const finished = event.type === "item/completed";
    if (parentToolCallId) this.via.set(id, parentToolCallId);
    if (existing) {
      if (finished) existing.end = Math.max(event.createdAt, existing.start);
    } else {
      this.activities.set(id, {
        id,
        lane,
        kind,
        start: event.createdAt,
        end: finished ? event.createdAt : null,
      });
      turn.activityIds.push(id);
    }
    if (finished && kind === "writing" && !parentToolCallId) {
      turn.messages.push({ seq: event.seq, at: event.createdAt });
    }
  }

  private subagentLane(parentToolCallId: string): string | null {
    let cursor = parentToolCallId;
    for (let depth = 0; cursor && depth < 32; depth++) {
      if (this.spans.get(cursor)?.kind === "subagent") return cursor;
      cursor = this.via.get(cursor) ?? "";
    }
    return null;
  }

  private foldSubagentTask(
    spanId: string,
    item: Json,
    event: TraceEvent,
  ): void {
    this.recordSubagentUsage(spanId, record(item.usage));
    const span = this.spans.get(spanId);
    if (!span) return;
    const status = itemStatus(item.status);
    const finished =
      event.type === "item/backgroundTask/completed" || status !== "running";
    if (!finished) {
      if (span.endSeq !== null && !this.runningAgents.has(spanId))
        span.background = true;
      this.runningAgents.add(spanId);
      span.end = null;
      span.status = "running";
      return;
    }
    this.runningAgents.delete(spanId);
    span.end = Math.max(event.createdAt, span.end ?? span.start);
    span.endSeq = event.seq;
    span.status = status;
  }

  private recordSubagentUsage(spanId: string, usage: Json): void {
    const tokens = usage.totalTokens;
    if (!spanId || typeof tokens !== "number") return;
    const span = this.spans.get(spanId);
    if (span) span.tokens = tokens;
    else this.pendingTokens.set(spanId, tokens);
  }
}

export function formatDuration(ms: number): string {
  if (Math.round(ms) < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (Math.round(ms / 100) < 100) return `${(ms / 1_000).toFixed(1)}s`;
  if (Math.round(ms / 1_000) < 60) return `${Math.round(ms / 1_000)}s`;
  const totalSeconds = Math.round(ms / 1_000);
  if (totalSeconds < 3_600) {
    return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (Math.round(tokens / 100) < 10_000)
    return `${(tokens / 1_000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
