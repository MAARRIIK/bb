import { createQueuedMessageClaimLostError } from "./queue-waits.js";
import { z } from "zod";
import {
  bindQueuedTaskRunsToTurnInTransaction,
  getStoredTurnCompletionForProviderSession,
  firstUnmetQueuedTaskDependency,
  getThread,
  hasRootStoredTurnStarted,
  interruptQueuedTaskRunsInTransaction,
  isTurnAimedAtByEarlierStop,
  recordQueuedTaskRetryInTransaction,
  refreshQueuedTaskDependencyWaitsInTransaction,
  rejectQueuedTaskRunsInTransaction,
  requeueClaimedQueuedThreadMessagesInTransaction,
  settleQueuedTaskRunsForTurnInTransaction,
  type AppendStoredThreadEventArgs,
  type ClaimedQueuedThreadMessageRow,
  type DbQueryConnection,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import {
  parseStoredThreadEvent,
  turnScope,
  type ProviderSessionSource,
  type ThreadEvent,
  type ThreadQueuedMessage,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import { emitPluginMessageQueued } from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

export function holdClaimedTaskForDependencies(
  deps: { db: DbQueryConnection; hub: DbNotifier },
  args: {
    threadId: string;
    claimed: readonly ClaimedQueuedThreadMessageRow[];
    sendNow: boolean;
  },
): ThreadQueuedMessage | null {
  const row = deps.db.transaction(
    (tx) => {
      const waitingOn = firstUnmetQueuedTaskDependency(tx, {
        threadId: args.threadId,
        dependencyIds: args.claimed[0]?.dependsOnQueuedMessageIds ?? [],
      });
      if (waitingOn === null) return null;
      const now = Date.now();
      const futureTimes = args.sendNow
        ? []
        : args.claimed.flatMap((row) =>
            row.sendAt !== null && row.sendAt > now ? [row.sendAt] : [],
          );
      const queued = requeueClaimedQueuedThreadMessagesInTransaction(tx, {
        claims: args.claimed,
        threadId: args.threadId,
        waitingOn,
        sendAt: futureTimes.length === 0 ? null : Math.max(...futureTimes),
        recheckAt: null,
      });
      if (queued === null) throw createQueuedMessageClaimLostError();
      return queued;
    },
    { behavior: "immediate" },
  );
  if (row === null) return null;
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
  const entry = toThreadQueuedMessage(row);
  emitPluginMessageQueued(entry);
  return entry;
}

export function requireQueuedTaskDependenciesSucceeded(
  tx: DbTransaction,
  args: { threadId: string; claimed: readonly ClaimedQueuedThreadMessageRow[] },
): void {
  for (const row of args.claimed) {
    if (
      firstUnmetQueuedTaskDependency(tx, {
        threadId: args.threadId,
        dependencyIds: row.dependsOnQueuedMessageIds,
      }) !== null
    )
      throw new ApiError(
        409,
        "queued_message_dependencies_pending",
        "The task is waiting for its dependencies to succeed",
      );
  }
}

function settleCompletion(
  tx: DbTransaction,
  event: Extract<ThreadEvent, { type: "turn/completed" }>,
  source: ProviderSessionSource,
): string[] {
  if (
    event.scope.kind !== "turn" ||
    !hasRootStoredTurnStarted(tx, {
      threadId: event.threadId,
      turnId: event.scope.turnId,
    })
  )
    return [];
  if (
    event.status !== "interrupted" &&
    isTurnAimedAtByEarlierStop(tx, {
      threadId: event.threadId,
      turnId: event.scope.turnId,
    })
  )
    return [];
  return settleQueuedTaskRunsForTurnInTransaction(tx, {
    threadId: event.threadId,
    turnId: event.scope.turnId,
    source,
    state:
      event.status === "completed"
        ? "succeeded"
        : event.status === "failed"
          ? "failed"
          : "cancelled",
    failureReason:
      event.status === "completed"
        ? null
        : (event.error?.message ?? event.status),
  });
}

export function applyQueuedTaskProviderEventInTransaction(
  tx: DbTransaction,
  args: { event: ThreadEvent; source: ProviderSessionSource },
): boolean {
  const { event, source } = args;
  let changed: string[] = [];
  if (event.type === "turn/input/accepted" && event.scope.kind === "turn") {
    const thread = getThread(tx, event.threadId);
    if (
      thread?.providerId !== source.providerId ||
      thread.providerSessionId !== source.providerSessionId ||
      !hasRootStoredTurnStarted(tx, {
        threadId: event.threadId,
        turnId: event.scope.turnId,
      })
    )
      return false;
    changed = bindQueuedTaskRunsToTurnInTransaction(tx, {
      threadId: event.threadId,
      requestId: event.clientRequestId,
      turnId: event.scope.turnId,
      source,
    });
    if (changed.length > 0) {
      const completed = getStoredTurnCompletionForProviderSession(tx, {
        threadId: event.threadId,
        turnId: event.scope.turnId,
        source,
      });
      if (completed !== null) {
        const completion = parseStoredThreadEvent({
          threadId: event.threadId,
          type: "turn/completed",
          scope: turnScope(event.scope.turnId),
          data: z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(completed.data)),
        });
        if (completion.type === "turn/completed")
          settleCompletion(tx, completion, source);
      }
    }
  } else if (event.type === "turn/completed")
    changed = settleCompletion(tx, event, source);
  if (changed.length === 0) return false;
  refreshQueuedTaskDependencyWaitsInTransaction(tx, event.threadId);
  return true;
}

export function applyQueuedTaskServerEventInTransaction(
  tx: DbTransaction,
  event: AppendStoredThreadEventArgs,
): void {
  const thread = getThread(tx, event.threadId);
  if (thread === null) return;
  const source = {
    providerId: thread.providerId,
    providerSessionId: thread.providerSessionId,
  };
  let changed: string[] = [];
  if (
    event.type === "client/turn/requested" &&
    event.data.retryOfRequestId !== undefined
  ) {
    changed = recordQueuedTaskRetryInTransaction(tx, {
      threadId: event.threadId,
      originalRequestId: event.data.retryOfRequestId,
      requestId: event.data.requestId,
      source,
    });
  } else if (event.type === "client/turn/rejected") {
    changed = rejectQueuedTaskRunsInTransaction(tx, {
      threadId: event.threadId,
      requestId: event.data.requestId,
      failureReason: event.data.message,
    });
  } else if (event.type === "system/thread/interrupted") {
    changed = interruptQueuedTaskRunsInTransaction(tx, {
      threadId: event.threadId,
      source,
      failureReason: event.data.reason,
    });
  } else if (event.type === "turn/completed") {
    changed = settleCompletion(
      tx,
      {
        ...event.data,
        type: event.type,
        threadId: event.threadId,
        scope: event.scope,
      },
      source,
    );
  }
  if (changed.length > 0)
    refreshQueuedTaskDependencyWaitsInTransaction(tx, event.threadId);
}
