import { ApiError } from "../../errors.js";
import type { ProviderSessionSource } from "@bb/domain";
import type { QueuedThreadMessageRow } from "@bb/db";

export function requireQueuedMessageProvider(
  providerId: string,
  rows: readonly { providerId: string | null }[],
): void {
  const assigned = rows.find(
    (row) => row.providerId !== null && row.providerId !== providerId,
  )?.providerId;
  if (assigned !== undefined && assigned !== null) {
    throw new ApiError(
      409,
      "queued_message_provider_changed",
      `This message is assigned to ${assigned}. Switch this chat back to ${assigned} before sending it.`,
    );
  }
}

export function requireQueuedMessageProviderSession(
  source: ProviderSessionSource,
  rows: readonly Pick<
    QueuedThreadMessageRow,
    "providerId" | "providerSessionId" | "payloadKind"
  >[],
): void {
  requireQueuedMessageProvider(source.providerId, rows);
  if (
    rows.some(
      (row) =>
        row.providerId !== null &&
        row.payloadKind === "retry" &&
        row.providerSessionId !== source.providerSessionId,
    )
  ) {
    throw new ApiError(
      409,
      "queued_retry_session_changed",
      "This retry belongs to an earlier agent session. Cancel it and send a new request to continue in this session.",
    );
  }
}
