import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import { hostActionInputSchema } from "./vocabulary.js";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
const threadId = "thr_deepseek";
const turnKey = "12345678-1234-4234-8234-123456789abc";
const write = {
  id: "write-1",
  kind: "write",
  path: "file.txt",
  content: "approved content",
} as const;

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.dispose()));
});

async function setup(
  executeHost?: (call: {
    input: unknown;
    signal?: AbortSignal;
  }) => unknown | Promise<unknown>,
) {
  let providerId = "deepseek-web";
  let target = {
    id: "env-workspace",
    hostId: "host-workspace",
    path: "/workspace",
    status: "ready",
  };
  let hostFailure = false;
  let browserFailure = false;
  let browserRuns = 0;
  const sessionId = randomUUID();
  let openCount = 0;
  const host = createFakePluginHost({
    pluginId: "provider-deepseek-web",
    experimental_callHostRpc: (call) => {
      if (hostFailure) throw new Error("Connection lost after dispatch");
      if (executeHost) return executeHost(call);
      const input = hostActionInputSchema.parse(call.input);
      return { id: input.action.id, output: "executed", exitCode: 0 };
    },
    sdk: {
      threads: {
        get: async () =>
          makeThreadResponse({
            id: threadId,
            providerId,
            environmentId: target.id,
          }),
      },
      environments: {
        get: async () => target,
      },
      experimental_desktopBrowsers: {
        listInstances: async () => ({
          instances: [
            {
              instanceId: "desktop-one",
              generation: "generation-one",
              label: "Desktop",
              hostId: "host-workspace",
            },
          ],
        }),
        createTab: async () => ({ tab: { tabId: "tab-dedicated" } }),
        closeTab: async () => ({ ok: true }),
        listTabs: async () => ({
          tabs: [
            {
              tabId: "tab-dedicated",
              threadId,
              url: "https://chat.deepseek.com/a/chat/s/preserved",
              title: "Existing conversation",
              control: null,
              presentation: "reveal",
            },
          ],
        }),
      },
      plugins: {
        callRpc: async (input) => {
          if (input.pluginId === "provider-deepseek-web")
            return host.harness.callRpc(input.method, input.input, {
              signal: input.signal,
            });
          if (input.method === "open")
            return { id: ++openCount === 1 ? sessionId : randomUUID() };
          if (input.method === "close") return { state: "closed" };
          if (input.method === "run") {
            browserRuns += 1;
            if (browserFailure)
              throw new Error("Browser timed out after submission");
            return {
              exitCode: 0,
              text: JSON.stringify({
                status: "reply",
                reply: { kind: "final", text: "Web result" },
                conversationUrl: "https://chat.deepseek.com/a/chat/s/preserved",
              }),
            };
          }
          throw new Error("Unexpected browser operation");
        },
      },
    },
  });
  hosts.push(host);
  await plugin(host.bb);
  return {
    ...host,
    sessionId,
    setWorkspace(
      change: Partial<{ id: string; hostId: string; path: string }>,
    ) {
      target = { ...target, ...change };
    },
    setProvider(value: string) {
      providerId = value;
    },
    failHost() {
      hostFailure = true;
    },
    failBrowser() {
      browserFailure = true;
    },
    browserRuns: () => browserRuns,
  };
}

async function pendingApproval(host: ReturnType<typeof createFakePluginHost>) {
  await vi.waitFor(() =>
    expect(host.harness.pendingInteractions).toHaveLength(1),
  );
  const request = host.harness.pendingInteractions[0];
  if (!request) throw new Error("Approval was not created");
  return request;
}

async function connect(host: ReturnType<typeof createFakePluginHost>) {
  return host.harness.callRpc("connect", {
    threadId,
    instanceId: "desktop-one",
  });
}

describe("DeepSeek Web server policy", () => {
  it("opens only a dedicated desktop tab on the actual workspace host", async () => {
    const host = await setup();
    expect(await host.harness.callRpc("desktops", { threadId })).toEqual([
      { id: "desktop-one", label: "Desktop" },
    ]);
    expect(await connect(host)).toMatchObject({
      sessionId: host.sessionId,
      hostId: "host-workspace",
      tabId: "tab-dedicated",
    });
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
    ).toEqual([
      [
        {
          hostId: "host-workspace",
          instanceId: "desktop-one",
          generation: "generation-one",
          threadId,
          url: "https://chat.deepseek.com",
          presentation: "reveal",
        },
      ],
    ]);
    expect(host.harness.sdk.callsTo("plugins.callRpc")[0]).toEqual([
      expect.objectContaining({
        pluginId: "browser-automation",
        method: "open",
        input: {
          threadId,
          selection: {
            backend: "desktop",
            hostId: "host-workspace",
            instanceId: "desktop-one",
            tabId: "tab-dedicated",
          },
        },
      }),
    ]);
    await host.harness.callRpc("disconnect", { threadId });
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
    ).toEqual([]);
  });

  it("reconnects a stopped session on the same owned tab while preserving completed journals", async () => {
    const host = await setup();
    await connect(host);
    const exchangeInput = { threadId, turnKey, text: "sent exactly once" };
    const exchangeResult = await host.harness.callRpc(
      "exchange",
      exchangeInput,
    );
    const actionInput = {
      threadId,
      turnKey,
      actions: [{ id: "read-preserved", kind: "read", path: "file" }],
    };
    const actionResult = await host.harness.callRpc("execute", actionInput);
    const reconnected = z
      .object({
        sessionId: z.string(),
        tabId: z.string(),
        generation: z.string(),
      })
      .parse(await connect(host));
    expect(reconnected.sessionId).not.toBe(host.sessionId);
    expect(reconnected).toMatchObject({
      tabId: "tab-dedicated",
      generation: "generation-one",
    });
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
    ).toHaveLength(1);
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.listTabs"),
    ).toEqual([
      [
        {
          hostId: "host-workspace",
          instanceId: "desktop-one",
          generation: "generation-one",
          threadId,
        },
      ],
    ]);
    const browserCalls = host.harness.sdk
      .callsTo("plugins.callRpc")
      .map(([input]) =>
        z.object({ method: z.string(), input: z.unknown() }).parse(input),
      );
    expect(browserCalls.filter((call) => call.method === "open")).toHaveLength(
      2,
    );
    expect(
      browserCalls.filter((call) => call.method === "open")[1]?.input,
    ).toEqual({
      threadId,
      selection: {
        backend: "desktop",
        hostId: "host-workspace",
        instanceId: "desktop-one",
        tabId: "tab-dedicated",
      },
    });
    expect(browserCalls).toContainEqual({
      method: "close",
      input: { threadId, sessionId: host.sessionId },
    });
    expect(await host.harness.callRpc("exchange", exchangeInput)).toEqual(
      exchangeResult,
    );
    expect(await host.harness.callRpc("execute", actionInput)).toEqual(
      actionResult,
    );
    expect(host.browserRuns()).toBe(1);
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
  });

  it.each(["generation", "missing tab", "another owner"])(
    "requires explicit disconnect after %s changes instead of creating another chat",
    async (change) => {
      const host = await setup();
      await connect(host);
      if (change === "generation")
        host.harness.sdk.stub(
          "experimental_desktopBrowsers.listInstances",
          async () => ({
            instances: [
              {
                instanceId: "desktop-one",
                generation: "restarted",
                label: "Desktop",
                hostId: "host-workspace",
              },
            ],
          }),
        );
      else
        host.harness.sdk.stub(
          "experimental_desktopBrowsers.listTabs",
          async () => ({
            tabs:
              change === "missing tab"
                ? []
                : [{ tabId: "tab-dedicated", threadId: "thr_someone_else" }],
          }),
        );
      await expect(connect(host)).rejects.toThrow("Disconnect explicitly");
      expect(
        host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
      ).toHaveLength(1);
      expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(1);
      expect(await host.harness.callRpc("status", { threadId })).toMatchObject({
        binding: { sessionId: host.sessionId, tabId: "tab-dedicated" },
      });
    },
  );

  it.each([false, true])(
    "opens another automation session after a close error only when closure is verified (%s)",
    async (closed) => {
      const host = await setup();
      await connect(host);
      const nextSession = randomUUID();
      host.harness.sdk.stub(
        "plugins.callRpc",
        async (input: { method: string }) => {
          if (input.method === "close") throw new Error("Close response lost");
          if (input.method === "list")
            return [
              { id: host.sessionId, state: closed ? "closed" : "stopped" },
            ];
          if (input.method === "open") return { id: nextSession };
          if (input.method === "run") throw new Error("Session stopped");
          throw new Error("Unexpected operation");
        },
      );
      if (closed)
        expect(await connect(host)).toMatchObject({
          sessionId: nextSession,
          tabId: "tab-dedicated",
        });
      else {
        await expect(connect(host)).rejects.toThrow("Could not verify closure");
        expect(
          await host.harness.callRpc("status", { threadId }),
        ).toMatchObject({ binding: { sessionId: host.sessionId } });
      }
      const openCalls = host.harness.sdk
        .callsTo("plugins.callRpc")
        .filter(
          ([input]) =>
            z.object({ method: z.string() }).parse(input).method === "open",
        );
      expect(openCalls).toHaveLength(closed ? 2 : 1);
      expect(
        host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
      ).toHaveLength(1);
      expect(
        host.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
      ).toEqual([]);
    },
  );

  it("retains the original receipt when reopening the same tab fails after close", async () => {
    const host = await setup();
    await connect(host);
    host.harness.sdk.stub(
      "plugins.callRpc",
      async (input: { method: string }) => {
        if (input.method === "close") return { state: "closed" };
        if (input.method === "open")
          throw new Error("Could not acquire browser control");
        if (input.method === "run") throw new Error("Session closed");
        throw new Error("Unexpected operation");
      },
    );
    await expect(connect(host)).rejects.toThrow(
      "Could not acquire browser control",
    );
    expect(await host.harness.callRpc("status", { threadId })).toMatchObject({
      binding: { sessionId: host.sessionId, tabId: "tab-dedicated" },
    });
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
    ).toHaveLength(1);
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
    ).toEqual([]);
  });

  it("keeps the binding visible when inspection fails so the same tab can be reconnected", async () => {
    const host = await setup();
    await connect(host);
    host.failBrowser();
    expect(await host.harness.callRpc("status", { threadId })).toMatchObject({
      binding: {
        sessionId: host.sessionId,
        instanceId: "desktop-one",
        tabId: "tab-dedicated",
      },
      inspection: {
        status: "layout_changed",
        hint: expect.stringContaining("Reconnect the same dedicated tab"),
      },
    });
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
    ).toHaveLength(1);
  });

  it("reports a different active conversation without replacing the pinned chat", async () => {
    const host = await setup();
    await connect(host);
    await host.harness.callRpc("exchange", {
      threadId,
      turnKey,
      text: "Pin this chat",
    });
    host.harness.sdk.stub(
      "plugins.callRpc",
      async (input: { method: string }) => {
        if (input.method !== "run")
          throw new Error("Unexpected browser operation");
        return {
          exitCode: 0,
          text: JSON.stringify({
            status: "ready",
            hint: "Ready",
            url: "https://chat.deepseek.com/a/chat/s/other",
          }),
        };
      },
    );
    expect(await host.harness.callRpc("status", { threadId })).toMatchObject({
      binding: {
        conversationUrl: "https://chat.deepseek.com/a/chat/s/preserved",
      },
      inspection: {
        status: "layout_changed",
        hint: expect.stringMatching(/original.*(chat|conversation)/i),
      },
    });
    expect(
      host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
    ).toHaveLength(1);
    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(3);
  });

  it("journals an uncertain website exchange and refuses to dispatch it again", async () => {
    const host = await setup();
    await connect(host);
    host.failBrowser();
    const input = { threadId, turnKey, text: "Submit exactly once" };
    const first = await host.harness.callRpc("exchange", input);
    expect(first).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("uncertain"),
    });
    expect(await host.harness.callRpc("exchange", input)).toEqual(first);
    expect(host.browserRuns()).toBe(1);
  });

  it("stops the existing browser session and awaits cleanup when an exchange is cancelled", async () => {
    const host = await setup();
    await connect(host);
    let started = false;
    let settled = false;
    let finishRun = () => {};
    let finishStop = () => {};
    let outcome = Promise.resolve<unknown>(null);
    const stopSignals: AbortSignal[] = [];
    host.harness.sdk.stub("plugins.callRpc", async (raw: unknown) => {
      const input = z
        .object({
          pluginId: z.string(),
          method: z.string(),
          input: z.unknown(),
          signal: z.instanceof(AbortSignal).optional(),
        })
        .parse(raw);
      expect(input.pluginId).toBe("browser-automation");
      if (input.method === "run") {
        started = true;
        return new Promise((_resolve, reject) => {
          finishRun = () => reject(new Error("Browser caller aborted"));
          input.signal?.addEventListener("abort", finishRun, { once: true });
        });
      }
      if (input.method === "stop") {
        expect(input.input).toEqual({ threadId, sessionId: host.sessionId });
        if (input.signal === undefined)
          throw new Error("Stop needs a deadline");
        stopSignals.push(input.signal);
        return new Promise((resolve) => {
          finishStop = () => resolve({ state: "stopped" });
        });
      }
      throw new Error("Unexpected browser operation");
    });
    const input = { threadId, turnKey, text: "Cancel this exchange" };
    try {
      const controller = new AbortController();
      outcome = host.harness
        .callRpc("exchange", input, { signal: controller.signal })
        .then((result) => {
          settled = true;
          return result;
        });
      await vi.waitFor(() => expect(started).toBe(true));
      controller.abort();
      await vi.waitFor(() => expect(stopSignals).toHaveLength(1));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopSignals[0]!.aborted).toBe(false);
      expect(settled).toBe(false);
      finishStop();
      expect(await outcome).toMatchObject({ status: "blocked" });
      expect(await host.harness.callRpc("exchange", input)).toMatchObject({
        status: "blocked",
      });
      expect(stopSignals).toHaveLength(1);
      expect(
        host.harness.sdk.callsTo("experimental_desktopBrowsers.createTab"),
      ).toHaveLength(1);
    } finally {
      finishRun();
      finishStop();
      await outcome;
    }
  });

  it("does not reject a website exchange just because page inspection is still in flight", async () => {
    const host = await setup();
    await connect(host);
    let inspecting = false;
    let finishInspection = () => {};
    host.harness.sdk.stub("plugins.callRpc", async (raw: unknown) => {
      const input = z.object({ method: z.string() }).parse(raw);
      if (input.method !== "run") throw new Error("Unexpected browser method");
      if (!inspecting) {
        inspecting = true;
        return new Promise((resolve) => {
          finishInspection = () =>
            resolve({
              exitCode: 0,
              text: JSON.stringify({
                status: "ready",
                hint: "Ready",
                url: "https://chat.deepseek.com/a/chat/s/preserved",
              }),
            });
        });
      }
      return {
        exitCode: 0,
        text: JSON.stringify({
          status: "reply",
          reply: { kind: "final", text: "accepted" },
          conversationUrl: "https://chat.deepseek.com/a/chat/s/preserved",
        }),
      };
    });
    const status = host.harness.callRpc("status", { threadId });
    try {
      await vi.waitFor(() => expect(inspecting).toBe(true));
      expect(
        await host.harness.callRpc("exchange", {
          threadId,
          turnKey,
          text: "real request",
        }),
      ).toMatchObject({ status: "reply", reply: { text: "accepted" } });
    } finally {
      finishInspection();
      await status;
    }
  });

  it("requires explicit approval and caches the completed result through reload", async () => {
    const host = await setup();
    const completeWrite = {
      ...write,
      content: "x".repeat(4_100) + "visible tail",
    };
    const input = { threadId, turnKey, actions: [completeWrite] };
    const execution = host.harness.callRpc("execute", input);
    const approval = await pendingApproval(host);
    expect(approval).toMatchObject({
      rendererId: "approve-actions",
      payload: { actions: [completeWrite] },
    });
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
    expect(await host.harness.callRpc("status", { threadId })).toMatchObject({
      inspection: null,
    });
    await expect(
      host.harness.callRpc("disconnect", { threadId }),
    ).rejects.toThrow("Resolve any pending workspace approval");
    host.harness.submitInteraction(approval.id, { approved: true });
    const result = await execution;
    expect(result).toEqual({
      results: [{ id: write.id, output: "executed", exitCode: 0 }],
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    expect(host.harness.experimental_hostRpcCalls[0]).toMatchObject({
      hostId: "host-workspace",
      input: { cwd: "/workspace", action: completeWrite },
    });
    const reloaded = await host.harness.reload(plugin);
    hosts.splice(
      hosts.findIndex((candidate) => candidate.harness === host.harness),
      1,
      reloaded,
    );
    expect(await reloaded.harness.callRpc("execute", input)).toEqual(result);
    expect(reloaded.harness.experimental_hostRpcCalls).toEqual([]);
    expect(reloaded.harness.pendingInteractions).toEqual([]);
  });

  it.each([
    { name: "environment", change: { id: "env-replacement" } },
    { name: "host", change: { hostId: "host-replacement" } },
    { name: "path", change: { path: "/replacement/workspace" } },
  ])(
    "refuses a completed action receipt after the workspace $name changes",
    async ({ change }) => {
      const host = await setup();
      const input = {
        threadId,
        turnKey,
        actions: [{ id: "workspace-read", kind: "read", path: "file" }],
      };
      expect(await host.harness.callRpc("execute", input)).toMatchObject({
        results: [{ exitCode: 0 }],
      });
      host.setWorkspace(change);
      await expect(host.harness.callRpc("execute", input)).rejects.toThrow(
        "another workspace",
      );
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
      expect(host.harness.pendingInteractions).toEqual([]);
    },
  );

  it("refuses legacy action journals without silently deleting their receipts", async () => {
    const host = await setup();
    const key = `actions/${threadId}/${turnKey}/legacy`;
    const previous = {
      state: "completed",
      hash: "legacy-hash",
      result: { id: "legacy", output: "old receipt", exitCode: 0 },
    };
    await host.bb.storage.kv.set(key, previous);
    await expect(
      host.harness.callRpc("execute", {
        threadId,
        turnKey,
        actions: [{ id: "legacy", kind: "read", path: "file" }],
      }),
    ).rejects.toThrow("no supported workspace identity");
    expect(await host.bb.storage.kv.get(key)).toEqual(previous);
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("does not run an uncertain action again when a new workspace is attached", async () => {
    const host = await setup();
    host.failHost();
    const input = {
      threadId,
      turnKey,
      actions: [{ id: "uncertain-read", kind: "read", path: "file" }],
    };
    await expect(host.harness.callRpc("execute", input)).rejects.toThrow(
      "Connection lost",
    );
    host.setWorkspace({ id: "env-replacement", path: "/another/workspace" });
    await expect(host.harness.callRpc("execute", input)).rejects.toThrow(
      "another workspace",
    );
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
  });

  it("does not execute denied actions or accept changed arguments for a reused ID", async () => {
    const host = await setup();
    const input = { threadId, turnKey, actions: [write] };
    const execution = host.harness.callRpc("execute", input);
    const approval = await pendingApproval(host);
    host.harness.submitInteraction(approval.id, { approved: false });
    expect(await execution).toMatchObject({ results: [{ exitCode: 1 }] });
    await expect(
      host.harness.callRpc("execute", {
        ...input,
        actions: [{ ...write, content: "changed" }],
      }),
    ).rejects.toThrow("changed arguments");
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("does not replay an approved action after an uncertain host response", async () => {
    const host = await setup();
    host.failHost();
    const input = { threadId, turnKey, actions: [write] };
    const execution = host.harness.callRpc("execute", input);
    const rejected = expect(execution).rejects.toThrow("Connection lost");
    const approval = await pendingApproval(host);
    host.harness.submitInteraction(approval.id, { approved: true });
    await rejected;
    await expect(host.harness.callRpc("execute", input)).rejects.toThrow(
      "uncertain previous attempt",
    );
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    expect(host.harness.pendingInteractions).toEqual([]);
  });

  it("revalidates the provider after approval before any workspace effect", async () => {
    const host = await setup();
    const execution = host.harness.callRpc("execute", {
      threadId,
      turnKey,
      actions: [write],
    });
    const rejected = expect(execution).rejects.toThrow("DeepSeek Web provider");
    const approval = await pendingApproval(host);
    host.setProvider("codex");
    host.harness.submitInteraction(approval.id, { approved: true });
    await rejected;
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("cancels a pending approval without execution or implicit approval on retry", async () => {
    const host = await setup();
    const controller = new AbortController();
    const input = { threadId, turnKey, actions: [write] };
    const execution = host.harness.callRpc("execute", input, {
      signal: controller.signal,
    });
    const rejected = expect(execution).rejects.toThrow();
    await pendingApproval(host);
    controller.abort();
    await rejected;
    await expect(host.harness.callRpc("execute", input)).rejects.toThrow(
      /uncertain previous attempt|aborted/,
    );
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("acknowledges a job before approval and keeps it running after the start signal aborts", async () => {
    const host = await setup();
    const requestId = randomUUID();
    const controller = new AbortController();
    const input = { threadId, requestId, turnKey, actions: [write] };
    expect(
      await host.harness.callRpc("executionStart", input, {
        signal: controller.signal,
      }),
    ).toEqual({ requestId, state: "running" });
    const approval = await pendingApproval(host);
    controller.abort();
    expect(
      await host.harness.callRpc("executionStatus", { threadId, requestId }),
    ).toEqual({ requestId, state: "running" });
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
    host.harness.submitInteraction(approval.id, { approved: true });
    const expected = {
      requestId,
      state: "completed",
      output: { results: [{ id: write.id, output: "executed", exitCode: 0 }] },
    };
    await vi.waitFor(async () =>
      expect(
        await host.harness.callRpc("executionStatus", { threadId, requestId }),
      ).toEqual(expected),
    );
    expect(await host.harness.callRpc("executionStart", input)).toEqual(
      expected,
    );
    await expect(
      host.harness.callRpc("executionStart", {
        ...input,
        actions: [{ ...write, content: "changed" }],
      }),
    ).rejects.toThrow(/changed arguments/);
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    expect(host.harness.experimental_hostRpcCalls[0]).toMatchObject({
      input: { cwd: "/workspace", action: write },
    });
    await expect(
      host.harness.callRpc("executionStatus", {
        threadId: "thr_other",
        requestId,
      }),
    ).rejects.toThrow(/another thread/);
    const reloaded = await host.harness.reload(plugin);
    hosts.splice(
      hosts.findIndex((candidate) => candidate.harness === host.harness),
      1,
      reloaded,
    );
    await expect(
      reloaded.harness.callRpc("executionStatus", { threadId, requestId }),
    ).rejects.toThrow(/unknown|expired/i);
    await expect(
      reloaded.harness.callRpc("executionStart", input),
    ).rejects.toThrow(/uncertain.*restart/i);
    expect(reloaded.harness.experimental_hostRpcCalls).toEqual([]);
    expect(reloaded.harness.pendingInteractions).toEqual([]);
  });

  it("returns a failed action receipt on denial without calling the host", async () => {
    const host = await setup();
    const requestId = randomUUID();
    await host.harness.callRpc("executionStart", {
      threadId,
      requestId,
      turnKey,
      actions: [write],
    });
    const approval = await pendingApproval(host);
    host.harness.submitInteraction(approval.id, { approved: false });
    await vi.waitFor(async () =>
      expect(
        await host.harness.callRpc("executionStatus", { threadId, requestId }),
      ).toMatchObject({
        requestId,
        state: "completed",
        output: { results: [{ id: write.id, exitCode: 1 }] },
      }),
    );
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("keeps a cancellation before start as a tombstone", async () => {
    const host = await setup();
    const requestId = randomUUID();
    const key = { threadId, requestId };
    expect(await host.harness.callRpc("executionCancel", key)).toEqual({
      requestId,
      state: "cancelled",
    });
    expect(
      await host.harness.callRpc("executionStart", {
        ...key,
        turnKey,
        actions: [write],
      }),
    ).toEqual({ requestId, state: "cancelled" });
    expect(host.harness.pendingInteractions).toEqual([]);
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("waits for an active host operation to stop before acknowledging cancellation", async () => {
    let started = false;
    let aborted = false;
    let release = () => {};
    const host = await setup(
      (call) =>
        new Promise((_resolve, reject) => {
          started = true;
          call.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          release = () => reject(new Error("Host operation stopped"));
        }),
    );
    const requestId = randomUUID();
    const key = { threadId, requestId };
    let settled = false;
    let cancellation: Promise<unknown> = Promise.resolve();
    try {
      await host.harness.callRpc("executionStart", {
        ...key,
        turnKey,
        actions: [{ id: "read-active", kind: "read", path: "file" }],
      });
      await vi.waitFor(() => expect(started).toBe(true));
      cancellation = host.harness
        .callRpc("executionCancel", key)
        .then((value) => {
          settled = true;
          return value;
        });
      await vi.waitFor(() => expect(aborted).toBe(true));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      release();
      expect(await cancellation).toEqual({ requestId, state: "cancelled" });
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    } finally {
      release();
      await cancellation;
    }
  });

  it("uses one policy path for native tool, SDK RPC and CLI execution", async () => {
    const host = await setup();
    const action = { id: "read-one", kind: "read", path: "file.txt" };
    const result = await host.harness.callAgentTool(
      "deepseek_web_execute",
      { turnKey, actions: [action] },
      { threadId, projectId: "project-test" },
    );
    expect(z.string().parse(result)).toContain("executed");
    const cli = await host.harness.runCli([
      "execute",
      "--thread",
      threadId,
      "--turn",
      turnKey,
      "--actions",
      JSON.stringify([action]),
    ]);
    expect(cli.exitCode).toBe(0);
    const { requestId } = z
      .object({ requestId: z.string().uuid() })
      .parse(JSON.parse(cli.stdout));
    await vi.waitFor(async () => {
      const status = await host.harness.runCli([
        "execution-status",
        "--thread",
        threadId,
        "--request",
        requestId,
      ]);
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toEqual({
        requestId,
        state: "completed",
        output: {
          results: [{ id: action.id, output: "executed", exitCode: 0 }],
        },
      });
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
  });
});
