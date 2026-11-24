// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ScheduleTimeFields } from "./schedule-time-fields";

afterEach(cleanup);

it("keeps legacy error strings literal when the interface language changes", () => {
  const props = {
    optionId: "custom" as const,
    custom: { date: "2026-08-26", time: "09:00" },
    now: new Date(2026, 7, 25, 12).getTime(),
    disabled: false,
    error: "Choose a date.",
    onOptionChange: () => {},
    onCustomChange: () => {},
  };
  const view = render(<ScheduleTimeFields {...props} />);
  expect(screen.getByRole("combobox", { name: "When to send" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Choose a date.");
  view.rerender(<ScheduleTimeFields {...props} language="ru" />);
  expect(
    screen.getByRole("combobox", { name: "Когда отправить" }),
  ).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Choose a date.");
  view.rerender(
    <ScheduleTimeFields
      {...props}
      language="ru"
      error={{ kind: "validation", message: "Choose a date." }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("Выбери дату.");
});
