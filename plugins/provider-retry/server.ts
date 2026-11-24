import {
  readRetryDiagnostic,
  retryDiagnosticContract,
} from "./src/diagnostics.js";
import {
  retryAvailabilityMethod,
  retryAvailabilitySchema,
  type RetryAvailability,
} from "./src/retry-contract.js";
import type { BbPluginApi, PluginTurnFailedEvent } from "@get-bb/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import {
  DEFAULT_MAXIMUM_WAIT_MS,
  blockedWindowResetAtMs,
  RESET_BUFFER_MS,
  decideRetry,
  isRateLimitFailure,
  type RetryDecision,
} from "./src/retry-policy.js";

const MAXIMUM_WAIT_OPTIONS = ["6 hours", "24 hours", "No limit"] as const;

function maximumWaitMs(value: string): number | null {
  switch (value) {
    case "6 hours":
      return DEFAULT_MAXIMUM_WAIT_MS;
    case "24 hours":
      return 24 * 60 * 60 * 1_000;
    case "No limit":
      return null;
    default:
      throw new Error(
        `Unsupported maximum provider retry wait: ${String(value)}`,
      );
  }
}

export default async function plugin(bb: BbPluginApi) {
  const recheckQueuedLimits = () => {
    void bb.experimental_hooks
      .recheck("message.dispatch")
      .catch((error: unknown) => {
        bb.log.warn(`Queued limit recheck failed: ${String(error)}`);
      });
  };
  const availabilityCache = new Map<
    string,
    {
      requestId: string;
      checkedAt: number;
      value: RetryAvailability | null;
      pending: Promise<RetryAvailability> | null;
    }
  >();
  const settings = bb.settings.define({
    holdQueuedAtLimits: {
      type: "boolean",
      label: "Pause messages after confirmed subscription limits",
      description:
        "Wait before starting more work on the same model after a confirmed limit. Send now overrides this policy.",
      default: true,
    },
    maximumWait: {
      type: "select",
      label: "Maximum automatic wait",
      description:
        "Do not schedule a subscription-limit retry when its reset is farther away than this.",
      options: [...MAXIMUM_WAIT_OPTIONS],
      default: "6 hours",
    },
  });
  const initialSettings = await settings.get();
  let maximumWait = maximumWaitMs(initialSettings.maximumWait);
  let holdQueuedAtLimits = initialSettings.holdQueuedAtLimits;
  settings.onChange((next) => {
    maximumWait = maximumWaitMs(next.maximumWait);
    holdQueuedAtLimits = next.holdQueuedAtLimits;
    recheckQueuedLimits();
  });

  bb.rpc.register(
    retryDiagnosticContract,
    {
      "decision.get": ({ threadId }) => readRetryDiagnostic(bb, threadId),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "The last automatic retry decision for a thread, recorded after a scheduled retry is queued. A plugin that re-runs failed work waits for the decision on its failed request before re-running it.",
    },
  );
  const collectAvailability = (
    event: PluginTurnFailedEvent,
  ): Promise<RetryAvailability> => {
    let record = availabilityCache.get(event.threadId);
    if (record?.requestId !== event.requestId) {
      record = {
        requestId: event.requestId,
        checkedAt: 0,
        value: null,
        pending: null,
      };
      availabilityCache.set(event.threadId, record);
    }
    if (record.pending !== null) return record.pending;
    if (record.value !== null && Date.now() - record.checkedAt < 60_000)
      return Promise.resolve(record.value);
    const target = record;
    const promise = Promise.resolve()
      .then(async (): Promise<RetryAvailability> => {
        let availability: RetryAvailability = { kind: "not-routed" };
        if (isRateLimitFailure(event)) {
          const sources = await bb.sdk.plugins.experimental_discoverRpc({
            method: retryAvailabilityMethod,
          });
          for (const source of sources) {
            try {
              const result = await bb.sdk.plugins.callRpc({
                pluginId: source.pluginId,
                method: retryAvailabilityMethod,
                input: { threadId: event.threadId, requestId: event.requestId },
                outputSchema: retryAvailabilitySchema,
                signal: AbortSignal.timeout(5_000),
              });
              if (result.kind !== "not-routed") {
                availability = result;
                break;
              }
            } catch (error) {
              bb.log.warn(
                `Retry availability failed for ${event.threadId}: ${String(error)}`,
              );
              availability = {
                kind: "unavailable",
                reason: "source-unavailable",
              };
            }
          }
        }
        return availability;
      })
      .catch((): RetryAvailability => ({
        kind: "unavailable",
        reason: "source-unavailable",
      }))
      .then((value) => {
        if (availabilityCache.get(event.threadId) === target) {
          target.value = value;
          target.checkedAt = Date.now();
          recheckQueuedLimits();
        }
        return value;
      })
      .finally(() => {
        target.pending = null;
      });
    target.pending = promise;
    return promise;
  };

  bb.experimental_hooks.on("message.dispatch", (context) => {
    const failure = context.experimental_lastFailure;
    if (
      !holdQueuedAtLimits ||
      context.attempt !== "start-turn" ||
      !failure ||
      context.requestedExecution.providerId !== failure.providerId ||
      context.requestedExecution.model !== failure.model ||
      !isRateLimitFailure(failure)
    )
      return { action: "proceed" };
    const now = Date.now();
    const cached = availabilityCache.get(failure.threadId);
    if (
      cached?.requestId !== failure.requestId ||
      cached.value === null ||
      now - cached.checkedAt >= 60_000
    ) {
      void collectAvailability(failure);
      return {
        action: "wait",
        reason: "Checking availability after the provider reported a limit",
        recheckAt: now + 5_000,
      };
    }
    const availability = cached.value;
    if (availability.kind === "ready") return { action: "proceed" };
    if (availability.kind === "unavailable")
      return {
        action: "wait",
        reason:
          "The routed account's quota availability is unknown. Send now or change the queued model to continue.",
        recheckAt: now + 60_000,
      };
    let resetAt: number | null;
    if (availability.kind === "blocked") resetAt = availability.retryAt;
    else {
      const limits = failure.rateLimits;
      if (
        limits === null ||
        limits.status !== "blocked" ||
        limits.kind !== "subscription-window" ||
        limits.overageStatus === "allowed"
      )
        return { action: "proceed" };
      resetAt = blockedWindowResetAtMs(limits);
    }
    if (resetAt === null)
      return {
        action: "wait",
        reason:
          "The provider confirmed a subscription limit without a reset time. Send now or change the queued model to continue.",
        recheckAt: now + 60_000,
      };
    const recheckAt = resetAt + RESET_BUFFER_MS;
    if (recheckAt <= now) return { action: "proceed" };
    return {
      action: "wait",
      reason:
        "Waiting for the provider's confirmed subscription limit to reset",
      recheckAt: Math.min(recheckAt, now + 60_000),
    };
  });
  bb.events.on("thread.idle", ({ thread }) => {
    availabilityCache.delete(thread.id);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    availabilityCache.delete(thread.id);
  });
  bb.events.on("thread.archived", ({ thread }) => {
    availabilityCache.delete(thread.id);
  });

  bb.events.on("turn.failed", async (event) => {
    const availability = await collectAvailability(event);
    const decision = decideRetry({
      availability,
      failure: event,
      maximumWaitMs: maximumWait,
      now: Date.now(),
      random: Math.random(),
    });
    const recordDecision = () =>
      bb.storage.kv.set(`decision:${event.threadId}`, {
        requestId: event.requestId,
        observedAt: Date.now(),
        availability,
        decision,
      });
    if (decision.kind === "decline") {
      await recordDecision();
      bb.log.info(
        `Automatic retry skipped for ${event.threadId}: ${decision.reason}${availability.kind === "unavailable" ? ` (${availability.reason})` : ""}.`,
      );
      return;
    }
    await bb.sdk.threads.retry({
      threadId: event.threadId,
      turnRequestId: event.requestId,
      sendAt: decision.sendAt,
      reason: decision.reason,
    });
    await recordDecision();
  });

  registerProviderRetryCli(bb);
}
