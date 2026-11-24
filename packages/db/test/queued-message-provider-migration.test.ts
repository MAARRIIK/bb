import { dropQueuedTaskDependencies } from "./helpers/rewind.js";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  createQueuedThreadMessage,
  createThread,
  getQueuedThreadMessage,
  migrate,
  noopNotifier,
} from "../src/index.js";
import { createMigratedConnection } from "../src/testing.js";

describe("queued message provider migration", () => {
  it("preserves legacy messages without inventing their provider and stores new assignments", () => {
    const db = createMigratedConnection();
    try {
      const thread = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "codex",
      });
      const input = {
        providerSwitchPolicy: "manual" as const,
        dependsOnQueuedMessageIds: [],
        threadId: thread.id,
        providerId: "codex",
        providerSessionId: "source-generation",
        content: [
          { type: "text" as const, text: "Keep my request", mentions: [] },
        ],
        model: "shared-model",
        reasoningLevel: "medium",
        permissionMode: "full" as const,
        serviceTier: "default",
        sendAt: 100_000,
        waitingOn: { kind: "time" as const },
        payload: { kind: "inline" as const },
        systemNotice: null,
      };
      const legacy = createQueuedThreadMessage(db, noopNotifier, input);
      dropQueuedTaskDependencies(db);
      db.$client.exec(
        "ALTER TABLE queued_thread_messages DROP COLUMN provider_switch_policy",
      );
      db.$client.exec(
        "ALTER TABLE queued_thread_messages DROP COLUMN provider_switch_operation_id",
      );
      db.$client.exec(
        "ALTER TABLE queued_thread_messages DROP COLUMN provider_session_id",
      );
      db.$client.exec(
        "ALTER TABLE queued_thread_messages DROP COLUMN provider_id",
      );
      db.$client
        .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
        .run(1795467745878);

      migrate(db);
      migrate(db);

      expect(getQueuedThreadMessage(db, legacy.id)).toEqual({
        ...legacy,
        providerId: null,
        providerSessionId: null,
      });
      const assigned = createQueuedThreadMessage(db, noopNotifier, {
        ...input,
        providerId: "pi",
        providerSwitchPolicy: "recent-messages",
      });
      expect(getQueuedThreadMessage(db, assigned.id)?.providerId).toBe("pi");
      expect(getQueuedThreadMessage(db, assigned.id)?.providerSessionId).toBe(
        "source-generation",
      );
      migrate(db);
      expect(
        getQueuedThreadMessage(db, assigned.id)?.providerSwitchPolicy,
      ).toBe("recent-messages");
      expect(getQueuedThreadMessage(db, legacy.id)?.providerSwitchPolicy).toBe(
        "manual",
      );
    } finally {
      db.$client.close();
    }
  });
});
