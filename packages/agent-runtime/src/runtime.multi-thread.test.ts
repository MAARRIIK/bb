import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSessionSource, ThreadEvent } from "@bb/domain";
import { createAgentRuntime } from "./runtime.js";
import type { AgentRuntime } from "./types.js";
import {
  createScriptedEchoLaunch,
  createScriptedEchoProcessLog,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

interface WaitForBothThreadsStartedArgs {
  events: ThreadEvent[];
  firstThreadId: string;
  providerId: string;
  runtime: AgentRuntime;
  secondThreadId: string;
}

function hasThreadTurnStarted(
  events: ThreadEvent[],
  threadId: string,
): boolean {
  return events.some(
    (event) => event.type === "turn/started" && event.threadId === threadId,
  );
}

async function waitForBothThreadsStarted(
  args: WaitForBothThreadsStartedArgs,
): Promise<void> {
  await waitForRuntimeState({
    events: args.events,
    label: `turn/started for ${args.firstThreadId} and ${args.secondThreadId}`,
    predicate: () =>
      hasThreadTurnStarted(args.events, args.firstThreadId) &&
      hasThreadTurnStarted(args.events, args.secondThreadId),
    providerId: args.providerId,
    runtime: args.runtime,
  });
}

describe("createAgentRuntime multi-thread routing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32").each(["stop", "archive"] as const)(
    "retains the new session when the old %s response arrives after replacement",
    async (action) => {
      const events: ThreadEvent[] = [];
      const processLog = createScriptedEchoProcessLog();
      const runtime = createScriptedEchoRuntime({
        runtime: {
          workspacePath: tmpDir,
          env: processLog.env,
          onEvent: (event) => events.push(event),
        },
      });
      let pausedPid: number | null = null;
      let pending: Promise<unknown> | undefined;
      try {
        const first = await runtime.startThread({
          environmentId: "env-1",
          threadId: "t1",
          projectId: "p1",
          providerId: "fake",
          providerSessionId: "first-generation",
          options: fullRuntimeOptions,
        });
        const pid = Number(
          processLog
            .read()
            .find((line) => line.startsWith("spawn:"))
            ?.slice(6),
        );
        if (!Number.isSafeInteger(pid) || pid <= 0)
          throw new Error("Missing test bridge process");
        process.kill(pid, "SIGSTOP");
        pausedPid = pid;
        pending =
          action === "stop"
            ? runtime.stopThread({ threadId: "t1" })
            : runtime.archiveThread({
                threadId: "t1",
                providerId: "fake",
                providerThreadId: first.providerThreadId,
              });
        await runtime.startThread({
          environmentId: "env-1",
          threadId: "t1",
          projectId: "p1",
          providerId: "fake",
          providerSessionId: "second-generation",
          options: fullRuntimeOptions,
        });
        process.kill(pid, "SIGCONT");
        pausedPid = null;
        await pending;
        expect(runtime.getProviderSession("t1")?.providerSessionId).toBe(
          "second-generation",
        );
        await runtime.runTurn({
          threadId: "t1",
          clientRequestId: "creq_2222222223",
          input: [promptTextInput({ text: "Continue the current session" })],
          options: fullRuntimeOptions,
        });
        await waitForThreadTurnCompleted({
          events,
          providerId: "fake",
          runtime,
          threadId: "t1",
        });
      } finally {
        if (pausedPid !== null) process.kill(pausedPid, "SIGCONT");
        await pending?.catch(() => undefined);
        await runtime.shutdown();
      }
    },
  );

  it("keeps successive generations of the same thread isolated in their originating processes", async () => {
    const received: { event: ThreadEvent; source: ProviderSessionSource }[] =
      [];
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event, source) => {
          received.push({ event, source });
          events.push(event);
        },
      },
    });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        providerSessionId: "first-generation",
        options: fullRuntimeOptions,
      });
      expect(received.length).toBeGreaterThan(0);
      expect(
        received.every(
          ({ source }) => source.providerSessionId === "first-generation",
        ),
      ).toBe(true);
      received.splice(0);
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        providerSessionId: "second-generation",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        threadId: "t1",
        clientRequestId: "creq_2222222222",
        input: [promptTextInput({ text: "Reply with current generation" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      });
      expect(
        received.some(({ event }) => event.type === "turn/completed"),
      ).toBe(true);
      expect(
        received.every(
          ({ source }) =>
            source.providerId === "fake" &&
            source.providerSessionId === "second-generation",
        ),
      ).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });

  it("handles multiple threads on the same provider", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath: tmpDir, onEvent: (e) => events.push(e) },
    });

    const r1 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    const r2 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    expect(runtime.listRunningProviders()).toEqual(["fake"]);
    expect(r1.providerThreadId).not.toBe(r2.providerThreadId);

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222b",
        threadId: "t1",
        input: [promptTextInput({ text: "thread 1" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222c",
        threadId: "t2",
        input: [promptTextInput({ text: "thread 2" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await Promise.all([
      waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t1",
      }),
      waitForThreadTurnCompleted({
        events,
        providerId: "fake",
        runtime,
        threadId: "t2",
      }),
    ]);

    const completedFor = (threadId: string) =>
      events.filter(
        (e) => e.type === "turn/completed" && e.threadId === threadId,
      );
    expect(completedFor("t1")).toHaveLength(1);
    expect(completedFor("t2")).toHaveLength(1);
    const providerThreadIdsByThreadId = new Map([
      ["t1", r1.providerThreadId],
      ["t2", r2.providerThreadId],
    ]);
    for (const e of events) {
      expect(providerThreadIdsByThreadId.has(e.threadId)).toBe(true);
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(
          providerThreadIdsByThreadId.get(e.threadId),
        );
      }
    }
    await waitForThreadAgentMessageText({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
      text: "Response to: thread 1",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "fake",
      runtime,
      threadId: "t2",
      text: "Response to: thread 2",
    });
    expect(
      events.some(
        (e) =>
          e.type === "item/completed" &&
          e.threadId === "t1" &&
          e.item.type === "agentMessage" &&
          e.item.text.includes("thread 2"),
      ),
    ).toBe(false);

    await runtime.shutdown();
  });

  it("keeps sibling threads running after stopping one thread", async () => {
    const events: ThreadEvent[] = [];
    const providerId = "keep-provider-fake";
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
      },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId,
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId,
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222d",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:500 thread A should stop" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222e",
        threadId: "t2",
        input: [promptTextInput({ text: "delay:500 thread B should survive" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await waitForBothThreadsStarted({
      events,
      firstThreadId: "t1",
      providerId,
      runtime,
      secondThreadId: "t2",
    });

    await runtime.stopThread({ threadId: "t1" });
    expect(runtime.listRunningProviders()).toEqual([providerId]);
    expect(
      events.some(
        (e) =>
          e.type === "turn/completed" &&
          e.threadId === "t1" &&
          e.status === "interrupted",
      ),
    ).toBe(true);

    await waitForThreadAgentMessageText({
      events,
      providerId,
      runtime,
      threadId: "t2",
      text: "thread B should survive",
    });

    await runtime.runTurn({
      clientRequestId: "creq_222222222f",
      threadId: "t2",
      input: [promptTextInput({ text: "thread B still accepts turns" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId,
      runtime,
      threadId: "t2",
      text: "thread B still accepts turns",
    });

    await runtime.shutdown();
  });

  it("handles multiple providers in a single runtime", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
    });
    const launchA = createScriptedEchoLaunch({
      pluginId: "provider-a",
      digest: "provider-a",
    });
    const launchB = createScriptedEchoLaunch({
      pluginId: "provider-b",
      digest: "provider-b",
    });

    await runtime.startThread({
      bridgeLaunch: launchA,
      additionalWorkspaceWriteRoots: [],
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "provider-a",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      bridgeLaunch: launchB,
      additionalWorkspaceWriteRoots: [],
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "provider-b",
      options: fullRuntimeOptions,
    });
    expect(runtime.listRunningProviders().sort()).toEqual([
      "provider-a",
      "provider-b",
    ]);

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222222m",
        threadId: "t1",
        input: [promptTextInput({ text: "from a" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222222n",
        threadId: "t2",
        input: [promptTextInput({ text: "from b" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await Promise.all([
      waitForThreadTurnCompleted({
        events,
        providerId: "provider-a",
        runtime,
        threadId: "t1",
      }),
      waitForThreadTurnCompleted({
        events,
        providerId: "provider-b",
        runtime,
        threadId: "t2",
      }),
    ]);

    const completedEvents = events.filter((e) => e.type === "turn/completed");
    expect(completedEvents.length).toBe(2);

    await runtime.shutdown();
  });
});
