import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const memberSchema = z
  .object({
    id: z.string(),
    task: z.string(),
    model: z.string().nullable(),
    status: z.enum([
      "running",
      "completed",
      "failed",
      "interrupted",
      "unknown",
    ]),
    result: z.string().max(16_000).nullable(),
    resultTruncated: z.boolean(),
  })
  .strict();

export const teamSchema = z
  .object({
    turnId: z.string().nullable(),
    members: z.array(memberSchema).max(100),
    runningCount: z.number().int().nonnegative().nullable(),
    knownRunningCount: z.number().int().nonnegative(),
    unknownCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export type Team = z.infer<typeof teamSchema>;
export type Member = z.infer<typeof memberSchema>;

export const historyEntrySchema = z
  .object({
    seq: z.number().int().nonnegative(),
    timestamp: z.number().nonnegative(),
    kind: z.enum(["assistant", "tool", "status"]),
    summary: z
      .object({ ru: z.string().max(500), en: z.string().max(500) })
      .strict(),
    itemId: z.string().nullable(),
    phase: z.enum(["started", "completed", "status"]),
    text: z.string().max(16_000),
    truncated: z.boolean(),
  })
  .strict();

export const historyInputSchema = z
  .object({
    threadId: z.string().min(1),
    agentId: z.string().min(1),
    beforeSeq: z.number().int().positive().nullable(),
  })
  .strict();

export const historyPageSchema = z
  .object({
    turnId: z.string().nullable(),
    agentId: z.string(),
    entries: z.array(historyEntrySchema).max(30),
    nextBeforeSeq: z.number().int().positive().nullable(),
    truncated: z.boolean(),
    promptsAvailable: z.literal(false),
  })
  .strict();

export type HistoryPage = z.infer<typeof historyPageSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const teamContract = defineRpcContract({
  current: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: teamSchema,
    tags: ({ threadId }) => [`team:${threadId}`],
  },
  history: {
    input: historyInputSchema,
    output: historyPageSchema,
    tags: ({ threadId }) => [`team:${threadId}`],
  },
});
