import { and, eq } from "drizzle-orm";
import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import { events, queuedTaskRuns } from "../../src/schema.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  claimQueuedThreadMessageGroup,
  createQueuedThreadMessage,
  refreshQueuedTaskDependencyWaitsInTransaction,
  requeueClaimedQueuedThreadMessagesInTransaction,
  setQueuedThreadMessageWaitingOn,
  type ClaimedQueuedThreadMessageRow,
} from "../../src/data/queued-thread-messages.js";
import {
  bindQueuedTaskRunsToTurnInTransaction,
  cancelQueuedTaskRunsInTransaction,
  ensureQueuedTaskRunInTransaction,
  firstUnmetQueuedTaskDependency,
  getStoredTurnCompletionForProviderSession,
  interruptQueuedTaskRunsInTransaction,
  listQueuedTaskRunsByIds,
  recordQueuedTaskRetryInTransaction,
  recordQueuedTaskRunsAdmittedInTransaction,
  rejectQueuedTaskRunsInTransaction,
  settleQueuedTaskRunsForTurnInTransaction,
  validateQueuedMessageDependenciesInTransaction,
} from "../../src/data/queued-task-runs.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";

function seed(db: DbConnection, fixture: HistoryFixture) {
  const historyRuns = fixture.turns.map((turn) => ({
    queuedMessageId: `qmsg-history-cost-${fixture.threadId}-${turn.turnId}`,
    threadId: fixture.threadId,
    state: "succeeded" as const,
    originalRequestId: turn.requestId,
    requestId: turn.requestId,
    providerId: "codex",
    providerSessionId: null,
    turnId: turn.turnId,
    failureReason: null,
    createdAt: 1,
    updatedAt: 1,
  }));
  for (let offset = 0; offset < historyRuns.length; offset += 100)
    db.insert(queuedTaskRuns)
      .values(historyRuns.slice(offset, offset + 100))
      .run();
  const rows = [];
  for (const threadId of [fixture.threadId, ...fixture.neighborThreadIds]) {
    let previous: string | null = null;
    for (let index = 0; index < 16; index++) {
      const row = createQueuedThreadMessage(db, noopNotifier, {
        threadId,
        providerId: "codex",
        providerSessionId: null,
        providerSwitchPolicy: "manual",
        dependsOnQueuedMessageIds: previous === null ? [] : [previous],
        content: [{ type: "text", text: "Task result", mentions: [] }],
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
        payload: { kind: "inline" },
        systemNotice: null,
        waitingOn: null,
        sendAt: null,
      });
      if (threadId === fixture.threadId) rows.push(row);
      previous = row.id;
    }
  }
  const turn = fixture.turns[0];
  if (turn === undefined) throw new Error("Missing history turn");
  db.update(events)
    .set({ providerId: "codex", providerSessionId: null })
    .where(
      and(
        eq(events.threadId, fixture.threadId),
        eq(events.sequence, turn.completedSequence),
      ),
    )
    .run();
  return {
    rows,
    requestId: turn.requestId,
    turnId: turn.turnId,
    source: { providerId: "codex", providerSessionId: null },
  };
}

type Seed = ReturnType<typeof seed>;
const TASKS = "packages/db/src/data/queued-task-runs.ts";
const QUEUE = "packages/db/src/data/queued-thread-messages.ts";

function admit(db: DbConnection, fixture: HistoryFixture, data: Seed) {
  db.transaction((tx) =>
    recordQueuedTaskRunsAdmittedInTransaction(tx, {
      threadId: fixture.threadId,
      queuedMessages: [data.rows[0]!],
      requestId: data.requestId,
      source: data.source,
    }),
  );
}

function bind(db: DbConnection, fixture: HistoryFixture, data: Seed) {
  admit(db, fixture, data);
  db.transaction((tx) =>
    bindQueuedTaskRunsToTurnInTransaction(tx, {
      threadId: fixture.threadId,
      requestId: data.requestId,
      turnId: data.turnId,
      source: data.source,
    }),
  );
}

let claimed: ClaimedQueuedThreadMessageRow[] = [];
const cases: QueryCostCase<Seed>[] = [
  {
    name: `${TASKS}#validateQueuedMessageDependenciesInTransaction`,
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        validateQueuedMessageDependenciesInTransaction(tx, {
          threadId: fixture.threadId,
          queuedMessageId: "qmsg-new-cost-case",
          dependencyIds: data.rows.map((row) => row.id),
        }),
      ),
  },
  {
    name: `${TASKS}#firstUnmetQueuedTaskDependency`,
    run: (db, fixture, data) =>
      firstUnmetQueuedTaskDependency(db, {
        threadId: fixture.threadId,
        dependencyIds: data.rows.map((row) => row.id),
      }),
  },
  {
    name: `${TASKS}#ensureQueuedTaskRunInTransaction`,
    prepare: (db, _fixture, data) =>
      db
        .delete(queuedTaskRuns)
        .where(eq(queuedTaskRuns.queuedMessageId, data.rows.at(-1)!.id))
        .run(),
    run: (db, _fixture, data) =>
      db.transaction((tx) =>
        ensureQueuedTaskRunInTransaction(tx, data.rows.at(-1)!),
      ),
  },
  {
    name: `${TASKS}#listQueuedTaskRunsByIds`,
    run: (db, fixture, data) =>
      listQueuedTaskRunsByIds(db, {
        threadId: fixture.threadId,
        queuedMessageIds: data.rows.map((row) => row.id),
      }),
  },
  { name: `${TASKS}#recordQueuedTaskRunsAdmittedInTransaction`, run: admit },
  {
    name: `${TASKS}#recordQueuedTaskRetryInTransaction`,
    prepare: (db, fixture, data) => {
      admit(db, fixture, data);
      db.transaction((tx) =>
        rejectQueuedTaskRunsInTransaction(tx, {
          threadId: fixture.threadId,
          requestId: data.requestId,
          failureReason: "Retryable error",
        }),
      );
    },
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        recordQueuedTaskRetryInTransaction(tx, {
          threadId: fixture.threadId,
          originalRequestId: data.requestId,
          requestId: fixture.pendingRequestId,
          source: data.source,
        }),
      ),
  },
  {
    name: `${TASKS}#bindQueuedTaskRunsToTurnInTransaction`,
    prepare: admit,
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        bindQueuedTaskRunsToTurnInTransaction(tx, {
          threadId: fixture.threadId,
          requestId: data.requestId,
          turnId: data.turnId,
          source: data.source,
        }),
      ),
  },
  {
    name: `${TASKS}#settleQueuedTaskRunsForTurnInTransaction`,
    prepare: bind,
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        settleQueuedTaskRunsForTurnInTransaction(tx, {
          threadId: fixture.threadId,
          turnId: data.turnId,
          source: data.source,
          state: "succeeded",
          failureReason: null,
        }),
      ),
  },
  {
    name: `${TASKS}#rejectQueuedTaskRunsInTransaction`,
    prepare: admit,
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        rejectQueuedTaskRunsInTransaction(tx, {
          threadId: fixture.threadId,
          requestId: data.requestId,
          failureReason: "Rejected",
        }),
      ),
  },
  {
    name: `${TASKS}#cancelQueuedTaskRunsInTransaction`,
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        cancelQueuedTaskRunsInTransaction(tx, {
          threadId: fixture.threadId,
          queuedMessageIds: data.rows.map((row) => row.id),
        }),
      ),
  },
  {
    name: `${TASKS}#interruptQueuedTaskRunsInTransaction`,
    prepare: bind,
    run: (db, fixture, data) =>
      db.transaction((tx) =>
        interruptQueuedTaskRunsInTransaction(tx, {
          threadId: fixture.threadId,
          source: data.source,
          failureReason: "Stopped",
        }),
      ),
  },
  {
    name: `${TASKS}#getStoredTurnCompletionForProviderSession`,
    run: (db, fixture, data) =>
      getStoredTurnCompletionForProviderSession(db, {
        threadId: fixture.threadId,
        turnId: data.turnId,
        source: data.source,
      }),
  },
  {
    name: `${QUEUE}#requeueClaimedQueuedThreadMessagesInTransaction`,
    prepare: (db, _fixture, data) => {
      claimed =
        claimQueuedThreadMessageGroup(db, noopNotifier, data.rows[0]!.id, {
          kind: "explicit-send",
        }) ?? [];
      if (claimed.length === 0) throw Error("Missing claim");
    },
    run: (db, fixture) =>
      db.transaction((tx) =>
        requeueClaimedQueuedThreadMessagesInTransaction(tx, {
          threadId: fixture.threadId,
          claims: claimed,
          waitingOn: { kind: "thread-busy" },
          sendAt: null,
          recheckAt: null,
        }),
      ),
  },
  {
    name: `${QUEUE}#refreshQueuedTaskDependencyWaitsInTransaction`,
    prepare: (db, fixture, data) => {
      for (const row of data.rows.slice(1))
        setQueuedThreadMessageWaitingOn(db, noopNotifier, {
          threadId: fixture.threadId,
          id: row.id,
          waitingOn: {
            kind: "dependency",
            queuedMessageId: row.dependsOnQueuedMessageIds[0]!,
            status: "queued",
          },
        });
      bind(db, fixture, data);
      db.transaction((tx) =>
        settleQueuedTaskRunsForTurnInTransaction(tx, {
          threadId: fixture.threadId,
          turnId: data.turnId,
          source: data.source,
          state: "succeeded",
          failureReason: null,
        }),
      );
    },
    run: (db, fixture) =>
      db.transaction((tx) =>
        refreshQueuedTaskDependencyWaitsInTransaction(tx, fixture.threadId),
      ),
  },
];

export const QUEUED_TASK_RUNS_COST_GROUP = registerCostGroup({
  name: "queued-task-runs",
  seed,
  cases,
});
