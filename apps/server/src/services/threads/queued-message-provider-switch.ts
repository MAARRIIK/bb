import { randomUUID } from "node:crypto";
import {
  getProviderTransition,
  getQueuedThreadMessage,
  getThread,
  isThreadQueueAutoSendPaused,
  setClaimedQueuedMessageProviderSwitchOperation,
  type ClaimedQueuedThreadMessageRow,
} from "@bb/db";
import type { ProviderSessionSource, Thread } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  commitProviderSwitch,
  previewProviderSwitch,
  recoverProviderSwitch,
} from "./provider-switch.js";
import {
  createQueuedMessageAutoSendPausedError,
  createQueuedMessageClaimLostError,
} from "./queue-waits.js";
import { requireCurrentProviderSession } from "../../internal/provider-session.js";

export async function switchQueuedMessageProvider(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    thread: Thread;
    source: ProviderSessionSource;
    claimed: readonly ClaimedQueuedThreadMessageRow[];
    respectManualStopPause: boolean;
  },
): Promise<Thread> {
  const lead = getQueuedThreadMessage(deps.db, args.claimed[0]!.id);
  if (lead === null || lead.providerId === null)
    throw createQueuedMessageClaimLostError();
  let operationId = lead.providerSwitchOperationId;
  const requireClaim = (nextId: string) => {
    if (
      !setClaimedQueuedMessageProviderSwitchOperation(deps.db, {
        claimed: args.claimed,
        expectedOperationId: operationId,
        operationId: nextId,
      })
    )
      throw createQueuedMessageClaimLostError();
    if (
      args.respectManualStopPause &&
      isThreadQueueAutoSendPaused(deps.db, args.thread.id)
    )
      throw createQueuedMessageAutoSendPausedError();
    operationId = nextId;
  };
  const previous =
    operationId === null ? null : getProviderTransition(deps.db, operationId);
  if (
    previous !== null &&
    previous.phase !== "completed" &&
    previous.phase !== "rolled_back"
  ) {
    requireClaim(previous.id);
    const recovered = await recoverProviderSwitch(deps, {
      threadId: args.thread.id,
      operationId: previous.id,
    });
    if (recovered.phase !== "completed")
      throw new ApiError(
        409,
        "queued_provider_switch_incomplete",
        "The queued task's provider switch did not complete. The task remains queued.",
        true,
      );
  }
  const thread = getThread(deps.db, args.thread.id);
  if (thread === null)
    throw new ApiError(404, "thread_not_found", "Thread not found");
  if (
    previous === null ||
    previous.phase === "completed" ||
    previous.phase === "rolled_back"
  )
    requireCurrentProviderSession(thread, args.source);
  if (thread.status !== "idle" && thread.status !== "error")
    throw new ApiError(
      409,
      "invalid_request",
      "The conversation became busy before its queued task could switch providers",
      true,
    );
  if (thread.providerId === lead.providerId) return thread;
  const preview = await previewProviderSwitch(deps, {
    threadId: thread.id,
    request: {
      providerId: lead.providerId,
      model: lead.model,
      permissionMode: lead.permissionMode,
      reasoningLevel: lead.reasoningLevel,
      serviceTier: lead.serviceTier,
      context: { mode: "recent-messages" },
      contextTokenBudget: 8192,
      contextWindowTokens: null,
    },
  });
  const nextId =
    previous === null && operationId !== null ? operationId : randomUUID();
  requireClaim(nextId);
  const receipt = await commitProviderSwitch(deps, {
    threadId: thread.id,
    request: { operationId: nextId, preview },
  });
  if (receipt.phase !== "completed")
    throw new ApiError(
      409,
      "queued_provider_switch_incomplete",
      "The queued task's provider switch did not complete. The task remains queued.",
      true,
    );
  const switched = getThread(deps.db, thread.id);
  if (switched === null)
    throw new ApiError(404, "thread_not_found", "Thread not found");
  requireCurrentProviderSession(switched, {
    providerId: lead.providerId,
    providerSessionId: `ps_${nextId}`,
  });
  if (switched.status !== "idle" && switched.status !== "error")
    throw new ApiError(
      409,
      "invalid_request",
      "The conversation became busy before its queued task could start",
      true,
    );
  return switched;
}
