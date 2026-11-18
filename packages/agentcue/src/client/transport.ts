import type { CuePayload, ServerEvent } from "../shared/types.ts";

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

export function createHttpBridgeTransport(
  getOrigin: string | (() => string)
): BridgeTransport {
  const resolveOrigin = () =>
    (typeof getOrigin === "function" ? getOrigin() : getOrigin).replace(/\/+$/, "");

  return {
    async sendCue(payload: CuePayload): Promise<CueDispatchResult> {
      const res = await fetch(`${resolveOrigin()}/api/cue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const es = new EventSource(`${resolveOrigin()}/api/events`);
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
