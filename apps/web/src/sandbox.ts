/**
 * Mock EventSource + fetch shim for the agentcue overlay on the static website.
 * Sets window.__AGENTCUE_ORIGIN__ and patches EventSource/fetch so the real
 * <agentcue-root> Shadow DOM toolbar connects in "Ready" state.
 */
import { getCurrentLang } from "./i18n.ts";
import { formatCuePrompt } from "../../../packages/agentcue/src/shared/prompt.ts";
import {
  SUPPORTED_AGENTS,
  type AgentId,
  type CuePayload,
  type DispatcherState,
  type ServerEvent,
} from "../../../packages/agentcue/src/shared/types.ts";

const SIM_ORIGIN = "http://agentcue.local.sim";

declare global {
  interface Window {
    __AGENTCUE_ORIGIN__?: string;
    __AGENTCUE_INSTANCE__?: { togglePickMode: () => void };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCliPreview(agent: AgentId, continueSession: boolean): string {
  const cont = continueSession ? " --continue" : "";
  switch (agent) {
    case "agy":
      return `agy --dangerously-skip-permissions${cont} -p "&lt;cue&gt;"`;
    case "claude":
      return `claude --dangerously-skip-permissions${cont} -p "&lt;cue&gt;"`;
    case "cursor-agent":
      return `cursor-agent --force${cont} -p "&lt;cue&gt;"`;
    case "codex":
      return continueSession
        ? `codex exec resume --dangerously-bypass-approvals-and-sandbox --last "&lt;cue&gt;"`
        : `codex exec --dangerously-bypass-approvals-and-sandbox "&lt;cue&gt;"`;
    case "pi":
      return `pi --approve${cont} -p -- "&lt;cue&gt;"`;
  }
}

function setTerminalHeader(
  state: "idle" | "running" | "done",
  enText: string,
  zhText: string,
  title = "zsh — ~/projects/my-web-app",
) {
  const lang = getCurrentLang();
  const titleEl = document.getElementById("terminal-title");
  if (titleEl) titleEl.textContent = title;

  const statusEl = document.getElementById("terminal-status");
  if (statusEl) statusEl.dataset.state = state;

  const statusTextEl = document.getElementById("terminal-status-text");
  if (statusTextEl) {
    statusTextEl.setAttribute("data-en", enText);
    statusTextEl.setAttribute("data-zh", zhText);
    statusTextEl.textContent = lang === "zh" ? zhText : enText;
  }
}

function renderIdleTerminal() {
  const lang = getCurrentLang();
  setTerminalHeader("idle", "READY :4318", "就绪 :4318");

  const logEl = document.getElementById("live-cue-log");
  if (!logEl) return;

  const line1En = "# Waiting for your first Cue…";
  const line1Zh = "# 等待你的第一个 Cue…";
  const line2En =
    "# Press Cmd/Ctrl + Shift + F, click an element, add a note, and hit Cmd/Ctrl + Enter.";
  const line2Zh =
    "# 按 Cmd/Ctrl + Shift + F，点击元素，输入备注，然后按 Cmd/Ctrl + Enter 发送。";

  logEl.innerHTML = `<span class="term-line"><span class="term-prompt">~/projects/my-web-app $</span> <span class="term-cmd">npx agentcue</span></span>
<span class="term-line"><span class="term-brand">✦ agentcue</span> bridge listening on <span class="term-bold">http://127.0.0.1:4318</span></span>
<span class="term-line"><span class="term-dim">  Workspace :</span> ~/projects/my-web-app</span>
<span class="term-line"><span class="term-dim">  Agents    :</span> <span class="term-ok">✓ agy</span>  <span class="term-ok">✓ claude</span>  <span class="term-ok">✓ cursor-agent</span>  <span class="term-ok">✓ codex</span>  <span class="term-ok">✓ pi</span></span>

<span class="term-line term-comment" data-en="${line1En}" data-zh="${line1Zh}">${lang === "zh" ? line1Zh : line1En}</span>
<span class="term-line"><span class="term-comment" data-en="${line2En}" data-zh="${line2Zh}">${lang === "zh" ? line2Zh : line2En}</span><span class="term-cursor" aria-hidden="true"></span></span>`;
}

function applySimulatedVisualEdit(selector: string, note: string) {
  let el: HTMLElement | null = null;
  try {
    el = document.querySelector<HTMLElement>(selector);
  } catch {
    return;
  }
  if (!el) return;

  const lower = note.toLowerCase();
  el.style.transition = "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)";

  if (lower.includes("green") || lower.includes("emerald") || lower.includes("绿")) {
    el.style.backgroundColor = "#10b981";
    el.style.color = "#ffffff";
    el.style.borderColor = "#10b981";
  } else if (lower.includes("purple") || lower.includes("violet") || lower.includes("紫")) {
    el.style.backgroundColor = "#7c3aed";
    el.style.color = "#ffffff";
    el.style.borderColor = "#7c3aed";
  } else if (lower.includes("red") || lower.includes("coral") || lower.includes("红")) {
    el.style.backgroundColor = "#ef4444";
    el.style.color = "#ffffff";
    el.style.borderColor = "#ef4444";
  } else if (lower.includes("orange") || lower.includes("amber") || lower.includes("橙")) {
    el.style.backgroundColor = "#f59e0b";
    el.style.color = "#ffffff";
    el.style.borderColor = "#f59e0b";
  } else if (lower.includes("blue") || lower.includes("蓝")) {
    el.style.backgroundColor = "#2563eb";
    el.style.color = "#ffffff";
    el.style.borderColor = "#2563eb";
  }

  if (lower.includes("pill") || lower.includes("round") || lower.includes("圆")) {
    el.style.borderRadius = "999px";
  }

  if (lower.includes("large") || lower.includes("big") || lower.includes("大")) {
    el.style.transform = "scale(1.06)";
  }

  const quoted = note.match(/["'"""]([^"'""]+)["'"""]/);
  if (quoted && el.children.length === 0) {
    el.textContent = quoted[1];
  }
}

/** Install shims and set __AGENTCUE_ORIGIN__. Returns cleanup function. */
export function initSandbox() {
  window.__AGENTCUE_ORIGIN__ = SIM_ORIGIN;

  const sseListeners = new Set<(evt: ServerEvent) => void>();
  const simState: DispatcherState = {
    cwd: "~/projects/my-web-app",
    agents: [...SUPPORTED_AGENTS],
    defaultAgent: "agy",
    status: "idle",
    activeCue: null,
    queuedCount: 0,
    lastResult: null,
  };

  function broadcast(evt: ServerEvent) {
    for (const fn of sseListeners) fn(evt);
  }

  const NativeEventSource = window.EventSource;
  class SimulatedEventSource {
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private unsub: (() => void) | null = null;

    constructor(url: string) {
      if (!url.startsWith(SIM_ORIGIN)) {
        return new NativeEventSource(url) as unknown as SimulatedEventSource;
      }
      const listener = (evt: ServerEvent) => {
        this.onmessage?.({ data: JSON.stringify(evt) });
      };
      sseListeners.add(listener);
      this.unsub = () => sseListeners.delete(listener);
      setTimeout(() => {
        this.onopen?.();
        listener({ type: "state", state: simState });
      }, 30);
    }

    close() {
      this.unsub?.();
    }
  }
  window.EventSource = SimulatedEventSource as unknown as typeof EventSource;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${SIM_ORIGIN}/api/cue` && init?.method === "POST") {
      const payload = JSON.parse(String(init.body || "{}")) as CuePayload;
      const cueId = `sim-${Date.now().toString(36).slice(-6)}`;
      const formatted = formatCuePrompt(payload);
      const lang = getCurrentLang();
      const cliCmd = formatCliPreview(payload.agent, payload.continueSession);
      const contLabel = payload.continueSession ? " (continue)" : "";

      setTerminalHeader(
        "running",
        `RUNNING · ${payload.agent}`,
        `运行中 · ${payload.agent}`,
        `zsh — ~/projects/my-web-app (${payload.agent})`,
      );

      const logEl = document.getElementById("live-cue-log");
      if (logEl) {
        const runEn = `⟳ Applying visual Cue via ${payload.agent}…`;
        const runZh = `⟳ 正在通过 ${payload.agent} 应用视觉变更…`;
        logEl.innerHTML = `<span class="term-line"><span class="term-info">▶ [agentcue]</span> Running <span class="term-bold">${escapeHtml(payload.agent)}</span>${contLabel} <span class="term-dim">· cue ${cueId}</span></span>
<span class="term-line"><span class="term-prompt">~/projects/my-web-app $</span> <span class="term-cmd">${cliCmd}</span></span>
<span class="term-payload">${escapeHtml(formatted)}</span>
<span class="term-line" id="terminal-exec-line"><span class="term-running" data-en="${escapeHtml(runEn)}" data-zh="${escapeHtml(runZh)}">${escapeHtml(lang === "zh" ? runZh : runEn)}</span><span class="term-cursor" aria-hidden="true"></span></span>`;
      }

      simState.status = "running";
      simState.activeCue = {
        cueId,
        agent: payload.agent,
        pinCount: payload.pins.length,
        startedAt: Date.now(),
      };
      broadcast({ type: "state", state: { ...simState } });

      setTimeout(() => {
        for (const pin of payload.pins) {
          applySimulatedVisualEdit(pin.context.selector, pin.note);
        }
        simState.status = "done";
        simState.activeCue = null;
        simState.lastResult = {
          cueId,
          agent: payload.agent,
          ok: true,
          durationMs: 650,
          finishedAt: Date.now(),
        };

        setTerminalHeader(
          "done",
          `DONE · 650ms`,
          `已完成 · 650ms`,
          `zsh — ~/projects/my-web-app (${payload.agent})`,
        );

        const execLine = document.getElementById("terminal-exec-line");
        if (execLine) {
          const curLang = getCurrentLang();
          const doneEn = `finished cue ${cueId} (650ms) · HMR reloaded`;
          const doneZh = `完成 cue ${cueId} (650ms) · HMR 已热重载`;
          execLine.innerHTML = `<span class="term-ok">✓ [agentcue]</span> <span class="term-bold">${escapeHtml(payload.agent)}</span> <span data-en="${escapeHtml(doneEn)}" data-zh="${escapeHtml(doneZh)}">${escapeHtml(curLang === "zh" ? doneZh : doneEn)}</span><span class="term-cursor" aria-hidden="true"></span>`;
        }

        broadcast({
          type: "cue:done",
          cueId,
          agent: payload.agent,
          durationMs: 650,
          log: "",
        });
        broadcast({ type: "state", state: { ...simState } });
      }, 650);

      return new Response(
        JSON.stringify({ ok: true, cueId, queuePosition: 1 }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      );
    }
    return nativeFetch(input, init);
  };
}

/** Reset sandbox target elements to their original styles */
export function resetSandboxTargets() {
  const ids = ["sandbox-primary-btn", "sandbox-secondary-btn", "sandbox-card-target"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.removeAttribute("style");
  }
  renderIdleTerminal();
}
