// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const emptyEnvironment = {
  builtInGit: { status: "not logged in" as const, statusMessage: "" },
  variables: [],
};
const variable = (name: string) => ({
  name,
  value: null,
  secret: true as const,
  note: null,
});
const projects = [
  {
    id: "proj_test",
    name: "Мой проект",
    kind: "standard" as const,
    createdAt: 0,
    updatedAt: 0,
    gitRemoteUrl: null,
    sources: [],
  },
];

function inputElement(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement))
    throw new Error("Expected an input");
  return element;
}

afterEach(cleanup);

describe("Pi API connections", () => {
  it.each([
    ["gemini", "GEMINI_API_KEY"],
    ["kimi", "MOONSHOT_API_KEY"],
    ["glm-coding", "ZAI_API_KEY"],
    ["deepseek", "DEEPSEEK_API_KEY"],
  ])(
    "saves %s with the existing global environment SDK and clears the draft",
    async (providerId, name) => {
      const set = vi.fn(async () => ({
        ...emptyEnvironment,
        variables: [variable(name)],
      }));
      const slot = renderSlot(
        app.settingsSections[0]!,
        {},
        {
          interfaceLanguage: "ru",
          sdk: {
            projects: { list: async () => projects },
            system: {
              machineEnvironment: async () => emptyEnvironment,
              setMachineEnvironmentVariable: set,
            },
          },
        },
      );
      await slot.findByText("Для выбранной области ключ не сохранён.");
      fireEvent.change(slot.getByLabelText("Сервис"), {
        target: { value: providerId },
      });
      const input = inputElement(slot.getByLabelText("Ключ API"));
      expect(input.type).toBe("password");
      fireEvent.change(input, { target: { value: "fake-qa-only" } });
      fireEvent.click(slot.getByRole("button", { name: "Сохранить ключ" }));
      await slot.findByText(
        "Ключ сохранён. Запрос к API не отправлялся; доступ ещё не проверен.",
      );
      expect(set).toHaveBeenCalledExactlyOnceWith({
        name,
        value: "fake-qa-only",
        note: null,
      });
      expect(input.value).toBe("");
      expect(
        slot.getByText(
          "Ключ сохранён для выбранной области. Его значение не показывается.",
        ),
      ).toBeTruthy();
      expect(slot.inspection.sdkCalls.map((call) => call.method)).not.toContain(
        "providers.models",
      );
    },
  );

  it("isolates project writes, locks pending operations, and restores inherited status after removal", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const set = vi.fn(async () => {
      await pending;
      return {
        ...emptyEnvironment,
        variables: [variable("DEEPSEEK_API_KEY")],
        inheritedVariables: [variable("DEEPSEEK_API_KEY")],
      };
    });
    const remove = vi.fn(async () => ({
      ...emptyEnvironment,
      inheritedVariables: [variable("DEEPSEEK_API_KEY")],
    }));
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        sdk: {
          system: { machineEnvironment: async () => emptyEnvironment },
          projects: {
            list: async () => projects,
            machineEnvironment: async () => ({
              ...emptyEnvironment,
              inheritedVariables: [variable("DEEPSEEK_API_KEY")],
            }),
            setMachineEnvironmentVariable: set,
            deleteMachineEnvironmentVariable: remove,
          },
        },
      },
    );
    await slot.findByRole("option", { name: "Мой проект" });
    const input = inputElement(slot.getByLabelText("API key"));
    fireEvent.change(input, {
      target: { value: "discard-on-provider-change" },
    });
    fireEvent.change(slot.getByLabelText("Service"), {
      target: { value: "deepseek" },
    });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "discard-on-scope-change" } });
    fireEvent.change(slot.getByLabelText("Save key for"), {
      target: { value: "proj_test" },
    });
    expect(input.value).toBe("");
    await slot.findByText("This project inherits a key from All projects.");
    expect(
      slot
        .getByRole("button", { name: "Remove saved key" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(input, { target: { value: "fake-project-key" } });
    fireEvent.click(slot.getByRole("button", { name: "Save key" }));
    expect(slot.getByLabelText("Service").hasAttribute("disabled")).toBe(true);
    expect(slot.getByLabelText("Save key for").hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.submit(input.closest("form")!);
    expect(set).toHaveBeenCalledTimes(1);
    await act(async () => finish?.());
    await slot.findByText(
      "A key is saved in this scope. Its value is never shown.",
    );
    expect(set).toHaveBeenCalledExactlyOnceWith({
      projectId: "proj_test",
      name: "DEEPSEEK_API_KEY",
      value: "fake-project-key",
      note: null,
    });
    expect(input.value).toBe("");
    fireEvent.click(slot.getByRole("button", { name: "Remove saved key" }));
    await slot.findByText("This project inherits a key from All projects.");
    expect(remove).toHaveBeenCalledExactlyOnceWith({
      projectId: "proj_test",
      name: "DEEPSEEK_API_KEY",
    });
  });

  it("ignores a late global read and keeps errors safe and retryable", async () => {
    let finishRead: ((value: typeof emptyEnvironment) => void) | undefined;
    const oldRead = new Promise<typeof emptyEnvironment>((resolve) => {
      finishRead = resolve;
    });
    const set = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream echoed fake-secret"))
      .mockResolvedValue({
        ...emptyEnvironment,
        variables: [variable("GEMINI_API_KEY")],
        inheritedVariables: [],
      });
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        sdk: {
          system: { machineEnvironment: async () => oldRead },
          projects: {
            list: async () => projects,
            machineEnvironment: async () => ({
              ...emptyEnvironment,
              variables: [variable("GEMINI_API_KEY")],
              inheritedVariables: [],
            }),
            setMachineEnvironmentVariable: set,
          },
        },
      },
    );
    await slot.findByRole("option", { name: "Мой проект" });
    fireEvent.change(slot.getByLabelText("Save key for"), {
      target: { value: "proj_test" },
    });
    await slot.findByText(
      "A key is saved in this scope. Its value is never shown.",
    );
    await act(async () => finishRead?.(emptyEnvironment));
    expect(slot.queryByText("No key is saved in this scope.")).toBeNull();
    const input = inputElement(slot.getByLabelText("API key"));
    fireEvent.change(input, { target: { value: "fake-secret" } });
    fireEvent.click(slot.getByRole("button", { name: "Save key" }));
    expect((await slot.findByRole("alert")).textContent).toBe(
      "Could not save the change. Try again.",
    );
    await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
    fireEvent.click(slot.getByRole("button", { name: "Save key" }));
    await slot.findByText(
      "Key saved. No API request was sent; credentials have not been validated.",
    );
    expect(set).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("");
  });
});
