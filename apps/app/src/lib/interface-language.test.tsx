// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  InterfaceLanguageProvider,
  useInterfaceTranslation,
} from "./interface-language";

function LanguageExample() {
  const { t } = useInterfaceTranslation();
  return (
    <>
      <h1>{t("Settings")}</h1>
      <span>{t("Untranslated setting")}</span>
      <pre>Settings</pre>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("interface language", () => {
  it("changes live without translating user content and restores document language on unmount", () => {
    const previousLanguage = document.documentElement.lang;
    const view = render(
      <InterfaceLanguageProvider preference="en">
        <LanguageExample />
      </InterfaceLanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
    view.rerender(
      <InterfaceLanguageProvider preference="ru">
        <LanguageExample />
      </InterfaceLanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "Настройки" })).not.toBeNull();
    expect(screen.getByText("Untranslated setting")).not.toBeNull();
    expect(view.container.querySelector("pre")?.textContent).toBe("Settings");
    expect(document.documentElement.lang).toBe("ru");
    view.unmount();
    expect(document.documentElement.lang).toBe(previousLanguage);
  });

  it("follows device language changes only in system mode", () => {
    let languages = ["ru-RU"];
    vi.spyOn(navigator, "languages", "get").mockImplementation(() => languages);
    const view = render(
      <InterfaceLanguageProvider preference="system">
        <LanguageExample />
      </InterfaceLanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "Настройки" })).not.toBeNull();
    languages = ["en-US"];
    fireEvent(window, new Event("languagechange"));
    expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
    view.rerender(
      <InterfaceLanguageProvider preference="ru">
        <LanguageExample />
      </InterfaceLanguageProvider>,
    );
    fireEvent(window, new Event("languagechange"));
    expect(screen.getByRole("heading", { name: "Настройки" })).not.toBeNull();
  });
});
