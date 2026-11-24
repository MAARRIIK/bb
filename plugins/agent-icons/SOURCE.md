# Source provenance

- Origin: https://github.com/ponomr/bb-plugin-agent-icons.git
- Pinned commit: `8a174aed858555631810fb4d8f560d07b735b31f`
- License: MIT; see `LICENSE`. Retained the upstream Lucide, Phosphor, and Tabler license notices under `icon-sets/licenses/`.
- Local adaptations: Added workspace `@bb/plugin-build` and `@get-bb/plugin-sdk` development dependencies and the `prepare:bundled` script. Removed non-semantic TypeScript comments to comply with repository rules. Omitted tests, generated build output, dependency lockfile, and the optional icon collection generation script; generated icon collections are not consumed by the plugin runtime.

Workspace manifest adaptations: The `prepare:bundled` script uses local `@bb/plugin-build` rather than an installed IDE CLI; no duplicate build task writes the same runtime directory. Typechecking uses the repository TypeScript/tsrs versions and a local tsconfig. Dependencies match actual retained imports and existing workspace versions; unused upstream SQLite, test, UI, and compiler tooling dependencies were removed. Test scripts/configurations were omitted with the upstream test files. Manifest normalization preserves runtime plugin IDs and entry points; any runtime adaptations are documented above.

Provider catalog adaptation: The unchanged built-in provider IDs live in `src/shared/builtin-providers.json` as declarative data. The runtime validates catalog keys with the shared provider-ID schema and values as enabled flags before deriving the immutable provider list; TypeScript derives its provider-ID type from the catalog keys. This keeps provider-specific metadata out of generic runtime logic.
