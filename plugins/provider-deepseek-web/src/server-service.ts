import { createHash } from "node:crypto";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  bindingSchema,
  executionStatusSchema,
  hostContract,
  inspectionSchema,
} from "./contracts.js";
import { buildExchangeScript, buildInspectScript } from "./browser-driver.js";
import {
  actionResultSchema,
  exchangeOutputSchema,
  PROVIDER_ID,
  type WebAction,
} from "./vocabulary.js";

const browserOutput = z.object({
  text: z.string().max(300_000),
  exitCode: z.number().int(),
});
const browserSession = z.object({ id: z.string().uuid() });
const browserExchange = z.union([
  exchangeOutputSchema.options[0].extend({
    conversationUrl: z
      .url()
      .refine((value) => new URL(value).origin === "https://chat.deepseek.com"),
  }),
  exchangeOutputSchema.options[1],
]);
const approval = z.object({ approved: z.boolean() }).strict();
const journalWorkspace = z
  .object({
    environmentId: z.string().min(1),
    hostId: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();
const actionJournal = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("approval"),
      hash: z.string(),
      workspace: journalWorkspace,
    })
    .strict(),
  z
    .object({
      state: z.literal("running"),
      hash: z.string(),
      workspace: journalWorkspace,
    })
    .strict(),
  z
    .object({
      state: z.literal("uncertain"),
      hash: z.string(),
      workspace: journalWorkspace,
    })
    .strict(),
  z
    .object({
      state: z.literal("completed"),
      hash: z.string(),
      result: actionResultSchema,
      workspace: journalWorkspace,
    })
    .strict(),
]);
const exchangeJournal = z.discriminatedUnion("state", [
  z.object({ state: z.literal("running") }).strict(),
  z
    .object({ state: z.literal("completed"), output: exchangeOutputSchema })
    .strict(),
]);
const executionRecordSchema = z
  .object({
    requestId: z.uuid(),
    threadId: z.string().min(1),
    digest: z.string().nullable(),
    createdAt: z.number(),
  })
  .strict();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const bindingKey = (threadId: string) =>
  `bindings/${encodeURIComponent(threadId)}`;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const blocked = (reason: string): z.infer<typeof exchangeOutputSchema> => ({
  status: "blocked",
  reason: reason.slice(0, 4_000),
});

export function createDeepSeekWebService(bb: BbPluginApi) {
  type ExecutionStatus = z.infer<typeof executionStatusSchema>;
  interface ExecutionJob {
    threadId: string;
    digest: string | null;
    controller: AbortController;
    status: ExecutionStatus;
    done: Promise<void>;
  }
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const queue = new Map<string, Promise<void>>();
  const jobs = new Map<string, ExecutionJob>();
  let registry = Promise.resolve();
  const lifecycle = new AbortController();
  bb.onDispose(async () => {
    lifecycle.abort();
    for (const job of jobs.values()) job.controller.abort();
    await registry;
    await Promise.all([...jobs.values()].map((job) => job.done));
  });

  function registryOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = registry.then(() => {
      lifecycle.signal.throwIfAborted();
      return operation();
    });
    registry = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  function ownedJob(threadId: string, requestId: string) {
    const job = jobs.get(requestId);
    if (job !== undefined && job.threadId !== threadId)
      throw new Error("This execution request belongs to another thread.");
    return job;
  }

  async function createJob(
    threadId: string,
    requestId: string,
    digest: string | null,
  ): Promise<ExecutionJob> {
    const key = `execution-jobs/${requestId}`;
    const previous = await bb.storage.kv.get<unknown>(key);
    if (previous !== null && previous !== undefined) {
      const record = executionRecordSchema.parse(previous);
      if (record.threadId !== threadId)
        throw new Error("This execution request belongs to another thread.");
      throw new Error(
        "This execution request is uncertain after a plugin restart. Inspect the workspace; automatic replay is refused.",
      );
    }
    const records = await Promise.all(
      (await bb.storage.kv.list("execution-jobs/")).map(async (recordKey) => ({
        key: recordKey,
        record: executionRecordSchema.parse(
          await bb.storage.kv.get<unknown>(recordKey),
        ),
      })),
    );
    records.sort(
      (left, right) => left.record.createdAt - right.record.createdAt,
    );
    let count = records.length;
    for (const entry of records) {
      const job = jobs.get(entry.record.requestId);
      if (job?.status.state === "running") continue;
      if (count < 100 && Date.now() - entry.record.createdAt < 3_600_000)
        continue;
      await bb.storage.kv.delete(entry.key);
      jobs.delete(entry.record.requestId);
      count--;
    }
    if (count >= 100)
      throw new Error(
        "Too many active execution requests. Finish or cancel one first.",
      );
    lifecycle.signal.throwIfAborted();
    await bb.storage.kv.set(key, {
      requestId,
      threadId,
      digest,
      createdAt: Date.now(),
    });
    const job: ExecutionJob = {
      threadId,
      digest,
      controller: new AbortController(),
      status: { requestId, state: digest === null ? "cancelled" : "running" },
      done: Promise.resolve(),
    };
    if (digest === null) job.controller.abort();
    jobs.set(requestId, job);
    return job;
  }

  async function serialized<T>(
    threadId: string,
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const combined = AbortSignal.any([signal, lifecycle.signal]);
    if (queue.has(threadId))
      throw new Error(
        "Another DeepSeek operation is in progress. Resolve any pending workspace approval or stop the turn before changing the browser connection.",
      );
    const previous = Promise.resolve();
    const work = previous.then(() => {
      combined.throwIfAborted();
      return operation(combined);
    });
    const tail = work.then(
      () => {},
      () => {},
    );
    queue.set(threadId, tail);
    void tail.then(() => {
      if (queue.get(threadId) === tail) queue.delete(threadId);
    });
    return work;
  }

  async function workspace(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== PROVIDER_ID || thread.deletedAt !== null)
      throw new Error(
        "Select the DeepSeek Web provider on a live thread first.",
      );
    if (thread.environmentId === null)
      throw new Error("The DeepSeek thread needs a workspace.");
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.path === null || environment.status !== "ready")
      throw new Error("The thread workspace is not ready.");
    return { ...environment, path: environment.path };
  }

  async function binding(threadId: string) {
    const value = await bb.storage.kv.get<unknown>(bindingKey(threadId));
    return value === null || value === undefined
      ? null
      : bindingSchema.parse(value);
  }

  async function browserRun(
    threadId: string,
    sessionId: string,
    script: string,
    signal: AbortSignal,
    timeoutMs: number,
  ) {
    signal.throwIfAborted();
    let stopping: Promise<Error | null> | null = null;
    const stop = () => {
      stopping = (async () => {
        try {
          await bb.sdk.plugins.callRpc({
            pluginId: "browser-automation",
            method: "stop",
            input: { threadId, sessionId },
            outputSchema: z.object({ state: z.enum(["stopped", "closed"]) }),
            signal: AbortSignal.timeout(10_000),
          });
          return null;
        } catch (error) {
          return new Error(
            "Browser cancellation could not be confirmed. Inspect the dedicated tab before reconnecting.",
            { cause: error },
          );
        }
      })();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const output = await bb.sdk.plugins.callRpc({
        pluginId: "browser-automation",
        method: "run",
        input: { threadId, sessionId, script, timeoutMs },
        outputSchema: browserOutput,
        signal,
      });
      signal.throwIfAborted();
      if (output.exitCode !== 0)
        throw new Error(
          "Browser execution failed. Inspect the dedicated tab before trying again.",
        );
      return output.text;
    } finally {
      signal.removeEventListener("abort", stop);
      const failure = await stopping;
      if (failure !== null) throw failure;
    }
  }

  async function connected(threadId: string) {
    const environment = await workspace(threadId);
    const current = await binding(threadId);
    if (current === null)
      throw new Error("Connect a dedicated DeepSeek browser tab first.");
    if (current.hostId !== environment.hostId)
      throw new Error(
        "The browser binding is on another workspace host. Disconnect and choose this host explicitly.",
      );
    return { current, environment };
  }

  const service = {
    async desktops(threadId: string) {
      const environment = await workspace(threadId);
      const { instances } =
        await bb.sdk.experimental_desktopBrowsers.listInstances({
          hostId: environment.hostId,
        });
      return instances.map((instance) => ({
        id: instance.instanceId,
        label: instance.label,
      }));
    },
    connect(threadId: string, instanceId: string, signal: AbortSignal) {
      return serialized(threadId, signal, async (activeSignal) => {
        const environment = await workspace(threadId);
        const existing = await binding(threadId);
        if (existing !== null) {
          if (
            existing.hostId !== environment.hostId ||
            existing.instanceId !== instanceId
          )
            throw new Error(
              "Disconnect the current browser binding before choosing another desktop.",
            );
          const desktop = bb.sdk.experimental_desktopBrowsers;
          const { instances } = await desktop.listInstances({
            hostId: environment.hostId,
          });
          const selected = instances.find(
            (instance) => instance.instanceId === instanceId,
          );
          if (
            selected === undefined ||
            selected.generation !== existing.generation
          )
            throw new Error(
              "The original browser generation is unavailable or changed. Disconnect explicitly; the conversation was not replaced.",
            );
          const scope = {
            hostId: existing.hostId,
            instanceId,
            generation: existing.generation,
            threadId,
          };
          const { tabs } = await desktop.listTabs(scope);
          if (
            !tabs.some(
              (tab) =>
                tab.tabId === existing.tabId && tab.threadId === threadId,
            )
          )
            throw new Error(
              "The original dedicated tab is missing or belongs to another thread. Disconnect explicitly; no new conversation was created.",
            );
          activeSignal.throwIfAborted();
          try {
            const closed = await bb.sdk.plugins.callRpc({
              pluginId: "browser-automation",
              method: "close",
              input: { threadId, sessionId: existing.sessionId },
              outputSchema: z.object({ state: z.literal("closed") }),
              signal: activeSignal,
            });
            if (closed.state !== "closed")
              throw new Error(
                "The previous automation session was not closed.",
              );
          } catch {
            activeSignal.throwIfAborted();
            const sessions = await bb.sdk.plugins.callRpc({
              pluginId: "browser-automation",
              method: "list",
              input: { threadId },
              outputSchema: z.array(
                z.object({
                  id: z.string().uuid(),
                  state: z.enum(["ready", "stopped", "closed"]),
                }),
              ),
              signal: activeSignal,
            });
            if (
              !sessions.some(
                (session) =>
                  session.id === existing.sessionId &&
                  session.state === "closed",
              )
            )
              throw new Error(
                "Could not verify closure of the previous automation session. The original binding was retained; reconnect was not attempted.",
              );
          }
          activeSignal.throwIfAborted();
          const session = await bb.sdk.plugins.callRpc({
            pluginId: "browser-automation",
            method: "open",
            input: {
              threadId,
              selection: {
                backend: "desktop",
                hostId: existing.hostId,
                instanceId,
                tabId: existing.tabId,
              },
            },
            outputSchema: browserSession,
            signal: activeSignal,
          });
          const record = bindingSchema.parse({
            ...existing,
            sessionId: session.id,
          });
          await bb.storage.kv.set(bindingKey(threadId), record);
          return record;
        }
        const desktop = bb.sdk.experimental_desktopBrowsers;
        const { instances } = await desktop.listInstances({
          hostId: environment.hostId,
        });
        const selected = instances.find(
          (instance) => instance.instanceId === instanceId,
        );
        if (selected === undefined)
          throw new Error(
            "The selected desktop is unavailable on the workspace host.",
          );
        activeSignal.throwIfAborted();
        const scope = {
          hostId: environment.hostId,
          instanceId,
          generation: selected.generation,
          threadId,
        };
        const created = await desktop.createTab({
          ...scope,
          url: "https://chat.deepseek.com",
          presentation: "reveal",
        });
        try {
          activeSignal.throwIfAborted();
          const session = await bb.sdk.plugins.callRpc({
            pluginId: "browser-automation",
            method: "open",
            input: {
              threadId,
              selection: {
                backend: "desktop",
                hostId: environment.hostId,
                instanceId,
                tabId: created.tab.tabId,
              },
            },
            outputSchema: browserSession,
            signal: activeSignal,
          });
          const record = bindingSchema.parse({
            sessionId: session.id,
            hostId: environment.hostId,
            instanceId,
            tabId: created.tab.tabId,
            generation: selected.generation,
          });
          await bb.storage.kv.set(bindingKey(threadId), record);
          return record;
        } catch (error) {
          await desktop
            .closeTab({ ...scope, tabId: created.tab.tabId })
            .catch(() => {});
          throw error;
        }
      });
    },
    async status(threadId: string, signal: AbortSignal) {
      const activeSignal = AbortSignal.any([signal, lifecycle.signal]);
      activeSignal.throwIfAborted();
      await workspace(threadId);
      const current = await binding(threadId);
      if (current === null) return { binding: null, inspection: null };
      const { current: checked } = await connected(threadId);
      if (queue.has(threadId)) return { binding: checked, inspection: null };
      try {
        const text = await browserRun(
          threadId,
          checked.sessionId,
          buildInspectScript(),
          activeSignal,
          15_000,
        );
        const inspection = inspectionSchema.parse(JSON.parse(text));
        if (
          checked.conversationUrl !== null &&
          inspection.url !== checked.conversationUrl
        )
          return {
            binding: checked,
            inspection: {
              status: "layout_changed" as const,
              hint: "The dedicated tab shows another conversation. Restore the original chat manually before continuing.",
              url: inspection.url,
            },
          };
        return {
          binding: checked,
          inspection,
        };
      } catch (error) {
        activeSignal.throwIfAborted();
        return {
          binding: checked,
          inspection: {
            status: "layout_changed" as const,
            hint: `Browser inspection is unavailable: ${errorMessage(error)}. Reconnect the same dedicated tab; the conversation was not replaced.`.slice(
              0,
              4_000,
            ),
            url: "https://chat.deepseek.com",
          },
        };
      }
    },
    disconnect(threadId: string, signal: AbortSignal) {
      return serialized(threadId, signal, async (activeSignal) => {
        await workspace(threadId);
        const current = await binding(threadId);
        if (current === null) return null;
        await bb.sdk.plugins.callRpc({
          pluginId: "browser-automation",
          method: "close",
          input: { threadId, sessionId: current.sessionId },
          outputSchema: z.unknown(),
          signal: activeSignal,
        });
        await bb.storage.kv.delete(bindingKey(threadId));
        return null;
      });
    },
    exchange(
      threadId: string,
      turnKey: string,
      text: string,
      signal: AbortSignal,
    ) {
      return serialized(threadId, signal, async (activeSignal) => {
        const key = `exchanges/${encodeURIComponent(threadId)}/${turnKey}/${hash(text)}`;
        const stored = await bb.storage.kv.get<unknown>(key);
        if (stored !== null && stored !== undefined) {
          const journal = exchangeJournal.parse(stored);
          return journal.state === "completed"
            ? journal.output
            : blocked(
                "This browser exchange may already have been sent. Inspect the existing conversation; automatic resubmission is refused.",
              );
        }
        const { current } = await connected(threadId);
        const script = buildExchangeScript(text, current.conversationUrl);
        if (script.length > 128_000)
          return blocked(
            "The escaped message exceeds the browser script limit. Shorten the request; no message was sent.",
          );
        activeSignal.throwIfAborted();
        await bb.storage.kv.set(key, { state: "running" });
        let output: z.infer<typeof exchangeOutputSchema>;
        try {
          const response = await browserRun(
            threadId,
            current.sessionId,
            script,
            activeSignal,
            65_000,
          );
          const observed = browserExchange.parse(JSON.parse(response));
          if (observed.status === "reply") {
            if (
              current.conversationUrl !== null &&
              current.conversationUrl !== observed.conversationUrl
            )
              throw new Error(
                "The browser returned a reply from another conversation.",
              );
            await bb.storage.kv.set(bindingKey(threadId), {
              ...current,
              conversationUrl: observed.conversationUrl,
            });
          }
          output = exchangeOutputSchema.parse(
            observed.status === "reply"
              ? { status: observed.status, reply: observed.reply }
              : observed,
          );
        } catch (error) {
          output = blocked(
            `The browser exchange is uncertain: ${errorMessage(error)}. Inspect the existing conversation; do not resubmit automatically.`,
          );
        }
        if (Buffer.byteLength(JSON.stringify(output), "utf8") > 200_000)
          output = blocked(
            "The website response exceeds the journal size limit. Inspect the existing conversation; do not resubmit automatically.",
          );
        await bb.storage.kv.set(key, { state: "completed", output });
        return output;
      });
    },
    execute(
      threadId: string,
      turnKey: string,
      actions: WebAction[],
      signal: AbortSignal,
    ) {
      return serialized(threadId, signal, async (activeSignal) => {
        const ids = new Set(actions.map((action) => action.id));
        if (ids.size !== actions.length)
          throw new Error(
            "Action IDs must be unique within an execution request.",
          );
        const results: z.infer<typeof actionResultSchema>[] = [];
        for (const action of actions) {
          activeSignal.throwIfAborted();
          const environment = await workspace(threadId);
          const identity = {
            environmentId: environment.id,
            hostId: environment.hostId,
            path: environment.path,
          };
          const key = `actions/${encodeURIComponent(threadId)}/${turnKey}/${action.id}`;
          const digest = hash(JSON.stringify(action));
          const stored = await bb.storage.kv.get<unknown>(key);
          if (stored !== null && stored !== undefined) {
            const parsed = actionJournal.safeParse(stored);
            if (!parsed.success)
              throw new Error(
                "The previous action journal has no supported workspace identity. Inspect the original workspace; automatic replay is refused.",
              );
            const journal = parsed.data;
            if (
              journal.workspace.environmentId !== identity.environmentId ||
              journal.workspace.hostId !== identity.hostId ||
              journal.workspace.path !== identity.path
            )
              throw new Error(
                "This action belongs to another workspace. Its previous receipt cannot be reused and execution will not be repeated.",
              );
            if (journal.hash !== digest)
              throw new Error(
                "An action ID was reused with changed arguments; execution is refused.",
              );
            if (journal.state !== "completed")
              throw new Error(
                "This action has an unresolved or uncertain previous attempt. Inspect the workspace; automatic replay is refused.",
              );
            results.push(journal.result);
            continue;
          }
          if (action.kind === "write" || action.kind === "command") {
            await bb.storage.kv.set(key, {
              state: "approval",
              hash: digest,
              workspace: identity,
            });
            let approved = false;
            try {
              const decision = await bb.ui.requestInput(
                {
                  threadId,
                  rendererId: "approve-actions",
                  title:
                    action.kind === "command"
                      ? "Approve local command (not sandboxed)"
                      : "Approve full file replacement",
                  payload: {
                    actions: [action],
                  },
                  presentation: {
                    label: {
                      pending: "Reviewing workspace action",
                      completed: "Reviewed workspace action",
                    },
                    icon: { glyph: "Globe" },
                  },
                },
                { signal: activeSignal },
              );
              activeSignal.throwIfAborted();
              approved =
                decision.outcome === "submitted" &&
                approval.parse(decision.value).approved;
            } catch (error) {
              await bb.storage.kv.set(key, {
                state: "uncertain",
                hash: digest,
                workspace: identity,
              });
              throw error;
            }
            if (!approved) {
              const result = {
                id: action.id,
                output:
                  "The user did not approve this action. Nothing was executed.",
                exitCode: 1,
              };
              await bb.storage.kv.set(key, {
                state: "completed",
                hash: digest,
                workspace: identity,
                result,
              });
              results.push(result);
              continue;
            }
          }
          activeSignal.throwIfAborted();
          const current = await workspace(threadId);
          if (
            current.id !== environment.id ||
            current.hostId !== environment.hostId ||
            current.path !== environment.path
          )
            throw new Error(
              "The workspace changed during approval; execution is refused.",
            );
          await bb.storage.kv.set(key, {
            state: "running",
            hash: digest,
            workspace: identity,
          });
          try {
            activeSignal.throwIfAborted();
            const result = actionResultSchema.parse(
              await host.call(
                "execute",
                { cwd: current.path, action },
                {
                  hostId: current.hostId,
                  signal: activeSignal,
                  timeoutMs: 40_000,
                },
              ),
            );
            if (result.id !== action.id)
              throw new Error(
                "The host returned a receipt for another action.",
              );
            await bb.storage.kv.set(key, {
              state: "completed",
              hash: digest,
              workspace: identity,
              result,
            });
            results.push(result);
          } catch (error) {
            await bb.storage.kv.set(key, {
              state: "uncertain",
              hash: digest,
              workspace: identity,
            });
            throw error;
          }
        }
        return { results };
      });
    },
    executionStart(
      threadId: string,
      requestId: string,
      turnKey: string,
      actions: WebAction[],
    ): Promise<ExecutionStatus> {
      return registryOperation(async () => {
        const digest = hash(JSON.stringify({ turnKey, actions }));
        const existing = ownedJob(threadId, requestId);
        if (existing !== undefined) {
          if (existing.digest !== null && existing.digest !== digest)
            throw new Error(
              "An execution request ID was reused with changed arguments.",
            );
          return existing.status;
        }
        const job = await createJob(threadId, requestId, digest);
        job.done = service
          .execute(threadId, turnKey, actions, job.controller.signal)
          .then(
            (output) => {
              job.status = { requestId, state: "completed", output };
            },
            (error: unknown) => {
              job.status =
                job.controller.signal.aborted || lifecycle.signal.aborted
                  ? { requestId, state: "cancelled" }
                  : {
                      requestId,
                      state: "failed",
                      error: errorMessage(error).slice(0, 4_000),
                    };
            },
          );
        return job.status;
      });
    },
    executionStatus(threadId: string, requestId: string): ExecutionStatus {
      const job = ownedJob(threadId, requestId);
      if (job === undefined)
        throw new Error(
          "This execution request is unknown or expired, possibly after a plugin restart. Inspect the workspace; automatic replay is refused.",
        );
      return job.status;
    },
    async executionCancel(
      threadId: string,
      requestId: string,
    ): Promise<ExecutionStatus> {
      const job = await registryOperation(async () => {
        const entry =
          ownedJob(threadId, requestId) ??
          (await createJob(threadId, requestId, null));
        if (entry.status.state === "running") entry.controller.abort();
        return entry;
      });
      await job.done;
      return job.status;
    },
  };
  return service;
}
