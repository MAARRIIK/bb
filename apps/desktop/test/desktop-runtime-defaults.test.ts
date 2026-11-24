import { describe, expect, it } from "vitest";
import { createDesktopRuntimeEnvironment } from "../src/desktop-runtime-defaults.js";

describe("AI desktop runtime defaults", () => {
  it.each([
    {
      channel: "latest" as const,
      directory: ".ai-ide",
      server: "39886",
      daemon: "39887",
    },
    {
      channel: "nightly" as const,
      directory: ".ai-ide-nightly",
      server: "39986",
      daemon: "39987",
    },
  ])(
    "isolates $channel from the original IDE and the other channel",
    ({ channel, directory, server, daemon }) => {
      expect(
        createDesktopRuntimeEnvironment({
          env: {},
          homeDir: "/home/user",
          channel,
        }),
      ).toEqual({
        BB_DATA_DIR: `/home/user/${directory}`,
        BB_SERVER_PORT: server,
        BB_HOST_DAEMON_PORT: daemon,
      });
    },
  );

  it("keeps explicit source QA paths and endpoints without mutating the caller", () => {
    const env = {
      BB_DATA_DIR: "/qa/owned",
      BB_SERVER_PORT: "21716",
      BB_HOST_DAEMON_PORT: "29716",
      BB_SERVER_URL: "http://127.0.0.1:21716",
      CUSTOM_SETTING: "preserved",
    };
    expect(
      createDesktopRuntimeEnvironment({
        env,
        homeDir: "/home/user",
        channel: "latest",
      }),
    ).toEqual(env);
    expect(env).toEqual({
      BB_DATA_DIR: "/qa/owned",
      BB_SERVER_PORT: "21716",
      BB_HOST_DAEMON_PORT: "29716",
      BB_SERVER_URL: "http://127.0.0.1:21716",
      CUSTOM_SETTING: "preserved",
    });
  });
});
