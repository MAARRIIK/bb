import {
  getAppSettings,
  getLastStoredTurnRequestEvent,
  type DbConnection,
} from "@bb/db";
import {
  isStandaloneBuiltinClearCommand,
  isStandaloneBuiltinCompactCommand,
  turnRequestEventDataSchema,
  type PromptInput,
  type ResolvedInterfaceLanguage,
} from "@bb/domain";
import type { PromptWithGroups } from "./deferred-first-turn-context.js";

export function captureClientLanguage(
  db: DbConnection,
  requested: ResolvedInterfaceLanguage | null | undefined,
  sourceThreadId: string | null,
): ResolvedInterfaceLanguage | null | undefined {
  if (requested !== undefined || sourceThreadId === null) return requested;
  const row = getLastStoredTurnRequestEvent(db, sourceThreadId);
  if (row === null) return undefined;
  try {
    const parsed = turnRequestEventDataSchema
      .pick({ clientLanguage: true })
      .safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data.clientLanguage : undefined;
  } catch {
    return undefined;
  }
}

export function withResponseLanguage(
  db: DbConnection,
  prompt: PromptWithGroups & {
    clientLanguage?: ResolvedInterfaceLanguage | null;
  },
): PromptWithGroups {
  if (
    prompt.input.length === 0 ||
    isStandaloneBuiltinClearCommand(prompt.input) ||
    isStandaloneBuiltinCompactCommand(prompt.input)
  )
    return prompt;
  const settings = getAppSettings(db);
  const preference =
    settings.responseLanguage === "interface"
      ? settings.interfaceLanguage
      : settings.responseLanguage;
  const resolved = preference === "system" ? prompt.clientLanguage : preference;
  if (resolved === undefined || resolved === null) return prompt;
  const language = resolved === "ru" ? "Russian" : "English";
  const context: PromptInput = {
    type: "text",
    visibility: "agent-only",
    text: `[bb response language preference]\nUse ${language} for user-facing explanations unless the current request explicitly asks for another language. Preserve source code, filenames, commands, quoted text and tool output in their original language.\n[/bb response language preference]`,
    mentions: [],
  };
  return {
    input: [context, ...prompt.input],
    ...(prompt.inputGroups === undefined
      ? {}
      : {
          inputGroups: prompt.inputGroups.map((group, index) =>
            index === 0 ? [context, ...group] : group,
          ),
        }),
  };
}
