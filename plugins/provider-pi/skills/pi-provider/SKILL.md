---
name: pi-provider
description: "Configure BB Pi API connections, or inspect Pi model discovery, message editing and context compaction."
---

# Pi provider

Pi supports editing and rerunning eligible user messages and compacting idle or
errored threads through the core `bb thread edit-message` and `bb thread compact`
commands. Inspect the thread first and use live command help for arguments.
Provider confirmation determines whether the operation completed.

Use the target host's provider catalog for available models and execution options.

## API connections

Settings → Plugins → Pi provider → API connections saves API keys for all projects
or one project, using BB's encrypted environment store. Pi must be installed on
the execution machine. This panel configures keys; saving does not validate API
access or make a model request.

`bb pi api-providers --json` lists presets, native Pi provider IDs, environment
variable names and setup documentation. The read-only SDK equivalent is
`sdk.plugins.callRpc({ pluginId: "provider-pi", method: "api-providers.list", input: {}, outputSchema })`;
use the installed plugin's ID if different and validate with the method's
output schema (`providers`, an array of `id`, `name`, `provider`,
`environmentVariable` and `documentationUrl` strings). The presets cover Gemini, Kimi /
Moonshot AI, GLM / Z.ai **Coding Plan**, and DeepSeek. Kimi's Moonshot API key is
separate from a Kimi Coding login; Z.ai Coding Plan uses its coding endpoint.

Save a key with `bb machine env set <NAME>`; this command reads its value from
stdin. Add `--project <project-id>` for project scope. Never put a real key in
command arguments, chat, a committed file, or command output. Use the UI for
interactive entry. Remove with `bb machine env unset <NAME>` at the same scope.
Deleting a project override restores an inherited global key.

SDK writes use `sdk.system.setMachineEnvironmentVariable({ name, value, note: null })`
or `sdk.projects.setMachineEnvironmentVariable({ projectId, name, value, note: null })`.
The corresponding delete methods remove a saved key. Reads return masked values.
Global keys reach every machine; project keys follow that project across hosts.
Changes apply to agent turns after saving; existing terminal environments stay as
launched. Pi's own saved login credentials take priority over environment keys;
manage those through Pi on the execution machine. Do not overwrite its auth or
model files just to connect a preset.

After saving, inspect `bb provider models pi --project <project-id> --json` on the
intended host. A listed model proves configuration discovery, not successful
remote authentication. A real model request is a separate verification and may
consume paid API usage.
