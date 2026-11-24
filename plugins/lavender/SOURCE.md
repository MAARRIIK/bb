# Source provenance

- Origin: https://github.com/MateoCerquetella/bb-plugins.git, `plugins/lavender` subtree
- Pinned commit: `8a64e1361f77eaf172f6f24376d714f428451d96`
- License: MIT; retained the plugin's `LICENSE` verbatim.
- Local adaptations: Added workspace `@bb/plugin-build` and `@get-bb/plugin-sdk` development dependencies and the `prepare:bundled` script. Omitted tests, generated build output, and dependency lockfile.

Workspace manifest adaptations: The `prepare:bundled` script uses local `@bb/plugin-build` rather than an installed IDE CLI; no duplicate build task writes the same runtime directory. Typechecking uses the repository TypeScript/tsrs versions and a local tsconfig. Dependencies match actual retained imports and existing workspace versions; unused upstream SQLite, test, UI, and compiler tooling dependencies were removed. Test scripts/configurations were omitted with the upstream test files. Manifest normalization preserves runtime plugin IDs and entry points; any runtime adaptations are documented above.
