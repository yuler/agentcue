import type { FrameworkHints } from "../../agentcue/src/client/extract.ts";
import type { CueDispatchResult } from "../../agentcue/src/client/transport.ts";
import {
  sanitizeComponentStack,
  sanitizeSourceHint,
} from "../../agentcue/src/shared/prompt.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type CuePayload,
  type DispatcherState,
  type ServerEvent,
} from "../../agentcue/src/shared/types.ts";

export const DEFAULT_BRIDGE_ORIGIN = "http://localhost:4318";
export const STORAGE_SETTINGS_KEY = "agentcue:extension-settings";
export const STORAGE_SELECTED_AGENT_KEY = "agentcue:extension-selected-agent";
export const SSE_PORT_NAME = "agentcue-sse";

/** Read-only DOM events for extracting optional MAIN-world framework hints (never carries commands). */
export const HINT_REQUEST_EVENT = "__agentcue_hint_req__";
export const HINT_RESPONSE_EVENT = "__agentcue_hint_res__";

export interface ExtensionSettings {
  bridgeOrigin: string;
  enabled: boolean;
  showFloatingBar: boolean;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  bridgeOrigin: DEFAULT_BRIDGE_ORIGIN,
  enabled: true,
  showFloatingBar: true,
};

export type SsePortMessage =
  | { type: "sse:open"; bridgeOrigin: string }
  | { type: "sse:event"; event: ServerEvent }
  | { type: "sse:error" };

export type TabCommandMessage =
  | { type: "ext:boot"; bridgeOrigin: string; showFloatingBar?: boolean }
  | { type: "ext:get-state" }
  | {
      type: "ext:sync-settings";
      enabled: boolean;
      showFloatingBar: boolean;
      bridgeOrigin: string;
    };

export type RuntimeRequestMessage =
  | { type: "ext:toggle-tab"; tabId: number; tabUrl?: string }
  | { type: "ext:tab-state"; tabId: number; tabUrl?: string }
  | {
      type: "ext:update-settings";
      enabled?: boolean;
      showFloatingBar?: boolean;
      tabId?: number;
      tabUrl?: string;
    }
  | { type: "ext:active-changed"; active: boolean }
  | { type: "ext:embedded-detected"; embeddedSource: EmbeddedSdkSource }
  | { type: "ext:send-cue"; payload: CuePayload }
  | { type: "ext:check-bridge"; bridgeOrigin?: string };

export type EmbeddedSdkSource = "vite" | "script" | "sdk";

export interface TabStateResult {
  injectable: boolean;
  active: boolean;
  embedded: boolean;
  embeddedSource?: EmbeddedSdkSource;
  enabled: boolean;
  showFloatingBar: boolean;
}

export interface TabToggleResult {
  ok: boolean;
  active: boolean;
  embedded?: boolean;
  embeddedSource?: EmbeddedSdkSource;
  disabled?: boolean;
  error?: string;
}

export interface BridgeHealthResult {
  ok: boolean;
  bridgeOrigin: string;
  state?: DispatcherState;
  error?: string;
}

/**
 * Strictly validates and bounds untrusted framework hints extracted from the
 * page's MAIN world. Never trusts arbitrary object prototypes, path traversal,
 * or prompt injection strings.
 */
export function sanitizeFrameworkHints(raw: unknown): FrameworkHints {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, unknown>;
  const sourceHint = sanitizeSourceHint(obj.sourceHint);
  const componentStack = sanitizeComponentStack(obj.componentStack);
  return {
    ...(sourceHint ? { sourceHint } : {}),
    ...(componentStack ? { componentStack } : {}),
  };
}

export function isValidCuePayload(raw: unknown): raw is CuePayload {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.agent !== "string" ||
    !SUPPORTED_AGENTS.includes(obj.agent as AgentId)
  ) {
    return false;
  }
  if (typeof obj.continueSession !== "boolean") return false;
  if (typeof obj.pageUrl !== "string" || typeof obj.pageTitle !== "string") {
    return false;
  }
  if (!Array.isArray(obj.pins) || obj.pins.length === 0) return false;
  for (const pin of obj.pins) {
    if (!pin || typeof pin !== "object") return false;
    const p = pin as Record<string, unknown>;
    if (typeof p.note !== "string" || !p.note.trim()) return false;
    if (!p.context || typeof p.context !== "object") return false;
  }
  return true;
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
    if (!isLocalhostUrl(parsed.origin)) {
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
    enabled:
      typeof obj.enabled === "boolean"
        ? obj.enabled
        : DEFAULT_EXTENSION_SETTINGS.enabled,
    showFloatingBar:
      typeof obj.showFloatingBar === "boolean"
        ? obj.showFloatingBar
        : DEFAULT_EXTENSION_SETTINGS.showFloatingBar,
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
