import { OVERLAY_CSS } from "./styles.ts";
import { extractPinContext, type FrameworkHints } from "./extract.ts";
import type { AgentId, CuePayload, DispatcherState, PinContext } from "../shared/types.ts";

export function computeStatusView(
  connected: boolean,
  serverState: DispatcherState | null,
  selectedAgent: AgentId
): { dotClass: string; statusTip: string; compactRunning: string } {
  let dotClass = "status-dot";
  let statusTip = `Agent: ${selectedAgent} · A`;
  let compactRunning = "";
  if (!connected) {
    dotClass = "status-dot offline";
    statusTip = `Offline (Copy only) · ${selectedAgent} (A)`;
  } else if (serverState?.activeCue) {
    dotClass = "status-dot running";
    const extra = serverState.queuedCount > 0 ? ` (+${serverState.queuedCount})` : "";
    compactRunning = `${serverState.activeCue.agent} editing…${extra}`;
    statusTip = `${compactRunning} · A`;
  } else if (serverState?.status === "error" && serverState.lastResult) {
    dotClass = "status-dot error";
    statusTip = `Error ✗ · ${selectedAgent} (A)`;
  } else if (serverState?.status === "done" && serverState.lastResult) {
    const secs = (serverState.lastResult.durationMs / 1000).toFixed(1);
    statusTip = `Done ✓ (${secs}s) · ${selectedAgent} (A)`;
  }
  return { dotClass, statusTip, compactRunning };
}

export interface ActivePin {
  id: string;
  el: Element;
  relX: number;
  relY: number;
  note: string;
  context: PinContext;
}

export function createPinFromPoint(
  clientX: number,
  clientY: number,
  host: Element,
  resolveFrameworkHints?: (el: Element) => FrameworkHints | undefined
): ActivePin | null {
  const raw = document.elementFromPoint(clientX, clientY);
  const target = raw === document.documentElement ? document.body || raw : raw;
  if (!target || target === host) return null;
  const rect = target.getBoundingClientRect();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    el: target,
    relX: rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0.1, 0.9) : 0.5,
    relY: rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0.1, 0.9) : 0.5,
    note: "",
    context: extractPinContext(target, resolveFrameworkHints),
  };
}

export function buildCuePayload(
  agent: AgentId,
  continueSession: boolean,
  readyPins: ActivePin[]
): CuePayload {
  return {
    agent,
    continueSession,
    pageUrl: window.location.href,
    pageTitle: document.title,
    pins: readyPins.map((p, idx) => ({
      index: idx + 1,
      note: p.note.trim(),
      context: p.context,
    })),
  };
}

const STORAGE_AGENT_KEY = "agentcue:selected-agent";
const STORAGE_SESSIONS_KEY = "agentcue:active-sessions";

export interface OverlayStateStore {
  getSelectedAgent: () => string | null;
  setSelectedAgent: (agent: AgentId) => void;
  loadActiveSessions: () => Set<AgentId>;
  saveActiveSessions: (sessions: Set<AgentId>) => void;
}

export function loadActiveSessions(): Set<AgentId> {
  try {
    const raw = sessionStorage.getItem(STORAGE_SESSIONS_KEY);
    return raw ? new Set(JSON.parse(raw) as AgentId[]) : new Set();
  } catch {
    return new Set();
  }
}

export function saveActiveSessions(sessions: Set<AgentId>) {
  try {
    sessionStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify([...sessions]));
  } catch {
    // ignore storage errors
  }
}

export function createBrowserOverlayStateStore(): OverlayStateStore {
  return {
    getSelectedAgent: () => {
      try {
        return localStorage.getItem(STORAGE_AGENT_KEY);
      } catch {
        return null;
      }
    },
    setSelectedAgent: (agent: AgentId) => {
      try {
        localStorage.setItem(STORAGE_AGENT_KEY, agent);
      } catch {
        // ignore storage errors
      }
    },
    loadActiveSessions,
    saveActiveSessions,
  };
}

export function syncBadgeDom(
  pinsLayer: HTMLDivElement,
  badgeEls: Map<string, HTMLDivElement>,
  pins: ActivePin[],
  activePinId: string | null,
  onBadgeClick: (pinId: string) => void
) {
  const activeIds = new Set(pins.map((p) => p.id));
  for (const [id, badge] of badgeEls) {
    if (!activeIds.has(id)) {
      badgeEls.delete(id);
      badge.classList.add("removing");
      setTimeout(() => badge.remove(), 170);
    }
  }
  pins.forEach((pin, idx) => {
    const { x, y } = pinCoords(pin);
    let badge = badgeEls.get(pin.id);
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "pin-badge";
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        onBadgeClick(pin.id);
      });
      badgeEls.set(pin.id, badge);
      pinsLayer.appendChild(badge);
    }
    badge.classList.toggle("active", pin.id === activePinId);
    badge.textContent = String(idx + 1);
    badge.style.left = `${Math.round(x)}px`;
    badge.style.top = `${Math.round(y)}px`;
    badge.title = pin.note || pin.context.selector;
  });
}

export function renderAgentMenuDom(
  agentLabel: HTMLSpanElement,
  agentMenuList: HTMLDivElement,
  list: AgentId[],
  selectedAgent: AgentId,
  onSelect: (agent: AgentId) => void
) {
  agentLabel.textContent = selectedAgent;
  agentMenuList.innerHTML = "";
  list.forEach((agent, idx) => {
    const btn = document.createElement("button");
    btn.className = agent === selectedAgent ? "agent-opt selected" : "agent-opt";
    const left = document.createElement("span");
    left.className = "agent-opt-left";
    const dot = document.createElement("span");
    dot.className = "agent-opt-dot";
    const name = document.createElement("span");
    name.textContent = agent;
    left.appendChild(dot);
    left.appendChild(name);
    const kbd = document.createElement("span");
    kbd.className = "agent-opt-kbd";
    kbd.textContent = String(idx + 1);
    btn.appendChild(left);
    btn.appendChild(kbd);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(agent);
    });
    agentMenuList.appendChild(btn);
  });
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}

export function isTypingInField(e: KeyboardEvent): boolean {
  for (const node of e.composedPath()) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable) {
        return true;
      }
    }
  }
  return false;
}

export function pinCoords(pin: ActivePin): { x: number; y: number } {
  const rect = pin.el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return {
      x: clamp(pin.context.boundingBox.x + 16, 16, window.innerWidth - 16),
      y: clamp(pin.context.boundingBox.y + 16, 16, window.innerHeight - 16),
    };
  }
  return {
    x: clamp(rect.left + rect.width * pin.relX, 14, window.innerWidth - 14),
    y: clamp(rect.top + rect.height * pin.relY, 14, window.innerHeight - 14),
  };
}

export function positionPopoverEl(popover: HTMLDivElement, pin: ActivePin, glide = false) {
  const { x, y } = pinCoords(pin);
  const popW = 310;
  const popH = 165;
  let left = x + 18;
  let originX = "0px";
  if (left + popW > window.innerWidth - 12) {
    left = Math.max(12, x - popW - 18);
    originX = "100%";
  }
  let top = y - 16;
  let originY = "20px";
  if (top + popH > window.innerHeight - 64) {
    top = Math.max(12, window.innerHeight - popH - 64);
    originY = `${clamp(Math.round(y - top), 16, popH - 16)}px`;
  }
  popover.classList.toggle("no-glide", !glide);
  popover.style.transformOrigin = `${originX} ${originY}`;
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

export function renderHoverElements(
  hoverBox: HTMLDivElement,
  hoverTag: HTMLDivElement,
  el: Element | null,
  enabled: boolean,
  resolveFrameworkHints?: (el: Element) => FrameworkHints | undefined
) {
  if (!enabled || !el) {
    hoverBox.classList.remove("visible");
    hoverTag.classList.remove("visible");
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    hoverBox.classList.remove("visible");
    hoverTag.classList.remove("visible");
    return;
  }
  const isRoot = el === document.body || el === document.documentElement;
  const boxLeft = isRoot ? Math.max(4, Math.round(rect.left)) : Math.round(rect.left);
  const boxTop = isRoot ? Math.max(4, Math.round(rect.top)) : Math.round(rect.top);
  const boxRight = isRoot
    ? Math.min(window.innerWidth - 4, Math.round(rect.right))
    : Math.round(rect.right);
  const boxBottom = isRoot
    ? Math.min(window.innerHeight - 4, Math.round(rect.bottom))
    : Math.round(rect.bottom);

  hoverBox.style.left = `${boxLeft}px`;
  hoverBox.style.top = `${boxTop}px`;
  hoverBox.style.width = `${Math.max(0, boxRight - boxLeft)}px`;
  hoverBox.style.height = `${Math.max(0, boxBottom - boxTop)}px`;
  hoverBox.classList.add("visible");

  const ctx = extractPinContext(el, resolveFrameworkHints);
  const shortTag = `${ctx.tagName}${el.id ? `#${el.id}` : el.classList[0] ? `.${el.classList[0]}` : ""} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
  const hint = ctx.sourceHint || ctx.componentStack || "";
  hoverTag.innerHTML = "";
  hoverTag.appendChild(document.createTextNode(shortTag));
  if (hint) {
    const span = document.createElement("span");
    span.className = "hint-source";
    span.textContent = hint;
    hoverTag.appendChild(span);
  }

  const tagTop =
    boxTop >= 28
      ? boxTop - 24
      : boxBottom <= window.innerHeight - 32
        ? boxBottom + 6
        : boxTop + 8;
  hoverTag.style.left = `${clamp(isRoot ? boxLeft + 8 : boxLeft, 8, window.innerWidth - 240)}px`;
  hoverTag.style.top = `${Math.round(tagTop)}px`;
  hoverTag.classList.add("visible");
}

export const ICON_LOGO = `<svg class="launcher-logo" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.8 8.79A5 5 0 0 1 8.79 5.8M2.04 7.42A9 9 0 0 1 7.42 2.04" stroke="#60a5fa" stroke-width="2.25" stroke-linecap="round"/><path d="M10.5 10.5L22 14.8L16.9 16.9L14.8 22Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
export const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="9" y1="6" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="18"/></svg>`;
export const ICON_PICK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`;
export const ICON_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
export const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A11 11 0 0 1 12 5c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6C4 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;

export function createOverlayDom(
  modEnterLabel: string,
  activateKeyLabel: string,
  shadowMode: "open" | "closed" = "open"
) {
  const host = document.createElement("agentcue-root");
  if (shadowMode === "open") {
    host.setAttribute("data-agentcue-embedded", "true");
  }
  const shadow = host.attachShadow({ mode: shadowMode });

  shadow.innerHTML = `
    <style>${OVERLAY_CSS}</style>
    <div class="hover-box" id="hoverBox"></div>
    <div class="hover-tag" id="hoverTag"></div>
    <div class="pins-layer" id="pinsLayer"></div>
    <div class="popover no-glide" id="popover">
      <div class="popover-header">
        <div class="popover-target">
          <span class="num" id="popNum">#1</span>
          <span class="sel" id="popSel">button</span>
        </div>
        <button class="icon-btn" id="popDelete" title="Delete Pin">Delete</button>
      </div>
      <textarea id="popInput" rows="2" placeholder="Describe the UI change…"></textarea>
      <div class="popover-footer">
        <span class="popover-hints">↵ Save & next · ⇧↵ Newline</span>
        <div class="popover-actions">
          <button class="btn-sm" id="popSave">Save</button>
          <button class="btn-sm primary" id="popSend">Send ${modEnterLabel}</button>
        </div>
      </div>
    </div>
    <div class="capsule-wrap">
      <div class="agent-menu" id="agentMenu">
        <div class="agent-menu-header">
          <span>Agent Target</span>
          <span>A / 1-5</span>
        </div>
        <div id="agentMenuList"></div>
      </div>
      <div class="toolbar-stage">
        <button class="launcher" id="launcherBtn" title="Activate agentcue (${activateKeyLabel})">
          <span class="status-dot offline" id="launcherDot"></span>
          <span class="launcher-icon-wrap">
            ${ICON_LOGO}
            <svg class="launcher-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <span class="launcher-text" id="launcherText"></span>
          <span class="launcher-count" id="launcherCount">0</span>
        </button>
        <div class="capsule" id="capsule">
          <div class="capsule-inner">
            <button class="tool-btn" id="pickBtn" data-tip="Pick Mode · P">${ICON_PAUSE}</button>
            <button class="tool-btn" id="hideBtn" data-tip="Hide Pins · H" disabled>${ICON_EYE}</button>
            <button class="tool-btn copy-btn" id="copyBtn" data-tip="Copy Markdown · C" disabled>
              <svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="tool-btn" id="clearBtn" data-tip="Clear Pins · X" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button class="tool-btn send-btn" id="sendBtn" data-tip="Send Cue · S / ${modEnterLabel}" disabled>
              <span class="send-icon-wrap">
                <svg class="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <svg class="icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none"/></svg>
              </span>
              <span class="send-count" id="sendCount"></span>
            </button>
            <div class="sep"></div>
            <button class="tool-btn agent-btn" id="agentBtn" data-tip="Switch Agent · A">
              <span class="status-dot offline" id="statusDot"></span>
              <span class="agent-name" id="agentLabel">agy</span>
              <span class="kbd">A</span>
            </button>
            <button class="tool-btn cont-btn" id="contBtn" data-tip="New Session (first Cue) · R">
              <svg class="icon-reset" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <div class="sep"></div>
            <button class="tool-btn" id="collapseBtn" data-tip="Collapse · Esc">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.documentElement.appendChild(host);
  const $ = <T extends HTMLElement>(id: string) =>
    shadow.getElementById(id) as T;

  return {
    host,
    shadow,
    hoverBox: $<HTMLDivElement>("hoverBox"),
    hoverTag: $<HTMLDivElement>("hoverTag"),
    pinsLayer: $<HTMLDivElement>("pinsLayer"),
    popover: $<HTMLDivElement>("popover"),
    popNum: $<HTMLSpanElement>("popNum"),
    popSel: $<HTMLSpanElement>("popSel"),
    popDelete: $<HTMLButtonElement>("popDelete"),
    popInput: $<HTMLTextAreaElement>("popInput"),
    popSave: $<HTMLButtonElement>("popSave"),
    popSend: $<HTMLButtonElement>("popSend"),
    agentMenu: $<HTMLDivElement>("agentMenu"),
    agentMenuList: $<HTMLDivElement>("agentMenuList"),
    launcherBtn: $<HTMLButtonElement>("launcherBtn"),
    launcherDot: $<HTMLSpanElement>("launcherDot"),
    launcherText: $<HTMLSpanElement>("launcherText"),
    launcherCount: $<HTMLSpanElement>("launcherCount"),
    capsule: $<HTMLDivElement>("capsule"),
    statusDot: $<HTMLSpanElement>("statusDot"),
    pickBtn: $<HTMLButtonElement>("pickBtn"),
    agentBtn: $<HTMLButtonElement>("agentBtn"),
    agentLabel: $<HTMLSpanElement>("agentLabel"),
    contBtn: $<HTMLButtonElement>("contBtn"),
    hideBtn: $<HTMLButtonElement>("hideBtn"),
    copyBtn: $<HTMLButtonElement>("copyBtn"),
    clearBtn: $<HTMLButtonElement>("clearBtn"),
    sendBtn: $<HTMLButtonElement>("sendBtn"),
    sendCount: $<HTMLSpanElement>("sendCount"),
    collapseBtn: $<HTMLButtonElement>("collapseBtn"),
  };
}
