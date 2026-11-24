import {
  interfaceLanguageSchema,
  responseLanguageSchema,
  type InterfaceLanguage,
  type ResponseLanguage,
} from "@bb/domain";
import { SettingsSection } from "@/components/ui/settings-section";
import { useInterfaceTranslation } from "@/lib/interface-language";
import { ChoiceDropdownSetting } from "./ChoiceDropdownSetting";

export function LanguageSettingsSection({
  preference,
  responsePreference,
  disabled,
  onChange,
  onResponseChange,
}: {
  preference: InterfaceLanguage;
  responsePreference: ResponseLanguage;
  disabled: boolean;
  onChange: (language: InterfaceLanguage) => void;
  onResponseChange: (language: ResponseLanguage) => void;
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
  const responseOptions = [
    {
      key: "interface",
      title: t("Follow interface language"),
      description: t(
        "Use the interface language. In System mode, keep the sending device's language for queued and background work.",
      ),
    },
    {
      key: "en",
      title: "English",
      description: t("Prefer English for AI explanations."),
    },
    {
      key: "ru",
      title: "Русский",
      description: t("Prefer Russian for AI explanations."),
    },
  ];
  const selectedResponse =
    responseOptions.find((option) => option.key === responsePreference) ??
    responseOptions[0]!;
  return (
    <SettingsSection title="Language" bodyClassName="space-y-4">
      <ChoiceDropdownSetting
        label="Interface language"
        triggerAriaLabel={t("Choose interface language")}
        description="Applies to connected clients without restarting. Code and filenames keep their original text."
        options={options}
        selected={selected}
        disabled={disabled}
        onSelect={(key) => onChange(interfaceLanguageSchema.parse(key))}
      />
      <ChoiceDropdownSetting
        label="AI response language"
        triggerAriaLabel={t("Choose AI response language")}
        description="Applies to new requests, including queued messages when they start. An explicit language in your request takes precedence. Existing replies are unchanged."
        options={responseOptions}
        selected={selectedResponse}
        disabled={disabled}
        onSelect={(key) => onResponseChange(responseLanguageSchema.parse(key))}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        {t(
          "Russian translations cover settings navigation, selected settings, model switching and queue controls. Other text uses English while translation continues.",
        )}
      </p>
    </SettingsSection>
  );
}
