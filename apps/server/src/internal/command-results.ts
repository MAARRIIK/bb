import type {
  HostDaemonCommand,
  HostDaemonSettledCommandType,
} from "@bb/host-daemon-contract";
import {
  emptyCommandResultSideEffects,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
} from "./command-result-side-effects.js";
import {
  settleEnvironmentProvisionCancelCommandResult,
  settleEnvironmentProvisionCommandResult,
} from "../services/environments/environment-engine.js";
import {
  settleThreadPlanCancelCommandResult,
  settleThreadStartCommandResult,
  settleThreadStorageDeleteCommandResult,
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../services/threads/thread-lifecycle.js";
import { notifyWorkspaceMutationResult } from "./environment-changes.js";
import { getThread, type DbQueryConnection } from "@bb/db";
import type { ProviderSessionSource } from "@bb/domain";
import { isCurrentProviderSession } from "./provider-session.js";
import {
  acquireThreadSessionActivity,
  isThreadSessionCommitInProgress,
} from "../services/threads/thread-session-guard.js";

function commandProviderSession(
  command: HostDaemonCommand,
): { threadId: string; source: ProviderSessionSource | null } | null {
  switch (command.type) {
    case "thread.start":
      return { threadId: command.threadId, source: command };
    case "turn.submit":
    case "thread.goal.clear":
      return { threadId: command.threadId, source: command.resumeContext };
    case "thread.stop":
    case "thread.plan.cancel":
    case "thread.rename":
    case "thread.archive":
    case "thread.unarchive":
      return { threadId: command.threadId, source: command.source };
    default:
      return null;
  }
}

function canApplySessionResult(
  db: DbQueryConnection,
  target: { threadId: string; source: ProviderSessionSource | null },
): boolean {
  const thread = getThread(db, target.threadId);
  return (
    thread !== null &&
    !isThreadSessionCommitInProgress(target.threadId) &&
    isCurrentProviderSession(thread, target.source)
  );
}

type ParsedCommandType = HostDaemonSettledCommandType;
type ParsedCommandForType<TType extends ParsedCommandType> = Extract<
  HostDaemonCommand,
  { type: TType }
>;

interface ApplyCommandResultSideEffectsArgs<TType extends ParsedCommandType> {
  command: ParsedCommandForType<TType>;
  deps: CommandResultSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: CommandResultReportForType<TType>;
}

type CommandResultSideEffectHandlers = {
  [TType in ParsedCommandType]?: (
    args: ApplyCommandResultSideEffectsArgs<TType>,
  ) => CommandResultSideEffectsResult | void;
};

const commandResultSideEffectHandlers: CommandResultSideEffectHandlers = {
  "environment.attach": settleEnvironmentProvisionCommandResult,
  "environment.attach.cancel": settleEnvironmentProvisionCancelCommandResult,
  "interactive.resolve": ({ deps, command, report }) => {
    deps.pendingInteractions.settleInteractiveResolveCommandResultInTransaction(
      {
        command,
        deps,
        report,
      },
    );
  },
  "thread.start": settleThreadStartCommandResult,
  "thread.stop": settleThreadStopCommandResult,
  "thread.storage.delete": settleThreadStorageDeleteCommandResult,
  "thread.plan.cancel": settleThreadPlanCancelCommandResult,
  "turn.submit": settleTurnSubmitCommandResult,
  "workspace.commit": ({ deps, command, report }) => {
    notifyWorkspaceMutationResult(deps, {
      environmentId: command.environmentId,
      ok: report.ok,
    });
  },
} satisfies CommandResultSideEffectHandlers;

export function handleLiveCommandResultSideEffects<
  TType extends ParsedCommandType,
>(
  deps: CommandResultSettlementDeps,
  args: {
    command: ParsedCommandForType<TType>;
    execution: HostDaemonCommandExecutionRecord;
    report: CommandResultReportForType<TType>;
  },
): CommandResultSideEffectsResult {
  const handler = commandResultSideEffectHandlers[args.command.type];
  if (!handler) {
    return emptyCommandResultSideEffects();
  }
  const target = commandProviderSession(args.command);
  if (target !== null && !canApplySessionResult(deps.db, target))
    return emptyCommandResultSideEffects();
  const effects =
    handler({
      deps,
      report: args.report,
      command: args.command,
      execution: args.execution,
    }) ?? emptyCommandResultSideEffects();
  if (target === null) return effects;
  return {
    postCommitActions: effects.postCommitActions.map((action) => ({
      async run(postCommitDeps) {
        if (!canApplySessionResult(postCommitDeps.db, target)) return;
        const release = acquireThreadSessionActivity([target.threadId]);
        try {
          await action.run(postCommitDeps);
        } finally {
          release();
        }
      },
    })),
  };
}
