import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useInterfaceLanguage,
  useRpc,
  type ExperimentalThreadActionTabProps,
  type PluginPendingInteractionProps,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { rpcContract } from "./src/contracts.js";
import { actionsSchema } from "./src/vocabulary.js";

type Status = StandardSchemaV1InferOutput<
  (typeof rpcContract)["status"]["output"]
>;
type Desktops = StandardSchemaV1InferOutput<
  (typeof rpcContract)["desktops"]["output"]
>;
const approvalSchema = z.object({ actions: actionsSchema }).strict();
const copy = {
  en: {
    title: "DeepSeek Web (experimental)",
    intro:
      "Uses chat.deepseek.com without an API key. Sign in manually in the dedicated browser tab. The website's selected model is used; account access and subscription quotas are not verified by BB.",
    desktop: "Desktop browser",
    choose: "Choose a connected desktop",
    connect: "Open browser and connect",
    reconnect: "Reconnect browser",
    refresh: "Refresh status",
    disconnect: "Release browser connection",
    disconnected: "No browser is connected to this thread.",
    connected:
      "A dedicated browser tab is connected to this thread. This does not confirm authentication.",
    verification:
      "If login or verification requires browser control, take control manually and complete it yourself. Then reconnect the browser to the same conversation. CAPTCHA or a changed page stops the turn; send a new request when ready. Requests are not automatically resubmitted.",
    ready:
      "The page appears ready. This does not verify authentication, the active model, or quota.",
    login_required: "Sign in on the website.",
    verification_required: "Complete the website verification yourself.",
    layout_changed: "The website layout is not recognized.",
    generating: "The website is generating a response.",
    working: "Working…",
    approval: "Approve workspace actions",
    warning:
      "Review the complete file contents before approving. Commands run with your local account permissions, without an additional sandbox.",
    fileContents: "File contents",
    approve: "Approve actions",
    deny: "Deny",
    invalid: "This action request is invalid. It cannot be approved.",
    cancel: "Cancel",
  },
  ru: {
    title: "DeepSeek Web (экспериментальный)",
    intro:
      "Использует chat.deepseek.com без API-ключа. Войди вручную в отдельной вкладке браузера. Работает выбранная на сайте модель; BB не проверяет доступ аккаунта и квоты подписки.",
    desktop: "Браузер на компьютере",
    choose: "Выбери подключённый компьютер",
    connect: "Открыть браузер и подключить",
    reconnect: "Подключить снова",
    refresh: "Обновить статус",
    disconnect: "Освободить подключение браузера",
    disconnected: "К этому диалогу браузер не подключён.",
    connected:
      "Отдельная вкладка браузера подключена к этому диалогу. Это ещё не подтверждает авторизацию.",
    verification:
      "Если для входа или проверки нужно управление браузером, возьми его вручную и пройди проверку сам. Затем нажми «Подключить снова»: продолжится тот же разговор. CAPTCHA или изменившаяся страница останавливают ход; отправь новый запрос, когда всё готово. Автоматической повторной отправки нет.",
    ready:
      "Страница выглядит готовой. Это не проверка авторизации, активной модели или квоты.",
    login_required: "Войди в аккаунт на сайте.",
    verification_required: "Пройди проверку на сайте самостоятельно.",
    layout_changed: "Страница сайта не распознана.",
    generating: "Сайт формирует ответ.",
    working: "Выполняется…",
    approval: "Подтвердить действия в рабочей папке",
    warning:
      "Перед подтверждением проверь полное содержимое файлов. Команды выполняются с правами твоего локального пользователя, без дополнительной песочницы.",
    fileContents: "Содержимое файла",
    approve: "Подтвердить действия",
    deny: "Отклонить",
    invalid: "Некорректный запрос действий. Подтверждение недоступно.",
    cancel: "Отмена",
  },
};

function DeepSeekSetup(props: ExperimentalThreadActionTabProps) {
  return <DeepSeekSetupForm key={props.threadId} {...props} />;
}

function DeepSeekSetupForm({ threadId }: ExperimentalThreadActionTabProps) {
  const rpc = useRpc<typeof rpcContract>();
  const t = copy[experimental_useInterfaceLanguage()];
  const [desktops, setDesktops] = useState<Desktops>([]);
  const [instanceId, setInstanceId] = useState("");
  const [status, setStatus] = useState<Status>({
    binding: null,
    inspection: null,
  });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      rpc.call("desktops", { threadId }),
      rpc.call("status", { threadId }),
    ])
      .then(([nextDesktops, nextStatus]) => {
        if (!active) return;
        if (nextDesktops.status === "fulfilled")
          setDesktops(nextDesktops.value);
        else
          setError(
            nextDesktops.reason instanceof Error
              ? nextDesktops.reason.message
              : String(nextDesktops.reason),
          );
        if (nextStatus.status === "fulfilled") {
          setStatus(nextStatus.value);
          setInstanceId(nextStatus.value.binding?.instanceId ?? "");
        } else
          setError(
            nextStatus.reason instanceof Error
              ? nextStatus.reason.message
              : String(nextStatus.reason),
          );
      })
      .catch((nextError: unknown) => {
        if (active)
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [rpc, threadId]);
  const run = async (action: "connect" | "refresh" | "disconnect") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action === "connect") {
        const binding = await rpc.call("connect", { threadId, instanceId });
        setStatus({ binding, inspection: null });
      } else if (action === "disconnect") {
        await rpc.call("disconnect", { threadId });
        setStatus({ binding: null, inspection: null });
        return;
      }
      const [nextStatus, nextDesktops] = await Promise.all([
        rpc.call("status", { threadId }),
        rpc.call("desktops", { threadId }),
      ]);
      setStatus(nextStatus);
      setDesktops(nextDesktops);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-label={t.title} className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-medium">{t.title}</h3>
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t.desktop}
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={instanceId}
          disabled={busy || status.binding !== null}
          onChange={(event) => setInstanceId(event.target.value)}
        >
          <option value="">{t.choose}</option>
          {desktops.map((desktop) => (
            <option key={desktop.id} value={desktop.id}>
              {desktop.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || instanceId === ""}
          onClick={() => void run("connect")}
        >
          {busy ? t.working : status.binding === null ? t.connect : t.reconnect}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void run("refresh")}
        >
          {t.refresh}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || status.binding === null}
          onClick={() => void run("disconnect")}
        >
          {t.disconnect}
        </Button>
      </div>
      <p role="status" className="text-sm">
        {status.binding === null ? t.disconnected : t.connected}
      </p>
      {status.inspection ? (
        <div className="space-y-1 text-sm">
          <p>{t[status.inspection.status]}</p>
          <p>{status.inspection.hint}</p>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">{t.verification}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ApproveActions(props: PluginPendingInteractionProps) {
  return <ApproveActionsForm key={props.interaction.id} {...props} />;
}

function ApproveActionsForm({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const t = copy[experimental_useInterfaceLanguage()];
  const parsed = approvalSchema.safeParse(interaction.payload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const answer = async (approved: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (parsed.success) await submit({ approved });
      else await cancel();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section aria-label={t.approval} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t.approval}</h3>
      {parsed.success ? (
        <>
          <p className="text-sm text-muted-foreground">{t.warning}</p>
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {parsed.data.actions.map((action) => (
              <div
                key={action.id}
                className="rounded-md border border-border p-2"
              >
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(
                    action.kind === "write"
                      ? { id: action.id, kind: action.kind, path: action.path }
                      : action,
                    null,
                    2,
                  )}
                </pre>
                {action.kind === "write" ? (
                  <details open={action.content.length <= 4_000}>
                    <summary className="cursor-pointer text-sm">
                      {t.fileContents}
                    </summary>
                    <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-all text-xs">
                      {action.content}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p role="alert" className="text-sm">
          {t.invalid}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void answer(false)}
        >
          {parsed.success ? t.deny : t.cancel}
        </Button>
        {parsed.success ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => void answer(true)}
          >
            {t.approve}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "setup",
    title: "DeepSeek Web",
    icon: "Globe",
    component: DeepSeekSetup,
  });
  app.slots.pendingInteraction({
    id: "approve-actions",
    component: ApproveActions,
  });
});
