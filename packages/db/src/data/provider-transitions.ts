import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import type { DbQueryConnection, DbTransaction } from "../connection.js";
import { threadProviderTransitions, threads } from "../schema.js";

export type ProviderTransitionRow =
  typeof threadProviderTransitions.$inferSelect;

type ProviderTransitionCreateInput = Omit<
  ProviderTransitionRow,
  "phase" | "revision" | "updatedAt" | "targetProviderThreadId" | "errorCode"
>;

const pendingTransition = sql`${threadProviderTransitions.phase} NOT IN ('completed', 'rolled_back')`;

function sourceThreadPredicate(
  input: Pick<
    ProviderTransitionRow,
    | "threadId"
    | "environmentId"
    | "hostId"
    | "sourceProviderId"
    | "sourceProviderSessionId"
    | "sourceModelOverride"
    | "sourceReasoningLevelOverride"
  >,
) {
  return and(
    eq(threads.id, input.threadId),
    eq(threads.environmentId, input.environmentId),
    sql`EXISTS (SELECT 1 FROM environments AS transition_environment WHERE transition_environment.id = ${threads.environmentId} AND transition_environment.host_id = ${input.hostId})`,
    eq(threads.providerId, input.sourceProviderId),
    sql`${threads.providerSessionId} IS ${input.sourceProviderSessionId}`,
    sql`${threads.modelOverride} IS ${input.sourceModelOverride}`,
    sql`${threads.reasoningLevelOverride} IS ${input.sourceReasoningLevelOverride}`,
  );
}

export function getProviderTransition(
  db: DbQueryConnection,
  id: string,
): ProviderTransitionRow | null {
  return (
    db
      .select()
      .from(threadProviderTransitions)
      .where(eq(threadProviderTransitions.id, id))
      .get() ?? null
  );
}

export function getActiveProviderTransition(
  db: DbQueryConnection,
  threadId: string,
): ProviderTransitionRow | null {
  return (
    db
      .select()
      .from(threadProviderTransitions)
      .where(
        and(
          eq(threadProviderTransitions.threadId, threadId),
          pendingTransition,
        ),
      )
      .get() ?? null
  );
}

export function listPendingProviderTransitionsForHost(
  db: DbQueryConnection,
  args: { hostId: string; limit: number; excludedIds: readonly string[] },
): ProviderTransitionRow[] {
  return db
    .select()
    .from(threadProviderTransitions)
    .where(
      and(
        eq(threadProviderTransitions.hostId, args.hostId),
        pendingTransition,
        args.excludedIds.length === 0
          ? undefined
          : notInArray(threadProviderTransitions.id, [...args.excludedIds]),
      ),
    )
    .orderBy(
      asc(threadProviderTransitions.updatedAt),
      asc(threadProviderTransitions.id),
    )
    .limit(args.limit)
    .all();
}

export function beginProviderTransitionInTransaction(
  tx: DbTransaction,
  input: ProviderTransitionCreateInput,
): ProviderTransitionRow | null {
  if (
    !tx
      .select({ id: threads.id })
      .from(threads)
      .where(sourceThreadPredicate(input))
      .get()
  )
    return null;
  return (
    tx
      .insert(threadProviderTransitions)
      .values({
        ...input,
        phase: "preparing",
        revision: 1,
        updatedAt: input.createdAt,
        targetProviderThreadId: null,
        errorCode: null,
      })
      .onConflictDoNothing()
      .returning()
      .get() ?? null
  );
}

export function advanceProviderTransition(
  db: DbQueryConnection,
  args: {
    id: string;
    expectedRevision: number;
    expectedPhase: ProviderTransitionRow["phase"];
    phase: ProviderTransitionRow["phase"];
    targetProviderThreadId: string | null;
    errorCode: string | null;
    now: number;
  },
): ProviderTransitionRow | null {
  return (
    db
      .update(threadProviderTransitions)
      .set({
        phase: args.phase,
        targetProviderThreadId: args.targetProviderThreadId,
        errorCode: args.errorCode,
        updatedAt: args.now,
        revision: sql`${threadProviderTransitions.revision} + 1`,
      })
      .where(
        and(
          eq(threadProviderTransitions.id, args.id),
          eq(threadProviderTransitions.phase, args.expectedPhase),
          eq(threadProviderTransitions.revision, args.expectedRevision),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function commitProviderTransitionInTransaction(
  tx: DbTransaction,
  args: { id: string; expectedRevision: number; now: number },
): ProviderTransitionRow | null {
  const transition = tx
    .select()
    .from(threadProviderTransitions)
    .where(
      and(
        eq(threadProviderTransitions.id, args.id),
        eq(threadProviderTransitions.phase, "adopting"),
        eq(threadProviderTransitions.revision, args.expectedRevision),
      ),
    )
    .get();
  if (!transition || transition.targetProviderThreadId === null) return null;
  const changed = tx
    .update(threads)
    .set({
      providerId: transition.targetProviderId,
      providerSessionId: transition.targetProviderSessionId,
      modelOverride: transition.execution.model,
      reasoningLevelOverride: transition.execution.reasoningLevel,
      updatedAt: args.now,
    })
    .where(sourceThreadPredicate(transition))
    .returning({ id: threads.id })
    .get();
  if (!changed) return null;
  return advanceProviderTransition(tx, {
    id: args.id,
    expectedRevision: args.expectedRevision,
    expectedPhase: "adopting",
    phase: "committed",
    targetProviderThreadId: transition.targetProviderThreadId,
    errorCode: null,
    now: args.now,
  });
}

export function getCurrentProviderTransition(
  db: DbQueryConnection,
  threadId: string,
): ProviderTransitionRow | null {
  return (
    db
      .select({ transition: threadProviderTransitions })
      .from(threadProviderTransitions)
      .innerJoin(
        threads,
        and(
          eq(threads.id, threadProviderTransitions.threadId),
          eq(threads.providerId, threadProviderTransitions.targetProviderId),
          eq(
            threads.providerSessionId,
            threadProviderTransitions.targetProviderSessionId,
          ),
        ),
      )
      .where(
        and(
          eq(threads.id, threadId),
          sql`${threadProviderTransitions.phase} IN ('committed', 'finalizing', 'completed')`,
        ),
      )
      .get()?.transition ?? null
  );
}

export function rollbackCommittedProviderTransitionInTransaction(
  tx: DbTransaction,
  args: {
    id: string;
    expectedRevision: number;
    errorCode: string;
    now: number;
  },
): ProviderTransitionRow | null {
  const transition = tx
    .select()
    .from(threadProviderTransitions)
    .where(
      and(
        eq(threadProviderTransitions.id, args.id),
        eq(threadProviderTransitions.revision, args.expectedRevision),
        sql`${threadProviderTransitions.phase} IN ('committed', 'finalizing')`,
      ),
    )
    .get();
  if (!transition) return null;
  const changed = tx
    .update(threads)
    .set({
      providerId: transition.sourceProviderId,
      providerSessionId: transition.sourceProviderSessionId,
      modelOverride: transition.sourceModelOverride,
      reasoningLevelOverride: transition.sourceReasoningLevelOverride,
      updatedAt: args.now,
    })
    .where(
      sourceThreadPredicate({
        threadId: transition.threadId,
        environmentId: transition.environmentId,
        hostId: transition.hostId,
        sourceProviderId: transition.targetProviderId,
        sourceProviderSessionId: transition.targetProviderSessionId,
        sourceModelOverride: transition.execution.model,
        sourceReasoningLevelOverride: transition.execution.reasoningLevel,
      }),
    )
    .returning({ id: threads.id })
    .get();
  if (!changed) return null;
  return advanceProviderTransition(tx, {
    id: transition.id,
    expectedRevision: transition.revision,
    expectedPhase: transition.phase,
    phase: "rolled_back",
    targetProviderThreadId: transition.targetProviderThreadId,
    errorCode: args.errorCode,
    now: args.now,
  });
}
