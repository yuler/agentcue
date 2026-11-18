import type { CueDispatchResult } from "../../agentcue/src/client/transport.ts";
import type {
  CuePayload,
  DispatcherState,
  ServerEvent,
} from "../../agentcue/src/shared/types.ts";

export const DEFAULT_BRIDGE_ORIGIN = "http://localhost:4318";
export const STORAGE_SETTINGS_KEY = "agentcue:extension-settings";
export const SSE_PORT_NAME = "agentcue-sse";

export const PAGE_TO_CONTENT_EVENT = "__agentcue_ext_to_bg__";
export const CONTENT_TO_PAGE_EVENT = "__agentcue_ext_to_page__";

export interface ExtensionSettings {
  bridgeOrigin: string;
  autoMountLocalhost: boolean;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  bridgeOrigin: DEFAULT_BRIDGE_ORIGIN,
  autoMountLocalhost: true,
};

export type PageToContentMessage =
  | { type: "cue:send"; reqId: string; payload: CuePayload }
  | { type: "sse:connect" }
  | { type: "sse:disconnect" };

export type ContentToPageMessage =
  | { type: "cue:result"; reqId: string; result: CueDispatchResult }
  | { type: "sse:open"; bridgeOrigin: string }
  | { type: "sse:event"; event: ServerEvent }
  | { type: "sse:error" };

export type RuntimeRequestMessage =
  | { type: "ext:content-ready"; url: string }
  | { type: "ext:send-cue"; payload: CuePayload }
  | { type: "ext:check-bridge"; bridgeOrigin?: string };

export interface BridgeHealthResult {
  ok: boolean;
  bridgeOrigin: string;
  state?: DispatcherState;
  error?: string;
}

export function normalizeBridgeOrigin(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_BRIDGE_ORIGIN;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_BRIDGE_ORIGIN;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const withScheme = hasScheme ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_BRIDGE_ORIGIN;
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return DEFAULT_BRIDGE_ORIGIN;
  }
}

export function normalizeSettings(raw: unknown): ExtensionSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_EXTENSION_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    bridgeOrigin: normalizeBridgeOrigin(obj.bridgeOrigin),
    autoMountLocalhost:
      typeof obj.autoMountLocalhost === "boolean"
        ? obj.autoMountLocalhost
        : DEFAULT_EXTENSION_SETTINGS.autoMountLocalhost,
  };
}

export function isLocalhostUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]" ||
      u.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function isInjectableTabUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:";
  } catch {
    return false;
  }
}

export async function sendCueToBridge(
  bridgeOrigin: string,
  payload: CuePayload
): Promise<CueDispatchResult> {
  const origin = normalizeBridgeOrigin(bridgeOrigin);
  try {
    const res = await fetch(`${origin}/api/cue`, {
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
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

export async function fetchBridgeState(
  bridgeOrigin: string
): Promise<BridgeHealthResult> {
  const origin = normalizeBridgeOrigin(bridgeOrigin);
  try {
    const res = await fetch(`${origin}/api/state`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return {
        ok: false,
        bridgeOrigin: origin,
        error: `HTTP ${res.status}`,
      };
    }
    const state = (await res.json()) as DispatcherState;
    return { ok: true, bridgeOrigin: origin, state };
  } catch (err) {
    return {
      ok: false,
      bridgeOrigin: origin,
      error: err instanceof Error ? err.message : "Offline",
    };
  }
}

export async function consumeSseResponse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ServerEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawBlock = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const dataLines: string[] = [];
        for (const line of rawBlock.split(/\r?\n/)) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length > 0) {
          try {
            const parsed = JSON.parse(dataLines.join("\n")) as ServerEvent;
            onEvent(parsed);
          } catch {
            // ignore malformed JSON frames
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
