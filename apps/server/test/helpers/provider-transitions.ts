import { beginProviderTransitionInTransaction } from "@bb/db";
import type { TestAppHarness } from "./test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "./seed.js";

export function seedProviderTransitionInput(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
    status: "idle",
  });
  const input: Parameters<typeof beginProviderTransitionInTransaction>[1] = {
    id: "transition-test",
    threadId: thread.id,
    environmentId: environment.id,
    hostId: host.id,
    fingerprint: "b".repeat(64),
    sourceProviderId: thread.providerId,
    sourceProviderSessionId: thread.providerSessionId,
    sourceProviderThreadId: null,
    sourceModelOverride: thread.modelOverride,
    sourceReasoningLevelOverride: thread.reasoningLevelOverride,
    targetProviderId: "claude-code",
    targetProviderSessionId: "next-generation",
    execution: {
      model: "claude-sonnet-4-5",
      reasoningLevel: "medium",
      serviceTier: "default",
      permissionMode: "accept-edits",
      source: "client/turn/requested",
    },
    contextText: "Previous conversation",
    contextThroughSequence: 0,
    contextTokenBudget: 4096,
    contextWindowTokens: null,
    contextWindowSource: "unknown",
    createdAt: Date.now(),
  };
  return { thread, environment, host, session, input };
}
