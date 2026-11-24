import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { CompareView } from "./compare.js";
import { Overview } from "./overview.js";
import type { Screen } from "./routes.js";
import type { rpcContract } from "./server.js";
import { TRACE_CHANNEL } from "./trace.js";
import { Notice, OpenInPage } from "./ui.js";
import { errorMessage } from "./util.js";
import { TurnView } from "./waterfall.js";

export type { Screen } from "./routes.js";

type Trace = PluginRpcResult<(typeof rpcContract)["trace"]>;
export type TurnSummary = Trace["turns"][number];

export interface Target {
  threadId: string;
  turnId?: string;
  spanId?: string;
  atSeq?: number;
  fromTitle?: string;
  screen?: Screen;
}

export interface Back {
  label: string;
  onBack: () => void;
}

function turnAtSeq(
  turns: readonly TurnSummary[],
  seq: number,
): TurnSummary | undefined {
  return (
    turns.find((turn) => turn.requestSeq === seq) ??
    turns.find((turn) => turn.firstSeq <= seq && seq <= turn.lastSeq) ??
    turns.find((turn) => turn.firstSeq > seq)
  );
}

export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return running ? now : Date.now();
}

export function useCatchUp(refresh: () => void) {
  const connection = useRealtimeConnectionState();
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  const connectedBefore = useRef(false);
  useEffect(() => {
    if (connection !== "connected") return;
    if (connectedBefore.current) latest.current();
    connectedBefore.current = true;
  }, [connection]);
}

function useTrace(threadId: string, turnId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const key = `${threadId}:${turnId ?? ""}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: Trace } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latestRequest.current;
    rpc.call("trace", turnId ? { threadId, turnId } : { threadId }).then(
      (data) => {
        if (request !== latestRequest.current) return;
        setSnapshot({ key, data });
        setError(null);
      },
      (cause) => {
        if (request === latestRequest.current) setError(errorMessage(cause));
      },
    );
  }, [rpc, threadId, turnId, key]);

  useEffect(refresh, [refresh]);
  useRealtime(TRACE_CHANNEL, (payload) => {
    const changed = (payload as { threadId?: unknown } | null)?.threadId;
    if (changed === threadId) refresh();
  });
  useCatchUp(refresh);

  return {
    data: snapshot?.data ?? null,
    focus: snapshot?.key === key ? snapshot.data.focus : null,
    error,
  };
}

const labels = new Map<string, string | number>();
const labelListeners = new Set<() => void>();
let labelsVersion = 0;

function rememberLabels(trace: Trace) {
  let changed = false;
  const set = (key: string, value: string | number) => {
    if (labels.get(key) === value) return;
    labels.set(key, value);
    changed = true;
  };
  set(trace.threadId, trace.title);
  for (const turn of trace.turns)
    set(`${trace.threadId}\n${turn.id}`, turn.index);
  if (!changed) return;
  labelsVersion++;
  for (const listener of labelListeners) listener();
}

function subscribeLabels(listener: () => void) {
  labelListeners.add(listener);
  return () => {
    labelListeners.delete(listener);
  };
}

export function useTraceLabels() {
  useSyncExternalStore(subscribeLabels, () => labelsVersion);
  return {
    title: (threadId: string) => {
      const title = labels.get(threadId);
      return typeof title === "string" ? title : null;
    },
    turn: (threadId: string, turnId: string) => {
      const index = labels.get(`${threadId}\n${turnId}`);
      return typeof index === "number" ? index : null;
    },
  };
}

export function ThreadTrace({
  target,
  back,
  onOpenThread,
  screen: routeScreen,
  onScreen,
  onOpenPage,
}: {
  target: Target;
  back: Back | null;
  onOpenThread: (target: Target, screen: Screen) => void;
  screen?: Screen;
  onScreen?: (screen: Screen) => void;
  onOpenPage?: (screen: Screen) => void;
}) {
  const { threadId } = target;
  const [ownScreen, setOwnScreen] = useState<Screen | null>(
    () =>
      target.screen ??
      (target.turnId
        ? { kind: "turn", turnId: target.turnId, spanId: target.spanId }
        : null),
  );
  const screen = routeScreen ?? ownScreen;
  const setScreen = onScreen ?? setOwnScreen;
  const focusId = screen?.kind === "turn" ? screen.turnId : null;
  const trace = useTrace(threadId, focusId);
  const turns = trace.data?.turns ?? [];
  const latest = turns.at(-1);
  const loaded = trace.data !== null;
  useEffect(() => {
    if (screen !== null || !loaded) return;
    const fromMessage =
      target.atSeq === undefined ? undefined : turnAtSeq(turns, target.atSeq);
    const automatic =
      fromMessage ??
      (latest && (latest.end === null || turns.length === 1)
        ? latest
        : undefined);
    setScreen(
      automatic ? { kind: "turn", turnId: automatic.id } : { kind: "turns" },
    );
  }, [screen, loaded, target.atSeq, turns, latest, setScreen]);
  useEffect(() => {
    if (trace.data) rememberLabels(trace.data);
  }, [trace.data]);
  const now = useNow(latest?.end === null);

  const { error } = trace;
  if (!trace.data || screen === null) {
    return (
      <Notice>
        {error ? `Could not load the trace: ${error}` : "Reading the thread…"}
      </Notice>
    );
  }
  const data = trace.data;
  if (turns.length === 0) {
    return (
      <Notice>
        No turns yet. The trace fills in as soon as the agent starts working.
      </Notice>
    );
  }
  const notice = error ? `Could not refresh: ${error}` : null;
  const openThread = (next: Omit<Target, "fromTitle">) =>
    onOpenThread({ ...next, fromTitle: data.title }, screen);

  return (
    <OpenInPage.Provider value={onOpenPage ? () => onOpenPage(screen) : null}>
      {(() => {
        if (screen.kind === "compare") {
          const a = turns.find((turn) => turn.id === screen.a);
          const b = turns.find((turn) => turn.id === screen.b);
          if (a && b) {
            return (
              <CompareView
                threadId={threadId}
                a={a}
                b={b}
                onBack={() => setScreen({ kind: "turns" })}
              />
            );
          }
        }
        const index =
          screen.kind === "turn"
            ? turns.findIndex((turn) => turn.id === screen.turnId)
            : -1;
        if (index < 0) {
          return (
            <Overview
              threadId={threadId}
              title={onScreen ? null : data.title}
              turns={turns}
              now={now}
              notice={notice}
              back={back}
              tab={screen.kind === "commands" ? "commands" : "turns"}
              onTab={(tab) => setScreen({ kind: tab })}
              onOpen={(turnId, spanId) =>
                setScreen(
                  spanId
                    ? { kind: "turn", turnId, spanId }
                    : { kind: "turn", turnId },
                )
              }
              onCompare={(a, b) => setScreen({ kind: "compare", a, b })}
              onOpenThread={openThread}
            />
          );
        }
        const previous = turns[index - 1];
        const next = turns[index + 1];
        const live =
          latest && latest.end === null && latest.id !== focusId
            ? latest
            : null;
        const spanId = screen.kind === "turn" ? screen.spanId : undefined;
        return (
          <TurnView
            threadId={threadId}
            projectId={data.projectId}
            summary={turns[index]}
            focus={trace.focus}
            now={now}
            notice={notice}
            back={back}
            initialSpanId={spanId}
            onBack={
              turns.length > 1 ? () => setScreen({ kind: "turns" }) : null
            }
            onPrevious={
              previous
                ? () => setScreen({ kind: "turn", turnId: previous.id })
                : null
            }
            onNext={
              next ? () => setScreen({ kind: "turn", turnId: next.id }) : null
            }
            liveTurn={
              live
                ? {
                    index: live.index,
                    open: () => setScreen({ kind: "turn", turnId: live.id }),
                  }
                : null
            }
            onOpenThread={openThread}
          />
        );
      })()}
    </OpenInPage.Provider>
  );
}
