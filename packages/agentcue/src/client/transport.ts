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
      return (window as Window & { __AGENTCUE_TOKEN__?: string })
        .__AGENTCUE_TOKEN__;
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
