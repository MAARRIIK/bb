import type { SystemCliCommandStatus } from "@bb/server-contract";
import type { ResolvedInterfaceLanguage } from "@bb/domain";
import { useInterfaceTranslation } from "@/lib/interface-language";
import {
  translateInterfaceText,
  type InterfaceTranslator,
} from "@/lib/interface-translations";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { useChangeCliCommand } from "@/hooks/mutations/settings-mutations";
import { useCliCommandStatus } from "@/hooks/queries/system-queries";

const CLI_COMMAND_SETTING_LABEL = "bb CLI";

interface CliCommandSettingsSectionContentProps {
  onChange: (change: "install" | "remove") => void;
  pending: boolean;
  status: SystemCliCommandStatus;
}

export function describeCliCommandStatus(
  status: SystemCliCommandStatus,
  language: ResolvedInterfaceLanguage = "en",
): string {
  const t: InterfaceTranslator = (message, values) =>
    translateInterfaceText(message, language, values);
  if (status.installedPath !== null) {
    return status.onPath
      ? t(
          "Installed at {path}. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex.",
          { path: status.installedPath },
        )
      : t(
          "Installed at {path}, but its folder is not on your PATH. Add the folder to your PATH to use bb outside bb.",
          { path: status.installedPath },
        );
  }
  if (status.shadowedBy === null) {
    return t(
      "Install the bb CLI for use outside bb. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex. Threads in bb already have it.",
    );
  }
  if (status.shadowedBy.source === "npm") {
    return t("Already installed for use outside bb at {path}, by npm.", {
      path: status.shadowedBy.path,
    });
  }
  if (status.shadowedBy.source === "machine") {
    return t(
      "The bb machine on this computer added a bb at {path} that can run an older bb. Install replaces it with this one.",
      { path: status.shadowedBy.path },
    );
  }
  return t(
    "Another bb at {path} comes first on your PATH. Remove it to install this one.",
    { path: status.shadowedBy.path },
  );
}

export function CliCommandSettingsSectionContent({
  onChange,
  pending,
  status,
}: CliCommandSettingsSectionContentProps) {
  const { t, language } = useInterfaceTranslation();
  const installed = status.installedPath !== null;
  return (
    <SettingsSection title="Command line">
      <SettingsWithControl
        controlPlacement="trailing"
        label={CLI_COMMAND_SETTING_LABEL}
        {...(installed ? { labelBadge: "Installed" } : {})}
        description={describeCliCommandStatus(status, language)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            pending ||
            (!installed &&
              status.shadowedBy !== null &&
              status.shadowedBy.source !== "machine")
          }
          onClick={() => onChange(installed ? "remove" : "install")}
          aria-label={t(installed ? "Remove bb CLI" : "Install bb CLI")}
        >
          {t(installed ? "Remove" : "Install")}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}

export function CliCommandSettingsSection() {
  const statusQuery = useCliCommandStatus();
  const changeCliCommand = useChangeCliCommand();
  const status = statusQuery.data;
  if (status === undefined || !status.supported) {
    return null;
  }

  return (
    <CliCommandSettingsSectionContent
      status={status}
      pending={changeCliCommand.isPending || statusQuery.isRefetching}
      onChange={(change) =>
        changeCliCommand.mutate(change, {
          onSettled: () => {
            void statusQuery.refetch();
          },
        })
      }
    />
  );
}
