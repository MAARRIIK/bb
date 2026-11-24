import { useState } from "react";
import {
  definePluginApp,
  experimental_useInterfaceLanguage,
  experimental_useRpcQuery,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { teamContract, type HistoryEntry } from "./contract.js";

const copy = {
  ru: {
    agents: "Агенты",
    team: "Команда",
    conversation: "Диалог",
    open: "Открыть диалог",
    loading: "Проверяем события агентов…",
    count: (count: number) => `${count} работают сейчас`,
    partialCount: (count: number) =>
      `${count} работают подтверждённо · точное число неизвестно`,
    stale:
      "Обновление не удалось. Ниже последние известные данные; текущее число работающих агентов неизвестно.",
    error: "Не удалось обновить данные",
    retry: "Повторить",
    scope:
      "Последний ход выбранного диалога. Повторные обращения к одному агенту объединены.",
    unknown: (count: number) =>
      `Для ${count} агентов провайдер не сообщил полный жизненный цикл. Они не считаются завершёнными.`,
    truncated:
      "Достигнут предел истории. Список и количество могут быть неполными.",
    empty: "В этом ходе события запуска субагентов пока не найдены.",
    model: "Модель",
    modelUnknown: "не сообщена провайдером",
    noResult: "Результат ещё не сообщён.",
    finalResult: "Итог",
    resultPending: "Итог появится после завершения работы агента.",
    resultStopped:
      "Итог не получен: работа агента завершилась ошибкой или была остановлена.",
    noThreads: "Нет доступных диалогов",
    history: "История",
    hideHistory: "Скрыть историю",
    technical: "Технические подробности",
    activity: "Ход работы и технические детали",
    older: "Загрузить раньше",
    historyLoading: "Загружаем историю…",
    noHistory: "В этой части истории текстовых ответов агента пока нет.",
    promptsMissing:
      "Начальные запросы пользователя не переданы провайдером. Ниже только записанные сообщения ассистента, инструменты и события состояния.",
    historyBounded:
      "История прочитана в пределах лимита. Часть записей может отсутствовать; более ранние записи доступны кнопкой ниже.",
    textTruncated:
      "Текст сокращён до 16 000 символов или уже был сокращён провайдером.",
    turnChanged:
      "Ход диалога изменился. Закройте историю и откройте её для текущего хода.",
    historyPageLimit:
      "Достигнут предел просмотра. Закройте и снова откройте историю для нового чтения.",
    kinds: { assistant: "Ассистент", tool: "Инструмент", status: "Состояние" },
    missing: "Выбранный диалог недоступен. Выберите другой диалог.",
    states: {
      running: "Работает",
      completed: "Завершён",
      failed: "Ошибка",
      interrupted: "Прерван",
      unknown: "Статус не сообщён",
    },
  },
  en: {
    agents: "Agents",
    team: "Team",
    conversation: "Conversation",
    open: "Open conversation",
    loading: "Checking agent events…",
    count: (count: number) => `${count} running now`,
    partialCount: (count: number) =>
      `${count} confirmed running · exact count unknown`,
    stale:
      "Refresh failed. The data below is the last known state; the current running count is unknown.",
    error: "Could not refresh data",
    retry: "Retry",
    scope:
      "The selected conversation's latest turn. Repeated calls to the same agent are combined.",
    unknown: (count: number) =>
      `The provider did not report a complete lifecycle for ${count} agents. They are not counted as completed.`,
    truncated:
      "The history limit was reached. The list and counts may be incomplete.",
    empty: "No subagent launch events were found in this turn yet.",
    model: "Model",
    modelUnknown: "not reported by the provider",
    noResult: "No result reported yet.",
    finalResult: "Final result",
    resultPending: "The final result will appear after the agent finishes.",
    resultStopped:
      "No final result was received: the agent failed or was stopped.",
    noThreads: "No conversations available",
    history: "History",
    hideHistory: "Hide history",
    technical: "Technical details",
    activity: "Activity and technical details",
    older: "Load earlier",
    historyLoading: "Loading history…",
    noHistory:
      "No recorded text replies from this agent are available in this part of the history yet.",
    promptsMissing:
      "The provider did not supply initial user prompts. Only recorded assistant messages, tools, and lifecycle events are shown below.",
    historyBounded:
      "History was read within a bounded limit. Some entries may be missing; earlier entries can be loaded below.",
    textTruncated:
      "Text was limited to 16,000 characters or was already truncated by the provider.",
    turnChanged:
      "The conversation turn changed. Close history and reopen it for the current turn.",
    historyPageLimit:
      "The viewing limit was reached. Close and reopen history to start a new read.",
    kinds: { assistant: "Assistant", tool: "Tool", status: "Status" },
    missing:
      "The selected conversation is unavailable. Choose another conversation.",
    states: {
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      interrupted: "Interrupted",
      unknown: "Status not reported",
    },
  },
};

function taskLabel(task: string): string {
  return task.startsWith("/root/")
    ? task.slice("/root/".length).replaceAll("_", " ")
    : task;
}

function AgentHistory({
  threadId,
  agentId,
  turnId,
}: {
  threadId: string;
  agentId: string;
  turnId: string | null;
}) {
  const language = experimental_useInterfaceLanguage();
  const t = copy[language];
  const [beforeSeq, setBeforeSeq] = useState<number | null>(null);
  const [stored, setStored] = useState<HistoryEntry[]>([]);
  const query = experimental_useRpcQuery({
    contract: teamContract,
    method: "history",
    input: { threadId, agentId, beforeSeq },
  });
  const page = query.data;
  const changed =
    page !== undefined && (page.agentId !== agentId || page.turnId !== turnId);
  const entries = [
    ...new Map(
      [...stored, ...(changed ? [] : (page?.entries ?? []))].map((entry) => [
        entry.seq,
        entry,
      ]),
    ).values(),
  ].sort((a, b) => a.seq - b.seq);
  const atLimit = stored.length >= 600;
  const completedItems = new Set(
    entries
      .filter(
        (entry) =>
          entry.kind === "tool" &&
          entry.phase === "completed" &&
          entry.itemId !== null,
      )
      .map((entry) => entry.itemId),
  );
  const visibleEntries = entries.filter(
    (entry) =>
      entry.kind !== "tool" ||
      entry.phase !== "started" ||
      !completedItems.has(entry.itemId),
  );
  const messages = visibleEntries.filter((entry) => entry.kind === "assistant");
  const activity = visibleEntries.filter((entry) => entry.kind !== "assistant");
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm text-muted-foreground">{t.promptsMissing}</p>
      {query.error && (
        <p role="alert" className="text-sm">
          {t.error}: {query.error.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            {t.retry}
          </button>
        </p>
      )}
      {changed ? (
        <p role="status" className="text-sm">
          {t.turnChanged}
        </p>
      ) : (
        <>
          {query.isLoading && (
            <p role="status" className="text-sm">
              {t.historyLoading}
            </p>
          )}
          {page?.truncated && (
            <p className="text-sm text-muted-foreground">{t.historyBounded}</p>
          )}
          {page && messages.length === 0 && (
            <p className="text-sm">{t.noHistory}</p>
          )}
          <ol className="space-y-3">
            {messages.map((entry) => (
              <li key={entry.seq} className="space-y-2 rounded border p-3">
                <p className="text-xs text-muted-foreground">
                  {t.kinds.assistant} ·{" "}
                  {new Date(entry.timestamp).toLocaleString(
                    language === "ru" ? "ru-RU" : "en-US",
                  )}
                </p>
                <div className="whitespace-pre-wrap break-words text-sm">
                  {entry.text}
                </div>
                {entry.truncated && (
                  <p className="text-sm text-muted-foreground">
                    {t.textTruncated}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {activity.length > 0 && (
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t.activity}
              </summary>
              <ol className="mt-3 space-y-3">
                {activity.map((entry) => (
                  <li key={entry.seq} className="space-y-2 rounded border p-3">
                    <p className="text-xs text-muted-foreground">
                      {t.kinds[entry.kind]} ·{" "}
                      {new Date(entry.timestamp).toLocaleString(
                        language === "ru" ? "ru-RU" : "en-US",
                      )}{" "}
                    </p>
                    <p className="text-sm">{entry.summary[language]}</p>
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        {t.technical}
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
                        #{entry.seq}
                        {"\n"}
                        {entry.text}
                      </pre>
                    </details>
                    {entry.truncated && (
                      <p className="text-sm text-muted-foreground">
                        {t.textTruncated}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {atLimit && <p className="text-sm">{t.historyPageLimit}</p>}
          {page?.nextBeforeSeq !== null &&
            page?.nextBeforeSeq !== undefined &&
            !atLimit && (
              <button
                type="button"
                disabled={query.isFetching || query.error !== null}
                className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                onClick={() => {
                  setStored(entries);
                  setBeforeSeq(page.nextBeforeSeq);
                }}
              >
                {t.older}
              </button>
            )}
        </>
      )}
    </div>
  );
}

function HistoryDisclosure(props: {
  threadId: string;
  agentId: string;
  turnId: string | null;
}) {
  const t = copy[experimental_useInterfaceLanguage()];
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="rounded border px-3 py-2 text-sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t.hideHistory : t.history}
      </button>
      {open && <AgentHistory {...props} />}
    </div>
  );
}

function Team({ threadId }: { threadId: string }) {
  const t = copy[experimental_useInterfaceLanguage()];
  const query = experimental_useRpcQuery({
    contract: teamContract,
    method: "current",
    input: { threadId },
  });
  const navigate = useBbNavigate();
  const data = query.data;
  return (
    <section className="space-y-4" aria-label={t.team}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t.team}</h2>
          <p className="text-sm" role="status">
            {query.error
              ? t.stale
              : data
                ? data.runningCount === null
                  ? t.partialCount(data.knownRunningCount)
                  : t.count(data.runningCount)
                : t.loading}
          </p>
        </div>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() => navigate.toThread(threadId)}
        >
          {t.open}
        </button>
      </div>
      {query.error && (
        <p role="alert" className="text-sm">
          {t.error}: {query.error.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void query.refetch()}
          >
            {t.retry}
          </button>
        </p>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">{t.scope}</p>
          {data.unknownCount > 0 && (
            <p className="text-sm">{t.unknown(data.unknownCount)}</p>
          )}
          {data.truncated && (
            <p role="alert" className="text-sm">
              {t.truncated}
            </p>
          )}
          {data.members.length === 0 && <p className="text-sm">{t.empty}</p>}
          <div className="space-y-3">
            {data.members.map((member) => (
              <article
                key={member.id}
                className="space-y-2 rounded-lg border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-semibold">
                    {taskLabel(member.task)}
                  </h3>
                  <span className="text-sm">{t.states[member.status]}</span>
                </div>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={member.id}
                >
                  {member.id}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.model}: {member.model ?? t.modelUnknown}
                </p>
                <section
                  className="space-y-2 rounded border p-3"
                  aria-label={t.finalResult}
                >
                  <h4 className="text-sm font-semibold">{t.finalResult}</h4>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {member.status === "completed"
                      ? (member.result ?? t.noResult)
                      : member.status === "failed" ||
                          member.status === "interrupted"
                        ? t.resultStopped
                        : t.resultPending}
                  </p>
                  {member.status === "completed" && member.resultTruncated && (
                    <p className="text-sm text-muted-foreground">
                      {t.textTruncated}
                    </p>
                  )}
                </section>
                <HistoryDisclosure
                  key={`${threadId}:${member.id}:${data.turnId}`}
                  threadId={threadId}
                  agentId={member.id}
                  turnId={data.turnId}
                />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Agents() {
  const t = copy[experimental_useInterfaceLanguage()];
  const { threads } = experimental_useSidebarThreads();
  const [selected, setSelected] = useState<string | null>(null);
  const threadId =
    selected ??
    threads.find((thread) => thread.status === "active")?.id ??
    threads[0]?.id ??
    null;
  const available =
    threadId !== null && threads.some((thread) => thread.id === threadId);
  return (
    <main className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-xl font-semibold">{t.agents}</h1>
        <label className="block space-y-2 text-sm">
          <span>{t.conversation}</span>
          <select
            className="w-full rounded border bg-background p-2 text-sm"
            value={threadId ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {!threadId && <option value="">{t.noThreads}</option>}
            {threadId && !available && (
              <option value={threadId}>{t.missing}</option>
            )}
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.displayTitle}
              </option>
            ))}
          </select>
        </label>
        {threadId && !available && (
          <p role="status" className="text-sm">
            {t.missing}
          </p>
        )}
        {threadId && available && <Team key={threadId} threadId={threadId} />}
      </div>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "agents",
    title: "Агенты",
    icon: "UserRound",
    path: "agents",
    component: Agents,
  });
});
