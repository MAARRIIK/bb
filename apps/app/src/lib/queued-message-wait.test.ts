import { describe, expect, it } from "vitest";
import type {
  QueuedMessageWaitingOn,
  ThreadStatus,
  ResolvedInterfaceLanguage,
} from "@bb/domain";
import {
  describeQueuedMessageWait,
  formatQueuedMessageCountdown,
  isQueuedMessageSendNowAllowed,
  queuedMessageCountdownInstant,
  queuedMessageFallbackTitle,
  queuedMessageHasWaitLine,
  queuedMessageWaitIcon,
} from "./queued-message-wait";

const NOW = new Date(2026, 7, 28, 9, 0, 0).getTime();

function clockAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
}
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function describeWait(
  waitingOn: QueuedMessageWaitingOn | null,
  overrides: {
    language?: ResolvedInterfaceLanguage;
    failureReason?: string | null;
    now?: number;
    pluginDisplayName?: string | null;
    sendAt?: number | null;
    threadStatus?: ThreadStatus;
  } = {},
): string | null {
  return describeQueuedMessageWait({
    language: overrides.language ?? "en",
    failureReason: overrides.failureReason ?? null,
    now: overrides.now ?? NOW,
    payload: { kind: "inline" },
    pluginDisplayName: overrides.pluginDisplayName ?? null,
    sendAt: overrides.sendAt ?? null,
    threadStatus: overrides.threadStatus ?? "active",
    waitingOn,
  });
}

describe("describeQueuedMessageWait", () => {
  it("localizes core waits while preserving provider errors, plugin text and machine names", () => {
    expect(describeWait({ kind: "provisioning" }, { language: "ru" })).toBe(
      "Ожидание рабочей папки",
    );
    expect(
      describeWait(
        { kind: "host-offline", hostName: "Settings/{time}/$&" },
        { language: "ru" },
      ),
    ).toBe("Ожидание готовности Settings/{time}/$&");
    expect(
      describeWait(
        { kind: "provisioning" },
        { language: "ru", failureReason: "Waiting for workspace" },
      ),
    ).toBe("Waiting for workspace");
    expect(
      describeWait(
        {
          kind: "plugin",
          pluginId: "third-party",
          reason: "Waiting for workspace",
        },
        { language: "ru", pluginDisplayName: "Settings" },
      ),
    ).toBe("Приостановлено: Settings · Waiting for workspace");
    expect(
      describeWait(
        {
          kind: "dependency",
          queuedMessageId: "q_{time}/$&",
          status: "failed",
        },
        { language: "ru", failureReason: "Provider unavailable" },
      ),
    ).toBe("Ожидание успешного завершения задания q_{time}/$& (ошибка)");
  });

  it("leaves an ordinary queued message unexplained", () => {
    expect(describeWait({ kind: "thread-busy" })).toBeNull();
    expect(describeWait(null)).toBeNull();
  });

  it("names each core wait a reader cannot otherwise explain", () => {
    expect(describeWait({ kind: "stopping" })).toBe(
      "Sending when the thread stops",
    );
    expect(describeWait({ kind: "turn-starting" })).toBe(
      "Waiting for turn to start",
    );
    expect(describeWait({ kind: "provisioning" })).toBe(
      "Waiting for workspace",
    );
    expect(describeWait({ kind: "interaction" })).toBe(
      "Waiting for your reply",
    );
  });

  it("stops promising a turn start once the thread's run has failed", () => {
    expect(
      describeWait({ kind: "turn-starting" }, { threadStatus: "error" }),
    ).toBe("Turn didn't start · sends on the next turn");
  });

  it("names the absent machine a host-offline row is waiting on", () => {
    expect(describeWait({ kind: "host-offline", hostName: "M4" })).toBe(
      "Waiting for M4 to be ready",
    );
  });

  it("lets a failure outrank the wait the row is still waiting on", () => {
    expect(
      describeWait(
        { kind: "thread-busy" },
        { failureReason: "Host is not connected" },
      ),
    ).toBe("Host is not connected");
    expect(
      queuedMessageHasWaitLine({
        failureReason: "Host is not connected",
        payload: { kind: "inline" },
        waitingOn: { kind: "thread-busy" },
      }),
    ).toBe(true);
  });

  it("attributes a plugin wait by display name, falling back to its id", () => {
    const waitingOn: QueuedMessageWaitingOn = {
      kind: "plugin",
      pluginId: "concurrency-limit",
      reason: "4 of 4 running",
    };
    expect(
      describeWait(waitingOn, { pluginDisplayName: "Concurrency Limit" }),
    ).toBe("Held by Concurrency Limit · 4 of 4 running");
    expect(describeWait(waitingOn)).toBe(
      "Held by concurrency-limit · 4 of 4 running",
    );
  });

  it("carries the scheduled instant but never the countdown", () => {
    const label = describeWait({ kind: "time" }, { sendAt: NOW + 3 * HOUR });
    expect(label).toBe(`Scheduled for ${clockAt(NOW + 3 * HOUR)}`);
    expect(label).not.toMatch(/\bin \d/);
    expect(describeWait({ kind: "time" })).toBe("Scheduled");
  });

  it("leads a retry with why it is being retried, then when and which attempt", () => {
    expect(
      describeQueuedMessageWait({
        language: "en",
        failureReason: null,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        pluginDisplayName: null,
        sendAt: NOW + HOUR,
        threadStatus: "active",
        waitingOn: { kind: "time" },
      }),
    ).toBe(`Rate limited · retrying at ${clockAt(NOW + HOUR)} · attempt 2`);
    expect(
      describeQueuedMessageWait({
        language: "en",
        failureReason: null,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        pluginDisplayName: "Concurrency limit",
        sendAt: null,
        threadStatus: "active",
        waitingOn: {
          kind: "plugin",
          pluginId: "concurrency-limit",
          reason: "2 of 2 running on all hosts",
        },
      }),
    ).toBe(
      "Rate limited · held by Concurrency limit · 2 of 2 running on all hosts · attempt 2",
    );
  });
});

describe("queuedMessageWaitIcon", () => {
  it("gives every explained wait a glyph and the ordinary row none", () => {
    const icon = (
      waitingOn: QueuedMessageWaitingOn | null,
      failureReason: string | null = null,
    ) =>
      queuedMessageWaitIcon({
        failureReason,
        payload: { kind: "inline" },
        waitingOn,
      });

    expect(icon({ kind: "time" })).toBe("TimeSchedule");
    expect(icon({ kind: "turn-starting" })).toBe("TimeSchedule");
    expect(icon({ kind: "provisioning" })).toBe("Folder");
    expect(icon({ kind: "host-offline", hostName: "M4" })).toBe("CloudOff");
    expect(icon({ kind: "interaction" })).toBe("CircleQuestion");
    expect(icon({ kind: "plugin", pluginId: "p", reason: "r" })).toBeNull();
    expect(icon({ kind: "thread-busy" })).toBeNull();
    expect(icon(null)).toBeNull();
    expect(icon({ kind: "time" }, "Host is not connected")).toBe("AlertCircle");
  });

  it("marks a retry with the reload glyph regardless of its wait", () => {
    expect(
      queuedMessageWaitIcon({
        failureReason: null,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        waitingOn: { kind: "plugin", pluginId: "provider-retry", reason: "r" },
      }),
    ).toBe("RotateCcw");
  });
});

describe("queuedMessageFallbackTitle", () => {
  it("names the failed turn a retry row re-submits", () => {
    expect(
      queuedMessageFallbackTitle({
        language: "en",
        createdAt: NOW,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
      }),
    ).toBe(`Retry failed turn from ${clockAt(NOW)}`);
  });

  it("titles a restart resume as a resume, with when it resumes and which attempt", () => {
    const payload = {
      kind: "retry" as const,
      retryOfTurnRequestId: "req-1",
      attempt: 3,
      reason: "bb restarted",
    };
    expect(
      queuedMessageFallbackTitle({
        language: "en",
        createdAt: NOW,
        now: NOW,
        payload,
      }),
    ).toBe("Resume after bb restarted");
    expect(
      describeQueuedMessageWait({
        language: "en",
        failureReason: null,
        now: NOW,
        payload,
        pluginDisplayName: null,
        sendAt: NOW + 5_000,
        threadStatus: "idle",
        waitingOn: { kind: "time" },
      }),
    ).toBe(`resuming at ${clockAt(NOW + 5_000)} · attempt 3`);
  });
});

describe("isQueuedMessageSendNowAllowed", () => {
  it.each([
    { waitingOn: null, allowed: true },
    { waitingOn: { kind: "time" }, allowed: true },
    {
      waitingOn: { kind: "plugin", pluginId: "limiter", reason: "busy" },
      allowed: true,
    },
    { waitingOn: { kind: "thread-busy" }, allowed: true },
    { waitingOn: { kind: "stopping" }, allowed: false },
    { waitingOn: { kind: "turn-starting" }, allowed: false },
    { waitingOn: { kind: "provisioning" }, allowed: false },
    { waitingOn: { kind: "interaction" }, allowed: false },
    { waitingOn: { kind: "host-offline", hostName: "M4" }, allowed: false },
  ] as const)(
    "allows manual recovery for $waitingOn",
    ({ waitingOn, allowed }) => {
      expect(
        isQueuedMessageSendNowAllowed({ waitingOn, failureReason: null }),
      ).toBe(allowed);
      expect(
        isQueuedMessageSendNowAllowed({
          waitingOn,
          failureReason: "Provider unavailable",
        }),
      ).toBe(true);
    },
  );
});

describe("formatQueuedMessageCountdown", () => {
  it("stays silent once the instant is due", () => {
    expect(formatQueuedMessageCountdown(0, "en")).toBeNull();
    expect(formatQueuedMessageCountdown(-1, "en")).toBeNull();
  });

  it.each([
    {
      language: "en",
      labels: [
        "in 1s",
        "in 60s",
        "in 1m",
        "in 59m",
        "in 1h",
        "in 23h",
        "in 1d",
      ],
    },
    {
      language: "ru",
      labels: [
        "через 1 с",
        "через 60 с",
        "через 1 мин",
        "через 59 мин",
        "через 1 ч",
        "через 23 ч",
        "через 1 дн",
      ],
    },
  ] as const)(
    "steps up a unit exactly at each boundary in $language",
    ({ language, labels }) => {
      const instants = [
        1,
        MINUTE - 1,
        MINUTE,
        HOUR - 1,
        HOUR,
        24 * HOUR - 1,
        24 * HOUR,
      ];
      expect(
        instants.map((instant) =>
          formatQueuedMessageCountdown(instant, language),
        ),
      ).toEqual(labels);
    },
  );
});

describe("queuedMessageCountdownInstant", () => {
  it("ticks only for a scheduled row", () => {
    expect(
      queuedMessageCountdownInstant({
        payload: { kind: "inline" },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "time" },
      }),
    ).toBe(NOW + HOUR);
    expect(
      queuedMessageCountdownInstant({
        payload: { kind: "inline" },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "provisioning" },
      }),
    ).toBeNull();
    expect(
      queuedMessageCountdownInstant({
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "time" },
      }),
    ).toBeNull();
  });
});
