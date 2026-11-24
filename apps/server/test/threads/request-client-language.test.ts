import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getQueuedThreadMessage, listQueuedThreadMessages } from "@bb/db";
import { sendMessageResponseSchema } from "@bb/server-contract";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import { sendQueuedMessageNow } from "../../src/services/threads/queued-messages.js";
import { listQueuedThreadCommands } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function readyThread(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "native-client-language",
    threadId: thread.id,
  });
  return { thread, environment, project };
}

async function enqueue(
  harness: TestAppHarness,
  threadId: string,
  args: { language?: string; bodyLanguage?: "en" | "ru" | null; text: string },
) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/send`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(args.language === undefined
          ? {}
          : { "x-bb-client-language": args.language }),
      },
      body: JSON.stringify({
        input: textInput(args.text),
        mode: "start",
        sendAt: Date.now() + 172_800_000,
        ...(args.bodyLanguage === undefined
          ? {}
          : { clientLanguage: args.bodyLanguage }),
      }),
    },
  );
  expect(response.status).toBe(200);
  const sent = sendMessageResponseSchema.parse(await readJson(response));
  if (sent.delivery !== "queued")
    throw new Error("Expected a scheduled message");
  return sent.queuedMessage;
}

function recordSourceLanguage(
  harness: TestAppHarness,
  threadId: string,
  environmentId: string,
  language: "en" | "ru",
) {
  appendClientTurnEvent(harness.deps, {
    type: "client/turn/requested",
    threadId,
    environmentId,
    clientLanguage: language,
    input: textInput("A different client's request"),
    initiator: "user",
    senderThreadId: null,
    originPluginId: null,
    execution: {
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    requestMethod: "turn/start",
    source: "tell",
    target: { kind: "new-turn" },
  });
}

describe("request client language", () => {
  it("captures the device language with a scheduled request without changing its text", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = readyThread(harness);
      const text = "English prompt / Русский / {language} / $&";
      const queued = await enqueue(harness, thread.id, {
        language: "ru",
        text,
      });
      expect(queued.payload).toMatchObject({
        kind: "inline",
        clientLanguage: "ru",
      });
      expect(queued.content).toEqual(textInput(text));
    });
  });

  it.each([
    { bodyLanguage: "en", expected: "en" },
    { bodyLanguage: null, expected: null },
  ] as const)(
    "gives explicit body $bodyLanguage precedence over the device header and inheritance",
    async ({ bodyLanguage, expected }) => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = readyThread(harness);
        recordSourceLanguage(harness, thread.id, environment.id, "ru");
        const queued = await enqueue(harness, thread.id, {
          language: "ru",
          bodyLanguage,
          text: "Literal content",
        });
        expect(
          getQueuedThreadMessage(harness.db, queued.id)?.clientLanguage,
        ).toBe(expected);
      });
    },
  );

  it.each([
    { language: "fr", bodyLanguage: undefined },
    { language: "ru", bodyLanguage: "fr" },
  ])(
    "rejects unsupported hint $language / $bodyLanguage before queueing work",
    async ({ language, bodyLanguage }) => {
      await withTestHarness(async (harness) => {
        const { thread } = readyThread(harness);
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-bb-client-language": language,
            },
            body: JSON.stringify({
              input: textInput("Must not queue"),
              mode: "start",
              sendAt: Date.now() + 172_800_000,
              ...(bodyLanguage === undefined
                ? {}
                : { clientLanguage: bodyLanguage }),
            }),
          },
        );
        expect(response.status).toBe(400);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      });
    },
  );

  it("preserves a queued language through time edits and a later client's request, and prevents mixed-language grouping", async () => {
    await withTestHarness(async (harness) => {
      const { thread, environment } = readyThread(harness);
      const russian = await enqueue(harness, thread.id, {
        language: "ru",
        text: "First original request",
      });
      const english = await enqueue(harness, thread.id, {
        language: "en",
        text: "Second original request",
      });
      const edit = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${russian.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-bb-client-language": "en",
          },
          body: JSON.stringify({
            expectedUpdatedAt: russian.updatedAt,
            sendAt: Date.now() + 259_200_000,
          }),
        },
      );
      expect(edit.status).toBe(200);
      expect(await readJson(edit)).toMatchObject({
        payload: { clientLanguage: "ru" },
      });
      const group = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/group-boundary`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedGroupedPrefixQueuedMessageIds: [russian.id, english.id],
            groupBoundaryQueuedMessageId: english.id,
          }),
        },
      );
      expect(group.status).toBe(409);
      recordSourceLanguage(harness, thread.id, environment.id, "en");
      await sendQueuedMessageNow(harness.deps, {
        threadId: thread.id,
        queuedMessageId: russian.id,
        mode: "auto",
      });
      const [command] = listQueuedThreadCommands(
        harness,
        "turn.submit",
        thread.id,
      );
      expect(command).toMatchObject({
        type: "turn.submit",
        input: [
          expect.objectContaining({
            visibility: "agent-only",
            text: expect.stringContaining(
              "Use Russian for user-facing explanations",
            ),
          }),
          ...russian.content,
        ],
      });
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
      ).toEqual([english.id]);
    });
  });

  it("inherits a caller's language at acceptance for agent requests and child threads", async () => {
    await withTestHarness(async (harness) => {
      const { thread, environment, project } = readyThread(harness);
      recordSourceLanguage(harness, thread.id, environment.id, "ru");
      const queued = await enqueue(harness, thread.id, {
        text: "Agent continuation",
      });
      expect(queued.payload).toMatchObject({ clientLanguage: "ru" });
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          providerId: "codex",
          origin: "sdk",
          parentThreadId: thread.id,
          input: textInput("Child task"),
          environment: { type: "reuse", environmentId: environment.id },
          sendAt: Date.now() + 172_800_000,
        }),
      });
      expect(response.status).toBe(201);
      const child = z
        .object({ id: z.string() })
        .parse(await readJson(response));
      expect(listQueuedThreadMessages(harness.db, child.id)).toMatchObject([
        { clientLanguage: "ru" },
      ]);
    });
  });
});
