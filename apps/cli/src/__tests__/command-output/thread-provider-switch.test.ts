import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  providerSwitchCommitRequestSchema,
  type ProviderSwitchCommitRequest,
} from "@bb/server-contract";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { makeProviderSwitchPreview } from "../helpers/provider-switch-review.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

setupCommandOutputTestEnvironment();

it("saves a private review without overwriting it and reuses its operation on retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-provider-review-"));
  const path = join(dir, "review.json");
  const preview = makeProviderSwitchPreview({
    threadId: "thr_review",
    environmentId: "env_review",
    hostId: "host_review",
  });
  const prepare = vi.fn(async () => preview);
  const commit = vi.fn(
    async ({
      json,
    }: {
      json: ProviderSwitchCommitRequest;
      param: { id: string };
    }) => ({
      operationId: json.operationId,
      threadId: "thr_review",
      providerId: "pi",
      model: "ollama/qwen",
      phase: "completed",
      errorCode: null,
      createdAt: 1,
      updatedAt: 2,
    }),
  );
  stubServerApi({
    "v1.threads.:id.provider-switch.preview.$post": prepare,
    "v1.threads.:id.provider-switch.$post": commit,
  });
  const register = (program: Parameters<typeof registerThreadCommands>[0]) =>
    registerThreadCommands(program, () => "http://server");
  let review: ReturnType<typeof providerSwitchCommitRequestSchema.parse>;
  try {
    const args = [
      "thread",
      "provider",
      "preview",
      "thr_review",
      "--provider",
      "pi",
      "--model",
      "ollama/qwen",
      "--permission-mode",
      "full",
      "--out",
      path,
      "--json",
    ];
    await runCommand(args, register);
    const saved = await readFile(path, "utf8");
    review = providerSwitchCommitRequestSchema.parse(JSON.parse(saved));
    expect(review.preview).toEqual(preview);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(
      collectLogPayloads(vi.mocked(console.log)).map((payload) =>
        JSON.parse(payload),
      ),
    ).toEqual([review]);
    await expect(runCommand(args, register)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(saved);
    expect(commit).not.toHaveBeenCalled();
    const apply = [
      "thread",
      "provider",
      "switch",
      "thr_review",
      "--preview-file",
      path,
      "--json",
    ];
    await runCommand(apply, register);
    await runCommand(apply, register);
    expect(commit).toHaveBeenCalledTimes(2);
    for (const [request] of commit.mock.calls)
      expect(request).toEqual({ param: { id: "thr_review" }, json: review });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
