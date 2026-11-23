import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import {
  acquireThreadSessionActivity,
  withThreadContextChangeGuard,
  withThreadSendGuard,
} from "../../../src/services/threads/thread-session-guard.js";

describe("thread session guard", () => {
  it("rejects a whole activity batch during commit and releases exclusion after failure", async () => {
    const failure = new Error("commit failed");
    await expect(
      withThreadContextChangeGuard("thread-commit", (commit) =>
        commit(async () => {
          expect(() =>
            acquireThreadSessionActivity(["thread-other", "thread-commit"]),
          ).toThrow("Thread session is being changed");
          await withThreadContextChangeGuard("thread-other", (otherCommit) =>
            otherCommit(async () => {}),
          );
          throw failure;
        }),
      ),
    ).rejects.toBe(failure);
    const release = acquireThreadSessionActivity([
      "thread-other",
      "thread-commit",
    ]);
    release();
    await expect(
      withThreadContextChangeGuard("thread-commit", (commit) =>
        commit(async () => "changed"),
      ),
    ).resolves.toBe("changed");
  });
  it("rejects sends while a context clear owns the thread", async () => {
    const started = createDeferredPromise<void>();
    const release = createDeferredPromise<void>();
    const clear = withThreadContextChangeGuard("thread-clear", async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;

    await expect(
      withThreadSendGuard("thread-clear", async () => {}),
    ).rejects.toMatchObject({ status: 409 });
    release.resolve();
    await clear;
    await expect(
      withThreadSendGuard("thread-clear", async () => "sent"),
    ).resolves.toBe("sent");
  });

  it("allows overlapping sends but excludes clear until both settle", async () => {
    const release = createDeferredPromise<void>();
    const send = () =>
      withThreadSendGuard("thread-send", async () => {
        await release.promise;
      });
    const sends = [send(), send()];

    await expect(
      withThreadContextChangeGuard("thread-send", async () => {}),
    ).rejects.toMatchObject({ status: 409 });
    release.resolve();
    await Promise.all(sends);
    await expect(
      withThreadContextChangeGuard("thread-send", async () => "cleared"),
    ).resolves.toBe("cleared");
  });
});
