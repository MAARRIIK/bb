# DeepSeek Web (experimental)

DeepSeek Web runs a BB coding thread through `https://chat.deepseek.com/`, using the model currently selected on the website. It uses your manually signed-in browser account, without an API key. BB does not verify account access, a subscription, remaining quota, or the identity of the website model. This is an experimental browser integration; changes to the website can stop it.

## Connect a thread

1. Select **DeepSeek Web → Website current model** for an existing BB thread.
2. Open that thread's side-panel actions and choose **DeepSeek Web**.
3. Select a connected desktop browser and click **Open browser and connect**. This creates and reveals a dedicated DeepSeek chat tab for this BB thread.
4. Complete account sign-in yourself in that browser. If the browser requires manual control, take control, finish signing in, then click **Reconnect browser**. It reacquires the same dedicated tab and conversation. Use **Refresh status** to inspect the page again. A connected tab or a ready-looking page does not confirm authentication.
5. Send a text request in the BB thread. The selected website model receives the instructions and can request supported workspace actions.

The setup is bound to a thread, rather than a global provider settings page, and depends on the built-in Browser Automation plugin, which is not installed automatically. In a source checkout, build with Turbo and install both plugins:

```sh
bb plugin install builtin:browser-automation --yes
bb plugin install ./plugins/provider-deepseek-web --yes
```

**Release browser connection** removes that thread's server binding. It is not a website account sign-out. The browser account remains managed by the user.

After manually taking browser control, use **Reconnect browser**, rather than releasing the connection. A failed lease can leave the bridge stopped; reconnect the same tab to resume. Reconnect remains available after an inspection error and does not create a replacement chat. The desktop selection stays locked while a binding exists. The equivalent CLI action is `connect` with that same desktop instance ID.

The bridge can resume after its own release or restart using the same provider ID, but only from an existing server binding to the same dedicated tab and chat. After a successful website reply, the binding persists the conversation URL; the browser driver refuses to fill a different chat. If the desktop restarts and its generation changes, explicitly release the stale binding and connect again. Never silently create a replacement chat. This bridge recovery does not restore a binding explicitly removed with **Release browser connection**.

Login prompts, CAPTCHA, verification challenges, uncertain replies, and an unrecognized page layout stop the turn with a reason. Complete any required interaction yourself. Refresh the status and send a new request when ready; BB does not bypass verification or automatically resubmit an uncertain request.

## Workspace actions

The protocol supports reading a relative workspace file, listing a relative directory, writing complete file contents, and running a shell command. Website responses are validated before use. Each response may request at most eight actions; a turn permits at most 20 exchanges. Repeated action IDs are rejected instead of replayed. Tool output is returned to the model as untrusted data. Continuation messages have a shared 50,000-character JSON budget; shortened outputs are marked `truncated` and retain each action ID and exit code. Original BB tool receipts remain complete within their own bounds.

Writes and commands require an explicit decision in **Approve workspace actions**. The approval form usually lasts 10 minutes; timeout, **Deny**, or cancellation never approves execution. Command text is displayed in full. The full contents of each file are available in the expandable file contents section before approval. Commands execute with the local user's permissions, without an additional sandbox. Review each requested command and file before approving it.

An in-progress operation is reported immediately when another browser control is requested; resolve pending approval or stop the turn first. Website exchanges wait up to 60 seconds and never automatically resend after timeout.

The bridge emits actual website replies and workspace tool results into the thread. It does not invent token counts, authentication success, model identities, or execution receipts. Continuation tool results share a serialized JSON budget of 50,000 characters; shortened results are marked `truncated` while retaining action IDs and exit codes. Native BB tool receipts keep their existing bounds. Attachments and session forks are unsupported. Existing website context is never silently replaced with a fresh conversation.

## Programmatic surface

The CLI uses the current BB thread by default. Pass `--thread <thread-id>` to select it explicitly. All commands return JSON:

```sh
bb deepseek-web desktops --thread thr_example
bb deepseek-web connect --thread thr_example --desktop desktop_instance_id
bb deepseek-web status --thread thr_example
bb deepseek-web disconnect --thread thr_example
```

The execution commands are `bb deepseek-web exchange --thread <id> --turn <uuid> --text <text>` and `bb deepseek-web execute --thread <id> --turn <uuid> --actions '<JSON array>' [--request <uuid>]`. `execute` starts an async job and immediately returns its request ID; BB generates an ID unless `--request` is supplied. Read its state and terminal receipts with `bb deepseek-web execution-status --thread <id> --request <uuid>`, or cancel with `bb deepseek-web execution-cancel --thread <id> --request <uuid>`. Writes and commands still use the server-side user approval. The request ID and input are immutable: reusing an ID with changed input fails, and cancelling before start creates a tombstone. Up to 100 records are retained for one hour; terminal records may be evicted. After plugin restart, an old request may be unknown; its journal remains uncertain and BB refuses to resume or re-execute it automatically.

The blocking `execute` RPC remains available for quick calls with a 75-second limit. Prefer the async jobs for writes and commands that may wait longer for approval. The native execute tool starts, polls, and cancels async jobs. Async RPC methods `executionStart`, `executionStatus`, and `executionCancel` return `running`, `completed` with results, `failed` with an error, or `cancelled`.

The typed RPC contract lives in `src/contracts.ts`. `desktops`, `connect`, `status`, and `disconnect` take the BB `threadId`; `connect` also takes the chosen `instanceId`. `exchange`, `execute`, and `executionStart` take validated turn keys and actions; `executionStatus` and `executionCancel` take the `threadId` and request UUID. The same approvals apply when actions are initiated programmatically. If release cannot reach an old host, cleanup may need to be confirmed before release can finish; do not force-forget that binding.

Status reads do not reserve the workspace-action lock. While another operation
is active, a status reply can contain the existing binding with no inspection;
it does not claim that the website is ready.
