import { isDeepStrictEqual } from "node:util";
import { defineItemSweep } from "../system/item-sweep.js";
import {
  advanceProviderTransition,
  beginProviderTransitionInTransaction,
  commitProviderTransitionInTransaction,
  getEnvironment,
  getLastStoredProviderThreadId,
  getLatestThreadSequence,
  getProviderTransition,
  getThread,
  listOpenBackgroundTaskItemRowsForThread,
  listPendingProviderTransitionsForHost,
  readThreadRunState,
  rollbackCommittedProviderTransitionInTransaction,
  type ProviderTransitionRow,
} from "@bb/db";
import { resolvedThreadExecutionOptionsSchema, threadScope } from "@bb/domain";
import type {
  HostDaemonCommand,
  HostDaemonCommandResult,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireCurrentProviderSession } from "../../internal/provider-session.js";
import { runLiveHostCommand } from "../hosts/live-command.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { buildThreadStartCommand } from "./thread-commands.js";
import {
  appendThreadEvent,
  createClientTurnRequestId,
} from "./thread-events.js";
import {
  ThreadContextChangeInProgressError,
  withThreadContextChangeGuard,
} from "./thread-session-guard.js";
import { requireProviderTransitionSettled } from "./provider-transition-guard.js";
import { requestQueuedMessageDispatch } from "./queued-message-dispatch.js";

const TRANSITION_COMMAND_TIMEOUT_MS = 60_000;
type TransitionInput = Parameters<
  typeof beginProviderTransitionInTransaction
>[1];
type TransitionDeps = LoggedPendingInteractionWorkSessionDeps;
type CommitTransition = Parameters<
  Parameters<typeof withThreadContextChangeGuard>[1]
>[0];

function conflict(message: string): never {
  throw new ApiError(409, "invalid_request", message, true);
}

function source(
  row: Pick<
    ProviderTransitionRow,
    "sourceProviderId" | "sourceProviderSessionId"
  >,
) {
  return {
    providerId: row.sourceProviderId,
    providerSessionId: row.sourceProviderSessionId,
  };
}

function target(row: ProviderTransitionRow) {
  if (row.targetProviderThreadId === null)
    conflict("The provider transition has no prepared native session");
  return {
    providerId: row.targetProviderId,
    providerSessionId: row.targetProviderSessionId,
    providerThreadId: row.targetProviderThreadId,
  };
}

function requireTransition(
  deps: TransitionDeps,
  id: string,
): ProviderTransitionRow {
  const row = getProviderTransition(deps.db, id);
  if (!row)
    throw new ApiError(404, "invalid_request", "Provider transition not found");
  return {
    ...row,
    execution: resolvedThreadExecutionOptionsSchema.parse(row.execution),
  };
}

function notify(deps: TransitionDeps, row: ProviderTransitionRow): void {
  deps.hub.notifyThread(row.threadId, ["status-changed"]);
}

function advance(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
  phase: ProviderTransitionRow["phase"],
  nativeId: string | null = row.targetProviderThreadId,
  errorCode: string | null = row.errorCode,
): ProviderTransitionRow {
  const next = advanceProviderTransition(deps.db, {
    id: row.id,
    expectedRevision: row.revision,
    expectedPhase: row.phase,
    phase,
    targetProviderThreadId: nativeId,
    errorCode,
    now: Date.now(),
  });
  if (!next)
    conflict("Provider transition changed while a command was running");
  notify(deps, next);
  return next;
}

function requireOriginalThread(deps: TransitionDeps, row: TransitionInput) {
  const thread = getThread(deps.db, row.threadId);
  if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
  requireCurrentProviderSession(thread, source(row));
  if (
    thread.environmentId !== row.environmentId ||
    thread.modelOverride !== row.sourceModelOverride ||
    thread.reasoningLevelOverride !== row.sourceReasoningLevelOverride ||
    getLastStoredProviderThreadId(deps.db, thread.id) !==
      row.sourceProviderThreadId
  )
    conflict(
      "The thread settings changed while its provider was being prepared",
    );
  if (
    thread.deletedAt !== null ||
    thread.archivedAt !== null ||
    (thread.status !== "idle" && thread.status !== "error")
  )
    conflict("Provider changes require an idle writable thread");
  const run = readThreadRunState(deps.db, thread.id);
  if (
    run.requests.length > 0 ||
    run.stop !== null ||
    deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(thread.id) ||
    listOpenBackgroundTaskItemRowsForThread(deps.db, { threadId: thread.id })
      .length > 0
  )
    conflict("The previous provider still has unfinished work");
  if (
    getLatestThreadSequence(deps.db, { threadId: thread.id }) !==
    row.contextThroughSequence
  )
    conflict("The conversation changed after its context was prepared");
  const environment = getEnvironment(deps.db, row.environmentId);
  if (
    !environment ||
    environment.hostId !== row.hostId ||
    environment.status !== "ready" ||
    environment.path === null
  )
    conflict("The provider transition workspace is no longer ready");
  return { thread, environment };
}

function control(row: ProviderTransitionRow) {
  return {
    environmentId: row.environmentId,
    threadId: row.threadId,
    leaseId: row.id,
    target: target(row),
  };
}

type SessionControlType =
  | "thread.session.prepare"
  | "thread.session.adopt"
  | "thread.session.finalize"
  | "thread.session.rollback"
  | "thread.session.discard";

async function host<TType extends SessionControlType>(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
  command: Extract<HostDaemonCommand, { type: TType }>,
): Promise<HostDaemonCommandResult<TType>> {
  return runLiveHostCommand<TType>(deps, {
    command,
    hostId: row.hostId,
    timeoutMs: TRANSITION_COMMAND_TIMEOUT_MS,
  });
}

function finish(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
  phase: "completed" | "rolled_back",
  errorCode: string | null,
): ProviderTransitionRow {
  const thread = getThread(deps.db, row.threadId);
  if (!thread)
    conflict("The thread was removed before its transition finished");
  appendThreadEvent(
    deps,
    {
      threadId: row.threadId,
      environmentId: thread.environmentId,
      type: "system/operation",
      scope: threadScope(),
      data: {
        operation: "provider_switch",
        operationId: row.id,
        status: phase === "completed" ? "completed" : "failed",
        message:
          phase === "completed"
            ? `Switched to ${row.execution.model}.`
            : "Provider switch did not complete; the previous provider was retained.",
        metadata: {
          fromProviderId: row.sourceProviderId,
          toProviderId: row.targetProviderId,
          model: row.execution.model,
          errorCode,
        },
      },
    },
    ({ tx }) => {
      const next = advanceProviderTransition(tx, {
        id: row.id,
        expectedRevision: row.revision,
        expectedPhase: row.phase,
        phase,
        targetProviderThreadId: row.targetProviderThreadId,
        errorCode,
        now: Date.now(),
      });
      if (!next)
        conflict("Provider transition changed before its result was recorded");
    },
  );
  const next = requireTransition(deps, row.id);
  notify(deps, next);
  requestQueuedMessageDispatch(deps, {
    kind: "thread-ready",
    threadId: row.threadId,
  });
  return next;
}

async function finalize(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
): Promise<ProviderTransitionRow> {
  const thread = getThread(deps.db, row.threadId);
  if (!thread) conflict("The provider transition thread was removed");
  requireCurrentProviderSession(thread, target(row));
  if (row.phase === "committed") row = advance(deps, row, "finalizing");
  if (row.phase !== "finalizing")
    conflict("Provider transition is not ready to finish");
  await host(deps, row, { type: "thread.session.finalize", ...control(row) });
  return finish(deps, row, "completed", null);
}

async function rollback(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
  errorCode: string,
): Promise<ProviderTransitionRow> {
  const committed = row.phase === "committed" || row.phase === "finalizing";
  if (!committed && row.phase !== "rolling_back")
    row = advance(
      deps,
      row,
      "rolling_back",
      row.targetProviderThreadId,
      errorCode,
    );
  if (row.targetProviderThreadId === null) {
    await host(deps, row, {
      type: "thread.session.discard",
      environmentId: row.environmentId,
      threadId: row.threadId,
      leaseId: row.id,
    });
  } else {
    const restored = await host<"thread.session.rollback">(deps, row, {
      type: "thread.session.rollback",
      ...control(row),
      restoreSource: source(row),
    });
    if (
      restored.session !== null &&
      (restored.session.providerId !== row.sourceProviderId ||
        restored.session.providerSessionId !== row.sourceProviderSessionId)
    )
      conflict("The executor did not restore the expected provider generation");
  }
  if (!committed) return finish(deps, row, "rolled_back", errorCode);
  const thread = getThread(deps.db, row.threadId);
  if (!thread)
    conflict("The thread was removed while its provider was being restored");
  appendThreadEvent(
    deps,
    {
      threadId: row.threadId,
      environmentId: thread.environmentId,
      type: "system/operation",
      scope: threadScope(),
      data: {
        operation: "provider_switch",
        operationId: row.id,
        status: "failed",
        message:
          "Provider switch was interrupted; the previous provider was restored.",
        metadata: {
          fromProviderId: row.sourceProviderId,
          toProviderId: row.targetProviderId,
          errorCode,
        },
      },
    },
    ({ tx }) => {
      const restored = rollbackCommittedProviderTransitionInTransaction(tx, {
        id: row.id,
        expectedRevision: row.revision,
        errorCode,
        now: Date.now(),
      });
      if (!restored)
        conflict("The thread changed before its provider could be restored");
    },
  );
  const restored = requireTransition(deps, row.id);
  notify(deps, restored);
  requestQueuedMessageDispatch(deps, {
    kind: "thread-ready",
    threadId: row.threadId,
  });
  return restored;
}

async function prepareAndCommit(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
  commit: CommitTransition,
): Promise<ProviderTransitionRow> {
  const { thread, environment } = requireOriginalThread(deps, row);
  await ensureHostSessionReadyForWork(deps, { hostId: row.hostId });
  const start = await buildThreadStartCommand(deps, {
    thread: { ...thread, providerId: row.targetProviderId },
    providerId: row.targetProviderId,
    execution: row.execution,
    environment,
    input: [],
    fork: null,
    requestId: createClientTurnRequestId(),
    projectId: thread.projectId,
    permissionEscalation: "deny",
    syncGeneratedTitle: false,
  });
  const {
    type: _type,
    requestId: _requestId,
    input: _input,
    inputGroups: _groups,
    fork: _fork,
    threadStoragePath: _storage,
    ...context
  } = start;
  const { sessionOptions: _sourceSessionOptions, ...options } = start.options;
  const prepared = await host<"thread.session.prepare">(deps, row, {
    type: "thread.session.prepare",
    ...context,
    options,
    providerSessionId: row.targetProviderSessionId,
    leaseId: row.id,
    expectedSource: source(row),
  });
  if (
    prepared.providerId !== row.targetProviderId ||
    prepared.providerSessionId !== row.targetProviderSessionId
  )
    conflict(
      "The prepared session did not match the requested provider generation",
    );
  row = advance(deps, row, "prepared", prepared.providerThreadId, null);
  row = advance(deps, row, "adopting");
  await commit(async () => {
    requireOriginalThread(deps, row);
    const adopted = await host<"thread.session.adopt">(deps, row, {
      type: "thread.session.adopt",
      ...control(row),
    });
    if (!isDeepStrictEqual(adopted, target(row)))
      conflict(
        "The adopted session did not match the prepared provider generation",
      );
    requireOriginalThread(deps, row);
    appendThreadEvent(
      deps,
      {
        threadId: row.threadId,
        environmentId: row.environmentId,
        providerThreadId: target(row).providerThreadId,
        type: "thread/identity",
        scope: threadScope(),
        data: { providerThreadId: target(row).providerThreadId },
      },
      ({ tx }) => {
        if (
          !commitProviderTransitionInTransaction(tx, {
            id: row.id,
            expectedRevision: row.revision,
            now: Date.now(),
          })
        )
          conflict("The thread changed before its provider could be committed");
      },
    );
  });
  row = requireTransition(deps, row.id);
  notify(deps, row);
  return finalize(deps, row);
}

async function recover(
  deps: TransitionDeps,
  row: ProviderTransitionRow,
): Promise<ProviderTransitionRow> {
  if (row.phase === "completed" || row.phase === "rolled_back") return row;
  if (row.phase === "committed" || row.phase === "finalizing") {
    try {
      return await finalize(deps, row);
    } catch {
      row = requireTransition(deps, row.id);
    }
  }
  return rollback(
    deps,
    row,
    row.errorCode ?? "provider_transition_interrupted",
  );
}

export async function startProviderTransition(
  deps: TransitionDeps,
  input: TransitionInput,
): Promise<ProviderTransitionRow> {
  const existing = getProviderTransition(deps.db, input.id);
  if (existing) {
    const {
      phase: _phase,
      revision: _revision,
      updatedAt: _updatedAt,
      targetProviderThreadId: _nativeId,
      errorCode: _errorCode,
      createdAt: _originalCreatedAt,
      ...originalInput
    } = existing;
    const { createdAt: _createdAt, ...requestedInput } = input;
    if (!isDeepStrictEqual(originalInput, requestedInput))
      conflict(
        "The provider transition ID was already used for different input",
      );
    return existing;
  }
  return withThreadContextChangeGuard(input.threadId, async (commit) => {
    requireProviderTransitionSettled(deps.db, input.threadId);
    requireOriginalThread(deps, input);
    const row = deps.db.transaction(
      (tx) => beginProviderTransitionInTransaction(tx, input),
      { behavior: "immediate" },
    );
    if (!row)
      conflict("The thread changed or already has a provider transition");
    notify(deps, row);
    try {
      return await prepareAndCommit(deps, row, commit);
    } catch (error) {
      deps.logger.warn(
        {
          transitionId: row.id,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "Provider transition needs recovery",
      );
      return recover(deps, requireTransition(deps, row.id));
    }
  });
}

export async function reconcileProviderTransition(
  deps: TransitionDeps,
  id: string,
): Promise<ProviderTransitionRow> {
  const row = requireTransition(deps, id);
  return withThreadContextChangeGuard(row.threadId, async () =>
    recover(deps, requireTransition(deps, id)),
  );
}

export function providerTransitionRecoverySweep(deps: TransitionDeps) {
  return defineItemSweep({
    name: "provider-transitions",
    concurrency: 4,
    list: ({ excludedKeys }) => {
      const rows: ProviderTransitionRow[] = [];
      const excludedIds = [...excludedKeys];
      for (const hostId of deps.hub.listConnectedHostIds()) {
        if (rows.length >= 32) break;
        rows.push(
          ...listPendingProviderTransitionsForHost(deps.db, {
            hostId,
            limit: Math.min(16, 32 - rows.length),
            excludedIds,
          }),
        );
      }
      return rows;
    },
    key: (row) => row.id,
    async process(row) {
      try {
        await reconcileProviderTransition(deps, row.id);
      } catch (error) {
        if (error instanceof ThreadContextChangeInProgressError) return;
        throw new ApiError(
          503,
          "provider_transition_pending",
          "Provider transition recovery is waiting for the executor",
          true,
        );
      }
    },
  });
}
