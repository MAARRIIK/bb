const pageSetup = String.raw`
const pages = await browser.listPages();
if (pages.length !== 1) throw new Error("Attach a dedicated DeepSeek browser tab before using this provider.");
const page = await browser.getPage(pages[0].id);
const read = () => page.evaluate(() => {
  const url = new URL(location.href);
  const safeUrl = url.origin + url.pathname;
  const result = { status: "layout_changed", hint: "Attach a dedicated tab at https://chat.deepseek.com and inspect it again.", url: safeUrl };
  if (url.origin !== "https://chat.deepseek.com") return result;
  const visible = element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const enabled = element => !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("ds-button--disabled");
  const controls = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
  const label = element => [element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("data-testid")].find(value => value && value.trim())?.trim() || "";
  const iconSendSelector = '[role="button"].ds-button--primary.ds-button--circle:has(svg path[d^="M8.3125 0.980206"])';
  const iconStopSelector = '[role="button"].ds-button--primary.ds-button--circle:has(svg path[d^="M2 4.88C2 3.68009"])';
  const stop = controls.find(element => /^(stop( generating| generation| response)?|停止(生成|响应|回答)?|остановить( генерацию)?|stop-generation|stop-button)$/i.test(label(element))) || controls.find(element => element.matches(iconStopSelector));
  const send = controls.find(element => /^(send( message)?|发送(消息)?|отправить( сообщение)?|send-button|send-message-button)$/i.test(label(element))) || controls.find(element => element.matches(iconSendSelector));
  const verification = [...document.querySelectorAll('iframe[src*="captcha"], iframe[src*="challenge"], [id*="captcha"], [class*="captcha"], [role="dialog"], h1, h2')].filter(visible).some(element => element.matches('iframe, [id*="captcha"], [class*="captcha"]') || /verify (you are|that you)|security verification|complete.*verification|人机验证|安全验证|подтвердите.*человек/i.test(element.textContent || ""));
  if (verification) return { ...result, status: "verification_required", hint: "Complete the verification manually in the dedicated DeepSeek tab. Nothing was resubmitted." };
  const login = /\/(sign_in|login)(\/|$)/.test(url.pathname) || [...document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"]')].some(visible);
  if (login) return { ...result, status: "login_required", hint: "Sign in manually in the dedicated DeepSeek tab, then inspect it again." };
  const alert = [...document.querySelectorAll('[role="alert"], .ds-toast, .ds-notification, [data-testid="error-message"]')].filter(visible).map(element => element.textContent || "").join(" ");
  if (/rate limit|too many requests|server busy|try again later|请求频繁|服务器繁忙|稍后再试|лимит|слишком много запросов/i.test(alert)) return { ...result, hint: "DeepSeek reports a limit or busy service. Wait and inspect the existing conversation; do not resubmit automatically." };
  const composerSelectors = ['textarea#chat-input', 'textarea[placeholder*="DeepSeek"]', '[contenteditable="true"][role="textbox"]'];
  let composerSelector = null;
  let composer = null;
  for (const selector of composerSelectors) {
    const candidates = [...document.querySelectorAll(selector)].filter(visible);
    if (candidates.length === 1) {
      composerSelector = selector;
      composer = candidates[0];
      break;
    }
  }
  if (!composer) {
    const loginButton = controls.some(element => /^(log in|sign in|登录|登入)$/i.test((label(element) || element.textContent || "").trim()));
    return { ...result, ...(loginButton ? { status: "login_required", hint: "Sign in manually in the dedicated DeepSeek tab." } : { hint: "The DeepSeek composer is missing or ambiguous. Inspect the tab; no message was sent." }) };
  }
  const mainNodes = [...document.querySelectorAll('.ds-assistant-message-main-content')];
  const fallbackNodes = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-role="assistant"]')].filter(element => !element.parentElement?.closest('[data-message-author-role="assistant"], [data-role="assistant"]'));
  const replies = (mainNodes.length ? mainNodes : fallbackNodes).map(element => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('.ds-think-content, [data-testid="thinking"], [data-role="thinking"], button, [role="button"]').forEach(child => child.remove());
    return { text: (clone.innerText || clone.textContent || "").trim(), id: element.closest("[data-virtual-list-item-key]")?.getAttribute("data-virtual-list-item-key") ?? null };
  });
  const busy = Boolean(stop) || [...document.querySelectorAll('[aria-busy="true"], [data-testid="generating"]')].some(visible);
  const draft = "value" in composer ? composer.value : composer.textContent || "";
  let sendSelector = null;
  if (send) {
    for (const attribute of ["data-testid", "aria-label", "title"]) {
      const value = send.getAttribute(attribute);
      if (value) {
        const selector = 'button[' + attribute + '=' + JSON.stringify(value) + '], [role="button"][' + attribute + '=' + JSON.stringify(value) + ']';
        if ([...document.querySelectorAll(selector)].filter(visible).length === 1) {
          sendSelector = selector;
          break;
        }
      }
    }
  }
  if (send && !sendSelector && send.matches(iconSendSelector) && controls.filter(element => element.matches(iconSendSelector)).length === 1) sendSelector = iconSendSelector;
  return { status: busy ? "generating" : "ready", hint: busy ? "DeepSeek is still generating. Wait in the existing conversation." : "The dedicated DeepSeek tab is ready. The website's current model will be used.", url: safeUrl, composerSelector, editable: enabled(composer) && !composer.readOnly, draft, replies, sendSelector, sendEnabled: Boolean(send && enabled(send)) };
});
`;

export function buildInspectScript(): string {
  return `(async () => {${pageSetup}
const state = await read();
return JSON.stringify({ status: state.status, hint: state.hint, url: state.url });
})()`;
}

export function buildExchangeScript(
  text: string,
  expectedConversationUrl: string | null = null,
): string {
  return `(async () => {${pageSetup}
const text = ${JSON.stringify(text)};
const expectedConversationUrl = ${JSON.stringify(expectedConversationUrl)};
const blocked = reason => JSON.stringify({ status: "blocked", reason });
let submitted = false;
try {
  const deadline = Date.now() + 60000;
  const before = await read();
  if (before.status !== "ready") return blocked(before.hint);
  if (expectedConversationUrl !== null && before.url !== expectedConversationUrl) return blocked("The dedicated tab no longer shows the conversation bound to this BB thread. Restore the original chat manually; no message was sent.");
  if (!before.editable || !before.composerSelector) return blocked("The DeepSeek composer is unavailable. No message was sent.");
  if (before.draft.trim()) return blocked("The dedicated DeepSeek tab contains an unsent draft. Resolve it manually; no message was sent.");
  const baseline = before.replies.length;
  const baselineIds = new Set(before.replies.map(reply => reply.id).filter(id => id !== null));
  let conversationUrl = before.url;
  const initialPath = new URL(before.url).pathname;
  let mayCreateConversation = initialPath === "/" || initialPath === "/a/chat" || initialPath === "/a/chat/";
  const inserted = await page.evaluate((selector, value) => {
    const nodes = [...document.querySelectorAll(selector)].filter(element => element.getBoundingClientRect().width > 0);
    const input = nodes.length === 1 ? nodes[0] : null;
    if (!(input instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) return false;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return input.value === value;
  }, before.composerSelector, text);
  if (!inserted) return blocked("The DeepSeek composer did not accept the complete draft. No Send control was clicked.");
  const prepared = await read();
  if (prepared.url !== conversationUrl) return blocked("The dedicated tab changed conversations while preparing the draft. Inspect it manually; no message was sent.");
  if (prepared.status !== "ready" || prepared.draft !== text || !prepared.sendSelector || !prepared.sendEnabled) return blocked("DeepSeek did not expose a unique enabled Send control for the prepared draft. Inspect it manually; no message was sent.");
  submitted = true;
  await page.click(prepared.sendSelector);
  let started = false;
  while (Date.now() < deadline) {
    const current = await read();
    if (current.status !== "ready" && current.status !== "generating") return blocked(current.hint + " Inspect the existing conversation before another attempt.");
    if (current.url !== conversationUrl) {
      const newPath = new URL(current.url).pathname;
      if (mayCreateConversation && current.status === "generating" && new RegExp("^/a/chat/s/[^/]+/?$").test(newPath)) {
        conversationUrl = current.url;
        mayCreateConversation = false;
      } else {
        return blocked("The dedicated tab changed conversations during the exchange. Replies from another conversation were not accepted; inspect the original conversation and do not resubmit automatically.");
      }
    }
    const candidate = current.replies.at(-1);
    const isNewReply = candidate && (candidate.id === null ? current.replies.length > baseline : !baselineIds.has(candidate.id));
    if (current.status === "generating" || (isNewReply && current.draft.trim() === "")) started = true;
    if (started && current.status === "ready" && current.sendSelector && current.editable && current.draft.trim() === "" && isNewReply) {
      const response = candidate.text;
      if (!response || response.length > 250000) return blocked("DeepSeek finished without a bounded final answer. Inspect the existing conversation; do not resend automatically.");
      let reply;
      try { reply = JSON.parse(response); }
      catch { return blocked("DeepSeek finished, but the final answer is not a complete JSON object. Inspect the existing conversation; do not resend automatically."); }
      if (!reply || typeof reply !== "object" || Array.isArray(reply)) return blocked("DeepSeek finished with an invalid reply shape. Inspect the existing conversation; do not resend automatically.");
      return JSON.stringify({ status: "reply", reply, conversationUrl });
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return blocked("Timed out waiting for a new DeepSeek reply and the restored Send control. The message may have been submitted. Inspect the existing conversation; do not resend automatically.");
} catch {
  return blocked(submitted ? "Browser control failed after submission may have begun. Inspect the existing DeepSeek conversation; do not resend automatically." : "Browser control failed while preparing the draft. Inspect the dedicated DeepSeek tab before retrying.");
}
})()`;
}
