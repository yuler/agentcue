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
  HINT_REQUEST_EVENT,
  HINT_RESPONSE_EVENT,
  isLocalhostUrl,
  sanitizeFrameworkHints,
  SSE_PORT_NAME,
  STORAGE_SELECTED_AGENT_KEY,
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
  let listeningHints = false;
  let capturedHints: FrameworkHints | undefined;

  try {
    void chrome.storage?.local
      ?.get(STORAGE_SELECTED_AGENT_KEY)
      .then((stored) => {
        const val = stored?.[STORAGE_SELECTED_AGENT_KEY];
        if (typeof val === "string") initialAgent = val;
      })
      .catch(() => {
        // ignore storage read errors
      });
  } catch {
    // ignore storage unavailability
  }

  document.addEventListener(HINT_RESPONSE_EVENT, (evt: Event) => {
    if (!listeningHints) return;
    const custom = evt as CustomEvent<unknown>;
    const sanitized = sanitizeFrameworkHints(custom.detail);
    if (sanitized.sourceHint || sanitized.componentStack) {
      capturedHints = sanitized;
    }
  });

  function requestMainWorldHints(el: Element): FrameworkHints | undefined {
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

  function bootIsolatedOverlay(
    mode: "toggle" | "auto",
    bridgeOrigin = DEFAULT_BRIDGE_ORIGIN
  ): { active: boolean } {
    if (overlayInstance) {
      if (mode === "toggle") {
        overlayInstance.togglePickMode();
      }
      return { active: overlayInstance.isActive() };
    }

    if (mode === "auto" && document.querySelector("agentcue-root")) {
      return { active: false };
    }

    const mountNow = () => {
      if (!overlayInstance) {
        overlayInstance = mountOverlay(bridgeOrigin, {
          transport: createExtensionBridgeTransport(),
          startActive: mode === "toggle",
          shadowMode: "closed",
          requireTrustedSend: true,
          resolveFrameworkHints: requestMainWorldHints,
          stateStore: createIsolatedStateStore(initialAgent),
        });
      } else if (mode === "toggle") {
        overlayInstance.togglePickMode();
      }
    };

    if (document.documentElement) {
      mountNow();
    } else {
      window.addEventListener("DOMContentLoaded", mountNow, { once: true });
    }

    const mounted = overlayInstance as OverlayInstance | null;
    return {
      active: mounted ? mounted.isActive() : mode === "toggle",
    };
  }

  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = raw as TabCommandMessage;
    if (!msg || typeof msg !== "object") return false;

    if (msg.type === "ext:boot") {
      const result = bootIsolatedOverlay(msg.mode, msg.bridgeOrigin);
      sendResponse(result);
      return false;
    }

    return false;
  });

  if (isLocalhostUrl(window.location.href)) {
    void chrome.runtime
      .sendMessage({
        type: "ext:content-ready",
        url: window.location.href,
      })
      .catch(() => {
        // ignore if background is waking up
      });
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
