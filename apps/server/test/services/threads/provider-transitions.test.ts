import { describe, expect, it } from "vitest";
import {
  advanceProviderTransition,
  beginProviderTransitionInTransaction,
  commitProviderTransitionInTransaction,
  getLastStoredProviderThreadId,
  getLatestThreadSequence,
  getProviderTransition,
  getThread,
  listStoredEventRows,
  listSweepItemFailures,
  markThreadDeleted,
  type ProviderTransitionRow,
} from "@bb/db";
import {
  reconcileProviderTransition,
  startProviderTransition,
  providerTransitionRecoverySweep,
} from "../../../src/services/threads/provider-transitions.js";
import { requireProviderTransitionSettled } from "../../../src/services/threads/provider-transition-guard.js";
import { appendThreadEvent } from "../../../src/services/threads/thread-events.js";
import {
  threadScope,
  turnScope,
  type ThreadEvent,
  THREAD_CONTEXT_CLEAR_OPERATION,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { sendThreadMessage } from "../../../src/services/threads/thread-send.js";
import { clearThreadContext } from "../../../src/services/threads/thread-context-clear.js";
import { requestThreadStorageDeletion } from "../../../src/services/threads/thread-lifecycle.js";
import { seedThreadSessionOptionSelections } from "../../../src/services/threads/thread-session-options.js";
import { seedProviderTransitionInput } from "../../helpers/provider-transitions.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  internalAuthHeaders,
  listQueuedCommands,
} from "../../helpers/commands.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

function preparedTarget(
  input: ReturnType<typeof seedProviderTransitionInput>["input"],
) {
  return {
    providerId: input.targetProviderId,
    providerSessionId: input.targetProviderSessionId,
    providerThreadId: "target-native",
  };
}

function advanceFixture(
  harness: TestAppHarness,
  input: ReturnType<typeof seedProviderTransitionInput>["input"],
  phase: "preparing" | "adopting" | "committed" | "finalizing",
) {
  let row = harness.db.transaction((tx) =>
    beginProviderTransitionInTransaction(tx, input),
  );
  if (!row) throw new Error("Fixture could not begin transition");
  if (phase === "preparing") return row;
  for (const step of ["prepared", "adopting"] as const) {
    const next = advanceProviderTransition(harness.db, {
      id: row.id,
      expectedRevision: row.revision,
      expectedPhase: row.phase,
      phase: step,
      targetProviderThreadId: preparedTarget(input).providerThreadId,
      errorCode: null,
      now: Date.now(),
    });
    if (!next) throw new Error("Fixture phase conflicted");
    row = next;
  }
  if (phase === "adopting") return row;
  const committed = harness.db.transaction((tx) =>
    commitProviderTransitionInTransaction(tx, {
      id: input.id,
      expectedRevision: row.revision,
      now: Date.now(),
    }),
  );
  if (!committed) throw new Error("Fixture could not commit transition");
  if (phase === "committed") return committed;
  const finalizing = advanceProviderTransition(harness.db, {
    id: committed.id,
    expectedRevision: committed.revision,
    expectedPhase: committed.phase,
    phase: "finalizing",
    targetProviderThreadId: committed.targetProviderThreadId,
    errorCode: null,
    now: Date.now(),
  });
  if (!finalizing) throw new Error("Fixture could not begin finalization");
  return finalizing;
}

function operationEvents(harness: TestAppHarness, threadId: string) {
  return listStoredEventRows(harness.db, {
    threadId,
    types: ["system/operation"],
  });
}

function observe(promise: Promise<ProviderTransitionRow>) {
  void promise.catch(() => undefined);
  return promise;
}

describe("durable provider transitions", () => {
  it.each(["continue", "retry", "clear"] as const)(
    "delivers the persisted context through the first real request: %s",
    async (action) => {
      await withTestHarness(async (harness) => {
        const fixture = seedProviderTransitionInput(harness);
        const { input, thread, environment, session } = fixture;
        input.targetProviderId = "codex";
        input.execution.model = "gpt-5";
        advanceFixture(harness, input, "committed");
        appendThreadEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "target-native",
          type: "thread/identity",
          scope: threadScope(),
          data: { providerThreadId: "target-native" },
        });
        const recovering = observe(
          reconcileProviderTransition(harness.deps, input.id),
        );
        const finalize = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.session.finalize",
        );
        await reportQueuedCommandSuccess(harness, finalize, {});
        await recovering;
        const currentThread = getThread(harness.db, thread.id);
        if (!currentThread) throw new Error("Current thread is unavailable");
        if (action === "clear") {
          const clearing = clearThreadContext(harness.deps, {
            thread: currentThread,
            environment,
          });
          const stop = await waitForQueuedCommand(
            harness,
            ({ command }) => command.type === "thread.stop",
          );
          await reportQueuedCommandSuccess(harness, stop, {
            providerCheckpointId: null,
          });
          await clearing;
          expect(
            listStoredEventRows(harness.db, {
              threadId: thread.id,
              types: ["system/operation"],
            }).some((row) => row.data.includes(THREAD_CONTEXT_CLEAR_OPERATION)),
          ).toBe(true);
        }
        const send = async (text: string) => {
          const current = getThread(harness.db, thread.id);
          if (!current) throw new Error("Current thread is unavailable");
          await sendThreadMessage(harness.deps, {
            thread: current,
            environment,
            originPluginId: null,
            trigger: "user",
            payload: {
              input: [{ type: "text", text, mentions: [] }],
              mode: "start",
            },
          });
          const queued = await waitForQueuedCommand(
            harness,
            ({ command }) =>
              command.type === "turn.submit" || command.type === "thread.start",
          );
          if (
            queued.command.type !== "turn.submit" &&
            queued.command.type !== "thread.start"
          )
            throw new Error("Expected a real agent request");
          return { queued, command: queued.command };
        };
        const first = await send("First new request");
        const contextInput = {
          type: "text",
          text: input.contextText,
          mentions: [],
          visibility: "agent-only",
        };
        expect(first.command.input).toEqual(
          action === "clear"
            ? [{ type: "text", text: "First new request", mentions: [] }]
            : [
                contextInput,
                { type: "text", text: "First new request", mentions: [] },
              ],
        );
        if (action === "continue") {
          await reportQueuedCommandSuccess(harness, first.queued, {
            trace: { spans: [] },
          });
          const events: ThreadEvent[] = [
            {
              type: "turn/started",
              threadId: thread.id,
              providerThreadId: "target-native",
              scope: turnScope("target-first-turn"),
            },
            {
              type: "turn/input/accepted",
              threadId: thread.id,
              providerThreadId: "target-native",
              scope: turnScope("target-first-turn"),
              clientRequestId: first.command.requestId,
            },
            {
              type: "turn/completed",
              threadId: thread.id,
              providerThreadId: "target-native",
              scope: turnScope("target-first-turn"),
              status: "completed",
            },
          ];
          const response = await harness.app.request(
            "/internal/session/events",
            {
              method: "POST",
              headers: internalAuthHeaders(harness),
              body: JSON.stringify({
                sessionId: session.id,
                eventGroups: groupHostDaemonEvents(
                  events.map((event) => ({
                    source: {
                      providerId: input.targetProviderId,
                      providerSessionId: input.targetProviderSessionId,
                    },
                    threadId: thread.id,
                    event,
                  })),
                ),
              }),
            },
          );
          expect(response.status, await response.clone().text()).toBe(200);
        } else {
          await reportQueuedCommandError(harness, first.queued, {
            errorCode: "provider_turn_start_failed",
            errorMessage: "Request was not delivered",
          });
        }
        if (action !== "clear") {
          const second = await send("Second new request");
          expect(second.command.input).toEqual(
            action === "retry"
              ? [
                  contextInput,
                  { type: "text", text: "Second new request", mentions: [] },
                ]
              : [{ type: "text", text: "Second new request", mentions: [] }],
          );
          await reportQueuedCommandError(harness, second.queued, {
            errorCode: "provider_turn_start_failed",
            errorMessage: "Fixture finished",
          });
        }
      });
    },
  );
  it("commits the new provider and its native identity together after adoption, then releases admission after finalization", async () => {
    await withTestHarness(async (harness) => {
      const { input, thread } = seedProviderTransitionInput(harness);
      seedThreadSessionOptionSelections(harness.deps, {
        thread,
        selections: { oldProviderOption: true },
      });
      input.contextThroughSequence = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });
      const switching = observe(startProviderTransition(harness.deps, input));
      const prepare = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.prepare",
      );
      expect(prepare.command).toMatchObject({
        providerId: "claude-code",
        providerSessionId: input.targetProviderSessionId,
        expectedSource: { providerId: "codex", providerSessionId: null },
      });
      expect(prepare.command).not.toHaveProperty("input");
      expect(prepare.command).not.toHaveProperty("options.sessionOptions");
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      await reportQueuedCommandSuccess(harness, prepare, preparedTarget(input));
      const adopt = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.adopt",
      );
      expect(getProviderTransition(harness.db, input.id)?.phase).toBe(
        "adopting",
      );
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      await reportQueuedCommandSuccess(harness, adopt, preparedTarget(input));
      const finalize = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.finalize",
      );
      expect(getThread(harness.db, thread.id)).toMatchObject({
        id: thread.id,
        providerId: input.targetProviderId,
        providerSessionId: input.targetProviderSessionId,
        modelOverride: input.execution.model,
      });
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBe(
        "target-native",
      );
      expect(() =>
        requireProviderTransitionSettled(harness.db, thread.id),
      ).toThrow();
      await reportQueuedCommandSuccess(harness, finalize, {});
      const result = await switching;
      expect(result.phase).toBe("completed");
      expect(() =>
        requireProviderTransitionSettled(harness.db, thread.id),
      ).not.toThrow();
      expect(operationEvents(harness, thread.id)).toHaveLength(1);
      expect(await startProviderTransition(harness.deps, input)).toEqual(
        result,
      );
      expect(operationEvents(harness, thread.id)).toHaveLength(1);
      await expect(
        startProviderTransition(harness.deps, {
          ...input,
          execution: { ...input.execution, model: "different-model" },
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it.each(["changed conversation", "mismatched adoption"] as const)(
    "rolls back a %s before publishing the target identity",
    async (failure) => {
      await withTestHarness(async (harness) => {
        const { input, thread } = seedProviderTransitionInput(harness);
        const switching = observe(startProviderTransition(harness.deps, input));
        const prepare = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.session.prepare",
        );
        if (failure === "changed conversation") {
          appendThreadEvent(harness.deps, {
            threadId: thread.id,
            environmentId: input.environmentId,
            type: "system/operation",
            scope: threadScope(),
            data: {
              operation: "workspace-update",
              status: "completed",
              message: "Workspace changed",
              operationId: "other-operation",
              metadata: {},
            },
          });
        }
        await reportQueuedCommandSuccess(
          harness,
          prepare,
          preparedTarget(input),
        );
        if (failure === "mismatched adoption") {
          const adopt = await waitForQueuedCommand(
            harness,
            ({ command }) => command.type === "thread.session.adopt",
          );
          await reportQueuedCommandSuccess(harness, adopt, {
            ...preparedTarget(input),
            providerSessionId: "unexpected-generation",
          });
        }
        const rollback = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.session.rollback",
        );
        await reportQueuedCommandSuccess(harness, rollback, { session: null });
        expect((await switching).phase).toBe("rolled_back");
        expect(getThread(harness.db, thread.id)).toMatchObject({
          providerId: "codex",
          providerSessionId: null,
        });
        expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBeNull();
        if (failure === "changed conversation")
          expect(operationEvents(harness, thread.id)[0]?.data).toContain(
            "Workspace changed",
          );
      });
    },
  );

  it.each(["preparing", "adopting"] as const)(
    "recovers persisted %s intent by discarding the uncommitted target",
    async (phase) => {
      await withTestHarness(async (harness) => {
        const { input, thread } = seedProviderTransitionInput(harness);
        advanceFixture(harness, input, phase);
        const recovering = observe(
          reconcileProviderTransition(harness.deps, input.id),
        );
        const cleanupType =
          phase === "preparing"
            ? "thread.session.discard"
            : "thread.session.rollback";
        const cleanup = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === cleanupType,
        );
        expect(() =>
          requireProviderTransitionSettled(harness.db, thread.id),
        ).toThrow();
        await reportQueuedCommandSuccess(
          harness,
          cleanup,
          phase === "preparing" ? {} : { session: null },
        );
        expect((await recovering).phase).toBe("rolled_back");
        expect(getThread(harness.db, thread.id)).toMatchObject({
          providerId: "codex",
          providerSessionId: null,
        });
        expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBeNull();
        expect(operationEvents(harness, thread.id)).toHaveLength(1);
      });
    },
  );

  it.each(["committed", "finalizing"] as const)(
    "finishes persisted %s intent without preparing or adopting a second session",
    async (phase) => {
      await withTestHarness(async (harness) => {
        const { input, thread } = seedProviderTransitionInput(harness);
        advanceFixture(harness, input, phase);
        const recovering = observe(
          reconcileProviderTransition(harness.deps, input.id),
        );
        const finalize = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.session.finalize",
        );
        await reportQueuedCommandSuccess(harness, finalize, {});
        expect((await recovering).phase).toBe("completed");
        const revision = getProviderTransition(harness.db, input.id)?.revision;
        expect(
          (await reconcileProviderTransition(harness.deps, input.id)).revision,
        ).toBe(revision);
        expect(getThread(harness.db, thread.id)?.providerSessionId).toBe(
          input.targetProviderSessionId,
        );
        expect(operationEvents(harness, thread.id)).toHaveLength(1);
      });
    },
  );

  it("restores the previous provider after the host loses a committed target", async () => {
    await withTestHarness(async (harness) => {
      const { input, thread } = seedProviderTransitionInput(harness);
      advanceFixture(harness, input, "committed");
      const recovering = observe(
        reconcileProviderTransition(harness.deps, input.id),
      );
      const finalize = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.finalize",
      );
      await reportQueuedCommandError(harness, finalize, {
        errorCode: "session_missing",
        errorMessage: "Executor restarted",
      });
      const rollback = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.rollback",
      );
      expect(getThread(harness.db, thread.id)?.providerId).toBe(
        input.targetProviderId,
      );
      expect(() =>
        requireProviderTransitionSettled(harness.db, thread.id),
      ).toThrow();
      await reportQueuedCommandSuccess(harness, rollback, { session: null });
      expect((await recovering).phase).toBe("rolled_back");
      expect(getThread(harness.db, thread.id)).toMatchObject({
        providerId: "codex",
        providerSessionId: null,
        modelOverride: null,
        reasoningLevelOverride: null,
      });
      expect(() =>
        requireProviderTransitionSettled(harness.db, thread.id),
      ).not.toThrow();
    });
  });

  it("retries failed rollback through the persisted sweep backoff and blocks new work until cleanup is confirmed", async () => {
    await withTestHarness(async (harness) => {
      const { input, thread } = seedProviderTransitionInput(harness);
      advanceFixture(harness, input, "adopting");
      const sweep = providerTransitionRecoverySweep(harness.deps);
      const now = Date.now();
      const recovering = sweep.run(harness.deps, now);
      const rollback = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.rollback",
      );
      await reportQueuedCommandError(harness, rollback, {
        errorCode: "host_unavailable",
        errorMessage: "Connection lost",
      });
      await recovering;
      expect(getProviderTransition(harness.db, input.id)?.phase).toBe(
        "rolling_back",
      );
      expect(() =>
        requireProviderTransitionSettled(harness.db, thread.id),
      ).toThrow();
      const failure = listSweepItemFailures(
        harness.db,
        "provider-transitions",
      )[0];
      if (!failure) throw new Error("Recovery backoff was not persisted");
      expect(failure.lastError).toBe(
        "Provider transition recovery is waiting for the executor",
      );
      await sweep.run(harness.deps, now);
      expect(listQueuedCommands(harness, "thread.session.rollback")).toEqual(
        [],
      );
      const retry = sweep.run(harness.deps, failure.retryAt + 1);
      const cleanup = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.rollback",
      );
      await reportQueuedCommandSuccess(harness, cleanup, { session: null });
      await retry;
      expect(getProviderTransition(harness.db, input.id)?.phase).toBe(
        "rolled_back",
      );
      expect(listSweepItemFailures(harness.db, "provider-transitions")).toEqual(
        [],
      );
      expect(operationEvents(harness, thread.id)).toHaveLength(1);
    });
  });

  it("delays native storage deletion until transition cleanup has released both sessions", async () => {
    await withTestHarness(async (harness) => {
      const { input, thread, environment } =
        seedProviderTransitionInput(harness);
      advanceFixture(harness, input, "adopting");
      const deleted = markThreadDeleted(harness.db, harness.hub, {
        threadId: thread.id,
      });
      if (!deleted) throw new Error("Thread was not marked deleted");
      requestThreadStorageDeletion(harness.deps, deleted, environment);
      expect(listQueuedCommands(harness, "thread.storage.delete")).toEqual([]);
      expect(getThread(harness.db, thread.id)?.storageDeletedAt).toBeNull();
      const recovering = observe(
        reconcileProviderTransition(harness.deps, input.id),
      );
      const rollback = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.rollback",
      );
      await reportQueuedCommandSuccess(harness, rollback, { session: null });
      await recovering;
      requestThreadStorageDeletion(harness.deps, deleted, environment);
      const deletion = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.storage.delete",
      );
      await reportQueuedCommandSuccess(harness, deletion, {
        providerCheckpointId: null,
      });
      expect(getThread(harness.db, thread.id)?.storageDeletedAt).toEqual(
        expect.any(Number),
      );
    });
  });
});
