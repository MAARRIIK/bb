import { useEffect, useRef, useState } from "react";
import {
  experimental_useInterfaceLanguage,
  useBbNavigate,
  useRpc,
  useSdk,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { subscriptionRpcContract } from "./subscription-agents.js";

type Profiles = StandardSchemaV1InferOutput<
  (typeof subscriptionRpcContract)["listSubscriptionAgents"]["output"]
>;

const copy = {
  en: {
    title: "Sign in with subscriptions",
    open: "Open subscription connections",
    intro:
      "Antigravity, Kimi Code and Qwen Code are in the model picker alongside Codex and Claude. Use this page to sign in on the execution machine. Account access and quota depend on the agent.",
    machine: "Sign-in machine",
    choose: "Choose a connected machine",
    add: "Add agent",
    login: "Sign in",
    busy: "Working…",
    guide: "Setup guide",
    installed: "Install the official Antigravity CLI on this machine first.",
    package:
      "Requires Node.js and npx on the execution machine. The pinned official agent is downloaded on first use.",
    custom:
      "This agent has a custom launch configuration. Sign in using its own command and environment.",
    added:
      "Agent configured. Complete sign-in and verify a model request before relying on the subscription.",
    opened:
      "Sign-in terminal opened. Complete the agent's account selection and browser authorization. This does not confirm authentication or quota.",
    panel:
      "The terminal was created but this surface could not show it. Open the terminal from the machine's terminal list.",
    error: "Could not load subscription setup. Reopen the page to retry.",
  },
  ru: {
    title: "Вход по подпискам",
    open: "Открыть подключения по подписке",
    intro:
      "Antigravity, Kimi Code и Qwen Code находятся в общем выборе моделей рядом с Codex и Claude. Здесь можно войти в аккаунт на машине выполнения. Доступ и квота зависят от агента.",
    machine: "Машина для входа",
    choose: "Выбери подключённую машину",
    add: "Добавить агента",
    login: "Войти",
    busy: "Выполняется…",
    guide: "Инструкция подключения",
    installed: "Сначала установи официальный Antigravity CLI на этой машине.",
    package:
      "На машине выполнения нужны Node.js и npx. Официальный агент закреплённой версии загрузится при первом запуске.",
    custom:
      "У агента изменены команда или окружение запуска. Войди с его собственными настройками.",
    added:
      "Агент добавлен. Заверши вход и проверь настоящий запрос, прежде чем рассчитывать на подписку.",
    opened:
      "Терминал входа открыт. Выбери аккаунт в агенте и заверши авторизацию в браузере. Это ещё не подтверждает вход или квоту.",
    panel:
      "Терминал создан, но эта поверхность не смогла его показать. Открой его из списка терминалов машины.",
    error:
      "Не удалось загрузить настройку подписок. Открой страницу заново для повтора.",
  },
};

export function SubscriptionSettingsEntry() {
  const navigate = useBbNavigate();
  const t = copy[experimental_useInterfaceLanguage()];
  return (
    <section aria-label={t.title} className="flex flex-col items-start gap-3">
      <h3 className="text-sm font-medium">{t.title}</h3>
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate.toPluginPanel("subscriptions")}
      >
        {t.open}
      </Button>
    </section>
  );
}

export function SubscriptionConnections() {
  const rpc = useRpc<typeof subscriptionRpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const t = copy[experimental_useInterfaceLanguage()];
  const [profiles, setProfiles] = useState<Profiles>([]);
  const [machines, setMachines] = useState<{ id: string; name: string }[]>([]);
  const [hostId, setHostId] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"added" | "opened" | "panel" | null>(
    null,
  );
  const [terminalReceipt, setTerminalReceipt] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      rpc.call("listSubscriptionAgents", {}),
      sdk.hosts.list({ signal: controller.signal }),
    ])
      .then(([next, hosts]) => {
        if (controller.signal.aborted) return;
        setProfiles(next);
        setMachines(
          hosts
            .filter((host) => host.status === "connected")
            .map(({ id, name }) => ({ id, name })),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [rpc, sdk]);
  const run = async (id: Profiles[number]["id"], action: "add" | "login") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setFeedback(null);
    setTerminalReceipt(null);
    try {
      if (action === "add") {
        setProfiles(await rpc.call("configureSubscriptionAgent", { id }));
        setFeedback("added");
      } else {
        const { terminalId } = await rpc.call("startSubscriptionSignIn", {
          id,
          hostId,
        });
        setTerminalReceipt(terminalId);
        try {
          setFeedback(
            (await navigate.experimental_openTerminal({ terminalId }))
              ? "opened"
              : "panel",
          );
        } catch {
          setFeedback("panel");
        }
      }
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
    <section
      aria-label={t.title}
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4"
    >
      <h3 className="text-sm font-medium">{t.title}</h3>
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t.machine}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={hostId}
          disabled={busy}
          onChange={(event) => setHostId(event.target.value)}
        >
          <option value="">{t.choose}</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.name}
            </option>
          ))}
        </select>
      </label>
      {profiles.map((profile) => (
        <div
          key={profile.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
        >
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-medium">{profile.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.requiresInstallation ? t.installed : t.package}
            </p>
            {profile.configured && !profile.matchesProfile ? (
              <p className="mt-1 text-sm text-muted-foreground">{t.custom}</p>
            ) : null}
            <a
              className="text-sm underline"
              href={profile.documentationUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t.guide}
            </a>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              (profile.configured && (!profile.matchesProfile || hostId === ""))
            }
            aria-label={`${profile.configured ? t.login : t.add}: ${profile.name}`}
            onClick={() =>
              void run(profile.id, profile.configured ? "login" : "add")
            }
          >
            {busy ? t.busy : profile.configured ? t.login : t.add}
          </Button>
        </div>
      ))}
      {loadFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t[feedback]}
          {feedback === "panel" && terminalReceipt ? (
            <span className="block font-mono break-all">{terminalReceipt}</span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
