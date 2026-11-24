import { join } from "node:path";

export function createDesktopRuntimeEnvironment({
  env,
  homeDir,
  channel,
}: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  channel: "latest" | "nightly";
}): NodeJS.ProcessEnv {
  const nightly = channel === "nightly";
  const serverPort = env.BB_SERVER_PORT ?? (nightly ? "39986" : "39886");
  return {
    ...env,
    BB_DATA_DIR:
      env.BB_DATA_DIR ?? join(homeDir, nightly ? ".ai-ide-nightly" : ".ai-ide"),
    BB_SERVER_PORT: serverPort,
    BB_HOST_DAEMON_PORT:
      env.BB_HOST_DAEMON_PORT ?? (nightly ? "39987" : "39887"),
  };
}
