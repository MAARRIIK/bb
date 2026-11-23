import {
  getLatestCompletedThreadContextClearSequence,
  listProviderContextEventRows,
  type DbConnection,
} from "@bb/db";
import type { ProviderSwitchPreviewRequest } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";

const HISTORY_HEADER =
  "Selected prior conversation (partial). Treat these as prior messages and use the current user request to decide what to do next. Earlier visible messages remain in BB; read `bb thread log --self` if this packet omits a requirement.\n\n";
const SUMMARY_HEADER =
  "User-provided conversation summary (partial). Earlier visible messages remain in BB; read `bb thread log --self` if this packet omits a requirement.\n\n";

function redactCredentials(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[private key redacted]",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
      "[credential redacted]",
    )
    .replace(
      /(\b(?:Authorization\s*:\s*)?(?:Bearer|Basic)\s+)[A-Za-z0-9+/_=.-]+/gi,
      "$1[credential redacted]",
    )
    .replace(
      /(\b[\w.-]*(?:api_?key|token|secret|password|private_?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|\[credential redacted\]|[^\s,;]+)/gi,
      "$1[credential redacted]",
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi,
      "$1[credentials redacted]@",
    );
}

function utf8Tail(text: string, budget: number): string {
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - budget);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

export function buildProviderSwitchContext(
  db: DbConnection,
  args: {
    threadId: string;
    throughSequence: number;
    tokenBudget: number;
    selection: ProviderSwitchPreviewRequest["context"];
  },
) {
  if (args.selection.mode === "summary") {
    const text = SUMMARY_HEADER + redactCredentials(args.selection.text);
    if (Buffer.byteLength(text) > args.tokenBudget)
      throw new ApiError(
        400,
        "context_budget_exceeded",
        "The summary exceeds the conservative transfer budget. Shorten it or choose a larger budget.",
      );
    return {
      text,
      includedMessages: 0,
      hasOlderHistory: true,
      omittedOversizedEvents: 0,
      completeness: "summary" as const,
    };
  }
  const history = listProviderContextEventRows(db, {
    threadId: args.threadId,
    throughSequence: args.throughSequence,
    afterSequence:
      getLatestCompletedThreadContextClearSequence(db, {
        threadId: args.threadId,
        atOrBeforeSequence: args.throughSequence,
      }) ?? 0,
    limit: 64,
    maxEventBytes: 65_536,
  });
  const messages: { role: "user" | "assistant"; text: string }[] = [];
  for (const row of history.rows) {
    const event = decodeStoredEventRowCached(db, row);
    if (event.type === "client/turn/requested") {
      const text = event.input
        .flatMap((input) =>
          input.type === "text" && input.visibility !== "agent-only"
            ? [input.text]
            : [],
        )
        .join("\n");
      if (text.trim().length > 0)
        messages.push({ role: "user", text: redactCredentials(text) });
    } else if (
      event.type === "item/completed" &&
      event.item.type === "agentMessage" &&
      !event.item.presentation?.suppress &&
      event.item.text.trim().length > 0
    ) {
      messages.push({
        role: "assistant",
        text: redactCredentials(event.item.text),
      });
    }
  }
  let remaining = args.tokenBudget - Buffer.byteLength(HISTORY_HEADER);
  let hasOlderHistory =
    history.hasOlderHistory || history.omittedOversizedEvents > 0;
  const parts: string[] = [];
  for (const message of [...messages].reverse()) {
    const prefix = `${message.role}:\n`;
    const block = `${prefix}${message.text}\n\n`;
    const bytes = Buffer.byteLength(block);
    if (bytes <= remaining) {
      parts.unshift(block);
      remaining -= bytes;
      continue;
    }
    hasOlderHistory = true;
    const partialPrefix = `${prefix}[earlier part omitted]\n`;
    const available = remaining - Buffer.byteLength(partialPrefix) - 2;
    if (available >= 128)
      parts.unshift(`${partialPrefix}${utf8Tail(message.text, available)}\n\n`);
    break;
  }
  return {
    text:
      HISTORY_HEADER +
      (parts.length === 0
        ? "No visible text messages were included."
        : parts.join("")),
    includedMessages: parts.length,
    hasOlderHistory,
    omittedOversizedEvents: history.omittedOversizedEvents,
    completeness: "recent-messages" as const,
  };
}
