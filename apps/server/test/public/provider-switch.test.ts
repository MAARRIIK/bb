import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { createBbSdk, type ExperimentalProviderSwitchArea } from "@bb/sdk/core";
import { BbHttpError, createHttpTransport } from "@bb/sdk/node";
import {
  getActiveProviderTransition,
  getProviderTransition,
  getThread,
  updateHost,
} from "@bb/db";
import {
  threadScope,
  turnScope,
  THREAD_CONTEXT_CLEAR_OPERATION,
} from "@bb/domain";
import {
  apiErrorSchema,
  providerSwitchPreviewSchema,
  providerSwitchReceiptSchema,
  type ProviderSwitchPreviewRequest,
} from "@bb/server-contract";
import {
  appendClientTurnEvent,
  appendThreadEvent,
} from "../../src/services/threads/thread-events.js";
import {
  previewProviderSwitch,
  commitProviderSwitch,
  getProviderSwitch,
  recoverProviderSwitch,
} from "../../src/services/threads/provider-switch.js";
import { seedProviderTransitionInput } from "../helpers/provider-transitions.js";
import {
  seedThread,
  seedThreadIdentity,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { availableModelFixture } from "../helpers/available-models.js";

const REQUEST: ProviderSwitchPreviewRequest = {
  providerId: "claude-code",
  model: "test-provider-default",
  permissionMode: "accept-edits",
  reasoningLevel: null,
  serviceTier: "default",
  context: { mode: "recent-messages" },
  contextTokenBudget: 8192,
  contextWindowTokens: null,
};

async function readResponse<T>(
  schema: z.ZodType<T>,
  response: Response | Promise<Response>,
): Promise<T> {
  const resolved = await response;
  const body: unknown = await resolved.json();
  if (!resolved.ok) {
    const error = apiErrorSchema.parse(body);
    throw new BbHttpError({
      body: error,
      status: resolved.status,
      code: error.code,
      message: error.message,
    });
  }
  return schema.parse(body);
}

function client(
  harness: TestAppHarness,
  surface: "service" | "http" | "sdk",
): ExperimentalProviderSwitchArea {
  if (surface === "sdk")
    return createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://localhost",
        runtime: "node",
        fetch: async (input, init) =>
          harness.app.fetch(new Request(input, init)),
      }),
    }).threads.experimental_providerSwitch;
  if (surface === "service")
    return {
      preview: ({ threadId, signal: _signal, ...request }) =>
        previewProviderSwitch(harness.deps, { threadId, request }),
      commit: ({ threadId, signal: _signal, ...request }) =>
        commitProviderSwitch(harness.deps, { threadId, request }),
      get: async ({ threadId, operationId }) =>
        getProviderSwitch(harness.deps, { threadId, operationId }),
      recover: ({ threadId, operationId }) =>
        recoverProviderSwitch(harness.deps, { threadId, operationId }),
    };
  const post = (threadId: string, suffix: string, json: object) =>
    harness.app.request(
      `/api/v1/threads/${threadId}/provider-switch${suffix}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      },
    );
  return {
    preview: ({ threadId, signal: _signal, ...request }) =>
      readResponse(
        providerSwitchPreviewSchema,
        post(threadId, "/preview", request),
      ),
    commit: ({ threadId, signal: _signal, ...request }) =>
      readResponse(providerSwitchReceiptSchema, post(threadId, "", request)),
    get: ({ threadId, operationId }) =>
      readResponse(
        providerSwitchReceiptSchema,
        harness.app.request(
          `/api/v1/threads/${threadId}/provider-switch?operationId=${operationId}`,
        ),
      ),
    recover: ({ threadId, operationId }) =>
      readResponse(
        providerSwitchReceiptSchema,
        post(threadId, "/recover", { operationId }),
      ),
  };
}

function fixture(harness: TestAppHarness) {
  const data = seedProviderTransitionInput(harness);
  const { thread, environment } = data;
  seedThreadIdentity(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "source-native",
  });
  appendClientTurnEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    type: "client/turn/requested",
    originPluginId: null,
    input: [
      {
        type: "text",
        text: "Задача пользователя. API_KEY=transfer-private-canary",
        mentions: [],
      },
      {
        type: "text",
        text: "hidden-agent-only-canary",
        mentions: [],
        visibility: "agent-only",
      },
    ],
    target: { kind: "new-turn" },
    execution: {
      model: "gpt-5",
      permissionMode: "accept-edits",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    initiator: "user",
    senderThreadId: null,
    requestMethod: "turn/start",
    source: "tell",
  });
  seedTurnStarted(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "source-native",
    turnId: "old-turn",
  });
  for (const item of [
    { type: "agentMessage" as const, id: "visible", text: "Результат агента" },
    {
      type: "agentMessage" as const,
      id: "child",
      text: "child-output-canary",
      parentToolCallId: "parent-tool",
    },
    {
      type: "reasoning" as const,
      id: "private-reasoning",
      summary: ["reasoning-canary"],
      content: ["reasoning-content-canary"],
    },
    {
      type: "toolCall" as const,
      id: "private-tool",
      tool: "read_file",
      status: "completed" as const,
      result: "tool-output-canary",
    },
  ])
    appendThreadEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "source-native",
      type: "item/completed",
      scope: turnScope("old-turn"),
      data: { providerThreadId: "source-native", item },
    });
  appendThreadEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "source-native",
    type: "turn/completed",
    scope: turnScope("old-turn"),
    data: { providerThreadId: "source-native", status: "completed" },
  });
  return data;
}

async function confirmSwitch(harness: TestAppHarness) {
  const prepare = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "thread.session.prepare",
  );
  if (prepare.command.type !== "thread.session.prepare")
    throw new Error("Missing preparation command");
  const target = {
    providerId: prepare.command.providerId,
    providerSessionId: prepare.command.providerSessionId,
    providerThreadId: "prepared-native",
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
}

describe.each(["service", "http", "sdk"] as const)(
  "provider switch through %s",
  (surface) => {
    it("retains declared model capacity through the catalog and caps the packet reserve", async () => {
      await withTestHarness(async (harness) => {
        const { thread, host, session } = fixture(harness);
        registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          restoreCommandCaptureAfterResponse: true,
          modelsByProviderId: {
            "claude-code": {
              models: [
                {
                  ...availableModelFixture({
                    model: "test-provider-default",
                    reasoningLevels: ["medium"],
                    isDefault: true,
                  }),
                  experimental_contextWindowTokens: 32768,
                },
              ],
              selectedOnlyModels: [],
            },
          },
        });
        const api = client(harness, surface);
        const preview = await api.preview({
          threadId: thread.id,
          ...REQUEST,
          contextTokenBudget: 32768,
        });
        expect(preview.context).toMatchObject({
          windowTokens: 32768,
          windowSource: "provider",
          servedWindowVerified: false,
          tokenBudget: 8192,
        });
        await expect(
          api.preview({
            threadId: thread.id,
            ...REQUEST,
            contextWindowTokens: 64000,
          }),
        ).rejects.toMatchObject({ status: 400 });
      });
    });
    it("uses only the supplied summary and masks recognized credentials before transfer", async () => {
      await withTestHarness(async (harness) => {
        const { thread } = fixture(harness);
        const preview = await client(harness, surface).preview({
          threadId: thread.id,
          ...REQUEST,
          context: {
            mode: "summary",
            text: "Keep the selected workspace. TOKEN=summary-env-canary\nAuthorization: Bearer summary-bearer-canary\nsk-summaryCredentialCanary123456\nhttps://person:summary-password-canary@example.test\n-----BEGIN PRIVATE KEY-----\nsummary-private-key-canary\n-----END PRIVATE KEY-----",
          },
        });
        expect(preview.context.text).toContain("Keep the selected workspace");
        expect(preview.context.completeness).toBe("summary");
        for (const excluded of [
          "Задача пользователя",
          "summary-env-canary",
          "summary-bearer-canary",
          "sk-summaryCredentialCanary123456",
          "summary-password-canary",
          "summary-private-key-canary",
        ])
          expect(preview.context.text).not.toContain(excluded);
        await expect(
          client(harness, surface).preview({
            threadId: thread.id,
            ...REQUEST,
            contextTokenBudget: 512,
            context: {
              mode: "summary",
              text: "Very long summary. ".repeat(100),
            },
          }),
        ).rejects.toMatchObject({
          status: 400,
          body: { code: "context_budget_exceeded" },
        });
      });
    });

    it("skips oversized stored events without returning their contents", async () => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = fixture(harness);
        appendThreadEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "source-native",
          type: "item/completed",
          scope: turnScope("old-turn"),
          data: {
            providerThreadId: "source-native",
            item: {
              type: "agentMessage",
              id: "oversized",
              text: "oversized-event-canary" + "x".repeat(70_000),
            },
          },
        });
        const preview = await client(harness, surface).preview({
          threadId: thread.id,
          ...REQUEST,
        });
        expect(preview.context.text).not.toContain("oversized-event-canary");
        expect(preview.context.text).toContain("Результат агента");
        expect(preview.context.omittedOversizedEvents).toBe(1);
        expect(preview.context.hasOlderHistory).toBe(true);
      });
    });
    it("previews visible history without starting a session, then commits and returns the same durable receipt on retry", async () => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = fixture(harness);
        const api = client(harness, surface);
        const preview = await api.preview({ threadId: thread.id, ...REQUEST });
        expect(
          listQueuedCommands(harness, "provider.health").filter(
            (command) =>
              command.type === "provider.health" &&
              command.providerId !== REQUEST.providerId,
          ),
        ).toEqual([]);
        expect(preview.context.text).toContain("Задача пользователя");
        expect(preview.context.text).toContain("Результат агента");
        for (const excluded of [
          "transfer-private-canary",
          "hidden-agent-only-canary",
          "child-output-canary",
          "reasoning-canary",
          "reasoning-content-canary",
          "tool-output-canary",
        ])
          expect(preview.context.text).not.toContain(excluded);
        expect(preview.context.text).toContain("[credential redacted]");
        expect(preview.context).toMatchObject({
          windowTokens: null,
          windowSource: "unknown",
          servedWindowVerified: false,
        });
        expect(preview.execution.reasoningLevel).toBe("medium");
        expect(listQueuedCommands(harness, "thread.session.prepare")).toEqual(
          [],
        );
        expect(getActiveProviderTransition(harness.db, thread.id)).toBeNull();
        const operationId = randomUUID();
        const pending = api.commit({
          threadId: thread.id,
          operationId,
          preview,
        });
        void pending.catch(() => undefined);
        await confirmSwitch(harness);
        const receipt = await pending;
        expect(receipt.phase).toBe("completed");
        expect(getThread(harness.db, thread.id)).toMatchObject({
          id: thread.id,
          environmentId: environment.id,
          providerId: "claude-code",
          providerSessionId: `ps_${operationId}`,
        });
        expect(
          getProviderTransition(harness.db, operationId)?.contextText,
        ).toBe(preview.context.text);
        expect(await api.get({ threadId: thread.id, operationId })).toEqual(
          receipt,
        );
        expect(await api.recover({ threadId: thread.id, operationId })).toEqual(
          receipt,
        );
        expect(
          await api.commit({ threadId: thread.id, operationId, preview }),
        ).toEqual(receipt);
        expect(listQueuedCommands(harness, "turn.submit")).toEqual([]);
        const other = seedThread(harness.deps, {
          projectId: thread.projectId,
          environmentId: environment.id,
          status: "idle",
        });
        await expect(
          api.get({ threadId: other.id, operationId }),
        ).rejects.toMatchObject({ status: 404 });
      });
    });

    it("rejects changed history and edited preview text before a target session is prepared", async () => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = fixture(harness);
        const api = client(harness, surface);
        const preview = await api.preview({ threadId: thread.id, ...REQUEST });
        await expect(
          api.commit({
            threadId: thread.id,
            operationId: randomUUID(),
            preview: {
              ...preview,
              context: { ...preview.context, text: "Edited after review" },
            },
          }),
        ).rejects.toMatchObject({ status: 409 });
        appendThreadEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          type: "system/operation",
          scope: threadScope(),
          data: {
            operation: "workspace-update",
            operationId: "changed",
            status: "completed",
            message: "Workspace changed",
          },
        });
        await expect(
          api.commit({
            threadId: thread.id,
            operationId: randomUUID(),
            preview,
          }),
        ).rejects.toMatchObject({
          status: 409,
          body: { code: "provider_switch_preview_stale" },
        });
        expect(listQueuedCommands(harness, "thread.session.prepare")).toEqual(
          [],
        );
        expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      });
    });

    it("limits a multilingual packet and reserves capacity without claiming a verified serving window", async () => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = fixture(harness);
        appendThreadEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "source-native",
          type: "item/completed",
          scope: turnScope("old-turn"),
          data: {
            providerThreadId: "source-native",
            item: {
              type: "agentMessage",
              id: "long-reply",
              text: "Привет 🌍 ".repeat(1000),
            },
          },
        });
        const preview = await client(harness, surface).preview({
          threadId: thread.id,
          ...REQUEST,
          contextTokenBudget: 512,
          contextWindowTokens: 32768,
        });
        expect(Buffer.byteLength(preview.context.text)).toBeLessThanOrEqual(
          512,
        );
        expect(preview.context.text).not.toContain("\ufffd");
        expect(preview.context).toMatchObject({
          tokenBudget: 512,
          hasOlderHistory: true,
          windowTokens: 32768,
          windowSource: "user",
          servedWindowVerified: false,
        });
      });
    });

    it("honors explicit context clear and rejects permissions above the host ceiling", async () => {
      await withTestHarness(async (harness) => {
        const { thread, environment, host } = fixture(harness);
        appendThreadEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          type: "system/operation",
          scope: threadScope(),
          data: {
            operation: THREAD_CONTEXT_CLEAR_OPERATION,
            operationId: "clear",
            status: "completed",
            message: "Context cleared",
          },
        });
        const api = client(harness, surface);
        const preview = await api.preview({ threadId: thread.id, ...REQUEST });
        expect(preview.context.text).not.toContain("Результат агента");
        expect(preview.context.includedMessages).toBe(0);
        updateHost(harness.db, harness.hub, host.id, {
          maxPermissionMode: "accept-edits",
        });
        await expect(
          api.preview({
            threadId: thread.id,
            ...REQUEST,
            permissionMode: "full",
          }),
        ).rejects.toMatchObject({ status: 409 });
        expect(listQueuedCommands(harness, "thread.session.prepare")).toEqual(
          [],
        );
      });
    });
  },
);
