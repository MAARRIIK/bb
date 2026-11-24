import { describe, expect, it } from "vitest";
import { currentTeam, eventsSchema } from "./team.js";

function history() {
  const rows: unknown[] = [];
  const add = (type: string, turnId: string, data: object = {}) => {
    rows.push({
      seq: rows.length + 1,
      type,
      scope: { kind: "turn", turnId },
      data,
    });
  };
  const delegate = (
    id: string,
    childRef: string,
    status = "pending",
    summary?: string,
  ) => {
    add(status === "pending" ? "item/started" : "item/completed", "root", {
      item: {
        id,
        type: "delegation",
        childRef,
        label: `Task ${childRef}`,
        status,
        ...(summary ? { summary } : {}),
      },
    });
  };
  const start = (turnId: string, parentToolCallId?: string) => {
    add("turn/started", turnId, {
      providerThreadId: "shared-provider-session",
      ...(parentToolCallId ? { parentToolCallId } : {}),
    });
  };
  return {
    add,
    delegate,
    start,
    read: () => currentTeam(eventsSchema.parse(rows), false),
  };
}

describe("current native agent team", () => {
  it("publishes the last native assistant message only after successful completion", () => {
    const log = history();
    log.start("root");
    log.delegate("spawn", "a");
    log.start("child", "spawn");
    log.add("item/completed", "child", {
      item: {
        id: "commentary",
        type: "agentMessage",
        text: "Still investigating",
      },
    });
    log.delegate(
      "spawn",
      "a",
      "completed",
      "A tool completion is not the final answer",
    );
    expect(log.read().members[0]).toMatchObject({
      status: "running",
      result: null,
      resultTruncated: false,
    });
    const final = "Verified final answer. ".repeat(200);
    log.add("item/completed", "child", {
      item: { id: "answer", type: "agentMessage", text: final },
    });
    expect(log.read().members[0]?.result).toBeNull();
    log.add("turn/completed", "child", { status: "completed" });
    expect(log.read().members[0]).toMatchObject({
      result: final.trim(),
      resultTruncated: false,
    });
    log.delegate("followup", "a");
    log.start("next-child", "followup");
    log.add("item/completed", "next-child", {
      item: { id: "partial", type: "agentMessage", text: "Partial progress" },
    });
    log.add("turn/completed", "next-child", { status: "failed" });
    expect(log.read().members[0]).toMatchObject({
      status: "failed",
      result: null,
      resultTruncated: false,
    });
  });

  it("retains up to 16000 characters of the completed final result with explicit truncation", () => {
    const log = history();
    log.start("root");
    log.delegate("spawn", "a");
    log.start("child", "spawn");
    log.add("item/completed", "child", {
      item: { id: "answer", type: "agentMessage", text: "x".repeat(17000) },
    });
    log.add("turn/completed", "child", { status: "completed" });
    expect(log.read().members[0]).toMatchObject({
      result: "x".repeat(16000),
      resultTruncated: true,
    });
  });

  it("shows unknown during a follow-up gap rather than reusing a completed lifecycle", () => {
    const log = history();
    log.start("root");
    log.delegate("spawn", "a");
    log.start("child", "spawn");
    log.add("turn/completed", "child", { status: "completed" });
    log.delegate("spawn", "a", "completed");
    log.delegate("followup", "a");
    expect(log.read()).toMatchObject({
      runningCount: null,
      unknownCount: 1,
      members: [{ id: "a", status: "unknown" }],
    });
    log.start("child-followup", "followup");
    expect(log.read()).toMatchObject({
      runningCount: 1,
      unknownCount: 0,
      members: [{ id: "a", status: "running" }],
    });
  });

  it("ignores reasoning summaries and unrelated command fields while reading a real-shaped mixed timeline", () => {
    const log = history();
    log.start("root");
    log.delegate("spawn", "a");
    log.start("child", "spawn");
    log.add("item/completed", "child", {
      item: {
        id: "thinking",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Internal reasoning" }],
        text: [{ text: "More reasoning" }],
      },
    });
    log.add("item/completed", "child", {
      item: {
        id: "command",
        type: "commandExecution",
        command: "git status",
        summary: ["command summary"],
        label: { title: "Command" },
        text: ["stdout"],
        output: "working tree clean",
      },
    });
    log.add("item/completed", "child", {
      item: { id: "answer", type: "agentMessage", text: "Verified result" },
    });
    log.add("turn/completed", "child", { status: "completed" });
    expect(log.read()).toMatchObject({
      runningCount: 0,
      unknownCount: 0,
      members: [{ id: "a", status: "completed", result: "Verified result" }],
    });
  });

  it.each([
    {
      type: "delegation",
      childRef: "agent",
      summary: ["invalid delegation summary"],
    },
    { type: "agentMessage", text: ["invalid message text"] },
  ])("still rejects malformed relevant $type fields", (item) => {
    expect(
      eventsSchema.safeParse([
        {
          seq: 1,
          type: "item/completed",
          scope: { kind: "turn", turnId: "root" },
          data: { item: { id: "item", ...item } },
        },
      ]).success,
    ).toBe(false);
  });

  it("counts unique agents across follow-ups and takes status from the latest child lifecycle", () => {
    const log = history();
    log.start("root");
    for (const id of ["a", "b", "c"]) {
      log.delegate(`spawn-${id}`, id);
      log.start(`turn-${id}`, `spawn-${id}`);
    }
    log.add("item/completed", "turn-a", {
      item: { id: "answer-a", type: "agentMessage", text: "previous result" },
    });
    log.add("turn/completed", "turn-a", { status: "completed" });
    log.delegate("spawn-a", "a", "completed");
    log.delegate("followup-a", "a");
    log.start("turn-a-2", "followup-a");
    log.delegate("wait-a", "a", "completed");
    expect(log.read()).toMatchObject({
      runningCount: 3,
      knownRunningCount: 3,
      unknownCount: 0,
      members: [
        { id: "a", status: "running", model: null, result: null },
        { id: "b", status: "running", model: null },
        { id: "c", status: "running", model: null },
      ],
    });
    log.add("item/completed", "turn-a-2", {
      item: {
        id: "answer-a2",
        type: "agentMessage",
        text: "verified new result",
      },
    });
    log.add("turn/completed", "turn-a-2", { status: "completed" });
    expect(log.read().members[0]).toMatchObject({
      status: "completed",
      result: "verified new result",
    });
    expect(log.read().runningCount).toBe(2);
  });

  it("reports unknown rather than zero or completion when only tool rounds are available", () => {
    const log = history();
    log.start("root");
    log.delegate("spawn", "a");
    log.delegate("spawn", "a", "completed");
    log.delegate("wait", "a", "completed");
    expect(log.read()).toMatchObject({
      runningCount: null,
      unknownCount: 1,
      knownRunningCount: 0,
      members: [{ id: "a", status: "unknown" }],
    });
  });

  it("does not carry a previous root turn's agents into the current turn", () => {
    const log = history();
    log.start("old-root");
    log.delegate("old-spawn", "a");
    log.start("old-child", "old-spawn");
    log.start("root");
    expect(log.read()).toMatchObject({
      turnId: "root",
      members: [],
      runningCount: 0,
    });
  });

  it("keeps an incomplete bounded read's count unknown", () => {
    expect(currentTeam([], true)).toMatchObject({
      runningCount: null,
      truncated: true,
    });
  });

  it("supports a child turn arriving before its delegation event", () => {
    const log = history();
    log.start("root");
    log.start("child", "spawn");
    log.delegate("spawn", "a");
    log.add("turn/completed", "child", { status: "failed" });
    expect(log.read()).toMatchObject({
      runningCount: 0,
      members: [{ id: "a", status: "failed" }],
    });
  });
});
