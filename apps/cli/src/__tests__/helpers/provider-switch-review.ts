import type { ProviderSwitchPreview } from "@bb/server-contract";

export function makeProviderSwitchPreview(ids: {
  threadId: string;
  environmentId: string;
  hostId: string;
}): ProviderSwitchPreview {
  return {
    threadId: ids.threadId,
    environmentId: ids.environmentId,
    hostId: ids.hostId,
    source: {
      providerId: "codex",
      providerSessionId: null,
      providerThreadId: null,
      modelOverride: null,
      reasoningLevelOverride: null,
    },
    request: {
      providerId: "pi",
      model: "ollama/qwen",
      permissionMode: "full",
      reasoningLevel: null,
      serviceTier: "default",
      context: { mode: "recent-messages" },
      contextTokenBudget: 8192,
      contextWindowTokens: null,
    },
    execution: {
      model: "ollama/qwen",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    context: {
      text: "Reviewed context",
      throughSequence: 8,
      tokenBudget: 8192,
      estimatedTokens: 16,
      estimateMethod: "utf8-bytes",
      includedMessages: 1,
      hasOlderHistory: false,
      omittedOversizedEvents: 0,
      completeness: "recent-messages",
      windowTokens: null,
      windowSource: "unknown",
      servedWindowVerified: false,
    },
    fingerprint: "b".repeat(64),
  };
}
