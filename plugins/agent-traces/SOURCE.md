# Source provenance

- Origin: https://github.com/charpeni/bb-plugins.git, `plugins/agent-traces` subtree
- Pinned commit: `de00e14f21632bbedebd0f957ab2b1bb5f25e58d`
- License: MIT; retained the parent repository's `LICENSE` verbatim.
- Local adaptations: Added workspace `@bb/plugin-build` and `@get-bb/plugin-sdk` development dependencies and the `prepare:bundled` script. Removed non-semantic TypeScript comments to comply with repository rules. Moved the thread list container query onto the scroller content to avoid relayout of the entire scrolled subtree. Omitted tests, screenshots, generated build output, and dependency lockfile.

Workspace manifest adaptations: The `prepare:bundled` script uses local `@bb/plugin-build` rather than an installed IDE CLI; no duplicate build task writes the same runtime directory. Typechecking uses the repository TypeScript/tsrs versions and a local tsconfig. Dependencies match actual retained imports and existing workspace versions; unused upstream SQLite, test, UI, and compiler tooling dependencies were removed. Test scripts/configurations were omitted with the upstream test files. Manifest normalization preserves runtime plugin IDs and entry points; any runtime adaptations are documented above.

SDK compatibility adaptations: The Trace message action and command open the same registered action tab through `context.panel.openTab`, replacing the removed `openPanel` context method. Child thread discovery paginates both active and archived lists in batches of 100 until the final short page, preserving the existing child and parent caches.

Typography uses the host's sanctioned text tokens so compact screens follow the IDE's responsive type scale.
