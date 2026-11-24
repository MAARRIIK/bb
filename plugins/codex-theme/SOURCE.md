# Source provenance

- Origin: https://github.com/steveafrost/bb-theme-codex.git
- Pinned commit: `0569c6f04b0b87bcc6958f4a3d87be0a2363c544`
- License: MIT; see `LICENSE`.
- Local adaptations: Added workspace `@bb/plugin-build` and `@get-bb/plugin-sdk` development dependencies and the `prepare:bundled` script. Removed non-semantic TypeScript comments to comply with repository rules. Omitted tests, preview image, generated build output, and dependency lockfile. The seven optional layout settings default to enabled in AI; existing saved values are retained. The welcome mark displays AI instead of the upstream BB logo. The original on-install theme hook is removed; the server seeds Codex only when no appearance has been saved.

Workspace manifest adaptations: The `prepare:bundled` script uses local `@bb/plugin-build` rather than an installed IDE CLI; no duplicate build task writes the same runtime directory. Typechecking uses the repository TypeScript/tsrs versions and a local tsconfig. Dependencies match actual retained imports and existing workspace versions; unused upstream SQLite, test, UI, and compiler tooling dependencies were removed. Test scripts/configurations were omitted with the upstream test files. Manifest normalization preserves runtime plugin IDs and entry points; any runtime adaptations are documented above.
