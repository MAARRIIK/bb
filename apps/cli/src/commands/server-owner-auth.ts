import type { Command } from "commander";
import { setLocalServerOwnerPassword } from "@bb/config/server-owner-auth";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "../command-result.js";
import { resolveLocalDataDir } from "./server-local.js";

async function passwordFromStdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      "Read the password privately and pipe it to --password-stdin",
    );
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.length;
    if (length > 4096) throw new Error("Password input is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/u, "");
}

export function registerServerOwnerAuthCommands(
  server: Command,
  getUrl: () => string,
): void {
  const auth = server
    .command("auth")
    .description("Configure and sign in to a self-hosted AI server");
  auth
    .command("set-password")
    .description(
      "Set or rotate the local owner password; existing owner sessions are revoked",
    )
    .option("--data-dir <dir>", "Server data directory")
    .requiredOption("--username <name>", "Owner username")
    .requiredOption("--password-stdin", "Read the password from standard input")
    .option("--json", "Print machine-readable output")
    .action(
      action(
        async (opts: {
          dataDir?: string;
          username: string;
          passwordStdin: boolean;
          json?: boolean;
        }) => {
          if (!opts.passwordStdin)
            throw new Error("--password-stdin is required");
          await setLocalServerOwnerPassword({
            dataDir: resolveLocalDataDir(opts.dataDir),
            username: opts.username,
            password: await passwordFromStdin(),
          });
          if (!outputJson(opts, { configured: true }))
            console.log(
              "Owner password configured. Existing owner sessions are revoked.",
            );
        },
      ),
    );
  auth
    .command("login")
    .description("Sign this CLI in to the configured AI server")
    .requiredOption("--username <name>", "Owner username")
    .requiredOption("--password-stdin", "Read the password from standard input")
    .option("--json", "Print machine-readable output")
    .action(
      action(
        async (opts: {
          username: string;
          passwordStdin: boolean;
          json?: boolean;
        }) => {
          if (!opts.passwordStdin)
            throw new Error("--password-stdin is required");
          const result = await createCliBbSdk(
            getUrl(),
          ).experimental_ownerAuth.login({
            username: opts.username,
            password: await passwordFromStdin(),
          });
          if (!outputJson(opts, result)) console.log("Signed in to AI.");
        },
      ),
    );
  for (const command of ["status", "logout"] as const) {
    auth
      .command(command)
      .description(
        command === "status"
          ? "Show owner sign-in status"
          : "Sign this CLI out",
      )
      .option("--json", "Print machine-readable output")
      .action(
        action(async (opts: { json?: boolean }) => {
          const result =
            await createCliBbSdk(getUrl()).experimental_ownerAuth[command]();
          if (!outputJson(opts, result))
            console.log(result.authenticated ? "Signed in" : "Signed out");
        }),
      );
  }
}
