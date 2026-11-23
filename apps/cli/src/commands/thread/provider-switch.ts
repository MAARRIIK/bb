import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import {
  providerSwitchCommitRequestSchema,
  providerSwitchOperationRequestSchema,
  providerSwitchPreviewRequestSchema,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, reportCommandResult } from "../../command-result.js";
import { requireTextInput } from "../../text-input.js";
import { requireThreadIdOrSelf } from "../helpers.js";

interface PreviewOptions {
  self?: boolean;
  json?: boolean;
  provider: string;
  model: string;
  permissionMode: string;
  reasoningLevel?: string;
  serviceTier: string;
  summaryFile?: string;
  contextBudget: string;
  contextWindow?: string;
  out?: string;
}

export function registerProviderSwitchCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const group = parent
    .command("provider")
    .description("Preview and switch the provider in the same conversation");
  group
    .command("preview [id]")
    .description(
      "Build the exact context packet for review without sending a user request to the target model",
    )
    .requiredOption("--provider <id>", "Target agent provider")
    .requiredOption("--model <id>", "Target model from that provider's catalog")
    .option(
      "--permission-mode <mode>",
      "Explicit target permissions; full is required by some providers",
      "accept-edits",
    )
    .option(
      "--reasoning-level <level>",
      "Use a supported reasoning level; omitted uses the target model default",
    )
    .option("--service-tier <tier>", "Target service tier", "default")
    .option(
      "--summary-file <path>",
      "Use your summary instead of recent visible text; - reads stdin",
    )
    .option(
      "--context-budget <tokens>",
      "Conservative transfer budget, estimated from UTF-8 bytes",
      "8192",
    )
    .option(
      "--context-window <tokens>",
      "User-declared window; never presented as a verified serving limit",
    )
    .option(
      "--out <path>",
      "Write a private JSON review file; refuses to overwrite an existing file",
    )
    .option("--self", "Use the current thread")
    .option("--json", "Print the complete review object")
    .action(
      action(async (id: string | undefined, opts: PreviewOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const summary =
          opts.summaryFile === undefined
            ? null
            : await requireTextInput({
                file: opts.summaryFile,
                fileLabel: "--summary-file",
                inline: undefined,
                inlineLabel: "summary",
              });
        const request = providerSwitchPreviewRequestSchema.parse({
          providerId: opts.provider,
          model: opts.model,
          permissionMode: opts.permissionMode,
          reasoningLevel: opts.reasoningLevel ?? null,
          serviceTier: opts.serviceTier,
          context:
            summary === null
              ? { mode: "recent-messages" }
              : { mode: "summary", text: summary },
          contextTokenBudget: Number(opts.contextBudget),
          contextWindowTokens:
            opts.contextWindow === undefined
              ? null
              : Number(opts.contextWindow),
        });
        const preview = await createCliBbSdk(
          getUrl(),
        ).threads.experimental_providerSwitch.preview({ ...request, threadId });
        const review = { operationId: randomUUID(), preview };
        if (opts.out !== undefined)
          await writeFile(opts.out, JSON.stringify(review, null, 2) + "\n", {
            mode: 0o600,
            flag: "wx",
          });
        if (outputJson(opts, review)) return;
        console.log(preview.context.text);
        console.log(
          `Transfer: ${preview.context.estimatedTokens} conservative estimated tokens; ${preview.context.includedMessages} messages.`,
        );
        console.log(
          `Window: ${preview.context.windowTokens ?? "unknown"} (${preview.context.windowSource}; actual serving window unverified).`,
        );
        if (opts.out !== undefined)
          console.log(
            `Review saved to ${opts.out}. Switch with: bb thread provider switch ${threadId} --preview-file <review-file>`,
          );
        else console.log("Use --out <path> to save the review for switching.");
      }),
    );
  group
    .command("switch [id]")
    .description(
      "Apply a reviewed provider switch, keeping the thread ID and workspace",
    )
    .requiredOption(
      "--preview-file <path>",
      "JSON review produced by provider preview; the stored operation ID makes retries idempotent",
    )
    .option("--self", "Use the current thread")
    .option("--json", "Print the saved operation result")
    .action(
      action(
        async (
          id: string | undefined,
          opts: { self?: boolean; json?: boolean; previewFile: string },
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const raw: unknown = JSON.parse(
            await readFile(opts.previewFile, "utf8"),
          );
          const request = providerSwitchCommitRequestSchema.parse(raw);
          console.error(`Provider switch operation: ${request.operationId}`);
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.experimental_providerSwitch.commit({
            threadId,
            ...request,
          });
          reportCommandResult(opts, result, {
            text: [
              `Thread ${threadId}: ${result.phase} (${result.providerId}, ${result.model}).`,
            ],
            failure:
              result.phase === "rolled_back"
                ? {
                    code: result.errorCode ?? "provider_switch_rolled_back",
                    message:
                      "Provider switch rolled back; the previous provider was retained",
                    hint: `Check operation ${result.operationId} with bb thread provider status.`,
                  }
                : null,
          });
        },
      ),
    );
  for (const method of ["get", "recover"] as const) {
    group
      .command(`${method === "get" ? "status" : "recover"} [id]`)
      .description(
        method === "get"
          ? "Read a saved switch result after a disconnect"
          : "Reconcile an interrupted switch with its executor",
      )
      .requiredOption(
        "--operation-id <id>",
        "Operation UUID from the review or switch output",
      )
      .option("--self", "Use the current thread")
      .option("--json", "Print the operation result")
      .action(
        action(
          async (
            id: string | undefined,
            opts: { self?: boolean; json?: boolean; operationId: string },
          ) => {
            const threadId = requireThreadIdOrSelf(id, opts);
            const request = providerSwitchOperationRequestSchema.parse({
              operationId: opts.operationId,
            });
            const result = await createCliBbSdk(
              getUrl(),
            ).threads.experimental_providerSwitch[method]({
              threadId,
              ...request,
            });
            if (outputJson(opts, result)) return;
            console.log(
              `Thread ${threadId}: ${result.phase} (${result.providerId}, ${result.model}).`,
            );
          },
        ),
      );
  }
}
