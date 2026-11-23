import { isDeepStrictEqual } from "node:util";
import {
  findStoredEventRow,
  getCurrentProviderTransition,
  getLastStoredTurnRequestEvent,
  getLatestCompletedThreadContextClearSequence,
  getThread,
} from "@bb/db";
import type { DbQueryConnection } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import { ApiError } from "../../errors.js";
import { parseStoredTurnRequestEvent } from "./thread-events.js";

export interface DeferredFirstTurnContext {
  input: PromptInput[];
  origin:
    | { kind: "request"; sequence: number }
    | { kind: "provider-transition"; id: string };
}

export interface PromptWithGroups {
  input: PromptInput[];
  inputGroups?: PromptInput[][];
}

export interface GroupedPrompt {
  input: PromptInput[];
  inputGroups: PromptInput[][];
}

export function getLeadingAgentOnlyInput(input: PromptInput[]): PromptInput[] {
  const visibleInputIndex = input.findIndex(
    (item) => item.visibility !== "agent-only",
  );
  return input.slice(
    0,
    visibleInputIndex === -1 ? input.length : visibleInputIndex,
  );
}

export function resolveDeferredFirstTurnContext(
  db: DbQueryConnection,
  threadId: string,
): DeferredFirstTurnContext | null {
  const row = getLastStoredTurnRequestEvent(db, threadId, "current-session");
  const clearedAt =
    getLatestCompletedThreadContextClearSequence(db, { threadId }) ?? 0;
  if (row === null) {
    const transition = getCurrentProviderTransition(db, threadId);
    if (
      transition?.phase !== "completed" ||
      clearedAt > transition.contextThroughSequence
    )
      return null;
    return {
      origin: { kind: "provider-transition", id: transition.id },
      input: [
        {
          type: "text",
          text: transition.contextText,
          mentions: [],
          visibility: "agent-only",
        },
      ],
    };
  }
  if (row.sequence <= clearedAt) return null;
  if (!row || row.type !== "client/turn/requested") {
    return null;
  }
  const request = parseStoredTurnRequestEvent(row);
  const isSeedRequest =
    request.source === "spawn" &&
    request.request.method === "thread/start" &&
    request.initiator === "agent" &&
    request.senderThreadId !== null &&
    request.target.kind === "thread-start";
  const isUndeliveredRetry =
    request.source === "tell" &&
    request.request.method === "turn/start" &&
    request.target.kind === "new-turn" &&
    getThread(db, threadId)?.status === "error";
  const leadingInput = getLeadingAgentOnlyInput(request.input);
  const context = leadingInput.length > 0 ? [...leadingInput] : null;
  if (
    context === null ||
    (!isSeedRequest && !isUndeliveredRetry) ||
    findStoredEventRow(db, {
      afterSequence: row.sequence,
      threadId,
      type: "turn/started",
    }) !== null
  ) {
    return null;
  }
  return {
    input: context,
    origin: { kind: "request", sequence: row.sequence },
  };
}

export function prependDeferredFirstTurnContext(
  prompt: GroupedPrompt,
  context: DeferredFirstTurnContext | null,
): GroupedPrompt;
export function prependDeferredFirstTurnContext(
  prompt: PromptWithGroups,
  context: DeferredFirstTurnContext | null,
): PromptWithGroups;
export function prependDeferredFirstTurnContext(
  prompt: PromptWithGroups,
  context: DeferredFirstTurnContext | null,
): PromptWithGroups {
  if (!context) {
    return prompt;
  }
  return {
    input: [...context.input, ...prompt.input],
    ...(prompt.inputGroups !== undefined
      ? {
          inputGroups: [
            [...context.input, ...prompt.inputGroups[0]!],
            ...prompt.inputGroups.slice(1),
          ],
        }
      : {}),
  };
}

export function requireDeferredFirstTurnContextCurrent(
  db: DbQueryConnection,
  args: { origin: DeferredFirstTurnContext["origin"]; threadId: string },
): void {
  const current = resolveDeferredFirstTurnContext(db, args.threadId);
  if (current && isDeepStrictEqual(current.origin, args.origin)) {
    return;
  }
  throw new ApiError(
    409,
    "invalid_request",
    "Thread already accepted its first real turn",
  );
}
