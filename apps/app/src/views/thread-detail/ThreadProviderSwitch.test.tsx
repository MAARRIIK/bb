// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import type {
  ProviderSwitchPreview,
  ProviderSwitchReceipt,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { ThreadProviderSwitch } from "./ThreadProviderSwitch";

const viewport = vi.hoisted(() => ({ compact: false }));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewport.compact,
}));

const providers = [
  makeProviderInfo({ id: "codex", displayName: "Codex" }),
  makeProviderInfo({
    id: "pi",
    displayName: "Pi",
    capabilities: { permissionModes: ["full"] },
  }),
];
const thread = makeThreadResponse({ id: "thr_switch_ui", providerId: "codex" });

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({ data: thread }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: providers }),
  useSystemExecutionOptions: ({ providerId }: { providerId: string }) => {
    const data: SystemExecutionOptionsResponse = {
      providers,
      permissionCeiling: "full",
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
      modelLoadError: null,
    };
    return {
      data,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
    };
  },
}));

const preview: ProviderSwitchPreview = {
  threadId: thread.id,
  environmentId: "env_switch_ui",
  hostId: "host_switch_ui",
  source: {
    providerId: "codex",
    providerSessionId: "source-generation",
    providerThreadId: "source-native",
    modelOverride: null,
    reasoningLevelOverride: null,
  },
  request: {
    providerId: "pi",
    model: "pi-model",
    permissionMode: "full",
    reasoningLevel: null,
    serviceTier: "default",
    context: { mode: "recent-messages" },
    contextTokenBudget: 8192,
    contextWindowTokens: null,
  },
  execution: {
    model: "pi-model",
    permissionMode: "full",
    reasoningLevel: "medium",
    serviceTier: "default",
    source: "client/turn/requested",
  },
  context: {
    text: "Selected visible context from the server",
    throughSequence: 12,
    tokenBudget: 8192,
    estimatedTokens: 40,
    estimateMethod: "utf8-bytes",
    includedMessages: 2,
    hasOlderHistory: true,
    omittedOversizedEvents: 0,
    completeness: "recent-messages",
    windowTokens: null,
    windowSource: "unknown",
    servedWindowVerified: false,
  },
  fingerprint: "a".repeat(64),
};
const savedId = "00000000-0000-4000-8000-000000000012";
function receipt(
  operationId: string,
  phase: ProviderSwitchReceipt["phase"],
): ProviderSwitchReceipt {
  return {
    operationId,
    threadId: thread.id,
    providerId: "pi",
    model: "pi-model",
    phase,
    errorCode: null,
    createdAt: 1,
    updatedAt: 2,
  };
}
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <main data-testid="app-root">
        <ThreadProviderSwitch
          threadId={thread.id}
          environmentId="env_switch_ui"
          disabled={false}
        />
      </main>
    </QueryClientProvider>,
  );
}
async function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "Switch model in this conversation" }),
  );
  await screen.findByRole("combobox", { name: "Provider" });
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  window.localStorage.clear();
  viewport.compact = false;
  vi.restoreAllMocks();
});

describe("same-conversation switch controls", () => {
  it.each([false, true])(
    "reviews exact context and explicitly chooses Pi permissions with compact=%s",
    async (compact) => {
      viewport.compact = compact;
      const makePreview = vi
        .spyOn(sdk.threads.experimental_providerSwitch, "preview")
        .mockResolvedValue(preview);
      const commit = vi
        .spyOn(sdk.threads.experimental_providerSwitch, "commit")
        .mockImplementation(async ({ operationId }) =>
          receipt(operationId, "completed"),
        );
      vi.spyOn(
        sdk.threads.experimental_providerSwitch,
        "get",
      ).mockImplementation(async ({ operationId }) =>
        receipt(operationId, "preparing"),
      );
      mount();
      await open();
      const appRoot = screen.getByTestId("app-root");
      expect(appRoot.closest('[aria-hidden="true"], [inert]')).toBeNull();
      fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
        target: { value: "pi" },
      });
      const prepareButton = screen.getByRole("button", {
        name: "Preview context",
      });
      expect(prepareButton).toHaveProperty("disabled", true);
      expect(makePreview).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole("combobox", { name: "Permissions" }), {
        target: { value: "full" },
      });
      fireEvent.click(prepareButton);
      const context = await screen.findByRole("textbox", {
        name: "Context to transfer",
      });
      expect(context).toHaveProperty("value", preview.context.text);
      expect(context).toHaveProperty("readOnly", true);
      expect(makePreview).toHaveBeenCalledExactlyOnceWith({
        threadId: thread.id,
        ...preview.request,
      });
      expect(commit).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Switch in this conversation" }),
      );
      await waitFor(() => expect(commit).toHaveBeenCalledOnce());
      const args = commit.mock.calls[0]![0];
      expect(args.threadId).toBe(thread.id);
      expect(args.preview).toEqual(preview);
      expect(
        window.localStorage.getItem(`bb.provider-switch.${thread.id}`),
      ).toBe(args.operationId);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(appRoot.closest('[aria-hidden="true"], [inert]')).toBeNull();
    },
  );

  it("recovers the stored operation after reload without committing another switch", async () => {
    window.localStorage.setItem(`bb.provider-switch.${thread.id}`, savedId);
    const get = vi
      .spyOn(sdk.threads.experimental_providerSwitch, "get")
      .mockResolvedValue(receipt(savedId, "finalizing"));
    const recover = vi
      .spyOn(sdk.threads.experimental_providerSwitch, "recover")
      .mockResolvedValue(receipt(savedId, "completed"));
    const commit = vi.spyOn(sdk.threads.experimental_providerSwitch, "commit");
    mount();
    await open();
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: thread.id, operationId: savedId }),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Preview context" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Check and recover" }));
    await waitFor(() =>
      expect(recover).toHaveBeenCalledExactlyOnceWith({
        threadId: thread.id,
        operationId: savedId,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(commit).not.toHaveBeenCalled();
  });

  it("starts the compact drawer before mounting the catalog and retains the form after close", async () => {
    viewport.compact = true;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const advanceFrame = () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(performance.now());
      });
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch model in this conversation" }),
    );
    expect(
      document.querySelector(
        '[data-persistent-drawer-content][data-state="open"]',
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();
    advanceFrame();
    expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();
    advanceFrame();
    const select = screen.getByRole("combobox", { name: "Provider" });
    fireEvent.change(select, { target: { value: "pi" } });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-persistent-drawer-content][data-state="closed"]',
        ),
      ).not.toBeNull(),
    );
    expect(select.isConnected).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Switch model in this conversation" }),
    );
    expect(screen.getByRole("combobox", { name: "Provider" })).toBe(select);
    expect(select).toHaveProperty("value", "pi");
  });
});
