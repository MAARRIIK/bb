import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { getQueuedMessagesDrawerHeight } from "@/components/promptbox/banner/queued-messages-layout";

const tenRows = Array.from({ length: 10 }, (_, index) =>
  makeThreadQueuedMessage({ id: `q_${index}`, waitingOn: null }),
);

describe("getQueuedMessagesDrawerHeight", () => {
  it.each([
    { windowHeight: 600, height: 300 },
    { windowHeight: 1000, height: 300 },
    { windowHeight: 2000, height: 360 },
  ])(
    "lets a long queue use 30% of a $windowHeight px window, within 300-360 px",
    ({ windowHeight, height }) => {
      expect(
        getQueuedMessagesDrawerHeight({
          queuedMessages: tenRows,
          processingMessageId: null,
          windowHeight,
        }),
      ).toBe(height);
    },
  );

  it("reserves space for the model line in a short queue", () => {
    const message = tenRows[0]!;
    const height = (providerId: string | null) =>
      getQueuedMessagesDrawerHeight({
        queuedMessages: [{ ...message, providerId }],
        processingMessageId: null,
        windowHeight: 2000,
      });
    expect(height("codex")).toBe(height(null) + 16);
  });

  it("fits a short queue exactly instead of filling the cap", () => {
    expect(
      getQueuedMessagesDrawerHeight({
        queuedMessages: tenRows.slice(0, 2),
        processingMessageId: null,
        windowHeight: 2000,
      }),
    ).toBe(293);
  });
});
