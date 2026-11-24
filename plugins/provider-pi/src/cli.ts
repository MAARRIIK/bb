import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { listPiApiProviders } from "./api-providers.js";

export function registerPiCli(bb: BbPluginApi): void {
  bb.cli.register(
    defineCli({
      name: "pi",
      summary: "Configure Pi API connections",
      commands: {
        "api-providers": cliCommand({
          summary:
            "List API connection presets and their environment variable names",
          description:
            "Save keys with bb machine env set NAME, which reads the value from stdin. Add --project <id> for project scope. This list does not validate credentials.",
          options: {
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          run(input) {
            const result = listPiApiProviders();
            return {
              exitCode: 0,
              stdout: input.options.json
                ? `${JSON.stringify(result, null, 2)}\n`
                : `${result.providers.map((provider) => `${provider.name}\t${provider.provider}\t${provider.environmentVariable}`).join("\n")}\n`,
            };
          },
        }),
      },
    }),
  );
}
