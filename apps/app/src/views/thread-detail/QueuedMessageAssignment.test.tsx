// @vitest-environment jsdom

import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeProviderInfo,
  makeThreadQueuedMessage,
} from "@bb/test-helpers/domain-fixtures";
import { createDeferredPromise } from "@bb/test-helpers";
import type { ThreadQueuedMessage } from "@bb/domain";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { threadQueuedMessagesQueryKey } from "@/hooks/queries/query-keys";
import { subscribeComposerSubmitted } from "@/lib/composer-submissions";
import { sdk } from "@/lib/sdk";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { QueuedMessageAssignment } from "./QueuedMessageAssignment";
import { QueueDraftWithModel } from "./QueueDraftWithModel";

const state = vi.hoisted(() => ({ placeholder: false, error: false }));
const providers = [
  makeProviderInfo({ id: "codex", displayName: "Codex" }),
  makeProviderInfo({
    id: "pi",
    displayName: "Pi",
    capabilities: { permissionModes: ["full"] },
  }),
];
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: providers }),
  useSystemExecutionOptions: ({ providerId }: { providerId: string }) => ({
    data: {
      providers,
      models: [
        {
          id: providerId,
          model: `${providerId}-model`,
          displayName: `${providerId} model`,
          description: "",
          reasoningDiscovery: "known",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
      modelLoadError: state.error
        ? { code: "provider_unavailable", providerId }
        : null,
    },
    isFetching: false,
    isPlaceholderData: state.placeholder,
    isError: false,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.placeholder = false;
  state.error = false;
});

let nextDraftId = 0;

function draftFixture(
  compact = false,
  queuedMessages: ThreadQueuedMessage[] = [],
) {
  const threadId = `thr_queue_draft_${++nextDraftId}`;
  const draft = getPromptDraftAccessor({
    kind: "thread",
    projectId: "proj_queue_draft",
    threadId,
  });
  const original = {
    text: "Read the attached design",
    mentions: [],
    attachments: [
      {
        type: "localFile" as const,
        path: "uploads/design.txt",
        name: "design.txt",
      },
    ],
  };
  draft.setDraft(original);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  queryClient.setQueryData(threadQueuedMessagesQueryKey(threadId), []);
  const create = vi.spyOn(sdk.threads.queuedMessages, "create");
  const send = vi.spyOn(sdk.threads, "send");
  const update = vi.spyOn(sdk.threads.queuedMessages, "update");
  const element = (
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <QueryClientProvider client={queryClient}>
        <QueueDraftWithModel
          queuedMessages={queuedMessages}
          draft={draft}
          threadId={threadId}
          environmentId="env_assignment"
          initial={{
            providerId: "codex",
            providerSwitchPolicy: "manual",
            dependsOnQueuedMessageIds: [],
            model: "codex-model",
            permissionMode: "accept-edits",
            reasoningLevel: "medium",
            serviceTier: "default",
          }}
          disabled={false}
        />
      </QueryClientProvider>
    </CompactViewportOverrideProvider>
  );
  const view = render(element);
  return {
    draft,
    original,
    threadId,
    queryClient,
    create,
    send,
    update,
    unmount: view.unmount,
    remount: () => render(element),
  };
}

async function selectDraftModel() {
  fireEvent.click(screen.getByRole("button", { name: "Queue with model" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "Provider" }), {
    target: { value: "pi" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Permissions" }), {
    target: { value: "full" },
  });
}

describe("queue the composer draft with a model", () => {
  it.each(["manual", "recent-messages"] as const)(
    "creates once with the full %s assignment and attachments before any dispatch",
    async (policy) => {
      const { draft, original, create, send, update, threadId, queryClient } =
        draftFixture(false, [
          makeThreadQueuedMessage({
            id: "qmsg_parent",
            content: [{ type: "text", text: "Parent task", mentions: [] }],
          }),
        ]);
      const response = createDeferredPromise<ThreadQueuedMessage>();
      create.mockReturnValue(response.promise);
      const submitted = vi.fn();
      const dispose = subscribeComposerSubmitted(
        { kind: "thread", threadId },
        submitted,
      );
      try {
        await selectDraftModel();
        fireEvent.click(screen.getByRole("checkbox", { name: "Parent task" }));
        if (policy === "recent-messages")
          fireEvent.click(
            screen.getByRole("checkbox", { name: /Switch automatically/ }),
          );
        const add = screen.getByRole("button", { name: "Add to queue" });
        fireEvent.click(add);
        fireEvent.click(add);
        await waitFor(() => expect(create).toHaveBeenCalledOnce());
        expect(create).toHaveBeenCalledWith({
          threadId,
          providerId: "pi",
          dependsOnQueuedMessageIds: ["qmsg_parent"],
          providerSwitchPolicy: policy,
          model: "pi-model",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
          input: [
            { type: "text", text: original.text, mentions: [] },
            {
              type: "localFile",
              path: "uploads/design.txt",
              name: "design.txt",
            },
          ],
        });
        expect(send).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(draft.getCurrent()).toEqual({
          text: "",
          mentions: [],
          attachments: [],
        });
        expect(submitted).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(screen.getByRole("dialog")).toBeTruthy();
        await act(async () =>
          response.resolve(
            makeThreadQueuedMessage({
              threadId,
              providerId: "pi",
              providerSwitchPolicy: policy,
            }),
          ),
        );
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(submitted).toHaveBeenCalledOnce();
        expect(
          queryClient.getQueryState(threadQueuedMessagesQueryKey(threadId))
            ?.isInvalidated,
        ).toBe(true);
      } finally {
        dispose();
      }
    },
  );

  it("restores a rejected draft alongside newer edits and retries with the selected model", async () => {
    const { draft, original, create, threadId } = draftFixture();
    const response = createDeferredPromise<ThreadQueuedMessage>();
    create.mockReturnValueOnce(response.promise);
    await selectDraftModel();
    fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    act(() =>
      draft.setDraft({ text: "New thought", mentions: [], attachments: [] }),
    );
    await act(async () =>
      response.reject(new Error("Executor is unavailable")),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Executor is unavailable",
    );
    expect(draft.getCurrent()).toEqual({
      ...original,
      text: `${original.text}\n\nNew thought`,
    });
    create.mockResolvedValueOnce(
      makeThreadQueuedMessage({ threadId, providerId: "pi" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      threadId,
      providerId: "pi",
      model: "pi-model",
      providerSwitchPolicy: "manual",
      dependsOnQueuedMessageIds: [],
      input: [
        { type: "text", text: `${original.text}\n\nNew thought`, mentions: [] },
        { type: "localFile", path: "uploads/design.txt", name: "design.txt" },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps text and attachments when the compact form is cancelled", async () => {
    const { draft, original, create } = draftFixture(true);
    await selectDraftModel();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Switch automatically/ }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(draft.getCurrent()).toEqual(original);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not enqueue a draft removed while the form was open", async () => {
    const { draft, create } = draftFixture();
    await selectDraftModel();
    act(() => draft.clear());
    fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Type a message before adding it to the queue.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks another assignment after remount while the same draft is submitting", async () => {
    const { draft, create, unmount, remount, threadId } = draftFixture();
    const response = createDeferredPromise<ThreadQueuedMessage>();
    create.mockReturnValue(response.promise);
    await selectDraftModel();
    fireEvent.click(screen.getByRole("button", { name: "Add to queue" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    act(() =>
      draft.setDraft({ text: "Next task", mentions: [], attachments: [] }),
    );
    unmount();
    remount();
    const trigger = screen.getByRole("button", { name: "Queue with model" });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () =>
      response.resolve(makeThreadQueuedMessage({ threadId })),
    );
    await waitFor(() => expect(trigger).toHaveProperty("disabled", false));
    expect(create).toHaveBeenCalledOnce();
    expect(draft.getCurrent().text).toBe("Next task");
  });
});

function fixture(compact = false) {
  const onSelect = vi.fn();
  const appRoot = document.createElement("div");
  appRoot.id = "root";
  document.body.append(appRoot);
  render(
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <QueryClientProvider client={new QueryClient()}>
        <QueuedMessageAssignment
          queuedMessages={[]}
          currentProviderId="codex"
          environmentId="env_assignment"
          edit={{
            editSessionId: 1,
            expectedUpdatedAt: 1,
            providerId: "codex",
            providerSwitchPolicy: "manual",
            dependsOnQueuedMessageIds: [],
            model: "codex-model",
            reasoningLevel: "medium",
            permissionMode: "accept-edits",
            serviceTier: "default",
            ownerThreadId: "thr_assignment",
            queuedMessageId: "qmsg_assignment",
            queuedMessageIndex: 0,
            draft: { text: "Keep my task", mentions: [], attachments: [] },
            initialDraft: {
              text: "Keep my task",
              mentions: [],
              attachments: [],
            },
          }}
          onSelect={onSelect}
        />
      </QueryClientProvider>
    </CompactViewportOverrideProvider>,
    { container: appRoot },
  );
  return onSelect;
}

describe("queued task assignment", () => {
  it("keeps the application root accessible while the form is open", async () => {
    fixture();
    fireEvent.click(screen.getByRole("button", { name: "Assign task model" }));
    await screen.findByRole("combobox", { name: "Provider" });
    expect(
      document.getElementById("root")?.getAttribute("aria-hidden"),
    ).not.toBe("true");
    expect(document.getElementById("root")?.inert).not.toBe(true);
  });

  it("requires permissions after a provider change and applies only the selected task tuple", async () => {
    const onSelect = fixture();
    fireEvent.click(screen.getByRole("button", { name: "Assign task model" }));
    const provider = await screen.findByRole("combobox", { name: "Provider" });
    const automatic = screen.getByRole("checkbox", {
      name: /Switch automatically/,
    });
    expect(automatic).toHaveProperty("checked", false);
    fireEvent.click(automatic);
    fireEvent.change(provider, { target: { value: "pi" } });
    expect(automatic).toHaveProperty("checked", false);
    expect(
      screen
        .getByRole("button", { name: "Use for this task" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Permissions" }), {
      target: { value: "full" },
    });
    fireEvent.click(automatic);
    fireEvent.click(screen.getByRole("button", { name: "Use for this task" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      dependsOnQueuedMessageIds: [],
      providerId: "pi",
      providerSwitchPolicy: "recent-messages",
      model: "pi-model",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
    });
  });

  it.each(["placeholder", "error"] as const)(
    "does not accept an unverified %s catalog",
    async (failure) => {
      state[failure] = true;
      const onSelect = fixture();
      fireEvent.click(
        screen.getByRole("button", { name: "Assign task model" }),
      );
      await screen.findByRole("combobox", { name: "Provider" });
      const apply = screen.getByRole("button", { name: "Use for this task" });
      expect(apply.hasAttribute("disabled")).toBe(true);
      fireEvent.click(apply);
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "discards provider and context consent changes when dismissed (compact: %s)",
    async (compact) => {
      const onSelect = fixture(compact);
      fireEvent.click(
        screen.getByRole("button", { name: "Assign task model" }),
      );
      fireEvent.change(
        await screen.findByRole("combobox", { name: "Provider" }),
        { target: { value: "pi" } },
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Switch automatically/ }),
      );
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull(),
      );
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Assign task model" }),
      );
      expect(
        await screen.findByRole("checkbox", { name: /Switch automatically/ }),
      ).toHaveProperty("checked", false);
      expect(
        (
          (await screen.findByRole("combobox", {
            name: "Provider",
          })) as HTMLSelectElement
        ).value,
      ).toBe("codex");
    },
  );
});
