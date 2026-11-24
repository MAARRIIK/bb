import { eq } from "drizzle-orm";
import {
  appendStoredThreadEventsInTransaction,
  getLatestStoredRateLimitsEvent,
  getLatestStoredThreadEventOfTypes,
  type AppendStoredThreadEventArgs,
} from "../../src/data/events.js";
import { threads } from "../../src/schema.js";
import { pruneRateLimitSnapshotWindow } from "../../src/data/rate-limit-pruning.js";
import { registerCostGroup, type QueryCostCase } from "./case.js";

const variants = ["thread", "current-found", "current-missing"] as const;

export const FAILURE_FACTS_COST_GROUP = registerCostGroup({
  name: "failure-facts",
  seed: () => undefined,
  cases: variants.flatMap((variant): QueryCostCase[] => {
    const prepare: NonNullable<QueryCostCase["prepare"]> = (db, fixture) => {
      const facts: AppendStoredThreadEventArgs[] = [
        {
          threadId: fixture.threadId,
          providerThreadId: fixture.providerThreadId,
          scope: { kind: "thread" },
          type: "provider/error",
          data: {
            providerThreadId: fixture.providerThreadId,
            message: "Limit reached",
          },
        },
        {
          threadId: fixture.threadId,
          providerThreadId: fixture.providerThreadId,
          scope: { kind: "thread" },
          type: "provider/rateLimits/updated",
          data: {
            providerThreadId: fixture.providerThreadId,
            rateLimits: {
              providerId: "codex",
              status: "blocked",
              kind: "subscription-window",
              windows: [],
              reachedReason: null,
              overageStatus: null,
              overageReason: null,
            },
          },
        },
      ];
      db.transaction((tx) => {
        tx.update(threads)
          .set({ providerSessionId: "ps_current" })
          .where(eq(threads.id, fixture.threadId))
          .run();
        if (variant !== "current-missing")
          appendStoredThreadEventsInTransaction(tx, facts);
        tx.update(threads)
          .set({ providerSessionId: "ps_stale" })
          .where(eq(threads.id, fixture.threadId))
          .run();
        appendStoredThreadEventsInTransaction(
          tx,
          fixture.turns.flatMap(() => facts),
        );
        tx.update(threads)
          .set({ providerSessionId: "ps_current" })
          .where(eq(threads.id, fixture.threadId))
          .run();
      });
    };
    const scope = variant === "thread" ? "thread" : "current-session";
    const cases: QueryCostCase[] = [
      {
        name: "packages/db/src/data/events.ts#getLatestStoredRateLimitsEvent",
        variant,
        prepare,
        run: (db, fixture) =>
          getLatestStoredRateLimitsEvent(db, {
            threadId: fixture.threadId,
            scope,
          }),
      },
      {
        name: "packages/db/src/data/events.ts#getLatestStoredThreadEventOfTypes",
        variant,
        prepare,
        run: (db, fixture) =>
          getLatestStoredThreadEventOfTypes(db, {
            threadId: fixture.threadId,
            scope,
            afterSequence: 0,
            types: ["provider/error"],
          }),
      },
    ];
    if (variant !== "thread") {
      cases.push({
        name: "packages/db/src/data/rate-limit-pruning.ts#pruneRateLimitSnapshotWindow",
        variant,
        prepare,
        run: (db, fixture) =>
          pruneRateLimitSnapshotWindow(db, {
            threadId: fixture.threadId,
            afterSequence: 0,
            throughSequence: Number.MAX_SAFE_INTEGER,
            limit: 64,
          }),
      });
    }
    return cases;
  }),
});
