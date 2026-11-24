import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./src/contracts.js";
import { executeWorkspaceAction } from "./src/action-executor.js";
export { experimental_providerBridge } from "./src/bridge.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    execute: (input, context) => executeWorkspaceAction(input, context.signal),
  },
});
