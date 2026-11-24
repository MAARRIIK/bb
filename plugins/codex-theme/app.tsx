import { useEffect } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useComposer,
  useSettings,
  type PluginHomepageSectionProps,
} from "@get-bb/plugin-sdk/app";
import { applyOptions, enabledOptions, type OptionValues } from "./options";
import "./app.css";

export const CACHE_KEY = "codex-theme:options";

export function readCachedOptions(
  storage: Pick<Storage, "getItem">,
): OptionValues {
  try {
    return enabledOptions(JSON.parse(storage.getItem(CACHE_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function OptionAttributes() {
  const { values, isLoading } = useSettings();
  useEffect(() => {
    if (isLoading || values === undefined) return;
    const enabled = enabledOptions(values);
    applyOptions(document.documentElement, enabled);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(enabled));
    } catch {}
  }, [values, isLoading]);
  return null;
}

export function Welcome({ projectId }: PluginHomepageSectionProps) {
  const { projects } = experimental_useSidebarThreads();
  const { scope } = useComposer();
  const selectedProjectId =
    scope.kind === "new-thread" ? scope.projectId : projectId;
  const project = projects.find((item) => item.id === selectedProjectId);

  return (
    <div className="codex-welcome">
      <span
        className="text-3xl font-semibold tracking-tight"
        aria-hidden="true"
      >
        AI
      </span>
      <h1>
        What should we build
        {project && !project.isPersonal ? (
          <>
            {" "}
            in <span>{project.name}</span>
          </>
        ) : null}
        ?
      </h1>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "option-attributes",
    mount() {
      try {
        applyOptions(document.documentElement, readCachedOptions(localStorage));
      } catch {}
      return () => applyOptions(document.documentElement, {});
    },
  });
  app.slots.experimental_appOverlay({
    id: "option-attributes",
    component: OptionAttributes,
  });
  app.slots.homepageSection({
    id: "welcome",
    title: "New thread",
    component: Welcome,
  });
});
