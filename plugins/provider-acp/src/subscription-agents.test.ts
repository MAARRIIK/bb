import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import acpProvidersPlugin from "../server.js";

const declaredIconNames = Object.keys(
  z
    .object({
      bb: z.object({
        branding: z.object({
          experimental_icons: z.record(z.string(), z.string()),
        }),
      }),
    })
    .parse(
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ),
    ).bb.branding.experimental_icons,
);

const profiles = [
  {
    id: "antigravity-acp",
    name: "Google Antigravity",
    command: "agy acp --login",
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    command: "npx -y @moonshot-ai/kimi-code@2.7.3 login",
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    command: "npx -y @qwen-code/qwen-code@0.28.4",
  },
];

type TerminalSession = Awaited<
  ReturnType<BbPluginApi["sdk"]["terminals"]["create"]>
>;

function terminalSession(
  overrides: Partial<TerminalSession> = {},
): TerminalSession {
  return {
    id: "term-login",
    threadId: null,
    environmentId: null,
    hostId: "host-login",
    title: "Native sign-in",
    initialCwd: "/home/test",
    cols: 100,
    rows: 28,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 0,
    updatedAt: 0,
    lastUserInputAt: null,
    ...overrides,
  };
}

const loadedHosts: ReturnType<typeof createFakePluginHost>[] = [];

async function loadPlugin(customAgents?: string) {
  const host = createFakePluginHost({
    pluginId: "provider-acp",
    experimental_declaredIconNames: declaredIconNames,
    ...(customAgents === undefined ? {} : { settings: { customAgents } }),
  });
  loadedHosts.push(host);
  host.harness.sdk.stub("hosts.list", () => Promise.resolve([]));
  host.harness.sdk.stub("providers.catalog", () => Promise.resolve([]));
  host.harness.sdk.stub("hosts.get", () =>
    Promise.resolve({
      ...makeHostResponse({ id: "host-login" }),
      connectMachineId: null,
      threadStorageRootPath: null,
    }),
  );
  const terminal = terminalSession();
  host.harness.sdk.stub("terminals.list", () =>
    Promise.resolve({ sessions: [] }),
  );
  host.harness.sdk.stub("terminals.create", () => Promise.resolve(terminal));
  await acpProvidersPlugin(host.bb);
  return host;
}

afterEach(async () => {
  await Promise.all(
    loadedHosts.splice(0).map((host) => host.harness.dispose()),
  );
});

describe("ACP subscription setup", () => {
  it("preserves a custom agent across parallel subscription setup and reload", async () => {
    const host = await loadPlugin(
      JSON.stringify([
        {
          id: "personal-agent",
          displayName: "Personal agent",
          command: "/opt/personal-agent",
          args: ["--acp"],
          env: { MODEL_ENDPOINT: "https://example.test" },
          cwd: "/projects/personal",
        },
      ]),
    );
    const original = host.harness.registrations.providerRegistrations.find(
      (provider) => provider.id === "acp-personal-agent",
    );
    expect(original).toBeDefined();

    await Promise.all([
      host.harness.callRpc("configureSubscriptionAgent", {
        id: "antigravity-acp",
      }),
      host.harness
        .runCli(["subscriptions", "add", "kimi-code"])
        .then((result) => {
          expect(result.exitCode).toBe(0);
        }),
      host.harness.callRpc("configureSubscriptionAgent", { id: "qwen-code" }),
    ]);

    const reloaded = await host.harness.reload(acpProvidersPlugin);
    loadedHosts.splice(loadedHosts.indexOf(host), 1, reloaded);
    expect(
      reloaded.harness.registrations.providerRegistrations.find(
        (provider) => provider.id === "acp-personal-agent",
      ),
    ).toEqual(original);
    expect(
      await reloaded.harness.callRpc("listSubscriptionAgents", {}),
    ).toEqual(
      expect.arrayContaining(
        profiles.map((profile) =>
          expect.objectContaining({
            id: profile.id,
            configured: true,
            matchesProfile: true,
          }),
        ),
      ),
    );
  });

  it("shares idempotent additions and listing between CLI and RPC", async () => {
    const host = await loadPlugin();
    const added = await host.harness.runCli([
      "subscriptions",
      "add",
      "kimi-code",
    ]);
    expect(added.exitCode).toBe(0);
    const rpcList = await host.harness.callRpc("listSubscriptionAgents", {});
    expect(JSON.parse(added.stdout)).toEqual(rpcList);
    expect(
      await host.harness.callRpc("configureSubscriptionAgent", {
        id: "kimi-code",
      }),
    ).toEqual(rpcList);
    const cliList = await host.harness.runCli([
      "subscriptions",
      "list",
      "--json",
    ]);
    expect(cliList.exitCode).toBe(0);
    expect(JSON.parse(cliList.stdout)).toEqual(rpcList);
    expect(
      host.harness.registrations.providerRegistrations.filter(
        (provider) => provider.id === "acp-kimi-code",
      ),
    ).toHaveLength(1);
  });

  it.each(profiles)(
    "registers $name by default and opens native sign-in without a setup step",
    async (profile) => {
      const host = await loadPlugin();
      expect(await host.harness.callRpc("listSubscriptionAgents", {})).toEqual(
        expect.arrayContaining(
          profiles.map((entry) =>
            expect.objectContaining({
              id: entry.id,
              configured: true,
              matchesProfile: true,
            }),
          ),
        ),
      );
      for (const entry of profiles) {
        expect(
          host.harness.registrations.providerRegistrations.filter(
            (provider) => provider.id === `acp-${entry.id}`,
          ),
        ).toHaveLength(1);
      }
      expect(
        host.harness.registrations.providerRegistrations.find(
          (provider) => provider.id === `acp-${profile.id}`,
        ),
      ).toMatchObject({
        displayName: profile.name,
        experimental_visibility: "always",
        strings: { signInHint: expect.stringContaining(profile.command) },
      });
      const rpcResult = await host.harness.callRpc("startSubscriptionSignIn", {
        id: profile.id,
        hostId: "host-login",
      });
      expect(rpcResult).toEqual({ terminalId: "term-login" });
      const cliResult = await host.harness.runCli([
        "subscriptions",
        "login",
        profile.id,
        "--machine",
        "host-login",
      ]);
      expect(cliResult.exitCode).toBe(0);
      expect(JSON.parse(cliResult.stdout)).toEqual({
        terminalId: "term-login",
      });
      expect(host.harness.sdk.callsTo("hosts.get")).toEqual([
        [{ hostId: "host-login" }],
        [{ hostId: "host-login" }],
      ]);
      expect(host.harness.sdk.callsTo("terminals.create")).toEqual([
        [
          expect.objectContaining({
            scope: { kind: "host_path", hostId: "host-login", cwd: null },
            title: `BB subscription sign-in: ${profile.name}`,
            start: { mode: "command", command: profile.command },
          }),
        ],
        [
          expect.objectContaining({
            scope: { kind: "host_path", hostId: "host-login", cwd: null },
            title: `BB subscription sign-in: ${profile.name}`,
            start: { mode: "command", command: profile.command },
          }),
        ],
      ]);
    },
  );

  it("keeps an existing custom override through setup and reload, then restores the shipped provider when removed", async () => {
    const override = {
      id: "kimi-code",
      displayName: "Private Kimi",
      command: "/opt/private-kimi",
      args: ["--custom-acp"],
      env: { KIMI_BASE_URL: "https://private.example.test" },
      cwd: "/private/workspace",
    };
    const host = await loadPlugin(JSON.stringify([override]));
    const original = host.harness.registrations.providerRegistrations.find(
      (provider) => provider.id === "acp-kimi-code",
    );
    expect(original).toMatchObject({
      displayName: "Private Kimi",
      experimental_bridgeOptions: {
        acpLaunchSpec: {
          command: "/opt/private-kimi",
          args: ["--custom-acp"],
          env: { KIMI_BASE_URL: "https://private.example.test" },
          cwd: "/private/workspace",
        },
      },
    });
    expect(original?.strings?.signInHint).not.toContain("npx -y @moonshot-ai");
    await host.harness.callRpc("configureSubscriptionAgent", {
      id: "kimi-code",
    });
    const reloaded = await host.harness.reload(acpProvidersPlugin);
    loadedHosts.splice(loadedHosts.indexOf(host), 1, reloaded);
    reloaded.harness.sdk.stub("hosts.get", () =>
      Promise.resolve({
        ...makeHostResponse({ id: "host-login" }),
        connectMachineId: null,
        threadStorageRootPath: null,
      }),
    );
    reloaded.harness.sdk.stub("terminals.list", () =>
      Promise.resolve({ sessions: [] }),
    );
    reloaded.harness.sdk.stub("terminals.create", () =>
      Promise.resolve(terminalSession()),
    );
    expect(
      reloaded.harness.registrations.providerRegistrations.find(
        (provider) => provider.id === "acp-kimi-code",
      ),
    ).toEqual(original);
    await expect(
      reloaded.harness.callRpc("startSubscriptionSignIn", {
        id: "kimi-code",
        hostId: "host-login",
      }),
    ).rejects.toThrow("A custom launch configuration");
    expect(reloaded.harness.sdk.callsTo("terminals.create")).toEqual([]);
    await reloaded.harness.setSettings({ customAgents: "[]" });
    await vi.waitFor(() =>
      expect(
        reloaded.harness.registrations.providerRegistrations.find(
          (provider) => provider.id === "acp-kimi-code",
        ),
      ).toMatchObject({
        displayName: "Kimi Code",
        experimental_bridgeOptions: {
          acpLaunchSpec: {
            command: "npx",
            args: ["-y", "@moonshot-ai/kimi-code@2.7.3", "acp"],
            env: {},
          },
        },
        strings: {
          signInHint: expect.stringContaining(
            "npx -y @moonshot-ai/kimi-code@2.7.3 login",
          ),
        },
      }),
    );
    expect(
      await reloaded.harness.callRpc("listSubscriptionAgents", {}),
    ).toContainEqual(
      expect.objectContaining({
        id: "kimi-code",
        configured: true,
        matchesProfile: true,
      }),
    );
    expect(
      await reloaded.harness.callRpc("startSubscriptionSignIn", {
        id: "kimi-code",
        hostId: "host-login",
      }),
    ).toEqual({ terminalId: "term-login" });
    expect(reloaded.harness.sdk.callsTo("terminals.create")).toHaveLength(1);
  });

  it("reopens a running native sign-in terminal and starts a new one after it exits", async () => {
    const host = await loadPlugin();
    await host.harness.callRpc("configureSubscriptionAgent", {
      id: "kimi-code",
    });
    let previous = terminalSession({
      id: "term-existing-login",
      title: "BB subscription sign-in: Kimi Code",
    });
    host.harness.sdk.stub("terminals.list", () =>
      Promise.resolve({
        sessions: [previous],
      }),
    );
    const reopened = await host.harness.runCli([
      "subscriptions",
      "login",
      "kimi-code",
      "--machine",
      "host-login",
    ]);
    expect(reopened.exitCode).toBe(0);
    expect(JSON.parse(reopened.stdout)).toEqual({
      terminalId: "term-existing-login",
    });
    expect(host.harness.sdk.callsTo("terminals.create")).toEqual([]);
    expect(host.harness.sdk.callsTo("terminals.list")).toEqual([
      [{ scope: { kind: "host_path", hostId: "host-login" } }],
    ]);

    previous = { ...previous, status: "exited", exitCode: 0 };
    expect(
      await host.harness.callRpc("startSubscriptionSignIn", {
        id: "kimi-code",
        hostId: "host-login",
      }),
    ).toEqual({ terminalId: "term-login" });
    expect(host.harness.sdk.callsTo("terminals.create")).toHaveLength(1);
  });

  it("opens only one native terminal for concurrent CLI and RPC sign-in requests", async () => {
    const host = await loadPlugin();
    await host.harness.callRpc("configureSubscriptionAgent", {
      id: "kimi-code",
    });
    const [rpcResult, cliResult] = await Promise.all([
      host.harness.callRpc("startSubscriptionSignIn", {
        id: "kimi-code",
        hostId: "host-login",
      }),
      host.harness.runCli([
        "subscriptions",
        "login",
        "kimi-code",
        "--machine",
        "host-login",
      ]),
    ]);
    expect(rpcResult).toEqual({ terminalId: "term-login" });
    expect(cliResult.exitCode).toBe(0);
    expect(JSON.parse(cliResult.stdout)).toEqual(rpcResult);
    expect(host.harness.sdk.callsTo("terminals.create")).toHaveLength(1);
  });

  it.each([
    {
      name: "custom environment",
      customAgents: JSON.stringify([
        {
          id: "kimi-code",
          displayName: "Kimi",
          command: "npx",
          args: ["-y", "@moonshot-ai/kimi-code@2.7.3", "acp"],
          env: { KIMI_BASE_URL: "https://example.test" },
        },
      ]),
    },
    {
      name: "custom launch command",
      customAgents: JSON.stringify([
        {
          id: "kimi-code",
          displayName: "Kimi",
          command: "/opt/custom-kimi",
          args: ["acp"],
        },
      ]),
    },
    {
      name: "custom working directory",
      customAgents: JSON.stringify([
        {
          id: "kimi-code",
          displayName: "Kimi",
          command: "npx",
          args: ["-y", "@moonshot-ai/kimi-code@2.7.3", "acp"],
          cwd: "/custom/configuration",
        },
      ]),
    },
  ])(
    "refuses native sign-in for $name configuration",
    async ({ customAgents }) => {
      const host = await loadPlugin(customAgents);
      await expect(
        host.harness.callRpc("startSubscriptionSignIn", {
          id: "kimi-code",
          hostId: "host-login",
        }),
      ).rejects.toThrow("A custom launch configuration");
      const cli = await host.harness.runCli([
        "subscriptions",
        "login",
        "kimi-code",
        "--machine",
        "host-login",
      ]);
      expect(cli.exitCode).toBe(1);
      expect(cli.stderr).toContain("A custom launch configuration");
      expect(host.harness.sdk.callsTo("terminals.create")).toEqual([]);
    },
  );

  it("rejects a profile changed while its sign-in host lookup was pending", async () => {
    const host = await loadPlugin();
    await host.harness.callRpc("configureSubscriptionAgent", {
      id: "kimi-code",
    });
    let releaseHost: (() => void) | undefined;
    const blockedHost = new Promise<void>((resolve) => {
      releaseHost = resolve;
    });
    host.harness.sdk.stub("hosts.get", async () => {
      await blockedHost;
      return {
        ...makeHostResponse({ id: "host-login" }),
        connectMachineId: null,
        threadStorageRootPath: null,
      };
    });
    const rejected = expect(
      host.harness.callRpc("startSubscriptionSignIn", {
        id: "kimi-code",
        hostId: "host-login",
      }),
    ).rejects.toThrow("The subscription profile changed");
    await vi.waitFor(() =>
      expect(host.harness.sdk.callsTo("hosts.get")).toHaveLength(1),
    );
    try {
      await host.harness.setSettings({
        customAgents: JSON.stringify([
          {
            id: "kimi-code",
            displayName: "Kimi Code",
            command: "npx",
            args: ["-y", "@moonshot-ai/kimi-code@2.7.3", "acp"],
            env: { KIMI_BASE_URL: "https://example.test" },
          },
        ]),
      });
    } finally {
      releaseHost?.();
    }
    await rejected;
    expect(host.harness.sdk.callsTo("terminals.create")).toEqual([]);
  });

  it("refuses an offline machine after accepting the configured profile", async () => {
    const host = await loadPlugin();
    await host.harness.callRpc("configureSubscriptionAgent", {
      id: "kimi-code",
    });
    host.harness.sdk.stub("hosts.get", () =>
      Promise.resolve({
        ...makeHostResponse({ id: "host-offline", status: "disconnected" }),
        connectMachineId: null,
        threadStorageRootPath: null,
      }),
    );
    await expect(
      host.harness.callRpc("startSubscriptionSignIn", {
        id: "kimi-code",
        hostId: "host-offline",
      }),
    ).rejects.toThrow("The sign-in machine must be connected.");
    expect(host.harness.sdk.callsTo("hosts.get")).toEqual([
      [{ hostId: "host-offline" }],
    ]);
    expect(host.harness.sdk.callsTo("terminals.create")).toEqual([]);
  });

  it("rejects unknown profile IDs at both public boundaries", async () => {
    const host = await loadPlugin();
    const before = await host.harness.callRpc("listSubscriptionAgents", {});
    await expect(
      host.harness.callRpc("configureSubscriptionAgent", {
        id: "unknown-profile",
      }),
    ).rejects.toThrow();
    await expect(
      host.harness.callRpc("startSubscriptionSignIn", {
        id: "unknown-profile",
        hostId: "host-login",
      }),
    ).rejects.toThrow();
    for (const command of ["add", "login"]) {
      const result = await host.harness.runCli([
        "subscriptions",
        command,
        "unknown-profile",
        ...(command === "login" ? ["--machine", "host-login"] : []),
      ]);
      expect(result.exitCode).toBe(1);
    }
    expect(await host.harness.callRpc("listSubscriptionAgents", {})).toEqual(
      before,
    );
    expect(host.harness.sdk.callsTo("terminals.create")).toEqual([]);
  });
});
