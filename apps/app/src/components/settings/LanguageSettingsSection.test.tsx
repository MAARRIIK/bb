// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InterfaceLanguageProvider } from "@/lib/interface-language";
import { LanguageSettingsSection } from "./LanguageSettingsSection";

afterEach(cleanup);

it("changes response language separately and retains its selection when the interface changes", () => {
  const onChange = vi.fn();
  const onResponseChange = vi.fn();
  const view = (language: "en" | "ru", response: "en" | "ru") => (
    <InterfaceLanguageProvider preference={language}>
      <LanguageSettingsSection
        preference={language}
        responsePreference={response}
        disabled={false}
        onChange={onChange}
        onResponseChange={onResponseChange}
      />
    </InterfaceLanguageProvider>
  );
  const mounted = render(view("ru", "en"));
  const trigger = screen.getByRole("button", {
    name: "Выбрать язык ответов ИИ",
  });
  expect(trigger.textContent).toBe("English");
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(
    screen.getByRole("menuitem", {
      name: /^Русский.*Предпочитать русский для объяснений ИИ\.$/,
    }),
  );
  expect(onResponseChange).toHaveBeenCalledExactlyOnceWith("ru");
  expect(onChange).not.toHaveBeenCalled();
  mounted.rerender(view("en", "ru"));
  expect(
    screen.getByRole("button", { name: "Choose AI response language" })
      .textContent,
  ).toBe("Русский");
  expect(
    screen.getByRole("button", { name: "Choose interface language" })
      .textContent,
  ).toBe("English");
});
