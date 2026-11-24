import { createHash } from "node:crypto";
import {
  getEnvironment,
  getLastStoredProviderThreadId,
  getLatestThreadSequence,
  getProviderTransition,
  getThread,
  type ProviderTransitionRow,
} from "@bb/db";
import {
  providerSwitchPreviewSchema,
  type ProviderSwitchCommitRequest,
  type ProviderSwitchPreview,
  type ProviderSwitchPreviewRequest,
  type ProviderSwitchReceipt,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { resolveProviderTargetExecution } from "./provider-target-execution.js";
import { buildProviderSwitchContext } from "./provider-switch-context.js";
import { requireProviderTransitionSettled } from "./provider-transition-guard.js";
import {
  reconcileProviderTransition,
  startProviderTransition,
} from "./provider-transitions.js";

type Deps = LoggedPendingInteractionWorkSessionDeps;
const payloadSchema = providerSwitchPreviewSchema.omit({ fingerprint: true });

function fingerprint(
  payload: Omit<ProviderSwitchPreview, "fingerprint">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(payloadSchema.parse(payload)))
    .digest("hex");
}

function switchableThread(deps: Deps, threadId: string) {
  requireProviderTransitionSettled(deps.db, threadId);
  const thread = getThread(deps.db, threadId);
  if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
  if (
    thread.deletedAt !== null ||
    thread.archivedAt !== null ||
    (thread.status !== "idle" && thread.status !== "error")
  )
    throw new ApiError(
      409,
      "invalid_request",
      "Provider switching requires an idle writable thread",
      true,
    );
  const environment =
    thread.environmentId === null
      ? null
      : getEnvironment(deps.db, thread.environmentId);
  if (
    !environment ||
    environment.status !== "ready" ||
    environment.path === null
  )
    throw new ApiError(
      409,
      "invalid_request",
      "The thread workspace is not ready",
      true,
    );
  return { thread, environment };
}

export async function previewProviderSwitch(
  deps: Deps,
  args: { threadId: string; request: ProviderSwitchPreviewRequest },
): Promise<ProviderSwitchPreview> {
  const initial = switchableThread(deps, args.threadId);
  const { request } = args;
  const { execution, model } = await resolveProviderTargetExecution(deps, {
    environment: initial.environment,
    request,
  });
  const { thread, environment } = switchableThread(deps, args.threadId);
  if (
    thread.providerId !== initial.thread.providerId ||
    thread.providerSessionId !== initial.thread.providerSessionId ||
    thread.environmentId !== initial.thread.environmentId ||
    thread.modelOverride !== initial.thread.modelOverride ||
    thread.reasoningLevelOverride !== initial.thread.reasoningLevelOverride ||
    environment.hostId !== initial.environment.hostId
  )
    throw new ApiError(
      409,
      "invalid_request",
      "The thread changed while the target model was being checked",
      true,
    );
  const declaredWindow = model.experimental_contextWindowTokens ?? null;
  if (
    request.contextWindowTokens !== null &&
    declaredWindow !== null &&
    request.contextWindowTokens > declaredWindow
  )
    throw new ApiError(
      400,
      "invalid_request",
      "The requested window exceeds the capacity declared by the target model catalog",
    );
  const windowTokens = request.contextWindowTokens ?? declaredWindow;
  const tokenBudget =
    windowTokens === null
      ? request.contextTokenBudget
      : Math.min(request.contextTokenBudget, Math.floor(windowTokens / 4));
  if (tokenBudget < 512)
    throw new ApiError(
      400,
      "context_budget_exceeded",
      "The target context window is too small for this transfer",
    );
  const throughSequence = getLatestThreadSequence(deps.db, {
    threadId: thread.id,
  });
  const context = buildProviderSwitchContext(deps.db, {
    threadId: thread.id,
    throughSequence,
    tokenBudget,
    selection: request.context,
  });
  const payload: Omit<ProviderSwitchPreview, "fingerprint"> = {
    threadId: thread.id,
    environmentId: environment.id,
    hostId: environment.hostId,
    source: {
      providerId: thread.providerId,
      providerSessionId: thread.providerSessionId,
      providerThreadId: getLastStoredProviderThreadId(deps.db, thread.id),
      modelOverride: thread.modelOverride,
      reasoningLevelOverride: thread.reasoningLevelOverride,
    },
    request,
    execution,
    context: {
      ...context,
      throughSequence,
      tokenBudget,
      estimatedTokens: Buffer.byteLength(context.text),
      estimateMethod: "utf8-bytes",
      windowTokens,
      windowSource:
        request.contextWindowTokens !== null
          ? "user"
          : declaredWindow === null
            ? "unknown"
            : "provider",
      servedWindowVerified: false,
    },
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

function receipt(row: ProviderTransitionRow): ProviderSwitchReceipt {
  return {
    operationId: row.id,
    threadId: row.threadId,
    providerId: row.targetProviderId,
    model: row.execution.model,
    phase: row.phase,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requireOperation(deps: Deps, threadId: string, operationId: string) {
  const row = getProviderTransition(deps.db, operationId);
  if (!row || row.threadId !== threadId)
    throw new ApiError(
      404,
      "invalid_request",
      "Provider switch operation not found",
    );
  return row;
}

export function getProviderSwitch(
  deps: Deps,
  args: { threadId: string; operationId: string },
): ProviderSwitchReceipt {
  return receipt(requireOperation(deps, args.threadId, args.operationId));
}

export async function commitProviderSwitch(
  deps: Deps,
  args: { threadId: string; request: ProviderSwitchCommitRequest },
): Promise<ProviderSwitchReceipt> {
  const { preview, operationId } = args.request;
  const { fingerprint: expected, ...payload } = preview;
  if (preview.threadId !== args.threadId || fingerprint(payload) !== expected)
    throw new ApiError(
      409,
      "invalid_request",
      "The provider switch preview does not match this request",
    );
  if (getProviderTransition(deps.db, operationId) === null) {
    const current = await previewProviderSwitch(deps, {
      threadId: args.threadId,
      request: preview.request,
    });
    if (current.fingerprint !== expected)
      throw new ApiError(
        409,
        "provider_switch_preview_stale",
        "The conversation, connection or model changed. Review a fresh preview before switching.",
        true,
      );
  }
  return receipt(
    await startProviderTransition(deps, {
      id: operationId,
      threadId: preview.threadId,
      environmentId: preview.environmentId,
      hostId: preview.hostId,
      fingerprint: expected,
      sourceProviderId: preview.source.providerId,
      sourceProviderSessionId: preview.source.providerSessionId,
      sourceProviderThreadId: preview.source.providerThreadId,
      sourceModelOverride: preview.source.modelOverride,
      sourceReasoningLevelOverride: preview.source.reasoningLevelOverride,
      targetProviderId: preview.request.providerId,
      targetProviderSessionId: `ps_${operationId}`,
      execution: preview.execution,
      contextText: preview.context.text,
      contextThroughSequence: preview.context.throughSequence,
      contextTokenBudget: preview.context.tokenBudget,
      contextWindowTokens: preview.context.windowTokens,
      contextWindowSource: preview.context.windowSource,
      createdAt: Date.now(),
    }),
  );
}

export async function recoverProviderSwitch(
  deps: Deps,
  args: { threadId: string; operationId: string },
): Promise<ProviderSwitchReceipt> {
  const row = requireOperation(deps, args.threadId, args.operationId);
  return receipt(await reconcileProviderTransition(deps, row.id));
}
