import { useEffect, useId, useState, type FormEvent } from "react";
import {
  experimental_useInterfaceLanguage,
  useSdk,
  type PluginBrowserBbSdk,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PI_API_PROVIDERS } from "./api-providers.js";

type Environment = Awaited<
  ReturnType<PluginBrowserBbSdk["projects"]["machineEnvironment"]>
>;

const text = {
  en: {
    title: "API connections",
    introduction:
      "Use Gemini, Kimi, GLM or DeepSeek through Pi. Install Pi on the machine that runs your threads, then choose a Pi model in the model picker.",
    provider: "Service",
    scope: "Save key for",
    global: "All projects",
    key: "API key",
    save: "Save key",
    remove: "Remove saved key",
    loading: "Loading…",
    saving: "Saving…",
    saved:
      "Key saved. No API request was sent; credentials have not been validated.",
    removed: "Saved key removed. A project can still inherit a global key.",
    error: "Could not save the change. Try again.",
    readError: "Could not load saved key names. Reopen this page to try again.",
    projectsError:
      "Could not load projects. Reopen this page to choose a project.",
    configured: "A key is saved in this scope. Its value is never shown.",
    inherited: "This project inherits a key from All projects.",
    absent: "No key is saved in this scope.",
    security:
      "BB stores keys encrypted on the server and passes them to agents for the selected scope on their next turn. All projects applies to every machine; a project key follows that project across machines.",
    precedence:
      "Existing Pi login credentials take priority over environment keys. Manage those with Pi on the execution machine. Saving here does not replace Pi logins or check API access.",
    documentation: "Key setup instructions",
  },
  ru: {
    title: "Подключения API",
    introduction:
      "Используйте Gemini, Kimi, GLM или DeepSeek через Pi. Установите Pi на машине, где выполняются запросы, затем выберите модель Pi в меню моделей.",
    provider: "Сервис",
    scope: "Сохранить ключ для",
    global: "Все проекты",
    key: "Ключ API",
    save: "Сохранить ключ",
    remove: "Удалить сохранённый ключ",
    loading: "Загрузка…",
    saving: "Сохранение…",
    saved:
      "Ключ сохранён. Запрос к API не отправлялся; доступ ещё не проверен.",
    removed:
      "Сохранённый ключ удалён. Проект может продолжить использовать общий ключ.",
    error: "Не удалось сохранить изменение. Попробуйте ещё раз.",
    readError:
      "Не удалось загрузить имена сохранённых ключей. Откройте страницу заново для повтора.",
    projectsError:
      "Не удалось загрузить проекты. Откройте страницу заново для выбора проекта.",
    configured:
      "Ключ сохранён для выбранной области. Его значение не показывается.",
    inherited: "Проект использует общий ключ из области «Все проекты».",
    absent: "Для выбранной области ключ не сохранён.",
    security:
      "BB хранит ключи на сервере в зашифрованном виде и передаёт агентам выбранной области со следующего запроса. Общий ключ действует на всех машинах; ключ проекта следует за проектом между машинами.",
    precedence:
      "Учётные данные входа в Pi имеют приоритет над ключами окружения. Управляйте ими через Pi на машине выполнения. Сохранение здесь не заменяет вход в Pi и не проверяет доступ к API.",
    documentation: "Инструкция по получению ключа",
  },
};

export function PiApiConnections() {
  const sdk = useSdk();
  const t = text[experimental_useInterfaceLanguage()];
  const formId = useId();
  const [provider, setProvider] = useState<(typeof PI_API_PROVIDERS)[number]>(
    PI_API_PROVIDERS[0],
  );
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectsError, setProjectsError] = useState(false);
  const [key, setKey] = useState("");
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    "saved" | "removed" | "error" | null
  >(null);
  const configured =
    environment?.variables.some(
      (entry) => entry.name === provider.environmentVariable,
    ) ?? false;
  const inherited =
    environment?.inheritedVariables.some(
      (entry) => entry.name === provider.environmentVariable,
    ) ?? false;

  useEffect(() => {
    const controller = new AbortController();
    void sdk.projects
      .list({ includePersonal: true, signal: controller.signal })
      .then(
        (items) => {
          if (!controller.signal.aborted)
            setProjects(items.map(({ id, name }) => ({ id, name })));
        },
        () => {
          if (!controller.signal.aborted) setProjectsError(true);
        },
      );
    return () => controller.abort();
  }, [sdk]);

  useEffect(() => {
    let active = true;
    const read =
      projectId === ""
        ? sdk.system
            .machineEnvironment()
            .then((result) => ({ ...result, inheritedVariables: [] }))
        : sdk.projects.machineEnvironment({ projectId });
    void read.then(
      (result) => {
        if (active) {
          setEnvironment(result);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setReadError(true);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [sdk, projectId]);

  const change = async (action: "save" | "remove") => {
    if (busy || loading || (action === "save" && key.trim() === "")) return;
    setBusy(true);
    setFeedback(null);
    const name = provider.environmentVariable;
    try {
      let result: Environment;
      if (projectId === "") {
        const saved =
          action === "save"
            ? await sdk.system.setMachineEnvironmentVariable({
                name,
                value: key.trim(),
                note: null,
              })
            : await sdk.system.deleteMachineEnvironmentVariable({ name });
        result = { ...saved, inheritedVariables: [] };
      } else {
        result =
          action === "save"
            ? await sdk.projects.setMachineEnvironmentVariable({
                projectId,
                name,
                value: key.trim(),
                note: null,
              })
            : await sdk.projects.deleteMachineEnvironmentVariable({
                projectId,
                name,
              });
      }
      setEnvironment(result);
      setReadError(false);
      setKey("");
      setFeedback(action === "save" ? "saved" : "removed");
    } catch {
      setFeedback("error");
    } finally {
      setBusy(false);
    }
  };

  const clearDraft = () => {
    setKey("");
    setFeedback(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void change("save");
  };
  const control =
    "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4 text-sm">
      <h3 className="font-medium">{t.title}</h3>
      <p className="text-muted-foreground">{t.introduction}</p>
      <div className="space-y-2">
        <label htmlFor={`${formId}-provider`}>{t.provider}</label>
        <select
          id={`${formId}-provider`}
          className={control}
          value={provider.id}
          disabled={busy}
          onChange={(event) => {
            clearDraft();
            const next = PI_API_PROVIDERS.find(
              (entry) => entry.id === event.target.value,
            );
            if (next) setProvider(next);
          }}
        >
          {PI_API_PROVIDERS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${formId}-scope`}>{t.scope}</label>
        <select
          id={`${formId}-scope`}
          className={control}
          value={projectId}
          disabled={busy}
          onChange={(event) => {
            clearDraft();
            setLoading(true);
            setReadError(false);
            setEnvironment(null);
            setProjectId(event.target.value);
          }}
        >
          <option value="">{t.global}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {projectsError ? <p role="alert">{t.projectsError}</p> : null}
      </div>
      <p className="break-words font-mono text-xs text-muted-foreground">
        {provider.environmentVariable}
      </p>
      <p
        role={readError ? "alert" : "status"}
        className="text-muted-foreground"
      >
        {loading
          ? t.loading
          : readError
            ? t.readError
            : configured
              ? t.configured
              : inherited
                ? t.inherited
                : t.absent}
      </p>
      <div className="space-y-2">
        <label htmlFor={`${formId}-key`}>{t.key}</label>
        <Input
          id={`${formId}-key`}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          maxLength={65536}
          value={key}
          disabled={busy}
          onChange={(event) => {
            setKey(event.target.value);
            setFeedback(null);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || loading || key.trim() === ""}
        >
          {busy ? t.saving : t.save}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || loading || !configured}
          onClick={() => void change("remove")}
        >
          {t.remove}
        </Button>
      </div>
      {feedback === null ? null : (
        <p role={feedback === "error" ? "alert" : "status"}>{t[feedback]}</p>
      )}
      <p className="text-xs text-muted-foreground">{t.security}</p>
      <p className="text-xs text-muted-foreground">{t.precedence}</p>
      <a
        href={provider.documentationUrl}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-4"
      >
        {t.documentation}
      </a>
    </form>
  );
}
