import {
  consumeSseResponse,
  DEFAULT_EXTENSION_SETTINGS,
  fetchBridgeState,
  isInjectableTabUrl,
  isValidCuePayload,
  normalizeSettings,
  sendCueToBridge,
  SSE_PORT_NAME,
  STORAGE_SETTINGS_KEY,
  type EmbeddedSdkSource,
  type ExtensionSettings,
  type RuntimeRequestMessage,
  type SsePortMessage,
  type TabStateResult,
  type TabToggleResult,
} from "./protocol.ts";
import type { ServerEvent } from "../../agentcue/src/shared/types.ts";

const DEFAULT_ICON_PATHS: Record<string, string> = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
};

const ACTIVE_ICON_PATHS: Record<string, string> = {
  "16": "icons/icon-active-16.png",
  "32": "icons/icon-active-32.png",
  "48": "icons/icon-active-48.png",
  "128": "icons/icon-active-128.png",
};

const DISABLED_ICON_PATHS: Record<string, string> = {
  "16": "icons/icon-disabled-16.png",
  "32": "icons/icon-disabled-32.png",
  "48": "icons/icon-disabled-48.png",
  "128": "icons/icon-disabled-128.png",
};

type TabIconMode = "default" | "active" | "disabled" | "embedded";

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
    return normalizeSettings(stored[STORAGE_SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_EXTENSION_SETTINGS };
  }
}

async function saveSettings(
  next: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = normalizeSettings({ ...current, ...next });
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: merged });
  return merged;
}

async function syncGlobalIcon(enabled: boolean): Promise<void> {
  try {
    await chrome.action.setIcon({
      path: enabled ? DEFAULT_ICON_PATHS : DISABLED_ICON_PATHS,
    });
    await chrome.action.setTitle?.({
      title: enabled ? "agentcue (Cmd/Ctrl+Shift+F)" : "agentcue · Disabled",
    });
    await chrome.action.setBadgeText?.({ text: "" });
  } catch {
    // ignore action errors
  }
}

async function setTabIcon(tabId: number, mode: TabIconMode): Promise<void> {
  const path =
    mode === "active"
      ? ACTIVE_ICON_PATHS
      : mode === "disabled" || mode === "embedded"
        ? DISABLED_ICON_PATHS
        : DEFAULT_ICON_PATHS;
  const title =
    mode === "active"
      ? "agentcue · Picking (Cmd/Ctrl+Shift+F)"
      : mode === "disabled"
        ? "agentcue · Disabled"
        : mode === "embedded"
          ? "agentcue · Embedded SDK detected (auto-disabled)"
          : "agentcue (Cmd/Ctrl+Shift+F)";
  try {
    await chrome.action.setIcon({ tabId, path });
    await chrome.action.setTitle?.({ tabId, title });
    await chrome.action.setBadgeText?.({ tabId, text: "" });
  } catch {
    // ignore if tab closed
  }
}

async function injectPageHintExtractor(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["page.js"],
      world: "MAIN",
    });
  } catch {
    // Continue without framework hints if MAIN-world injection is restricted
  }
}

async function detectEmbeddedPageSdk(
  tabId: number
): Promise<EmbeddedSdkSource | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (): EmbeddedSdkSource | null => {
        const scripts = document.querySelectorAll("script[src]");
        let scriptSource: EmbeddedSdkSource | null = null;
        for (let i = 0; i < scripts.length; i++) {
          const src = scripts[i].getAttribute("src") || "";
          if (src.includes("/__agentcue/")) {
            scriptSource = "vite";
            break;
          }
          if (
            src.includes("agentcue") ||
            /\/client\.js(?:[?#]|$)/.test(src)
          ) {
            scriptSource = "script";
          }
        }
        if (scriptSource === "vite") return "vite";

        const roots = document.querySelectorAll("agentcue-root");
        for (let i = 0; i < roots.length; i++) {
          const el = roots[i];
          if (el.shadowRoot !== null || el.hasAttribute("data-agentcue-embedded")) {
            return scriptSource ?? "sdk";
          }
        }
        return null;
      },
    });
    return (results?.[0]?.result as EmbeddedSdkSource | null) ?? null;
  } catch {
    return null;
  }
}

async function injectAndToggleOnTab(
  tabId: number,
  settings: ExtensionSettings
): Promise<{
  active: boolean;
  embedded?: boolean;
  embeddedSource?: EmbeddedSdkSource;
}> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
    world: "ISOLATED",
  });

  await injectPageHintExtractor(tabId);

  const res = await chrome.tabs.sendMessage<{
    active?: boolean;
    embedded?: boolean;
    embeddedSource?: EmbeddedSdkSource;
  }>(tabId, {
    type: "ext:boot",
    bridgeOrigin: settings.bridgeOrigin,
    showFloatingBar: settings.showFloatingBar,
  });

  return {
    active: Boolean(res?.active),
    embedded: Boolean(res?.embedded),
    embeddedSource: res?.embeddedSource,
  };
}

async function toggleTabPickMode(
  tabId: number,
  tabUrl?: string
): Promise<TabToggleResult> {
  if (tabUrl !== undefined && !isInjectableTabUrl(tabUrl)) {
    return { ok: false, active: false, error: "Page is not injectable" };
  }

  const settings = await loadSettings();
  const embeddedSource = await detectEmbeddedPageSdk(tabId);
  if (embeddedSource) {
    await setTabIcon(tabId, settings.enabled ? "embedded" : "disabled");
    return {
      ok: false,
      active: false,
      embedded: true,
      embeddedSource,
      error: "Page already embeds agentcue",
    };
  }

  if (!settings.enabled) {
    await setTabIcon(tabId, "disabled");
    return {
      ok: false,
      active: false,
      disabled: true,
      error: "Extension is disabled",
    };
  }

  try {
    const res = await injectAndToggleOnTab(tabId, settings);
    if (res.embedded) {
      await setTabIcon(tabId, "embedded");
      return {
        ok: false,
        active: false,
        embedded: true,
        embeddedSource: res.embeddedSource ?? "sdk",
        error: "Page already embeds agentcue",
      };
    }
    await setTabIcon(tabId, res.active ? "active" : "default");
    return { ok: true, active: res.active };
  } catch (err) {
    return {
      ok: false,
      active: false,
      error: err instanceof Error ? err.message : "Cannot access this page",
    };
  }
}

async function queryTabActiveState(
  tabId: number,
  tabUrl?: string
): Promise<TabStateResult> {
  const settings = await loadSettings();
  if (!isInjectableTabUrl(tabUrl)) {
    await setTabIcon(tabId, settings.enabled ? "default" : "disabled");
    return {
      injectable: false,
      active: false,
      embedded: false,
      enabled: settings.enabled,
      showFloatingBar: settings.showFloatingBar,
    };
  }

  const embeddedSource = await detectEmbeddedPageSdk(tabId);
  const embedded = Boolean(embeddedSource);
  if (!settings.enabled) {
    await setTabIcon(tabId, "disabled");
    return {
      injectable: true,
      active: false,
      embedded,
      ...(embeddedSource ? { embeddedSource } : {}),
      enabled: false,
      showFloatingBar: settings.showFloatingBar,
    };
  }

  if (embeddedSource) {
    await setTabIcon(tabId, "embedded");
    return {
      injectable: true,
      active: false,
      embedded: true,
      embeddedSource,
      enabled: true,
      showFloatingBar: settings.showFloatingBar,
    };
  }

  try {
    const res = await chrome.tabs.sendMessage<{
      active?: boolean;
      embedded?: boolean;
      embeddedSource?: EmbeddedSdkSource;
    }>(tabId, {
      type: "ext:get-state",
    });
    if (res?.embedded) {
      await setTabIcon(tabId, "embedded");
      return {
        injectable: true,
        active: false,
        embedded: true,
        embeddedSource: res.embeddedSource ?? "sdk",
        enabled: true,
        showFloatingBar: settings.showFloatingBar,
      };
    }
    const active = Boolean(res?.active);
    await setTabIcon(tabId, active ? "active" : "default");
    return {
      injectable: true,
      active,
      embedded: false,
      enabled: true,
      showFloatingBar: settings.showFloatingBar,
    };
  } catch {
    await setTabIcon(tabId, "default");
    return {
      injectable: true,
      active: false,
      embedded: false,
      enabled: true,
      showFloatingBar: settings.showFloatingBar,
    };
  }
}

async function updateExtensionSettings(
  patch: Partial<ExtensionSettings>,
  activeTabId?: number,
  activeTabUrl?: string
): Promise<TabStateResult> {
  const merged = await saveSettings(patch);
  await syncGlobalIcon(merged.enabled);

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab.id !== "number") continue;
      if (!merged.enabled) {
        await setTabIcon(tab.id, "disabled");
      } else {
        await setTabIcon(tab.id, "default");
      }
      if (isInjectableTabUrl(tab.url)) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "ext:sync-settings",
            enabled: merged.enabled,
            showFloatingBar: merged.showFloatingBar,
            bridgeOrigin: merged.bridgeOrigin,
          });
        } catch {
          // tab has no content script yet
        }
      }
    }
  } catch {
    // ignore tab query errors
  }

  if (typeof activeTabId === "number") {
    return queryTabActiveState(activeTabId, activeTabUrl);
  }
  return {
    injectable: false,
    active: false,
    embedded: false,
    enabled: merged.enabled,
    showFloatingBar: merged.showFloatingBar,
  };
}

function isAuthorizedTabSender(sender: chrome.runtime.MessageSender): boolean {
  if (chrome.runtime.id && sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }
  if (typeof sender.tab?.id !== "number") {
    return false;
  }
  return isInjectableTabUrl(sender.tab.url);
}

function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (chrome.runtime.id && sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }
  return !sender.tab;
}

export function createSharedSseHub() {
  const ports = new Set<chrome.runtime.Port>();
  let abortController: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let streamOpen = false;
  let openOrigin = DEFAULT_EXTENSION_SETTINGS.bridgeOrigin;
  let lastStateEvent: ServerEvent | null = null;
  let connectGeneration = 0;

  const postToPort = (port: chrome.runtime.Port, msg: SsePortMessage) => {
    try {
      port.postMessage(msg);
    } catch {
      ports.delete(port);
    }
  };

  const broadcast = (msg: SsePortMessage) => {
    for (const port of [...ports]) {
      postToPort(port, msg);
    }
  };

  const stopUpstream = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    streamOpen = false;
  };

  const isCurrentAttempt = (generation: number) => generation === connectGeneration;

  const invalidateConnectAttempts = () => {
    connectGeneration += 1;
    stopUpstream();
  };

  const scheduleRetry = (generation: number) => {
    retryTimer = setTimeout(() => {
      if (isCurrentAttempt(generation) && ports.size > 0) {
        void connectLoop();
      }
    }, 2500);
  };

  const connectLoop = async () => {
    const generation = ++connectGeneration;
    stopUpstream();
    if (ports.size === 0) return;

    const { bridgeOrigin } = await loadSettings();
    if (!isCurrentAttempt(generation) || ports.size === 0) return;

    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(`${bridgeOrigin}/api/events`, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!isCurrentAttempt(generation) || ports.size === 0) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        return;
      }

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      streamOpen = true;
      openOrigin = bridgeOrigin;
      broadcast({ type: "sse:open", bridgeOrigin });

      await consumeSseResponse(res.body, (event) => {
        if (!isCurrentAttempt(generation)) return;
        if (event.type === "state") {
          lastStateEvent = event;
        }
        broadcast({ type: "sse:event", event });
      });

      if (!isCurrentAttempt(generation)) return;

      streamOpen = false;
      if (ports.size > 0 && !controller.signal.aborted) {
        broadcast({ type: "sse:error" });
        scheduleRetry(generation);
      }
    } catch {
      if (!isCurrentAttempt(generation)) return;
      streamOpen = false;
      if (ports.size > 0 && !controller.signal.aborted) {
        broadcast({ type: "sse:error" });
        scheduleRetry(generation);
      }
    }
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_SETTINGS_KEY]) {
      const prev = normalizeSettings(changes[STORAGE_SETTINGS_KEY].oldValue);
      const next = normalizeSettings(changes[STORAGE_SETTINGS_KEY].newValue);
      if (prev.bridgeOrigin !== next.bridgeOrigin && ports.size > 0) {
        lastStateEvent = null;
        void connectLoop();
      }
    }
  });

  return {
    attach(port: chrome.runtime.Port) {
      const wasEmpty = ports.size === 0;
      ports.add(port);

      port.onDisconnect.addListener(() => {
        ports.delete(port);
        if (ports.size === 0) {
          invalidateConnectAttempts();
        }
      });

      if (streamOpen) {
        postToPort(port, { type: "sse:open", bridgeOrigin: openOrigin });
        if (lastStateEvent) {
          postToPort(port, { type: "sse:event", event: lastStateEvent });
        }
      } else if (wasEmpty && !abortController && !retryTimer) {
        void connectLoop();
      }
    },
  };
}

export function initBackground(): void {
  const sseHub = createSharedSseHub();

  const initIconState = () => {
    void loadSettings().then((s) => syncGlobalIcon(s.enabled));
  };

  chrome.runtime.onInstalled?.addListener(initIconState);
  chrome.runtime.onStartup?.addListener(initIconState);
  initIconState();

  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      void loadSettings().then((s) =>
        setTabIcon(tabId, s.enabled ? "default" : "disabled")
      );
    }
  });

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const msg = raw as RuntimeRequestMessage;
    if (!msg || typeof msg !== "object") return false;

    if (msg.type === "ext:toggle-tab") {
      if (!isExtensionPageSender(sender) || typeof msg.tabId !== "number") {
        sendResponse({ ok: false, active: false, error: "Unauthorized" });
        return false;
      }
      void toggleTabPickMode(msg.tabId, msg.tabUrl).then(sendResponse);
      return true;
    }

    if (msg.type === "ext:tab-state") {
      if (!isExtensionPageSender(sender) || typeof msg.tabId !== "number") {
        sendResponse({
          injectable: false,
          active: false,
          embedded: false,
          enabled: true,
          showFloatingBar: true,
        });
        return false;
      }
      void queryTabActiveState(msg.tabId, msg.tabUrl).then(sendResponse);
      return true;
    }

    if (msg.type === "ext:update-settings") {
      if (!isExtensionPageSender(sender)) {
        sendResponse({
          injectable: false,
          active: false,
          embedded: false,
          enabled: true,
          showFloatingBar: true,
        });
        return false;
      }
      const patch: Partial<ExtensionSettings> = {};
      if (typeof msg.enabled === "boolean") patch.enabled = msg.enabled;
      if (typeof msg.showFloatingBar === "boolean") {
        patch.showFloatingBar = msg.showFloatingBar;
      }
      void updateExtensionSettings(patch, msg.tabId, msg.tabUrl).then(
        sendResponse
      );
      return true;
    }

    if (msg.type === "ext:active-changed") {
      if (!isAuthorizedTabSender(sender)) {
        sendResponse({ ok: false });
        return false;
      }
      const tabId = sender.tab!.id!;
      void (async () => {
        const s = await loadSettings();
        if (s.enabled && msg.active) {
          await injectPageHintExtractor(tabId);
        }
        await setTabIcon(
          tabId,
          !s.enabled ? "disabled" : msg.active ? "active" : "default"
        );
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === "ext:embedded-detected") {
      if (!isAuthorizedTabSender(sender)) {
        sendResponse({ ok: false });
        return false;
      }
      const tabId = sender.tab!.id!;
      void loadSettings().then((s) =>
        setTabIcon(tabId, s.enabled ? "embedded" : "disabled").then(() =>
          sendResponse({ ok: true })
        )
      );
      return true;
    }

    if (msg.type === "ext:send-cue") {
      if (!isAuthorizedTabSender(sender)) {
        sendResponse({
          ok: false,
          status: 403,
          error: "Unauthorized Cue sender",
        });
        return false;
      }
      if (!isValidCuePayload(msg.payload)) {
        sendResponse({
          ok: false,
          status: 400,
          error: "Invalid Cue payload",
        });
        return false;
      }
      void (async () => {
        const settings = await loadSettings();
        const result = await sendCueToBridge(settings.bridgeOrigin, msg.payload);
        sendResponse(result);
      })();
      return true;
    }

    if (msg.type === "ext:check-bridge") {
      void (async () => {
        const settings = await loadSettings();
        const origin = msg.bridgeOrigin || settings.bridgeOrigin;
        const health = await fetchBridgeState(origin);
        sendResponse(health);
      })();
      return true;
    }

    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === SSE_PORT_NAME) {
      sseHub.attach(port);
    }
  });
}

if (typeof chrome !== "undefined" && Boolean(chrome.runtime?.onMessage)) {
  initBackground();
}
