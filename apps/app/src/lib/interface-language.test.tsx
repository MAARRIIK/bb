// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  InterfaceLanguageProvider,
  useInterfaceTranslation,
} from "./interface-language";
import { translateInterfaceText } from "./interface-translations";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

function LanguageExample({ useLanguage }: { useLanguage: () => "en" | "ru" }) {
  const language = useLanguage();
  const { t } = useInterfaceTranslation();
  return (
    <>
      <h1>{t("Settings")}</h1>
      <span>{t("Untranslated setting")}</span>
      <pre>Settings</pre>
      <output data-testid="resolved-language">{language}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("interface language", () => {
  it("interpolates literal data without recursively translating or replacing its contents", () => {
    const values = { title: "Settings/{source}/$&", source: "my-plugin" };
    expect(
      translateInterfaceText("Chooses {title} ({source}).", "ru", values),
    ).toBe("Выбирает Settings/{source}/$& (my-plugin).");
    expect(
      translateInterfaceText("Chooses {title} ({source}).", "en", values),
    ).toBe("Chooses Settings/{source}/$& (my-plugin).");
    expect(
      translateInterfaceText(
        "Unknown {title}: {missing} {toString}",
        "ru",
        values,
      ),
    ).toBe("Unknown Settings/{source}/$&: {missing} {toString}");
  });

  describe.each([
    { name: "core", useLanguage: () => useInterfaceTranslation().language },
    {
      name: "plugin",
      useLanguage: pluginSdkAppImplementation.experimental_useInterfaceLanguage,
    },
  ])("$name language", ({ useLanguage }) => {
    it("changes live without translating user content and restores document language on unmount", () => {
      const previousLanguage = document.documentElement.lang;
      const view = render(
        <InterfaceLanguageProvider preference="en">
          <LanguageExample useLanguage={useLanguage} />
        </InterfaceLanguageProvider>,
      );
      expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
      expect(screen.getByTestId("resolved-language").textContent).toBe("en");
      view.rerender(
        <InterfaceLanguageProvider preference="ru">
          <LanguageExample useLanguage={useLanguage} />
        </InterfaceLanguageProvider>,
      );
      expect(screen.getByRole("heading", { name: "Настройки" })).not.toBeNull();
      expect(screen.getByTestId("resolved-language").textContent).toBe("ru");
      expect(screen.getByText("Untranslated setting")).not.toBeNull();
      expect(view.container.querySelector("pre")?.textContent).toBe("Settings");
      expect(document.documentElement.lang).toBe("ru");
      expect(screen.getByTestId("resolved-language").textContent).toBe("ru");
      view.unmount();
      expect(document.documentElement.lang).toBe(previousLanguage);
    });

    it("follows device language changes only in system mode", () => {
      let languages = ["ru-RU"];
      vi.spyOn(navigator, "languages", "get").mockImplementation(
        () => languages,
      );
      const view = render(
        <InterfaceLanguageProvider preference="system">
          <LanguageExample useLanguage={useLanguage} />
        </InterfaceLanguageProvider>,
      );
      expect(screen.getByRole("heading", { name: "Настройки" })).not.toBeNull();
      expect(screen.getByTestId("resolved-language").textContent).toBe("ru");
      languages = ["en-US"];
      fireEvent(window, new Event("languagechange"));
      expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
      expect(screen.getByTestId("resolved-language").textContent).toBe("en");
      view.rerender(
        <InterfaceLanguageProvider preference="ru">
          <LanguageExample useLanguage={useLanguage} />
        </InterfaceLanguageProvider>,
      );
      fireEvent(window, new Event("languagechange"));
      expect(screen.getByRole("heading", { name: "Настройки" })).not.toBeNull();
      expect(screen.getByTestId("resolved-language").textContent).toBe("ru");
    });
  });
});
