import { z } from "zod";

export const workflowWorkspaceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shared") }).strict(),
  z
    .object({
      type: z.literal("worktree"),
      baseBranch: z.string().trim().min(1),
    })
    .strict(),
]);

export type WorkflowWorkspace = z.infer<typeof workflowWorkspaceSchema>;
