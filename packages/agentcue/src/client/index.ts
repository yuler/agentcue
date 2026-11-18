import { mountOverlay } from "./overlay.ts";

declare global {
  interface Window {
    __AGENTCUE_ORIGIN__?: string;
    __AGENTCUE_INSTANCE__?: { togglePickMode: () => void };
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

function init() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__AGENTCUE_INSTANCE__) {
    window.__AGENTCUE_INSTANCE__.togglePickMode();
    return;
  }
  const origin = resolveOrigin();
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
