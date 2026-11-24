import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import { describe, expect, it } from "vitest";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import {
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  getQueuedThreadMessage,
  getThread,
  listQueuedTaskRunsByIds,
  listQueuedThreadMessages,
} from "@bb/db";
import { listEvents } from "@bb/db/testing";
import {
  turnRequestEventDataSchema,
  turnScope,
  type ThreadEvent,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import {
  sendNextQueuedMessageIfPresent,
  sendQueuedMessageNow,
} from "../../src/services/threads/queued-messages.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { appendThreadEvent } from "../../src/services/threads/thread-events.js";
import {
  internalAuthHeaders,
  waitForQueuedCommand,
  reportQueuedCommandSuccess,
} from "../helpers/commands.js";
import { seedProviderTransitionInput } from "../helpers/provider-transitions.js";
import { seedThreadIdentity } from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function fixture(harness: TestAppHarness, native = true) {
  const data = seedProviderTransitionInput(harness);
  if (native)
    seedThreadIdentity(harness.deps, {
      threadId: data.thread.id,
      environmentId: data.environment.id,
      providerThreadId: "dependency-native",
    });
  const api = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://localhost",
      runtime: "node",
      fetch: async (input, init) => harness.app.fetch(new Request(input, init)),
    }),
  }).threads.queuedMessages;
  const queue = (
    text: string,
    dependencies: string[] = [],
    sendAt: number | null = null,
  ) =>
    createQueuedThreadMessage(harness.db, harness.hub, {
      threadId: data.thread.id,
      providerId: "codex",
      providerSessionId: null,
      providerSwitchPolicy: "manual",
      dependsOnQueuedMessageIds: dependencies,
      content: textInput(text),
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      serviceTier: "default",
      waitingOn: sendAt === null ? null : { kind: "time" },
      sendAt,
      payload: { kind: "inline" },
      systemNotice: null,
      deliveryMode: "queue",
    });
  return { ...data, api, queue };
}

function requests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => turnRequestEventDataSchema.parse(JSON.parse(event.data)));
}

function run(harness: TestAppHarness, threadId: string, id: string) {
  return listQueuedTaskRunsByIds(harness.db, {
    threadId,
    queuedMessageIds: [id],
  })[0];
}

async function post(
  harness: TestAppHarness,
  sessionId: string,
  events: ThreadEvent[],
) {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId,
      eventGroups: groupHostDaemonEvents(
        events.map((event) => ({
          threadId: event.threadId,
          source: { providerId: "codex", providerSessionId: null },
          event,
        })),
      ),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

async function acknowledgeRequest(harness: TestAppHarness, threadId: string) {
  const command = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "turn.submit" && command.threadId === threadId,
  );
  await reportQueuedCommandSuccess(harness, command, { trace: { spans: [] } });
}

function started(threadId: string, turnId: string): ThreadEvent {
  return {
    type: "turn/started",
    threadId,
    providerThreadId: "dependency-native",
    scope: turnScope(turnId),
  };
}

function completed(
  threadId: string,
  turnId: string,
  status: "completed" | "failed" | "interrupted",
): ThreadEvent {
  return {
    type: "turn/completed",
    threadId,
    providerThreadId: "dependency-native",
    scope: turnScope(turnId),
    status,
  };
}

describe("queued task dependencies", () => {
  it("validates same-thread IDs, cycles, duplicate IDs and grouping through the SDK", async () => {
    await withTestHarness(async (harness) => {
      const first = fixture(harness, false);
      const other = fixture(harness, false);
      const parent = first.queue("Parent");
      const foreign = other.queue("Foreign");
      const child = await first.api.create({
        threadId: first.thread.id,
        input: textInput("Child"),
        model: "gpt-5",
        permissionMode: "accept-edits",
        reasoningLevel: "medium",
        serviceTier: "default",
        dependsOnQueuedMessageIds: [parent.id],
      });
      expect(child.dependsOnQueuedMessageIds).toEqual([parent.id]);
      for (const ids of [
        [child.id],
        [foreign.id],
        ["missing-task"],
        [parent.id, parent.id],
      ]) {
        await expect(
          first.api.update({
            threadId: first.thread.id,
            queuedMessageId: parent.id,
            expectedUpdatedAt: parent.updatedAt,
            dependsOnQueuedMessageIds: ids,
          }),
        ).rejects.toMatchObject({ status: 400 });
      }
      await expect(
        first.api.update({
          threadId: first.thread.id,
          queuedMessageId: child.id,
          expectedUpdatedAt: child.updatedAt,
          dependsOnQueuedMessageIds: [child.id],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        getQueuedThreadMessage(harness.db, parent.id)
          ?.dependsOnQueuedMessageIds,
      ).toEqual([]);
      await expect(
        first.api.setGroupBoundary({
          threadId: first.thread.id,
          expectedGroupedPrefixQueuedMessageIds: [parent.id],
          groupBoundaryQueuedMessageId: child.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      const cleared = await first.api.update({
        threadId: first.thread.id,
        queuedMessageId: child.id,
        expectedUpdatedAt: child.updatedAt,
        dependsOnQueuedMessageIds: [],
      });
      expect(cleared.dependsOnQueuedMessageIds).toEqual([]);
    });
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "waits for the accepted parent turn and preserves its %s result",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { thread, session, queue } = fixture(harness);
        const parent = queue("Parent");
        const child = queue("Child", [parent.id]);
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        });
        const requestId = requests(harness, thread.id)[0]!.requestId;
        expect(getQueuedThreadMessage(harness.db, parent.id)).toBeNull();
        expect(run(harness, thread.id, parent.id)).toMatchObject({
          state: "running",
          requestId,
          turnId: null,
        });
        await expect(
          sendQueuedMessageNow(harness.deps, {
            threadId: thread.id,
            queuedMessageId: child.id,
            mode: "auto",
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(
          getQueuedThreadMessage(harness.db, child.id)?.waitingOn,
        ).toContain('"kind":"dependency"');
        expect(requests(harness, thread.id)).toHaveLength(1);
        const turnId = `parent-${status}`;
        await post(harness, session.id, [
          started(thread.id, turnId),
          {
            type: "turn/input/accepted",
            threadId: thread.id,
            providerThreadId: "dependency-native",
            scope: turnScope(turnId),
            clientRequestId: requestId,
          },
        ]);
        await acknowledgeRequest(harness, thread.id);
        await post(harness, session.id, [completed(thread.id, turnId, status)]);
        expect(run(harness, thread.id, parent.id)?.state).toBe(
          status === "completed"
            ? "succeeded"
            : status === "failed"
              ? "failed"
              : "cancelled",
        );
        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });
        if (status === "completed") {
          await expect.poll(() => requests(harness, thread.id).length).toBe(2);
          expect(getQueuedThreadMessage(harness.db, child.id)).toBeNull();
        } else {
          expect(requests(harness, thread.id)).toHaveLength(1);
          expect(
            getQueuedThreadMessage(harness.db, child.id)?.waitingOn,
          ).toContain(
            status === "failed" ? '"status":"failed"' : '"status":"cancelled"',
          );
          if (status === "failed") {
            const failedThread = getThread(harness.db, thread.id);
            if (failedThread === null) throw Error("Missing failed thread");
            await retryFailedTurn(harness.deps, {
              thread: failedThread,
              request: {
                turnRequestId: requestId,
                sendAt: null,
                reason: "User retry",
              },
            });
            const retryRequestId = requests(harness, thread.id)[1]!.requestId;
            expect(run(harness, thread.id, parent.id)).toMatchObject({
              state: "running",
              originalRequestId: requestId,
              requestId: retryRequestId,
              turnId: null,
            });
            await post(harness, session.id, [
              started(thread.id, "parent-retry"),
              {
                type: "turn/input/accepted",
                threadId: thread.id,
                providerThreadId: "dependency-native",
                scope: turnScope("parent-retry"),
                clientRequestId: retryRequestId,
              },
            ]);
            await acknowledgeRequest(harness, thread.id);
            await post(harness, session.id, [
              completed(thread.id, "parent-retry", "completed"),
            ]);
            await runQueuedMessageDispatch(harness.deps, {
              kind: "thread-ready",
              threadId: thread.id,
            });
            await expect
              .poll(() => requests(harness, thread.id).length)
              .toBe(3);
            expect(run(harness, thread.id, parent.id)?.state).toBe("succeeded");
            expect(getQueuedThreadMessage(harness.db, child.id)).toBeNull();
          }
        }
      });
    },
  );

  it("binds an acknowledgement after completion without accepting an unrelated turn", async () => {
    await withTestHarness(async (harness) => {
      const { thread, session, queue } = fixture(harness);
      const parent = queue("Parent");
      const child = queue("Child", [parent.id]);
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      const requestId = requests(harness, thread.id)[0]!.requestId;
      await post(harness, session.id, [
        started(thread.id, "unrelated"),
        completed(thread.id, "unrelated", "completed"),
      ]);
      expect(run(harness, thread.id, parent.id)?.state).toBe("running");
      await post(harness, session.id, [
        started(thread.id, "late-accepted"),
        completed(thread.id, "late-accepted", "completed"),
      ]);
      expect(run(harness, thread.id, parent.id)?.state).toBe("running");
      await post(harness, session.id, [
        {
          type: "turn/input/accepted",
          threadId: thread.id,
          providerThreadId: "dependency-native",
          scope: turnScope("late-accepted"),
          clientRequestId: requestId,
        },
      ]);
      expect(run(harness, thread.id, parent.id)?.state).toBe("succeeded");
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });
      await acknowledgeRequest(harness, thread.id);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });
      await expect.poll(() => requests(harness, thread.id).length).toBe(2);
      expect(getQueuedThreadMessage(harness.db, child.id)).toBeNull();
    });
  });

  it("keeps cancelled predecessors and skips their dependent task for independent work", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queue } = fixture(harness);
      const parent = queue("Deleted parent");
      const child = queue("Held child", [parent.id]);
      const independent = queue("Independent");
      expect(
        deleteQueuedThreadMessage(harness.db, harness.hub, parent.id),
      ).toBe(true);
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });
      await expect.poll(() => requests(harness, thread.id).length).toBe(1);
      expect(getQueuedThreadMessage(harness.db, independent.id)).toBeNull();
      expect(run(harness, thread.id, parent.id)?.state).toBe("cancelled");
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
      ).toEqual([child.id]);
      expect(getQueuedThreadMessage(harness.db, child.id)?.waitingOn).toContain(
        '"status":"cancelled"',
      );
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
    });
  });

  it("expires a scheduled dependency wait once without repeatedly booking the old deadline", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queue } = fixture(harness);
      const parent = queue("Cancelled parent");
      const child = queue("Scheduled child", [parent.id], Date.now() - 1000);
      deleteQueuedThreadMessage(harness.db, harness.hub, parent.id);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: Date.now(),
      });
      const held = getQueuedThreadMessage(harness.db, child.id);
      expect(held).toMatchObject({ state: "waiting", sendAt: null });
      expect(held?.waitingOn).toContain('"status":"cancelled"');
      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: Date.now() + 1000,
      });
      expect(getQueuedThreadMessage(harness.db, child.id)?.updatedAt).toBe(
        held?.updatedAt,
      );
      expect(requests(harness, thread.id)).toEqual([]);
    });
  });

  it("holds dependents after request rejection even for an explicit steer", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queue } = fixture(harness);
      const parent = queue("Rejected parent");
      const child = queue("Child", [parent.id]);
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      const requestId = requests(harness, thread.id)[0]!.requestId;
      appendThreadEvent(harness.deps, {
        threadId: thread.id,
        type: "client/turn/rejected",
        scope: { kind: "thread" },
        data: {
          requestId,
          reason: "provider-error",
          message: "Provider rejected this request",
        },
      });
      expect(run(harness, thread.id, parent.id)).toMatchObject({
        state: "failed",
        failureReason: "Provider rejected this request",
      });
      await expect(
        sendQueuedMessageNow(harness.deps, {
          threadId: thread.id,
          queuedMessageId: child.id,
          mode: "steer",
        }),
      ).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: { waitingOn: { kind: "dependency", status: "failed" } },
      });
      expect(requests(harness, thread.id)).toHaveLength(1);
    });
  });
});
