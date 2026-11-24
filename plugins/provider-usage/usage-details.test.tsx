// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { ProviderUsageStatusContent } from "./app.js";
import { UsageSettingsContent } from "./settings.js";
import type { UsageProvider } from "./usage-schema.js";

installTestPluginRuntime();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["footer", "settings"] as const)(
  "%s distinguishes shared and model-family quotas, overage and unknown or stale measurements",
  (surface) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-24T10:00:00Z"));
    const account: UsageProvider = {
      id: "source:account",
      providerId: "codex",
      accountLabel: "Account",
      displayName: "Codex",
      logoUrl: null,
      icon: null,
      strings: { iconTint: null },
      signInHint: "Sign in.",
      expiredHint: "Expired.",
      source: { pluginId: "provider-codex", displayName: "Codex provider" },
      observedAt: Date.parse("2026-11-24T09:59:00Z"),
      usage: {
        status: "ok",
        accountEmail: null,
        planLabel: "Pro",
        windows: [
          {
            id: "all",
            label: "Monthly limit",
            model: null,
            usedPercent: 104.5,
            resetsAt: "2026-12-01T10:00:00Z",
            cost: null,
          },
          {
            id: "family",
            label: "Monthly limit",
            model: "glm",
            usedPercent: 15.6,
            resetsAt: null,
            cost: null,
          },
        ],
      },
    };
    let unavailable = false;
    const view = () => {
      const machines = [
        {
          id: "source:pool",
          displayName: "Pool",
          status: "connected" as const,
          providers: [account],
          error: null,
        },
      ];
      return surface === "footer" ? (
        <ProviderUsageStatusContent
          pluginId="provider-usage"
          dismiss={() => {}}
          snapshot={{
            data: { machines },
            error: unavailable ? "Refresh failed" : null,
            isRefreshing: false,
          }}
          threadMachineId={null}
          refreshEnabled={false}
        />
      ) : (
        <UsageSettingsContent
          machines={machines}
          selectedId={null}
          loading={false}
          error={unavailable}
          onSelect={() => {}}
          onRefresh={() => {}}
        />
      );
    };
    const result = render(view());
    expect(result.getByText("Source: Codex provider")).toBeTruthy();
    expect(result.container.querySelector("time")?.dateTime).toBe(
      "2026-11-24T09:59:00.000Z",
    );
    expect(result.container.textContent).not.toContain("(stale)");
    expect(result.getByText(/84.4% remaining/u)).toBeTruthy();
    expect(result.getByText(/0% remaining/u)).toBeTruthy();
    if (surface === "footer") {
      fireEvent.click(
        result.getByRole("button", { name: /Monthly limit: 0% remaining/u }),
      );
      fireEvent.click(
        result.getByRole("button", { name: /Monthly limit: 84.4% remaining/u }),
      );
    }
    expect(
      result.getByText(/Shared by all models in this account/u),
    ).toBeTruthy();
    expect(result.getByText(/Model family: glm/u)).toBeTruthy();
    expect(result.container.textContent).toContain("104.5% used");
    expect(result.container.textContent).toContain("2026");
    account.refreshError = "Refresh failed.";
    result.rerender(view());
    expect(result.getByText(/Last measurement \(stale\)/u)).toBeTruthy();
    expect(result.getByText(/84.4% remaining/u)).toBeTruthy();
    delete account.refreshError;
    unavailable = true;
    result.rerender(view());
    expect(result.getByText(/Last measurement \(stale\)/u)).toBeTruthy();
    unavailable = false;
    account.observedAt = Date.parse("2026-11-24T09:54:00Z");
    result.rerender(view());
    expect(result.getByText(/Last measurement \(stale\)/u)).toBeTruthy();
    account.observedAt = null;
    result.rerender(view());
    expect(result.getByText("Measurement time not reported.")).toBeTruthy();
    expect(result.container.querySelector("time")).toBeNull();
  },
);
