import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createCli } from "./src/server/cli";
import { IconStore } from "./src/server/state";
import { ICONS_TAG, iconsContract } from "./src/shared/contract";
import { DEFAULT_LANGUAGE, LANGUAGE_LABELS, LANGUAGES, parseLanguage } from "./src/shared/i18n";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    language: {
      type: "select",
      label: "Language",
      description: "Language of the Agent Icons settings, messages and CLI output.",
      options: [...LANGUAGES],
      experimental_optionLabels: LANGUAGE_LABELS,
      default: DEFAULT_LANGUAGE,
    },
  });
  const invalidate = () => bb.rpc.experimental_invalidate([ICONS_TAG]);
  settings.onChange((next, prev) => {
    if (next.language !== prev.language) invalidate();
  });

  const readLanguage = async () => {
    try {
      return parseLanguage((await settings.get()).language);
    } catch {
      return DEFAULT_LANGUAGE;
    }
  };
  const store = new IconStore(bb.storage.kv, invalidate, readLanguage);

  bb.rpc.register(iconsContract, {
    state: () => store.state(),
    setIcons: ({ setId }) => store.setIcons(setId),
    assign: ({ providerId, source, tint }) => store.assign(providerId, source, tint),
    clear: ({ providerId }) => store.clear(providerId),
    createSet: ({ name }) => store.createSet(name),
    renameSet: ({ setId, name }) => store.renameSet(setId, name),
    uploadIcons: ({ setId, files }) => store.uploadIcons(setId, files),
    renameIcon: ({ setId, iconId, name }) => store.renameIcon(setId, iconId, name),
    deleteIcon: ({ setId, iconId }) => store.deleteIcon(setId, iconId),
    deleteSet: ({ setId }) => store.deleteSet(setId),
  });

  bb.cli.register(createCli(store, () => bb.sdk.providers.list()));
}
