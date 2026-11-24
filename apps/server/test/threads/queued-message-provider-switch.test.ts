import { randomUUID } from "node:crypto";
import {
  advanceProviderTransition,
  beginProviderTransitionInTransaction,
  claimQueuedThreadMessageGroup,
  commitProviderTransitionInTransaction,
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  getProviderTransition,
  getQueuedThreadMessage,
  getThread,
  listQueuedThreadMessages,
  listRunningThreads,
  releaseQueuedMessageClaim,
  setClaimedQueuedMessageProviderSwitchOperation,
  updateQueuedThreadMessage,
} from "@bb/db";
import { listEvents } from "@bb/db/testing";
import { turnScope } from "@bb/domain";
import type { MessageDispatchHookContext } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
} from "../../src/services/plugins/plugin-hook-registry.js";
import {
  sendNextQueuedMessageIfPresent,
  sendQueuedMessageNow,
} from "../../src/services/threads/queued-messages.js";
import { appendThreadEvent } from "../../src/services/threads/thread-events.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { availableModelFixture } from "../helpers/available-models.js";
import {
  listQueuedCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  registerTestHostRpcCapture,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { seedProviderTransitionInput } from "../helpers/provider-transitions.js";
import { textInput } from "../helpers/prompt-input.js";
import { seedThreadIdentity, seedTurnStarted } from "../helpers/seed.js";
import { moveThreadStatus } from "../helpers/thread-status.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => setPluginHookProvider(undefined));

function installGate(wait: boolean) {
  const seen: MessageDispatchHookContext[] = [];
  setPluginHookProvider({
    listHooks: () => [
      {
        pluginId: "queue-switch-limit",
        handler: (context) => {
          seen.push(context);
          return wait
            ? { action: "wait", reason: "Quota window" }
            : { action: "proceed" };
        },
      },
    ],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return seen;
}

function fixture(harness: TestAppHarness, sendAt: number | null = null) {
  const data = seedProviderTransitionInput(harness);
  seedThreadIdentity(harness.deps, {
    threadId: data.thread.id,
    environmentId: data.environment.id,
    providerThreadId: "queue-source-native",
  });
  registerProviderHostRpcResponder(harness, {
    hostId: data.host.id,
    sessionId: data.session.id,
    restoreCommandCaptureAfterResponse: true,
    modelsByProviderId: {
      "claude-code": {
        models: [
          {
            ...availableModelFixture({
              model: "queued-target-model",
              reasoningLevels: ["medium"],
              isDefault: true,
            }),
            experimental_contextWindowTokens: 16384,
          },
        ],
        selectedOnlyModels: [],
      },
    },
  });
  const queued = createQueuedThreadMessage(harness.db, harness.hub, {
    threadId: data.thread.id,
    providerId: "claude-code",
    providerSessionId: null,
    providerSwitchPolicy: "recent-messages",
    content: textInput("Run this task once"),
    model: "queued-target-model",
    permissionMode: "accept-edits",
    reasoningLevel: "medium",
    serviceTier: "default",
    sendAt,
    waitingOn: sendAt === null ? null : { kind: "time" },
    payload: { kind: "inline" },
    systemNotice: null,
  });
  return { ...data, queued };
}

async function completeSwitch(harness: TestAppHarness) {
  const prepare = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "thread.session.prepare",
  );
  if (prepare.command.type !== "thread.session.prepare")
    throw Error("Missing prepare");
  const target = {
    providerId: prepare.command.providerId,
    providerSessionId: prepare.command.providerSessionId,
    providerThreadId: "queue-target-native",
  };
  await reportQueuedCommandSuccess(harness, prepare, target);
  const adopt = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "thread.session.adopt",
  );
  await reportQueuedCommandSuccess(harness, adopt, target);
  const finalize = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "thread.session.finalize",
  );
  await reportQueuedCommandSuccess(harness, finalize, {});
  return prepare.command.leaseId;
}

function requests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

describe("automatic queued provider transitions", () => {
  it("recovers a persisted committed operation before consuming its reclaimed task", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queued, input, host, session } = fixture(harness);
      const operationId = randomUUID();
      const claim = claimQueuedThreadMessageGroup(
        harness.db,
        harness.hub,
        queued.id,
        { kind: "explicit-send" },
      );
      if (claim === null) throw Error("Missing abandoned claim");
      expect(
        setClaimedQueuedMessageProviderSwitchOperation(harness.db, {
          claimed: claim,
          expectedOperationId: null,
          operationId,
        }),
      ).toBe(true);
      const created = harness.db.transaction((tx) =>
        beginProviderTransitionInTransaction(tx, {
          ...input,
          id: operationId,
          targetProviderSessionId: `ps_${operationId}`,
          sourceProviderThreadId: "queue-source-native",
          execution: { ...input.execution, model: queued.model },
        }),
      );
      if (created === null) throw Error("Missing journal entry");
      const prepared = advanceProviderTransition(harness.db, {
        id: operationId,
        expectedRevision: created.revision,
        expectedPhase: "preparing",
        phase: "prepared",
        targetProviderThreadId: "queue-target-native",
        errorCode: null,
        now: Date.now(),
      });
      if (prepared === null) throw Error("Missing prepared journal");
      const adopting = advanceProviderTransition(harness.db, {
        id: operationId,
        expectedRevision: prepared.revision,
        expectedPhase: "prepared",
        phase: "adopting",
        targetProviderThreadId: "queue-target-native",
        errorCode: null,
        now: Date.now(),
      });
      if (adopting === null) throw Error("Missing adopted journal");
      expect(
        harness.db.transaction((tx) =>
          commitProviderTransitionInTransaction(tx, {
            id: operationId,
            expectedRevision: adopting.revision,
            now: Date.now(),
          }),
        )?.phase,
      ).toBe("committed");
      releaseQueuedMessageClaim(harness.db, harness.hub, {
        id: queued.id,
        claimToken: claim[0]!.claimToken,
      });
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const sending = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      void sending.catch(() => undefined);
      const finalize = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.finalize",
      );
      expect(finalize.command).toMatchObject({ leaseId: operationId });
      expect(listQueuedCommands(harness, "thread.session.prepare")).toEqual([]);
      expect(requests(harness, thread.id)).toEqual([]);
      await reportQueuedCommandSuccess(harness, finalize, {});
      expect(await sending).toBe(true);
      expect(getProviderTransition(harness.db, operationId)?.phase).toBe(
        "completed",
      );
      expect(getQueuedThreadMessage(harness.db, queued.id)).toBeNull();
      expect(requests(harness, thread.id)).toHaveLength(1);
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(false);
    });
  });
  it("keeps the admission lock through preparation so a second task observes the running limit", async () => {
    await withTestHarness(async (harness) => {
      const first = fixture(harness);
      const second = fixture(harness);
      setPluginHookProvider({
        listHooks: () => [
          {
            pluginId: "queue-switch-limit",
            handler: () =>
              listRunningThreads(harness.db).length === 0
                ? { action: "proceed" }
                : { action: "wait", reason: "One running thread" },
          },
        ],
        invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
        decisionTimeoutMs: 10_000,
      });
      const firstSend = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: first.thread.id,
      });
      void firstSend.catch(() => undefined);
      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.session.prepare" &&
          command.threadId === first.thread.id,
      );
      const secondSend = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: second.thread.id,
      });
      void secondSend.catch(() => undefined);
      await completeSwitch(harness);
      await firstSend;
      await vi.waitFor(() => {
        expect(
          getQueuedThreadMessage(harness.db, second.queued.id)?.state !==
            "claimed" ||
            listQueuedCommands(harness, "thread.session.prepare").length > 0,
        ).toBe(true);
      });
      if (listQueuedCommands(harness, "thread.session.prepare").length > 0)
        await completeSwitch(harness);
      await secondSend;
      expect(requests(harness, first.thread.id)).toHaveLength(1);
      expect(requests(harness, second.thread.id)).toEqual([]);
      expect(
        getQueuedThreadMessage(harness.db, second.queued.id),
      ).toMatchObject({
        providerSwitchOperationId: null,
        waitingOn: JSON.stringify({
          kind: "plugin",
          pluginId: "queue-switch-limit",
          reason: "One running thread",
        }),
      });
      expect(getThread(harness.db, second.thread.id)?.providerId).toBe("codex");
    });
  });
  it("starts a pending task on its already assigned provider without attempting a transition", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread: existing } = seedProviderTransitionInput(harness);
      const created = await createThreadFromRequest(harness.deps, {
        projectId: existing.projectId,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "unmanaged",
            path: "/tmp/queued-switch-cold-start",
          },
        },
        providerId: "codex",
        model: "test-provider-default",
        permissionMode: "full",
        input: textInput("First task with automatic switching enabled"),
        sendAt: Date.now() + 60_000,
        origin: "app",
        startedOnBehalfOf: null,
      });
      const row = listQueuedThreadMessages(harness.db, created.id)[0];
      if (row === undefined) throw Error("Missing pending task");
      const saved = updateQueuedThreadMessage(harness.db, harness.hub, {
        id: row.id,
        threadId: created.id,
        expectedUpdatedAt: row.updatedAt,
        execution: {
          providerId: row.providerId,
          providerSessionId: row.providerSessionId,
          providerSwitchPolicy: "recent-messages",
          model: row.model,
          permissionMode: row.permissionMode,
          reasoningLevel: row.reasoningLevel,
          serviceTier: row.serviceTier,
        },
        content: null,
        reschedule: null,
      });
      expect(saved.kind).toBe("updated");
      expect(
        await sendQueuedMessageNow(harness.deps, {
          threadId: created.id,
          queuedMessageId: row.id,
          mode: "auto",
        }),
      ).toEqual({ delivery: "sent" });
      expect(getQueuedThreadMessage(harness.db, row.id)).toBeNull();
      expect(getThread(harness.db, created.id)?.providerId).toBe("codex");
      expect(listQueuedCommands(harness, "thread.session.prepare")).toEqual([]);
    });
  });
  it("uses execution-time history after one target admission and consumes the task once", async () => {
    await withTestHarness(async (harness) => {
      const { thread, environment, queued } = fixture(harness);
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "queue-source-native",
        turnId: "previous-queue-turn",
      });
      appendThreadEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "queue-source-native",
        type: "item/completed",
        scope: turnScope("previous-queue-turn"),
        data: {
          providerThreadId: "queue-source-native",
          item: {
            type: "agentMessage",
            id: "latest-result",
            text: "Result produced after the task was queued",
          },
        },
      });
      const seen = installGate(false);
      appendThreadEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "queue-source-native",
        type: "turn/completed",
        scope: turnScope("previous-queue-turn"),
        data: { providerThreadId: "queue-source-native", status: "completed" },
      });
      const sending = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      void sending.catch(() => undefined);
      const prepare = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.prepare",
      );
      if (prepare.command.type !== "thread.session.prepare")
        throw Error("Missing prepare");
      const operationId = getQueuedThreadMessage(
        harness.db,
        queued.id,
      )?.providerSwitchOperationId;
      expect(operationId).toBe(prepare.command.leaseId);
      expect(
        getProviderTransition(harness.db, prepare.command.leaseId),
      ).toMatchObject({ contextTokenBudget: 4096, phase: "preparing" });
      expect(
        getProviderTransition(harness.db, prepare.command.leaseId)?.contextText,
      ).toContain("Result produced after the task was queued");
      expect(requests(harness, thread.id)).toEqual([]);
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(false);
      await completeSwitch(harness);
      expect(await sending).toBe(true);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        id: thread.id,
        environmentId: environment.id,
        providerId: "claude-code",
        providerSessionId: `ps_${operationId}`,
      });
      expect(getQueuedThreadMessage(harness.db, queued.id)).toBeNull();
      expect(requests(harness, thread.id)).toHaveLength(1);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        thread: { providerId: "codex" },
        requestedExecution: {
          providerId: "claude-code",
          model: "queued-target-model",
        },
      });
      const submit = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "turn.submit",
      );
      expect(submit.command).toMatchObject({
        resumeContext: { providerId: "claude-code" },
      });
      if (submit.command.type !== "turn.submit")
        throw Error("Missing task submission");
      expect(
        submit.command.input.filter(
          (block) => block.type !== "text" || block.visibility !== "agent-only",
        ),
      ).toEqual(textInput("Run this task once"));
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(false);
      expect(requests(harness, thread.id)).toHaveLength(1);
    });
  });

  it.each(["plugin", "time", "active", "offline"] as const)(
    "keeps context and the task on the current provider while waiting for %s",
    async (wait) => {
      await withTestHarness(async (harness) => {
        const { thread, environment, session, queued } = fixture(
          harness,
          wait === "time" ? Date.now() + 60_000 : null,
        );
        const seen = installGate(wait === "plugin");
        if (wait === "active") {
          moveThreadStatus(harness.deps, {
            move: "run.started",
            threadId: thread.id,
          });
          seedTurnStarted(harness.deps, {
            threadId: thread.id,
            environmentId: environment.id,
            providerThreadId: "queue-source-native",
            turnId: "running-source-turn",
          });
        }
        if (wait === "offline") harness.hub.unregisterDaemon(session.id);
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        });
        expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
        expect(getQueuedThreadMessage(harness.db, queued.id)).toMatchObject({
          providerSwitchPolicy: "recent-messages",
          providerSwitchOperationId: null,
          failureReason: null,
        });
        expect(listQueuedCommands(harness, "thread.session.prepare")).toEqual(
          [],
        );
        expect(requests(harness, thread.id)).toEqual([]);
        if (wait !== "time")
          expect(seen[0]?.requestedExecution.providerId).toBe("claude-code");
      });
    },
  );

  it("never steers a different provider even with automatic switching enabled", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queued } = fixture(harness);
      await expect(
        sendQueuedMessageNow(harness.deps, {
          threadId: thread.id,
          queuedMessageId: queued.id,
          mode: "steer",
        }),
      ).rejects.toMatchObject({
        body: { code: "queued_message_provider_changed" },
      });
      expect(
        getQueuedThreadMessage(harness.db, queued.id)
          ?.providerSwitchOperationId,
      ).toBeNull();
      expect(requests(harness, thread.id)).toEqual([]);
    });
  });

  it("retains a failed preparation and starts a new operation only after confirmed rollback", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queued } = fixture(harness);
      const sending = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      void sending.catch(() => undefined);
      const prepare = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.prepare",
      );
      if (prepare.command.type !== "thread.session.prepare")
        throw Error("Missing prepare");
      await reportQueuedCommandError(harness, prepare, {
        errorCode: "provider_unavailable",
        errorMessage: "Target is temporarily unavailable",
      });
      const discard = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.discard",
      );
      await reportQueuedCommandSuccess(harness, discard, {});
      await expect(sending).rejects.toMatchObject({
        body: { code: "queued_provider_switch_incomplete" },
      });
      expect(
        getProviderTransition(harness.db, prepare.command.leaseId)?.phase,
      ).toBe("rolled_back");
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      expect(
        getQueuedThreadMessage(harness.db, queued.id)
          ?.providerSwitchOperationId,
      ).toBe(prepare.command.leaseId);
      expect(requests(harness, thread.id)).toEqual([]);
      const retried = sendQueuedMessageNow(harness.deps, {
        threadId: thread.id,
        queuedMessageId: queued.id,
        mode: "auto",
      });
      void retried.catch(() => undefined);
      const nextId = await completeSwitch(harness);
      expect(nextId).not.toBe(prepare.command.leaseId);
      expect(await retried).toEqual({ delivery: "sent" });
      expect(requests(harness, thread.id)).toHaveLength(1);
    });
  });

  it("does not send a task deleted while its session is being prepared", async () => {
    await withTestHarness(async (harness) => {
      const { thread, queued } = fixture(harness);
      const sending = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      void sending.catch(() => undefined);
      await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.session.prepare",
      );
      expect(
        deleteQueuedThreadMessage(harness.db, harness.hub, queued.id),
      ).toBe(true);
      await completeSwitch(harness);
      await sending;
      expect(requests(harness, thread.id)).toEqual([]);
      expect(listQueuedCommands(harness, "turn.submit")).toEqual([]);
    });
  });
});
