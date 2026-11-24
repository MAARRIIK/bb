# Provider usage

Shows usage from enabled usage-source plugins in the sidebar. When a location has
more than one provider, the card opens on an **All** tab that stacks every provider
tab's accounts, each marked with its provider icon. Provider tabs use provider icons,
with pooled accounts stacked under each provider. Each account shows its plan and,
per usage window, a consumption bar, the percentage remaining, and the time until reset.
Open a window row for its consumed amount, exact reset time in the device's time
zone, and whether the window is shared by all models in this account or applies
to a reported model family. Settings shows these details directly. Window labels
come from the source; hourly, monthly and other custom windows appear only when
reported. A percentage is not an estimate of requests remaining.

Both displays identify the source plugin and its last successful measurement
time. Measurements older than five minutes or retained after a failed resource
refresh are marked stale. A missing or invalid measurement timestamp is shown as
unknown; the cache's load time never substitutes for it. Remaining percentages
stop at zero on overage, while consumption above 100% remains visible in details.
The card lists account metadata cheaply, then fetches the accounts on the selected
tab. Unopened tabs have no quota badge until measured, and a badge shows only while
that provider's accounts are off screen. Shared sources such as Account Pooler are selected by default; an explicit
machine selection shows that machine’s local usage instead.

An unconfigured shared source remains selectable and shows setup guidance.
Failed refreshes retain the last available measurements with a retry notice.
Account authentication failures and plans without reported limits have separate
states; unavailable usage is never represented as zero consumption.

Settings → Installed plugins → Provider usage contains the usage page, using its
full-size provider groups with email-labeled accounts and fetching only resources in the selected pool or machine. Both surfaces share the plugin’s aggregation and cache. Neither display is required for source
plugins to publish their usage.

Use `bb plugin rpc list --method provider-usage.v1.listResources --json` to find sources
and `bb plugin rpc inspect <plugin-id> provider-usage.v1.listResources --json`
to inspect their published contracts. RPC calls accept JSON through
`--input-file`. See the Plugin Guide for the contract API.

The display's aggregate is also available through its existing RPC. For example,
write a JSON input file containing
`{"force":false,"machineIds":null,"providerIds":["codex"],"maxAgeMs":60000}`,
then run `bb plugin rpc call bb--provider-usage getUsage --input-file <path> --json`.
Use `bb plugin rpc inspect bb--provider-usage getUsage --json` for its current
schema. SDK consumers call `sdk.plugins.callRpc` with the same plugin ID, method
and input. Each account includes `source` and nullable `observedAt`; window IDs
and nullable model-family scope are retained. This aggregate follows the same
selected-resource collection, deduplication and failure cache as the UI.

`bb settings usage --json` and `bb.sdk.system.usageLimits()` remain the
host-local provider-maintenance view; they do not aggregate shared pool accounts.

Codex, Claude Code, and ACP provider plugins explicitly implement the usage contract
for their own providers. Account Pooler implements it for shared accounts. The
contract is owned here and copied into each source; no additional adapter plugin,
provider-kit helper, or core runtime convention is required. Other providers must
explicitly implement the contract to appear in these displays.

OpenCode's host-local source reports OpenCode Go subscription limits when a Go
Console account or API key is configured on the selected machine. Its five-hour, weekly, and monthly
windows come from Go's usage API. Other providers used through OpenCode and Zen
pay-as-you-go spending are not included.

Known provider-issued account identities are deduplicated within the selected
location. Unknown identities are never merged by email. Structured plan and quota
window metadata give both displays consistent labels.

Provider Usage is enabled by default for newly registered installations. Existing
explicit enable/disable choices are preserved. Right-click the footer shortcut and
choose **Hide** to move it into **More**. Settings → Appearance → Sidebar footer
controls order and visibility for every footer action. The usage settings page
remains available. These preferences belong to BB, not the plugin.
