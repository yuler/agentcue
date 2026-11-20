/**
 * Hero intro stage: builds the abstract browser + terminal "world" and mounts a
 * static replica of the real agentcue toolbar (same OVERLAY_CSS and icons) in
 * its own Shadow DOM so it looks identical to the product.
 */
import { OVERLAY_CSS } from "../../../../packages/agentcue/src/client/styles.ts";
import {
  ICON_EYE,
  ICON_LOGO,
  ICON_PAUSE,
} from "../../../../packages/agentcue/src/client/dom.ts";

export const WORLD_W = 960;
export const WORLD_H = 540;

/** World-space layout (px). Viewport-relative values are offsets inside the browser viewport. */
export const LAYOUT = {
  viewport: { x: 24, y: 70, w: 548, h: 434 },
  button: { x: 40, y: 186, w: 150, h: 40 },
  click: { x: 130, y: 206 },
  popover: { x: 148, y: 190 },
};

export type Point = { x: number; y: number };

export interface Anchors {
  capsule: Point;
  sendBtn: Point;
  launcher: Point;
  terminalBody: Point;
}

const SVG_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const SVG_SEND = `<svg class="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
const SVG_CHECK = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_RESET = `<svg class="icon-reset" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
const SVG_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_CURSOR = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="var(--intro-cursor-fill)" stroke="var(--intro-cursor-stroke)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

/** Overrides that re-home the fixed-position overlay into the stage's coordinate space. */
const STAGE_OVERRIDES = `
:host { position: absolute; inset: 0; z-index: auto; pointer-events: none; }
.hover-box, .hover-tag, .pins-layer, .pin-badge, .popover, .capsule-wrap { position: absolute; }
* { pointer-events: none !important; cursor: default !important; }
.popover textarea { resize: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.22); }
:host(.measuring) *, :host(.measuring) *::before, :host(.measuring) *::after {
  transition: none !important; animation: none !important;
}
`;

const OVERLAY_HTML = `
<style>${OVERLAY_CSS}${STAGE_OVERRIDES}</style>
<div class="hover-box" id="hoverBox"></div>
<div class="hover-tag" id="hoverTag">button.cta · 150×40<span class="hint-source">src/App.tsx:12</span></div>
<div class="pins-layer"><div class="pin-badge active" id="pin" style="display:none">1</div></div>
<div class="popover no-glide" id="popover">
  <div class="popover-header">
    <div class="popover-target"><span class="num">#1</span><span class="sel">button.cta</span></div>
    <button class="icon-btn" tabindex="-1">Delete</button>
  </div>
  <textarea id="popInput" rows="2" readonly tabindex="-1" placeholder="Describe the UI change…"></textarea>
  <div class="popover-footer">
    <span class="popover-hints">↵ Save & next · ⇧↵ Newline</span>
    <div class="popover-actions">
      <button class="btn-sm" tabindex="-1">Save</button>
      <button class="btn-sm primary" id="popSend" tabindex="-1">Send</button>
    </div>
  </div>
</div>
<div class="capsule-wrap">
  <div class="toolbar-stage">
    <button class="launcher" id="launcher" tabindex="-1">
      <span class="status-dot" id="launcherDot"></span>
      <span class="launcher-icon-wrap">${ICON_LOGO}${SVG_CHECK("launcher-check")}</span>
      <span class="launcher-text" id="launcherText"></span>
    </button>
    <div class="capsule" id="capsule">
      <div class="capsule-inner">
        <button class="tool-btn pick-active" tabindex="-1">${ICON_PAUSE}</button>
        <button class="tool-btn" id="hideBtn" tabindex="-1" disabled>${ICON_EYE}</button>
        <button class="tool-btn copy-btn" id="copyBtn" tabindex="-1" disabled>${SVG_COPY}</button>
        <button class="tool-btn" id="clearBtn" tabindex="-1" disabled>${SVG_TRASH}</button>
        <button class="tool-btn send-btn" id="sendBtn" tabindex="-1" disabled>
          <span class="send-icon-wrap">${SVG_SEND}${SVG_CHECK("icon-check")}</span>
          <span class="send-count" id="sendCount"></span>
        </button>
        <div class="sep"></div>
        <button class="tool-btn agent-btn" tabindex="-1">
          <span class="status-dot" id="statusDot"></span>
          <span class="agent-name">agy</span>
          <span class="kbd">A</span>
        </button>
        <button class="tool-btn cont-btn" tabindex="-1">${SVG_RESET}</button>
        <div class="sep"></div>
        <button class="tool-btn" tabindex="-1">${SVG_CLOSE}</button>
      </div>
    </div>
  </div>
</div>
`;

const TERMINAL_HTML = `
<div class="terminal-header">
  <div class="terminal-dots" aria-hidden="true">
    <span class="terminal-dot red"></span><span class="terminal-dot yellow"></span><span class="terminal-dot green"></span>
  </div>
  <div class="terminal-title" data-i="termTitle">zsh — ~/projects/my-web-app</div>
  <div class="terminal-status" data-i="termStatus" data-state="idle">
    <span class="terminal-status-dot"></span><span data-i="termStatusText">READY :4318</span>
  </div>
</div>
<div class="intro-term-body">
  <div class="intro-tl on"><span class="term-prompt">~/projects/my-web-app $</span> <span class="term-cmd">npx agentcue</span></div>
  <div class="intro-tl on"><span class="term-brand">✦ agentcue</span> bridge listening on <span class="term-bold">:4318</span></div>
  <div class="intro-tl on"><span class="term-dim">  Agents :</span> <span class="term-ok">✓ agy</span> <span class="term-ok">✓ claude</span> <span class="term-ok">✓ codex</span> <span class="term-dim">+2</span></div>
  <div class="intro-tl" data-at="0" data-until="8.75"> </div>
  <div class="intro-tl term-comment" data-at="0" data-until="8.75"># Waiting for your first Cue…</div>
  <div class="intro-tl" data-at="8.75"> </div>
  <div class="intro-tl" data-at="8.75"><span class="term-info">▶ [agentcue]</span> Running <span class="term-bold">agy</span> <span class="term-dim">· 1 pin</span></div>
  <div class="intro-tl" data-at="9.0"><span class="term-prompt">$</span> <span class="term-cmd">agy --dangerously-skip-permissions -p "&lt;cue&gt;"</span></div>
  <div class="intro-tl intro-term-payload" data-at="9.25"><span class="term-bold">#1</span> button.cta <span class="term-dim">src/App.tsx:12</span>
   <span data-i="termNote"></span></div>
  <div class="intro-tl" data-at="9.8"><span class="term-running">⟳ editing src/App.tsx…</span></div>
  <div class="intro-tl" data-at="10.4"><span class="intro-diff-del">- className="bg-blue-600"</span></div>
  <div class="intro-tl" data-at="10.55"><span class="intro-diff-add">+ className="bg-emerald-500"</span></div>
  <div class="intro-tl" data-at="11.0"><span class="term-ok">✓ [agentcue]</span> <span class="term-bold">agy</span> done <span class="term-dim">(2.4s)</span> · HMR reloaded<span class="term-cursor" aria-hidden="true"></span></div>
</div>
`;

const PAGE_HTML = `
<div class="sk" style="left:24px;top:20px;width:64px;height:12px"></div>
<div class="sk" style="left:380px;top:20px;width:40px;height:12px"></div>
<div class="sk" style="left:432px;top:20px;width:40px;height:12px"></div>
<div class="sk" style="left:484px;top:20px;width:40px;height:12px"></div>
<div class="sk sk-strong" style="left:40px;top:72px;width:300px;height:22px"></div>
<div class="sk sk-strong" style="left:40px;top:102px;width:210px;height:22px"></div>
<div class="sk" style="left:40px;top:140px;width:380px;height:9px"></div>
<div class="sk" style="left:40px;top:156px;width:330px;height:9px"></div>
<div class="intro-cta" data-i="cta" style="left:40px;top:186px;width:150px;height:40px"><span></span></div>
<div class="sk sk-ghost" style="left:202px;top:186px;width:110px;height:40px"></div>
<div class="sk sk-card" style="left:40px;top:262px;width:148px;height:120px"></div>
<div class="sk sk-card" style="left:200px;top:262px;width:148px;height:120px"></div>
<div class="sk sk-card" style="left:360px;top:262px;width:148px;height:120px"></div>
`;

export interface StageRefs {
  root: HTMLElement;
  frame: HTMLElement;
  world: HTMLElement;
  overlayHost: HTMLElement;
  cta: HTMLElement;
  hmr: HTMLElement;
  cursor: HTMLElement;
  ripple: HTMLElement;
  packet: HTMLElement;
  keys: HTMLElement;
  termTitle: HTMLElement;
  termStatus: HTMLElement;
  termStatusText: HTMLElement;
  termNote: HTMLElement;
  termLines: HTMLElement[];
  terminal: HTMLElement;
  steps: HTMLButtonElement[];
  captions: HTMLElement[];
  tryLink: HTMLButtonElement;
  ov: {
    hoverBox: HTMLElement;
    hoverTag: HTMLElement;
    pin: HTMLElement;
    popover: HTMLElement;
    popInput: HTMLTextAreaElement;
    launcher: HTMLElement;
    launcherDot: HTMLElement;
    launcherText: HTMLElement;
    capsule: HTMLElement;
    statusDot: HTMLElement;
    hideBtn: HTMLButtonElement;
    copyBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
    sendBtn: HTMLButtonElement;
    sendCount: HTMLElement;
  };
}

export interface StepCopy {
  en: string;
  zh: string;
  captionEn: string;
  captionZh: string;
}

function attr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function buildStage(mount: HTMLElement, steps: StepCopy[]): StageRefs {
  mount.innerHTML = `
    <div class="intro-frame" role="img">
      <div class="intro-world">
        <div class="intro-browser">
          <div class="intro-titlebar"><i></i><i></i><i></i><span class="intro-address"></span></div>
          <div class="intro-viewport">
            <div class="intro-page">${PAGE_HTML}</div>
            <div class="intro-hmr" data-i="hmr"></div>
            <div class="intro-overlay" data-i="overlay"></div>
          </div>
        </div>
        <div class="terminal-window intro-terminal" data-i="terminal">${TERMINAL_HTML}</div>
        <div class="intro-packet" data-i="packet"></div>
        <div class="intro-ripple" data-i="ripple"></div>
        <div class="intro-cursor" data-i="cursor">${SVG_CURSOR}</div>
      </div>
      <div class="intro-keys" data-i="keys" aria-hidden="true"></div>
    </div>
    <div class="intro-controls">
      <div class="intro-steps">
        ${steps
          .map(
            (s, i) =>
              `<button type="button" class="intro-step" data-step="${i}"><span class="intro-step-num">${i + 1}</span><span data-en="${attr(s.en)}" data-zh="${attr(s.zh)}">${s.en}</span></button>`,
          )
          .join("")}
      </div>
      <div class="intro-captions">
        ${steps
          .map(
            (s) =>
              `<p class="intro-caption" data-en="${attr(s.captionEn)}" data-zh="${attr(s.captionZh)}">${s.captionEn}</p>`,
          )
          .join("")}
      </div>
      <button type="button" class="intro-try" data-en="↓ Try it live" data-zh="↓ 亲手试试">↓ Try it live</button>
    </div>
  `;

  const q = <T extends HTMLElement>(sel: string) => mount.querySelector<T>(sel) as T;
  const qi = <T extends HTMLElement>(name: string) => q<T>(`[data-i="${name}"]`);

  const overlayHost = qi("overlay");
  const shadow = overlayHost.attachShadow({ mode: "open" });
  shadow.innerHTML = OVERLAY_HTML;
  const s = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;

  return {
    root: mount,
    frame: q(".intro-frame"),
    world: q(".intro-world"),
    overlayHost,
    cta: qi("cta"),
    hmr: qi("hmr"),
    cursor: qi("cursor"),
    ripple: qi("ripple"),
    packet: qi("packet"),
    keys: qi("keys"),
    termTitle: qi("termTitle"),
    termStatus: qi("termStatus"),
    termStatusText: qi("termStatusText"),
    termNote: qi("termNote"),
    termLines: [...mount.querySelectorAll<HTMLElement>(".intro-tl[data-at]")],
    terminal: qi("terminal"),
    steps: [...mount.querySelectorAll<HTMLButtonElement>(".intro-step")],
    captions: [...mount.querySelectorAll<HTMLElement>(".intro-caption")],
    tryLink: q(".intro-try"),
    ov: {
      hoverBox: s("hoverBox"),
      hoverTag: s("hoverTag"),
      pin: s("pin"),
      popover: s("popover"),
      popInput: s("popInput"),
      launcher: s("launcher"),
      launcherDot: s("launcherDot"),
      launcherText: s("launcherText"),
      capsule: s("capsule"),
      statusDot: s("statusDot"),
      hideBtn: s("hideBtn"),
      copyBtn: s("copyBtn"),
      clearBtn: s("clearBtn"),
      sendBtn: s("sendBtn"),
      sendCount: s("sendCount"),
    },
  };
}

/** Place static overlay pieces (hover box, tag, pin, popover) in viewport coordinates. */
export function placeOverlayStatics(refs: StageRefs) {
  const { button, click, popover } = LAYOUT;
  Object.assign(refs.ov.hoverBox.style, {
    left: `${button.x}px`,
    top: `${button.y}px`,
    width: `${button.w}px`,
    height: `${button.h}px`,
  });
  Object.assign(refs.ov.hoverTag.style, { left: `${button.x}px`, top: `${button.y - 24}px` });
  Object.assign(refs.ov.pin.style, { left: `${click.x}px`, top: `${click.y}px` });
  Object.assign(refs.ov.popover.style, { left: `${popover.x}px`, top: `${popover.y}px` });
}

/** Measure toolbar anchors in world coordinates with the capsule momentarily expanded. */
export function measureAnchors(refs: StageRefs): Anchors {
  const { ov, overlayHost, world, terminal } = refs;
  const wasExpanded = ov.capsule.classList.contains("expanded");
  const prevCount = ov.sendCount.textContent;
  overlayHost.classList.add("measuring");
  ov.capsule.classList.add("expanded");
  ov.sendCount.textContent = "1";

  const wr = world.getBoundingClientRect();
  const k = wr.width / WORLD_W || 1;
  const center = (el: Element): Point => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - wr.left) / k, y: (r.top + r.height / 2 - wr.top) / k };
  };
  const anchors: Anchors = {
    capsule: center(ov.capsule),
    sendBtn: center(ov.sendBtn),
    launcher: center(ov.launcher),
    terminalBody: center(terminal),
  };

  ov.capsule.classList.toggle("expanded", wasExpanded);
  ov.sendCount.textContent = prevCount;
  void overlayHost.offsetWidth;
  overlayHost.classList.remove("measuring");
  return anchors;
}
