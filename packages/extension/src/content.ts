import type { OverlayStateStore } from "../../agentcue/src/client/dom.ts";
import type { FrameworkHints } from "../../agentcue/src/client/extract.ts";
import {
  mountOverlay,
  type OverlayInstance,
} from "../../agentcue/src/client/overlay.ts";
import type {
  BridgeTransport,
  BridgeTransportHandlers,
  CueDispatchResult,
} from "../../agentcue/src/client/transport.ts";
import type { AgentId } from "../../agentcue/src/shared/types.ts";
import {
  DEFAULT_BRIDGE_ORIGIN,
  DEFAULT_EXTENSION_SETTINGS,
  HINT_REQUEST_EVENT,
  HINT_RESPONSE_EVENT,
  isLocalhostUrl,
  normalizeSettings,
  sanitizeFrameworkHints,
  SSE_PORT_NAME,
  STORAGE_SELECTED_AGENT_KEY,
  STORAGE_SETTINGS_KEY,
  type EmbeddedSdkSource,
  type ExtensionSettings,
  type SsePortMessage,
  type TabCommandMessage,
} from "./protocol.ts";

declare global {
  interface Window {
    __AGENTCUE_CONTENT_READY__?: boolean;
  }
}

function createIsolatedStateStore(initialAgent: string | null): OverlayStateStore {
  let selectedAgent: string | null = initialAgent;
  let activeSessions = new Set<AgentId>();

  return {
    getSelectedAgent: () => selectedAgent,
    setSelectedAgent: (agent: AgentId) => {
      selectedAgent = agent;
      try {
        void chrome.storage?.local?.set({ [STORAGE_SELECTED_AGENT_KEY]: agent });
      } catch {
        // ignore storage errors in restricted contexts
      }
    },
    loadActiveSessions: () => new Set(activeSessions),
    saveActiveSessions: (sessions: Set<AgentId>) => {
      activeSessions = new Set(sessions);
    },
  };
}

function createExtensionBridgeTransport(): BridgeTransport {
  return {
    sendCue(payload): Promise<CueDispatchResult> {
      return chrome.runtime
        .sendMessage<CueDispatchResult>({
          type: "ext:send-cue",
          payload,
        })
        .then(
          (result) =>
            result || {
              ok: false,
              status: 0,
              error: "Empty response from extension background",
            }
        )
        .catch((err) => ({
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : "Extension bridge error",
        }));
    },
    subscribeEvents(handlers: BridgeTransportHandlers): () => void {
      let port: chrome.runtime.Port | null = null;
      let active = true;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

      const clearReconnectTimer = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      const scheduleReconnect = () => {
        clearReconnectTimer();
        if (!active) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (active && !port) connect();
        }, 2500);
      };

      const connect = () => {
        if (!active || port) return;
        try {
          const nextPort = chrome.runtime.connect({ name: SSE_PORT_NAME });
          port = nextPort;

          nextPort.onMessage.addListener((raw) => {
            const msg = raw as SsePortMessage;
            if (!msg || typeof msg !== "object") return;
            if (msg.type === "sse:open") {
              handlers.onOpen();
            } else if (msg.type === "sse:event") {
              handlers.onEvent(msg.event);
            } else if (msg.type === "sse:error") {
              handlers.onError();
            }
          });

          nextPort.onDisconnect.addListener(() => {
            if (port === nextPort) port = null;
            handlers.onError();
            scheduleReconnect();
          });
        } catch {
          port = null;
          handlers.onError();
          scheduleReconnect();
        }
      };

      connect();

      return () => {
        active = false;
        clearReconnectTimer();
        if (port) {
          try {
            port.disconnect();
          } catch {
            // ignore disconnect errors
          }
          port = null;
        }
      };
    },
  };
}

export function initContentBridge(): void {
  if (window.__AGENTCUE_CONTENT_READY__) return;
  window.__AGENTCUE_CONTENT_READY__ = true;

  let overlayInstance: OverlayInstance | null = null;
  let initialAgent: string | null = null;
  let currentSettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };
  let listeningHints = false;
  let capturedHints: FrameworkHints | undefined;

  document.addEventListener(HINT_RESPONSE_EVENT, (evt: Event) => {
    if (!listeningHints || !isLocalhostUrl(window.location?.href)) return;
    const custom = evt as CustomEvent<unknown>;
    const sanitized = sanitizeFrameworkHints(custom.detail);
    if (sanitized.sourceHint || sanitized.componentStack) {
      capturedHints = sanitized;
    }
  });

  function requestMainWorldHints(el: Element): FrameworkHints | undefined {
    if (!isLocalhostUrl(window.location?.href)) {
      return undefined;
    }
    capturedHints = undefined;
    listeningHints = true;
    try {
      el.dispatchEvent(new Event(HINT_REQUEST_EVENT, { bubbles: true }));
    } catch {
      return undefined;
    } finally {
      listeningHints = false;
    }
    return capturedHints;
  }

  function notifyActiveChange(active: boolean) {
    try {
      void chrome.runtime
        .sendMessage({ type: "ext:active-changed", active })
        .catch(() => {
          // ignore if background worker is sleeping
        });
    } catch {
      // ignore runtime errors
    }
  }

  function notifyEmbeddedDetected(embeddedSource: EmbeddedSdkSource) {
    try {
      void chrome.runtime
        .sendMessage({ type: "ext:embedded-detected", embeddedSource })
        .catch(() => {
          // ignore if background worker is sleeping
        });
    } catch {
      // ignore runtime errors
    }
  }

  function detectEmbeddedSource(): EmbeddedSdkSource | null {
    const scripts = document.querySelectorAll("script[src]");
    let scriptSource: EmbeddedSdkSource | null = null;
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute("src") || "";
      if (src.includes("/__agentcue/")) {
        scriptSource = "vite";
        break;
      }
      if (src.includes("agentcue") || /\/client\.js(?:[?#]|$)/.test(src)) {
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
  }

  function unmountOverlay() {
    if (!overlayInstance) return;
    overlayInstance.destroy();
    overlayInstance = null;
  }

  function mountWithSettings(
    bridgeOrigin: string,
    showFloatingBar: boolean,
    startActive: boolean
  ) {
    if (overlayInstance) {
      overlayInstance.setHideLauncherWhenIdle(!showFloatingBar);
      if (startActive) {
        overlayInstance.togglePickMode();
      }
      return;
    }

    const doMount = () => {
      if (detectEmbeddedSource()) return;
      if (!overlayInstance) {
        overlayInstance = mountOverlay(bridgeOrigin, {
          transport: createExtensionBridgeTransport(),
          startActive,
          shadowMode: "closed",
          requireTrustedSend: true,
          hideLauncherWhenIdle: !showFloatingBar,
          onActiveChange: notifyActiveChange,
          resolveFrameworkHints: requestMainWorldHints,
          stateStore: createIsolatedStateStore(initialAgent),
        });
      }
    };

    if (document.documentElement) {
      doMount();
    } else {
      window.addEventListener("DOMContentLoaded", doMount, { once: true });
    }
  }

  function syncLifecycle(settings: ExtensionSettings) {
    currentSettings = settings;
    const embeddedSource = detectEmbeddedSource();
    if (embeddedSource) {
      unmountOverlay();
      notifyEmbeddedDetected(embeddedSource);
      return;
    }
    if (!settings.enabled) {
      unmountOverlay();
      return;
    }
    mountWithSettings(settings.bridgeOrigin, settings.showFloatingBar, false);
  }

  function bootIsolatedOverlay(
    bridgeOrigin = DEFAULT_BRIDGE_ORIGIN,
    showFloatingBar = currentSettings.showFloatingBar
  ): { active: boolean; embedded?: boolean; embeddedSource?: EmbeddedSdkSource } {
    const embeddedSource = detectEmbeddedSource();
    if (embeddedSource) {
      unmountOverlay();
      notifyEmbeddedDetected(embeddedSource);
      return { active: false, embedded: true, embeddedSource };
    }

    if (overlayInstance) {
      overlayInstance.setHideLauncherWhenIdle(!showFloatingBar);
      overlayInstance.togglePickMode();
      return { active: overlayInstance.isActive() };
    }

    mountWithSettings(bridgeOrigin, showFloatingBar, true);
    const mounted = overlayInstance as OverlayInstance | null;
    return {
      active: mounted ? mounted.isActive() : true,
    };
  }

  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = raw as TabCommandMessage;
    if (!msg || typeof msg !== "object") return false;

    if (msg.type === "ext:boot") {
      const result = bootIsolatedOverlay(
        msg.bridgeOrigin,
        msg.showFloatingBar ?? currentSettings.showFloatingBar
      );
      sendResponse(result);
      return false;
    }

    if (msg.type === "ext:get-state") {
      const embeddedSource = detectEmbeddedSource();
      if (embeddedSource && overlayInstance) {
        unmountOverlay();
      }
      sendResponse({
        active: overlayInstance?.isActive() ?? false,
        embedded: Boolean(embeddedSource),
        ...(embeddedSource ? { embeddedSource } : {}),
      });
      return false;
    }

    if (msg.type === "ext:sync-settings") {
      syncLifecycle(normalizeSettings(msg));
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_SETTINGS_KEY]) {
      syncLifecycle(normalizeSettings(changes[STORAGE_SETTINGS_KEY].newValue));
    }
  });

  if (typeof MutationObserver !== "undefined" && document.documentElement) {
    const observer = new MutationObserver(() => {
      if (!overlayInstance) return;
      const embeddedSource = detectEmbeddedSource();
      if (embeddedSource) {
        unmountOverlay();
        notifyEmbeddedDetected(embeddedSource);
      }
    });
    observer.observe(document.documentElement, { childList: true });
  }

  try {
    void chrome.storage?.local
      ?.get([STORAGE_SETTINGS_KEY, STORAGE_SELECTED_AGENT_KEY])
      .then((stored) => {
        const agentVal = stored?.[STORAGE_SELECTED_AGENT_KEY];
        if (typeof agentVal === "string") initialAgent = agentVal;
        const settings = normalizeSettings(stored?.[STORAGE_SETTINGS_KEY]);
        syncLifecycle(settings);
      })
      .catch(() => {
        syncLifecycle({ ...DEFAULT_EXTENSION_SETTINGS });
      });
  } catch {
    // ignore storage unavailability
  }
}

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof chrome !== "undefined" &&
  Boolean(chrome.runtime?.onMessage)
) {
  initContentBridge();
}
