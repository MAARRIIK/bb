// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHostResponse } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../app"));
const panel = app.navPanels.find((entry) => entry.id === "subscriptions")!;
const kimi = {
  id: "kimi-code",
  name: "Kimi Code",
  providerId: "acp-kimi-code",
  signInCommand: "kimi login",
  documentationUrl: "https://moonshotai.github.io/kimi-code/",
  requiresInstallation: false,
  configured: true,
  matchesProfile: true,
};
const online = makeHostResponse({
  id: "online",
  name: "Laptop",
  status: "connected",
});

afterEach(cleanup);

describe("subscription connections", () => {
  it("opens the subscription panel from the localized settings entry", () => {
    const slot = renderSlot(
      app.settingsSections.find((entry) => entry.id === "subscriptions")!,
      {},
      { interfaceLanguage: "ru" },
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Открыть подключения по подписке" }),
    );
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "subscriptions" },
    ]);
  });

  it.each([
    {
      language: "en" as const,
      add: "Add agent",
      login: "Sign in",
      machine: "Sign-in machine",
      added: /Agent configured\. Complete sign-in/,
    },
    {
      language: "ru" as const,
      add: "Добавить агента",
      login: "Войти",
      machine: "Машина для входа",
      added: /Агент добавлен\. Заверши вход/,
    },
  ])(
    "configures an available agent without requiring a host in $language",
    async ({ language, add, login, machine, added }) => {
      const configureSubscriptionAgent = vi.fn(() => [kimi]);
      const startSubscriptionSignIn = vi.fn();
      const slot = renderSlot(
        panel,
        { subPath: "" },
        {
          interfaceLanguage: language,
          sdk: { hosts: { list: async () => [online] } },
          rpc: {
            listSubscriptionAgents: () => [
              { ...kimi, configured: false, matchesProfile: false },
            ],
            configureSubscriptionAgent,
            startSubscriptionSignIn,
          },
        },
      );
      const button = await slot.findByRole("button", {
        name: `${add}: Kimi Code`,
      });
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(slot.getByLabelText(machine)).toHaveProperty("value", "");
      fireEvent.click(button);
      await waitFor(() =>
        expect(slot.getByRole("status").textContent).toMatch(added),
      );
      expect(configureSubscriptionAgent).toHaveBeenCalledExactlyOnceWith({
        id: "kimi-code",
      });
      expect(
        slot
          .getByRole("button", { name: `${login}: Kimi Code` })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(startSubscriptionSignIn).not.toHaveBeenCalled();
      expect(slot.inspection.navigateCalls).toEqual([]);
    },
  );

  it("offers only connected machines and blocks sign-in for custom launch configurations", async () => {
    const startSubscriptionSignIn = vi.fn(() => ({
      terminalId: "terminal-from-host",
    }));
    const slot = renderSlot(
      panel,
      { subPath: "" },
      {
        sdk: {
          hosts: {
            list: async () => [
              online,
              makeHostResponse({
                id: "offline",
                name: "Offline laptop",
                status: "disconnected",
              }),
            ],
          },
        },
        rpc: {
          listSubscriptionAgents: () => [
            kimi,
            {
              ...kimi,
              id: "qwen-code",
              name: "Qwen Code",
              matchesProfile: false,
            },
          ],
          startSubscriptionSignIn,
        },
        openTerminal: () => true,
      },
    );
    const login = await slot.findByRole("button", {
      name: "Sign in: Kimi Code",
    });
    const customLogin = slot.getByRole("button", {
      name: "Sign in: Qwen Code",
    });
    expect(slot.queryByRole("option", { name: "Offline laptop" })).toBeNull();
    expect(slot.getByRole("option", { name: "Laptop" })).toHaveProperty(
      "value",
      "online",
    );
    expect(login.hasAttribute("disabled")).toBe(true);
    fireEvent.click(login);
    expect(startSubscriptionSignIn).not.toHaveBeenCalled();

    fireEvent.change(slot.getByLabelText("Sign-in machine"), {
      target: { value: "online" },
    });
    expect(login.hasAttribute("disabled")).toBe(false);
    expect(customLogin.hasAttribute("disabled")).toBe(true);
    fireEvent.click(customLogin);
    expect(startSubscriptionSignIn).not.toHaveBeenCalled();
    fireEvent.click(login);
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toMatch(
        /Sign-in terminal opened/,
      ),
    );
    expect(startSubscriptionSignIn).toHaveBeenCalledExactlyOnceWith({
      id: "kimi-code",
      hostId: "online",
    });
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openTerminal",
        options: { terminalId: "terminal-from-host" },
      },
    ]);
    expect(slot.getByRole("status").textContent).toContain(
      "This does not confirm authentication or quota.",
    );
  });

  it("keeps a pending sign-in single-flight and opens the eventual terminal receipt", async () => {
    let complete = (_result: { terminalId: string }): void => {
      throw new Error("Sign-in has not started");
    };
    const startSubscriptionSignIn = vi.fn(
      () =>
        new Promise<{ terminalId: string }>((resolve) => {
          complete = resolve;
        }),
    );
    const slot = renderSlot(
      panel,
      { subPath: "" },
      {
        sdk: { hosts: { list: async () => [online] } },
        rpc: { listSubscriptionAgents: () => [kimi], startSubscriptionSignIn },
        openTerminal: () => true,
      },
    );
    const login = await slot.findByRole("button", {
      name: "Sign in: Kimi Code",
    });
    fireEvent.change(slot.getByLabelText("Sign-in machine"), {
      target: { value: "online" },
    });
    fireEvent.click(login);
    fireEvent.click(login);
    expect(startSubscriptionSignIn).toHaveBeenCalledTimes(1);
    expect(login.hasAttribute("disabled")).toBe(true);
    expect(
      slot.getByLabelText("Sign-in machine").hasAttribute("disabled"),
    ).toBe(true);
    expect(slot.inspection.navigateCalls).toEqual([]);
    expect(slot.queryByRole("status")).toBeNull();
    complete({ terminalId: "late-terminal" });
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toMatch(
        /Sign-in terminal opened/,
      ),
    );
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "experimental_openTerminal",
        options: { terminalId: "late-terminal" },
      },
    ]);
    expect(login.hasAttribute("disabled")).toBe(false);
  });

  it.each(["rejected", "unsupported-surface", "navigation-rejected"] as const)(
    "does not report an opened sign-in terminal on %s",
    async (failure) => {
      const slot = renderSlot(
        panel,
        { subPath: "" },
        {
          sdk: { hosts: { list: async () => [online] } },
          rpc: {
            listSubscriptionAgents: () => [kimi],
            startSubscriptionSignIn: () => {
              if (failure === "rejected")
                throw new Error("The machine disconnected.");
              return { terminalId: "hidden-terminal" };
            },
          },
          openTerminal: () => {
            if (failure === "navigation-rejected")
              throw new Error("Could not fetch terminal details.");
            return false;
          },
        },
      );
      const login = await slot.findByRole("button", {
        name: "Sign in: Kimi Code",
      });
      fireEvent.change(slot.getByLabelText("Sign-in machine"), {
        target: { value: "online" },
      });
      fireEvent.click(login);
      if (failure === "rejected") {
        await waitFor(() =>
          expect(slot.getByRole("alert").textContent).toBe(
            "The machine disconnected.",
          ),
        );
        expect(slot.inspection.navigateCalls).toEqual([]);
        expect(slot.queryByRole("status")).toBeNull();
      } else {
        await waitFor(() =>
          expect(slot.getByRole("status").textContent).toMatch(
            /this surface could not show it/,
          ),
        );
        expect(slot.container.textContent).toContain("hidden-terminal");
        expect(slot.queryByRole("alert")).toBeNull();
        expect(slot.inspection.navigateCalls).toEqual([
          {
            method: "experimental_openTerminal",
            options: { terminalId: "hidden-terminal" },
          },
        ]);
      }
      expect(slot.queryByText(/Sign-in terminal opened/)).toBeNull();
      expect(login.hasAttribute("disabled")).toBe(false);
    },
  );
});
