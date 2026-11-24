import { useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bb/shared-ui/dialog";
import { providerServiceTierOptions } from "@bb/domain";
import type { InlineQueuedMessageEditState } from "@/components/thread/composer/useInlineQueuedMessageEditing";
import {
  useSystemExecutionOptions,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import { useInterfaceTranslation } from "@/lib/interface-language";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export type QueuedMessageAssignmentSelection = Pick<
  InlineQueuedMessageEditState,
  | "providerId"
  | "providerSwitchPolicy"
  | "model"
  | "permissionMode"
  | "reasoningLevel"
  | "serviceTier"
> & { providerId: string };

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function AssignmentForm({
  environmentId,
  initial,
  onSelect,
  disabled,
  submitLabel,
}: {
  environmentId: string;
  initial: QueuedMessageAssignmentSelection;
  onSelect: (selection: QueuedMessageAssignmentSelection) => void;
  disabled: boolean;
  submitLabel: string;
}) {
  const { t } = useInterfaceTranslation();
  const [providerId, setProviderId] = useState(initial.providerId);
  const [modelId, setModelId] = useState(initial.model);
  const [permission, setPermission] = useState<string>(initial.permissionMode);
  const [reasoning, setReasoning] = useState<string>(initial.reasoningLevel);
  const [tierId, setTierId] = useState(initial.serviceTier);
  const [switchAutomatically, setSwitchAutomatically] = useState(
    initial.providerSwitchPolicy === "recent-messages",
  );
  const providers = useSystemProviders({ environmentId });
  const catalog = useSystemExecutionOptions({
    environmentId,
    providerId,
    selectedModel: modelId || undefined,
  });
  const provider = catalog.data?.providers.find(
    (entry) => entry.id === providerId,
  );
  const models = [
    ...(catalog.data?.models ?? []),
    ...(catalog.data?.selectedOnlyModels ?? []),
  ];
  const model =
    models.find((entry) => entry.model === modelId) ??
    models.find((entry) => entry.isDefault) ??
    models[0];
  const permissionMode = provider?.capabilities.permissionModes.find(
    (mode) => mode === permission,
  );
  const reasoningLevel =
    model?.supportedReasoningEfforts.find(
      (effort) => effort.reasoningEffort === reasoning,
    )?.reasoningEffort ?? model?.defaultReasoningEffort;
  const tiers =
    model?.supportedServiceTiers ??
    (provider ? providerServiceTierOptions(provider) : []);
  const verified =
    catalog.data !== undefined &&
    catalog.data.modelLoadError === null &&
    !catalog.isFetching &&
    !catalog.isPlaceholderData &&
    !catalog.isError;
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <label className="text-sm">
        {t("Provider")}
        <select
          aria-label={t("Provider")}
          className={SELECT_CLASS}
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            setModelId("");
            setPermission("");
            setReasoning("");
            setTierId("default");
            setSwitchAutomatically(false);
          }}
        >
          {providers.data
            ?.filter((entry) => entry.available)
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
        </select>
      </label>
      <label className="text-sm">
        {t("Model")}
        <select
          aria-label={t("Model")}
          className={SELECT_CLASS}
          value={model?.model ?? ""}
          disabled={!verified}
          onChange={(event) => {
            setModelId(event.target.value);
            setReasoning("");
            setTierId("default");
          }}
        >
          {models.map((entry) => (
            <option key={entry.model} value={entry.model}>
              {entry.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        {t("Permissions")}
        <select
          aria-label={t("Permissions")}
          className={SELECT_CLASS}
          value={permissionMode ?? ""}
          onChange={(event) => setPermission(event.target.value)}
        >
          <option value="" disabled>
            {t("Choose permissions")}
          </option>
          {provider?.capabilities.permissionModes.map((mode) => (
            <option key={mode} value={mode}>
              {t(
                mode === "full"
                  ? "Full access"
                  : mode === "auto"
                    ? "Automatic approval"
                    : "Approve commands",
              )}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        {t("Reasoning")}
        <select
          aria-label={t("Reasoning")}
          className={SELECT_CLASS}
          value={reasoning}
          onChange={(event) => setReasoning(event.target.value)}
        >
          <option value="">{t("Model default")}</option>
          {model?.supportedReasoningEfforts.map((effort) => (
            <option key={effort.reasoningEffort} value={effort.reasoningEffort}>
              {effort.reasoningEffort}
            </option>
          ))}
        </select>
      </label>
      {provider?.capabilities.supportsServiceTier ? (
        <label className="text-sm">
          {t("Service tier")}
          <select
            aria-label={t("Service tier")}
            className={SELECT_CLASS}
            value={tierId}
            onChange={(event) => setTierId(event.target.value)}
          >
            <option value="default">{t("Default")}</option>
            {tiers
              .filter((tier) => tier.id !== "default")
              .map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.label}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {catalog.data?.modelLoadError || catalog.isError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {t("Could not verify the target model catalog.")}
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={switchAutomatically}
          onChange={(event) => setSwitchAutomatically(event.target.checked)}
        />
        <span>
          {t("Switch automatically when this task starts")}
          <span className="mt-1 block text-muted-foreground">
            {t(
              "When another provider is active, transfer recent visible messages with a context budget of up to 8192 tokens, also limited by the model catalog. Earlier messages may be omitted. The task waits for the current turn to finish.",
            )}
          </span>
        </span>
      </label>
      <Button
        type="button"
        disabled={
          !verified ||
          !model ||
          permissionMode === undefined ||
          reasoningLevel === undefined
        }
        onClick={() => {
          if (
            !model ||
            permissionMode === undefined ||
            reasoningLevel === undefined
          )
            return;
          onSelect({
            providerId,
            providerSwitchPolicy: switchAutomatically
              ? "recent-messages"
              : "manual",
            model: model.model,
            permissionMode,
            reasoningLevel,
            serviceTier: tierId,
          });
        }}
      >
        {submitLabel}
      </Button>
    </fieldset>
  );
}

export function QueuedMessageAssignment({
  edit,
  currentProviderId,
  environmentId,
  onSelect,
}: {
  edit: InlineQueuedMessageEditState;
  currentProviderId: string;
  environmentId: string;
  onSelect: (selection: QueuedMessageAssignmentSelection) => void;
}) {
  return (
    <QueuedMessageAssignmentDialog
      purpose="edit"
      sessionKey={edit.editSessionId}
      environmentId={environmentId}
      initial={{ ...edit, providerId: edit.providerId ?? currentProviderId }}
      onSelect={onSelect}
      disabled={false}
    />
  );
}

export function QueuedMessageAssignmentDialog({
  purpose,
  sessionKey,
  environmentId,
  initial,
  onSelect,
  disabled,
}: {
  purpose: "edit" | "create";
  sessionKey: string | number;
  environmentId: string;
  initial: QueuedMessageAssignmentSelection;
  onSelect: (
    selection: QueuedMessageAssignmentSelection,
  ) => void | Promise<void>;
  disabled: boolean;
}) {
  const { t } = useInterfaceTranslation();
  const [open, setOpen] = useState(false);
  const [formSessionId, setFormSessionId] = useState(0);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const select = async (selection: QueuedMessageAssignmentSelection) => {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onSelect(selection);
      setOpen(false);
    } catch (nextError) {
      setError(
        getMutationErrorMessage({
          error: nextError,
          fallbackMessage: t("Could not save this queued task."),
          lifecycleOperation:
            purpose === "create" ? "queue_message" : "update_queued_message",
        }),
      );
    }
    submitting.current = false;
    setPending(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting.current) return;
        if (next && !open) {
          setFormSessionId((session) => session + 1);
          setError(null);
        }
        setOpen(next);
      }}
      modal={false}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || pending}
        >
          {t(purpose === "create" ? "Queue with model" : "Assign task model")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Model for this queued task")}</DialogTitle>
          <DialogDescription>
            {t(
              purpose === "create"
                ? "Add the current draft and its attachments to the queue with this model. It may start immediately when the conversation is idle. Otherwise, it waits for the current turn."
                : "Save the editor to keep this assignment. Choose whether this task may switch providers when it starts. Otherwise, return to its provider manually.",
            )}
          </DialogDescription>
        </DialogHeader>
        <AssignmentForm
          key={`${sessionKey}:${formSessionId}`}
          environmentId={environmentId}
          initial={initial}
          disabled={disabled || pending}
          submitLabel={t(
            pending
              ? "Saving…"
              : purpose === "create"
                ? "Add to queue"
                : "Use for this task",
          )}
          onSelect={(selection) => void select(selection)}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
