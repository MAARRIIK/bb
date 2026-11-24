import { describe, expect, it } from "vitest";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import piPlugin from "./server.js";

it("exposes presets through CLI and RPC that configure Pi's native catalog", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "provider-pi" });
  try {
    piPlugin(bb);
    const cli = await harness.behavior.runCli(["api-providers", "--json"]);
    expect(cli.exitCode).toBe(0);
    const rpc = await harness.behavior.callRpc("api-providers.list", {});
    expect(JSON.parse(cli.stdout)).toEqual(rpc);
    const result = await import("./src/api-providers-contract.js");
    const { providers } =
      result.piApiProvidersContract["api-providers.list"].output.parse(rpc);
    expect(providers.map((entry) => entry.id)).toEqual([
      "gemini",
      "kimi",
      "glm-coding",
      "deepseek",
    ]);
    for (const preset of providers) {
      const models = builtinModels({
        credentials: new InMemoryCredentialStore(),
        authContext: {
          env: async (name) =>
            name === preset.environmentVariable
              ? `fake-qa-${preset.id}`
              : undefined,
          fileExists: async () => false,
        },
      });
      expect(await models.checkAuth(preset.provider)).toMatchObject({
        source: preset.environmentVariable,
      });
      expect(
        (await models.getAvailable(preset.provider)).length,
      ).toBeGreaterThan(0);
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

function registeredDeclaration() {
  const host = createFakePluginHost({ pluginId: "provider-pi" });
  piPlugin(host.bb);
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === "pi",
  );
  if (declaration === undefined)
    throw new Error("expected pi to be registered");
  return declaration;
}

describe("the pi plugin's environment passthrough", () => {
  it("declares the bridge command override variables so a host-set value reaches the bridge", () => {
    expect(registeredDeclaration().env).toEqual({
      passthrough: ["BB_PI_BRIDGE_COMMAND", "BB_PI_BRIDGE_ARGS"],
    });
  });
});

describe("the pi plugin's skill roots", () => {
  it("declares pi's directories as recursive, walks ancestors for .agents/skills only, and resolves the rest per host", () => {
    const declaration = registeredDeclaration();
    expect(declaration.experimental_nativeSkillRoots).toMatchObject({
      user: [
        { path: ".pi/agent/skills", recursive: true },
        { path: ".agents/skills", recursive: true },
      ],
      project: [
        { path: ".pi/skills", recursive: true, ancestors: false },
        { path: ".agents/skills", recursive: true, ancestors: true },
      ],
    });
    expect(declaration.experimental_resolvesNativeRoots).toBe(true);
  });
});
