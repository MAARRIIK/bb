import type { ThreadQueuedMessage } from "@bb/domain";
import { useMemo, useState, type ReactNode } from "react";
import type { InternalComposerInputSlots } from "@get-bb/plugin-sdk/internal/composer-handle";
import { promptDraftToInput } from "@bb/client-core";
import { useCreateThreadQueuedMessage } from "@/hooks/mutations/thread-runtime-mutations";
import {
  sendPromptDraft,
  type PromptDraftController,
} from "@/hooks/usePromptDraftStorage";
import { useInterfaceTranslation } from "@/lib/interface-language";
import {
  QueuedMessageAssignmentDialog,
  type QueuedMessageAssignmentSelection,
} from "./QueuedMessageAssignment";
import { useDraftSubmission } from "./useDraftSubmission";

export function QueueDraftWithModel({
  draft,
  threadId,
  environmentId,
  initial,
  disabled,
  queuedMessages,
  available,
  hasInput,
  children,
}: {
  draft: PromptDraftController;
  threadId: string;
  environmentId: string | null;
  initial: QueuedMessageAssignmentSelection;
  disabled: boolean;
  queuedMessages: readonly ThreadQueuedMessage[];
  available: boolean;
  hasInput: boolean;
  children(
    action: InternalComposerInputSlots["internal_DO_NOT_USE_queueWithModelAction"],
  ): ReactNode;
}) {
  const { t } = useInterfaceTranslation();
  const create = useCreateThreadQueuedMessage();
  const { submitDraft, isSubmitting } = useDraftSubmission(draft.storageKey);
  const [open, setOpen] = useState(false);
  const canAssign = available && environmentId !== null;
  const action = useMemo(
    () =>
      canAssign
        ? {
            label: t("Queue with model"),
            description: t(
              hasInput
                ? "Choose a model for this queued request."
                : "Type a message before adding it to the queue.",
            ),
            disabled: disabled || isSubmitting,
            run: () => setOpen(true),
          }
        : undefined,
    [canAssign, disabled, hasInput, isSubmitting, t],
  );
  return (
    <>
      {children(action)}
      {canAssign ? (
        <QueuedMessageAssignmentDialog
          control={{ open, onOpenChange: setOpen }}
          showTrigger={false}
          dependencyOptions={queuedMessages}
          purpose="create"
          sessionKey={draft.storageKey}
          environmentId={environmentId}
          initial={initial}
          disabled={disabled || isSubmitting}
          onSelect={(selection) =>
            submitDraft(async () => {
              const submittedDraft = draft.getCurrent();
              const input = promptDraftToInput(submittedDraft);
              if (input.length === 0)
                throw new Error(
                  t("Type a message before adding it to the queue."),
                );
              await sendPromptDraft(draft, submittedDraft, () =>
                create.mutateAsync({ id: threadId, input, ...selection }),
              );
            })
          }
        />
      ) : null}
    </>
  );
}
