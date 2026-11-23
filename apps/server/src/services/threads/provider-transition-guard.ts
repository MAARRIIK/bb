import { getActiveProviderTransition, type DbQueryConnection } from "@bb/db";
import { ThreadContextChangeInProgressError } from "./thread-session-guard.js";

export function requireProviderTransitionSettled(
  db: DbQueryConnection,
  threadId: string,
): void {
  const transition = getActiveProviderTransition(db, threadId);
  if (!transition) return;
  const error = new ThreadContextChangeInProgressError();
  error.body.details = { transitionId: transition.id, phase: transition.phase };
  throw error;
}
