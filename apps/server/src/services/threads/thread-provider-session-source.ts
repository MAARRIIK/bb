import { getThread, type DbQueryConnection } from "@bb/db";
import type { ProviderSessionSource } from "@bb/domain";
import { ApiError } from "../../errors.js";

export function requireThreadProviderSessionSource(
  db: DbQueryConnection,
  threadId: string,
): ProviderSessionSource {
  const thread = getThread(db, threadId);
  if (thread === null)
    throw new ApiError(404, "thread_not_found", "Thread not found");
  return {
    providerId: thread.providerId,
    providerSessionId: thread.providerSessionId,
  };
}
