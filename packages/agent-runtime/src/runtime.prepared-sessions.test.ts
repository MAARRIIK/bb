import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSessionSource, ThreadEvent } from "@bb/domain";
import { providerSessionSourceSchema } from "@bb/domain";
import {
  createScriptedEchoLaunch,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

let workspacePath: string;
beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), "bb-prepared-session-"));
});
afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true });
});

function fixture() {
  const events: ThreadEvent[] = [];
  const emissions: { event: ThreadEvent; source: ProviderSessionSource }[] = [];
  const calls: { threadId: string; source: ProviderSessionSource }[] = [];
  const record = createScriptedEchoRequestRecord();
  const runtime = createScriptedEchoRuntime({
    runtime: {
      workspacePath,
      env: record.env,
      onEvent: (event, source) => {
        events.push(event);
        emissions.push({ event, source });
      },
      onToolCall: async (request, _signal, source) => {
        calls.push({ threadId: request.threadId, source });
        return {
          success: true,
          contentItems: [{ type: "inputText", text: "completed" }],
        };
      },
    },
    launch: { scripted: { sessionRestorable: true } },
  });
  const original = { providerId: "fake", providerSessionId: null };
  const tools = [
    {
      name: "probe",
      description: "Read a fixture value",
      inputSchema: { type: "object" },
    },
  ];
  const start = () =>
    runtime.startThread({
      environmentId: "env",
      projectId: "project",
      threadId: "t1",
      ...original,
      options: fullRuntimeOptions,
      dynamicTools: tools,
    });
  const prepare = {
    environmentId: "env",
    projectId: "project",
    threadId: "t1",
    providerId: "replacement",
    providerSessionId: "replacement-generation",
    leaseId: "lease",
    expectedSource: original,
    options: fullRuntimeOptions,
    dynamicTools: tools,
  };
  const turn = (threadId = "t1", text = "call_tool:probe") =>
    runtime.runTurn({
      threadId,
      clientRequestId: "creq_222222223a",
      input: [promptTextInput({ text })],
      options: fullRuntimeOptions,
    });
  const completed = (threadId = "t1") =>
    waitForThreadTurnCompleted({ events, runtime, threadId });
  return {
    runtime,
    events,
    emissions,
    calls,
    record,
    original,
    start,
    prepare,
    turn,
    completed,
  };
}

describe("prepared provider sessions", () => {
  it("prepares without exposing a new session, then finalizes one owner and routes tools to the stable BB thread", async () => {
    const ctx = fixture();
    const { runtime } = ctx;
    try {
      const first = await ctx.start();
      await runtime.startThread({
        environmentId: "env",
        projectId: "project",
        threadId: "unrelated",
        providerId: "fake",
        options: fullRuntimeOptions,
      });
      const count = ctx.events.length;
      const args = {
        ...ctx.prepare,
        bridgeLaunch: createScriptedEchoLaunch({
          scripted: {
            toolCallThreadIdHint: "t1:prepare:lease",
            initialSessionState: true,
          },
        }),
      };
      const [target, duplicate] = await Promise.all([
        runtime.prepareProviderSession(args),
        runtime.prepareProviderSession(structuredClone(args)),
      ]);
      expect(duplicate).toEqual(target);
      expect(runtime.getProviderSession("t1")).toEqual({
        ...ctx.original,
        ...first,
      });
      expect(ctx.events).toHaveLength(count);
      expect(ctx.record.last("thread/start")?.params).toMatchObject({
        threadId: "t1:prepare:lease",
        options: { envVars: { BB_THREAD_ID: "t1" } },
      });
      const command = { leaseId: "lease", threadId: "t1", target };
      await expect(
        runtime.adoptProviderSession({
          ...command,
          target: { ...target, providerThreadId: "foreign" },
        }),
      ).rejects.toThrow("does not match");
      await runtime.adoptProviderSession(command);
      await runtime.adoptProviderSession(command);
      await expect(ctx.turn()).rejects.toThrow("not been finalized");
      await expect(
        runtime.discardPreparedProviderSession(command),
      ).rejects.toThrow("explicit rollback");
      await runtime.finalizeProviderSession(command);
      expect(
        ctx.events.filter(
          (event) =>
            event.type === "thread/extensionState/updated" &&
            event.kind === "echo/session",
        ),
      ).toEqual([
        expect.objectContaining({
          threadId: "t1",
          providerThreadId: target.providerThreadId,
          payload: { ready: true },
        }),
      ]);
      await runtime.finalizeProviderSession(command);
      const identities = ctx.emissions.filter(
        ({ event, source }) =>
          event.type === "thread/identity" &&
          event.providerThreadId === target.providerThreadId &&
          source.providerId === target.providerId &&
          source.providerSessionId === target.providerSessionId,
      );
      expect(identities).toHaveLength(1);
      expect(providerSessionSourceSchema.parse(identities[0]?.source)).toEqual({
        providerId: target.providerId,
        providerSessionId: target.providerSessionId,
      });
      await runtime.discardPreparedProviderSession(command);
      await runtime.adoptProviderSession(command);
      await expect(
        runtime.rollbackProviderSession({
          ...command,
          restoreSource: ctx.original,
        }),
      ).rejects.toThrow("cannot be rolled back");
      await ctx.turn();
      await ctx.completed();
      expect(ctx.calls).toEqual([
        {
          threadId: "t1",
          source: {
            providerId: "replacement",
            providerSessionId: "replacement-generation",
          },
        },
      ]);
      await ctx.turn("unrelated", "The unrelated thread still works");
      await ctx.completed("unrelated");
      expect(
        ctx.events.every(
          (event) => event.threadId === "t1" || event.threadId === "unrelated",
        ),
      ).toBe(true);
      expect(runtime.getProviderSession("t1")).toEqual(target);
    } finally {
      await runtime.shutdown();
    }
  });

  it.each(["discard", "failure"] as const)(
    "keeps the old session usable after target %s",
    async (mode) => {
      const ctx = fixture();
      try {
        const first = await ctx.start();
        if (mode === "failure") {
          await expect(
            ctx.runtime.prepareProviderSession({
              ...ctx.prepare,
              bridgeLaunch: createScriptedEchoLaunch({
                scripted: {
                  failMethods: [
                    { method: "thread/start", message: "target unavailable" },
                  ],
                },
              }),
            }),
          ).rejects.toThrow("target unavailable");
        } else {
          await ctx.runtime.prepareProviderSession(ctx.prepare);
          await ctx.runtime.discardPreparedProviderSession({
            leaseId: "lease",
            threadId: "t1",
          });
        }
        expect(ctx.runtime.getProviderSession("t1")).toEqual({
          ...ctx.original,
          ...first,
        });
        await ctx.turn();
        await ctx.completed();
        expect(ctx.calls).toEqual([{ threadId: "t1", source: ctx.original }]);
      } finally {
        await ctx.runtime.shutdown();
      }
    },
  );

  it("restores the original session on rollback and makes a repeated rollback harmless", async () => {
    const ctx = fixture();
    try {
      const first = await ctx.start();
      const target = await ctx.runtime.prepareProviderSession(ctx.prepare);
      const args = {
        leaseId: "lease",
        threadId: "t1",
        target,
        restoreSource: ctx.original,
      };
      await ctx.runtime.adoptProviderSession(args);
      expect(await ctx.runtime.rollbackProviderSession(args)).toEqual({
        ...ctx.original,
        ...first,
      });
      expect(await ctx.runtime.rollbackProviderSession(args)).toEqual({
        ...ctx.original,
        ...first,
      });
      await ctx.turn();
      await ctx.completed();
      expect(ctx.calls).toEqual([{ threadId: "t1", source: ctx.original }]);
    } finally {
      await ctx.runtime.shutdown();
    }
  });

  it.each(["prepared", "adopted"] as const)(
    "restores the original owner when the %s target process exits",
    async (phase) => {
      const ctx = fixture();
      try {
        const first = await ctx.start();
        const target = await ctx.runtime.prepareProviderSession({
          ...ctx.prepare,
          bridgeLaunch: createScriptedEchoLaunch({
            scripted: { identifyProcess: true },
          }),
        });
        const command = {
          leaseId: "lease",
          threadId: "t1",
          target,
          restoreSource: ctx.original,
        };
        if (phase === "adopted")
          await ctx.runtime.adoptProviderSession(command);
        const match = /^prov-(\d+)-/u.exec(target.providerThreadId);
        if (!match)
          throw new Error("Prepared bridge did not identify its process");
        process.kill(Number(match[1]), "SIGTERM");
        await vi.waitFor(() =>
          expect(
            ctx.runtime.hasThread(
              phase === "adopted" ? "t1" : "t1:prepare:lease",
            ),
          ).toBe(false),
        );
        expect(await ctx.runtime.rollbackProviderSession(command)).toEqual({
          ...ctx.original,
          ...first,
        });
        await ctx.turn();
        await ctx.completed();
        expect(ctx.calls).toEqual([{ threadId: "t1", source: ctx.original }]);
        expect(ctx.events.every((event) => event.threadId === "t1")).toBe(true);
      } finally {
        await ctx.runtime.shutdown();
      }
    },
  );

  it.each(["hold_turn", "bg_task"] as const)(
    "rejects adoption while the original agent starts %s after preparation",
    async (work) => {
      const ctx = fixture();
      try {
        const first = await ctx.start();
        const target = await ctx.runtime.prepareProviderSession(ctx.prepare);
        await ctx.turn("t1", work);
        await waitForThreadTurnStarted({
          events: ctx.events,
          runtime: ctx.runtime,
          threadId: "t1",
        });
        if (work === "bg_task") await ctx.completed();
        await expect(
          ctx.runtime.adoptProviderSession({
            leaseId: "lease",
            threadId: "t1",
            target,
          }),
        ).rejects.toThrow("active work");
        await ctx.runtime.discardPreparedProviderSession({
          leaseId: "lease",
          threadId: "t1",
        });
        expect(ctx.runtime.getProviderSession("t1")).toEqual({
          ...ctx.original,
          ...first,
        });
        if (work === "hold_turn")
          expect(ctx.runtime.getActiveTurnId("t1")).not.toBeNull();
        else {
          expect(ctx.runtime.getActiveTurnId("t1")).toBeNull();
          expect(ctx.runtime.hasOpenBackgroundWork()).toBe(true);
        }
      } finally {
        await ctx.runtime.shutdown();
      }
    },
  );

  it("pins both sides against idle reaping and releases the pin when preparation is discarded", async () => {
    const ctx = fixture();
    try {
      await ctx.start();
      await ctx.runtime.prepareProviderSession(ctx.prepare);
      const reap = () =>
        ctx.runtime.reapIdleProviderSessions({
          idleForMs: 0,
          nowMs: Date.now() + 60_000,
        });
      expect(await reap()).toEqual({ reapedSessions: [] });
      await ctx.runtime.discardPreparedProviderSession({
        leaseId: "lease",
        threadId: "t1",
      });
      expect(
        (await reap()).reapedSessions.map((session) => session.threadId),
      ).toEqual(["t1"]);
    } finally {
      await ctx.runtime.shutdown();
    }
  });
});
