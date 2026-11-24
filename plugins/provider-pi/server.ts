import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { piProviderDeclaration } from "./src/declaration.js";
import { listPiApiProviders } from "./src/api-providers.js";
import { piApiProvidersContract } from "./src/api-providers-contract.js";
import { registerPiCli } from "./src/cli.js";

export default function plugin(bb: BbPluginApi): void {
  registerPiCli(bb);
  bb.rpc.register(
    piApiProvidersContract,
    {
      "api-providers.list": listPiApiProviders,
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Pi API connection presets. Contains provider names and environment variable names, never credentials or authentication status.",
    },
  );
  const registered = bb.providers.register(piProviderDeclaration());
  bb.onDispose(() => {
    registered.dispose();
  });
}
