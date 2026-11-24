import { z } from "zod";
import builtinProviderData from "./builtin-providers.json" with { type: "json" };
import { providerIdSchema } from "./contract";

export const BUILTIN_ICONS = [
  "Bot",
  "Calendar",
  "FileText",
  "Brain",
  "Star",
  "Cloud",
  "Globe",
  "Folder",
  "Mail",
  "MessageSquare",
  "Mic",
  "Palette",
  "Lock",
  "UserRound",
  "Bug",
  "Code",
  "Terminal",
  "Clock",
  "Beaker",
  "Target",
  "Coffee",
  "Eye",
  "Search",
  "Settings",
  "SlidersHorizontal",
  "Layers",
  "Puzzle",
  "Archive",
  "ListTodo",
  "CircleCheck",
  "Home",
  "Info",
  "Circle",
  "Square",
  "Keyboard",
  "Laptop",
  "Smartphone",
  "Link",
  "Paperclip",
] as const;

export type BuiltinIconName = (typeof BUILTIN_ICONS)[number];

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_ICONS);

export function isBuiltinIcon(name: string): name is BuiltinIconName {
  return BUILTIN_SET.has(name);
}

type BuiltinProviderId = keyof typeof builtinProviderData;

const builtinProviderCatalog = z
  .record(providerIdSchema, z.literal(true))
  .parse(builtinProviderData);

export const BUILTIN_PROVIDER_IDS: readonly BuiltinProviderId[] = Object.freeze(
  Object.keys(builtinProviderCatalog).filter(
    (providerId): providerId is BuiltinProviderId =>
      Object.hasOwn(builtinProviderData, providerId),
  ),
);
