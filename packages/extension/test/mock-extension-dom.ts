import type { CuePayload } from "../../agentcue/src/shared/types.ts";
import { STORAGE_SETTINGS_KEY } from "../src/protocol.ts";

class MockClassList {
  private set = new Set<string>();
  add(...tokens: string[]) {
    for (const t of tokens) if (t) this.set.add(t);
  }
  remove(...tokens: string[]) {
    for (const t of tokens) this.set.delete(t);
  }
  toggle(token: string, force?: boolean) {
    if (force === true) {
      this.set.add(token);
      return true;
    }
    if (force === false) {
      this.set.delete(token);
      return false;
    }
    if (this.set.has(token)) {
      this.set.delete(token);
      return false;
    }
    this.set.add(token);
    return true;
  }
  contains(token: string) {
    return this.set.has(token);
  }
  [Symbol.iterator]() {
    return this.set[Symbol.iterator]();
  }
}

type Listener = (evt: MockEvent) => void;

export interface MockEvent {
  type: string;
  target: unknown;
  bubbles: boolean;
  isTrusted: boolean;
  detail?: unknown;
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  clientX?: number;
  clientY?: number;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  stopImmediatePropagation: () => void;
  composedPath: () => unknown[];
}

export function makeEvent(
  type: string,
  opts: Partial<MockEvent> & { path?: unknown[] } = {}
): MockEvent {
  const evt: MockEvent = {
    type,
    target: opts.target ?? null,
    bubbles: opts.bubbles ?? false,
    isTrusted: opts.isTrusted ?? false,
    detail: opts.detail,
    key: opts.key,
    code: opts.code,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    defaultPrevented: false,
    preventDefault() {
      evt.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
    composedPath: () => opts.path ?? [evt.target],
  };
  return evt;
}

class MockNode {
  listeners = new Map<string, Set<Listener>>();
  parentElement: MockElement | null = null;
  children: MockElement[] = [];

  addEventListener(type: string, fn: Listener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }

  emitLocal(evt: MockEvent) {
    const set = this.listeners.get(evt.type);
    if (!set) return;
    for (const fn of [...set]) fn(evt);
  }
}

export class MockShadowRoot extends MockNode {
  mode: "open" | "closed";
  host: MockElement;
  private byId = new Map<string, MockElement>();
  private _innerHTML = "";

  constructor(host: MockElement, mode: "open" | "closed") {
    super();
    this.host = host;
    this.mode = mode;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html: string) {
    this._innerHTML = html;
    this.byId.clear();
    const regex = /<([a-z0-9-]+)[^>]*\bid="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const el = new MockElement(m[1], this.host.ownerDocument);
      el.id = m[2];
      this.byId.set(m[2], el);
    }
  }

  getElementById(id: string): MockElement | null {
    return this.byId.get(id) ?? null;
  }
}

export class MockElement extends MockNode {
  tagName: string;
  id = "";
  className = "";
  classList = new MockClassList();
  style: Record<string, string> = {};
  textContent = "";
  value = "";
  disabled = false;
  title = "";
  selectionStart = 0;
  offsetWidth = 100;
  attributes = new Map<string, string>();
  ownerDocument: MockDocument;
  shadowRoot: MockShadowRoot | null = null;
  private internalShadow: MockShadowRoot | null = null;
  [key: string]: unknown;

  constructor(tag: string, doc: MockDocument) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
  }

  get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const idAttr = this.id ? ` id="${this.id}"` : "";
    return `<${tag}${idAttr}>${this.textContent}</${tag}>`;
  }

  set innerHTML(_val: string) {}
  get innerHTML() {
    return this.textContent;
  }

  attachShadow(init: { mode: "open" | "closed" }): MockShadowRoot {
    const root = new MockShadowRoot(this, init.mode);
    this.internalShadow = root;
    this.shadowRoot = init.mode === "open" ? root : null;
    this.ownerDocument.lastCreatedShadow = root;
    return root;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(
      (c) => c !== this
    );
    this.parentElement = null;
  }

  setAttribute(name: string, val: string) {
    this.attributes.set(name, val);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  querySelectorAll(): MockElement[] {
    return [];
  }

  cloneNode(): MockElement {
    const clone = new MockElement(this.tagName, this.ownerDocument);
    clone.id = this.id;
    clone.textContent = this.textContent;
    return clone;
  }

  getBoundingClientRect() {
    return { left: 24, top: 48, right: 224, bottom: 96, width: 200, height: 48 };
  }

  focus() {}
  blur() {}

  dispatchEvent(evt: Event | MockEvent): boolean {
    const mock = evt as MockEvent;
    if (!mock.target) mock.target = this;
    this.emitLocal(mock);
    if (mock.bubbles) {
      this.ownerDocument.emitLocal(mock);
    }
    return !mock.defaultPrevented;
  }

  getInternalShadowForTest(): MockShadowRoot | null {
    return this.internalShadow;
  }
}

export class MockDocument extends MockNode {
  title = "Test Page";
  documentElement: MockElement;
  body: MockElement;
  defaultView: MockWindow | null = null;
  hitTarget: MockElement | null = null;
  lastCreatedShadow: MockShadowRoot | null = null;

  constructor() {
    super();
    this.documentElement = new MockElement("html", this);
    this.body = new MockElement("body", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag, this);
  }

  createTextNode(text: string): MockElement {
    const node = new MockElement("#text", this);
    node.textContent = text;
    return node;
  }

  elementFromPoint(): MockElement | null {
    return this.hitTarget;
  }

  querySelector(selector: string): MockElement | null {
    const targetTag = selector.toUpperCase();
    const walk = (node: MockElement): MockElement | null => {
      if (node.tagName === targetTag) return node;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this.documentElement);
  }

  querySelectorAll(selector: string): MockElement[] {
    const found = this.querySelector(selector);
    return found ? [found] : [];
  }

  dispatchEvent(evt: Event | MockEvent): boolean {
    this.emitLocal(evt as MockEvent);
    return true;
  }
}

export class MockWindow extends MockNode {
  location: { href: string };
  innerWidth = 1280;
  innerHeight = 800;
  __AGENTCUE_CONTENT_READY__?: boolean;

  constructor(href: string) {
    super();
    this.location = { href };
  }

  getComputedStyle() {
    return {
      getPropertyValue: (prop: string) => (prop === "padding" ? "12px" : ""),
    };
  }

  dispatchEvent(evt: Event | MockEvent): boolean {
    this.emitLocal(evt as MockEvent);
    return true;
  }
}

interface MockPort {
  name: string;
  msgListeners: Array<(msg: unknown) => void>;
  disconnectListeners: Array<() => void>;
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (fn: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
}

export async function createExtensionHarness(options: {
  tabUrl: string;
  autoMountLocalhost?: boolean;
}) {
  const doc = new MockDocument();
  const win = new MockWindow(options.tabUrl);
  doc.defaultView = win;

  const targetButton = doc.createElement("button");
  targetButton.id = "cta-btn";
  targetButton.textContent = "Upgrade";
  targetButton["__reactFiber$test"] = {
    type: function UpgradeButton() {},
    _debugSource: { fileName: "src/components/UpgradeButton.tsx", lineNumber: 27 },
    return: {
      type: function PricingCard() {},
      return: null,
    },
  };
  doc.body.appendChild(targetButton);
  doc.hitTarget = targetButton;

  const storageData: Record<string, unknown> = {
    [STORAGE_SETTINGS_KEY]: {
      bridgeOrigin: "http://localhost:4318",
      autoMountLocalhost: options.autoMountLocalhost ?? true,
    },
  };

  type RuntimeMsgListener = (
    msg: unknown,
    sender: { id?: string; tab?: { id?: number; url?: string } },
    sendResponse: (res?: unknown) => void
  ) => boolean | void;

  const bgRuntimeListeners: RuntimeMsgListener[] = [];
  const contentRuntimeListeners: RuntimeMsgListener[] = [];
  const actionClickListeners: Array<(tab: { id?: number; url?: string }) => void> = [];
  const storageListeners = new Set<
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
  >();
  const portConnectListeners: Array<(port: MockPort) => void> = [];

  let activeContentPort: MockPort | null = null;
  const injectedFiles: Array<{ file: string; world?: string }> = [];
  const postedCues: Array<{ url: string; payload: CuePayload }> = [];

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    chrome: (globalThis as Record<string, unknown>).chrome,
    fetch: globalThis.fetch,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  let registeringTarget: "bg" | "content" = "bg";

  const mockChrome = {
    runtime: {
      id: "agentcue-test-ext-id",
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: {
        addListener: (fn: RuntimeMsgListener) => {
          if (registeringTarget === "bg") {
            bgRuntimeListeners.push(fn);
          } else {
            contentRuntimeListeners.push(fn);
          }
        },
      },
      onConnect: {
        addListener: (fn: (port: MockPort) => void) => {
          portConnectListeners.push(fn);
        },
      },
      connect: ({ name }: { name?: string } = {}) => {
        const clientPort: MockPort = {
          name: name || "",
          msgListeners: [],
          disconnectListeners: [],
          postMessage: () => {},
          disconnect: () => {
            for (const fn of serverPort.disconnectListeners) fn();
          },
          onMessage: { addListener: (fn) => clientPort.msgListeners.push(fn) },
          onDisconnect: { addListener: (fn) => clientPort.disconnectListeners.push(fn) },
        };
        const serverPort: MockPort = {
          name: name || "",
          msgListeners: [],
          disconnectListeners: [],
          postMessage: (msg) => {
            for (const fn of clientPort.msgListeners) fn(msg);
          },
          disconnect: () => {
            for (const fn of serverPort.disconnectListeners) fn();
          },
          onMessage: { addListener: (fn) => serverPort.msgListeners.push(fn) },
          onDisconnect: { addListener: (fn) => serverPort.disconnectListeners.push(fn) },
        };
        activeContentPort = serverPort;
        for (const fn of portConnectListeners) fn(serverPort);
        return clientPort;
      },
      sendMessage: (
        msg: unknown,
        senderOverride?: { id?: string; tab?: { id?: number; url?: string } }
      ) =>
        new Promise((resolve) => {
          const sender = senderOverride ?? {
            id: "agentcue-test-ext-id",
            tab: { id: 1, url: options.tabUrl },
          };
          let responded = false;
          for (const listener of bgRuntimeListeners) {
            listener(msg, sender, (res) => {
              responded = true;
              resolve(res);
            });
          }
          if (!responded) {
            setTimeout(() => {
              if (!responded) resolve(undefined);
            }, 0);
          }
        }),
      openOptionsPage: async () => {},
    },
    tabs: {
      sendMessage: (_tabId: number, msg: unknown) =>
        new Promise((resolve) => {
          for (const listener of contentRuntimeListeners) {
            listener(msg, { id: "agentcue-test-ext-id" }, (res) => resolve(res));
          }
        }),
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      onClicked: {
        addListener: (fn: (tab: { id?: number; url?: string }) => void) => {
          actionClickListeners.push(fn);
        },
      },
    },
    scripting: {
      executeScript: async (inj: { files?: string[]; world?: string }) => {
        for (const file of inj.files || []) {
          injectedFiles.push({ file, world: inj.world });
          if (file === "content.js") {
            registeringTarget = "content";
            initContentBridge();
          } else if (file === "page.js") {
            initPageHintExtractor(doc as unknown as Document);
          }
        }
        return [];
      },
    },
    storage: {
      local: {
        get: async (key?: string) =>
          key ? { [key]: storageData[key] } : { ...storageData },
        set: async (items: Record<string, unknown>) => {
          Object.assign(storageData, items);
        },
      },
      onChanged: {
        addListener: (
          fn: (c: Record<string, { oldValue?: unknown; newValue?: unknown }>, a: string) => void
        ) => storageListeners.add(fn),
        removeListener: (
          fn: (c: Record<string, { oldValue?: unknown; newValue?: unknown }>, a: string) => void
        ) => storageListeners.delete(fn),
      },
    },
    contextMenus: {
      removeAll: (cb?: () => void) => cb?.(),
      create: () => {},
      update: () => {},
      onClicked: { addListener: () => {} },
    },
  };

  Object.assign(globalThis, {
    window: win,
    document: doc,
    chrome: mockChrome,
    requestAnimationFrame: (cb: () => void) => {
      cb();
      return 0;
    },
    Event: class MockEventCtor {
      type: string;
      bubbles: boolean;
      isTrusted = false;
      defaultPrevented = false;
      target: unknown = null;
      constructor(type: string, init?: { bubbles?: boolean }) {
        this.type = type;
        this.bubbles = Boolean(init?.bubbles);
      }
      preventDefault() {
        this.defaultPrevented = true;
      }
      stopPropagation() {}
      stopImmediatePropagation() {}
      composedPath() {
        return [this.target];
      }
    },
    CustomEvent: class MockCustomEventCtor {
      type: string;
      bubbles: boolean;
      detail: unknown;
      isTrusted = false;
      defaultPrevented = false;
      target: unknown = null;
      constructor(type: string, init?: { bubbles?: boolean; detail?: unknown }) {
        this.type = type;
        this.bubbles = Boolean(init?.bubbles);
        this.detail = init?.detail;
      }
      preventDefault() {
        this.defaultPrevented = true;
      }
      stopPropagation() {}
      stopImmediatePropagation() {}
      composedPath() {
        return [this.target];
      }
    },
    fetch: async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/cue")) {
        const body = JSON.parse(String(init?.body || "{}")) as CuePayload;
        postedCues.push({ url, payload: body });
        return new Response(
          JSON.stringify({ cueId: "cue-test-1", queuePosition: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/api/events")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => {
                try {
                  controller.close();
                } catch {
                  // ignore
                }
              });
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
      return new Response("{}", { status: 404 });
    },
  });

  const { initBackground } = await import("../src/background.ts");
  const { initContentBridge } = await import("../src/content.ts");
  const { initPageHintExtractor } = await import("../src/page.ts");

  registeringTarget = "bg";
  initBackground();

  return {
    win,
    doc,
    targetButton,
    mockChrome,
    postedCues,
    injectedFiles,
    getActivePort: () => activeContentPort,
    triggerContentLoad: () => {
      registeringTarget = "content";
      initContentBridge();
    },
    clickToolbarAction: async () => {
      for (const fn of actionClickListeners) {
        fn({ id: 1, url: options.tabUrl });
      }
      await new Promise((r) => setTimeout(r, 15));
    },
    cleanup: () => {
      activeContentPort?.disconnect();
      Object.assign(globalThis, prevGlobals);
    },
  };
}
