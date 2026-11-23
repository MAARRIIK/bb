import { z } from "zod";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  resolvedThreadExecutionOptionsSchema,
  serviceTierSchema,
} from "@bb/domain";

const operationIdSchema = z.string().uuid();

const contextSourceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("recent-messages") }).strict(),
  z
    .object({
      mode: z.literal("summary"),
      text: z.string().trim().min(1).max(32_000),
    })
    .strict(),
]);

export const providerSwitchPreviewRequestSchema = z
  .object({
    providerId: z.string().min(1).max(256),
    model: z.string().min(1).max(512),
    permissionMode: permissionModeSchema,
    reasoningLevel: reasoningLevelSchema.nullable(),
    serviceTier: serviceTierSchema,
    context: contextSourceSchema,
    contextTokenBudget: z.number().int().min(512).max(32_768),
    contextWindowTokens: z.number().int().min(2048).max(10_000_000).nullable(),
  })
  .strict();

export const providerSwitchPreviewSchema = z
  .object({
    threadId: z.string().min(1),
    environmentId: z.string().min(1),
    hostId: z.string().min(1),
    source: z
      .object({
        providerId: z.string().min(1),
        providerSessionId: z.string().min(1).nullable(),
        providerThreadId: z.string().min(1).nullable(),
        modelOverride: z.string().nullable(),
        reasoningLevelOverride: reasoningLevelSchema.nullable(),
      })
      .strict(),
    request: providerSwitchPreviewRequestSchema,
    execution: resolvedThreadExecutionOptionsSchema,
    context: z
      .object({
        text: z.string().min(1).max(131_072),
        throughSequence: z.number().int().nonnegative(),
        tokenBudget: z.number().int().positive(),
        estimatedTokens: z.number().int().positive(),
        estimateMethod: z.literal("utf8-bytes"),
        includedMessages: z.number().int().nonnegative(),
        hasOlderHistory: z.boolean(),
        omittedOversizedEvents: z.number().int().nonnegative(),
        completeness: z.enum(["recent-messages", "summary"]),
        windowTokens: z.number().int().positive().nullable(),
        windowSource: z.enum(["unknown", "provider", "user"]),
        servedWindowVerified: z.literal(false),
      })
      .strict(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const providerSwitchCommitRequestSchema = z
  .object({
    operationId: operationIdSchema,
    preview: providerSwitchPreviewSchema,
  })
  .strict();

export const providerSwitchOperationRequestSchema = z
  .object({
    operationId: operationIdSchema,
  })
  .strict();

export const providerSwitchReceiptSchema = z
  .object({
    operationId: operationIdSchema,
    threadId: z.string().min(1),
    providerId: z.string().min(1),
    model: z.string().min(1),
    phase: z.enum([
      "preparing",
      "prepared",
      "adopting",
      "committed",
      "finalizing",
      "rolling_back",
      "completed",
      "rolled_back",
    ]),
    errorCode: z.string().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type ProviderSwitchPreviewRequest = z.infer<
  typeof providerSwitchPreviewRequestSchema
>;
export type ProviderSwitchPreview = z.infer<typeof providerSwitchPreviewSchema>;
export type ProviderSwitchCommitRequest = z.infer<
  typeof providerSwitchCommitRequestSchema
>;
export type ProviderSwitchOperationRequest = z.infer<
  typeof providerSwitchOperationRequestSchema
>;
export type ProviderSwitchReceipt = z.infer<typeof providerSwitchReceiptSchema>;
