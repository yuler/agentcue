import {
  consumeSseResponse,
  DEFAULT_EXTENSION_SETTINGS,
  fetchBridgeState,
  isInjectableTabUrl,
  isLocalhostUrl,
  normalizeSettings,
  sendCueToBridge,
  SSE_PORT_NAME,
  STORAGE_SETTINGS_KEY,
  type ContentToPageMessage,
  type ExtensionSettings,
  type RuntimeRequestMessage,
} from "./protocol.ts";

const MENU_AUTO_MOUNT = "agentcue:menu:auto-mount-localhost";
const MENU_OPEN_OPTIONS = "agentcue:menu:open-options";

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
    return normalizeSettings(stored[STORAGE_SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_EXTENSION_SETTINGS };
  }
}

async function saveSettings(next: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = normalizeSettings({ ...current, ...next });
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: merged });
  return merged;
}

async function setupContextMenus() {
  const settings = await loadSettings();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_AUTO_MOUNT,
      title: "Auto-mount ✦ launcher on localhost / 127.0.0.1",
      type: "checkbox",
      checked: settings.autoMountLocalhost,
      contexts: ["action"],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_OPTIONS,
      title: "Configure Local Bridge URL…",
      type: "normal",
      contexts: ["action"],
    });
  });
}

async function injectAndBootOnTab(
  tabId: number,
  mode: "toggle" | "auto",
  bridgeOrigin: string
): Promise<boolean> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
    world: "ISOLATED",
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page.js"],
    world: "MAIN",
  });

  const results = await chrome.scripting.executeScript<
    [string, string],
    { active: boolean } | undefined
  >({
    target: { tabId },
    world: "MAIN",
    func: (bootMode: string, origin: string) => {
      const w = window as unknown as {
        __AGENTCUE_EXTENSION_BOOT__?: (
          m: "toggle" | "auto",
          o: string
        ) => { active: boolean };
      };
      return w.__AGENTCUE_EXTENSION_BOOT__?.(
        bootMode as "toggle" | "auto",
        origin
      );
    },
    args: [mode, bridgeOrigin],
  });

  return Boolean(results?.[0]?.result?.active);
}

async function setTabBadge(tabId: number, active: boolean) {
  try {
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: "#2563eb",
    });
    await chrome.action.setBadgeText({
      tabId,
      text: active ? "PICK" : "",
    });
  } catch {
    // ignore if tab closed
  }
}

function attachSseStreamToPort(port: chrome.runtime.Port) {
  let closed = false;
  let abortController: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const postToPort = (msg: ContentToPageMessage) => {
    if (closed) return;
    try {
      port.postMessage(msg);
    } catch {
      closed = true;
    }
  };

  const stopCurrentAttempt = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  const connectLoop = async () => {
    stopCurrentAttempt();
    if (closed) return;

    const { bridgeOrigin } = await loadSettings();
    if (closed) return;

    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(`${bridgeOrigin}/api/events`, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      postToPort({ type: "sse:open", bridgeOrigin });
      await consumeSseResponse(res.body, (event) => {
        postToPort({ type: "sse:event", event });
      });

      if (!closed && !controller.signal.aborted) {
        postToPort({ type: "sse:error" });
        retryTimer = setTimeout(() => void connectLoop(), 2500);
      }
    } catch {
      if (!closed && !controller.signal.aborted) {
        postToPort({ type: "sse:error" });
        retryTimer = setTimeout(() => void connectLoop(), 2500);
      }
    }
  };

  const storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName === "local" && changes[STORAGE_SETTINGS_KEY]) {
      void connectLoop();
    }
  };

  chrome.storage.onChanged.addListener(storageListener);

  port.onDisconnect.addListener(() => {
    closed = true;
    stopCurrentAttempt();
  });

  void connectLoop();
}

chrome.runtime.onInstalled.addListener(() => {
  void setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void setupContextMenus();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_AUTO_MOUNT) {
    void saveSettings({ autoMountLocalhost: Boolean(info.checked) });
  } else if (info.menuItemId === MENU_OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_SETTINGS_KEY]) {
    const next = normalizeSettings(changes[STORAGE_SETTINGS_KEY].newValue);
    try {
      chrome.contextMenus.update(MENU_AUTO_MOUNT, {
        checked: next.autoMountLocalhost,
      });
    } catch {
      // ignore if menu not created yet
    }
  }
});

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  if (typeof tabId !== "number") return;

  if (!isInjectableTabUrl(tab.url)) {
    void chrome.action.setBadgeBackgroundColor({ tabId, color: "#ef4444" });
    void chrome.action.setBadgeText({ tabId, text: "N/A" });
    setTimeout(() => {
      void chrome.action.setBadgeText({ tabId, text: "" });
    }, 1800);
    return;
  }

  void (async () => {
    try {
      const settings = await loadSettings();
      const active = await injectAndBootOnTab(
        tabId,
        "toggle",
        settings.bridgeOrigin
      );
      await setTabBadge(tabId, active);
    } catch {
      // Restricted browser internal pages cannot be scripted
    }
  })();
});

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const msg = raw as RuntimeRequestMessage;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "ext:content-ready") {
    const tabId = sender.tab?.id;
    const url = msg.url || sender.tab?.url;
    if (typeof tabId === "number" && isLocalhostUrl(url)) {
      void (async () => {
        const settings = await loadSettings();
        if (settings.autoMountLocalhost) {
          await injectAndBootOnTab(tabId, "auto", settings.bridgeOrigin);
        }
        sendResponse({ ok: true });
      })();
      return true;
    }
    sendResponse({ ok: false });
    return false;
  }

  if (msg.type === "ext:send-cue") {
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
    attachSseStreamToPort(port);
  }
});
