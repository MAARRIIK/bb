import { describe, expect, it } from "vitest";
import { historyEntries, historyPage } from "./history.js";
import { eventsSchema } from "./team.js";
import type { HistoryEntry } from "./contract.js";

function timeline() {
  const rows: {
    seq: number;
    createdAt: number;
    type: string;
    scope: { kind: "turn"; turnId: string };
    data: object;
  }[] = [];
  const add = (type: string, turnId: string, data: object = {}) => {
    const seq = rows.length + 1;
    rows.push({
      seq,
      createdAt: seq * 1000,
      type,
      scope: { kind: "turn", turnId },
      data,
    });
  };
  add("turn/started", "root");
  for (const [call, agent, turn] of [
    ["call-a", "a", "a1"],
    ["call-b", "b", "b1"],
    ["followup-a", "a", "a2"],
  ]) {
    add("item/started", "root", {
      item: {
        id: call,
        type: "delegation",
        childRef: agent,
        label: agent,
        status: "pending",
      },
    });
    add("turn/started", turn, {
      parentToolCallId: call,
      providerThreadId: "shared-provider-session",
    });
  }
  return { rows, add };
}

describe("recorded native agent history", () => {
  it.each([
    [
      '/bin/zsh -lc "cat plugins/agent-team/history.ts\ncat plugins/agent-team/contract.ts"',
      "Запускал: чтение файлов · agent-team/history.ts, agent-team/contract.ts",
    ],
    ["/bin/zsh -lc 'rg -n login src | head -20'", "Запускал: поиск по коду"],
    ["/bin/bash -lc 'pnpm exec turbo run test typecheck'", "Запускал проверки"],
    [
      "/bin/zsh -lc 'cat README.md; unknown-helper --work'",
      "Выполнил команду · unknown-helper",
    ],
  ])(
    "understands native wrapped command %s without executing or rewriting it",
    (command, expected) => {
      const log = timeline();
      log.add("item/completed", "a2", {
        item: {
          id: "wrapped",
          type: "commandExecution",
          command,
          status: "completed",
          aggregatedOutput: "Recorded output",
        },
      });
      const entry = historyEntries(
        log.rows,
        eventsSchema.parse(log.rows),
        "a",
      ).find((item) => item.kind === "tool");
      expect(entry?.summary.ru).toBe(expected);
      expect(entry?.text).toContain(command);
      expect(entry?.text).toContain("Recorded output");
    },
  );

  it("shortens displayed targets without removing the actual absolute path from details", () => {
    const log = timeline();
    const path =
      "/Users/person/Desktop/projects/personal-fork/plugins/agent-team/app.tsx";
    log.add("item/completed", "a2", {
      item: {
        id: "edit",
        type: "fileChange",
        changes: [{ kind: "update", path, diff: "actual diff" }],
        status: "completed",
      },
    });
    const entry = historyEntries(
      log.rows,
      eventsSchema.parse(log.rows),
      "a",
    ).find((item) => item.kind === "tool");
    expect(entry?.summary.ru).toBe("Изменял файлы · agent-team/app.tsx");
    expect(entry?.text).toContain(path);
  });

  it.each([
    ["cat README.md", "Читал файлы · README.md", "Read files · README.md"],
    ["rg login src", "Искал по коду", "Searched code"],
    ["pnpm exec turbo run test typecheck", "Запускал проверки", "Ran checks"],
    ["git diff", "Проверял состояние Git", "Inspected Git state"],
  ])(
    "summarizes the observed completed action %s while retaining its exact details",
    (command, ru, en) => {
      const log = timeline();
      log.add("item/completed", "a2", {
        item: {
          id: "action",
          type: "commandExecution",
          command,
          status: "completed",
          exitCode: 0,
          aggregatedOutput: "actual tool output",
        },
      });
      const action = historyEntries(
        log.rows,
        eventsSchema.parse(log.rows),
        "a",
      ).find((entry) => entry.kind === "tool");
      expect(action?.summary).toEqual({ ru, en });
      expect(action?.text).toContain(command);
      expect(action?.text).toContain("actual tool output");
    },
  );

  it("does not describe a failed read or an opaque script as a successful file change", () => {
    const log = timeline();
    log.add("item/completed", "a2", {
      item: {
        id: "failed",
        type: "commandExecution",
        command: "cat missing.txt",
        status: "completed",
        exitCode: 1,
        aggregatedOutput: "No such file",
      },
    });
    log.add("item/completed", "a2", {
      item: {
        id: "python",
        type: "commandExecution",
        command: 'python3 -c "print(123)"',
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "123",
      },
    });
    log.add("item/completed", "a2", {
      item: {
        id: "unknown",
        type: "commandExecution",
        command: "custom-operation --work",
        status: "completed",
        exitCode: 0,
      },
    });
    const tools = historyEntries(
      log.rows,
      eventsSchema.parse(log.rows),
      "a",
    ).filter((entry) => entry.kind === "tool");
    expect(
      tools.find((entry) => entry.text.startsWith("cat"))?.summary.ru,
    ).toBe("Пытался прочитать файлы · missing.txt");
    expect(
      tools.find((entry) => entry.text.startsWith("python"))?.summary.ru,
    ).toBe("Запускал Python-скрипт");
    expect(
      tools.find((entry) => entry.text.startsWith("custom"))?.summary.ru,
    ).toBe("Выполнил команду · custom-operation");
    expect(tools.every((entry) => !entry.summary.ru.includes("Изменял"))).toBe(
      true,
    );
  });

  it("collapses a tool's start when its completion is available before pagination", () => {
    const log = timeline();
    const item = {
      id: "command",
      type: "commandExecution",
      command: "git status",
    };
    log.add("item/started", "a2", { item: { ...item, status: "pending" } });
    log.add("item/completed", "a2", {
      item: {
        ...item,
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "working tree clean",
      },
    });
    const entries = historyEntries(log.rows, eventsSchema.parse(log.rows), "a");
    const page = historyPage({
      turnId: "root",
      agentId: "a",
      entries,
      scannedBeforeSeq: 1,
      moreScannable: false,
      incompleteLifecycle: false,
    });
    expect(page.entries.filter((entry) => entry.kind === "tool")).toHaveLength(
      1,
    );
    expect(page.entries.find((entry) => entry.kind === "tool")).toMatchObject({
      phase: "completed",
      summary: { ru: "Проверял состояние Git" },
    });
    expect(page.entries.find((entry) => entry.kind === "tool")?.text).toContain(
      "working tree clean",
    );
  });

  it("keeps child messages and tool results across rounds separate from other agents and the parent", () => {
    const log = timeline();
    const fullMessage = "Long verified answer. ".repeat(300);
    log.add("item/completed", "root", {
      item: { id: "root-answer", type: "agentMessage", text: "Parent message" },
    });
    log.add("item/completed", "b1", {
      item: {
        id: "b-answer",
        type: "agentMessage",
        text: "Other agent's private output",
      },
    });
    log.add("item/completed", "a1", {
      item: { id: "a-answer", type: "agentMessage", text: "First round" },
    });
    log.add("item/started", "a2", {
      item: {
        id: "command",
        type: "commandExecution",
        command: "git status",
        status: "pending",
      },
    });
    log.add("item/completed", "a2", {
      item: {
        id: "command",
        type: "commandExecution",
        command: "git status",
        status: "completed",
        aggregatedOutput: "working tree clean",
        exitCode: 0,
      },
    });
    log.add("item/completed", "a2", {
      item: {
        id: "thinking",
        type: "reasoning",
        summary: ["Internal reasoning"],
      },
    });
    log.add("item/completed", "a2", {
      item: { id: "a2-answer", type: "agentMessage", text: fullMessage },
    });
    log.add("turn/completed", "a2", { status: "completed" });
    const entries = historyEntries(log.rows, eventsSchema.parse(log.rows), "a");
    const text = entries.map((entry) => entry.text).join("\n");
    expect(text).toContain("First round");
    expect(text).toContain("working tree clean");
    expect(text).not.toContain("Parent message");
    expect(text).not.toContain("Other agent");
    expect(text).not.toContain("Internal reasoning");
    expect(entries.find((entry) => entry.text === fullMessage)).toMatchObject({
      kind: "assistant",
      truncated: false,
    });
    expect(entries.map((entry) => entry.seq)).toEqual(
      [...entries.map((entry) => entry.seq)].sort((a, b) => b - a),
    );
  });

  it("paginates complete non-overlapping entries in chronological display order", () => {
    const all: HistoryEntry[] = Array.from({ length: 65 }, (_, index) => ({
      seq: index + 1,
      timestamp: index * 1000,
      kind: "assistant",
      summary: { ru: "Сообщение ассистента", en: "Assistant message" },
      itemId: `message-${index + 1}`,
      phase: "completed",
      text: `message ${index + 1}`,
      truncated: false,
    }));
    const page = (entries: HistoryEntry[]) =>
      historyPage({
        turnId: "root",
        agentId: "a",
        entries,
        scannedBeforeSeq: 1,
        moreScannable: false,
        incompleteLifecycle: false,
      });
    const first = page(all);
    const second = page(
      all.filter((entry) => entry.seq < first.nextBeforeSeq!),
    );
    const third = page(
      all.filter((entry) => entry.seq < second.nextBeforeSeq!),
    );
    expect(first.entries.map((entry) => entry.seq)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 36),
    );
    expect(first.nextBeforeSeq).toBe(36);
    expect(second.nextBeforeSeq).toBe(6);
    expect(third.nextBeforeSeq).toBeNull();
    expect(
      new Set(
        [...first.entries, ...second.entries, ...third.entries].map(
          (entry) => entry.seq,
        ),
      ).size,
    ).toBe(65);
  });

  it("marks bounded text and incomplete scans explicitly without inventing user messages", () => {
    const log = timeline();
    log.add("item/completed", "a2", {
      item: { id: "large", type: "agentMessage", text: "x".repeat(20_000) },
    });
    const entries = historyEntries(log.rows, eventsSchema.parse(log.rows), "a");
    expect(entries.find((entry) => entry.kind === "assistant")).toMatchObject({
      text: "x".repeat(16_000),
      truncated: true,
    });
    const result = historyPage({
      turnId: "root",
      agentId: "a",
      entries,
      scannedBeforeSeq: 10,
      moreScannable: true,
      incompleteLifecycle: true,
    });
    expect(result).toMatchObject({
      truncated: true,
      promptsAvailable: false,
      nextBeforeSeq: 10,
    });
  });

  it("does not expose another agent's events for an unrecognized agent id", () => {
    const log = timeline();
    log.add("item/completed", "b1", {
      item: { id: "answer", type: "agentMessage", text: "Not requested" },
    });
    expect(
      historyEntries(log.rows, eventsSchema.parse(log.rows), "missing"),
    ).toEqual([]);
  });
});
