export type DesktopReleaseChannel = "latest" | "nightly";
export type DesktopBuildPlatform = "macos" | "linux" | "windows";

export interface DesktopUpdateMetadataFileNames {
  linux:
    | "latest-linux.yml"
    | "nightly-linux.yml"
    | "latest-linux-arm64.yml"
    | "nightly-linux-arm64.yml";
  macos: "latest-mac.yml" | "nightly-mac.yml";
  windows: "latest.yml" | "nightly.yml";
}

export interface DesktopReleaseConfig {
  appId: "dev.maarriik.ai" | "dev.maarriik.ai.nightly";
  applicationName: "AI" | "AI Nightly";
  artifactName: string;
  iconFileName: "icon.png" | "icon-nightly.png";
  linuxExecutableName: "ai-ide" | "ai-ide-nightly";
  macIconPath: "assets/icon.icns" | "assets/icon-nightly.icns";
  releaseTag: "desktop-latest" | "desktop-nightly";
  updateMetadataFileNames: DesktopUpdateMetadataFileNames;
  windowsInstallName: "ai-ide" | "ai-ide-nightly";
}

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function resolveDesktopBuildPlatform(
  nodePlatform: string,
): DesktopBuildPlatform;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
  architecture?: NodeJS.Architecture,
): DesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(
  releaseTag: DesktopReleaseConfig["releaseTag"],
): string;
