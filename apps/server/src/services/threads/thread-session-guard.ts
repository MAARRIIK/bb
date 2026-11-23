import { ApiError } from "../../errors.js";

const inFlightByThreadId = new Map<string, number>();
const activityByThreadId = new Map<string, number>();
const committingThreadIds = new Set<string>();

export function isThreadSessionCommitInProgress(threadId: string): boolean {
  return committingThreadIds.has(threadId);
}

export class ThreadContextChangeInProgressError extends ApiError {
  constructor() {
    super(409, "invalid_request", "Thread session is being changed", true);
  }
}

async function withThreadSessionAdmissionGuard<T>(
  threadId: string,
  mode: "change" | "send",
  work: () => Promise<T>,
): Promise<T> {
  const inFlight = inFlightByThreadId.get(threadId) ?? 0;
  if (inFlight !== 0 && (mode === "change" || inFlight < 0)) {
    if (mode === "send") throw new ThreadContextChangeInProgressError();
    throw new ApiError(
      409,
      "invalid_request",
      "Thread is processing another request",
    );
  }
  inFlightByThreadId.set(threadId, mode === "change" ? -1 : inFlight + 1);
  try {
    return await work();
  } finally {
    const remaining =
      mode === "change" ? 0 : (inFlightByThreadId.get(threadId) ?? 1) - 1;
    if (remaining === 0) inFlightByThreadId.delete(threadId);
    else inFlightByThreadId.set(threadId, remaining);
  }
}

export async function withThreadSendGuard<T>(
  threadId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withThreadSessionAdmissionGuard(threadId, "send", work);
}

export async function withThreadContextChangeGuard<T>(
  threadId: string,
  work: (commit: <R>(work: () => Promise<R>) => Promise<R>) => Promise<T>,
): Promise<T> {
  return withThreadSessionAdmissionGuard(threadId, "change", () =>
    work(async (commit) => {
      if (
        committingThreadIds.has(threadId) ||
        (activityByThreadId.get(threadId) ?? 0) !== 0
      ) {
        throw new ApiError(
          409,
          "invalid_request",
          "Thread is still processing provider activity",
          true,
        );
      }
      committingThreadIds.add(threadId);
      try {
        return await commit();
      } finally {
        committingThreadIds.delete(threadId);
      }
    }),
  );
}

export function acquireThreadSessionActivity(
  threadIds: Iterable<string>,
): () => void {
  const ids = [...new Set(threadIds)];
  if (ids.some((id) => committingThreadIds.has(id))) {
    throw new ThreadContextChangeInProgressError();
  }
  for (const id of ids) {
    activityByThreadId.set(id, (activityByThreadId.get(id) ?? 0) + 1);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of ids) {
      const remaining = (activityByThreadId.get(id) ?? 1) - 1;
      if (remaining === 0) activityByThreadId.delete(id);
      else activityByThreadId.set(id, remaining);
    }
  };
}
