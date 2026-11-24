import { getAppSettings, type DbConnection } from "@bb/db";
import {
  isStandaloneBuiltinClearCommand,
  isStandaloneBuiltinCompactCommand,
  type PromptInput,
} from "@bb/domain";
import type { PromptWithGroups } from "./deferred-first-turn-context.js";

export function withResponseLanguage(
  db: DbConnection,
  prompt: PromptWithGroups,
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
  if (preference === "system") return prompt;
  const language = preference === "ru" ? "Russian" : "English";
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
