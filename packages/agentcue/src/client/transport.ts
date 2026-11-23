import type { CuePayload, ServerEvent } from "../shared/types.ts";
import type { OverlayStateStore } from "./dom.ts";
import type { FrameworkHints } from "./extract.ts";

export interface CueDispatchResult {
  ok: boolean;
  status: number;
  cueId?: string;
  error?: string;
  queuePosition?: number;
}

export interface BridgeTransportHandlers {
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onError: () => void;
}

export interface BridgeTransport {
  sendCue: (payload: CuePayload) => Promise<CueDispatchResult>;
  subscribeEvents: (handlers: BridgeTransportHandlers) => () => void;
}

export interface MountOverlayOptions {
  transport?: BridgeTransport;
  startActive?: boolean;
  shadowMode?: "open" | "closed";
  requireTrustedSend?: boolean;
  resolveFrameworkHints?: (el: Element) => FrameworkHints | undefined;
  stateStore?: OverlayStateStore;
  hideLauncherWhenIdle?: boolean;
  onActiveChange?: (active: boolean) => void;
}

export interface OverlayInstance {
  togglePickMode: () => void;
  setActive: (next: boolean) => void;
  isActive: () => boolean;
  setHideLauncherWhenIdle: (next: boolean) => void;
  destroy: () => void;
}

export const STORAGE_TOKEN_KEY = "agentcue:bridge-token";

function readBrowserStoredToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const url = new URL(window.location.href);
    const paramToken = url.searchParams.get("agentcue_token")?.trim();
    if (paramToken) {
      try {
        sessionStorage.setItem(STORAGE_TOKEN_KEY, paramToken);
      } catch {
        // ignore storage errors
      }
      return paramToken;
    }
  } catch {
    // ignore URL errors
  }
  try {
    const stored =
      sessionStorage.getItem(STORAGE_TOKEN_KEY)?.trim() ||
      localStorage.getItem(STORAGE_TOKEN_KEY)?.trim();
    if (stored) return stored;
  } catch {
    // ignore storage errors
  }
  return undefined;
}

export function createHttpBridgeTransport(
  getOrigin: string | (() => string),
  getToken?: string | (() => string | undefined)
): BridgeTransport {
  const resolveOrigin = () =>
    (typeof getOrigin === "function" ? getOrigin() : getOrigin).replace(/\/+$/, "");
  const resolveToken = () => {
    if (typeof getToken === "function") return getToken();
    if (typeof getToken === "string") return getToken;
    if (typeof window !== "undefined") {
      const globalToken = (window as Window & { __AGENTCUE_TOKEN__?: string })
        .__AGENTCUE_TOKEN__?.trim();
      if (globalToken) return globalToken;
      return readBrowserStoredToken();
    }
    return undefined;
  };

  return {
    async sendCue(payload: CuePayload): Promise<CueDispatchResult> {
      const token = resolveToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["X-Agentcue-Token"] = token;
      }
      const res = await fetch(`${resolveOrigin()}/api/cue`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        cueId?: string;
        error?: string;
        queuePosition?: number;
      };
      return {
        ok: res.ok && Boolean(data.cueId),
        status: res.status,
        cueId: data.cueId,
        error: data.error,
        queuePosition: data.queuePosition,
      };
    },
    subscribeEvents(handlers: BridgeTransportHandlers): () => void {
      const token = resolveToken();
      const eventsUrl = token
        ? `${resolveOrigin()}/api/events?token=${encodeURIComponent(token)}`
        : `${resolveOrigin()}/api/events`;
      const es = new EventSource(eventsUrl);
      es.onopen = () => handlers.onOpen();
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as ServerEvent;
          handlers.onEvent(event);
        } catch {
          // ignore malformed frames
        }
      };
      es.onerror = () => handlers.onError();
      return () => es.close();
    },
  };
}
