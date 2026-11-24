// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
afterEach(cleanup);
const binding = {
  sessionId: "22222222-2222-4222-8222-222222222222",
  hostId: "host_1",
  instanceId: "desktop_1",
  tabId: "tab_1",
  generation: "generation_1",
};

describe("DeepSeek browser setup", () => {
  it("keeps reconnect available after inspection fails without disconnecting the existing conversation", async () => {
    let inspectionFails = false;
    const connect = vi.fn(() => binding);
    const disconnect = vi.fn(() => null);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_test", environment: null, params: null },
      {
        interfaceLanguage: "ru",
        rpc: {
          desktops: () => [{ id: "desktop_1", label: "Laptop browser" }],
          status: () => {
            if (inspectionFails) throw new Error("Browser control expired.");
            return { binding, inspection: null };
          },
          connect,
          disconnect,
        },
      },
    );
    const reconnect = await slot.findByRole("button", {
      name: "Подключить снова",
    });
    expect(reconnect.hasAttribute("disabled")).toBe(false);
    expect(
      slot.getByLabelText("Браузер на компьютере").hasAttribute("disabled"),
    ).toBe(true);
    inspectionFails = true;
    fireEvent.click(slot.getByRole("button", { name: "Обновить статус" }));
    await slot.findByText("Browser control expired.");
    expect(reconnect.hasAttribute("disabled")).toBe(false);
    inspectionFails = false;
    fireEvent.click(reconnect);
    await waitFor(() =>
      expect(connect).toHaveBeenCalledExactlyOnceWith({
        threadId: "thr_test",
        instanceId: "desktop_1",
      }),
    );
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("connects only on an explicit action for the current thread and distinguishes page readiness from authentication", async () => {
    let connected = false;
    const connect = vi.fn(() => {
      connected = true;
      return binding;
    });
    const disconnect = vi.fn(() => {
      connected = false;
      return null;
    });
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_test", environment: null, params: null },
      {
        interfaceLanguage: "ru",
        rpc: {
          desktops: () => [{ id: "desktop_1", label: "Laptop browser" }],
          status: () => ({
            binding: connected ? binding : null,
            inspection: connected
              ? {
                  status: "ready",
                  hint: "Website detected",
                  url: "https://chat.deepseek.com/",
                }
              : null,
          }),
          connect,
          disconnect,
        },
      },
    );
    await slot.findByRole("option", { name: "Laptop browser" });
    expect(connect).not.toHaveBeenCalled();
    const open = slot.getByRole("button", {
      name: "Открыть браузер и подключить",
    });
    expect(open.hasAttribute("disabled")).toBe(true);
    fireEvent.change(slot.getByLabelText("Браузер на компьютере"), {
      target: { value: "desktop_1" },
    });
    fireEvent.click(open);
    await slot.findByText("Website detected");
    expect(connect).toHaveBeenCalledExactlyOnceWith({
      threadId: "thr_test",
      instanceId: "desktop_1",
    });
    expect(slot.getByRole("status").textContent).toContain(
      "Это ещё не подтверждает авторизацию.",
    );
    expect(
      slot.getByText(/Это не проверка авторизации, активной модели или квоты/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        slot
          .getByRole("button", { name: "Освободить подключение браузера" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Освободить подключение браузера" }),
    );
    await waitFor(() =>
      expect(slot.getByRole("status").textContent).toBe(
        "К этому диалогу браузер не подключён.",
      ),
    );
    expect(disconnect).toHaveBeenCalledExactlyOnceWith({
      threadId: "thr_test",
    });
  });
});

describe("workspace action approval", () => {
  it.each([true, false])(
    "requires an explicit decision and submits approved=%s",
    async (approved) => {
      const submit = vi.fn(async (_value: unknown) => undefined);
      const slot = renderSlot(app.pendingInteractions[0]!, {
        interaction: {
          id: "request_1",
          threadId: "thr_test",
          title: "Approve",
          createdAt: 0,
          expiresAt: null,
          payload: {
            actions: [
              { id: "run_1", kind: "command", command: "git status --short" },
              {
                id: "write_1",
                kind: "write",
                path: "notes.txt",
                content: `${"x".repeat(4_000)}visible after 4000`,
              },
            ],
          },
        },
        submit,
        cancel: async () => undefined,
      });
      expect(submit).not.toHaveBeenCalled();
      expect(
        slot.getByText(
          /local account permissions, without an additional sandbox/,
        ),
      ).toBeTruthy();
      expect(slot.getByText(/git status --short/).textContent).toContain(
        "git status --short",
      );
      fireEvent.click(slot.getByText("File contents"));
      expect(slot.getByText(/visible after 4000/).textContent).toContain(
        "visible after 4000",
      );
      fireEvent.click(
        slot.getByRole("button", {
          name: approved ? "Approve actions" : "Deny",
        }),
      );
      await waitFor(() =>
        expect(submit).toHaveBeenCalledExactlyOnceWith({ approved }),
      );
    },
  );
  it("offers only cancellation when an approval payload is invalid", async () => {
    const cancel = vi.fn(async () => undefined);
    const submit = vi.fn(async (_value: unknown) => undefined);
    const slot = renderSlot(
      app.pendingInteractions[0]!,
      {
        interaction: {
          id: "request_invalid",
          threadId: "thr_test",
          title: "Approve",
          createdAt: 0,
          expiresAt: null,
          payload: { actions: [{ kind: "command", command: "echo unsafe" }] },
        },
        submit,
        cancel,
      },
      { interfaceLanguage: "ru" },
    );
    expect(
      slot.queryByRole("button", { name: "Подтвердить действия" }),
    ).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(submit).not.toHaveBeenCalled();
  });
});
