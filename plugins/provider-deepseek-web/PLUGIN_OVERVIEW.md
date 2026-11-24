# Use DeepSeek through its website

DeepSeek Web connects a BB thread to `chat.deepseek.com` in a dedicated tab on a connected desktop browser. It uses the model selected on the website. Choose **DeepSeek Web → Website current model**, open the thread's side-panel actions, connect a desktop browser, and sign in yourself if needed. The integration does not verify account access, subscription, quota, or model identity.

The website may request workspace file reads, directory listings, file writes, or shell commands. Review each requested action and its full contents in **Approve workspace actions** before approving writes or commands; these run with the local user's permissions. Denial, cancellation, or approval timeout does not run them.

Requires the Browser Automation plugin and a connected desktop browser. Login challenges and unrecognized pages stop the turn for manual attention. Website changes may interrupt this experimental integration; attachments and session forks are unsupported.
