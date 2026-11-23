import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { createMigratedConnection } from "../../src/testing.js";
import { noopNotifier } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createEnvironment } from "../../src/data/environments.js";
import { createThread, getThread } from "../../src/data/threads.js";
import {
  nextThreadPurge,
  requestThreadPurge,
} from "../../src/data/thread-purges.js";
import {
  environments,
  threadProviderTransitions,
  threads,
} from "../../src/schema.js";
import {
  advanceProviderTransition,
  beginProviderTransitionInTransaction,
  commitProviderTransitionInTransaction,
  rollbackCommittedProviderTransitionInTransaction,
  getActiveProviderTransition,
  getCurrentProviderTransition,
  getProviderTransition,
  listPendingProviderTransitionsForHost,
  type ProviderTransitionRow,
} from "../../src/data/provider-transitions.js";

function fixture() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "transition-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "transitions",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/transition-workspace",
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
    hostId: host.id,
    projectId: project.id,
    providerOwnsPath: false,
    path: "/tmp/transition-workspace",
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  const input: Parameters<typeof beginProviderTransitionInTransaction>[1] = {
    id: "transition",
    threadId: thread.id,
    environmentId: environment.id,
    hostId: host.id,
    fingerprint: "a".repeat(64),
    sourceProviderId: "codex",
    sourceProviderSessionId: null,
    sourceProviderThreadId: "source-native",
    sourceModelOverride: null,
    sourceReasoningLevelOverride: null,
    targetProviderId: "replacement",
    targetProviderSessionId: "target-generation",
    execution: {
      model: "target-model",
      reasoningLevel: "medium",
      serviceTier: "default",
      permissionMode: "accept-edits",
      source: "client/turn/requested",
    },
    contextText: "Conversation context approved for this target",
    contextThroughSequence: 0,
    contextTokenBudget: 4096,
    contextWindowTokens: 32768,
    contextWindowSource: "host",
    createdAt: 100,
  };
  return { db, host, thread, environment, input };
}

function advance(
  db: DbConnection,
  row: ProviderTransitionRow,
  phase: ProviderTransitionRow["phase"],
) {
  const next = advanceProviderTransition(db, {
    id: row.id,
    expectedPhase: row.phase,
    expectedRevision: row.revision,
    phase,
    targetProviderThreadId: row.targetProviderThreadId ?? "target-native",
    errorCode: null,
    now: row.updatedAt + 1,
  });
  if (!next) throw new Error("Fixture transition conflicted");
  return next;
}

function begin(ctx: ReturnType<typeof fixture>) {
  const row = ctx.db.transaction((tx) =>
    beginProviderTransitionInTransaction(tx, ctx.input),
  );
  if (!row) throw new Error("Fixture could not begin its transition");
  return row;
}

describe("provider transition journal", () => {
  it("retains pending cleanup during thread purge and releases it after rollback", () => {
    const ctx = fixture();
    try {
      const row = begin(ctx);
      requestThreadPurge(ctx.db, { now: 101, threadId: ctx.thread.id });
      expect(
        nextThreadPurge(ctx.db, { excludedThreadIds: new Set() }),
      ).toBeNull();
      expect(
        listPendingProviderTransitionsForHost(ctx.db, {
          hostId: ctx.host.id,
          limit: 10,
          excludedIds: [row.id],
        }),
      ).toEqual([]);
      advance(ctx.db, row, "rolled_back");
      expect(nextThreadPurge(ctx.db, { excludedThreadIds: new Set() })).toBe(
        ctx.thread.id,
      );
    } finally {
      ctx.db.$client.close();
    }
  });
  it("recovers an adopting intent from disk, commits ownership once and rejects delayed revisions", async () => {
    const ctx = fixture();
    const directory = mkdtempSync(
      join(tmpdir(), "bb-provider-transition-journal-"),
    );
    let db = ctx.db;
    try {
      const initial = begin(ctx);
      const prepared = advance(db, initial, "prepared");
      const adopting = advance(db, prepared, "adopting");
      expect(getThread(db, ctx.thread.id)?.providerSessionId).toBeNull();
      const path = join(directory, "bb.sqlite");
      await db.$client.backup(path);
      db.$client.close();
      db = createConnection(path);
      expect(getActiveProviderTransition(db, ctx.thread.id)).toEqual(adopting);
      expect(
        listPendingProviderTransitionsForHost(db, {
          hostId: ctx.host.id,
          limit: 10,
          excludedIds: [],
        }),
      ).toEqual([adopting]);
      expect(
        db.transaction((tx) =>
          commitProviderTransitionInTransaction(tx, {
            id: initial.id,
            expectedRevision: prepared.revision,
            now: 200,
          }),
        ),
      ).toBeNull();
      expect(getThread(db, ctx.thread.id)?.providerId).toBe("codex");
      const committed = db.transaction((tx) =>
        commitProviderTransitionInTransaction(tx, {
          id: initial.id,
          expectedRevision: adopting.revision,
          now: 201,
        }),
      );
      if (!committed) throw new Error("Commit unexpectedly conflicted");
      expect(getThread(db, ctx.thread.id)).toMatchObject({
        providerId: "replacement",
        providerSessionId: "target-generation",
        modelOverride: "target-model",
        reasoningLevelOverride: "medium",
      });
      expect(
        getCurrentProviderTransition(db, ctx.thread.id)?.execution
          .permissionMode,
      ).toBe("accept-edits");
      const finalizing = advance(db, committed, "finalizing");
      const completed = advance(db, finalizing, "completed");
      expect(getActiveProviderTransition(db, ctx.thread.id)).toBeNull();
      expect(
        listPendingProviderTransitionsForHost(db, {
          hostId: ctx.host.id,
          limit: 10,
          excludedIds: [],
        }),
      ).toEqual([]);
      expect(
        advanceProviderTransition(db, {
          id: initial.id,
          expectedPhase: "adopting",
          expectedRevision: adopting.revision,
          phase: "rolling_back",
          targetProviderThreadId: "target-native",
          errorCode: "stale",
          now: 300,
        }),
      ).toBeNull();
      expect(
        db.transaction((tx) =>
          commitProviderTransitionInTransaction(tx, {
            id: initial.id,
            expectedRevision: adopting.revision,
            now: 301,
          }),
        ),
      ).toBeNull();
      expect(getProviderTransition(db, initial.id)).toEqual(completed);
      expect(getCurrentProviderTransition(db, ctx.thread.id)?.contextText).toBe(
        ctx.input.contextText,
      );
    } finally {
      db.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["committed", "finalizing"] as const)(
    "restores the original owner after an interrupted %s transition without accepting stale retries",
    (phase) => {
      const ctx = fixture();
      try {
        const adopting = advance(
          ctx.db,
          advance(ctx.db, begin(ctx), "prepared"),
          "adopting",
        );
        let committed = ctx.db.transaction((tx) =>
          commitProviderTransitionInTransaction(tx, {
            id: ctx.input.id,
            expectedRevision: adopting.revision,
            now: 200,
          }),
        );
        if (!committed) throw new Error("Fixture did not commit");
        if (phase === "finalizing")
          committed = advance(ctx.db, committed, "finalizing");
        const rollback = {
          id: ctx.input.id,
          expectedRevision: committed.revision,
          errorCode: "interrupted",
          now: 300,
        };
        expect(
          ctx.db.transaction((tx) =>
            rollbackCommittedProviderTransitionInTransaction(tx, {
              ...rollback,
              expectedRevision: adopting.revision,
            }),
          ),
        ).toBeNull();
        expect(getThread(ctx.db, ctx.thread.id)?.providerId).toBe(
          "replacement",
        );
        expect(
          ctx.db.transaction((tx) =>
            rollbackCommittedProviderTransitionInTransaction(tx, rollback),
          ),
        ).toMatchObject({ phase: "rolled_back", errorCode: "interrupted" });
        expect(getThread(ctx.db, ctx.thread.id)).toMatchObject({
          providerId: "codex",
          providerSessionId: null,
          modelOverride: null,
          reasoningLevelOverride: null,
        });
        expect(
          ctx.db.transaction((tx) =>
            rollbackCommittedProviderTransitionInTransaction(tx, rollback),
          ),
        ).toBeNull();
        expect(getActiveProviderTransition(ctx.db, ctx.thread.id)).toBeNull();
        expect(getCurrentProviderTransition(ctx.db, ctx.thread.id)).toBeNull();
      } finally {
        ctx.db.$client.close();
      }
    },
  );

  it.each(["generation", "model", "host"] as const)(
    "keeps one active intent and refuses to commit after its source %s changes",
    (change) => {
      const ctx = fixture();
      try {
        const initial = begin(ctx);
        expect(
          ctx.db.transaction((tx) =>
            beginProviderTransitionInTransaction(tx, {
              ...ctx.input,
              id: "concurrent",
              targetProviderSessionId: "concurrent-generation",
            }),
          ),
        ).toBeNull();
        expect(getProviderTransition(ctx.db, "concurrent")).toBeNull();
        const adopting = advance(
          ctx.db,
          advance(ctx.db, initial, "prepared"),
          "adopting",
        );
        if (change === "generation")
          ctx.db
            .update(threads)
            .set({ providerSessionId: "another-generation" })
            .where(eq(threads.id, ctx.thread.id))
            .run();
        if (change === "model")
          ctx.db
            .update(threads)
            .set({ modelOverride: "another-model" })
            .where(eq(threads.id, ctx.thread.id))
            .run();
        if (change === "host") {
          const otherHost = upsertHost(ctx.db, noopNotifier, {
            name: "other-transition-host",
          });
          ctx.db
            .update(environments)
            .set({ hostId: otherHost.id })
            .where(eq(environments.id, ctx.environment.id))
            .run();
        }
        expect(
          ctx.db.transaction((tx) =>
            commitProviderTransitionInTransaction(tx, {
              id: initial.id,
              expectedRevision: adopting.revision,
              now: 200,
            }),
          ),
        ).toBeNull();
        expect(getThread(ctx.db, ctx.thread.id)?.providerId).toBe("codex");
        expect(getProviderTransition(ctx.db, initial.id)).toEqual(adopting);
        expect(getCurrentProviderTransition(ctx.db, ctx.thread.id)).toBeNull();
        const rolledBack = advance(
          ctx.db,
          advance(ctx.db, adopting, "rolling_back"),
          "rolled_back",
        );
        expect(getActiveProviderTransition(ctx.db, ctx.thread.id)).toBeNull();
        expect(rolledBack.phase).toBe("rolled_back");
      } finally {
        ctx.db.$client.close();
      }
    },
  );

  it("does not persist a claimed context window without its measured or declared value", () => {
    const ctx = fixture();
    try {
      expect(() =>
        ctx.db.transaction((tx) =>
          beginProviderTransitionInTransaction(tx, {
            ...ctx.input,
            contextWindowTokens: null,
            contextWindowSource: "host",
          }),
        ),
      ).toThrow("thread_provider_transitions_context_check");
      expect(getProviderTransition(ctx.db, ctx.input.id)).toBeNull();
      const unknown = ctx.db.transaction((tx) =>
        beginProviderTransitionInTransaction(tx, {
          ...ctx.input,
          contextWindowTokens: null,
          contextWindowSource: "unknown",
        }),
      );
      expect(unknown?.contextWindowTokens).toBeNull();
      expect(() =>
        ctx.db
          .update(threadProviderTransitions)
          .set({ phase: "completed" })
          .where(eq(threadProviderTransitions.id, ctx.input.id))
          .run(),
      ).toThrow("thread_provider_transitions_native_identity_check");
      expect(getActiveProviderTransition(ctx.db, ctx.thread.id)?.phase).toBe(
        "preparing",
      );
    } finally {
      ctx.db.$client.close();
    }
  });
});
