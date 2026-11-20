/**
 * Shot script (S0–S6) for the hero intro. Every visual state is a pure function
 * of time t, so pausing, looping, and jumping to a step are just "render(t)".
 */
import { applyCamera, clamp, progress, sample, type Key } from "./camera.ts";
import { LAYOUT, type Anchors, type StageRefs, type StepCopy } from "./stage.ts";

export const DURATION = 14.5;
/** A calm, fully-resolved frame used for reduced motion. */
export const REST_TIME = 12.6;

const T = {
  pickKeys: [1.25, 2.4, 1.7] as const, // show, hide, press
  expand: 1.8,
  cursorIn: 2.6,
  cursorOut: 7.0,
  hoverOn: 3.65,
  click: 4.2,
  popover: 4.3,
  typeStart: 5.1,
  typeEnd: 6.6,
  sendKeys: [7.0, 8.0, 7.55] as const,
  send: 7.6,
  collapse: 8.3,
  packet: [7.7, 8.75] as const,
  run: 8.75,
  done: 11.0,
  hmr: 11.75,
  launcherDoneEnd: 12.8,
  tryLink: 12.2,
  fadeOut: 14.1,
};

export function stepCopy(mac: boolean): StepCopy[] {
  const pick = mac ? "⌘⇧F" : "Ctrl+Shift+F";
  const send = mac ? "⌘↵" : "Ctrl+Enter";
  return [
    {
      en: "Pick",
      zh: "选取",
      captionEn: `Press ${pick} to enter Pick Mode, then click any element.`,
      captionZh: `按 ${pick} 进入 Pick 模式，然后点击任意元素。`,
    },
    {
      en: "Note",
      zh: "备注",
      captionEn: "Type what should change, in plain words.",
      captionZh: "用一句话写下想怎么改。",
    },
    {
      en: "Push",
      zh: "发送",
      captionEn: `Press ${send} (or S) to push the Cue to your local Agent CLI.`,
      captionZh: `按 ${send}（或 S）把 Cue 推送给本地 Agent CLI。`,
    },
    {
      en: "Done",
      zh: "完成",
      captionEn: "The agent edits your code and HMR reloads the page.",
      captionZh: "Agent 直接修改代码，页面 HMR 热重载。",
    },
  ];
}

/** Start time of each step; clicking a step jumps here. */
export const STEP_STARTS = [0, 4.9, 7.0, 8.75];

const NOTE = { en: "Make it green", zh: "改成绿色" };
const ARIA = {
  en: "Animated walkthrough: pick a button on the page with agentcue, type “Make it green”, push the Cue to the agy CLI, and the button turns green after HMR reload.",
  zh: "动画演示：用 agentcue 选中页面上的按钮，输入“改成绿色”，把 Cue 推送给 agy CLI，HMR 热重载后按钮变绿。",
};

export function buildKeys(refs: StageRefs, mac: boolean) {
  const caps = (keys: string[]) => keys.map((k) => `<kbd class="intro-key">${k}</kbd>`).join("");
  refs.keys.innerHTML =
    `<div class="intro-keyset" data-k="pick">${caps(mac ? ["⌘", "⇧", "F"] : ["Ctrl", "Shift", "F"])}</div>` +
    `<div class="intro-keyset" data-k="send">${caps(mac ? ["⌘", "↵"] : ["Ctrl", "Enter"])}</div>`;
}

function cameraTrack(a: Anchors): Key[] {
  const vp = LAYOUT.viewport;
  const pop = { x: vp.x + LAYOUT.popover.x + 150, y: vp.y + LAYOUT.popover.y + 78 };
  const mid = { x: (a.sendBtn.x + a.terminalBody.x) / 2, y: (a.sendBtn.y + a.terminalBody.y) / 2 };
  return [
    [0, 480, 270, 1],
    [1.3, 480, 270, 1],
    [2.3, a.capsule.x, a.capsule.y - 40, 1.9],
    [2.9, a.capsule.x, a.capsule.y - 40, 1.9],
    [3.9, 250, 300, 1.75],
    [4.6, 270, 310, 1.8],
    [5.1, pop.x, pop.y, 2.15],
    [7.0, pop.x, pop.y, 2.15],
    [7.9, mid.x - 60, mid.y + 40, 1.3],
    [8.7, mid.x + 60, mid.y - 10, 1.35],
    [9.4, a.terminalBody.x, a.terminalBody.y, 1.85],
    [11.1, a.terminalBody.x, a.terminalBody.y, 1.85],
    [12.0, 480, 270, 1],
    [DURATION, 480, 270, 1],
  ];
}

function cursorTrack(): Key[] {
  const vp = LAYOUT.viewport;
  const c = { x: vp.x + LAYOUT.click.x, y: vp.y + LAYOUT.click.y };
  return [
    [T.cursorIn, 470, 400],
    [3.9, c.x, c.y],
    [4.45, c.x, c.y],
    [5.0, c.x - 70, c.y + 100],
  ];
}

function focusAt(t: number): string {
  if (t >= 1.3 && t < 2.9) return "toolbar";
  if (t >= 2.9 && t < 7.2) return "page";
  if (t >= 9.2 && t < 11.2) return "terminal";
  return "";
}

export function stepAt(t: number): number {
  let idx = 0;
  STEP_STARTS.forEach((s, i) => {
    if (t >= s) idx = i;
  });
  return idx;
}

const on = (el: Element, cls: string, value: boolean) => el.classList.toggle(cls, value);
const text = (el: HTMLElement, value: string) => {
  if (el.textContent !== value) el.textContent = value;
};
const within = (t: number, a: number, b: number) => t >= a && t < b;

export interface Timeline {
  render: (t: number, fit: number, lang: "en" | "zh") => void;
}

export function createTimeline(refs: StageRefs, anchors: Anchors): Timeline {
  const camera = cameraTrack(anchors);
  const cursor = cursorTrack();
  const vp = LAYOUT.viewport;
  const keysets = [...refs.keys.querySelectorAll<HTMLElement>(".intro-keyset")];

  return {
    render(t, fit, lang) {
      const [cx, cy, z] = sample(camera, t);
      applyCamera(refs.world, fit, cx, cy, z);
      refs.world.dataset.focus = focusAt(t);
      refs.world.style.opacity = String(
        Math.min(progress(t, 0, 0.35), 1 - progress(t, T.fadeOut, DURATION)),
      );
      refs.frame.setAttribute("aria-label", ARIA[lang]);

      // Cursor + click ripple (world space)
      const [mx, my] = sample(cursor, t);
      refs.cursor.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
      refs.cursor.style.opacity = String(
        Math.min(progress(t, T.cursorIn, T.cursorIn + 0.25), 1 - progress(t, T.cursorOut, T.cursorOut + 0.3)),
      );
      const rp = clamp((t - T.click) / 0.55, 0, 1);
      refs.ripple.style.transform = `translate(${vp.x + LAYOUT.click.x}px, ${vp.y + LAYOUT.click.y}px) scale(${0.3 + rp * 1.4})`;
      refs.ripple.style.opacity = rp > 0 && rp < 1 ? String(1 - rp) : "0";

      // Cue packet flying from the send button to the terminal
      const pp = clamp((t - T.packet[0]) / (T.packet[1] - T.packet[0]), 0, 1);
      const e = progress(pp, 0, 1);
      const a = anchors.sendBtn;
      const b = anchors.terminalBody;
      const lift = -140 * 4 * e * (1 - e);
      const px = a.x + (b.x - a.x) * e;
      const py = a.y + (b.y - a.y) * e + lift;
      refs.packet.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      refs.packet.style.opacity = pp > 0 && pp < 1 ? "1" : "0";

      // Keycaps (frame space)
      const keyWindows = [T.pickKeys, T.sendKeys];
      keysets.forEach((el, i) => {
        const [show, hide, press] = keyWindows[i];
        on(el, "visible", within(t, show, hide));
        on(el, "pressed", within(t, press, press + 0.22));
      });

      // Real toolbar replica
      const ov = refs.ov;
      const expanded = within(t, T.expand, T.collapse);
      const hasPin = within(t, T.click, T.send);
      const typed = Math.round(NOTE[lang].length * clamp((t - T.typeStart) / (T.typeEnd - T.typeStart), 0, 1));
      const ready = hasPin && typed > 0;
      const running = within(t, T.send, T.done);
      on(ov.capsule, "expanded", expanded);
      on(ov.launcher, "hidden", expanded);
      on(ov.launcher, "done", within(t, T.done, T.launcherDoneEnd));
      text(ov.launcherText, within(t, T.collapse, T.done) ? "agy editing…" : "");
      const dot = running ? "status-dot running" : "status-dot";
      if (ov.statusDot.className !== dot) ov.statusDot.className = dot;
      if (ov.launcherDot.className !== dot) ov.launcherDot.className = dot;
      ov.hideBtn.disabled = !hasPin;
      ov.clearBtn.disabled = !hasPin;
      ov.copyBtn.disabled = !ready;
      const sent = within(t, T.send, T.collapse);
      ov.sendBtn.disabled = !ready && !sent;
      on(ov.sendBtn, "sent", sent);
      text(ov.sendCount, ready ? "1" : "");

      const hovering = within(t, T.hoverOn, T.click + 0.05);
      on(ov.hoverBox, "visible", hovering);
      on(ov.hoverTag, "visible", hovering);
      const pinShown = within(t, T.click, T.send + 0.2);
      const pinDisplay = pinShown ? "flex" : "none";
      if (ov.pin.style.display !== pinDisplay) ov.pin.style.display = pinDisplay;
      on(ov.pin, "removing", t >= T.send);
      on(ov.popover, "visible", within(t, T.popover, T.send));
      const noteText = NOTE[lang].slice(0, typed);
      if (ov.popInput.value !== noteText) ov.popInput.value = noteText;

      // Terminal
      const termState = t >= T.done ? "done" : t >= T.run ? "running" : "idle";
      if (refs.termStatus.dataset.state !== termState) refs.termStatus.dataset.state = termState;
      text(
        refs.termStatusText,
        termState === "done" ? "DONE · 2.4s" : termState === "running" ? "RUNNING · agy" : "READY :4318",
      );
      text(refs.termTitle, t >= T.run ? "zsh — ~/projects/my-web-app (agy)" : "zsh — ~/projects/my-web-app");
      text(refs.termNote, `“${NOTE[lang]}”`);
      for (const line of refs.termLines) {
        const at = Number(line.dataset.at);
        const until = line.dataset.until ? Number(line.dataset.until) : Infinity;
        on(line, "on", within(t, at, until));
      }

      // Page result: HMR flash + button turns green
      on(refs.cta, "is-green", t >= T.hmr);
      on(refs.hmr, "flash", within(t, T.hmr - 0.05, T.hmr + 0.35));

      // Controls
      const step = stepAt(t);
      refs.steps.forEach((el, i) => {
        on(el, "active", i === step);
        on(el, "past", i < step);
      });
      refs.captions.forEach((el, i) => on(el, "active", i === step));
      on(refs.tryLink, "visible", t >= T.tryLink && t < T.fadeOut + 0.3);
    },
  };
}
