import { and, asc, eq, inArray, isNull, or, placeholder } from "drizzle-orm";
import type {
  ClientTurnRequestId,
  ProviderSessionSource,
  QueuedTaskRunState,
  QueuedMessageWaitingOn,
} from "@bb/domain";
import { isStandaloneBuiltinClearCommand, promptInputSchema } from "@bb/domain";
import {
  prepareCachedQuery,
  type DbQueryConnection,
  type DbTransaction,
} from "../connection.js";
import { events, queuedTaskRuns, queuedThreadMessages } from "../schema.js";
import type { QueuedThreadMessageRow } from "./queued-thread-messages.js";
import { queryInSqliteVariableBatches } from "./sqlite-variable-batches.js";

export type QueuedTaskRunRow = typeof queuedTaskRuns.$inferSelect;

export class InvalidQueuedMessageDependenciesError extends Error {}

export function validateQueuedMessageDependenciesInTransaction(
  tx: DbTransaction,
  args: {
    threadId: string;
    queuedMessageId: string;
    dependencyIds: readonly string[];
  },
): void {
  if (args.dependencyIds.length === 0) return;
  if (args.dependencyIds.includes(args.queuedMessageId))
    throw new InvalidQueuedMessageDependenciesError(
      "A task cannot depend on itself",
    );
  const first = tx
    .select()
    .from(queuedThreadMessages)
    .where(
      and(
        eq(queuedThreadMessages.threadId, args.threadId),
        inArray(queuedThreadMessages.id, args.dependencyIds),
      ),
    )
    .all();
  for (const row of first) {
    if (!isQueuedAssistantTask(row))
      throw new InvalidQueuedMessageDependenciesError(
        "Only assistant tasks can be dependencies",
      );
    ensureQueuedTaskRunInTransaction(tx, row);
  }
  const receipts = listQueuedTaskRunsByIds(tx, {
    threadId: args.threadId,
    queuedMessageIds: args.dependencyIds,
  });
  if (receipts.length !== args.dependencyIds.length)
    throw new InvalidQueuedMessageDependenciesError(
      "A dependency is unavailable or belongs to another conversation",
    );
  const visited = new Set<string>();
  let frontier = [...args.dependencyIds];
  while (frontier.length > 0) {
    const rows = queryInSqliteVariableBatches({
      values: frontier,
      dedupeKey: (id) => id,
      fixedVariableCount: 1,
      variableCountPerValue: 1,
      queryBatch: (ids) =>
        tx
          .select({
            id: queuedThreadMessages.id,
            dependencies: queuedThreadMessages.dependsOnQueuedMessageIds,
          })
          .from(queuedThreadMessages)
          .where(
            and(
              eq(queuedThreadMessages.threadId, args.threadId),
              inArray(queuedThreadMessages.id, ids),
            ),
          )
          .all(),
    });
    for (const id of frontier) visited.add(id);
    frontier = [];
    for (const row of rows) {
      for (const id of row.dependencies) {
        if (id === args.queuedMessageId)
          throw new InvalidQueuedMessageDependenciesError(
            "Task dependencies cannot form a cycle",
          );
        if (!visited.has(id)) frontier.push(id);
      }
    }
  }
}

function isQueuedAssistantTask(row: QueuedThreadMessageRow): boolean {
  return (
    row.payloadKind === "inline" &&
    row.systemNotice === null &&
    !isStandaloneBuiltinClearCommand(
      promptInputSchema.array().parse(JSON.parse(row.content)),
    )
  );
}

export function firstUnmetQueuedTaskDependency(
  db: DbQueryConnection,
  args: { threadId: string; dependencyIds: readonly string[] },
): Extract<QueuedMessageWaitingOn, { kind: "dependency" }> | null {
  const runs = new Map(
    listQueuedTaskRunsByIds(db, {
      threadId: args.threadId,
      queuedMessageIds: args.dependencyIds,
    }).map((run) => [run.queuedMessageId, run]),
  );
  for (const id of args.dependencyIds) {
    const run = runs.get(id);
    if (run === undefined)
      throw new InvalidQueuedMessageDependenciesError(
        "A dependency is unavailable",
      );
    if (run.state !== "succeeded")
      return { kind: "dependency", queuedMessageId: id, status: run.state };
  }
  return null;
}

export function ensureQueuedTaskRunInTransaction(
  tx: DbTransaction,
  row: QueuedThreadMessageRow,
): void {
  if (!isQueuedAssistantTask(row)) return;
  tx.insert(queuedTaskRuns)
    .values({
      queuedMessageId: row.id,
      threadId: row.threadId,
      state: "queued",
      originalRequestId: null,
      requestId: null,
      providerId: null,
      providerSessionId: null,
      turnId: null,
      failureReason: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
    .onConflictDoNothing()
    .run();
}

const prepareGetQueuedTaskRun = (db: DbQueryConnection) =>
  db
    .select()
    .from(queuedTaskRuns)
    .where(
      and(
        eq(queuedTaskRuns.queuedMessageId, placeholder("queuedMessageId")),
        eq(queuedTaskRuns.threadId, placeholder("threadId")),
      ),
    )
    .prepare();

export function listQueuedTaskRunsByIds(
  db: DbQueryConnection,
  args: { threadId: string; queuedMessageIds: readonly string[] },
): QueuedTaskRunRow[] {
  if (args.queuedMessageIds.length === 0) return [];
  const query = prepareCachedQuery(db, prepareGetQueuedTaskRun);
  return [...new Set(args.queuedMessageIds)].flatMap((queuedMessageId) => {
    const row = query.get({ threadId: args.threadId, queuedMessageId });
    return row === undefined ? [] : [row];
  });
}

export function recordQueuedTaskRunsAdmittedInTransaction(
  tx: DbTransaction,
  args: {
    queuedMessages: readonly QueuedThreadMessageRow[];
    requestId: ClientTurnRequestId;
    source: ProviderSessionSource;
    threadId: string;
  },
): string[] {
  const ordinary = args.queuedMessages.filter(isQueuedAssistantTask);
  if (ordinary.length === 0) return [];
  for (const row of ordinary) ensureQueuedTaskRunInTransaction(tx, row);
  const changed = tx
    .update(queuedTaskRuns)
    .set({
      state: "running",
      originalRequestId: args.requestId,
      requestId: args.requestId,
      providerId: args.source.providerId,
      providerSessionId: args.source.providerSessionId,
      turnId: null,
      failureReason: null,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        eq(queuedTaskRuns.state, "queued"),
        inArray(
          queuedTaskRuns.queuedMessageId,
          ordinary.map((row) => row.id),
        ),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all();
  if (changed.length !== ordinary.length)
    throw new Error("A queued task was already admitted or cancelled");
  return changed.map((row) => row.id);
}

export function recordQueuedTaskRetryInTransaction(
  tx: DbTransaction,
  args: {
    threadId: string;
    originalRequestId: ClientTurnRequestId;
    requestId: ClientTurnRequestId;
    source: ProviderSessionSource;
  },
): string[] {
  return tx
    .update(queuedTaskRuns)
    .set({
      state: "running",
      requestId: args.requestId,
      providerId: args.source.providerId,
      providerSessionId: args.source.providerSessionId,
      turnId: null,
      failureReason: null,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        eq(queuedTaskRuns.originalRequestId, args.originalRequestId),
        inArray(queuedTaskRuns.state, ["failed", "cancelled"]),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all()
    .map((row) => row.id);
}

function matchingSource(source: ProviderSessionSource) {
  return and(
    eq(queuedTaskRuns.providerId, source.providerId),
    source.providerSessionId === null
      ? isNull(queuedTaskRuns.providerSessionId)
      : eq(queuedTaskRuns.providerSessionId, source.providerSessionId),
  );
}

export function bindQueuedTaskRunsToTurnInTransaction(
  tx: DbTransaction,
  args: {
    threadId: string;
    requestId: ClientTurnRequestId;
    turnId: string;
    source: ProviderSessionSource;
  },
): string[] {
  return tx
    .update(queuedTaskRuns)
    .set({
      turnId: args.turnId,
      providerSessionId: args.source.providerSessionId,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        eq(queuedTaskRuns.requestId, args.requestId),
        eq(queuedTaskRuns.state, "running"),
        eq(queuedTaskRuns.providerId, args.source.providerId),
        or(
          isNull(queuedTaskRuns.turnId),
          and(
            eq(queuedTaskRuns.turnId, args.turnId),
            matchingSource(args.source),
          ),
        ),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all()
    .map((row) => row.id);
}

export function settleQueuedTaskRunsForTurnInTransaction(
  tx: DbTransaction,
  args: {
    threadId: string;
    turnId: string;
    source: ProviderSessionSource;
    state: Extract<QueuedTaskRunState, "succeeded" | "failed" | "cancelled">;
    failureReason: string | null;
  },
): string[] {
  return tx
    .update(queuedTaskRuns)
    .set({
      state: args.state,
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        eq(queuedTaskRuns.turnId, args.turnId),
        eq(queuedTaskRuns.state, "running"),
        matchingSource(args.source),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all()
    .map((row) => row.id);
}

export function rejectQueuedTaskRunsInTransaction(
  tx: DbTransaction,
  args: {
    threadId: string;
    requestId: ClientTurnRequestId;
    failureReason: string;
  },
): string[] {
  return tx
    .update(queuedTaskRuns)
    .set({
      state: "failed",
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        eq(queuedTaskRuns.requestId, args.requestId),
        eq(queuedTaskRuns.state, "running"),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all()
    .map((row) => row.id);
}

export function cancelQueuedTaskRunsInTransaction(
  tx: DbTransaction,
  args: { threadId: string; queuedMessageIds: readonly string[] },
): string[] {
  if (args.queuedMessageIds.length === 0) return [];
  return tx
    .update(queuedTaskRuns)
    .set({ state: "cancelled", updatedAt: Date.now() })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        inArray(queuedTaskRuns.queuedMessageId, args.queuedMessageIds),
        eq(queuedTaskRuns.state, "queued"),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all()
    .map((row) => row.id);
}

export function interruptQueuedTaskRunsInTransaction(
  tx: DbTransaction,
  args: {
    threadId: string;
    source: ProviderSessionSource;
    failureReason: string;
  },
): string[] {
  return tx
    .update(queuedTaskRuns)
    .set({
      state: "cancelled",
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(queuedTaskRuns.threadId, args.threadId),
        eq(queuedTaskRuns.state, "running"),
        eq(queuedTaskRuns.providerId, args.source.providerId),
        or(isNull(queuedTaskRuns.turnId), matchingSource(args.source)),
      ),
    )
    .returning({ id: queuedTaskRuns.queuedMessageId })
    .all()
    .map((row) => row.id);
}

export function getStoredTurnCompletionForProviderSession(
  db: DbQueryConnection,
  args: { threadId: string; turnId: string; source: ProviderSessionSource },
): { data: string } | null {
  return (
    db
      .select({ data: events.data })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.turnId, args.turnId),
          eq(events.type, "turn/completed"),
          isNull(events.itemId),
          eq(events.providerId, args.source.providerId),
          args.source.providerSessionId === null
            ? isNull(events.providerSessionId)
            : eq(events.providerSessionId, args.source.providerSessionId),
        ),
      )
      .orderBy(asc(events.sequence))
      .limit(1)
      .get() ?? null
  );
}
