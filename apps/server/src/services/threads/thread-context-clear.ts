import { createEventId, getThread, type DbTransaction } from "@bb/db";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  THREAD_CONTEXT_CLEARED_DETAIL,
  threadScope,
  type Environment,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { withThreadContextChangeGuard } from "./thread-session-guard.js";
import { appendThreadEvent } from "./thread-events.js";
import { stopThreadForCurrentState } from "./thread-lifecycle.js";
import { buildThreadStatusChangeMetadata } from "./thread-runtime-display.js";
import { requestQueuedMessageDispatch } from "./queued-message-dispatch.js";

function requireClearableThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
) {
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    throw new ApiError(404, "invalid_request", "Thread not found");
  }
  if (thread.archivedAt !== null || thread.deletedAt !== null) {
    throw new ApiError(409, "invalid_request", "Thread is not writable");
  }
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "invalid_request",
      "Context can only be cleared when the thread is idle or failed",
    );
  }
  if (
    deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(thread.id)
  ) {
    throw new ApiError(
      409,
      "awaiting_user_interaction",
      "Resolve the pending interaction before clearing context",
    );
  }

  return thread;
}

export async function clearThreadContext(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    beforeCommitInTransaction?: (args: { tx: DbTransaction }) => void;
    environment: Pick<Environment, "hostId" | "id">;
    thread: Thread;
  },
): Promise<void> {
  await withThreadContextChangeGuard(args.thread.id, async (commit) => {
    const thread = requireClearableThread(deps, args.thread.id);

    await stopThreadForCurrentState(deps, thread, args.environment);
    await commit(async () => {
      const releasedThread = requireClearableThread(deps, thread.id);

      appendThreadEvent(
        deps,
        {
          threadId: releasedThread.id,
          environmentId: releasedThread.environmentId,
          type: "system/operation",
          scope: threadScope(),
          data: {
            operation: THREAD_CONTEXT_CLEAR_OPERATION,
            operationId: createEventId(),
            status: "completed",
            message: THREAD_CONTEXT_CLEARED_DETAIL,
          },
        },
        args.beforeCommitInTransaction,
      );
      deps.hub.notifyThread(
        releasedThread.id,
        ["history-rewritten", "status-changed"],
        buildThreadStatusChangeMetadata(deps, releasedThread),
      );
    });
  });
  requestQueuedMessageDispatch(deps, {
    kind: "thread-ready",
    threadId: args.thread.id,
  });
}
