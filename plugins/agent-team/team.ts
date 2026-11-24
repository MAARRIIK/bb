import { z } from "zod";
import type { Member, Team } from "./contract.js";

const itemSchema = z
  .object({ id: z.string(), type: z.string() })
  .passthrough()
  .transform((item) => {
    const common = { id: item.id, type: item.type };
    if (item.type === "delegation")
      return {
        ...common,
        childRef: item.childRef,
        label: item.label,
        summary: item.summary,
        status: item.status,
        parentToolCallId: item.parentToolCallId,
      };
    if (item.type === "agentMessage")
      return {
        ...common,
        text: item.text,
        parentToolCallId: item.parentToolCallId,
      };
    return common;
  })
  .pipe(
    z.object({
      id: z.string(),
      type: z.string(),
      childRef: z.string().optional(),
      label: z.string().optional(),
      summary: z.string().optional(),
      text: z.string().optional(),
      parentToolCallId: z.string().optional(),
      status: z.string().optional(),
    }),
  )
  .superRefine((item, context) => {
    if (item.type === "delegation" && !item.childRef)
      context.addIssue({
        code: "custom",
        path: ["childRef"],
        message: "Delegation requires a child reference",
      });
    if (item.type === "agentMessage" && item.text === undefined)
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Agent message requires text",
      });
  });

const eventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.string(),
  scope: z.object({
    kind: z.enum(["thread", "turn"]),
    turnId: z.string().optional(),
  }),
  data: z.object({
    parentToolCallId: z.string().optional(),
    providerThreadId: z.string().nullable().optional(),
    status: z.string().optional(),
    item: itemSchema.optional(),
  }),
});

export const eventsSchema = z.array(eventSchema);
export type TeamEvent = z.infer<typeof eventSchema>;

export function agentTurnIds(
  events: TeamEvent[],
  agentId: string,
): Set<string> {
  const calls = new Set(
    events.flatMap((event) =>
      event.data.item?.type === "delegation" &&
      event.data.item.childRef === agentId
        ? [event.data.item.id]
        : [],
    ),
  );
  return new Set(
    events.flatMap((event) =>
      event.type === "turn/started" &&
      event.scope.turnId &&
      event.data.parentToolCallId &&
      calls.has(event.data.parentToolCallId)
        ? [event.scope.turnId]
        : [],
    ),
  );
}

export function currentTeam(events: TeamEvent[], truncated: boolean): Team {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const root = ordered.findLast(
    (event) => event.type === "turn/started" && !event.data.parentToolCallId,
  );
  const turnId = root?.scope.turnId ?? null;
  if (!root || !turnId)
    return {
      turnId: null,
      members: [],
      runningCount: truncated ? null : 0,
      knownRunningCount: 0,
      unknownCount: 0,
      truncated,
    };
  const current = ordered.filter((event) => event.seq >= root.seq);
  const calls = new Map<string, string>();
  const members = new Map<string, Member>();
  for (const event of current) {
    const item = event.data.item;
    if (item?.type !== "delegation" || !item.childRef) continue;
    calls.set(item.id, item.childRef);
    const previous = members.get(item.childRef);
    const label = item.label?.trim();
    const task = previous?.task ?? label ?? "Задача не сообщена";
    members.set(item.childRef, {
      id: item.childRef,
      task: task.slice(0, 1000),
      model: null,
      status: "unknown",
      result: null,
      resultTruncated: false,
    });
  }
  const memberTurns = new Map<string, string>();
  const latestMemberTurn = new Map<string, string>();
  const latestMemberLifecycleSeq = new Map<string, number>();
  const lastMessages = new Map<string, string>();
  for (const event of current) {
    if (
      event.type !== "turn/started" ||
      !event.scope.turnId ||
      event.scope.turnId === turnId
    )
      continue;
    const memberId =
      (event.data.parentToolCallId
        ? calls.get(event.data.parentToolCallId)
        : undefined) ??
      (event.data.providerThreadId && members.has(event.data.providerThreadId)
        ? event.data.providerThreadId
        : undefined);
    if (!memberId) continue;
    memberTurns.set(event.scope.turnId, memberId);
    latestMemberTurn.set(memberId, event.scope.turnId);
    latestMemberLifecycleSeq.set(memberId, event.seq);
  }
  for (const event of current) {
    const memberId = event.scope.turnId
      ? memberTurns.get(event.scope.turnId)
      : undefined;
    if (!memberId || latestMemberTurn.get(memberId) !== event.scope.turnId)
      continue;
    const member = members.get(memberId);
    if (!member) continue;
    if (event.type === "turn/started") {
      member.status = "running";
      member.result = null;
    }
    if (event.type === "turn/completed") {
      latestMemberLifecycleSeq.set(memberId, event.seq);
      const status = event.data.status;
      member.status =
        status === "completed" ||
        status === "failed" ||
        status === "interrupted"
          ? status
          : "unknown";
    }
    if (
      event.type === "item/completed" &&
      event.data.item?.type === "agentMessage"
    ) {
      const text = event.data.item.text?.trim();
      if (text) lastMessages.set(memberId, text);
    }
  }
  const pendingCalls = new Map<string, { agentId: string; seq: number }>();
  for (const event of current) {
    const item = event.data.item;
    if (item?.type !== "delegation" || !item.childRef) continue;
    if (event.type === "item/started" || item.status === "pending")
      pendingCalls.set(item.id, { agentId: item.childRef, seq: event.seq });
    if (
      event.type === "item/completed" ||
      event.type === "item/delegation/completed"
    )
      pendingCalls.delete(item.id);
  }
  for (const member of members.values()) {
    const text = lastMessages.get(member.id);
    if (member.status === "completed" && text) {
      member.result = text.slice(0, 16_000);
      member.resultTruncated = text.length > 16_000;
    }
  }
  for (const pending of pendingCalls.values()) {
    const member = members.get(pending.agentId);
    if (
      member &&
      member.status !== "running" &&
      pending.seq > (latestMemberLifecycleSeq.get(pending.agentId) ?? 0)
    ) {
      member.status = "unknown";
      member.result = null;
      member.resultTruncated = false;
    }
  }
  const rows = [...members.values()];
  const bounded = rows.slice(0, 100);
  const limited = truncated || rows.length > bounded.length;
  const knownRunningCount = bounded.filter(
    (member) => member.status === "running",
  ).length;
  const unknownCount = bounded.filter(
    (member) => member.status === "unknown",
  ).length;
  return {
    turnId,
    members: bounded,
    runningCount: limited || unknownCount > 0 ? null : knownRunningCount,
    knownRunningCount,
    unknownCount,
    truncated: limited,
  };
}
