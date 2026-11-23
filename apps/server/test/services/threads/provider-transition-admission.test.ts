import { describe, expect, it } from "vitest";
import {
  advanceProviderTransition,
  beginProviderTransitionInTransaction,
  commitProviderTransitionInTransaction,
  getLatestThreadSequence,
  getThread,
} from "@bb/db";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { seedProviderTransitionInput } from "../../helpers/provider-transitions.js";
import { sendThreadMessage } from "../../../src/services/threads/thread-send.js";
import { clearThreadContext } from "../../../src/services/threads/thread-context-clear.js";
import { applyThreadExecutionOverride } from "../../../src/services/threads/thread-execution-override.js";
import { applyThreadSessionOptionPatch } from "../../../src/services/threads/thread-session-options.js";
import { getLastExecutionOptions } from "../../../src/services/threads/thread-events.js";

function fixture(harness: TestAppHarness) {
  const {
    thread,
    environment,
    input: defaults,
  } = seedProviderTransitionInput(harness);
  const input = {
    ...defaults,
    id: "transition-admission",
    targetProviderId: "codex",
    execution: { ...defaults.execution, model: "gpt-5" },
  };
  const transition = harness.db.transaction((tx) =>
    beginProviderTransitionInTransaction(tx, input),
  );
  if (!transition) throw new Error("Fixture could not begin its transition");
  return { thread, environment, transition };
}

describe("durable provider transition admission", () => {
  it.each(["send", "clear", "model", "session-options"] as const)(
    "blocks %s from the persisted intent without an in-memory transition lease",
    async (action) => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = fixture(harness);
        const before = getLatestThreadSequence(harness.db, {
          threadId: thread.id,
        });
        const run = async () => {
          if (action === "send")
            return sendThreadMessage(harness.deps, {
              thread,
              environment,
              payload: {
                input: [{ type: "text", text: "Continue", mentions: [] }],
                mode: "start",
              },
              trigger: "user",
              originPluginId: null,
            });
          if (action === "clear")
            return clearThreadContext(harness.deps, { thread, environment });
          if (action === "model")
            return applyThreadExecutionOverride(harness.deps, {
              thread,
              patch: { model: "gpt-5" },
            });
          return applyThreadSessionOptionPatch(harness.deps, {
            thread,
            patch: { daybreak: true },
          });
        };
        await expect(run()).rejects.toMatchObject({
          status: 409,
          body: {
            retryable: true,
            details: {
              transitionId: "transition-admission",
              phase: "preparing",
            },
          },
        });
        expect(
          getLatestThreadSequence(harness.db, { threadId: thread.id }),
        ).toBe(before);
        expect(getThread(harness.db, thread.id)?.providerSessionId).toBeNull();
      });
    },
  );

  it("preserves the chosen permission mode before the first target request is recorded", async () => {
    await withTestHarness(async (harness) => {
      const { thread, transition } = fixture(harness);
      let row = transition;
      for (const phase of ["prepared", "adopting"] as const) {
        const next = advanceProviderTransition(harness.db, {
          id: row.id,
          expectedRevision: row.revision,
          expectedPhase: row.phase,
          phase,
          targetProviderThreadId: "target-native",
          errorCode: null,
          now: Date.now(),
        });
        if (!next) throw new Error("Fixture phase unexpectedly conflicted");
        row = next;
      }
      expect(
        harness.db.transaction((tx) =>
          commitProviderTransitionInTransaction(tx, {
            id: row.id,
            expectedRevision: row.revision,
            now: Date.now(),
          }),
        ),
      ).not.toBeNull();
      expect(getLastExecutionOptions(harness.deps, thread.id)).toMatchObject({
        model: "gpt-5",
        permissionMode: "accept-edits",
        reasoningLevel: "medium",
      });
    });
  });
});
