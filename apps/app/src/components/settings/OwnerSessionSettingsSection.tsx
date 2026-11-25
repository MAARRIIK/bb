import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { useInterfaceTranslation } from "@/lib/interface-language";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { sdk } from "@/lib/sdk";

export function OwnerSessionSettingsSection() {
  const { t } = useInterfaceTranslation();
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void sdk.experimental_ownerAuth.status().then(
      (status) => {
        if (active) setVisible(status.enabled && status.authenticated);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  if (!visible) return null;

  async function logout() {
    setPending(true);
    try {
      await sdk.experimental_ownerAuth.logout();
      window.location.assign("/auth/login");
    } catch (error) {
      showMutationErrorToast({
        error,
        fallbackMessage: t("Could not sign out"),
      });
      setPending(false);
    }
  }

  return (
    <SettingsSection title="Owner session">
      <SettingsWithControl
        label="Sign out"
        description="Sign out of this browser session."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void logout()}
        >
          {t("Sign out")}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}
