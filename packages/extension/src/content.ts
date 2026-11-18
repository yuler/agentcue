import type { CueDispatchResult } from "../../agentcue/src/client/transport.ts";
import {
  CONTENT_TO_PAGE_EVENT,
  isLocalhostUrl,
  PAGE_TO_CONTENT_EVENT,
  SSE_PORT_NAME,
  type ContentToPageMessage,
  type PageToContentMessage,
} from "./protocol.ts";

declare global {
  interface Window {
    __AGENTCUE_CONTENT_READY__?: boolean;
  }
}

function dispatchToPage(msg: ContentToPageMessage) {
  window.dispatchEvent(new CustomEvent(CONTENT_TO_PAGE_EVENT, { detail: msg }));
}

function initContentBridge() {
  if (window.__AGENTCUE_CONTENT_READY__) return;
  window.__AGENTCUE_CONTENT_READY__ = true;

  let ssePort: chrome.runtime.Port | null = null;
  let sseWanted = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    if (!sseWanted) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (sseWanted && !ssePort) {
        connectSsePort();
      }
    }, 2500);
  }

  function connectSsePort() {
    if (ssePort || !sseWanted) return;
    try {
      const port = chrome.runtime.connect({ name: SSE_PORT_NAME });
      ssePort = port;

      port.onMessage.addListener((raw) => {
        const msg = raw as ContentToPageMessage;
        if (!msg || typeof msg !== "object") return;
        dispatchToPage(msg);
      });

      port.onDisconnect.addListener(() => {
        if (ssePort === port) {
          ssePort = null;
        }
        dispatchToPage({ type: "sse:error" });
        scheduleReconnect();
      });
    } catch {
      ssePort = null;
      dispatchToPage({ type: "sse:error" });
      scheduleReconnect();
    }
  }

  function disconnectSsePort() {
    sseWanted = false;
    clearReconnectTimer();
    if (ssePort) {
      try {
        ssePort.disconnect();
      } catch {
        // ignore disconnect errors
      }
      ssePort = null;
    }
  }

  window.addEventListener(PAGE_TO_CONTENT_EVENT, (evt: Event) => {
    const custom = evt as CustomEvent<PageToContentMessage>;
    const msg = custom.detail;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "cue:send") {
      chrome.runtime
        .sendMessage<CueDispatchResult>({
          type: "ext:send-cue",
          payload: msg.payload,
        })
        .then((result) => {
          dispatchToPage({
            type: "cue:result",
            reqId: msg.reqId,
            result: result || {
              ok: false,
              status: 0,
              error: "Empty response from extension background",
            },
          });
        })
        .catch((err) => {
          dispatchToPage({
            type: "cue:result",
            reqId: msg.reqId,
            result: {
              ok: false,
              status: 0,
              error: err instanceof Error ? err.message : "Extension bridge error",
            },
          });
        });
    } else if (msg.type === "sse:connect") {
      sseWanted = true;
      if (!ssePort) {
        connectSsePort();
      }
    } else if (msg.type === "sse:disconnect") {
      disconnectSsePort();
    }
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

initContentBridge();
