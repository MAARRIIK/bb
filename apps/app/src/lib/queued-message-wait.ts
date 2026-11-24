import {
  RESTART_RESUME_RETRY_REASON,
  type QueuedMessagePayload,
  type QueuedMessageWaitingOn,
  type ThreadStatus,
  type ResolvedInterfaceLanguage,
} from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";
import { formatScheduledTime } from "@/lib/relative-time";
import {
  translateInterfaceText,
  type InterfaceTranslator,
} from "./interface-translations";

const SUPERSEDED_WAIT_LINE = "Not sent · a newer message was sent after it";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatQueuedMessageCountdown(
  remainingMs: number,
  language: ResolvedInterfaceLanguage,
): string | null {
  const t = (message: string, count: number) =>
    translateInterfaceText(message, language, { count });
  if (remainingMs <= 0) return null;
  if (remainingMs < MINUTE_MS) {
    return t("in {count}s", Math.ceil(remainingMs / 1000));
  }
  if (remainingMs < HOUR_MS) {
    return t("in {count}m", Math.floor(remainingMs / MINUTE_MS));
  }
  if (remainingMs < DAY_MS) {
    return t("in {count}h", Math.floor(remainingMs / HOUR_MS));
  }
  return t("in {count}d", Math.floor(remainingMs / DAY_MS));
}

export function isQueuedMessageSendNowAllowed({
  waitingOn,
  failureReason,
}: {
  waitingOn: QueuedMessageWaitingOn | null;
  failureReason: string | null;
}): boolean {
  if (waitingOn?.kind === "dependency") return false;
  if (failureReason !== null) return true;
  if (waitingOn === null) return true;
  switch (waitingOn.kind) {
    case "provisioning":
    case "host-offline":
    case "interaction":
    case "turn-starting":
    case "app-update":
      return false;
    case "stopping":
      return false;
    case "time":
    case "plugin":
    case "thread-busy":
    case "superseded":
      return true;
  }
}

export function queuedMessageHasWaitLine(args: {
  failureReason: string | null;
  payload: QueuedMessagePayload;
  waitingOn: QueuedMessageWaitingOn | null;
}): boolean {
  if (args.failureReason !== null) return true;
  if (args.payload.kind === "retry") return true;
  if (args.waitingOn === null) return false;
  return args.waitingOn.kind !== "thread-busy";
}

export function queuedMessageWaitIcon(args: {
  failureReason: string | null;
  payload: QueuedMessagePayload;
  waitingOn: QueuedMessageWaitingOn | null;
}): IconName | null {
  if (args.failureReason !== null) return "AlertCircle";
  if (args.waitingOn?.kind === "superseded") return "AlertCircle";
  if (args.payload.kind === "retry") return "RotateCcw";
  if (args.waitingOn === null) return null;
  switch (args.waitingOn.kind) {
    case "thread-busy":
      return null;
    case "stopping":
    case "turn-starting":
      return "TimeSchedule";
    case "time":
      return "TimeSchedule";
    case "provisioning":
      return "Folder";
    case "host-offline":
      return "CloudOff";
    case "interaction":
      return "CircleQuestion";
    case "dependency":
      return args.waitingOn.status === "failed" ||
        args.waitingOn.status === "cancelled"
        ? "AlertCircle"
        : "TimeSchedule";
    case "app-update":
      return "Download";
    case "plugin":
      return null;
  }
}

export interface DescribeQueuedMessageWaitArgs {
  language: ResolvedInterfaceLanguage;
  failureReason: string | null;
  now: number;
  payload: QueuedMessagePayload;
  pluginDisplayName: string | null;
  sendAt: number | null;
  threadStatus: ThreadStatus;
  waitingOn: QueuedMessageWaitingOn | null;
}

export function queuedMessageFallbackTitle(args: {
  language: ResolvedInterfaceLanguage;
  createdAt: number;
  now: number;
  payload: QueuedMessagePayload;
}): string {
  const t: InterfaceTranslator = (message, values) =>
    translateInterfaceText(message, args.language, values);
  if (args.payload.kind !== "retry") return t("Queued message");
  if (args.payload.reason === RESTART_RESUME_RETRY_REASON) {
    return t(`Resume after ${RESTART_RESUME_RETRY_REASON}`);
  }
  return t("Retry failed turn from {time}", {
    time: formatScheduledTime({
      now: args.now,
      timestamp: args.createdAt,
      language: args.language,
    }),
  });
}

export function describeQueuedMessageWait(
  args: DescribeQueuedMessageWaitArgs,
): string | null {
  const t: InterfaceTranslator = (message, values) =>
    translateInterfaceText(message, args.language, values);
  if (args.waitingOn?.kind === "dependency")
    return t("Waiting for task {id} to succeed ({status})", {
      id: args.waitingOn.queuedMessageId,
      status: t(args.waitingOn.status),
    });
  if (args.failureReason !== null) return args.failureReason;
  if (args.waitingOn?.kind === "superseded") return t(SUPERSEDED_WAIT_LINE);

  if (args.payload.kind === "retry") {
    const resume = args.payload.reason === RESTART_RESUME_RETRY_REASON;
    const parts: string[] = resume ? [] : [args.payload.reason];
    if (args.waitingOn?.kind === "plugin") {
      parts.push(
        t("held by {plugin} · {reason}", {
          plugin: args.pluginDisplayName ?? args.waitingOn.pluginId,
          reason: args.waitingOn.reason,
        }),
      );
    }
    if (args.sendAt !== null) {
      parts.push(
        t(resume ? "resuming at {time}" : "retrying at {time}", {
          time: formatScheduledTime({
            now: args.now,
            timestamp: args.sendAt,
            language: args.language,
          }),
        }),
      );
    }
    parts.push(t("attempt {number}", { number: args.payload.attempt }));
    return parts.join(" · ");
  }

  if (!queuedMessageHasWaitLine(args)) return null;
  if (args.waitingOn === null) return null;
  switch (args.waitingOn.kind) {
    case "thread-busy":
      return null;
    case "turn-starting":
      return args.threadStatus === "error"
        ? t("Turn didn't start · sends on the next turn")
        : t("Waiting for turn to start");
    case "stopping":
      return t("Sending when the thread stops");
    case "time":
      return args.sendAt === null
        ? t("Scheduled")
        : t("Scheduled for {time}", {
            time: formatScheduledTime({
              now: args.now,
              timestamp: args.sendAt,
              language: args.language,
            }),
          });
    case "provisioning":
      return t("Waiting for workspace");
    case "host-offline":
      return t("Waiting for {host} to be ready", {
        host: args.waitingOn.hostName,
      });
    case "interaction":
      return t("Waiting for your reply");
    case "app-update":
      return t("Sending after bb restarts to update");
    case "plugin":
      return t("Held by {plugin} · {reason}", {
        plugin: args.pluginDisplayName ?? args.waitingOn.pluginId,
        reason: args.waitingOn.reason,
      });
  }
}

export function queuedMessageCountdownInstant(args: {
  payload: QueuedMessagePayload;
  sendAt: number | null;
  waitingOn: QueuedMessageWaitingOn | null;
}): number | null {
  if (args.payload.kind === "retry") return null;
  if (args.waitingOn === null || args.waitingOn.kind !== "time") return null;
  return args.sendAt;
}
