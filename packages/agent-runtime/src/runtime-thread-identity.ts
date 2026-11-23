import type { ProviderSessionSource, ThreadEvent } from "@bb/domain";
import type { AgentRuntimeProviderSession } from "./types.js";

export interface RuntimeProviderIdentityState {
  readonly source: ProviderSessionSource;
  threadIds: Set<string>;
}

interface CreateRuntimeProviderIdentityStateArgs {
  providerId: string;
  providerSessionId?: string | null;
}

interface RegisterThreadProviderArgs {
  providerId: string;
  providerState: RuntimeProviderIdentityState;
  threadId: string;
}

interface RecordProviderThreadIdentityArgs {
  providerState: RuntimeProviderIdentityState;
  providerThreadId: string;
  threadId: string;
}

interface ResolveBbThreadIdForProviderThreadArgs {
  providerState: RuntimeProviderIdentityState;
  providerThreadId: string | undefined;
}

interface ForgetThreadArgs {
  providerState: RuntimeProviderIdentityState;
  threadId: string;
}

interface ResolveProviderEventThreadIdArgs {
  eventThreadId: string | undefined;
  providerState: RuntimeProviderIdentityState;
  sourceThreadId: string | undefined;
}

interface StampThreadEventScopeArgs {
  event: ThreadEvent;
  providerThreadId: string | undefined;
  threadId: string;
}

export class RuntimeThreadIdentityRegistry {
  private readonly retiredThreadHints = new WeakMap<
    RuntimeProviderIdentityState,
    Set<string>
  >();
  private readonly threadToProviderState = new Map<
    string,
    RuntimeProviderIdentityState
  >();
  private readonly threadToProviderThread = new Map<string, string>();

  createProviderState(
    args: CreateRuntimeProviderIdentityStateArgs,
  ): RuntimeProviderIdentityState {
    return {
      source: {
        providerId: args.providerId,
        providerSessionId: args.providerSessionId ?? null,
      },
      threadIds: new Set(),
    };
  }

  registerThreadProvider(args: RegisterThreadProviderArgs): void {
    if (args.providerId !== args.providerState.source.providerId) {
      throw new Error("Provider identity state does not match provider");
    }
    const previous = this.threadToProviderState.get(args.threadId);
    if (previous !== args.providerState) {
      if (previous) this.retireThreadHints(previous, args.threadId);
      previous?.threadIds.delete(args.threadId);
      this.threadToProviderThread.delete(args.threadId);
    }
    this.threadToProviderState.set(args.threadId, args.providerState);
    args.providerState.threadIds.add(args.threadId);
  }

  resolveProviderForThread(threadId: string): string {
    const providerId =
      this.threadToProviderState.get(threadId)?.source.providerId;
    if (!providerId) {
      throw new Error(`No provider associated with thread "${threadId}"`);
    }
    return providerId;
  }

  getProviderThreadId(threadId: string): string | undefined {
    return this.threadToProviderThread.get(threadId);
  }

  getProviderSession(threadId: string): AgentRuntimeProviderSession | null {
    const source = this.threadToProviderState.get(threadId)?.source;
    const providerThreadId = this.threadToProviderThread.get(threadId);
    if (!source || !providerThreadId) {
      return null;
    }
    return { ...source, providerThreadId };
  }

  recordProviderThreadIdentity(args: RecordProviderThreadIdentityArgs): void {
    if (!args.providerState.threadIds.has(args.threadId)) {
      throw new Error(`No provider associated with thread "${args.threadId}"`);
    }
    this.threadToProviderThread.set(args.threadId, args.providerThreadId);
  }

  resolveBbThreadIdForProviderThread(
    args: ResolveBbThreadIdForProviderThreadArgs,
  ): string | undefined {
    if (!args.providerThreadId) {
      return undefined;
    }

    for (const [bbThreadId, mappedProviderThreadId] of this
      .threadToProviderThread) {
      if (
        mappedProviderThreadId === args.providerThreadId &&
        args.providerState.threadIds.has(bbThreadId)
      ) {
        return bbThreadId;
      }
    }

    return undefined;
  }

  resolveProviderIdentityThreadId(
    args: ResolveProviderEventThreadIdArgs,
  ): string | undefined {
    if (
      args.sourceThreadId &&
      args.providerState.threadIds.has(args.sourceThreadId)
    ) {
      return args.sourceThreadId;
    }

    if (
      args.eventThreadId &&
      args.providerState.threadIds.has(args.eventThreadId)
    ) {
      return args.eventThreadId;
    }

    const lookupId = args.sourceThreadId || args.eventThreadId;
    if (lookupId) {
      for (const [bbThreadId, providerThreadId] of this
        .threadToProviderThread) {
        if (
          providerThreadId === lookupId &&
          args.providerState.threadIds.has(bbThreadId)
        ) {
          return bbThreadId;
        }
      }
    }

    return undefined;
  }

  resolveProviderEventThreadId(
    args: ResolveProviderEventThreadIdArgs,
  ): string | undefined {
    const explicitThreadId = this.resolveProviderIdentityThreadId(args);
    if (explicitThreadId !== undefined) {
      return explicitThreadId;
    }

    if (
      args.providerState.threadIds.size === 1 &&
      !this.namesForeignThread(args.providerState, args.eventThreadId) &&
      !this.namesForeignThread(args.providerState, args.sourceThreadId)
    ) {
      return [...args.providerState.threadIds][0];
    }

    return undefined;
  }

  private namesForeignThread(
    providerState: RuntimeProviderIdentityState,
    threadId: string | undefined,
  ): boolean {
    if (threadId === undefined) {
      return false;
    }
    return (
      this.retiredThreadHints.get(providerState)?.has(threadId) === true ||
      (this.threadToProviderState.has(threadId) &&
        !providerState.threadIds.has(threadId))
    );
  }

  clearThread(threadId: string): void {
    const providerState = this.threadToProviderState.get(threadId);
    if (providerState) {
      this.retireThreadHints(providerState, threadId);
      providerState.threadIds.delete(threadId);
    }
    this.threadToProviderState.delete(threadId);
    this.threadToProviderThread.delete(threadId);
  }

  private retireThreadHints(
    providerState: RuntimeProviderIdentityState,
    threadId: string,
  ): void {
    const retired =
      this.retiredThreadHints.get(providerState) ?? new Set<string>();
    retired.add(threadId);
    const nativeId = this.threadToProviderThread.get(threadId);
    if (nativeId !== undefined) retired.add(nativeId);
    this.retiredThreadHints.set(providerState, retired);
  }

  forgetThread(args: ForgetThreadArgs): boolean {
    args.providerState.threadIds.delete(args.threadId);
    if (this.threadToProviderState.get(args.threadId) === args.providerState) {
      this.clearThread(args.threadId);
      return true;
    }
    return false;
  }
}

export function stampThreadEventScope(
  args: StampThreadEventScopeArgs,
): ThreadEvent {
  if (
    "providerThreadId" in args.event &&
    !args.event.providerThreadId &&
    args.providerThreadId
  ) {
    return {
      ...args.event,
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
    };
  }

  return {
    ...args.event,
    threadId: args.threadId,
  };
}
