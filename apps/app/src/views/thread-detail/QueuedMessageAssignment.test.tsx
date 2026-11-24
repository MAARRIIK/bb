// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { QueuedMessageAssignment } from "./QueuedMessageAssignment";

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
  state.placeholder = false;
  state.error = false;
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
          currentProviderId="codex"
          environmentId="env_assignment"
          edit={{
            editSessionId: 1,
            expectedUpdatedAt: 1,
            providerId: "codex",
            providerSwitchPolicy: "manual",
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
