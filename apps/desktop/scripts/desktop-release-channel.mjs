const DESKTOP_RELEASE_CHANNEL_ENV_NAME = "BB_DESKTOP_RELEASE_CHANNEL";

export function resolveDesktopReleaseChannel(env) {
  const rawChannel = env[DESKTOP_RELEASE_CHANNEL_ENV_NAME]?.trim();
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (rawChannel === "latest" || rawChannel === "nightly") {
    return rawChannel;
  }

  throw new Error(
    `${DESKTOP_RELEASE_CHANNEL_ENV_NAME} must be latest or nightly, got ${rawChannel}.`,
  );
}

export function resolveDesktopBuildPlatform(nodePlatform) {
  if (nodePlatform === "darwin") {
    return "macos";
  }
  if (nodePlatform === "linux") {
    return "linux";
  }
  if (nodePlatform === "win32") {
    return "windows";
  }

  throw new Error(
    `Desktop builds support darwin, linux, and win32 only, got ${nodePlatform}.`,
  );
}

export function createDesktopReleaseConfig(
  channel,
  architecture = process.arch,
) {
  if (channel === "nightly") {
    return {
      appId: "dev.maarriik.ai.nightly",
      applicationName: "AI Nightly",
      artifactName: "ai-ide-nightly-${version}-${arch}.${ext}",
      iconFileName: "icon-nightly.png",
      linuxExecutableName: "ai-ide-nightly",
      macIconPath: "assets/icon-nightly.icns",
      releaseTag: "desktop-nightly",
      windowsInstallName: "ai-ide-nightly",
      updateMetadataFileNames: {
        linux:
          architecture === "arm64"
            ? "nightly-linux-arm64.yml"
            : "nightly-linux.yml",
        macos: "nightly-mac.yml",
        windows: "nightly.yml",
      },
    };
  }

  return {
    appId: "dev.maarriik.ai",
    applicationName: "AI",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    iconFileName: "icon.png",
    linuxExecutableName: "ai-ide",
    macIconPath: "assets/icon.icns",
    releaseTag: "desktop-latest",
    windowsInstallName: "ai-ide",
    updateMetadataFileNames: {
      linux:
        architecture === "arm64"
          ? "latest-linux-arm64.yml"
          : "latest-linux.yml",
      macos: "latest-mac.yml",
      windows: "latest.yml",
    },
  };
}

export function createDesktopUpdateReleaseBaseUrl(releaseTag) {
  return `https://github.com/MAARRIIK/bb/releases/download/${releaseTag}/`;
}
