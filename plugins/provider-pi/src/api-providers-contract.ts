import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const apiProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  environmentVariable: z.string(),
  documentationUrl: z.url(),
});

export const piApiProvidersContract = defineRpcContract({
  "api-providers.list": {
    input: z.object({}).strict(),
    output: z.object({ providers: z.array(apiProviderSchema) }),
  },
});
