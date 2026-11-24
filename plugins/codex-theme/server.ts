import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { OPTIONS, OPTION_KEYS, type OptionKey } from "./options";

type BooleanSetting = {
  type: "boolean";
  label: string;
  description: string;
  default: boolean;
};

export default async function plugin(bb: BbPluginApi) {
  const descriptors = Object.fromEntries(
    OPTION_KEYS.map((key) => [
      key,
      {
        type: "boolean",
        label: OPTIONS[key].label,
        description: OPTIONS[key].description,
        default: true,
      },
    ]),
  ) as Record<OptionKey, BooleanSetting>;
  bb.settings.define(descriptors);
  bb.log.info("loaded — contributes the Codex palettes");
}
