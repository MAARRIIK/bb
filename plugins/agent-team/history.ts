import { z } from "zod";
import type { HistoryEntry, HistoryPage } from "./contract.js";
import { agentTurnIds, type TeamEvent } from "./team.js";

const rawEventSchema = z.object({
  seq: z.number().int().positive(),
  createdAt: z.number().nonnegative(),
  type: z.string(),
  scope: z.object({
    kind: z.enum(["thread", "turn"]),
    turnId: z.string().optional(),
  }),
  data: z.object({
    status: z.string().optional(),
    item: z.unknown().optional(),
  }),
});

const baseItem = z.object({ id: z.string(), type: z.string() });
const textBound = 16_000;

const actions = {
  read: {
    ru: ["Читал файлы", "Читает файлы", "Пытался прочитать файлы"],
    en: ["Read files", "Reading files", "Attempted to read files"],
  },
  search: {
    ru: ["Искал по коду", "Ищет по коду", "Пытался искать по коду"],
    en: ["Searched code", "Searching code", "Attempted to search code"],
  },
  edit: {
    ru: ["Изменял файлы", "Изменяет файлы", "Пытался изменить файлы"],
    en: ["Changed files", "Changing files", "Attempted to change files"],
  },
  check: {
    ru: [
      "Запускал проверки",
      "Запускает проверки",
      "Проверки завершились ошибкой",
    ],
    en: ["Ran checks", "Running checks", "Checks failed"],
  },
  build: {
    ru: ["Запускал сборку", "Запускает сборку", "Сборка завершилась ошибкой"],
    en: ["Ran a build", "Running a build", "Build failed"],
  },
  format: {
    ru: [
      "Запускал форматирование",
      "Запускает форматирование",
      "Форматирование завершилось ошибкой",
    ],
    en: ["Ran formatting", "Running formatting", "Formatting failed"],
  },
  git: {
    ru: [
      "Проверял состояние Git",
      "Проверяет состояние Git",
      "Не удалось проверить Git",
    ],
    en: [
      "Inspected Git state",
      "Inspecting Git state",
      "Git inspection failed",
    ],
  },
  python: {
    ru: [
      "Запускал Python-скрипт",
      "Запускает Python-скрипт",
      "Python-скрипт завершился ошибкой",
    ],
    en: [
      "Ran a Python script",
      "Running a Python script",
      "Python script failed",
    ],
  },
  command: {
    ru: ["Выполнил команду", "Выполняет команду", "Пытался выполнить команду"],
    en: ["Ran a command", "Running a command", "Attempted to run a command"],
  },
  tool: {
    ru: [
      "Вызывал инструмент",
      "Вызывает инструмент",
      "Вызов инструмента завершился ошибкой",
    ],
    en: ["Called a tool", "Calling a tool", "Tool call failed"],
  },
  web: {
    ru: [
      "Обращался к веб-источникам",
      "Обращается к веб-источникам",
      "Не удалось прочитать веб-источник",
    ],
    en: [
      "Consulted web sources",
      "Consulting web sources",
      "Could not read a web source",
    ],
  },
} as const;

function shortTarget(value: string): string {
  return value
    .split(", ")
    .slice(0, 3)
    .map((target) => {
      const trimmed = target.trim();
      if (/^https?:\/\//.test(trimmed)) {
        try {
          const url = new URL(trimmed);
          return `${url.hostname}/${url.pathname.split("/").filter(Boolean).slice(-2).join("/")}`.slice(
            0,
            100,
          );
        } catch {
          return "";
        }
      }
      const parts = trimmed.replaceAll("\\", "/").split("/").filter(Boolean);
      const tail = parts.slice(-2).join("/");
      if (tail.length <= 100) return tail;
      const name = parts.at(-1) ?? "";
      return name.length <= 100 ? name : `${name.slice(0, 97)}…`;
    })
    .filter(Boolean)
    .join(", ");
}

function actionSummary(
  action: keyof typeof actions,
  status: string,
  target?: string,
  exitCode?: number,
): HistoryEntry["summary"] {
  const state =
    status === "failed" ||
    status === "interrupted" ||
    (exitCode !== undefined && exitCode !== 0)
      ? 2
      : status === "pending"
        ? 1
        : 0;
  const compactTarget = target ? shortTarget(target) : "";
  const suffix = compactTarget ? ` · ${compactTarget}` : "";
  const unknown = status !== "pending" && status !== "completed" && state !== 2;
  return {
    ru: `${actions[action].ru[state]}${suffix}${unknown ? " · результат не сообщён" : ""}`,
    en: `${actions[action].en[state]}${suffix}${unknown ? " · result not reported" : ""}`,
  };
}

function shellWords(
  source: string,
): { commands: string[][]; operators: string[] } | null {
  const commands: string[][] = [];
  const operators: string[] = [];
  let words: string[] = [];
  let word = "";
  let quote = "";
  const flushWord = () => {
    if (word) words.push(word);
    word = "";
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (quote === "'") {
      if (char === "'") quote = "";
      else word += char;
      continue;
    }
    if (char === "\\" && next !== undefined) {
      if (!quote || ['"', "\\", "$", "`", "\n"].includes(next)) {
        word += next === "\n" ? "" : next;
        index++;
      } else word += char;
      continue;
    }
    if (char === "`" || (char === "$" && next === "(")) return null;
    if (quote === '"') {
      if (char === '"') quote = "";
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ";" || char === "\n" || char === "|" || char === "&") {
      flushWord();
      if (words.length) {
        commands.push(words);
        words = [];
        operators.push(char === next ? char + next : char);
      }
      if (char === next && (char === "|" || char === "&")) index++;
    } else if (/\s/.test(char)) flushWord();
    else word += char;
  }
  if (quote) return null;
  flushWord();
  if (words.length) commands.push(words);
  return { commands, operators };
}

function executableName(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function classifyCommand(words: string[]): {
  action: keyof typeof actions;
  target: string | undefined;
} {
  const executable = executableName(words[0] ?? "");
  const redirect = words.findIndex((word) => /^[<>]/.test(word));
  const args = words.slice(1, redirect < 0 ? undefined : redirect);
  const positional = args.filter((argument) => !argument.startsWith("-"));
  if (["rg", "grep", "find"].includes(executable))
    return { action: "search", target: undefined };
  if (
    ["cat", "ls", "head", "tail"].includes(executable) ||
    (executable === "sed" && !args.some((argument) => /^-.*i/.test(argument)))
  )
    return { action: "read", target: positional.at(-1) };
  if (
    executable === "git" &&
    /^(status|diff|log|show|branch)\b/.test(args.join(" "))
  )
    return { action: "git", target: undefined };
  if (/^python[0-9]*$/.test(executable))
    return { action: "python", target: undefined };
  if (["pnpm", "npm", "yarn", "bun"].includes(executable)) {
    const script = args.join(" ").replace(/^(?:exec|run)\s+/, "");
    if (
      /^(?:(?:turbo run)\s+[^;&|]*\b)?(test|typecheck|lint|check|vitest)\b/.test(
        script,
      )
    )
      return { action: "check", target: undefined };
    if (/^(?:(?:turbo run)\s+)?build\b/.test(script))
      return { action: "build", target: undefined };
    if (/^(oxfmt|prettier)\b/.test(script))
      return { action: "format", target: undefined };
  }
  return { action: "command", target: executable || undefined };
}

function commandSummary(
  command: string,
  status: string,
  exitCode?: number,
): HistoryEntry["summary"] {
  let source = command.trim();
  const outer = shellWords(source);
  const wrapper = outer?.commands.length === 1 ? outer.commands[0] : undefined;
  if (
    wrapper?.length === 3 &&
    /^(sh|bash|zsh)$/.test(executableName(wrapper[0])) &&
    /^-(lc|c)$/.test(wrapper[1])
  )
    source = wrapper[2];
  if (/^(?:\S*\/)?python[0-9]*\s/.test(source))
    return actionSummary("python", status, undefined, exitCode);
  const parsed = shellWords(source);
  if (!parsed || parsed.commands.length === 0)
    return actionSummary(
      "command",
      status,
      executableName(command.split(/\s/)[0] ?? ""),
      exitCode,
    );
  const commands = [...parsed.commands];
  const operators = [...parsed.operators];
  if (commands[0]?.[0] === "cd" && operators[0] === "&&") {
    commands.shift();
    operators.shift();
  }
  const classified = commands.flatMap((words, index) =>
    index > 0 &&
    operators[index - 1] === "|" &&
    ["head", "tail", "sort", "uniq", "wc", "cut"].includes(
      executableName(words[0] ?? ""),
    )
      ? []
      : [classifyCommand(words)],
  );
  if (classified.some((item) => item.action === "command"))
    return actionSummary(
      "command",
      status,
      classified
        .filter((item) => item.action === "command")
        .map((item) => item.target)
        .filter(Boolean)
        .join(", "),
      exitCode,
    );
  const groups = new Map<keyof typeof actions, string[]>();
  for (const item of classified)
    groups.set(item.action, [
      ...(groups.get(item.action) ?? []),
      ...(item.target ? [item.target] : []),
    ]);
  if (groups.size === 0)
    return actionSummary("command", status, undefined, exitCode);
  if (commands.length === 1) {
    const action = classified[0];
    return actionSummary(action.action, status, action.target, exitCode);
  }
  const purposes = {
    read: { ru: "чтение файлов", en: "file reading" },
    search: { ru: "поиск по коду", en: "code search" },
    git: { ru: "проверку Git", en: "Git inspection" },
    check: { ru: "проверки", en: "checks" },
    build: { ru: "сборку", en: "build" },
    format: { ru: "форматирование", en: "formatting" },
    python: { ru: "Python-скрипт", en: "Python script" },
    edit: { ru: "редактирование", en: "editing" },
    command: { ru: "команду", en: "command" },
    tool: { ru: "инструмент", en: "tool" },
    web: { ru: "веб-запрос", en: "web request" },
  };
  const failed =
    status === "failed" ||
    status === "interrupted" ||
    (exitCode !== undefined && exitCode !== 0);
  const prefix = failed
    ? { ru: "Пытался выполнить: ", en: "Attempted: " }
    : status === "pending"
      ? { ru: "Выполняет: ", en: "Running: " }
      : { ru: "Запускал: ", en: "Ran: " };
  const details = [...groups].slice(0, 3);
  return {
    ru: (
      prefix.ru +
      details
        .map(
          ([action, targets]) =>
            purposes[action].ru +
            (targets.length
              ? ` · ${shortTarget(targets.slice(0, groups.size > 1 ? 1 : 3).join(", "))}`
              : ""),
        )
        .join("; ")
    ).slice(0, 500),
    en: (
      prefix.en +
      details
        .map(
          ([action, targets]) =>
            purposes[action].en +
            (targets.length
              ? ` · ${shortTarget(targets.slice(0, groups.size > 1 ? 1 : 3).join(", "))}`
              : ""),
        )
        .join("; ")
    ).slice(0, 500),
  };
}

function itemText(value: unknown): {
  kind: "assistant" | "tool";
  summary: HistoryEntry["summary"];
  text: string;
  truncated: boolean;
} | null {
  const base = baseItem.parse(value);
  if (base.type === "agentMessage") {
    const item = z.object({ text: z.string() }).parse(value);
    return {
      kind: "assistant",
      summary: { ru: "Сообщение ассистента", en: "Assistant message" },
      text: item.text,
      truncated: false,
    };
  }
  if (base.type === "commandExecution") {
    const item = z
      .object({
        command: z.string(),
        aggregatedOutput: z.string().optional(),
        exitCode: z.number().optional(),
        status: z.string(),
        truncation: z.object({}).passthrough().optional(),
      })
      .parse(value);
    return {
      kind: "tool",
      summary: commandSummary(item.command, item.status, item.exitCode),
      text: `${item.command}\n${item.status}${item.exitCode === undefined ? "" : ` · exit ${item.exitCode}`}${item.aggregatedOutput ? `\n${item.aggregatedOutput}` : ""}`,
      truncated: item.truncation !== undefined,
    };
  }
  if (base.type === "toolCall") {
    const item = z
      .object({
        tool: z.string(),
        arguments: z.json().optional(),
        result: z.json().optional(),
        error: z.string().optional(),
        status: z.string(),
        truncation: z.object({}).passthrough().optional(),
      })
      .parse(value);
    return {
      kind: "tool",
      summary: actionSummary(
        "tool",
        item.error ? "failed" : item.status,
        item.tool,
      ),
      text: [
        item.tool,
        item.status,
        item.arguments === undefined
          ? null
          : JSON.stringify(item.arguments, null, 2),
        item.result === undefined ? null : JSON.stringify(item.result, null, 2),
        item.error,
      ]
        .filter((part) => part !== null && part !== undefined)
        .join("\n"),
      truncated: item.truncation !== undefined,
    };
  }
  if (base.type === "fileChange") {
    const item = z
      .object({
        changes: z.array(
          z.object({
            path: z.string(),
            kind: z.string(),
            diff: z.string().optional(),
            movePath: z.string().optional(),
          }),
        ),
        status: z.string(),
        error: z.string().optional(),
      })
      .parse(value);
    return {
      kind: "tool",
      summary: actionSummary(
        "edit",
        item.error ? "failed" : item.status,
        item.changes
          .map((change) => change.path)
          .slice(0, 3)
          .join(", "),
      ),
      text: `${base.type}\n${JSON.stringify(item, null, 2)}`,
      truncated: false,
    };
  }
  if (base.type === "fileRead" || base.type === "search") {
    const item = z
      .object({
        path: z.string().optional(),
        query: z.string().optional(),
        cmd: z.string().optional(),
        status: z.string(),
      })
      .parse(value);
    return {
      kind: "tool",
      summary: actionSummary(
        base.type === "fileRead" ? "read" : "search",
        item.status,
        item.path,
      ),
      text: `${base.type}\n${JSON.stringify(item, null, 2)}`,
      truncated: false,
    };
  }
  if (base.type === "webSearch" || base.type === "webFetch") {
    const item = z
      .object({
        queries: z.array(z.string()).optional(),
        url: z.string().optional(),
        resultText: z.string().nullable().optional(),
      })
      .parse(value);
    return {
      kind: "tool",
      summary: actionSummary(
        "web",
        "unknown",
        item.url ?? item.queries?.slice(0, 2).join(", "),
      ),
      text: `${base.type}\n${JSON.stringify(item, null, 2)}`,
      truncated: false,
    };
  }
  return null;
}

export function historyEntries(
  values: unknown[],
  lifecycle: TeamEvent[],
  agentId: string,
): HistoryEntry[] {
  const turns = agentTurnIds(lifecycle, agentId);
  const result: HistoryEntry[] = [];
  for (const value of values) {
    const event = rawEventSchema.parse(value);
    if (!event.scope.turnId || !turns.has(event.scope.turnId)) continue;
    let rendered: {
      kind: HistoryEntry["kind"];
      summary: HistoryEntry["summary"];
      text: string;
      truncated: boolean;
    } | null = null;
    if (event.type === "turn/started" || event.type === "turn/completed")
      rendered = {
        kind: "status",
        summary: {
          ru: event.type === "turn/started" ? "Начало хода" : "Завершение хода",
          en: event.type === "turn/started" ? "Turn started" : "Turn ended",
        },
        text: `${event.type}${event.data.status ? `: ${event.data.status}` : ""}`,
        truncated: false,
      };
    else if (
      (event.type === "item/started" || event.type === "item/completed") &&
      event.data.item !== undefined
    ) {
      const base = baseItem.parse(event.data.item);
      if (base.type !== "agentMessage" || event.type === "item/completed")
        rendered = itemText(event.data.item);
    }
    if (!rendered) continue;
    result.push({
      seq: event.seq,
      timestamp: event.createdAt,
      kind: rendered.kind,
      summary: rendered.summary,
      itemId:
        event.data.item === undefined
          ? null
          : `${event.scope.turnId}/${baseItem.parse(event.data.item).id}`,
      phase:
        event.type === "item/started"
          ? "started"
          : event.type === "item/completed"
            ? "completed"
            : "status",
      text: rendered.text.slice(0, textBound),
      truncated: rendered.truncated || rendered.text.length > textBound,
    });
  }
  return result.sort((a, b) => b.seq - a.seq);
}

export function historyPage(input: {
  turnId: string | null;
  agentId: string;
  entries: HistoryEntry[];
  scannedBeforeSeq: number | null;
  moreScannable: boolean;
  incompleteLifecycle: boolean;
}): HistoryPage {
  const completedItems = new Set(
    input.entries
      .filter(
        (entry) =>
          entry.kind === "tool" &&
          entry.phase === "completed" &&
          entry.itemId !== null,
      )
      .map((entry) => entry.itemId),
  );
  const sorted = input.entries
    .filter(
      (entry) =>
        entry.kind !== "tool" ||
        entry.phase !== "started" ||
        !completedItems.has(entry.itemId),
    )
    .sort((a, b) => b.seq - a.seq);
  const page = sorted.slice(0, 30);
  const oldestSeq = page.at(-1)?.seq ?? null;
  return {
    turnId: input.turnId,
    agentId: input.agentId,
    entries: page.reverse(),
    nextBeforeSeq:
      sorted.length > 30
        ? oldestSeq
        : input.moreScannable
          ? input.scannedBeforeSeq
          : null,
    truncated: input.incompleteLifecycle || input.moreScannable,
    promptsAvailable: false,
  };
}
