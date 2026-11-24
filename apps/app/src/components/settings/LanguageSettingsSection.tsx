import { interfaceLanguageSchema, type InterfaceLanguage } from "@bb/domain";
import { SettingsSection } from "@/components/ui/settings-section";
import { useInterfaceTranslation } from "@/lib/interface-language";
import { ChoiceDropdownSetting } from "./ChoiceDropdownSetting";

export function LanguageSettingsSection({
  preference,
  disabled,
  onChange,
}: {
  preference: InterfaceLanguage;
  disabled: boolean;
  onChange: (language: InterfaceLanguage) => void;
}) {
  const { t } = useInterfaceTranslation();
  const options = [
    {
      key: "system",
      title: t("System language"),
      description: t("Use this device's preferred supported language."),
    },
    {
      key: "en",
      title: "English",
      description: t("Use English for the interface."),
    },
    {
      key: "ru",
      title: "Русский",
      description: t("Use Russian for the interface."),
    },
  ];
  const selected =
    options.find((option) => option.key === preference) ?? options[0]!;
  return (
    <SettingsSection title="Language">
      <ChoiceDropdownSetting
        label="Interface language"
        triggerAriaLabel={t("Choose interface language")}
        description="Applies to connected clients without restarting. Code, filenames and model replies are unchanged."
        options={options}
        selected={selected}
        disabled={disabled}
        onSelect={(key) => onChange(interfaceLanguageSchema.parse(key))}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        {t(
          "Russian translations cover settings navigation, selected settings, model switching and queue controls. Other text uses English while translation continues.",
        )}
      </p>
    </SettingsSection>
  );
}
