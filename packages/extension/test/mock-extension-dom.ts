import type { CuePayload } from "../../agentcue/src/shared/types.ts";
import { STORAGE_SETTINGS_KEY } from "../src/protocol.ts";

class MockClassList {
  private set = new Set<string>();
  add(...tokens: string[]) { for (const t of tokens) if (t) this.set.add(t); }
  remove(...tokens: string[]) { for (const t of tokens) this.set.delete(t); }
  toggle(token: string, force?: boolean) {
    if (force !== undefined) {
      force ? this.set.add(token) : this.set.delete(token);
      return force;
    }
    const next = !this.set.has(token);
    next ? this.set.add(token) : this.set.delete(token);
    return next;
  }
  contains(token: string) { return this.set.has(token); }
  [Symbol.iterator]() { return this.set[Symbol.iterator](); }
}

type Listener = (evt: MockEvent) => void;

export interface MockEvent {
  type: string; target: unknown; bubbles: boolean; isTrusted: boolean;
  detail?: unknown; key?: string; code?: string;
  metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean;
  clientX?: number; clientY?: number; defaultPrevented: boolean;
  preventDefault: () => void; stopPropagation: () => void; stopImmediatePropagation: () => void;
  composedPath: () => unknown[];
}

export function makeEvent(
  type: string,
  opts: Partial<MockEvent> & { path?: unknown[] } = {}
): MockEvent {
  const evt: MockEvent = {
    type, target: opts.target ?? null, bubbles: opts.bubbles ?? false, isTrusted: opts.isTrusted ?? false,
    detail: opts.detail, key: opts.key, code: opts.code,
    metaKey: opts.metaKey ?? false, ctrlKey: opts.ctrlKey ?? false, shiftKey: opts.shiftKey ?? false, altKey: opts.altKey ?? false,
    clientX: opts.clientX ?? 0, clientY: opts.clientY ?? 0, defaultPrevented: false,
    preventDefault() { evt.defaultPrevented = true; },
    stopPropagation() {}, stopImmediatePropagation() {},
    composedPath: () => opts.path ?? [evt.target],
  };
  return evt;
}

class MockNode {
  listeners = new Map<string, Set<Listener>>();
  parentElement: MockElement | null = null;
  children: MockElement[] = [];

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  emitLocal(evt: MockEvent) {
    for (const fn of [...(this.listeners.get(evt.type) ?? [])]) fn(evt);
  }
}

export class MockShadowRoot extends MockNode {
  mode: "open" | "closed";
  host: MockElement;
  private byId = new Map<string, MockElement>();
  private _innerHTML = "";

  constructor(host: MockElement, mode: "open" | "closed") {
    super(); this.host = host; this.mode = mode;
  }
  get innerHTML() { return this._innerHTML; }
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
  getElementById(id: string): MockElement | null { return this.byId.get(id) ?? null; }
}

export class MockElement extends MockNode {
  tagName: string; id = ""; className = ""; classList = new MockClassList();
  style: Record<string, string> = {}; textContent = ""; value = "";
  disabled = false; title = ""; selectionStart = 0; offsetWidth = 100;
  attributes = new Map<string, string>(); ownerDocument: MockDocument;
  shadowRoot: MockShadowRoot | null = null;
  private internalShadow: MockShadowRoot | null = null;
  [key: string]: unknown;

  constructor(tag: string, doc: MockDocument) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc;
  }
  get outerHTML(): string { return `<${this.tagName.toLowerCase()}${this.id ? ` id="${this.id}"` : ""}>${this.textContent}</${this.tagName.toLowerCase()}>`; }
  set innerHTML(_val: string) {}
  get innerHTML() { return this.textContent; }
  attachShadow(init: { mode: "open" | "closed" }): MockShadowRoot {
    const root = new MockShadowRoot(this, init.mode);
    this.internalShadow = root; this.shadowRoot = init.mode === "open" ? root : null;
    this.ownerDocument.lastCreatedShadow = root; return root;
  }
  appendChild(child: MockElement): MockElement { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  setAttribute(name: string, val: string) { this.attributes.set(name, val); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  querySelectorAll(): MockElement[] { return []; }
  cloneNode(): MockElement {
    const clone = new MockElement(this.tagName, this.ownerDocument);
    clone.id = this.id; clone.textContent = this.textContent;
    return clone;
  }
  getBoundingClientRect() { return { left: 24, top: 48, right: 224, bottom: 96, width: 200, height: 48 }; }
  focus() {}
  blur() {}
  dispatchEvent(evt: Event | MockEvent): boolean {
    const mock = evt as MockEvent;
    if (!mock.target) mock.target = this;
    this.emitLocal(mock);
    if (mock.bubbles) this.ownerDocument.emitLocal(mock);
    return !mock.defaultPrevented;
  }
  getInternalShadowForTest(): MockShadowRoot | null { return this.internalShadow; }
}

export class MockDocument extends MockNode {
  title = "Test Page"; documentElement: MockElement; body: MockElement;
  defaultView: MockWindow | null = null; hitTarget: MockElement | null = null;
  lastCreatedShadow: MockShadowRoot | null = null;
  constructor() {
    super();
    this.documentElement = new MockElement("html", this);
    this.body = new MockElement("body", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): MockElement { return new MockElement(tag, this); }
  createTextNode(text: string): MockElement {
    const node = new MockElement("#text", this);
    node.textContent = text;
    return node;
  }
  elementFromPoint(): MockElement | null { return this.hitTarget; }
  querySelector(selector: string): MockElement | null {
    const targetTag = selector.toUpperCase();
    const walk = (node: MockElement): MockElement | null => {
      if (node.tagName === targetTag) return node;
      for (const child of node.children) { const found = walk(child); if (found) return found; }
      return null;
    };
    return walk(this.documentElement);
  }
  querySelectorAll(selector: string): MockElement[] {
    const attrMatch = selector.match(/^([a-z0-9-]+)\[([a-z0-9-]+)\]$/i);
    const targetTag = (attrMatch ? attrMatch[1] : selector).toUpperCase();
    const requiredAttr = attrMatch ? attrMatch[2] : null;
    const results: MockElement[] = [];
    const walk = (node: MockElement) => {
      if (node.tagName === targetTag && (!requiredAttr || node.hasAttribute(requiredAttr))) results.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this.documentElement);
    return results;
  }
  dispatchEvent(evt: Event | MockEvent): boolean { this.emitLocal(evt as MockEvent); return true; }
}

export class MockWindow extends MockNode {
  location: { href: string };
  innerWidth = 1280;
  innerHeight = 800;
  __AGENTCUE_CONTENT_READY__?: boolean;
  constructor(href: string) { super(); this.location = { href }; }
  getComputedStyle() {
    return { getPropertyValue: (prop: string) => (prop === "padding" ? "12px" : "") };
  }
  dispatchEvent(evt: Event | MockEvent): boolean { this.emitLocal(evt as MockEvent); return true; }
}

interface MockPort {
  name: string; sender?: { id?: string; tab?: { id?: number; url?: string } }; disconnected?: boolean;
  msgListeners: Array<(msg: unknown) => void>; disconnectListeners: Array<() => void>;
  postMessage: (msg: unknown) => void; disconnect: () => void;
  onMessage: { addListener: (fn: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
}

export async function createExtensionHarness(options: { tabUrl: string; bridgeOnline?: boolean }) {
  const [{ initBackground }, { initContentBridge }, { initPageHintExtractor }] = await Promise.all([
    import("../src/background.ts"),
    import("../src/content.ts"),
    import("../src/page.ts"),
  ]);

  const doc = new MockDocument();
  const win = new MockWindow(options.tabUrl);
  doc.defaultView = win;
  let bridgeOnline = options.bridgeOnline ?? true;

  const targetButton = doc.createElement("button");
  targetButton.id = "cta-btn";
  targetButton.textContent = "Upgrade";
  targetButton["__reactFiber$test"] = {
    type: function UpgradeButton() {},
    _debugSource: { fileName: "src/components/UpgradeButton.tsx", lineNumber: 27 },
    return: { type: function PricingCard() {}, return: null },
  };
  doc.body.appendChild(targetButton);
  doc.hitTarget = targetButton;

  const storageData: Record<string, unknown> = {
    [STORAGE_SETTINGS_KEY]: { bridgeOrigin: "http://localhost:4318", enabled: true, showFloatingBar: true },
  };

  type RuntimeMsgListener = (
    msg: unknown,
    sender: { id?: string; tab?: { id?: number; url?: string } },
    sendResponse: (res?: unknown) => void
  ) => boolean | void;

  const bgRuntimeListeners: RuntimeMsgListener[] = [];
  const contentRuntimeListeners: RuntimeMsgListener[] = [];
  const commandListeners: Array<(command: string, tab?: { id?: number; url?: string }) => void> = [];
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: { status?: string }) => void> = [];
  const storageListeners = new Set<
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void
  >();
  const portConnectListeners: Array<(port: MockPort) => void> = [];

  let activeContentPort: MockPort | null = null;
  const injectedFiles: Array<{ file: string; world?: string }> = [];
  const postedCues: Array<{ url: string; headers?: HeadersInit; payload: CuePayload }> = [];
  const stateRequests: Array<{ url: string; headers?: HeadersInit }> = [];
  const iconUpdates: Array<{ tabId?: number; path: Record<string, string> }> = [];
  const badgeUpdates: Array<{ tabId?: number; text: string }> = [];

  const prevGlobals = {
    window: globalThis.window, document: globalThis.document,
    chrome: (globalThis as Record<string, unknown>).chrome, fetch: globalThis.fetch,
    Event: globalThis.Event, CustomEvent: globalThis.CustomEvent,
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
          (registeringTarget === "bg" ? bgRuntimeListeners : contentRuntimeListeners).push(fn);
        },
      },
      onConnect: { addListener: (fn: (port: MockPort) => void) => { portConnectListeners.push(fn); } },
      connect: (
        { name }: { name?: string } = {},
        senderOverride?: { id?: string; tab?: { id?: number; url?: string } } | null
      ) => {
        const sender = senderOverride === null ? undefined : (senderOverride ?? { id: "agentcue-test-ext-id", tab: { id: 1, url: options.tabUrl } });
        const clientPort: MockPort = {
          name: name || "", sender, disconnected: false, msgListeners: [], disconnectListeners: [],
          postMessage: () => {},
          disconnect: () => { clientPort.disconnected = serverPort.disconnected = true; for (const fn of serverPort.disconnectListeners) fn(); },
          onMessage: { addListener: (fn) => clientPort.msgListeners.push(fn) },
          onDisconnect: { addListener: (fn) => clientPort.disconnectListeners.push(fn) },
        };
        const serverPort: MockPort = {
          name: name || "", sender, disconnected: false, msgListeners: [], disconnectListeners: [],
          postMessage: (msg) => { for (const fn of clientPort.msgListeners) fn(msg); },
          disconnect: () => {
            serverPort.disconnected = clientPort.disconnected = true;
            for (const fn of [...serverPort.disconnectListeners, ...clientPort.disconnectListeners]) fn();
          },
          onMessage: { addListener: (fn) => serverPort.msgListeners.push(fn) },
          onDisconnect: { addListener: (fn) => serverPort.disconnectListeners.push(fn) },
        };
        activeContentPort = serverPort;
        for (const fn of portConnectListeners) fn(serverPort);
        return clientPort;
      },
      sendMessage: (msg: unknown, senderOverride?: { id?: string; tab?: { id?: number; url?: string } }) =>
        new Promise((resolve) => {
          const sender = senderOverride ?? { id: "agentcue-test-ext-id", tab: { id: 1, url: options.tabUrl } };
          let responded = false, isAsync = false;
          for (const listener of bgRuntimeListeners) {
            const ret = listener(msg, sender, (res) => { if (!responded) { responded = true; resolve(res); } });
            if (ret === true) isAsync = true;
          }
          if (!responded && !isAsync) setTimeout(() => { if (!responded) resolve(undefined); }, 0);
        }),
      openOptionsPage: async () => {},
    },
    tabs: {
      query: async () => [{ id: 1, url: options.tabUrl }],
      sendMessage: (_tabId: number, msg: unknown) =>
        new Promise((resolve, reject) => {
          if (contentRuntimeListeners.length === 0) return reject(new Error("Receiving end does not exist"));
          for (const listener of contentRuntimeListeners) listener(msg, { id: "agentcue-test-ext-id" }, (res) => resolve(res));
        }),
      onUpdated: { addListener: (fn: (tabId: number, changeInfo: { status?: string }) => void) => { tabUpdatedListeners.push(fn); } },
      onRemoved: { addListener: () => {} },
    },
    commands: {
      onCommand: { addListener: (fn: (command: string, tab?: { id?: number; url?: string }) => void) => { commandListeners.push(fn); } },
    },
    action: {
      setIcon: async (details: { path: Record<string, string>; tabId?: number }) => { iconUpdates.push(details); },
      setTitle: async () => {},
      setBadgeText: async (details: { text: string; tabId?: number }) => { badgeUpdates.push(details); },
      setBadgeBackgroundColor: async () => {},
    },
    scripting: {
      executeScript: async (inj: {
        files?: string[]; func?: (...args: unknown[]) => unknown; args?: unknown[]; world?: string;
      }) => {
        if (typeof inj.func === "function") return [{ result: inj.func(...(inj.args || [])) }];
        for (const file of inj.files || []) {
          injectedFiles.push({ file, world: inj.world });
          if (file === "content.js") { registeringTarget = "content"; initContentBridge(); }
          else if (file === "page.js") initPageHintExtractor(doc as unknown as Document);
        }
        return [];
      },
    },
    storage: {
      local: {
        get: async (key?: string | string[] | null) => {
          if (Array.isArray(key)) {
            const out: Record<string, unknown> = {};
            for (const k of key) out[k] = storageData[k];
            return out;
          }
          return key ? { [key]: storageData[key] } : { ...storageData };
        },
        set: async (items: Record<string, unknown>) => {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: storageData[k], newValue: v };
            storageData[k] = v;
          }
          for (const fn of [...storageListeners]) fn(changes, "local");
        },
      },
      onChanged: {
        addListener: (fn: (c: Record<string, { oldValue?: unknown; newValue?: unknown }>, a: string) => void) => storageListeners.add(fn),
        removeListener: (fn: (c: Record<string, { oldValue?: unknown; newValue?: unknown }>, a: string) => void) => storageListeners.delete(fn),
      },
    },
  };

  Object.assign(globalThis, {
    window: win, document: doc, chrome: mockChrome,
    requestAnimationFrame: (cb: () => void) => { cb(); return 0; },
    Event: class MockEventCtor {
      type: string; bubbles: boolean; isTrusted = false; defaultPrevented = false; target: unknown = null;
      constructor(type: string, init?: { bubbles?: boolean }) { this.type = type; this.bubbles = Boolean(init?.bubbles); }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() {} stopImmediatePropagation() {} composedPath() { return [this.target]; }
    },
    CustomEvent: class MockCustomEventCtor {
      type: string; bubbles: boolean; detail: unknown; isTrusted = false; defaultPrevented = false; target: unknown = null;
      constructor(type: string, init?: { bubbles?: boolean; detail?: unknown }) {
        this.type = type; this.bubbles = Boolean(init?.bubbles); this.detail = init?.detail;
      }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() {} stopImmediatePropagation() {} composedPath() { return [this.target]; }
    },
    fetch: async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/cue")) {
        postedCues.push({ url, headers: init?.headers, payload: JSON.parse(String(init?.body || "{}")) as CuePayload });
        return new Response(JSON.stringify({ cueId: "cue-test-1", queuePosition: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/state")) {
        stateRequests.push({ url, headers: init?.headers });
        return new Response(
          JSON.stringify({ cwd: "/tmp/mock-workspace", agents: ["agy"], defaultAgent: "agy", status: "idle", activeCue: null, queuedCount: 0, lastResult: null }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.endsWith("/api/events")) {
        if (!bridgeOnline) return new Response("Offline", { status: 503 });
        return new Response(
          new ReadableStream({ start(c) { init?.signal?.addEventListener("abort", () => { try { c.close(); } catch {} }); } }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
      return new Response("{}", { status: 404 });
    },
  });

  registeringTarget = "bg";
  initBackground();

  return {
    win, doc, targetButton, mockChrome, postedCues, stateRequests, injectedFiles, iconUpdates, badgeUpdates,
    setBridgeOnline: (next: boolean) => { bridgeOnline = next; },
    getActivePort: () => activeContentPort,
    triggerContentLoad: async () => { registeringTarget = "content"; initContentBridge(); await new Promise((r) => setTimeout(r, 15)); },
    toggleViaPopup: async () => {
      const res = await mockChrome.runtime.sendMessage({ type: "ext:toggle-tab", tabId: 1, tabUrl: options.tabUrl }, { id: "agentcue-test-ext-id" });
      await new Promise((r) => setTimeout(r, 15));
      return res;
    },
    queryTabStateFromPopup: async () => mockChrome.runtime.sendMessage({ type: "ext:tab-state", tabId: 1, tabUrl: options.tabUrl }, { id: "agentcue-test-ext-id" }),
    updateSettingsFromPopup: async (patch: { enabled?: boolean; showFloatingBar?: boolean }) => {
      const res = await mockChrome.runtime.sendMessage({ type: "ext:update-settings", ...patch, tabId: 1, tabUrl: options.tabUrl }, { id: "agentcue-test-ext-id" });
      await new Promise((r) => setTimeout(r, 15));
      return res;
    },
    triggerCommand: async (command = "toggle-pick") => { for (const fn of commandListeners) fn(command, { id: 1, url: options.tabUrl }); await new Promise((r) => setTimeout(r, 15)); },
    triggerTabReload: () => { for (const fn of tabUpdatedListeners) fn(1, { status: "loading" }); },
    cleanup: () => { activeContentPort?.disconnect(); Object.assign(globalThis, prevGlobals); },
  };
}
