import { describe, expect, it } from "vitest";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import {
  createQueuedThreadMessage,
  getQueuedThreadMessage,
  getThread,
  setQueuedThreadMessageGroupBoundary,
} from "@bb/db";
import { seedProviderTransitionInput } from "../helpers/provider-transitions.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { textInput } from "../helpers/prompt-input.js";
import { listEvents } from "@bb/db/testing";
import { clientTurnRequestIdSchema } from "@bb/domain";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";

function fixture(harness: TestAppHarness) {
  const data = seedProviderTransitionInput(harness);
  registerProviderHostRpcResponder(harness, {
    hostId: data.host.id,
    sessionId: data.session.id,
    restoreCommandCaptureAfterResponse: true,
    modelsByProviderId: {
      codex: {
        models: [
          availableModelFixture({
            model: "gpt-5",
            reasoningLevels: ["medium"],
            isDefault: true,
          }),
        ],
        selectedOnlyModels: [],
      },
      "claude-code": {
        models: [
          availableModelFixture({
            model: "assigned-model",
            reasoningLevels: ["medium"],
            isDefault: true,
          }),
        ],
        selectedOnlyModels: [],
      },
    },
  });
  const api = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://localhost",
      runtime: "node",
      fetch: async (input, init) => harness.app.fetch(new Request(input, init)),
    }),
  }).threads.queuedMessages;
  return { ...data, api };
}

const target = {
  providerId: "claude-code",
  model: "assigned-model",
  permissionMode: "accept-edits" as const,
};

describe("assigning a provider to a queued task", () => {
  it.each(["create", "update"] as const)(
    "keeps a %s assignment without switching or sending to the current provider",
    async (mode) => {
      await withTestHarness(async (harness) => {
        const { api, thread } = fixture(harness);
        const row =
          mode === "create"
            ? await api.create({
                threadId: thread.id,
                input: textInput("For the assigned agent"),
                ...target,
              })
            : await api.create({
                threadId: thread.id,
                input: textInput("For the assigned agent"),
                model: "gpt-5",
              });
        const assigned =
          mode === "create"
            ? row
            : await api.update({
                threadId: thread.id,
                queuedMessageId: row.id,
                expectedUpdatedAt: row.updatedAt,
                ...target,
              });
        expect(assigned).toMatchObject({
          providerId: "claude-code",
          model: "assigned-model",
          reasoningLevel: "medium",
          permissionMode: "accept-edits",
        });
        expect(getThread(harness.db, thread.id)).toMatchObject({
          providerId: "codex",
          providerSessionId: null,
        });
        expect(
          getQueuedThreadMessage(harness.db, row.id)?.providerSessionId,
        ).toBeNull();
        await runQueuedMessageDispatch(harness.deps, {
          kind: "idle-recovery",
          now: Date.now(),
        });
        expect(
          getQueuedThreadMessage(harness.db, row.id)?.failureReason,
        ).toContain("assigned to claude-code");
        expect(
          listEvents(harness.db, { threadId: thread.id }).filter(
            (event) => event.type === "client/turn/requested",
          ),
        ).toEqual([]);
        const edited = await api.update({
          threadId: thread.id,
          queuedMessageId: row.id,
          expectedUpdatedAt:
            getQueuedThreadMessage(harness.db, row.id)?.updatedAt ??
            assigned.updatedAt,
          reasoningLevel: "medium",
        });
        expect(edited.providerId).toBe("claude-code");
      });
    },
  );

  it.each([
    { model: undefined, permissionMode: "accept-edits" },
    { model: "assigned-model", permissionMode: undefined },
    { model: "not-in-catalog", permissionMode: "accept-edits" },
  ])(
    "requires explicit valid target options: $model / $permissionMode",
    async (options) => {
      await withTestHarness(async (harness) => {
        const { api, thread } = fixture(harness);
        await expect(
          api.create({
            threadId: thread.id,
            input: textInput("Do not send"),
            providerId: "claude-code",
            model: options.model,
            permissionMode:
              options.permissionMode === "accept-edits"
                ? "accept-edits"
                : undefined,
          }),
        ).rejects.toMatchObject({ status: 400 });
        expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      });
    },
  );

  it("pins a legacy row when the current provider is explicitly assigned", async () => {
    await withTestHarness(async (harness) => {
      const { api, thread } = fixture(harness);
      const sendAt = Date.now() + 3_600_000;
      const row = createQueuedThreadMessage(harness.db, harness.hub, {
        threadId: thread.id,
        providerId: null,
        providerSessionId: null,
        content: textInput("Legacy task"),
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "accept-edits",
        serviceTier: "default",
        waitingOn: { kind: "time" },
        sendAt,
        payload: { kind: "inline" },
        systemNotice: null,
      });
      const assigned = await api.update({
        threadId: thread.id,
        queuedMessageId: row.id,
        expectedUpdatedAt: row.updatedAt,
        providerId: "codex",
        model: "gpt-5",
        permissionMode: "accept-edits",
      });
      expect(assigned).toMatchObject({ providerId: "codex", sendAt });
      expect(getQueuedThreadMessage(harness.db, row.id)?.providerId).toBe(
        "codex",
      );
    });
  });

  it.each(["retry", "notice"] as const)(
    "does not reassign a %s",
    async (kind) => {
      await withTestHarness(async (harness) => {
        const { api, thread } = fixture(harness);
        const row = createQueuedThreadMessage(harness.db, harness.hub, {
          threadId: thread.id,
          providerId: kind === "notice" ? null : "codex",
          providerSessionId: null,
          content: textInput("Held"),
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "accept-edits",
          serviceTier: "default",
          waitingOn: { kind: "thread-busy" },
          sendAt: null,
          payload:
            kind === "retry"
              ? {
                  kind: "retry",
                  retryOfTurnRequestId:
                    clientTurnRequestIdSchema.parse("creq_assignre22"),
                  attempt: 2,
                  reason: "Try again",
                }
              : { kind: "inline" },
          systemNotice:
            kind === "notice"
              ? {
                  kind: "child-outcome-batch",
                  subject: { kind: "thread-batch", count: 1 },
                }
              : null,
        });
        await expect(
          api.update({
            threadId: thread.id,
            queuedMessageId: row.id,
            expectedUpdatedAt: row.updatedAt,
            ...target,
          }),
        ).rejects.toMatchObject({
          status: 409,
          body: {
            message:
              "Retries and system notices cannot be assigned to another provider",
          },
        });
        expect(getQueuedThreadMessage(harness.db, row.id)?.providerId).toBe(
          row.providerId,
        );
      });
    },
  );

  it("refuses reassignment of one grouped row and preserves the entire group", async () => {
    await withTestHarness(async (harness) => {
      const { api, thread } = fixture(harness);
      const first = await api.create({
        threadId: thread.id,
        input: textInput("One"),
        model: "gpt-5",
      });
      const second = await api.create({
        threadId: thread.id,
        input: textInput("Two"),
        model: "gpt-5",
      });
      setQueuedThreadMessageGroupBoundary({
        db: harness.db,
        notifier: harness.hub,
        threadId: thread.id,
        expectedGroupedPrefixQueuedMessageIds: [first.id, second.id],
        groupBoundaryQueuedMessageId: second.id,
      });
      const version = getQueuedThreadMessage(harness.db, second.id)?.updatedAt;
      if (version === undefined) throw Error("Missing queued row");
      await expect(
        api.update({
          threadId: thread.id,
          queuedMessageId: second.id,
          expectedUpdatedAt: version,
          ...target,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(getQueuedThreadMessage(harness.db, first.id)?.providerId).toBe(
        "codex",
      );
      expect(getQueuedThreadMessage(harness.db, second.id)?.providerId).toBe(
        "codex",
      );
    });
  });
});
