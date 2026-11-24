import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  executionRequestSchema,
  executionStartSchema,
  executionStatusSchema,
  rpcContract,
} from "./src/contracts.js";
import { createDeepSeekWebService } from "./src/server-service.js";
import {
  EXCHANGE_TOOL,
  EXECUTE_TOOL,
  PROVIDER_ID,
  MODEL_ID,
  exchangeInputSchema,
  executeInputSchema,
  exchangeOutputSchema,
} from "./src/vocabulary.js";

export default function deepSeekWebPlugin(bb: BbPluginApi): void {
  const service = createDeepSeekWebService(bb);
  bb.providers.register({
    id: PROVIDER_ID,
    displayName: "DeepSeek Web (experimental)",
    icon: "Globe",
    strings: {
      signInHint:
        "Connect a dedicated desktop browser tab in DeepSeek Web settings and sign in manually on the website.",
      expiredHint:
        "Inspect the dedicated DeepSeek tab and sign in manually again.",
      installUrl: "https://chat.deepseek.com",
    },
    maintenance: { health: false, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["medium"],
    },
    models: {
      fallback: [
        {
          id: MODEL_ID,
          displayName: "Website selected model",
          description:
            "Uses the model currently selected in the attached website; account access and quota are not verified.",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description:
                "Controlled by the website; BB does not change its reasoning settings.",
            },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    },
    composerActions: [],
  });
  bb.rpc.register(rpcContract, {
    desktops: ({ threadId }) => service.desktops(threadId),
    connect: ({ threadId, instanceId }, ctx) =>
      service.connect(threadId, instanceId, ctx.experimental_signal),
    status: ({ threadId }, ctx) =>
      service.status(threadId, ctx.experimental_signal),
    disconnect: ({ threadId }, ctx) =>
      service.disconnect(threadId, ctx.experimental_signal),
    exchange: ({ threadId, turnKey, text }, ctx) =>
      service.exchange(threadId, turnKey, text, ctx.experimental_signal),
    execute: ({ threadId, turnKey, actions }, ctx) =>
      service.execute(threadId, turnKey, actions, ctx.experimental_signal),
    executionStart: ({ threadId, requestId, turnKey, actions }) =>
      service.executionStart(threadId, requestId, turnKey, actions),
    executionStatus: ({ threadId, requestId }) =>
      service.executionStatus(threadId, requestId),
    executionCancel: ({ threadId, requestId }) =>
      service.executionCancel(threadId, requestId),
  });
  bb.agents.registerTool({
    name: EXCHANGE_TOOL,
    description:
      "Exchange one message with the dedicated DeepSeek website conversation. Never automatically resend an uncertain exchange.",
    parameters: exchangeInputSchema,
    execute: async (input, ctx) =>
      JSON.stringify(
        await bb.sdk.plugins.callRpc({
          pluginId: bb.pluginId,
          method: "exchange",
          input: { threadId: ctx.threadId, ...input },
          outputSchema: exchangeOutputSchema,
          signal: ctx.signal,
        }),
      ),
  });
  bb.agents.registerTool({
    name: EXECUTE_TOOL,
    description:
      "Execute validated DeepSeek workspace actions. Writes and shell commands always require explicit user approval; an uncertain action is never automatically replayed.",
    parameters: executeInputSchema,
    execute: async (input, ctx) => {
      const request = { threadId: ctx.threadId, requestId: randomUUID() };
      let completed = false;
      try {
        let status = await bb.sdk.plugins.callRpc({
          pluginId: bb.pluginId,
          method: "executionStart",
          input: { ...request, ...input },
          outputSchema: executionStatusSchema,
          signal: ctx.signal,
        });
        while (status.state === "running") {
          await delay(500, undefined, { signal: ctx.signal });
          status = await bb.sdk.plugins.callRpc({
            pluginId: bb.pluginId,
            method: "executionStatus",
            input: request,
            outputSchema: executionStatusSchema,
            signal: ctx.signal,
          });
        }
        ctx.signal.throwIfAborted();
        if (status.state !== "completed")
          throw new Error(
            status.state === "failed"
              ? status.error
              : "Workspace execution was cancelled.",
          );
        completed = true;
        return JSON.stringify(status.output);
      } finally {
        if (!completed)
          await bb.sdk.plugins.callRpc({
            pluginId: bb.pluginId,
            method: "executionCancel",
            input: request,
            outputSchema: executionStatusSchema,
            signal: AbortSignal.timeout(10_000),
          });
      }
    },
  });
  bb.agents.configure((ctx) => ({
    tools: ctx.provider.id === PROVIDER_ID ? [EXCHANGE_TOOL, EXECUTE_TOOL] : [],
    skills: [],
  }));
  const threadOption = {
    type: "string",
    description: "DeepSeek Web thread ID; defaults to the invoking thread",
  } as const;
  const requestOption = {
    type: "string",
    required: true,
    description: "Execution request UUID returned by execute",
  } as const;
  const resolveThread = (
    specified: string | undefined,
    invoking: string | null | undefined,
  ) => {
    const threadId = specified ?? invoking;
    if (!threadId)
      throw new Error("Pass --thread with a DeepSeek Web thread ID.");
    return threadId;
  };
  bb.cli.register(
    defineCli({
      name: "deepseek-web",
      summary: "Connect and inspect an experimental DeepSeek website agent",
      commands: {
        desktops: cliCommand({
          summary: "List desktop browsers on the thread's workspace host",
          options: { thread: threadOption },
          async run(input, ctx) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await service.desktops(
                  resolveThread(input.options.thread, ctx.threadId),
                ),
              ),
            };
          },
        }),
        connect: cliCommand({
          summary:
            "Open a dedicated DeepSeek tab and attach browser automation",
          options: {
            thread: threadOption,
            desktop: {
              type: "string",
              required: true,
              description: "Desktop instance ID from desktops",
            },
          },
          async run(input, ctx) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await service.connect(
                  resolveThread(input.options.thread, ctx.threadId),
                  input.options.desktop,
                  ctx.signal ?? new AbortController().signal,
                ),
              ),
            };
          },
        }),
        status: cliCommand({
          summary: "Inspect the dedicated tab without sending a message",
          options: { thread: threadOption },
          async run(input, ctx) {
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await service.status(
                  resolveThread(input.options.thread, ctx.threadId),
                  ctx.signal ?? new AbortController().signal,
                ),
              ),
            };
          },
        }),
        disconnect: cliCommand({
          summary: "Release automation without deleting the browser profile",
          options: { thread: threadOption },
          async run(input, ctx) {
            await service.disconnect(
              resolveThread(input.options.thread, ctx.threadId),
              ctx.signal ?? new AbortController().signal,
            );
            return { exitCode: 0, stdout: "null" };
          },
        }),
        execute: cliCommand({
          summary:
            "Start workspace actions and return immediately with their execution request ID",
          options: {
            thread: threadOption,
            request: {
              type: "string",
              description:
                "Caller-chosen execution UUID; generated when omitted",
            },
            turn: {
              type: "string",
              required: true,
              description: "Stable UUID for this task turn",
            },
            actions: {
              type: "string",
              required: true,
              description:
                "JSON array of actions; writes and commands require approval in the thread",
            },
          },
          async run(input, ctx) {
            const parsed = executionStartSchema.parse({
              threadId: resolveThread(input.options.thread, ctx.threadId),
              requestId: input.options.request ?? randomUUID(),
              turnKey: input.options.turn,
              actions: JSON.parse(input.options.actions),
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await service.executionStart(
                  parsed.threadId,
                  parsed.requestId,
                  parsed.turnKey,
                  parsed.actions,
                ),
              ),
            };
          },
        }),
        "execution-status": cliCommand({
          summary:
            "Read an execution request's actual state and terminal receipts",
          options: { thread: threadOption, request: requestOption },
          async run(input, ctx) {
            const parsed = executionRequestSchema.parse({
              threadId: resolveThread(input.options.thread, ctx.threadId),
              requestId: input.options.request,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                service.executionStatus(parsed.threadId, parsed.requestId),
              ),
            };
          },
        }),
        "execution-cancel": cliCommand({
          summary:
            "Cancel an execution request and wait for its operation to finish",
          options: { thread: threadOption, request: requestOption },
          async run(input, ctx) {
            const parsed = executionRequestSchema.parse({
              threadId: resolveThread(input.options.thread, ctx.threadId),
              requestId: input.options.request,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await service.executionCancel(
                  parsed.threadId,
                  parsed.requestId,
                ),
              ),
            };
          },
        }),
        exchange: cliCommand({
          summary: "Send one journaled exchange to the dedicated website tab",
          options: {
            thread: threadOption,
            turn: {
              type: "string",
              required: true,
              description: "Stable UUID for this task turn",
            },
            text: {
              type: "string",
              required: true,
              description: "Exact message to submit once",
            },
          },
          async run(input, ctx) {
            const parsed = exchangeInputSchema.parse({
              turnKey: input.options.turn,
              text: input.options.text,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                await service.exchange(
                  resolveThread(input.options.thread, ctx.threadId),
                  parsed.turnKey,
                  parsed.text,
                  ctx.signal ?? new AbortController().signal,
                ),
              ),
            };
          },
        }),
      },
    }),
  );
}
