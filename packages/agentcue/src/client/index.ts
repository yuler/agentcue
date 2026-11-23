import { mountOverlay } from "./overlay.ts";

declare global {
  interface Window {
    __AGENTCUE_ORIGIN__?: string;
    __AGENTCUE_TOKEN__?: string;
    __AGENTCUE_INSTANCE__?: {
      togglePickMode: () => void;
      setActive?: (next: boolean) => void;
      isActive?: () => boolean;
    };
  }
}

function resolveOrigin(): string {
  if (typeof window !== "undefined" && window.__AGENTCUE_ORIGIN__) {
    return window.__AGENTCUE_ORIGIN__.replace(/\/+$/, "");
  }
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.src) {
    try {
      const u = new URL(
        current.src,
        typeof window !== "undefined" ? window.location.href : "http://localhost:4318"
      );
      const basePath = u.pathname.replace(/\/client\.js$/, "").replace(/\/+$/, "");
      return `${u.origin}${basePath}`;
    } catch {
      // fall through
    }
  }
  return "http://localhost:4318";
}

function resolveToken(): string | undefined {
  if (typeof window !== "undefined" && window.__AGENTCUE_TOKEN__) {
    const trimmed = window.__AGENTCUE_TOKEN__.trim();
    if (trimmed) return trimmed;
  }
  const current = document.currentScript as HTMLScriptElement | null;
  const dataToken = current?.getAttribute("data-token")?.trim();
  if (dataToken) return dataToken;
  if (current?.src) {
    try {
      const u = new URL(
        current.src,
        typeof window !== "undefined" ? window.location.href : "http://localhost:4318"
      );
      const queryToken = u.searchParams.get("token")?.trim();
      if (queryToken) return queryToken;
    } catch {
      // fall through
    }
  }
  return undefined;
}

function init() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__AGENTCUE_INSTANCE__) {
    window.__AGENTCUE_INSTANCE__.togglePickMode();
    return;
  }
  const origin = resolveOrigin();
  const token = resolveToken();
  if (token && !window.__AGENTCUE_TOKEN__) {
    window.__AGENTCUE_TOKEN__ = token;
  }
  const mount = () => {
    if (!window.__AGENTCUE_INSTANCE__) {
      window.__AGENTCUE_INSTANCE__ = mountOverlay(origin);
    }
  };
  if (document.documentElement) {
    mount();
  } else {
    window.addEventListener("DOMContentLoaded", mount, { once: true });
  }
}

init();
