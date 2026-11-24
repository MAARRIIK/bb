// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { InterfaceLanguageProvider } from "@/lib/interface-language";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
} from "@/lib/plugin-replacement-preference";
import { CodeRendererSettings } from "./CodeRendererSettings";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const EMPTY_REGISTRATIONS = makePluginRegistrationSet();

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("CodeRendererSettings", () => {
  it("shows no control until a plugin supplies a renderer", () => {
    render(
      <JotaiProvider store={createStore()}>
        <CodeRendererSettings />
      </JotaiProvider>,
    );

    expect(screen.queryByRole("button", { name: "Source code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Diffs" })).toBeNull();
  });

  it("pins BB's diff renderer without touching the source-code choice", async () => {
    setPluginSlotRegistrations("inkwell", {
      ...EMPTY_REGISTRATIONS,
      sourceCodeRenderers: [
        { id: "source", title: "Inkwell source", component: () => null },
      ],
      diffRenderers: [
        { id: "diffs", title: "Inkwell diffs", component: () => null },
      ],
    });
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <CodeRendererSettings />
      </JotaiProvider>,
    );

    const diffTrigger = screen.getByRole("button", { name: "Diffs" });
    expect(diffTrigger.textContent).toContain("Automatic");

    fireEvent.pointerDown(diffTrigger, { button: 0 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /built-in/u }));

    expect(store.get(diffRendererProviderAtom)).toBe(
      BUILT_IN_REPLACEMENT_PROVIDER,
    );
    expect(store.get(sourceCodeRendererProviderAtom)).toBe(
      AUTOMATIC_REPLACEMENT_PROVIDER,
    );
  });

  it.each(["en", "ru"] as const)(
    "offers providers in %s while preserving third-party text",
    (language) => {
      setPluginSlotRegistrations("inkwell", {
        ...EMPTY_REGISTRATIONS,
        diffRenderers: [
          { id: "diffs", title: "Settings", component: () => null },
        ],
      });
      setPluginSlotRegistrations("zed", {
        ...EMPTY_REGISTRATIONS,
        diffRenderers: [
          {
            id: "zed-diffs",
            title: "Zed diffs",
            description: "Dark",
            component: () => null,
          },
        ],
      });
      const store = createStore();
      render(
        <InterfaceLanguageProvider preference={language}>
          <JotaiProvider store={store}>
            <CodeRendererSettings />
          </JotaiProvider>
        </InterfaceLanguageProvider>,
      );

      const trigger = screen.getByRole("button", {
        name: language === "ru" ? "Изменения" : "Diffs",
      });
      expect(trigger.textContent).toContain(
        language === "ru" ? "Автоматически" : "Automatic",
      );
      fireEvent.pointerDown(trigger, { button: 0 });
      expect(
        screen.getByRole("menuitem", {
          name: language === "ru" ? /Выбирает Settings/u : /Chooses Settings/u,
        }),
      ).toBeTruthy();
      const items = screen
        .getAllByRole("menuitem")
        .map((item) => item.textContent ?? "");
      expect(items).toHaveLength(4);
      expect(items[3]).toContain(
        language === "ru" ? "AI (встроенный)" : "AI (built-in)",
      );
      expect(
        items.some((text) =>
          text.includes(
            language === "ru"
              ? "Из плагина inkwell"
              : "From the inkwell plugin",
          ),
        ),
      ).toBe(true);
      expect(items.some((text) => text.includes("Dark"))).toBe(true);
      expect(
        items.some((text) =>
          text.includes(language === "ru" ? "Плагин zed." : "zed plugin."),
        ),
      ).toBe(true);
    },
  );
});
