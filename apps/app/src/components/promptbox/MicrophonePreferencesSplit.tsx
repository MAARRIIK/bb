import { PickerLoadingRows } from "@/components/pickers/PickerLoadingRows";
import { useInterfaceTranslation } from "@/lib/interface-language";
import { defineSplit } from "@/lib/define-split";

function MicrophonePreferencesLoading() {
  const { t } = useInterfaceTranslation();
  return (
    <PickerLoadingRows
      label={t("Loading microphones")}
      rowDataAttribute="data-microphone-loading-row"
    />
  );
}

export const MicrophonePreferencesSplit = defineSplit<{
  open: boolean;
  onCaptureReady?: () => void;
}>({
  id: "microphone-preferences",
  load: () =>
    import("./MicrophonePreferences").then(
      (module) => module.MicrophonePreferences,
    ),
  loading: MicrophonePreferencesLoading,
  tier: "intent",
});
