import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bb/shared-ui/dialog";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import {
  providerSwitchOperationRequestSchema,
  type ProviderSwitchPreview,
  type ProviderSwitchPreviewRequest,
  type ProviderSwitchReceipt,
} from "@bb/server-contract";
import { useThread } from "@/hooks/queries/thread-queries";
import {
  useSystemExecutionOptions,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import {
  threadDefaultExecutionOptionsQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import { useInterfaceTranslation } from "@/lib/interface-language";
import { BbHttpError, sdk } from "@/lib/sdk";
import type { ModelReasoningPickerSelection } from "@/components/pickers/ModelReasoningPicker";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function operationKey(threadId: string) {
  return `bb.provider-switch.${threadId}`;
}

function readOperationId(threadId: string): string | null {
  try {
    const stored = window.localStorage.getItem(operationKey(threadId));
    const parsed = providerSwitchOperationRequestSchema.safeParse({
      operationId: stored,
    });
    return parsed.success ? parsed.data.operationId : null;
  } catch {
    return null;
  }
}

function storeOperationId(threadId: string, operationId: string | null) {
  try {
    if (operationId === null)
      window.localStorage.removeItem(operationKey(threadId));
    else window.localStorage.setItem(operationKey(threadId), operationId);
  } catch {
    return;
  }
}

function finished(receipt: ProviderSwitchReceipt | undefined): boolean {
  return receipt?.phase === "completed" || receipt?.phase === "rolled_back";
}

function ProviderSwitchForm({
  threadId,
  environmentId,
  onComplete,
  selection,
}: {
  threadId: string;
  environmentId: string;
  onComplete: () => void;
  selection: ModelReasoningPickerSelection | null;
}) {
  const { t } = useInterfaceTranslation();
  const queryClient = useQueryClient();
  const thread = useThread(threadId);
  const [providerChoice, setProviderChoice] = useState<string | null>(
    selection?.providerId ?? null,
  );
  const [modelChoice, setModelChoice] = useState(selection?.model ?? "");
  const [permission, setPermission] = useState<PermissionMode | "">(
    selection === null ? "accept-edits" : "",
  );
  const [reasoning, setReasoning] = useState<ReasoningLevel | null>(
    selection?.reasoningLevel ?? null,
  );
  const [tier, setTier] = useState<ServiceTier>("default");
  const [summaryMode, setSummaryMode] = useState(false);
  const [summary, setSummary] = useState("");
  const [budget, setBudget] = useState("8192");
  const [windowSize, setWindowSize] = useState("");
  const [preview, setPreview] = useState<ProviderSwitchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationStateKey = ["provider-switch-operation", threadId];
  const { data: operationId } = useQuery({
    queryKey: operationStateKey,
    queryFn: () => readOperationId(threadId),
    initialData: () => readOperationId(threadId),
    enabled: false,
  });
  const providers = useSystemProviders({ environmentId });
  const providerId = providerChoice ?? thread.data?.providerId ?? "";
  const catalog = useSystemExecutionOptions({
    environmentId,
    providerId,
    enabled: providerId.length > 0,
  });
  const models = [
    ...(catalog.data?.models ?? []),
    ...(catalog.data?.selectedOnlyModels ?? []),
  ];
  const model =
    models.find((entry) => entry.model === modelChoice) ??
    models.find((entry) => entry.isDefault) ??
    models[0];
  const provider = catalog.data?.providers.find(
    (entry) => entry.id === providerId,
  );
  const permissions = provider?.capabilities.permissionModes ?? [];
  const operation = useQuery({
    queryKey: ["provider-switch", threadId, operationId],
    queryFn: ({ signal }) =>
      sdk.threads.experimental_providerSwitch.get({
        threadId,
        operationId: operationId!,
        signal,
      }),
    enabled: operationId !== null,
    retry: false,
    refetchInterval: (query) => (finished(query.state.data) ? false : 1000),
  });
  const waiting = operationId !== null && !finished(operation.data);
  const refreshThread = () => {
    void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
    void queryClient.invalidateQueries({
      queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
    });
  };
  const remember = (id: string | null) => {
    storeOperationId(threadId, id);
    queryClient.setQueryData(operationStateKey, id);
  };
  const makePreview = async () => {
    if (!model || permission === "") return;
    setBusy(true);
    setError(null);
    setPreview(null);
    remember(null);
    const request: ProviderSwitchPreviewRequest = {
      providerId,
      model: model.model,
      permissionMode: permission,
      reasoningLevel: reasoning,
      serviceTier: tier,
      context: summaryMode
        ? { mode: "summary", text: summary }
        : { mode: "recent-messages" },
      contextTokenBudget: Number(budget),
      contextWindowTokens:
        windowSize.trim().length === 0 ? null : Number(windowSize),
    };
    try {
      setPreview(
        await sdk.threads.experimental_providerSwitch.preview({
          threadId,
          ...request,
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t("Could not prepare the context preview."),
      );
    }
    setBusy(false);
  };
  const commit = async () => {
    if (!preview) return;
    const id = crypto.randomUUID();
    remember(id);
    setBusy(true);
    setError(null);
    try {
      const result = await sdk.threads.experimental_providerSwitch.commit({
        threadId,
        operationId: id,
        preview,
      });
      queryClient.setQueryData(["provider-switch", threadId, id], result);
      refreshThread();
      if (result.phase === "completed") onComplete();
      else if (result.phase === "rolled_back")
        setError(t("The switch failed. The previous provider was retained."));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t(
              "The connection was interrupted. Check the saved operation below.",
            ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["provider-switch", threadId, id],
      });
    }
    setBusy(false);
  };
  const recover = async () => {
    if (operationId === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sdk.threads.experimental_providerSwitch.recover({
        threadId,
        operationId,
      });
      queryClient.setQueryData(
        ["provider-switch", threadId, operationId],
        result,
      );
      refreshThread();
      if (result.phase === "completed") onComplete();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t("Recovery is waiting for the executor."),
      );
    }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      {operationId !== null ? (
        <div className="space-y-2 rounded-md border p-3 text-sm" role="status">
          <p>
            {operation.data?.phase === "completed"
              ? t("The model was switched.")
              : operation.data?.phase === "rolled_back"
                ? t("The previous provider was retained.")
                : t("Waiting for the switch result")}
          </p>
          <details>
            <summary>{t("Operation details")}</summary>
            <p className="break-all text-muted-foreground">{operationId}</p>
          </details>
          {!finished(operation.data) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void recover()}
            >
              {t("Check and recover")}
            </Button>
          ) : null}
          {operation.error instanceof BbHttpError &&
          operation.error.status === 404 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                remember(null);
                setPreview(null);
                setError(null);
              }}
            >
              {t("Review a new switch")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {preview === null ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              {t("Provider")}
              <select
                aria-label={t("Provider")}
                className={SELECT_CLASS}
                value={providerId}
                disabled={busy || waiting}
                onChange={(event) => {
                  setProviderChoice(event.target.value);
                  setModelChoice("");
                  setPermission("");
                  setReasoning(null);
                  setTier("default");
                }}
              >
                {(providers.data ?? [])
                  .filter((entry) => entry.available)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              {t("Model")}
              <select
                aria-label={t("Model")}
                className={SELECT_CLASS}
                value={model?.model ?? ""}
                disabled={
                  busy ||
                  waiting ||
                  catalog.isFetching ||
                  catalog.isPlaceholderData
                }
                onChange={(event) => {
                  setModelChoice(event.target.value);
                  setReasoning(null);
                  setTier("default");
                }}
              >
                {models.map((entry) => (
                  <option key={entry.id} value={entry.model}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              {t("Permissions")}
              <select
                aria-label={t("Permissions")}
                className={SELECT_CLASS}
                value={
                  permissions.includes(permission || "accept-edits")
                    ? permission
                    : ""
                }
                disabled={busy || waiting}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    value === "full" ||
                    value === "auto" ||
                    value === "accept-edits"
                  )
                    setPermission(value);
                }}
              >
                <option value="" disabled>
                  {t("Choose permissions")}
                </option>
                {permissions.map((value) => (
                  <option key={value} value={value}>
                    {t(
                      value === "full"
                        ? "Full access"
                        : value === "auto"
                          ? "Automatic approval"
                          : "Approve commands",
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              {t("Reasoning")}
              <select
                aria-label={t("Reasoning")}
                className={SELECT_CLASS}
                value={reasoning ?? ""}
                disabled={busy || waiting}
                onChange={(event) => {
                  const level = model?.supportedReasoningEfforts.find(
                    (effort) => effort.reasoningEffort === event.target.value,
                  )?.reasoningEffort;
                  setReasoning(level ?? null);
                }}
              >
                <option value="">{t("Model default")}</option>
                {model?.supportedReasoningEfforts.map((effort) => (
                  <option
                    key={effort.reasoningEffort}
                    value={effort.reasoningEffort}
                  >
                    {effort.label ?? effort.reasoningEffort}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={summaryMode}
              disabled={busy || waiting}
              onChange={(event) => setSummaryMode(event.target.checked)}
            />
            {t("Use my summary instead of recent messages")}
          </label>
          {summaryMode ? (
            <textarea
              aria-label={t("Conversation summary")}
              className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm"
              value={summary}
              maxLength={32_000}
              disabled={busy || waiting}
              onChange={(event) => setSummary(event.target.value)}
            />
          ) : null}
          <details className="space-y-2 text-sm">
            <summary>{t("Context budget")}</summary>
            <label className="block space-y-1">
              {t("Conservative transfer budget")}
              <input
                type="number"
                min={512}
                max={32768}
                value={budget}
                disabled={busy || waiting}
                className={SELECT_CLASS}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              {t("User-declared context window (optional)")}
              <input
                type="number"
                min={2048}
                value={windowSize}
                disabled={busy || waiting}
                className={SELECT_CLASS}
                onChange={(event) => setWindowSize(event.target.value)}
              />
            </label>
          </details>
          <Button
            disabled={
              busy ||
              waiting ||
              !model ||
              !permissions.includes(permission || "accept-edits") ||
              permission === "" ||
              catalog.isFetching ||
              catalog.isPlaceholderData ||
              catalog.data?.modelLoadError !== null
            }
            onClick={() => void makePreview()}
          >
            {busy ? t("Preparing preview…") : t("Preview context")}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">
            {preview.request.providerId} · {preview.execution.model} ·{" "}
            {t(
              preview.execution.permissionMode === "full"
                ? "Full access"
                : preview.execution.permissionMode === "auto"
                  ? "Automatic approval"
                  : "Approve commands",
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              "Only the text below will be transferred. Reasoning, tool results and attachment contents are excluded.",
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              "Recognized credentials are redacted. Review this partial context before sharing it.",
            )}
          </p>
          <p className="text-sm">
            {t("Conservative estimate: {tokens}; messages: {messages}.", {
              tokens: preview.context.estimatedTokens,
              messages: preview.context.includedMessages,
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {preview.context.windowTokens === null
              ? t("The target context window is unknown.")
              : t("Declared window: {tokens} ({source}).", {
                  tokens: preview.context.windowTokens,
                  source: t(preview.context.windowSource),
                })}{" "}
            {t(
              "The actual serving window is unverified; room is reserved for instructions, tools and the answer.",
            )}
          </p>
          <textarea
            readOnly
            aria-label={t("Context to transfer")}
            value={preview.context.text}
            className="min-h-48 max-h-80 w-full rounded-md border bg-background p-3 font-mono text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || waiting} onClick={() => void commit()}>
              {busy ? t("Switching…") : t("Switch in this conversation")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || waiting}
              onClick={() => setPreview(null)}
            >
              {t("Change selection")}
            </Button>
          </div>
        </>
      )}
      {error !== null ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {catalog.isError || catalog.data?.modelLoadError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(
            "The model catalog could not be loaded. Check the provider connection.",
          )}
        </p>
      ) : null}
    </div>
  );
}

export function ThreadProviderSwitch({
  threadId,
  environmentId,
  disabled,
  className,
}: {
  threadId: string;
  environmentId: string;
  disabled: boolean;
  className?: string;
}) {
  const { t } = useInterfaceTranslation();
  const [open, setOpen] = useState(false);
  return (
    <ThreadProviderSwitchDialog
      threadId={threadId}
      environmentId={environmentId}
      open={open}
      onOpenChange={setOpen}
      selection={null}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          disabled={disabled}
          aria-label={t("Switch model in this conversation")}
        >
          <Icon name="ArrowLeftRight" aria-hidden="true" />
        </Button>
      </DialogTrigger>
    </ThreadProviderSwitchDialog>
  );
}

export function ThreadProviderSwitchDialog({
  threadId,
  environmentId,
  open,
  onOpenChange,
  selection,
  children,
}: {
  threadId: string;
  environmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: ModelReasoningPickerSelection | null;
  children?: ReactNode;
}) {
  const { t } = useInterfaceTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      {children}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Switch model in this conversation")}</DialogTitle>
          <DialogDescription>
            {t(
              "Keep this chat and workspace. Review the context before a fresh agent session is prepared.",
            )}
          </DialogDescription>
        </DialogHeader>
        <ProviderSwitchForm
          key={JSON.stringify([threadId, selection])}
          threadId={threadId}
          environmentId={environmentId}
          selection={selection}
          onComplete={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
