import {
  mountOverlay,
  type OverlayInstance,
} from "../../agentcue/src/client/overlay.ts";
import type {
  BridgeTransport,
  BridgeTransportHandlers,
  CueDispatchResult,
} from "../../agentcue/src/client/transport.ts";
import {
  CONTENT_TO_PAGE_EVENT,
  DEFAULT_BRIDGE_ORIGIN,
  PAGE_TO_CONTENT_EVENT,
  type ContentToPageMessage,
  type PageToContentMessage,
} from "./protocol.ts";

declare global {
  interface Window {
    __AGENTCUE_ORIGIN__?: string;
    __AGENTCUE_INSTANCE__?: {
      togglePickMode: () => void;
      setActive?: (next: boolean) => void;
      isActive?: () => boolean;
    };
    __AGENTCUE_EXTENSION_BOOT__?: (
      mode: "toggle" | "auto",
      bridgeOrigin?: string
    ) => { active: boolean };
  }
}

const pendingCues = new Map<string, (result: CueDispatchResult) => void>();
const sseHandlers = new Set<BridgeTransportHandlers>();
let listenerRegistered = false;

function dispatchToContent(msg: PageToContentMessage) {
  window.dispatchEvent(new CustomEvent(PAGE_TO_CONTENT_EVENT, { detail: msg }));
}

function ensurePageListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  window.addEventListener(CONTENT_TO_PAGE_EVENT, (evt: Event) => {
    const custom = evt as CustomEvent<ContentToPageMessage>;
    const msg = custom.detail;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "cue:result") {
      const resolve = pendingCues.get(msg.reqId);
      if (resolve) {
        pendingCues.delete(msg.reqId);
        resolve(msg.result);
      }
    } else if (msg.type === "sse:open") {
      for (const h of sseHandlers) h.onOpen();
    } else if (msg.type === "sse:event") {
      for (const h of sseHandlers) h.onEvent(msg.event);
    } else if (msg.type === "sse:error") {
      for (const h of sseHandlers) h.onError();
    }
  });
}

function createExtensionBridgeTransport(): BridgeTransport {
  ensurePageListener();

  return {
    sendCue(payload) {
      return new Promise<CueDispatchResult>((resolve) => {
        const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timer = setTimeout(() => {
          if (pendingCues.delete(reqId)) {
            resolve({
              ok: false,
              status: 0,
              error: "Extension bridge timed out",
            });
          }
        }, 15_000);

        pendingCues.set(reqId, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        dispatchToContent({ type: "cue:send", reqId, payload });
      });
    },
    subscribeEvents(handlers: BridgeTransportHandlers) {
      sseHandlers.add(handlers);
      dispatchToContent({ type: "sse:connect" });
      return () => {
        sseHandlers.delete(handlers);
        if (sseHandlers.size === 0) {
          dispatchToContent({ type: "sse:disconnect" });
        }
      };
    },
  };
}

function bootExtensionOverlay(
  mode: "toggle" | "auto",
  bridgeOrigin = DEFAULT_BRIDGE_ORIGIN
): { active: boolean } {
  if (window.__AGENTCUE_INSTANCE__) {
    if (mode === "toggle") {
      window.__AGENTCUE_INSTANCE__.togglePickMode();
    }
    return {
      active:
        typeof window.__AGENTCUE_INSTANCE__.isActive === "function"
          ? window.__AGENTCUE_INSTANCE__.isActive()
          : true,
    };
  }

  const mountNow = () => {
    if (!window.__AGENTCUE_INSTANCE__) {
      window.__AGENTCUE_INSTANCE__ = mountOverlay(bridgeOrigin, {
        transport: createExtensionBridgeTransport(),
        startActive: mode === "toggle",
      });
    } else if (mode === "toggle") {
      window.__AGENTCUE_INSTANCE__.togglePickMode();
    }
  };

  if (document.documentElement) {
    mountNow();
  } else {
    window.addEventListener("DOMContentLoaded", mountNow, { once: true });
  }

  const mounted = window.__AGENTCUE_INSTANCE__ as OverlayInstance | undefined;
  return {
    active:
      typeof mounted?.isActive === "function"
        ? mounted.isActive()
        : mode === "toggle",
  };
}

ensurePageListener();
window.__AGENTCUE_EXTENSION_BOOT__ = bootExtensionOverlay;
