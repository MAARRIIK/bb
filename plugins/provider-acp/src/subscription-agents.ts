import {
  cliCommand,
  defineRpcContract,
  type BbPluginApi,
  type PluginCliSpec,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { customAcpAgentSchema, type CustomAcpAgentSettings } from "./agents.js";

import {
  subscriptionAgentIdSchema,
  SUBSCRIPTION_AGENT_PROFILES as profiles,
} from "./subscription-profiles.js";

const profileViewSchema = z.object({
  id: subscriptionAgentIdSchema,
  name: z.string(),
  providerId: z.string(),
  signInCommand: z.string(),
  documentationUrl: z.string(),
  requiresInstallation: z.boolean(),
  configured: z.boolean(),
  matchesProfile: z.boolean(),
});

export const subscriptionRpcContract = defineRpcContract({
  listSubscriptionAgents: {
    input: z.object({}).strict(),
    output: z.array(profileViewSchema),
  },
  configureSubscriptionAgent: {
    input: z.object({ id: subscriptionAgentIdSchema }).strict(),
    output: z.array(profileViewSchema),
  },
  startSubscriptionSignIn: {
    input: z
      .object({ id: subscriptionAgentIdSchema, hostId: z.string().min(1) })
      .strict(),
    output: z.object({ terminalId: z.string() }),
  },
});

export function registerSubscriptionAgents(deps: {
  bb: Pick<BbPluginApi, "rpc" | "sdk">;
  customAgents: CustomAcpAgentSettings;
}): PluginCliSpec["commands"] {
  const { bb } = deps;
  function entries(setting: string) {
    const value = setting.trim();
    return z
      .array(customAcpAgentSchema)
      .parse(value === "" ? [] : JSON.parse(value));
  }
  async function list() {
    const configured = entries(await deps.customAgents.read());
    return profiles.map((profile) => {
      const existing = configured.find((entry) => entry.id === profile.id);
      return {
        id: profile.id,
        name: profile.name,
        providerId: `acp-${profile.id}`,
        signInCommand: profile.signInCommand,
        documentationUrl: profile.documentationUrl,
        requiresInstallation: profile.requiresInstallation,
        configured: true,
        matchesProfile:
          existing === undefined ||
          (existing.command === profile.command &&
            JSON.stringify(existing.args) === JSON.stringify(profile.args) &&
            Object.keys(existing.env).length === 0 &&
            existing.cwd === undefined),
      };
    });
  }
  async function configure(id: z.infer<typeof subscriptionAgentIdSchema>) {
    const profile = profiles.find((entry) => entry.id === id);
    if (profile === undefined) throw new Error("Unknown subscription agent");
    await deps.customAgents.update((value) => {
      const current = entries(value);
      if (current.some((entry) => entry.id === id)) return value;
      return JSON.stringify(
        [
          ...current,
          {
            id,
            displayName: profile.name,
            command: profile.command,
            args: profile.args,
          },
        ],
        null,
        2,
      );
    });
    return list();
  }
  async function openSignIn(
    id: z.infer<typeof subscriptionAgentIdSchema>,
    hostId: string,
  ) {
    const profile = (await list()).find((entry) => entry.id === id);
    if (profile === undefined || !profile.matchesProfile) {
      throw new Error(
        "A custom launch configuration must sign in using its own command and environment.",
      );
    }
    const host = await bb.sdk.hosts.get({ hostId });
    if (host.status !== "connected")
      throw new Error("The sign-in machine must be connected.");
    const title = `BB subscription sign-in: ${profile.name}`;
    const { sessions } = await bb.sdk.terminals.list({
      scope: { kind: "host_path", hostId },
    });
    const current = (await list()).find((entry) => entry.id === id);
    if (current === undefined || !current.matchesProfile)
      throw new Error(
        "The subscription profile changed. Review its configuration before signing in.",
      );
    const running = sessions.find(
      (session) => session.status === "running" && session.title === title,
    );
    if (running !== undefined) return { terminalId: running.id };
    const terminal = await bb.sdk.terminals.create({
      cols: 100,
      rows: 28,
      scope: { kind: "host_path", hostId, cwd: null },
      title,
      start: { mode: "command", command: profile.signInCommand },
    });
    return { terminalId: terminal.id };
  }
  const pendingSignIns = new Map<string, Promise<{ terminalId: string }>>();
  function signIn(
    id: z.infer<typeof subscriptionAgentIdSchema>,
    hostId: string,
  ) {
    const key = JSON.stringify([id, hostId]);
    const pending = pendingSignIns.get(key);
    if (pending !== undefined) return pending;
    const next = openSignIn(id, hostId);
    pendingSignIns.set(key, next);
    void next.then(
      () => pendingSignIns.delete(key),
      () => pendingSignIns.delete(key),
    );
    return next;
  }
  bb.rpc.register(subscriptionRpcContract, {
    listSubscriptionAgents: () => list(),
    configureSubscriptionAgent: ({ id }) => configure(id),
    startSubscriptionSignIn: ({ id, hostId }) => signIn(id, hostId),
  });
  return {
    "subscriptions list": cliCommand({
      summary: "List supported subscription profiles and their setup status",
      options: {
        json: {
          type: "boolean",
          description: "Emit machine-readable JSON",
        },
      },
      async run(input) {
        const rows = await list();
        return {
          exitCode: 0,
          stdout: input.options.json
            ? JSON.stringify(rows)
            : rows
                .map(
                  (row) =>
                    `${row.id}: ${row.configured ? "configured" : "not configured"}\nSign in: ${row.signInCommand}\nGuide: ${row.documentationUrl}`,
                )
                .join("\n\n"),
        };
      },
    }),
    "subscriptions add": cliCommand({
      summary:
        "Add a subscription profile without replacing existing custom agents",
      positionals: [
        {
          name: "id",
          description: "Subscription profile id",
          required: true,
        },
      ],
      async run(input) {
        const rows = await configure(
          subscriptionAgentIdSchema.parse(input.positionals.id),
        );
        return { exitCode: 0, stdout: JSON.stringify(rows) };
      },
    }),
    "subscriptions login": cliCommand({
      summary:
        "Open the agent's native login in a BB terminal on a connected machine",
      positionals: [
        {
          name: "id",
          description: "Subscription profile id",
          required: true,
        },
      ],
      options: {
        machine: {
          type: "string",
          description: "Connected machine ID",
          required: true,
        },
      },
      async run(input) {
        const result = await signIn(
          subscriptionAgentIdSchema.parse(input.positionals.id),
          input.options.machine,
        );
        return { exitCode: 0, stdout: JSON.stringify(result) };
      },
    }),
  };
}
