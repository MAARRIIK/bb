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

describe("queued task dependencies migration", () => {
  it("keeps existing queue assignments and schedules with an empty dependency list", () => {
    const db = createMigratedConnection();
    try {
      const thread = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "codex",
      });
      const original = ["codex", "pi"].map((providerId) =>
        createQueuedThreadMessage(db, noopNotifier, {
          dependsOnQueuedMessageIds: [],
          threadId: thread.id,
          providerId,
          providerSessionId: "saved-generation",
          providerSwitchPolicy:
            providerId === "pi" ? "recent-messages" : "manual",
          content: [
            { type: "text", text: `Task for ${providerId}`, mentions: [] },
          ],
          model: "saved-model",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          waitingOn: { kind: "time" },
          sendAt: Date.now() + 60_000,
          payload: { kind: "inline" },
          systemNotice: null,
        }),
      );
      const columns = db.$client
        .prepare<
          [],
          {
            name: string;
            type: string;
            notnull: number;
            pk: number;
            dflt_value: string | null;
          }
        >("PRAGMA table_info(queued_thread_messages)")
        .all()
        .filter((column) => column.name !== "depends_on_queued_message_ids");
      const definitions = columns
        .map((column) =>
          [
            `"${column.name}" ${column.type}`,
            column.pk ? "PRIMARY KEY" : "",
            column.notnull ? "NOT NULL" : "",
            column.dflt_value === null ? "" : `DEFAULT ${column.dflt_value}`,
            column.name === "thread_id"
              ? "REFERENCES threads(id) ON DELETE cascade"
              : "",
          ]
            .filter((part) => part !== "")
            .join(" "),
        )
        .join(", ");
      const names = columns.map((column) => `"${column.name}"`).join(", ");
      db.$client.exec(`
        DROP INDEX events_thread_type_provider_session_sequence_idx;
        DROP TABLE queued_task_runs;
        CREATE TABLE __old_queued_thread_messages (${definitions});
        INSERT INTO __old_queued_thread_messages (${names}) SELECT ${names} FROM queued_thread_messages;
        DROP TABLE queued_thread_messages;
        ALTER TABLE __old_queued_thread_messages RENAME TO queued_thread_messages;
        DELETE FROM __drizzle_migrations WHERE created_at >= 1795515991551;
      `);

      migrate(db);
      migrate(db);

      for (const row of original)
        expect(getQueuedThreadMessage(db, row.id)).toEqual({
          ...row,
          dependsOnQueuedMessageIds: [],
        });
      expect(db.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.$client.close();
    }
  });
});
