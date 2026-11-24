import type { ThreadQueuedMessage } from "@bb/domain";
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
}: {
  draft: PromptDraftController;
  threadId: string;
  environmentId: string;
  initial: QueuedMessageAssignmentSelection;
  disabled: boolean;
  queuedMessages: readonly ThreadQueuedMessage[];
}) {
  const { t } = useInterfaceTranslation();
  const create = useCreateThreadQueuedMessage();
  const { submitDraft, isSubmitting } = useDraftSubmission(draft.storageKey);
  return (
    <section
      aria-label={t("Queue requests with different models")}
      className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">
          {t("Queue requests with different models")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            "Write a request below, then choose its model and add it to the queue. Repeat for the next request.",
          )}
        </p>
      </div>
      <QueuedMessageAssignmentDialog
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
    </section>
  );
}
