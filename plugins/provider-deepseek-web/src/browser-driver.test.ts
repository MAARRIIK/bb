import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildExchangeScript, buildInspectScript } from "./browser-driver.js";

function fixture(
  options: {
    url?: string;
    body?: string;
    answer?: string;
    showGeneration?: boolean;
    iconControls?: boolean;
    instantReply?: boolean;
    virtualize?: boolean;
    chatUrlAtGenerationStart?: string;
    chatUrlAfterGeneration?: string;
  } = {},
) {
  const dom = new JSDOM(
    options.body ??
      '<textarea id="chat-input"></textarea><button aria-label="Send" disabled>Send</button>',
    {
      url: options.url ?? "https://chat.deepseek.com/a/chat/s/test",
      runScripts: "outside-only",
    },
  );
  const context = dom.getInternalVMContext();
  runInContext(
    "HTMLElement.prototype.getBoundingClientRect = function () { return {width:100,height:40}; }",
    context,
  );
  const document = dom.window.document;
  const submissions: string[] = [];
  document.addEventListener("input", () => {
    const send = document.querySelector("button");
    if (send instanceof dom.window.HTMLButtonElement) {
      send.disabled = false;
      send.classList.remove("ds-button--disabled");
    }
  });
  let phase: "idle" | "generating" | "finished" = "idle";
  const page = {
    async evaluate(
      operation: (...args: never[]) => unknown,
      ...args: unknown[]
    ) {
      const result = runInContext(
        `(${operation.toString()})(...${JSON.stringify(args)})`,
        context,
      );
      if (phase === "generating") {
        document.querySelector("[data-fixture-stop]")?.remove();
        const reply = document.createElement("div");
        reply.className = "ds-message";
        if (options.virtualize) {
          document.querySelector("[data-virtual-list-item-key]")?.remove();
          reply.setAttribute("data-virtual-list-item-key", "4");
        }
        const thinking = document.createElement("div");
        thinking.className = "ds-think-content";
        thinking.textContent = "This must never be parsed as the answer.";
        const final = document.createElement("div");
        final.className = "ds-assistant-message-main-content";
        final.textContent = options.answer ?? '{"kind":"final","text":"ready"}';
        reply.append(thinking, final);
        document.body.append(reply);
        if (options.chatUrlAfterGeneration)
          dom.reconfigure({ url: options.chatUrlAfterGeneration });
        phase = "finished";
      }
      return result;
    },
    async fill(selector: string, value: string) {
      if (value.includes("\n"))
        throw new Error("Typing a newline submits this website's composer");
      const input = document.querySelector(selector);
      if (!(input instanceof dom.window.HTMLTextAreaElement))
        throw new Error("Missing textarea");
      input.value = value;
      const send = document.querySelector("button");
      if (send instanceof dom.window.HTMLButtonElement) {
        send.disabled = false;
        send.classList.remove("ds-button--disabled");
      }
    },
    async click(selector: string) {
      if (!document.querySelector(selector)) throw new Error("Missing control");
      const input = document.querySelector("textarea");
      if (!(input instanceof dom.window.HTMLTextAreaElement))
        throw new Error("Missing textarea");
      submissions.push(input.value);
      input.value = "";
      const send = document.querySelector("button");
      if (send instanceof dom.window.HTMLButtonElement) send.disabled = true;
      if (options.showGeneration !== false || options.instantReply) {
        const stop = document.createElement("button");
        stop.setAttribute("data-fixture-stop", "");
        if (options.iconControls) {
          stop.setAttribute("role", "button");
          stop.className = "ds-button--primary ds-button--circle";
          stop.innerHTML = '<svg><path d="M2 4.88C2 3.68009"></path></svg>';
        } else stop.setAttribute("aria-label", "Stop generating");
        if (!options.instantReply) document.body.append(stop);
        if (options.chatUrlAtGenerationStart)
          dom.reconfigure({ url: options.chatUrlAtGenerationStart });
        phase = "generating";
      }
    },
  };
  let tick = 0;
  let remainingDraft: string | null = null;
  context.browser = {
    async listPages() {
      return [{ id: "dedicated" }];
    },
    async getPage() {
      return page;
    },
  };
  context.setTimeout = (callback: () => void) => {
    callback();
  };
  context.Date = class extends Date {
    static override now() {
      tick += 10_000;
      return tick;
    }
  };
  return {
    get draft() {
      return remainingDraft;
    },
    submissions,
    async run(script: string): Promise<unknown> {
      try {
        return JSON.parse(await runInContext(script, context));
      } finally {
        remainingDraft = document.querySelector("textarea")?.value ?? null;
        dom.window.close();
      }
    },
  };
}

describe("DeepSeek browser UI exchange", () => {
  it("recognizes the observed unlabelled website send and stop icons with disabled state", async () => {
    const page = fixture({
      url: "https://chat.deepseek.com/",
      body: '<textarea placeholder="Сообщение для DeepSeek"></textarea><button role="button" class="ds-button--primary ds-button--circle ds-button--disabled"><svg><path d="M8.3125 0.980206"></path></svg></button>',
      iconControls: true,
      chatUrlAtGenerationStart: "https://chat.deepseek.com/a/chat/s/created",
    });
    expect(await page.run(buildExchangeScript("test icon controls"))).toEqual({
      status: "reply",
      reply: { kind: "final", text: "ready" },
      conversationUrl: "https://chat.deepseek.com/a/chat/s/created",
    });
    expect(page.submissions).toEqual(["test icon controls"]);
  });
  it("submits literal text once and parses only the final assistant after generation stops", async () => {
    const browser = fixture();
    const text = 'literal ` ${globalThis.injected=true} "\n</script>';
    expect(await browser.run(buildExchangeScript(text))).toEqual({
      status: "reply",
      reply: { kind: "final", text: "ready" },
      conversationUrl: "https://chat.deepseek.com/a/chat/s/test",
    });
    expect(browser.submissions).toEqual([text]);
  });

  it("matches virtualized replies by observed message keys even when the visible count stays constant", async () => {
    const browser = fixture({
      virtualize: true,
      body: '<div data-virtual-list-item-key="1"><div class="ds-assistant-message-main-content">old one</div></div><div data-virtual-list-item-key="2"><div class="ds-assistant-message-main-content">old two</div></div><div data-virtual-list-item-key="3"><div class="ds-assistant-message-main-content">{&quot;kind&quot;:&quot;final&quot;,&quot;text&quot;:&quot;ready&quot;}</div></div><textarea id="chat-input"></textarea><button aria-label="Send" disabled>Send</button>',
    });
    expect(
      await browser.run(buildExchangeScript("same final text")),
    ).toMatchObject({
      status: "reply",
      reply: { kind: "final", text: "ready" },
    });
    expect(browser.submissions).toEqual(["same final text"]);
  });

  it("accepts a new completed reply when generation finishes between polls and the Send control returns", async () => {
    const browser = fixture({ instantReply: true });
    expect(await browser.run(buildExchangeScript("fast answer"))).toMatchObject(
      { status: "reply", reply: { kind: "final", text: "ready" } },
    );
    expect(browser.submissions).toEqual(["fast answer"]);
  });

  it("inserts a multiline protocol draft atomically without typing submission keys", async () => {
    const browser = fixture();
    const text =
      'Protocol first paragraph\n\nInstructions and \"quoted\" text\nUser request';
    expect(await browser.run(buildExchangeScript(text))).toMatchObject({
      status: "reply",
    });
    expect(browser.submissions).toEqual([text]);
  });

  it("refuses another conversation before filling even when the page is otherwise ready", async () => {
    const browser = fixture();
    expect(
      await browser.run(
        buildExchangeScript(
          "must not send",
          "https://chat.deepseek.com/a/chat/s/original",
        ),
      ),
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("bound to this BB thread"),
    });
    expect(browser.submissions).toEqual([]);
    expect(browser.draft).toBe("");
  });

  it("rejects valid action JSON from a different same-origin conversation after generation", async () => {
    const browser = fixture({
      chatUrlAfterGeneration: "https://chat.deepseek.com/a/chat/s/other-chat",
      answer:
        '{"kind":"actions","text":"Wrong conversation","actions":[{"id":"wrong","kind":"command","command":"echo wrong"}]}',
    });
    expect(
      await browser.run(buildExchangeScript("original request")),
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("changed conversations"),
    });
    expect(browser.submissions).toEqual(["original request"]);
  });

  it.each(["https://chat.deepseek.com/", "https://chat.deepseek.com/a/chat"])(
    "allows one new conversation transition from %s while its generation is observed",
    async (url) => {
      const browser = fixture({
        url,
        chatUrlAtGenerationStart: "https://chat.deepseek.com/a/chat/s/new-chat",
      });
      expect(
        await browser.run(buildExchangeScript("create conversation")),
      ).toEqual({
        status: "reply",
        reply: { kind: "final", text: "ready" },
        conversationUrl: "https://chat.deepseek.com/a/chat/s/new-chat",
      });
      expect(browser.submissions).toEqual(["create conversation"]);
    },
  );

  it("does not allow a second conversation transition after creating a chat", async () => {
    const browser = fixture({
      url: "https://chat.deepseek.com/",
      chatUrlAtGenerationStart:
        "https://chat.deepseek.com/a/chat/s/created-chat",
      chatUrlAfterGeneration: "https://chat.deepseek.com/a/chat/s/other-chat",
    });
    expect(
      await browser.run(buildExchangeScript("create conversation")),
    ).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("changed conversations"),
    });
    expect(browser.submissions).toEqual(["create conversation"]);
  });

  it.each([
    { url: "https://example.com/", status: "layout_changed" },
    { url: "https://chat.deepseek.com/sign_in", status: "login_required" },
    { body: "<h1>Security verification</h1>", status: "verification_required" },
    {
      body: '<textarea id="chat-input"></textarea><button aria-label="Stop generating">Stop</button>',
      status: "generating",
    },
  ])(
    "reports $status without submitting or navigating",
    async ({ status, ...options }) => {
      const browser = fixture(options);
      expect(await browser.run(buildInspectScript())).toMatchObject({ status });
      expect(browser.submissions).toEqual([]);
    },
  );

  it("preserves an existing unsent draft", async () => {
    const browser = fixture({
      body: '<textarea id="chat-input">my draft</textarea><button aria-label="Send">Send</button>',
    });
    expect(await browser.run(buildExchangeScript("next"))).toMatchObject({
      status: "blocked",
    });
    expect(browser.submissions).toEqual([]);
    expect(browser.draft).toBe("my draft");
  });

  it("does not resubmit after an unobserved generation start", async () => {
    const browser = fixture({ showGeneration: false });
    expect(await browser.run(buildExchangeScript("next"))).toMatchObject({
      status: "blocked",
    });
    expect(browser.submissions).toEqual(["next"]);
  });

  it("blocks a completed malformed answer without another message", async () => {
    const browser = fixture({ answer: '{"kind":"final","text":' });
    expect(await browser.run(buildExchangeScript("next"))).toMatchObject({
      status: "blocked",
    });
    expect(browser.submissions).toEqual(["next"]);
  });
});
