import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  actionResultSchema,
  hostActionInputSchema,
  executeInputSchema,
  executeOutputSchema,
  exchangeInputSchema,
  exchangeOutputSchema,
} from "./vocabulary.js";

export const bindingSchema = z
  .object({
    sessionId: z.string().uuid(),
    hostId: z.string(),
    instanceId: z.string(),
    tabId: z.string(),
    generation: z.string(),
    conversationUrl: z.string().url().nullable().default(null),
  })
  .strict();
export const threadInput = z.object({ threadId: z.string().min(1) }).strict();
export const inspectionSchema = z
  .object({
    status: z.enum([
      "ready",
      "login_required",
      "verification_required",
      "layout_changed",
      "generating",
    ]),
    hint: z.string(),
    url: z.string(),
  })
  .strict();
export const executionRequestSchema = threadInput.extend({
  requestId: z.uuid(),
});
export const executionStartSchema = executionRequestSchema.extend(
  executeInputSchema.shape,
);
export const executionStatusSchema = z.discriminatedUnion("state", [
  z.object({ requestId: z.uuid(), state: z.literal("running") }).strict(),
  z
    .object({
      requestId: z.uuid(),
      state: z.literal("completed"),
      output: executeOutputSchema,
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      state: z.literal("failed"),
      error: z.string().max(4_000),
    })
    .strict(),
  z.object({ requestId: z.uuid(), state: z.literal("cancelled") }).strict(),
]);
export const rpcContract = defineRpcContract({
  desktops: {
    input: threadInput,
    output: z.array(z.object({ id: z.string(), label: z.string() })),
  },
  connect: {
    input: threadInput.extend({ instanceId: z.string().min(1) }),
    output: bindingSchema,
  },
  status: {
    input: threadInput,
    output: z.object({
      binding: bindingSchema.nullable(),
      inspection: inspectionSchema.nullable(),
    }),
  },
  disconnect: { input: threadInput, output: z.null() },
  exchange: {
    input: threadInput.extend(exchangeInputSchema.shape),
    output: exchangeOutputSchema,
  },
  execute: {
    input: threadInput.extend(executeInputSchema.shape),
    output: executeOutputSchema,
  },
  executionStart: {
    input: executionStartSchema,
    output: executionStatusSchema,
  },
  executionStatus: {
    input: executionRequestSchema,
    output: executionStatusSchema,
  },
  executionCancel: {
    input: executionRequestSchema,
    output: executionStatusSchema,
  },
});
export const hostContract = defineRpcContract({
  execute: { input: hostActionInputSchema, output: actionResultSchema },
});
